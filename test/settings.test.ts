import { describe, expect, it } from 'vitest';
import { Store } from '../src/db';
import { buildServer } from '../src/server';
import { bindSettings, configProblems, publicSettings, runtime, saveSettings } from '../src/settings';
import type { GmailClient } from '../src/gmail';

const H = { host: '127.0.0.1:3210', 'x-requested-with': 'assistente-email', 'content-type': 'application/json' };

function appWithStore() {
  const store = new Store(':memory:');
  const gmail = {
    isConnected: () => false, needsReauth: () => false, email: () => null, disconnect: () => {},
    startAuth: () => ({ url: 'https://example.com' }),
  } as unknown as GmailClient;
  const app = buildServer({
    store,
    gmail,
    poller: {
      tick: async () => {},
      stop: () => {},
      syncPrevious: async () => ({ listed: 0, processed: 0, skipped: 0, errors: [] }),
    },
    port: 3210,
  });
  return { store, app };
}

describe('settings (merge UI + env)', () => {
  it('UI sobrescreve env; secret omitido no GET', () => {
    const store = new Store(':memory:');
    bindSettings(store);
    saveSettings(store, {
      google: { clientId: 'id-ui', clientSecret: 'sec-ui' },
      llm: { apiKey: 'sk-ui', baseUrl: 'https://ai-gateway.vercel.sh/v1', model: 'openai/gpt-4.1' },
    });
    const r = runtime(store);
    expect(r.google.clientId).toBe('id-ui');
    expect(r.google.clientSecret).toBe('sec-ui');
    expect(r.llm.apiKey).toBe('sk-ui');
    const pub = publicSettings(store);
    expect(pub.google.clientId).toBe('id-ui');
    expect(pub.google.clientSecretConfigured).toBe(true);
    expect(pub.llm.apiKeyConfigured).toBe(true);
    expect(configProblems(store).some((p) => p.includes('Google'))).toBe(false);
  });

  it('PUT sem secret mantém o valor salvo', () => {
    const store = new Store(':memory:');
    saveSettings(store, { llm: { apiKey: 'sk-1' } });
    saveSettings(store, { llm: { model: 'gpt-x' } });
    expect(runtime(store).llm.apiKey).toBe('sk-1');
    expect(runtime(store).llm.model).toBe('gpt-x');
  });
});

describe('API settings e docs', () => {
  it('GET/PUT /api/settings', async () => {
    const { app } = appWithStore();
    const put = await app.inject({
      method: 'PUT', url: '/api/settings', headers: H,
      payload: { google: { clientId: 'cid', clientSecret: 'csec' }, llm: { apiKey: 'sk', model: 'm1' } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      google: { clientId: 'cid', clientSecretConfigured: true },
      llm: { apiKeyConfigured: true, model: 'm1' },
    });
    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: H });
    expect(get.json().google.clientSecretConfigured).toBe(true);
    expect(JSON.stringify(get.json())).not.toContain('csec');
  });

  it('lista e lê guia + CRUD de política', async () => {
    const { app } = appWithStore();
    const name = `vitest-${Date.now()}.md`;
    try {
      const docs = await app.inject({ method: 'GET', url: '/api/docs', headers: H });
      expect(docs.json().files).toContain('CONFIGURAR-GOOGLE.md');
      const doc = await app.inject({ method: 'GET', url: '/api/docs/CONFIGURAR-GOOGLE.md', headers: H });
      expect(doc.statusCode).toBe(200);
      expect(doc.json().content).toContain('Google');

      const created = await app.inject({
        method: 'POST', url: '/api/policies', headers: H,
        payload: { name, content: '# Olá\n' },
      });
      expect(created.statusCode).toBe(200);
      const saved = await app.inject({
        method: 'PUT', url: `/api/policies/${name}`, headers: H,
        payload: { content: '# Atualizado\n' },
      });
      expect(saved.statusCode).toBe(200);
      const read = await app.inject({ method: 'GET', url: `/api/policies/${name}`, headers: H });
      expect(read.json().content).toBe('# Atualizado\n');
    } finally {
      await app.inject({ method: 'DELETE', url: `/api/policies/${name}`, headers: H, payload: {} });
    }
  });

  it('bloqueia path traversal em políticas', async () => {
    const { app } = appWithStore();
    const r = await app.inject({ method: 'GET', url: '/api/policies/%2e%2e%2fpackage.json', headers: H });
    expect(r.statusCode).toBe(400);
  });
});
