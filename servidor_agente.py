"""
Servidor local do Drakantos (gratuito, sem instalar nada além do Python).

O QUE FAZ:
  1. Abre o site no seu navegador em http://localhost:8000
  2. (25/10/2026) A busca de notícias da Steam saiu daqui: agora roda no
     Supabase. O antigo "proxy" foi removido (menos portas abertas).

COMO USAR:
  Dê dois cliques neste arquivo (ou rode: python servidor_agente.py)
  e deixe a janela aberta enquanto usa o site.

IMPORTANTE:
  Abra o site e o agente pelo MESMO endereço (http://localhost:8000/...).
  O navegador guarda os posts separado por endereço: se o agente publicar em
  localhost e você abrir o index.html direto do arquivo, os posts não aparecem.

SEGURANÇA (24/10/2026):
  - Só aceita conexões do próprio computador (127.0.0.1).
  - Não entrega arquivos internos: .git, .claude, backups, banco (.db),
    código Python (.py) e configurações (.json).
  - Recusa pedidos com "Host" estranho (protege contra um truque chamado
    DNS rebinding, em que um site malicioso tenta ler o seu localhost).
  - Não tem mais proxy (25/10/2026): o servidor não busca nada na internet.
  - Arquivos sempre "sem cache", para o navegador pegar a versão nova.
  - Envia cabeçalhos de segurança em todas as respostas.
"""

import http.server
import os
import socketserver
import urllib.parse
import webbrowser

PORTA = 8000

# Endereços pelos quais o site pode ser aberto
HOSTS_PERMITIDOS = {f"localhost:{PORTA}", f"127.0.0.1:{PORTA}", "localhost", "127.0.0.1"}

# Pastas e tipos de arquivo que nunca devem ser entregues ao navegador
PASTAS_BLOQUEADAS = ("/.git", "/.claude", "/backup", "/agenteia", "/supabase/", "/agent.html")
EXTENSOES_BLOQUEADAS = (".db", ".db-wal", ".db-shm", ".py", ".pyc", ".json", ".md", ".env", ".ini", ".log")


def caminho_bloqueado(caminho_url: str) -> bool:
    """Diz se o caminho pedido aponta para um arquivo interno."""
    caminho = urllib.parse.unquote(urllib.parse.urlparse(caminho_url).path).replace("\\", "/").lower()
    if ".." in caminho:
        return True
    # Qualquer pedaço do caminho que comece com "." (arquivos ocultos)
    if any(parte.startswith(".") for parte in caminho.split("/") if parte):
        return True
    if caminho.startswith(PASTAS_BLOQUEADAS):
        return True
    # .json só é liberado dentro de imagens/ (ex.: listas de imagens)
    if caminho.endswith(".json") and caminho.startswith("/imagens/"):
        return False
    return caminho.endswith(EXTENSOES_BLOQUEADAS)


class Handler(http.server.SimpleHTTPRequestHandler):
    # Tipos de arquivo fixos. No Windows, o Python às vezes lê do registro
    # que .js é "text/plain"; com o cabeçalho nosniff o navegador recusaria
    # o script. Aqui garantimos o tipo certo.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js":   "text/javascript; charset=utf-8",
        ".css":  "text/css; charset=utf-8",
        ".json": "application/json",
        ".svg":  "image/svg+xml",
        ".png":  "image/png",
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif":  "image/gif",
        ".ico":  "image/x-icon",
    }

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        return self.extensions_map.get(ext) or super().guess_type(path)

    def end_headers(self):
        # Cabeçalhos de segurança em TODAS as respostas
        self.send_header("X-Content-Type-Options", "nosniff")       # não "adivinha" tipo de arquivo
        self.send_header("X-Frame-Options", "SAMEORIGIN")            # outros sites não podem embutir este
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.headers.get("Host", "") not in HOSTS_PERMITIDOS:
            self.send_error(403, "Endereco nao permitido")
            return
        if caminho_bloqueado(self.path):
            self.send_error(404, "Arquivo nao encontrado")
            return
        # Sempre manda o arquivo inteiro (nunca "304 não mudou"). Assim o
        # navegador não reaproveita uma cópia antiga com o tipo errado.
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        return super().do_GET()

    def do_HEAD(self):
        if self.headers.get("Host", "") not in HOSTS_PERMITIDOS or caminho_bloqueado(self.path):
            self.send_error(404, "Arquivo nao encontrado")
            return
        return super().do_HEAD()

    def list_directory(self, path):
        # Não mostra a lista de arquivos das pastas
        self.send_error(404, "Arquivo nao encontrado")
        return None


if __name__ == "__main__":
    # Serve a pasta onde este arquivo está (a pasta do site)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    # 127.0.0.1 = só este computador consegue acessar (ninguém da rede)
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORTA), Handler) as servidor:
        print(f"Servidor rodando em http://localhost:{PORTA}")
        print("Deixe esta janela aberta. Para parar, feche a janela ou aperte Ctrl+C.")
        webbrowser.open(f"http://localhost:{PORTA}/")
        servidor.serve_forever()
