import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_PUBLICO = path.join(RAIZ, 'public');
export const DIR_MUSICAS = path.join(RAIZ, 'musicas');
export const DIR_FERRAMENTAS = path.join(RAIZ, 'ferramentas');
export const PORTA = Number(process.env.PORTA ?? 8788);
