#!/usr/bin/env bash
# CONSTRUIR O SITE PARA PUBLICAR (25/10/2026)
# A Cloudflare roda este arquivo antes de publicar. Ele monta a pasta
# "publico" só com o que o site precisa. Assim, arquivos que não são do
# site (scripts Python, SQL do banco, servidor local) não ficam online.
# Se criar um arquivo novo que o site usa, acrescente o nome aqui.
set -euo pipefail
rm -rf publico
mkdir -p publico
cp index.html privacidade.html style.css \
   backend.js db-supabase.js supabase-config.js \
   editor-assistente.js editor-assistente.css \
   _headers publico/
cp -r imagens vendor publico/
echo "Pasta publico pronta:"
ls -R publico | head -50
