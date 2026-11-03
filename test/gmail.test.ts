import { describe, expect, it } from 'vitest';
import { buildRawMessage, extractBody, parseAddress, parseMessage, stripHtml, type GmailMessage } from '../src/gmail';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const msg = (over: Partial<GmailMessage> & { headers?: Record<string, string>; plain?: string; html?: string } = {}): GmailMessage => {
  const headers = { From: 'Maria Souza <Maria@Exemplo.com>', Subject: 'Dúvida', 'Message-ID': '<m@x>', ...over.headers };
  const parts = [];
  if (over.plain !== undefined) parts.push({ mimeType: 'text/plain', body: { data: b64(over.plain) } });
  if (over.html !== undefined) parts.push({ mimeType: 'text/html', body: { data: b64(over.html) } });
  return {
    id: 'm1', threadId: 't1', internalDate: '1793728800000',
    payload: { mimeType: 'multipart/alternative', headers: Object.entries(headers).map(([name, value]) => ({ name, value })), parts },
  };
};

describe('parseAddress', () => {
  it('extrai nome e e-mail em minúsculas', () => {
    expect(parseAddress('"Maria Souza" <Maria@Exemplo.com>')).toEqual({ name: 'Maria Souza', email: 'maria@exemplo.com' });
    expect(parseAddress('joao@x.com')).toEqual({ name: '', email: 'joao@x.com' });
  });
});

describe('parseMessage', () => {
  it('lê remetente, assunto, corpo text/plain e cabeçalhos de encadeamento', () => {
    const e = parseMessage(msg({ plain: 'Olá, qual o prazo?' }));
    expect(e).toMatchObject({ fromEmail: 'maria@exemplo.com', fromName: 'Maria Souza', subject: 'Dúvida', body: 'Olá, qual o prazo?', messageIdHeader: '<m@x>', automated: false });
  });
  it('cai para o HTML quando não há texto puro', () => {
    expect(parseMessage(msg({ html: '<p>Oi<br>tudo bem?</p><style>p{}</style>' })).body).toBe('Oi\ntudo bem?');
  });
  it('remove citações de respostas anteriores', () => {
    const body = extractBody(msg({ plain: 'Obrigada!\n\nEm seg., 2 de nov. de 2026 escreveu:\n> texto antigo\n> mais' }).payload);
    expect(body).toBe('Obrigada!');
  });
  it('marca como automáticos: no-reply, listas, respostas automáticas e o próprio e-mail', () => {
    expect(parseMessage(msg({ plain: 'x', headers: { From: 'noreply@loja.com' } })).automated).toBe(true);
    expect(parseMessage(msg({ plain: 'x', headers: { 'List-Unsubscribe': '<mailto:x>' } })).automated).toBe(true);
    expect(parseMessage(msg({ plain: 'x', headers: { 'Auto-Submitted': 'auto-replied' } })).automated).toBe(true);
    expect(parseMessage(msg({ plain: 'x', headers: { Precedence: 'bulk' } })).automated).toBe(true);
    expect(parseMessage(msg({ plain: 'x', headers: { 'Auto-Submitted': 'no' } })).automated).toBe(false);
    expect(parseMessage(msg({ plain: 'x' }), 'maria@exemplo.com').automated).toBe(true);
  });
  it('usa o snippet se não houver corpo', () => {
    expect(parseMessage({ ...msg(), snippet: 'resumo' }).body).toBe('resumo');
  });
});

describe('stripHtml', () => {
  it('remove tags e decodifica entidades', () => {
    expect(stripHtml('<div>A &amp; B&nbsp;C</div><script>x()</script>')).toBe('A & B C');
  });
});

describe('buildRawMessage', () => {
  const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
  it('monta um e-mail encadeado, com assunto e corpo em UTF-8', () => {
    const text = decode(buildRawMessage({ to: 'maria@exemplo.com', subject: 'Re: Dúvida sobre prazo', body: 'Olá, açúcar e café!', inReplyTo: '<m@x>', references: '<a@x>' }));
    expect(text).toContain('To: maria@exemplo.com');
    expect(text).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(text).toContain('In-Reply-To: <m@x>');
    expect(text).toContain('References: <a@x> <m@x>');
    const bodyB64 = text.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(bodyB64, 'base64').toString('utf8')).toBe('Olá, açúcar e café!');
  });
  it('mantém assunto ASCII sem codificar e dispensa cabeçalhos de resposta', () => {
    const text = decode(buildRawMessage({ to: 'a@b.com', subject: 'Re: Hello', body: 'x' }));
    expect(text).toContain('Subject: Re: Hello');
    expect(text).not.toContain('In-Reply-To');
  });
});
