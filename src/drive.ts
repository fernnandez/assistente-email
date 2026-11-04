import { createRequire } from 'node:module';
import { runtime } from './settings';
import type { Customer, IncomingEmail } from './types';

// Entrypoint de pdf-parse roda um debug em ESM; usa o lib direto via require.
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (data: Buffer) => Promise<{ text: string }>;

export type DriveMatchMode = 'email_domain' | 'company_name' | 'pipedrive_org';

export interface DriveFileRef {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  read: boolean;
  note?: string;
}

export interface DriveContext {
  consulted: boolean;
  text: string;
  folderId: string | null;
  folderName: string | null;
  files: DriveFileRef[];
  note: string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const SLIDE_MIME = 'application/vnd.google-apps.presentation';

const DOC_HINT =
  /\b(contrato|contratos|proposta|propostas|aditivo|aditivos|documento|documentos|anexo|anexos|cl[aá]usula|cl[aá]usulas|assinatura|assinado|pdf|nota\s*fiscal|\bnf\b|nfe|boleto|recibo|sla|termo|termos|nda|acordo|minuta|política|politica|drive|pasta)\b/i;

const MAX_LIST = 8;
const MAX_READ = 3;
const MAX_CHARS_PER_FILE = 8000;
const MAX_TOTAL_CHARS = 20_000;

const empty = (note: string, consulted = false): DriveContext => ({
  consulted,
  text: note,
  folderId: null,
  folderName: null,
  files: [],
  note,
});

let tokenGetter: (() => Promise<string>) | null = null;

/** Liga o Drive ao mesmo OAuth do Gmail (chamar em main.ts). */
export function bindDriveAuth(getAccessToken: () => Promise<string>): void {
  tokenGetter = getAccessToken;
}

export function isDriveConfigured(): boolean {
  const d = runtime().drive;
  return d.enabled && !!d.rootFolderId && !!tokenGetter;
}

/** Heurística barata: só consulta Drive quando o e-mail parece falar de documentos. */
export function shouldConsultDrive(email: IncomingEmail): boolean {
  if (!isDriveConfigured()) return false;
  const blob = `${email.subject}\n${email.body}`;
  return DOC_HINT.test(blob);
}

/** Aceita ID puro ou URL do Drive (`.../folders/ID`). */
export function parseFolderId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const fromUrl = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (fromUrl) return fromUrl[1]!;
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

/** Linhas `dominio.com=folderId` (ou URL da pasta). */
export function parseDomainMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const domain = t.slice(0, eq).trim().toLowerCase().replace(/^@/, '');
    const id = parseFolderId(t.slice(eq + 1));
    if (domain && id) out[domain] = id;
  }
  return out;
}

export function scoreFolderName(folderName: string, needles: string[]): number {
  const n = normalizeName(folderName);
  if (!n) return 0;
  let best = 0;
  for (const raw of needles) {
    const needle = normalizeName(raw);
    if (!needle || needle.length < 2) continue;
    if (n === needle) best = Math.max(best, 100);
    else if (n.includes(needle) || needle.includes(n)) best = Math.max(best, 70);
    else {
      const parts = needle.split(' ').filter((p) => p.length > 2);
      const hits = parts.filter((p) => n.includes(p)).length;
      if (parts.length && hits === parts.length) best = Math.max(best, 50);
      else if (hits > 0) best = Math.max(best, 20 + hits * 10);
    }
  }
  return best;
}

export function extractHints(email: IncomingEmail): string[] {
  const text = `${email.subject} ${email.body}`;
  const hints: string[] = [];
  for (const m of text.matchAll(/\b[\w.-]+\.(pdf|docx?|xlsx?|pptx?)\b/gi)) {
    hints.push(m[0]!);
  }
  for (const m of text.matchAll(/(?:contrato|proposta|aditivo|nf|nota\s*fiscal|anexo|termo|sla)[\w\s-]{0,40}/gi)) {
    hints.push(m[0]!.trim());
  }
  return hints.slice(0, 12);
}

export function rankFiles(files: DriveFileRef[], hints: string[]): DriveFileRef[] {
  const hintNorm = hints.map(normalizeName).filter(Boolean);
  const score = (f: DriveFileRef) => {
    const name = normalizeName(f.name);
    let s = 0;
    for (const h of hintNorm) {
      if (name.includes(h) || h.includes(name)) s += 50;
      else {
        const parts = h.split(' ').filter((p) => p.length > 3);
        s += parts.filter((p) => name.includes(p)).length * 8;
      }
    }
    if (/\b(contrato|proposta|aditivo|nf|nota|sla|termo)\b/i.test(f.name)) s += 15;
    if (f.mimeType === DOC_MIME || f.mimeType === 'application/pdf') s += 5;
    const age = Date.parse(f.modifiedTime);
    if (!Number.isNaN(age)) s += Math.max(0, 10 - (Date.now() - age) / (1000 * 60 * 60 * 24 * 30));
    return s;
  };
  return [...files].sort((a, b) => score(b) - score(a) || b.modifiedTime.localeCompare(a.modifiedTime));
}

export function formatDriveContext(ctx: Omit<DriveContext, 'text'> & { contents: { name: string; body: string }[] }): string {
  if (!ctx.consulted) return ctx.note || '(Drive não consultado)';
  if (!ctx.folderId) return ctx.note || 'Pasta do cliente não encontrada no Drive.';
  const lines = [
    `Pasta: ${ctx.folderName ?? ctx.folderId} (id=${ctx.folderId})`,
    ctx.note ? `Nota: ${ctx.note}` : '',
    'Arquivos considerados:',
    ...(ctx.files.length
      ? ctx.files.map((f) => {
          const flag = f.read ? ' [conteúdo lido]' : '';
          const extra = f.note ? ` — ${f.note}` : '';
          return `- ${f.name} (${f.mimeType}; mod. ${f.modifiedTime.slice(0, 10)})${flag}${extra}\n  ${f.webViewLink}`;
        })
      : ['- nenhum arquivo relevante na pasta']),
  ].filter(Boolean);
  if (ctx.contents.length) {
    lines.push('', 'Trechos lidos:');
    for (const c of ctx.contents) {
      lines.push(`### ${c.name}`, c.body, '');
    }
  }
  return lines.join('\n').trim();
}

class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DriveError';
  }
}

interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export class DriveClient {
  constructor(private getToken: () => Promise<string>) {}

  private async api<T>(path: string, init: { method?: string; raw?: boolean } = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `https://www.googleapis.com/drive/v3${path}`;
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${await this.getToken()}` },
      signal: AbortSignal.timeout(30000),
    });
    if (init.raw) {
      if (!res.ok) throw new DriveError(res.status, `Drive download: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer()) as T;
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { /* keep */ }
      if (res.status === 401 || res.status === 403) {
        throw new DriveError(res.status, 'Sem permissão no Google Drive. Em Configuração: Desconectar e Conectar Gmail de novo (precisa do escopo drive.readonly).');
      }
      throw new DriveError(res.status, `Drive ${path}: ${msg}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async listChildren(parentId: string, opts: { foldersOnly?: boolean; pageSize?: number } = {}): Promise<DriveApiFile[]> {
    const parts = [`'${parentId}' in parents`, 'trashed = false'];
    if (opts.foldersOnly) parts.push(`mimeType = '${FOLDER_MIME}'`);
    const q = new URLSearchParams({
      q: parts.join(' and '),
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken',
      pageSize: String(opts.pageSize ?? 100),
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    });
    const out: DriveApiFile[] = [];
    let pageToken: string | undefined;
    do {
      if (pageToken) q.set('pageToken', pageToken);
      const r = await this.api<{ files?: DriveApiFile[]; nextPageToken?: string }>(`/files?${q}`);
      out.push(...(r.files ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken && out.length < 400);
    return out;
  }

  async resolveClientFolder(args: {
    fromEmail: string;
    org: string | null;
    name: string | null;
  }): Promise<{ id: string; name: string; note: string } | null> {
    const cfg = runtime().drive;
    const rootId = parseFolderId(cfg.rootFolderId);
    if (!rootId) return null;

    const domain = emailDomain(args.fromEmail);
    const map = parseDomainMap(cfg.domainMap);
    if (domain && map[domain]) {
      return { id: map[domain]!, name: domain, note: `pasta fixa pelo domínio ${domain}` };
    }

    const folders = await this.listChildren(rootId, { foldersOnly: true });
    if (!folders.length) return null;

    const mode = cfg.matchMode;
    const needles: string[] = [];
    if (mode === 'email_domain' || mode === 'pipedrive_org') {
      if (domain) {
        needles.push(domain, domain.split('.')[0] ?? domain);
      }
    }
    if (mode === 'company_name' || mode === 'pipedrive_org') {
      if (args.org) needles.push(args.org);
      if (args.name) needles.push(args.name);
    }
    if (mode === 'email_domain' && args.org) needles.push(args.org);

    let best: { file: DriveApiFile; score: number } | null = null;
    for (const f of folders) {
      const score = scoreFolderName(f.name, needles);
      if (!best || score > best.score) best = { file: f, score };
    }
    if (!best || best.score < 40) return null;
    return {
      id: best.file.id,
      name: best.file.name,
      note: `pasta encontrada por ${mode} (score ${best.score})`,
    };
  }

  private async listDocsInFolder(folderId: string): Promise<DriveFileRef[]> {
    const direct = await this.listChildren(folderId, { pageSize: 100 });
    const files: DriveFileRef[] = [];
    const subfolders = direct.filter((f) => f.mimeType === FOLDER_MIME).slice(0, 8);
    const collect = (list: DriveApiFile[]) => {
      for (const f of list) {
        if (f.mimeType === FOLDER_MIME) continue;
        files.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime ?? '',
          webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
          read: false,
        });
      }
    };
    collect(direct);
    for (const sub of subfolders) {
      try {
        collect(await this.listChildren(sub.id, { pageSize: 50 }));
      } catch {
        /* subpasta inacessível: segue */
      }
    }
    return files;
  }

  private async readContent(file: DriveFileRef): Promise<{ text: string; note?: string }> {
    try {
      if (file.mimeType === DOC_MIME) {
        const buf = await this.api<Buffer>(
          `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent('text/plain')}`,
          { raw: true },
        );
        return { text: buf.toString('utf8') };
      }
      if (file.mimeType === SHEET_MIME) {
        const buf = await this.api<Buffer>(
          `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent('text/csv')}`,
          { raw: true },
        );
        return { text: buf.toString('utf8') };
      }
      if (file.mimeType === SLIDE_MIME) {
        const buf = await this.api<Buffer>(
          `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent('text/plain')}`,
          { raw: true },
        );
        return { text: buf.toString('utf8') };
      }
      if (file.mimeType.startsWith('text/') || file.mimeType === 'application/json' || file.mimeType === 'text/csv') {
        const buf = await this.api<Buffer>(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,
          { raw: true },
        );
        return { text: buf.toString('utf8') };
      }
      if (file.mimeType === 'application/pdf') {
        const buf = await this.api<Buffer>(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,
          { raw: true },
        );
        const parsed = await pdfParse(buf);
        const text = (parsed.text ?? '').trim();
        if (!text) return { text: '', note: 'PDF sem texto extraível (possível scan)' };
        return { text };
      }
      return { text: '', note: `tipo ${file.mimeType} sem leitura automática` };
    } catch (e) {
      return { text: '', note: `falha ao ler: ${e instanceof Error ? e.message : e}` };
    }
  }

  async consult(email: IncomingEmail, customer: Customer): Promise<DriveContext> {
    if (!shouldConsultDrive(email)) {
      return empty('Drive não consultado: e-mail não parece falar de documentos.', false);
    }
    const folder = await this.resolveClientFolder({
      fromEmail: email.fromEmail,
      org: customer.org,
      name: customer.name ?? (email.fromName || null),
    });
    if (!folder) {
      return {
        consulted: true,
        folderId: null,
        folderName: null,
        files: [],
        note: 'Pasta do cliente não encontrada sob a pasta-raiz do Drive. Confira o nome da pasta ou o mapa domínio→pasta.',
        text: 'Pasta do cliente não encontrada no Google Drive. Não invente cláusulas nem conteúdo de documentos; diga que vai confirmar internamente.',
      };
    }

    const hints = extractHints(email);
    const all = await this.listDocsInFolder(folder.id);
    const ranked = rankFiles(all, hints).slice(0, MAX_LIST);
    const toRead = ranked.slice(0, MAX_READ);
    const contents: { name: string; body: string }[] = [];
    let total = 0;

    for (const f of toRead) {
      if (total >= MAX_TOTAL_CHARS) break;
      const { text, note } = await this.readContent(f);
      f.read = !!text;
      f.note = note;
      if (!text) continue;
      let body = text.replace(/\r/g, '').trim();
      if (body.length > MAX_CHARS_PER_FILE) {
        body = `${body.slice(0, MAX_CHARS_PER_FILE)}\n…[truncado]`;
      }
      if (total + body.length > MAX_TOTAL_CHARS) {
        body = `${body.slice(0, Math.max(0, MAX_TOTAL_CHARS - total))}\n…[truncado]`;
      }
      contents.push({ name: f.name, body });
      total += body.length;
    }

    const ctx = {
      consulted: true,
      folderId: folder.id,
      folderName: folder.name,
      files: ranked,
      note: folder.note,
      contents,
    };
    return {
      consulted: true,
      folderId: folder.id,
      folderName: folder.name,
      files: ranked,
      note: folder.note,
      text: formatDriveContext(ctx),
    };
  }
}

/** Entrada usada pelo pipeline (respeita settings + heurística). */
export async function consultClientDocs(email: IncomingEmail, customer: Customer): Promise<DriveContext> {
  if (!isDriveConfigured()) {
    return empty('Google Drive não configurado (ative e informe a pasta-raiz dos clientes).', false);
  }
  if (!shouldConsultDrive(email)) {
    return empty('Drive não consultado: e-mail não parece falar de documentos.', false);
  }
  if (!tokenGetter) {
    return empty('Drive: autenticação Google não ligada ao processo.', false);
  }
  try {
    return await new DriveClient(tokenGetter).consult(email, customer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      consulted: true,
      folderId: null,
      folderName: null,
      files: [],
      note: msg,
      text: `Não foi possível consultar o Google Drive agora (${msg}). Não invente conteúdo de documentos; peça confirmação interna.`,
    };
  }
}
