# Looping Música

Toca música em loop no próprio PC. O painel abre no navegador e o som sai
pelas caixas do computador. Sem Discord, sem internet durante o jogo, sem
dependências além do Node.js.

## Ubuntu — primeira vez

Copie esta pasta inteira para o Ubuntu e, dentro dela:

```bash
bash instalar.sh
```

Isso instala Node.js e ffmpeg e baixa o `yt-dlp` (só é necessário para baixar
músicas novas). **Se você só vai tocar as músicas que já estão em `musicas/`,
basta ter o Node.js:** `sudo apt install nodejs`.

## Usar

```bash
bash iniciar.sh
```

Abre o painel em <http://localhost:8788>. Deixe o terminal aberto durante a
sessão; `Ctrl+C` encerra.

> A aba do navegador precisa ficar aberta: é ela que toca o som.

## Painel

| Botão | O que faz |
|-------|-----------|
| 🔂 Repetir faixa | A mesma música volta ao início quando termina |
| 🔁 Repetir lista | Toca todas as músicas em sequência e recomeça |
| 🔀 Aleatório | Na lista, sorteia a próxima em vez de seguir a ordem |
| ▶ Tocar todas | Começa a lista do início (ou de uma sorteada) |

Pausar, pular, parar, barra de posição e volume. Atalhos: `Espaço` pausa,
`→` pula, `↑`/`↓` volume. Modo, aleatório e volume ficam salvos.

## Músicas

- Baixe pelo painel (link do YouTube), ou
- copie arquivos para `musicas/` (`.opus .ogg .mp3 .m4a .webm .wav .flac`) e
  recarregue a página. As 5 que você já tinha estão lá.

**Dica para amanhã:** baixe tudo antes da sessão, em casa, com internet.

## Se algo falhar

| Sintoma | O que fazer |
|---------|-------------|
| "yt-dlp nao encontrado" | Rode `bash instalar.sh` |
| Não sai som | Veja o volume do sistema e da aba (clique no painel uma vez: o navegador só libera áudio depois de um clique) |
| "porta 8788 já em uso" | Já tem outro aberto. Ou use `PORTA=9000 bash iniciar.sh` (e abra a porta nova) |
