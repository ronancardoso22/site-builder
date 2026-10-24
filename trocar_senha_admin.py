"""
TROCAR A SENHA DO ADMINISTRADOR (24/10/2026)

POR QUE ESTE ARQUIVO EXISTE?
  A senha antiga do admin ficou escrita no código e foi enviada ao GitHub,
  que é público. Por isso ela deve ser considerada VAZADA. Este script
  troca a senha sem que ela apareça em lugar nenhum: nem no código, nem
  na tela, nem em conversas.

COMO USAR:
  1. Dê dois cliques neste arquivo (ou rode: python trocar_senha_admin.py)
  2. Digite a nova senha (ela não aparece enquanto você digita — é normal)
  3. Digite de novo para confirmar
  Pronto: backend.js e agent.html passam a aceitar só a senha nova.

DICA DE SENHA FORTE:
  Use pelo menos 12 caracteres, misturando palavras, números e símbolos,
  e NÃO reutilize a senha de outro serviço (principalmente do e-mail).

COMO FUNCIONA (por dentro):
  - getpass lê a senha sem mostrar na tela.
  - Calculamos o "hash" PBKDF2-SHA256 (150 mil voltas) com um "sal"
    aleatório novo. É a mesma conta que o site faz no navegador para
    conferir a senha no login.
  - Só o sal e o hash são gravados nos arquivos. A partir deles não dá
    para descobrir a senha.
"""

import base64
import getpass
import hashlib
import os
import re
import secrets
import sys

ITERACOES = 150_000
ARQUIVOS = ["backend.js", "agent.html"]


def main():
    pasta = os.path.dirname(os.path.abspath(__file__))

    senha = getpass.getpass("Nova senha do admin: ")
    if len(senha) < 12:
        print("A senha precisa ter pelo menos 12 caracteres. Nada foi alterado.")
        return 1
    if getpass.getpass("Digite de novo: ") != senha:
        print("As senhas não são iguais. Nada foi alterado.")
        return 1

    sal = secrets.token_bytes(16)
    hash_ = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), sal, ITERACOES)
    sal_b64 = base64.b64encode(sal).decode()
    hash_b64 = base64.b64encode(hash_).decode()

    # Confere antes de gravar: cada arquivo precisa ter exatamente um
    # adminSalt e um adminHash (para não estragar nada por engano)
    conteudos = {}
    for nome in ARQUIVOS:
        caminho = os.path.join(pasta, nome)
        with open(caminho, encoding="utf-8", newline="") as f:
            texto = f.read()
        if len(re.findall(r"adminSalt:\s*'[^']*'", texto)) != 1 or len(re.findall(r"adminHash:\s*'[^']*'", texto)) != 1:
            print(f"Não encontrei adminSalt/adminHash em {nome}. Nada foi alterado.")
            return 1
        texto = re.sub(r"adminSalt:\s*'[^']*'", f"adminSalt: '{sal_b64}'", texto)
        texto = re.sub(r"adminHash:\s*'[^']*'", f"adminHash: '{hash_b64}'", texto)
        conteudos[caminho] = texto

    for caminho, texto in conteudos.items():
        with open(caminho, "w", encoding="utf-8", newline="") as f:
            f.write(texto)

    print("Senha do admin trocada em backend.js e agent.html.")
    print("Recarregue o site (Ctrl+F5) e entre com a senha nova.")
    return 0


if __name__ == "__main__":
    codigo = main()
    if os.name == "nt":
        input("\nAperte Enter para fechar...")
    sys.exit(codigo)
