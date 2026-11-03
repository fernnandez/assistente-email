import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}\.md$/i;

export const docsDir = fileURLToPath(new URL('../docs', import.meta.url));

export class DocsError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'DocsError';
  }
}

function assertSafeName(name: string): string {
  const base = basename(name);
  if (base !== name || !SAFE_NAME.test(base)) {
    throw new DocsError(400, 'Nome de arquivo inválido. Use apenas .md com letras, números, ponto, _ ou -.');
  }
  return base;
}

function resolveIn(dir: string, name: string): string {
  const safe = assertSafeName(name);
  const root = resolve(dir);
  const full = resolve(root, safe);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new DocsError(400, 'Caminho inválido.');
  }
  return full;
}

export function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).sort();
}

export function readMarkdown(dir: string, name: string): { name: string; content: string } {
  const full = resolveIn(dir, name);
  if (!existsSync(full)) throw new DocsError(404, 'Arquivo não encontrado.');
  return { name: basename(full), content: readFileSync(full, 'utf8') };
}

export function writeMarkdown(dir: string, name: string, content: string): { name: string } {
  if (content.length > 500_000) throw new DocsError(400, 'Arquivo grande demais (máx. 500 KB).');
  mkdirSync(dir, { recursive: true });
  const full = resolveIn(dir, name);
  writeFileSync(full, content, 'utf8');
  return { name: basename(full) };
}

export function deleteMarkdown(dir: string, name: string): void {
  const full = resolveIn(dir, name);
  if (!existsSync(full)) throw new DocsError(404, 'Arquivo não encontrado.');
  unlinkSync(full);
}

export function listDocs(): string[] {
  return listMarkdown(docsDir);
}

export function readDoc(name: string): { name: string; content: string } {
  return readMarkdown(docsDir, name);
}

export function listPolicies(): string[] {
  return listMarkdown(config.policiesDir);
}

export function readPolicy(name: string): { name: string; content: string } {
  return readMarkdown(config.policiesDir, name);
}

export function writePolicy(name: string, content: string): { name: string } {
  return writeMarkdown(config.policiesDir, name, content);
}

export function createPolicy(name: string, content = ''): { name: string } {
  const safe = assertSafeName(name);
  const full = join(resolve(config.policiesDir), safe);
  if (existsSync(full)) throw new DocsError(409, 'Já existe uma política com esse nome.');
  return writeMarkdown(config.policiesDir, safe, content);
}

export function deletePolicy(name: string): void {
  deleteMarkdown(config.policiesDir, name);
}

const examplesDir = fileURLToPath(new URL('../policies.exemplo', import.meta.url));

/** Copia .md de policies.exemplo/ para policies/ sem sobrescrever arquivos já existentes. */
export function seedExamplePolicies(): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];
  if (!existsSync(examplesDir)) return { copied, skipped };
  mkdirSync(config.policiesDir, { recursive: true });
  for (const name of listMarkdown(examplesDir)) {
    const dest = join(resolve(config.policiesDir), name);
    if (existsSync(dest)) {
      skipped.push(name);
      continue;
    }
    writeFileSync(dest, readFileSync(join(examplesDir, name), 'utf8'), 'utf8');
    copied.push(name);
  }
  return { copied, skipped };
}
