@echo off
rem Sobe o servidor e abre o painel no navegador.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Rode instalar.bat ou instale em nodejs.org
  pause
  exit /b 1
)

if "%PORTA%"=="" set PORTA=8788
start "" /b cmd /c "timeout /t 1 >nul & start http://localhost:%PORTA%"
node server.js
pause
