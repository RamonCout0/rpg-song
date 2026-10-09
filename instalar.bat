@echo off
rem Prepara o Windows 10/11: Node.js, ffmpeg, yt-dlp e (opcional) Ollama.
rem Para apenas tocar o que ja esta na pasta musicas/, basta o Node.js.
cd /d "%~dp0"

where winget >nul 2>nul
if errorlevel 1 (
  echo winget nao encontrado. Instale manualmente: Node.js LTS (nodejs.org) e ffmpeg.
  goto yt
)

where node >nul 2>nul
if errorlevel 1 winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements

where ffmpeg >nul 2>nul
if errorlevel 1 winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements

where ollama >nul 2>nul
if not errorlevel 1 goto yt
choice /c SN /m "Instalar o Ollama para o loop inteligente"
if errorlevel 2 goto yt
winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements

:yt
if not exist ferramentas mkdir ferramentas
if not exist ferramentas\yt-dlp.exe curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -o ferramentas\yt-dlp.exe

echo.
echo Pronto. FECHE esta janela e abra de novo (para o Windows enxergar os programas novos).
echo Depois de instalar o Ollama, baixe um modelo leve:  ollama pull llama3.2:3b
echo Para usar: de dois cliques em iniciar.bat
pause
