#!/usr/bin/env bash
# Sobe o servidor e abre o painel no navegador.
cd "$(dirname "$0")"

if ! command -v node >/dev/null; then
  echo "Node.js nao encontrado. Rode:  sudo apt install nodejs"
  exit 1
fi

(sleep 1 && xdg-open http://localhost:${PORTA:-8788} >/dev/null 2>&1) &
node server.js
