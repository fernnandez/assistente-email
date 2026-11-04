import { createHash, randomBytes } from 'node:crypto';
import { config, redirectUri } from './config';
import type { Store } from './db';
import { runtime } from './settings';
import { composeMailBodies } from './signature';
import type { IncomingEmail } from './types';

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly', // ler e-mails recebidos
  'https://www.googleapis.com/auth/gmail.compose', // criar/editar rascunhos e enviar o rascunho aprovado
  'https://www.googleapis.com/auth/gmail.modify', // arquivar (remover da inbox) sem apagar
];

// ───────── funções puras (testáveis) ─────────

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

const b64urlDecode = (data: string) => Buffer.from(data, 'base64url').toString('utf8');
export const b64urlEncode = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

export function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function collect(part: GmailPart | undefined, mime: string, out: string[]): void {
  if (!part) return;
  if (part.mimeType === mime && part.body?.data && !part.filename) out.push(b64urlDecode(part.body.data));
  for (const p of part.parts ?? []) collect(p, mime, out);
}

/** Corpo em texto: prefere text/plain; cai para text/html sem tags. Remove citações de respostas anteriores. */
export function extractBody(payload: GmailPart | undefined, snippet = ''): string {
  const plain: string[] = [];
  collect(payload, 'text/plain', plain);
  let text = plain.join('\n').trim();
  if (!text) {
    const html: string[] = [];
    collect(payload, 'text/html', html);
    text = stripHtml(html.join('\n'));
  }
  if (!text) text = snippet;
  const lines = text.replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l) => /^(Em .+ escreveu:|On .+ wrote:)\s*$/i.test(l.trim()));
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !l.trim().startsWith('>'));
  return kept.join('\n').trim().slice(0, 4000);
}

export function parseAddress(value: string): { name: string; email: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: value.trim().toLowerCase() };
}

const AUTOMATED_SENDER = /(no-?reply|noreply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i;

export function parseMessage(msg: GmailMessage, selfEmail = ''): IncomingEmail {
  const headers = new Map((msg.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const h = (n: string) => headers.get(n.toLowerCase()) ?? '';
  const from = parseAddress(h('from'));
  const autoSubmitted = h('auto-submitted');
  const automated =
    AUTOMATED_SENDER.test(from.email) ||
    (autoSubmitted !== '' && autoSubmitted.toLowerCase() !== 'no') ||
    /^(bulk|list|junk)$/i.test(h('precedence').trim()) ||
    h('list-unsubscribe') !== '' ||
    h('x-autoreply') !== '' ||
    (selfEmail !== '' && from.email === selfEmail.toLowerCase());
  return {
    id: msg.id,
    threadId: msg.threadId,
    messageIdHeader: h('message-id'),
    references: h('references'),
    fromEmail: from.email,
    fromName: from.name,
    subject: h('subject') || '(sem assunto)',
    body: extractBody(msg.payload, msg.snippet),
    receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
    automated,
  };
}

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

const b64fold = (buf: Buffer | string) => (Buffer.from(buf).toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');

export interface InlinePart {
  cid: string;
  contentType: string;
  buf: Buffer;
}

/** Monta o e-mail (RFC 2822) em base64url. Com html+imagens → multipart (como assinatura do Gmail). */
export function buildRawMessage(a: {
  to: string;
  subject: string;
  body: string;
  html?: string;
  images?: InlinePart[];
  inReplyTo?: string;
  references?: string;
}): string {
  const headers = [
    `To: ${a.to}`,
    `Subject: ${encodeHeader(a.subject)}`,
    ...(a.inReplyTo ? [`In-Reply-To: ${a.inReplyTo}`, `References: ${[a.references, a.inReplyTo].filter(Boolean).join(' ').trim()}`] : []),
    'MIME-Version: 1.0',
  ];

  let mimeBody: string;
  if (!a.html?.trim()) {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    mimeBody = b64fold(a.body);
  } else {
    const images = a.images ?? [];
    const alt = `alt_${randomBytes(8).toString('hex')}`;
    const rel = `rel_${randomBytes(8).toString('hex')}`;
    const plainPart = [
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64fold(a.body),
    ].join('\r\n');
    const htmlPart = [
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64fold(a.html),
    ].join('\r\n');
    let relatedInner = htmlPart;
    if (images.length) {
      const parts = [htmlPart, ...images.map((img) => [
        `Content-Type: ${img.contentType}`,
        'Content-Transfer-Encoding: base64',
        `Content-ID: <${img.cid}>`,
        'Content-Disposition: inline',
        '',
        b64fold(img.buf),
      ].join('\r\n'))];
      relatedInner = [`Content-Type: multipart/related; boundary="${rel}"`, '', ...parts.flatMap((p) => [`--${rel}`, p]), `--${rel}--`].join('\r\n');
    }
    headers.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
    mimeBody = [`--${alt}`, plainPart, `--${alt}`, relatedInner, `--${alt}--`].join('\r\n');
  }

  return b64urlEncode([...headers, '', mimeBody].join('\r\n'));
}

// ───────── cliente (OAuth + API) ─────────

export class GmailError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GmailError';
  }
}

export interface DraftArgs { threadId: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string }

export class GmailClient {
  private access: { token: string; expiresAt: number } | null = null;
  private pending = new Map<string, string>(); // state -> code_verifier

  constructor(private store: Store) {}

  // estado
  hasToken() { return !!this.store.getState('google_refresh_token'); }
  needsReauth() { return this.store.getState('google_needs_reauth') === '1'; }
  isConnected() { return this.hasToken() && !this.needsReauth(); }
  email() { return this.store.getState('google_email'); }

  // OAuth (PKCE, redirecionamento para este servidor local)
  startAuth(port = config.port): { url: string } {
    const { clientId } = runtime(this.store).google;
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('hex');
    this.pending.set(state, verifier);
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri(port), response_type: 'code',
      scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
      code_challenge: challenge, code_challenge_method: 'S256', state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
  }

  async finishAuth(code: string, state: string, port = config.port): Promise<void> {
    const verifier = this.pending.get(state);
    if (!verifier) throw new GmailError(400, 'Autorização inválida ou expirada. Clique em "Conectar Gmail" de novo.');
    this.pending.delete(state);
    const tok = await this.tokenRequest({
      grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri(port),
    });
    if (!tok.refresh_token) throw new GmailError(400, 'O Google não devolveu refresh token. Remova o acesso do app em myaccount.google.com/permissions e tente de novo.');
    this.store.setState('google_refresh_token', tok.refresh_token);
    this.store.deleteState('google_needs_reauth');
    this.store.deleteState('history_id'); // recomeça só de e-mails novos a partir de agora
    this.access = { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000 };
    const profile = await this.api<{ emailAddress: string }>('/profile');
    this.store.setState('google_email', profile.emailAddress.toLowerCase());
  }

  disconnect(): void {
    for (const k of ['google_refresh_token', 'google_needs_reauth', 'google_email', 'history_id']) this.store.deleteState(k);
    this.access = null;
  }

  private async tokenRequest(params: Record<string, string>) {
    const { clientId, clientSecret } = runtime(this.store).google;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
      signal: AbortSignal.timeout(20000),
    });
    const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; error?: string; error_description?: string };
    if (!res.ok) {
      if (json.error === 'invalid_grant') this.store.setState('google_needs_reauth', '1');
      throw new GmailError(res.status, `Google OAuth: ${json.error_description ?? json.error ?? res.status}`);
    }
    return json;
  }

  private async accessToken(): Promise<string> {
    if (this.access && Date.now() < this.access.expiresAt) return this.access.token;
    const refresh = this.store.getState('google_refresh_token');
    if (!refresh) throw new GmailError(401, 'Gmail não conectado.');
    const tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
    this.access = { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000 };
    return this.access.token;
  }

  private async api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { /* mantém o texto */ }
      throw new GmailError(res.status, `Gmail ${path}: ${msg}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // leitura incremental pelo histórico (só e-mails novos na caixa de entrada)
  async pollNewMessageIds(): Promise<{ ids: string[]; nextHistoryId: string }> {
    const profile = await this.api<{ emailAddress: string; historyId: string }>('/profile');
    this.store.setState('google_email', profile.emailAddress.toLowerCase());
    const start = this.store.getState('history_id');
    if (!start) {
      this.store.setState('history_id', profile.historyId); // primeira vez: ignora o que já está na caixa
      return { ids: [], nextHistoryId: profile.historyId };
    }
    const ids = new Set<string>();
    let next = start;
    let pageToken: string | undefined;
    try {
      do {
        const q = new URLSearchParams({ startHistoryId: start, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '100', ...(pageToken ? { pageToken } : {}) });
        const r = await this.api<{ history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId?: string; nextPageToken?: string }>(`/history?${q}`);
        for (const h of r.history ?? []) for (const m of h.messagesAdded ?? []) if (!m.message.labelIds || m.message.labelIds.includes('INBOX')) ids.add(m.message.id);
        if (r.historyId) next = r.historyId;
        pageToken = r.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (e instanceof GmailError && e.status === 404) {
        // histórico expirado (app ficou muito tempo fechado): recomeça a partir de agora
        return { ids: [], nextHistoryId: profile.historyId };
      }
      throw e;
    }
    return { ids: [...ids], nextHistoryId: next };
  }

  commitHistory(id: string) { this.store.setState('history_id', id); }

  async getEmail(id: string): Promise<IncomingEmail> {
    const msg = await this.api<GmailMessage>(`/messages/${id}?format=full`);
    return parseMessage(msg, this.email() ?? '');
  }

  /**
   * Lista IDs recentes da inbox (para sync manual do que chegou antes do app).
   * Não altera history_id — o poll incremental continua independente.
   */
  async listRecentInboxIds(opts: { newerThanDays?: number; max?: number; unreadOnly?: boolean } = {}): Promise<string[]> {
    const days = opts.newerThanDays ?? 7;
    const max = Math.min(Math.max(opts.max ?? 30, 1), 100);
    const unreadOnly = opts.unreadOnly !== false;
    const parts = ['in:inbox', `newer_than:${days}d`];
    if (unreadOnly) parts.push('is:unread');
    const q = new URLSearchParams({ q: parts.join(' '), maxResults: String(max) });
    const r = await this.api<{ messages?: { id: string }[] }>(`/messages?${q}`);
    return (r.messages ?? []).map((m) => m.id);
  }

  /**
   * Garante um marcador do usuário (ex.: "Respondido") e devolve o id.
   * Cache em state para não listar labels a cada clique.
   */
  async ensureUserLabel(name: string): Promise<string> {
    const key = `gmail_label:${name.toLowerCase()}`;
    const cached = this.store.getState(key);
    if (cached) return cached;
    const listed = await this.api<{ labels?: { id: string; name: string; type?: string }[] }>('/labels');
    const existing = (listed.labels ?? []).find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      this.store.setState(key, existing.id);
      return existing.id;
    }
    const created = await this.api<{ id: string }>('/labels', {
      method: 'POST',
      body: {
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    this.store.setState(key, created.id);
    return created.id;
  }

  /**
   * Como o Arquivar do Gmail: tira da Caixa de entrada (some da inbox).
   * Continua em "Todos os e-mails". Opcionalmente aplica um marcador (ex.: Respondido).
   * Opera no fio inteiro para a conversa sair da inbox de uma vez.
   */
  async archiveMessage(messageId: string, opts: { threadId?: string; labelName?: string } = {}): Promise<void> {
    const labelName = (opts.labelName ?? 'Arquivados').trim();
    const addLabelIds: string[] = [];
    if (labelName) {
      try {
        addLabelIds.push(await this.ensureUserLabel(labelName));
      } catch (e) {
        if (e instanceof GmailError && (e.status === 403 || e.status === 401)) {
          throw new GmailError(e.status, 'Sem permissão para arquivar no Gmail. Em Configuração: Desconectar e Conectar Gmail de novo (precisa do escopo gmail.modify).');
        }
        throw e;
      }
    }
    const body = { removeLabelIds: ['INBOX'], addLabelIds };
    try {
      if (opts.threadId) {
        await this.api(`/threads/${opts.threadId}/modify`, { method: 'POST', body });
      } else {
        await this.api(`/messages/${messageId}/modify`, { method: 'POST', body });
      }
    } catch (e) {
      if (e instanceof GmailError && (e.status === 403 || e.status === 401)) {
        throw new GmailError(e.status, 'Sem permissão para arquivar no Gmail. Em Configuração: Desconectar e Conectar Gmail de novo (precisa do escopo gmail.modify).');
      }
      throw e;
    }
  }

  // rascunhos
  private draftBody(a: DraftArgs) {
    const composed = composeMailBodies(a.body, runtime(this.store).company);
    return {
      message: {
        threadId: a.threadId,
        raw: buildRawMessage({
          to: a.to,
          subject: a.subject,
          body: composed.text,
          html: composed.html,
          images: composed.images,
          inReplyTo: a.inReplyTo,
          references: a.references,
        }),
      },
    };
  }
  async createDraft(a: DraftArgs): Promise<string> {
    return (await this.api<{ id: string }>('/drafts', { method: 'POST', body: this.draftBody(a) })).id;
  }
  async updateDraft(id: string, a: DraftArgs): Promise<void> {
    await this.api(`/drafts/${id}`, { method: 'PUT', body: this.draftBody(a) });
  }
  async sendDraft(id: string): Promise<void> {
    await this.api('/drafts/send', { method: 'POST', body: { id } });
  }
  async deleteDraft(id: string): Promise<void> {
    await this.api(`/drafts/${id}`, { method: 'DELETE' });
  }
}

/** Contrato mínimo usado pelo pipeline/servidor (facilita testes com um Gmail falso). */
export type GmailLike = Pick<GmailClient, 'createDraft' | 'updateDraft' | 'sendDraft' | 'deleteDraft'>;
