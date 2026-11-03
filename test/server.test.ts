import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/db';
import { buildServer } from '../src/server';
import { handleIncoming } from '../src/pipeline';
import { deps, email, fakeGmail, okModel } from './helpers';
import type { GmailClient } from '../src/gmail';

const H = { host: '127.0.0.1:3210', 'x-requested-with': 'assistente-email', 'content-type': 'application/json' };

function setup() {
  const store = new Store(':memory:');
  const g = fakeGmail();
  const gmail = Object.assign(g, { isConnected: () => true, needsReauth: () => false, email: () => 'ela@empresa.com', disconnect: () => {} }) as unknown as GmailClient;
  const poller = { tick: async () => {}, stop: () => {} };
  const d = deps({ model: async () => okModel({ reply_body: 'Nova resposta gerada.' }) });
  const app = buildServer({ store, gmail, poller, deps: d, port: 3210 });
  return { store, g, app, d };
}

describe('segurança do servidor local', () => {
  it('recusa Host desconhecido (DNS rebinding)', async () => {
    const { app } = setup();
    const r = await app.inject({ method: 'GET', url: '/api/status', headers: { host: 'evil.example.com' } });
    expect(r.statusCode).toBe(403);
  });
  it('recusa escrita sem o cabeçalho próprio ou com Origin de outro site (CSRF)', async () => {
    const { app } = setup();
    const noHeader = await app.inject({ method: 'POST', url: '/api/poll', headers: { host: H.host, 'content-type': 'application/json' }, payload: '{}' });
    expect(noHeader.statusCode).toBe(403);
    const badOrigin = await app.inject({ method: 'POST', url: '/api/poll', headers: { ...H, origin: 'https://evil.example.com' }, payload: '{}' });
    expect(badOrigin.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/poll', headers: { ...H, origin: 'http://127.0.0.1:3210' }, payload: '{}' });
    expect(ok.statusCode).toBe(200);
  });
});

describe('API da fila', () => {
  let s: ReturnType<typeof setup>;
  let id: number;
  beforeEach(async () => {
    s = setup();
    id = (await handleIncoming(email(), { store: s.store, gmail: s.g, deps: s.d }))!.id;
    s.g.calls.length = 0;
  });

  it('lista pendentes e mostra o estado', async () => {
    const list = await s.app.inject({ method: 'GET', url: '/api/items?status=pending', headers: H });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].customer.known).toBe(true);
    const st = (await s.app.inject({ method: 'GET', url: '/api/status', headers: H })).json();
    expect(st.gmail).toMatchObject({ connected: true, email: 'ela@empresa.com' });
    expect(st.counts.pending).toBe(1);
  });

  it('enviar: atualiza o rascunho com o texto editado e envia', async () => {
    const r = await s.app.inject({ method: 'POST', url: `/api/items/${id}/send`, headers: H, payload: { reply_body: 'Texto editado por mim.' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'sent', reply_body: 'Texto editado por mim.' });
    expect(s.g.calls.map((c) => c.fn)).toEqual(['updateDraft', 'sendDraft']);
    expect((await s.app.inject({ method: 'POST', url: `/api/items/${id}/send`, headers: H, payload: {} })).statusCode).toBe(409);
  });

  it('descartar: apaga o rascunho e tira da fila', async () => {
    const r = await s.app.inject({ method: 'POST', url: `/api/items/${id}/discard`, headers: H, payload: {} });
    expect(r.json().status).toBe('discarded');
    expect(s.g.calls.map((c) => c.fn)).toEqual(['deleteDraft']);
    expect((await s.app.inject({ method: 'GET', url: '/api/items?status=pending', headers: H })).json()).toHaveLength(0);
  });

  it('refazer: gera de novo com a instrução e atualiza o rascunho', async () => {
    const r = await s.app.inject({ method: 'POST', url: `/api/items/${id}/regenerate`, headers: H, payload: { instruction: 'mais curto' } });
    expect(r.json().reply_body).toContain('Nova resposta gerada.');
    expect(s.g.calls.map((c) => c.fn)).toEqual(['updateDraft']);
  });

  it('salvar edição sem enviar', async () => {
    const r = await s.app.inject({ method: 'PUT', url: `/api/items/${id}/draft`, headers: H, payload: { reply_body: 'Rascunho salvo.' } });
    expect(r.json()).toMatchObject({ status: 'pending', reply_body: 'Rascunho salvo.' });
    expect(s.g.calls.map((c) => c.fn)).toEqual(['updateDraft']);
  });

  it('item inexistente e corpo inválido', async () => {
    expect((await s.app.inject({ method: 'GET', url: '/api/items/999', headers: H })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'PUT', url: `/api/items/${id}/draft`, headers: H, payload: { reply_body: '' } })).statusCode).toBeGreaterThanOrEqual(400);
  });
});
