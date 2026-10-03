#!/usr/bin/env bash
# Prepara o Ubuntu: Node.js, ffmpeg e o yt-dlp (so precisa para BAIXAR musicas).
# Para apenas tocar o que ja esta na pasta musicas/, basta o Node.js.
set -e
cd "$(dirname "$0")"

sudo apt update
sudo apt install -y nodejs ffmpeg curl

mkdir -p ferramentas
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ferramentas/yt-dlp
chmod +x ferramentas/yt-dlp
chmod +x iniciar.sh

echo
echo "Pronto. Para usar:  ./iniciar.sh"
