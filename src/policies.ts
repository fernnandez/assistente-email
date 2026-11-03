import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';

export interface PolicySet {
  text: string;
  files: string[];
  chars: number;
  truncated: boolean;
}

/**
 * Lê todos os .md da pasta de políticas. Linhas com [INTERNO ...] são removidas: o que o modelo não vê, ele não vaza.
 * Tudo vai no prompt (sem banco vetorial): para bases pequenas (dezenas de páginas) é mais simples e preciso.
 */
export function loadPolicies(dir: string = config.policiesDir, maxChars: number = config.policiesMaxChars): PolicySet {
  if (!existsSync(dir)) return { text: '', files: [], chars: 0, truncated: false };
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).sort();
  const parts: string[] = [];
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter((l) => !/\[INTERNO/i.test(l));
    const content = lines.join('\n').trim();
    if (content) parts.push(`### ${f}\n${content}`);
  }
  let text = parts.join('\n\n');
  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);
  return { text, files, chars: text.length, truncated };
}
