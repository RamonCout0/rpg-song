// Acha pontos de loop "de jogo" numa musica.
//
// 1. ffmpeg decodifica para PCM mono baixo (leve: roda em notebook sem placa de video)
// 2. FFT + bandas -> batidas -> um vetor de timbre por batida
// 3. Compara todos os pares de batidas: "sair em J e cair em I" soa continuo?
// 4. O Ollama escolhe, entre os melhores candidatos, o loop principal e as variacoes
//    (ele nao ouve o audio: recebe numeros e escolhe ids; se falhar, a heuristica decide)

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DIR_MUSICAS, DIR_FERRAMENTAS } from './config.js';
import { garantirOllama, escolherModelo, perguntarJson } from './ollama.js';

const TAXA = 11025;
const JANELA = 2048;
const SALTO = 256;
const BANDAS = 24;
const DT = SALTO / TAXA;
const CTX = 4; // batidas de contexto antes/depois do ponto de salto
const LOOP_MIN_S = 6;

const INDICE = path.join(DIR_MUSICAS, '_loops.json');
const VERSAO = 1;

export function lerLoops() {
  try {
    return JSON.parse(fs.readFileSync(INDICE, 'utf8'));
  } catch {
    return {};
  }
}

function gravarLoops(d) {
  fs.writeFileSync(INDICE, JSON.stringify(d, null, 2), 'utf8');
}

export function esquecerLoops(arquivo) {
  const d = lerLoops();
  delete d[arquivo];
  gravarLoops(d);
}

export function loopsValidos() {
  const d = lerLoops();
  const saida = {};
  for (const [arq, v] of Object.entries(d)) {
    try {
      if (v.versao === VERSAO && fs.statSync(path.join(DIR_MUSICAS, arq)).size === v.bytes) saida[arq] = v;
    } catch {}
  }
  return saida;
}

// ---------- decodificacao ----------

function decodificar(arquivo) {
  return new Promise((resolve, reject) => {
    const local = path.join(DIR_FERRAMENTAS, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const p = spawn(
      fs.existsSync(local) ? local : 'ffmpeg',
      ['-v', 'error', '-i', path.join(DIR_MUSICAS, arquivo), '-ac', '1', '-ar', String(TAXA), '-f', 's16le', '-'],
      { windowsHide: true },
    );
    const partes = [];
    let erro = '';
    p.stdout.on('data', (b) => partes.push(b));
    p.stderr.on('data', (b) => (erro += b));
    p.on('error', (e) =>
      reject(new Error(e.code === 'ENOENT' ? 'ffmpeg nao encontrado (rode instalar.sh)' : e.message)),
    );
    p.on('close', (c) => {
      if (c !== 0) return reject(new Error('ffmpeg falhou: ' + erro.slice(0, 200)));
      const b = Buffer.concat(partes);
      resolve(new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2)));
    });
  });
}

// ---------- espectro ----------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const meio = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < meio; k++) {
        const a = i + k;
        const b = a + meio;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

function espectro(pcm) {
  const n = Math.floor((pcm.length - JANELA) / SALTO) + 1;
  if (n < 50) throw new Error('musica curta demais para analisar');
  const spec = new Float32Array(n * BANDAS);
  const rms = new Float32Array(n);
  const hann = new Float64Array(JANELA).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (JANELA - 1)));
  // bandas em escala log, 80 Hz .. 5 kHz
  const bordas = Array.from({ length: BANDAS + 1 }, (_, b) =>
    Math.max(1, Math.round(((80 * Math.pow(5000 / 80, b / BANDAS)) * JANELA) / TAXA)),
  );
  for (let b = 1; b <= BANDAS; b++) if (bordas[b] <= bordas[b - 1]) bordas[b] = bordas[b - 1] + 1;

  const re = new Float64Array(JANELA);
  const im = new Float64Array(JANELA);
  for (let t = 0; t < n; t++) {
    const o = t * SALTO;
    let soma = 0;
    for (let i = 0; i < JANELA; i++) {
      const v = pcm[o + i] / 32768;
      soma += v * v;
      re[i] = v * hann[i];
      im[i] = 0;
    }
    rms[t] = Math.sqrt(soma / JANELA);
    fft(re, im);
    for (let b = 0; b < BANDAS; b++) {
      let m = 0;
      for (let k = bordas[b]; k < bordas[b + 1]; k++) m += Math.hypot(re[k], im[k]);
      spec[t * BANDAS + b] = Math.log1p((m / (bordas[b + 1] - bordas[b])) * 50);
    }
  }
  return { n, spec, rms };
}

// ---------- batidas ----------

function interp(env, x) {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  return env[i] + (env[i + 1] - env[i]) * (x - i);
}

function batidas({ n, spec }) {
  // forca de ataque = fluxo espectral positivo, menos a media local
  const fluxo = new Float32Array(n);
  for (let t = 1; t < n; t++) {
    let s = 0;
    for (let b = 0; b < BANDAS; b++) s += Math.max(0, spec[t * BANDAS + b] - spec[(t - 1) * BANDAS + b]);
    fluxo[t] = s;
  }
  const env = new Float32Array(n);
  const raio = Math.round(0.5 / DT);
  let acc = 0;
  for (let t = 0; t < n; t++) {
    acc += fluxo[t];
    if (t > 2 * raio) acc -= fluxo[t - 2 * raio - 1];
    const media = acc / Math.min(t + 1, 2 * raio + 1);
    env[t] = Math.max(0, fluxo[t] - media);
  }
  let mediaPos = 0;
  for (const v of env) mediaPos += v;
  mediaPos /= n;

  // andamento: autocorrelacao do ataque, com leve preferencia por ~120 bpm
  let melhorP = 0.5;
  let melhorS = -1;
  for (let p = 0.33; p <= 0.9; p += 0.0025) {
    const P = p / DT;
    let s = 0;
    for (let t = 0; t < n - P - 1; t++) s += env[t] * interp(env, t + P);
    s *= Math.exp(-0.5 * Math.pow(Math.log2(p / 0.5), 2));
    if (s > melhorS) {
      melhorS = s;
      melhorP = p;
    }
  }
  const P = melhorP / DT;

  // fase da grade
  let fase = 0;
  let melhorF = -1;
  for (let f = 0; f < P; f += 0.5) {
    let s = 0;
    for (let x = f; x < n - 1; x += P) s += interp(env, x);
    if (s > melhorF) {
      melhorF = s;
      fase = f;
    }
  }

  // acompanha a musica (andamento nao e perfeito): ajusta cada batida ao ataque mais proximo
  const lista = [];
  let x = fase;
  while (x < n - 1) {
    lista.push(x);
    const prev = x + P;
    let pico = Math.round(prev);
    let valor = -1;
    for (let t = Math.round(prev - 0.2 * P); t <= Math.round(prev + 0.2 * P); t++) {
      if (t > 0 && t < n && env[t] > valor) {
        valor = env[t];
        pico = t;
      }
    }
    x = valor > 0.3 * mediaPos ? prev + 0.5 * (pico - prev) : prev;
  }
  return { bpm: 60 / melhorP, quadros: lista };
}

// ---------- candidatos a salto ----------

function normalizar(v) {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
}

const segundos = (quadro) => (quadro * SALTO + JANELA / 2) / TAXA;

function candidatos({ n, spec, rms }, quadros, bpm) {
  const nb = quadros.length - 1;
  const feat = new Float32Array(nb * BANDAS);
  const volume = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    const a = Math.round(quadros[k]);
    const b = Math.max(a + 1, Math.min(n, Math.round(quadros[k + 1])));
    for (let t = a; t < b; t++) {
      for (let j = 0; j < BANDAS; j++) feat[k * BANDAS + j] += spec[t * BANDAS + j] / (b - a);
      volume[k] += rms[t] / (b - a);
    }
  }
  // tira o timbre medio da musica inteira: sobra so o que diferencia um trecho de outro
  const media = new Float32Array(BANDAS);
  for (let k = 0; k < nb; k++) for (let j = 0; j < BANDAS; j++) media[j] += feat[k * BANDAS + j] / nb;
  for (let k = 0; k < nb; k++) for (let j = 0; j < BANDAS; j++) feat[k * BANDAS + j] -= media[j];

  const D = CTX * BANDAS;
  const antes = new Float32Array(nb * D);
  const depois = new Float32Array(nb * D);
  const volAntes = new Float32Array(nb);
  for (let k = CTX; k <= nb - CTX; k++) {
    for (let c = 0; c < CTX; c++) {
      for (let j = 0; j < BANDAS; j++) {
        antes[k * D + c * BANDAS + j] = feat[(k - CTX + c) * BANDAS + j];
        if (k + c < nb) depois[k * D + c * BANDAS + j] = feat[(k + c) * BANDAS + j];
      }
      volAntes[k] += volume[k - CTX + c] / CTX;
    }
    normalizar(antes.subarray(k * D, (k + 1) * D));
    normalizar(depois.subarray(k * D, (k + 1) * D));
  }

  const dur = (k) => segundos(quadros[k]);
  const minBatidas = Math.max(8, Math.ceil(LOOP_MIN_S / (60 / bpm)));
  const melhores = [];
  for (let j = CTX + minBatidas; j <= nb - CTX; j++) {
    let nota = -1;
    let alvo = -1;
    for (let i = CTX; i <= j - minBatidas; i++) {
      let sa = 0;
      let sd = 0;
      for (let d = 0; d < D; d++) {
        sa += antes[j * D + d] * antes[i * D + d];
        sd += depois[j * D + d] * depois[i * D + d];
      }
      let s = 0.65 * sa + 0.35 * sd;
      s -= Math.min(0.3, 0.25 * Math.abs(Math.log((volAntes[j] + 1e-4) / (volAntes[i] + 1e-4))));
      const c = j - i;
      if (c % 8 === 0) s += 0.03;
      else if (c % 4 === 0) s += 0.015;
      if (s > nota) {
        nota = s;
        alvo = i;
      }
    }
    if (alvo >= 0) melhores.push({ j, i: alvo, nota });
  }

  // fica com os melhores sem repetir quase o mesmo salto
  melhores.sort((a, b) => b.nota - a.nota);
  const escolhidos = [];
  for (const m of melhores) {
    if (escolhidos.length >= 16) break;
    const de = dur(m.j);
    const para = dur(m.i);
    if (escolhidos.some((e) => Math.abs(e.de - de) < 3 && Math.abs(e.para - para) < 3)) continue;
    escolhidos.push({ de, para, nota: m.nota, j: m.j, i: m.i });
  }

  // energia 0..100 de cada trecho (relativa ao mais alto da musica)
  const db = (v) => 20 * Math.log10(v + 1e-5);
  const ordenado = Array.from(volume).sort((a, b) => a - b);
  const topo = db(ordenado[Math.floor(ordenado.length * 0.95)] ?? 1);
  const energia = (a, b) => {
    let s = 0;
    for (let k = a; k < b; k++) s += volume[k] / Math.max(1, b - a);
    return Math.round(Math.max(0, Math.min(100, 100 + (db(s) - topo) * 2.5)));
  };

  return {
    lista: escolhidos
      .sort((a, b) => a.de - b.de)
      .map((e, id) => ({
        id: id + 1,
        de: round(e.de),
        para: round(e.para),
        qualidade: Math.round(Math.max(0, Math.min(1, (e.nota - 0.5) * 2)) * 100),
        energia: energia(e.i, e.j),
      })),
    perfil: perfilEnergia(volume, quadros, db, topo),
  };
}

function round(x) {
  return Math.round(x * 100) / 100;
}

function perfilEnergia(volume, quadros, db, topo) {
  const total = segundos(quadros[quadros.length - 1]);
  const fatias = Math.min(12, Math.max(4, Math.round(total / 10)));
  const saida = [];
  for (let f = 0; f < fatias; f++) {
    const a = Math.floor((f / fatias) * volume.length);
    const b = Math.max(a + 1, Math.floor(((f + 1) / fatias) * volume.length));
    let s = 0;
    for (let k = a; k < b; k++) s += volume[k] / (b - a);
    saida.push({
      inicio: round(segundos(quadros[a])),
      energia: Math.round(Math.max(0, Math.min(100, 100 + (db(s) - topo) * 2.5))),
    });
  }
  return saida;
}

// ---------- escolha (Ollama + heuristica) ----------

const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

const ESQUEMA = {
  type: 'object',
  properties: {
    principal: { type: 'integer' },
    variacoes: { type: 'array', items: { type: 'integer' }, maxItems: 4 },
    resumo: { type: 'string' },
  },
  required: ['principal', 'variacoes', 'resumo'],
};

const SISTEMA =
  'Voce escolhe pontos de loop para musica de fundo de jogo (como numa raid de MMO), para que ' +
  'a musica toque por horas sem enjoar. Voce recebe candidatos de salto ja calculados: "sai em X e volta para Y". ' +
  'Responda so JSON: principal = id do salto que forma o melhor loop (alta continuidade, trecho longo, ' +
  'nao fica preso no comeco nem na parte final fraca); variacoes = ate 4 ids de saltos diferentes, ' +
  'cujo "sai em" seja DEPOIS do "volta para" do principal, para alternar os trechos tocados; ' +
  'resumo = uma frase em portugues sobre a estrutura da musica.';

function formatarPrompt(duracao, bpm, perfil, lista) {
  return (
    `Duracao ${mmss(duracao)}, andamento ~${Math.round(bpm)} bpm.\n` +
    `Energia (0-100) por trecho: ${perfil.map((p) => `${mmss(p.inicio)}=${p.energia}`).join(', ')}.\n` +
    'Candidatos:\n' +
    lista
      .map(
        (c) =>
          `#${c.id}: sai em ${mmss(c.de)} -> volta para ${mmss(c.para)} | trecho de ${Math.round(c.de - c.para)}s | continuidade ${c.qualidade} | energia ${c.energia}`,
      )
      .join('\n')
  );
}

const pontuacao = (c) => c.qualidade + 6 * Math.log(Math.max(1, c.de - c.para) / LOOP_MIN_S);

function montarPlano(lista, escolha) {
  const porId = new Map(lista.map((c) => [c.id, c]));
  const ranking = [...lista].sort((a, b) => pontuacao(b) - pontuacao(a));
  let principal = porId.get(escolha?.principal);
  // modelo pequeno (CPU) as vezes escolhe mal: so aceita se nao for bem pior que a melhor opcao medida
  if (!principal || pontuacao(principal) < pontuacao(ranking[0]) - 12) principal = ranking[0];
  if (!principal) return { saltos: [], porIA: false };

  const saltos = [{ ...principal, papel: 'principal' }];
  const alcancavel = (c) => c.de > principal.para + 4 && !saltos.some((s) => s.id === c.id);
  let porIA = !!escolha && porId.get(escolha.principal) === principal;
  for (const id of escolha?.variacoes ?? []) {
    const c = porId.get(id);
    if (c && alcancavel(c) && saltos.length < 5) saltos.push({ ...c, papel: 'variacao' });
  }
  // completa com o que a heuristica achar bom, para sempre haver variedade
  for (const c of [...lista].sort((a, b) => pontuacao(b) - pontuacao(a))) {
    if (saltos.length >= 3) break;
    if (alcancavel(c) && c.qualidade >= principal.qualidade - 15) saltos.push({ ...c, papel: 'variacao' });
  }
  // a musica precisa sempre ter um salto no fim, senao ela acabaria no fim do arquivo
  return { saltos: saltos.sort((a, b) => a.de - b.de), porIA };
}

// ---------- principal ----------

export async function analisar(arquivo, aoProgredir = () => {}) {
  const bytes = fs.statSync(path.join(DIR_MUSICAS, arquivo)).size;

  aoProgredir('decodificando o audio');
  const pcm = await decodificar(arquivo);
  const duracao = pcm.length / TAXA;

  aoProgredir('procurando batidas e pontos de loop');
  const esp = espectro(pcm);
  const { bpm, quadros } = batidas(esp);
  if (quadros.length < 40) throw new Error('nao consegui achar batidas suficientes');
  const { lista, perfil } = candidatos(esp, quadros, bpm);

  let escolha = null;
  let modelo = null;
  let aviso = '';
  if (lista.length) {
    try {
      aoProgredir('subindo o Ollama');
      const modelos = await garantirOllama();
      modelo = escolherModelo(modelos);
      if (!modelo) throw new Error('nenhum modelo instalado (ollama pull llama3.2:3b)');
      aoProgredir(`Ollama (${modelo}) escolhendo os loops; no CPU pode levar um minuto`);
      escolha = await perguntarJson(modelo, SISTEMA, formatarPrompt(duracao, bpm, perfil, lista), ESQUEMA);
    } catch (e) {
      aviso = 'Sem Ollama, usei so a analise do audio: ' + e.message;
      modelo = null;
    }
  }

  const plano = montarPlano(lista, escolha);
  const resultado = {
    versao: VERSAO,
    bytes,
    duracao: round(duracao),
    bpm: Math.round(bpm),
    modelo,
    porIA: plano.porIA,
    resumo: typeof escolha?.resumo === 'string' ? escolha.resumo.slice(0, 300) : '',
    aviso,
    saltos: plano.saltos.map(({ id, de, para, qualidade, papel }) => ({ id, de, para, qualidade, papel })),
  };

  const todos = lerLoops();
  todos[arquivo] = resultado;
  gravarLoops(todos);
  return resultado;
}
