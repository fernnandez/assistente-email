import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/db';
import { buildServer } from '../src/server';
import { handleIncoming } from '../src/pipeline';
import { syncPrevious } from '../src/poller';
import { deps, email, fakeGmail, okModel } from './helpers';
import type { GmailClient } from '../src/gmail';

const H = { host: '127.0.0.1:3210', 'x-requested-with': 'assistente-email', 'content-type': 'application/json' };

function setup() {
  const store = new Store(':memory:');
  const g = fakeGmail();
  const d = deps({ model: async () => okModel({ reply_body: 'Nova resposta gerada.' }) });
  const gmail = Object.assign(g, {
    isConnected: () => true,
    needsReauth: () => false,
    email: () => 'ela@empresa.com',
    disconnect: () => {},
  }) as unknown as GmailClient;
  const poller = {
    tick: async () => {},
    stop: () => {},
    syncPrevious: () => syncPrevious({ store, gmail, deps: d }),
    recheckAnswered: async () => 0,
  };
  const app = buildServer({ store, gmail, poller, deps: d, port: 3210 });
  return { store, g, app, d, gmail };
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
    expect(s.g.calls.map((c) => c.fn)).toEqual(['updateDraft', 'sendDraft', 'archiveMessage']);
    expect((await s.app.inject({ method: 'POST', url: `/api/items/${id}/send`, headers: H, payload: {} })).statusCode).toBe(409);
  });

  it('descartar: apaga o rascunho e tira da fila', async () => {
    const r = await s.app.inject({ method: 'POST', url: `/api/items/${id}/discard`, headers: H, payload: {} });
    expect(r.json().status).toBe('discarded');
    expect(s.g.calls.map((c) => c.fn)).toEqual(['deleteDraft']);
    expect((await s.app.inject({ method: 'GET', url: '/api/items?status=pending', headers: H })).json()).toHaveLength(0);
  });

  it('arquivar: apaga rascunho, arquiva no Gmail e tira da fila', async () => {
    const r = await s.app.inject({ method: 'POST', url: `/api/items/${id}/archive`, headers: H, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('archived');
    expect(s.g.calls.map((c) => c.fn)).toEqual(['deleteDraft', 'archiveMessage']);
    const arch = s.g.calls.find((c) => c.fn === 'archiveMessage')!;
    expect(arch.args[0]).toBe('m1');
    expect(arch.args[1]).toMatchObject({ threadId: 't1', labelName: 'Arquivados' });
    expect((await s.app.inject({ method: 'GET', url: '/api/items?status=pending', headers: H })).json()).toHaveLength(0);
    expect(s.store.counts().archived).toBe(1);
  });

  it('já respondi: não envia rascunho, marca Respondidos e sai da inbox', async () => {
    const r = await s.app.inject({ method: 'POST', url: `/api/items/${id}/mark-replied`, headers: H, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'sent', draft_id: null });
    expect(r.json().internal_notes).toMatch(/Marcado como respondido/);
    expect(s.g.calls.map((c) => c.fn)).toEqual(['deleteDraft', 'archiveMessage']);
    expect(s.g.calls.find((c) => c.fn === 'archiveMessage')!.args[1]).toMatchObject({ labelName: 'Respondidos' });
    expect((await s.app.inject({ method: 'GET', url: '/api/items?status=pending', headers: H })).json()).toHaveLength(0);
    expect(s.store.counts().sent).toBe(1);
    expect((await s.app.inject({ method: 'POST', url: `/api/items/${id}/mark-replied`, headers: H, payload: {} })).statusCode).toBe(409);
  });

  it('enviar: depois do envio também tira da inbox no Gmail', async () => {
    const r = await s.app.inject({ method: 'POST', url: `/api/items/${id}/send`, headers: H, payload: { reply_body: 'Resposta ok.' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('sent');
    expect(s.g.calls.map((c) => c.fn)).toEqual(['updateDraft', 'sendDraft', 'archiveMessage']);
    expect(s.g.calls.find((c) => c.fn === 'archiveMessage')!.args[1]).toMatchObject({ labelName: 'Respondidos' });
  });

  it('refazer: gera de novo com a instrução e atualiza o rascunho', async () => {
    const r = await s.app.inject({ method: 'POST', url: `/api/items/${id}/regenerate`, headers: H, payload: { instruction: 'mais curto' } });
    expect(r.json().reply_body).toContain('Nova resposta gerada.');
    expect(s.g.calls.map((c) => c.fn)).toEqual(['updateDraft']);
  });

  it('refazer: o modelo recebe o texto atual da tela (com edições não salvas) junto com a instrução', async () => {
    let seen = '';
    const s2 = setup();
    const gmail2 = s2.g;
    const d2 = deps({ model: async (_sys, user) => { seen = user; return okModel({ reply_body: 'Versão curta.' }); } });
    const app2 = buildServer({ store: s2.store, gmail: s2.gmail, poller: { tick: async () => {}, stop: () => {}, syncPrevious: async () => ({ listed: 0, processed: 0, skipped: 0, errors: [] }), recheckAnswered: async () => 0 }, deps: d2, port: 3210 });
    const item = (await handleIncoming(email({ id: 'r1' }), { store: s2.store, gmail: gmail2, deps: d2 }))!;
    const r = await app2.inject({ method: 'POST', url: `/api/items/${item.id}/regenerate`, headers: H, payload: { instruction: 'mais curto', current_draft: 'EDITADO NA TELA' } });
    expect(r.json().reply_body).toContain('Versão curta.');
    expect(seen).toContain('EDITADO NA TELA');
    expect(seen).toContain('mais curto');
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

describe('API sync de anteriores', () => {
  it('processa IDs novos e pula os já existentes', async () => {
    const s = setup();
    await handleIncoming(email({ id: 'já-tem' }), { store: s.store, gmail: s.g, deps: s.d });
    s.g.calls.length = 0;

    s.g.listRecentInboxIds = async () => {
      s.g.calls.push({ fn: 'listRecentInboxIds', args: [] });
      return ['já-tem', 'novo-1'];
    };
    s.g.getEmail = async (...args: unknown[]) => {
      const id = String(args[0]);
      s.g.calls.push({ fn: 'getEmail', args: [id] });
      return email({ id, subject: `Assunto ${id}` });
    };

    const r = await s.app.inject({ method: 'POST', url: '/api/sync', headers: H, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ listed: 2, processed: 1, skipped: 1 });
    expect(s.store.hasMessage('novo-1')).toBe(true);
    expect(s.g.calls.map((c) => c.fn)).toContain('listRecentInboxIds');
    expect(s.g.calls.filter((c) => c.fn === 'getEmail').map((c) => c.args[0])).toEqual(['novo-1']);
  });
});
