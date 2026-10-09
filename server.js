// Servidor local do Looping Musica. Sem dependencias: so o Node.
// O som toca no navegador (painel), nas caixas do proprio PC.
//
//   Painel ... http://localhost:8788

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORTA, DIR_PUBLICO, DIR_MUSICAS } from './src/config.js';
import { listarMusicas, apagarMusica, baixar, EXTENSOES } from './src/biblioteca.js';
import { analisar, loopsValidos } from './src/analise.js';
import { listarModelos, escolherModelo } from './src/ollama.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

let download = { ativo: false, linha: '', erro: '', pronto: '' };

// Analise de loops: uma musica por vez (o CPU do notebook agradece).
let analise = { ativo: false, arquivo: '', etapa: '', fila: 0, erros: [] };
const fila = [];

async function processarFila() {
  if (analise.ativo) return;
  analise = { ativo: true, arquivo: '', etapa: '', fila: fila.length, erros: [] };
  while (fila.length) {
    const arquivo = fila.shift();
    analise.arquivo = arquivo;
    analise.fila = fila.length;
    try {
      await analisar(arquivo, (etapa) => (analise.etapa = etapa));
    } catch (e) {
      analise.erros.push(`${arquivo}: ${e.message}`);
    }
  }
  analise = { ...analise, ativo: false, arquivo: '', etapa: '', fila: 0 };
}

function json(res, codigo, corpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let bruto = '';
    req.on('data', (p) => (bruto += p));
    req.on('end', () => {
      try {
        resolve(JSON.parse(bruto));
      } catch {
        resolve({});
      }
    });
  });
}

// Audio com suporte a Range: o navegador precisa disso para repetir e pular no arquivo.
function servirAudio(req, res, nome) {
  const arquivo = path.join(DIR_MUSICAS, path.basename(nome));
  const ext = path.extname(arquivo).toLowerCase();
  if (!EXTENSOES.has(ext) || !fs.existsSync(arquivo)) {
    res.writeHead(404);
    return res.end();
  }

  const tamanho = fs.statSync(arquivo).size;
  const cabecalhos = { 'Content-Type': TIPOS[ext], 'Accept-Ranges': 'bytes' };
  const faixa = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');

  if (faixa) {
    const inicio = faixa[1] === '' ? tamanho - Number(faixa[2]) : Number(faixa[1]);
    const fim = faixa[1] !== '' && faixa[2] !== '' ? Math.min(Number(faixa[2]), tamanho - 1) : tamanho - 1;
    if (inicio >= tamanho || inicio > fim) {
      res.writeHead(416, { 'Content-Range': `bytes */${tamanho}` });
      return res.end();
    }
    res.writeHead(206, {
      ...cabecalhos,
      'Content-Range': `bytes ${inicio}-${fim}/${tamanho}`,
      'Content-Length': fim - inicio + 1,
    });
    return fs.createReadStream(arquivo, { start: inicio, end: fim }).pipe(res);
  }

  res.writeHead(200, { ...cabecalhos, 'Content-Length': tamanho });
  fs.createReadStream(arquivo).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

  if (caminho === '/api/musicas') return json(res, 200, listarMusicas());
  if (caminho === '/api/download') return json(res, 200, download);
  if (caminho === '/api/loops') return json(res, 200, loopsValidos());

  if (caminho === '/api/analise' && req.method === 'GET') return json(res, 200, analise);

  if (caminho === '/api/analise' && req.method === 'POST') {
    const { arquivo, todas } = await lerCorpo(req);
    const existentes = listarMusicas().map((m) => m.arquivo);
    const pedidas = todas ? existentes.filter((a) => !loopsValidos()[a]) : existentes.filter((a) => a === arquivo);
    for (const a of pedidas) if (!fila.includes(a) && a !== analise.arquivo) fila.push(a);
    processarFila();
    return json(res, 200, { ok: true, enfileiradas: pedidas.length });
  }

  if (caminho === '/api/ollama') {
    try {
      const modelos = await listarModelos();
      return json(res, 200, { ativo: true, modelo: escolherModelo(modelos), modelos: modelos.map((m) => m.nome) });
    } catch {
      return json(res, 200, { ativo: false });
    }
  }

  if (caminho === '/api/baixar' && req.method === 'POST') {
    if (download.ativo) return json(res, 409, { ok: false, mensagem: 'ja existe um download em andamento' });
    const { url } = await lerCorpo(req);
    download = { ativo: true, linha: 'Iniciando...', erro: '', pronto: '' };
    baixar(String(url ?? ''), (linha) => (download.linha = linha))
      .then((f) => (download = { ativo: false, linha: '', erro: '', pronto: f.titulo }))
      .catch((e) => (download = { ativo: false, linha: '', erro: e.message, pronto: '' }));
    return json(res, 200, { ok: true });
  }

  if (caminho === '/api/apagar' && req.method === 'POST') {
    const { arquivo } = await lerCorpo(req);
    try {
      apagarMusica(arquivo);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, mensagem: e.message });
    }
  }

  if (caminho.startsWith('/audio/')) return servirAudio(req, res, caminho.slice(7));

  if (caminho === '/' || caminho === '/index.html') {
    return fs.readFile(path.join(DIR_PUBLICO, 'index.html'), (erro, conteudo) => {
      res.writeHead(erro ? 500 : 200, { 'Content-Type': TIPOS['.html'], 'Cache-Control': 'no-store' });
      res.end(conteudo);
    });
  }

  res.writeHead(404);
  res.end();
});

servidor.on('error', (e) => {
  console.error(
    e.code === 'EADDRINUSE'
      ? `\n  A porta ${PORTA} ja esta em uso. Ja tem outro Looping Musica aberto?\n`
      : e.message,
  );
  process.exit(1);
});

// So aceita conexoes do proprio PC.
servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`\n  Looping Musica: http://localhost:${PORTA}\n  (Ctrl+C para encerrar)\n`);
});
