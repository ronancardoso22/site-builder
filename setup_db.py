"""
Inicializa o banco de dados SQLite do Drakwiki.
Execute uma vez: python setup_db.py
"""

import sqlite3
import hashlib
import hmac
import os
import secrets

DB_PATH = os.path.join(os.path.dirname(__file__), "drakwiki.db")


# SEGURANÇA (24/10/2026): antes era SHA-256 sem sal, que é rápido demais
# (fácil de adivinhar por força bruta) e igual para senhas iguais.
# Agora: PBKDF2-SHA256 com 150 mil voltas e um sal aleatório por senha.
# Formato guardado: "pbkdf2$150000$<sal hex>$<hash hex>"
ITERACOES = 150_000


def hash_senha(senha: str, sal_hex: str | None = None, iteracoes: int = ITERACOES) -> str:
    sal = bytes.fromhex(sal_hex) if sal_hex else secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal, iteracoes)
    return f"pbkdf2${iteracoes}${sal.hex()}${h.hex()}"


def senha_confere(senha: str, guardado: str) -> bool:
    try:
        _, iteracoes, sal_hex, _ = guardado.split("$")
        # compare_digest compara sem "vazar" pelo tempo onde a diferença está
        return hmac.compare_digest(hash_senha(senha, sal_hex, int(iteracoes)), guardado)
    except (ValueError, AttributeError):
        return False


def criar_banco():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")   # melhor performance em leitura/escrita simultânea
    cur = conn.cursor()

    cur.executescript("""
        -- ============================================================
        -- TABELA DE USUÁRIOS
        -- Armazena os dados de cadastro de cada conta do site.
        -- ============================================================
        CREATE TABLE IF NOT EXISTS usuarios (
            id          TEXT PRIMARY KEY,               -- ex: 'user-1715000000000'
            nome        TEXT NOT NULL,
            email       TEXT NOT NULL UNIQUE,
            senha_hash  TEXT NOT NULL,                  -- PBKDF2 + sal; nunca guardar senha pura
            criado_em   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- ============================================================
        -- TABELA DE POSTS
        -- Cada post pertence a um usuário (autor_id → usuarios.id).
        -- ============================================================
        CREATE TABLE IF NOT EXISTS posts (
            id               TEXT PRIMARY KEY,          -- ex: 'post-1715000000000'
            tipo             TEXT NOT NULL              -- 'novidades' | 'builds' | 'guias'
                                 CHECK(tipo IN ('novidades','builds','guias')),
            titulo           TEXT NOT NULL,
            descricao        TEXT NOT NULL,
            emoji            TEXT NOT NULL DEFAULT '📝',
            autor_id         TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            data_publicacao  TEXT,                      -- string formatada exibida no site
            timestamp        INTEGER,                   -- Unix ms para ordenação
            criado_em        DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- ============================================================
        -- TAGS DOS POSTS  (relação N:N simplificada)
        -- Cada post pode ter várias tags (pve, pvp, farm, evento…).
        -- ============================================================
        CREATE TABLE IF NOT EXISTS post_tags (
            post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            tag      TEXT NOT NULL,
            PRIMARY KEY (post_id, tag)
        );

        -- ============================================================
        -- ÍNDICES  (aceleram buscas comuns)
        -- ============================================================
        CREATE INDEX IF NOT EXISTS idx_usuarios_email   ON usuarios(email);
        CREATE INDEX IF NOT EXISTS idx_posts_tipo       ON posts(tipo);
        CREATE INDEX IF NOT EXISTS idx_posts_autor      ON posts(autor_id);
        CREATE INDEX IF NOT EXISTS idx_posts_timestamp  ON posts(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_post_tags_tag    ON post_tags(tag);
    """)

    conn.commit()
    conn.close()
    print(f"Banco criado em: {DB_PATH}")


def usuario_existe(email: str) -> bool:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT 1 FROM usuarios WHERE email = ?", (email,)).fetchone()
    conn.close()
    return row is not None


def cadastrar_usuario(id_: str, nome: str, email: str, senha: str) -> bool:
    """Retorna True se cadastrou, False se e-mail já existe."""
    if usuario_existe(email):
        return False
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        "INSERT INTO usuarios (id, nome, email, senha_hash) VALUES (?, ?, ?, ?)",
        (id_, nome, email, hash_senha(senha))
    )
    conn.commit()
    conn.close()
    return True


def autenticar_usuario(email: str, senha: str) -> dict | None:
    """Retorna os dados do usuário se login correto, None caso contrário."""
    conn = sqlite3.connect(DB_PATH)
    # Busca pelo e-mail (consulta com "?" = protegida contra SQL injection)
    # e confere a senha no Python, porque cada hash tem o seu próprio sal.
    row = conn.execute(
        "SELECT id, nome, email, criado_em, senha_hash FROM usuarios WHERE email = ?",
        (email,)
    ).fetchone()
    conn.close()
    if not row or not senha_confere(senha, row[4]):
        return None
    return {"id": row[0], "nome": row[1], "email": row[2], "criado_em": row[3]}


def salvar_post(post: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        """INSERT OR REPLACE INTO posts
           (id, tipo, titulo, descricao, emoji, autor_id, data_publicacao, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (post["id"], post["tipo"], post["titulo"], post["descricao"],
         post.get("emoji", "📝"), post["autor_id"],
         post.get("data_publicacao"), post.get("timestamp"))
    )
    for tag in post.get("tags", []):
        conn.execute(
            "INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)",
            (post["id"], tag)
        )
    conn.commit()
    conn.close()


def listar_posts(tipo: str | None = None) -> list[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    if tipo:
        rows = conn.execute(
            "SELECT * FROM posts WHERE tipo = ? ORDER BY timestamp DESC", (tipo,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM posts ORDER BY timestamp DESC").fetchall()

    posts = []
    for row in rows:
        p = dict(row)
        p["tags"] = [r[0] for r in conn.execute(
            "SELECT tag FROM post_tags WHERE post_id = ?", (p["id"],)
        ).fetchall()]
        posts.append(p)
    conn.close()
    return posts


def deletar_post(post_id: str, autor_id: str) -> bool:
    """Só permite deletar se o autor_id bater (segurança)."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.execute(
        "DELETE FROM posts WHERE id = ? AND autor_id = ?", (post_id, autor_id)
    )
    conn.commit()
    conn.close()
    return cur.rowcount > 0


if __name__ == "__main__":
    criar_banco()
    print("Tabelas: usuarios, posts, post_tags")
    print("Funções disponíveis: cadastrar_usuario, autenticar_usuario,")
    print("                     salvar_post, listar_posts, deletar_post")
