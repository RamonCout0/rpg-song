# Looping Música

Toca música em loop no próprio PC. O painel abre no navegador e o som sai
pelas caixas do computador. Sem Discord, sem internet durante o jogo, sem
dependências além do Node.js.

## Windows — primeira vez

Dê dois cliques em `instalar.bat` (usa o `winget`; instala Node.js, ffmpeg, yt-dlp e,
se você quiser, o Ollama). Feche e abra de novo a janela quando terminar.
Para usar: dois cliques em `iniciar.bat`. Se você só vai tocar as músicas que já estão
em `musicas/`, basta ter o Node.js.

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

## Loop inteligente (🧠 + Ollama)

Em vez de repetir a música inteira, o painel acha trechos que "emendam" bem
(como nos jogos) e fica pulando entre eles, sem corte e sem repetir sempre o
mesmo caminho. Dá para ouvir 30 min sem enjoar.

1. Instale o [Ollama](https://ollama.com) e um modelo pequeno: `ollama pull llama3.2:3b`
   (roda só no processador; não precisa de placa de vídeo).
2. No painel, clique em **🧠 Analisar músicas sem loop** (ou no 🧠 de uma música).
   Leva alguns segundos por música e o resultado fica salvo em `musicas/_loops.json`,
   então **faça isso em casa, antes da sessão**.
3. Deixe **🧠 Loop inteligente** ligado e toque normalmente.

Como funciona: o próprio programa analisa o áudio (batidas e timbre) e calcula os
melhores pontos de salto; o Ollama não "ouve", ele recebe esses candidatos e escolhe
o loop principal e as variações. Sem o Ollama, uma heurística escolhe.
Modelo padrão: o menor instalado; para forçar outro: `OLLAMA_MODELO=qwen3:8b bash iniciar.sh`.

No modo **Repetir lista**, o menu "trocar de música depois de" define quanto tempo
fica em cada música (ela termina naturalmente ao fim desse tempo).
Obs.: o loop inteligente carrega a música inteira na memória (uma de 15 min usa ~240 MB).
