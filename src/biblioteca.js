// Pasta de musicas: listar, apagar e baixar do YouTube com o yt-dlp.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DIR_MUSICAS, DIR_FERRAMENTAS } from './config.js';
import { esquecerLoops } from './analise.js';

const INDICE = path.join(DIR_MUSICAS, '_titulos.json');
export const EXTENSOES = new Set(['.opus', '.ogg', '.mp3', '.m4a', '.webm', '.wav', '.flac']);

// yt-dlp na pasta ferramentas/ primeiro, depois no PATH do sistema.
function acharYtDlp() {
  for (const nome of ['yt-dlp', 'yt-dlp.exe']) {
    const local = path.join(DIR_FERRAMENTAS, nome);
    if (fs.existsSync(local)) return local;
  }
  return 'yt-dlp';
}

function lerIndice() {
  try {
    return JSON.parse(fs.readFileSync(INDICE, 'utf8'));
  } catch {
    return {};
  }
}

function gravarIndice(dados) {
  fs.writeFileSync(INDICE, JSON.stringify(dados, null, 2), 'utf8');
}

export function listarMusicas() {
  if (!fs.existsSync(DIR_MUSICAS)) return [];
  const titulos = lerIndice();
  return fs
    .readdirSync(DIR_MUSICAS)
    .filter((nome) => EXTENSOES.has(path.extname(nome).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((arquivo) => ({
      arquivo,
      titulo: titulos[arquivo] ?? path.basename(arquivo, path.extname(arquivo)),
    }));
}

export function apagarMusica(arquivo) {
  const limpo = path.basename(String(arquivo));
  const completo = path.join(DIR_MUSICAS, limpo);
  if (!fs.existsSync(completo)) throw new Error('essa musica nao existe mais');
  fs.unlinkSync(completo);
  const titulos = lerIndice();
  delete titulos[limpo];
  gravarIndice(titulos);
  esquecerLoops(limpo);
}

export function baixar(url, aoProgredir = () => {}) {
  return new Promise((resolve, reject) => {
    if (!/^https?:\/\//i.test(url)) {
      reject(new Error('cole um link http(s) completo'));
      return;
    }

    fs.mkdirSync(DIR_MUSICAS, { recursive: true });
    const antes = new Set(fs.readdirSync(DIR_MUSICAS));

    const processo = spawn(
      acharYtDlp(),
      [
        '-x',
        '--audio-format', 'opus',
        '--audio-quality', '0',
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '--progress',
        '--print', 'after_move:TITULO=%(title)s',
        '-o', path.join(DIR_MUSICAS, '%(title).120B.%(ext)s'),
        url,
      ],
      { windowsHide: true },
    );

    let titulo = '';
    let erro = '';

    processo.stdout.on('data', (pedaco) => {
      for (const linha of pedaco.toString().split(/\r?\n/)) {
        if (linha.startsWith('TITULO=')) titulo = linha.slice(7).trim();
        else if (linha.includes('[download]')) aoProgredir(linha.trim());
      }
    });
    processo.stderr.on('data', (pedaco) => {
      erro += pedaco.toString();
    });

    processo.on('error', (e) => {
      reject(
        new Error(
          e.code === 'ENOENT'
            ? 'yt-dlp nao encontrado. Rode ./instalar.sh (veja o LEIA-ME)'
            : e.message,
        ),
      );
    });

    processo.on('close', (codigo) => {
      if (codigo !== 0) {
        const motivo = erro.split('\n').find((l) => l.toLowerCase().includes('error')) ?? '';
        reject(new Error(motivo.replace(/^ERROR:\s*/i, '').trim() || 'o download falhou'));
        return;
      }

      const arquivo = fs
        .readdirSync(DIR_MUSICAS)
        .find((n) => !antes.has(n) && EXTENSOES.has(path.extname(n).toLowerCase()));
      if (!arquivo) {
        reject(new Error('o download terminou mas nenhum arquivo novo apareceu'));
        return;
      }

      const titulos = lerIndice();
      titulos[arquivo] = titulo || path.basename(arquivo, path.extname(arquivo));
      gravarIndice(titulos);
      resolve({ arquivo, titulo: titulos[arquivo] });
    });
  });
}
