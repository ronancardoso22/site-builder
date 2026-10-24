"""
Servidor local do Drakantos (gratuito, sem instalar nada além do Python).

O QUE FAZ:
  1. Abre o site no seu navegador em http://localhost:8000
  2. Busca as notícias da Steam pelo próprio computador (rota /api/proxy),
     então o agente não depende mais de proxies públicos que caem ou bloqueiam.

COMO USAR:
  Dê dois cliques neste arquivo (ou rode: python servidor_agente.py)
  e deixe a janela aberta enquanto usa o agente.

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
  - O proxy só busca na Steam, limita o tamanho da resposta a 5 MB e
    confere o site final mesmo depois de redirecionamentos.
  - Envia cabeçalhos de segurança em todas as respostas.
"""

import http.server
import os
import socketserver
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

PORTA = 8000
LIMITE_PROXY = 5 * 1024 * 1024  # 5 MB

# Só deixa buscar estes sites (evita que o servidor vire um proxy aberto)
SITES_PERMITIDOS = {
    "api.steampowered.com",
    "store.steampowered.com",
    "steamcommunity.com",
}

# Endereços pelos quais o site pode ser aberto
HOSTS_PERMITIDOS = {f"localhost:{PORTA}", f"127.0.0.1:{PORTA}", "localhost", "127.0.0.1"}

# Pastas e tipos de arquivo que nunca devem ser entregues ao navegador
PASTAS_BLOQUEADAS = ("/.git", "/.claude", "/backup", "/agenteia")
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


class SemRedirecionamentoForaDaLista(urllib.request.HTTPRedirectHandler):
    """Só segue redirecionamentos que continuam em sites da Steam (https)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        partes = urllib.parse.urlparse(newurl)
        if partes.scheme != "https" or partes.hostname not in SITES_PERMITIDOS:
            raise urllib.error.HTTPError(newurl, 403, "Redirecionamento para site nao permitido", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


ABRIDOR = urllib.request.build_opener(SemRedirecionamentoForaDaLista)


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
        super().end_headers()

    def do_GET(self):
        if self.headers.get("Host", "") not in HOSTS_PERMITIDOS:
            self.send_error(403, "Endereco nao permitido")
            return
        if self.path.startswith("/api/proxy"):
            return self.proxy()
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

    def proxy(self):
        query = urllib.parse.urlparse(self.path).query
        alvo = urllib.parse.parse_qs(query).get("url", [""])[0]
        partes = urllib.parse.urlparse(alvo)

        if partes.scheme != "https" or partes.hostname not in SITES_PERMITIDOS:
            self.send_error(403, "Site nao permitido")
            return

        try:
            pedido = urllib.request.Request(alvo, headers={"User-Agent": "Mozilla/5.0 DrakantosAgent"})
            with ABRIDOR.open(pedido, timeout=20) as resposta:
                # Confere o endereço final (depois de possíveis redirecionamentos)
                final = urllib.parse.urlparse(resposta.geturl())
                if final.scheme != "https" or final.hostname not in SITES_PERMITIDOS:
                    self.send_error(403, "Site nao permitido")
                    return
                corpo = resposta.read(LIMITE_PROXY + 1)
                if len(corpo) > LIMITE_PROXY:
                    self.send_error(502, "Resposta grande demais")
                    return
                tipo = resposta.headers.get("Content-Type", "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(corpo)))
            # Só as páginas deste próprio servidor podem ler a resposta
            self.send_header("Access-Control-Allow-Origin", f"http://localhost:{PORTA}")
            self.end_headers()
            self.wfile.write(corpo)
        except Exception:
            # Não devolve detalhes do erro (podem revelar informações internas)
            self.send_error(502, "Falha ao buscar na Steam")


if __name__ == "__main__":
    # Serve a pasta onde este arquivo está (a pasta do site)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    # 127.0.0.1 = só este computador consegue acessar (ninguém da rede)
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORTA), Handler) as servidor:
        print(f"Servidor rodando em http://localhost:{PORTA}")
        print(f"Agente: http://localhost:{PORTA}/agent.html")
        print("Deixe esta janela aberta. Para parar, feche a janela ou aperte Ctrl+C.")
        webbrowser.open(f"http://localhost:{PORTA}/agent.html")
        servidor.serve_forever()
