// Cliente minimo do Ollama (http://127.0.0.1:11434). Pensado para notebook sem placa de video:
// modelo pequeno, contexto curto, e a memoria e liberada logo depois de cada pergunta.

import { spawn } from 'node:child_process';

const BASE = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
// Do mais leve para o mais pesado; se nenhum estiver instalado, usa o menor que existir.
const PREFERIDOS = ['llama3.2:3b', 'qwen3:4b', 'qwen3:1.7b', 'gemma3:4b', 'llama3.2:1b', 'qwen3:0.6b'];

async function pedir(caminho, corpo, ms = 10000) {
  const r = await fetch(BASE + caminho, {
    method: corpo ? 'POST' : 'GET',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function listarModelos() {
  const { models } = await pedir('/api/tags');
  return models.map((m) => ({ nome: m.name, tamanho: m.size })).sort((a, b) => a.tamanho - b.tamanho);
}

export function escolherModelo(modelos) {
  if (process.env.OLLAMA_MODELO) return process.env.OLLAMA_MODELO;
  const nomes = modelos.map((m) => m.nome);
  return PREFERIDOS.find((p) => nomes.includes(p)) ?? nomes[0] ?? null;
}

// Se o Ollama nao estiver rodando, tenta abrir o servidor dele e espera ate ~15s.
export async function garantirOllama() {
  try {
    return await listarModelos();
  } catch {}
  try {
    const p = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    p.on('error', () => {});
    p.unref();
  } catch {}
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      return await listarModelos();
    } catch {}
  }
  throw new Error('Ollama nao respondeu (instale em ollama.com e rode "ollama pull llama3.2:3b")');
}

export async function perguntarJson(modelo, sistema, usuario, esquema) {
  const base = {
    model: modelo,
    stream: false,
    format: esquema,
    keep_alive: 0, // libera a RAM assim que terminar
    options: { temperature: 0.2, num_ctx: 3072, num_predict: 300 },
    messages: [
      { role: 'system', content: sistema },
      { role: 'user', content: usuario },
    ],
  };
  let resp;
  try {
    resp = await pedir('/api/chat', { ...base, think: false }, 300000);
  } catch (e) {
    if (!/think/i.test(e.message)) throw e;
    resp = await pedir('/api/chat', base, 300000); // modelo sem suporte a "think"
  }
  return JSON.parse(resp.message.content);
}
