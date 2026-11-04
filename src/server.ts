import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config';
import type { Store } from './db';
import {
  createPolicy, deletePolicy, DocsError, listDocs, listPolicies, readDoc, readPolicy, seedExamplePolicies, writePolicy,
} from './docsfiles';
import { GmailError, type GmailClient } from './gmail';
import { buildReply, defaultDeps, draftArgsFor, emailFromItem, type PipelineDeps } from './pipeline';
import { bus, type Poller } from './poller';
import { loadPolicies } from './policies';
import { bindSettings, configProblems, publicSettings, runtime, saveSettings, settingsPatchSchema, setupStatus } from './settings';
import { readAsset, saveAsset } from './signature';
import type { Item } from './types';

export interface ServerCtx {
  store: Store;
  gmail: GmailClient;
  poller: Poller;
  deps?: PipelineDeps;
  port?: number;
}

const view = (i: Item) => ({ ...i, customer: i.customer_json ? JSON.parse(i.customer_json) : null, customer_json: undefined });

export function buildServer(ctx: ServerCtx): FastifyInstance {
  const { store, gmail } = ctx;
  bindSettings(store);
  const port = ctx.port ?? config.port;
  const deps = ctx.deps ?? defaultDeps;
  const app = Fastify({ logger: false });

  // O app só atende o próprio computador. Mesmo assim, qualquer site aberto no navegador poderia tentar
  // chamar localhost (CSRF / DNS rebinding): por isso validamos Host, Origin e um cabeçalho próprio nas escritas.
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  app.addHook('onRequest', async (req, reply) => {
    if (!hosts.has(req.headers.host ?? '')) return reply.code(403).send({ error: 'host não permitido' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers.origin && !origins.has(req.headers.origin)) return reply.code(403).send({ error: 'origem não permitida' });
      if (req.headers['x-requested-with'] !== 'assistente-email') return reply.code(403).send({ error: 'cabeçalho obrigatório ausente' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DocsError) return reply.code(err.statusCode).send({ error: err.message });
    const status = err instanceof GmailError && err.status >= 400 && err.status < 600 ? (err.status === 401 ? 401 : 502) : (err as { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({ error: err instanceof Error ? err.message : String(err) });
  });

  // ── estado
  app.get('/api/status', async () => {
    const pol = loadPolicies();
    const r = runtime(store);
    const connected = gmail.isConnected();
    return {
      gmail: { connected, needsReauth: gmail.needsReauth(), email: gmail.email() },
      problems: configProblems(store),
      policies: { files: pol.files, chars: pol.chars, truncated: pol.truncated },
      lastPollAt: store.getState('last_poll_at'),
      lastError: store.getState('last_error'),
      pollSeconds: config.pollSeconds,
      counts: store.counts(),
      model: r.llm.model,
      setup: setupStatus({ store, gmailConnected: connected, policiesCount: pol.files.length }),
    };
  });

  // ── configuração (Google, LLM, Pipedrive) — salva no SQLite; .env é fallback
  app.get('/api/settings', async () => publicSettings(store));
  app.put('/api/settings', async (req) => {
    const patch = settingsPatchSchema.parse(req.body ?? {});
    const out = saveSettings(store, patch);
    bus.emit('change', { type: 'status' });
    return out;
  });

  // ── imagens da assinatura (preview local + CID no envio)
  app.get('/api/signature-assets/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const { buf, contentType } = readAsset(name);
    return reply.type(contentType).header('Cache-Control', 'private, max-age=86400').send(buf);
  });
  app.post('/api/signature-assets', async (req) => {
    const body = z.object({
      filename: z.string().max(200).optional(),
      contentType: z.string().max(100).optional(),
      dataBase64: z.string().min(1),
    }).parse(req.body ?? {});
    return saveAsset(body);
  });

  // ── guias (docs/*.md, só leitura)
  app.get('/api/docs', async () => ({ files: listDocs() }));
  app.get('/api/docs/:name', async (req) => readDoc((req.params as { name: string }).name));

  // ── políticas (policies/*.md, CRUD)
  app.get('/api/policies', async () => ({ files: listPolicies() }));
  app.get('/api/policies/:name', async (req) => readPolicy((req.params as { name: string }).name));
  app.put('/api/policies/:name', async (req) => {
    const name = (req.params as { name: string }).name;
    const { content } = z.object({ content: z.string() }).parse(req.body ?? {});
    const out = writePolicy(name, content);
    bus.emit('change', { type: 'status' });
    return out;
  });
  app.post('/api/policies', async (req) => {
    const { name, content } = z.object({ name: z.string(), content: z.string().optional() }).parse(req.body ?? {});
    const out = createPolicy(name, content ?? '');
    bus.emit('change', { type: 'status' });
    return out;
  });
  app.post('/api/policies/seed-examples', async () => {
    const out = seedExamplePolicies();
    bus.emit('change', { type: 'status' });
    return out;
  });
  app.delete('/api/policies/:name', async (req) => {
    deletePolicy((req.params as { name: string }).name);
    bus.emit('change', { type: 'status' });
    return { ok: true };
  });

  // ── login com o Google
  app.get('/auth/google', async (_req, reply) => {
    const g = runtime(store).google;
    if (!g.clientId || !g.clientSecret) {
      return reply.code(400).send({ error: 'Configure o Google na aba Configuração (Client ID e Client Secret).' });
    }
    return reply.redirect(gmail.startAuth(port).url);
  });
  app.get('/oauth/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error || !q.code || !q.state) return reply.code(400).type('text/html').send(`<p>Autorização não concluída (${q.error ?? 'sem código'}). <a href="/">Voltar</a></p>`);
    await gmail.finishAuth(q.code, q.state, port);
    void ctx.poller.tick();
    bus.emit('change', { type: 'status' });
    return reply.redirect('/');
  });
  app.post('/api/auth/disconnect', async () => {
    gmail.disconnect();
    bus.emit('change', { type: 'status' });
    return { ok: true };
  });

  // ── fila
  app.get('/api/items', async (req) => {
    const s = (req.query as { status?: string }).status;
    const status = s === 'pending' || s === 'sent' || s === 'discarded' || s === 'archived' || s === 'error' ? s : 'visible';
    return store.listItems(status).map(view);
  });
  const idParam = z.object({ id: z.coerce.number().int().positive() });
  const getItem = (params: unknown): Item => {
    const { id } = idParam.parse(params);
    const item = store.getItem(id);
    if (!item) throw Object.assign(new Error('Item não encontrado'), { statusCode: 404 });
    return item;
  };
  app.get('/api/items/:id', async (req) => view(getItem(req.params)));

  const editBody = z.object({ reply_body: z.string().min(1).max(20000), reply_subject: z.string().max(500).optional() });

  /** Mantém o rascunho do Gmail igual ao texto da tela; se ele foi apagado no Gmail, recria. */
  async function syncDraft(item: Item, subject: string | null, body: string): Promise<string> {
    const args = draftArgsFor(item, subject, body);
    if (item.draft_id) {
      try {
        await gmail.updateDraft(item.draft_id, args);
        return item.draft_id;
      } catch (e) {
        if (!(e instanceof GmailError && e.status === 404)) throw e;
      }
    }
    return gmail.createDraft(args);
  }

  app.put('/api/items/:id/draft', async (req) => {
    const item = getItem(req.params);
    if (item.status !== 'pending') throw Object.assign(new Error('Este item não está mais pendente.'), { statusCode: 409 });
    const b = editBody.parse(req.body);
    const subject = b.reply_subject ?? item.reply_subject;
    const draftId = await syncDraft(item, subject, b.reply_body);
    return view(store.updateItem(item.id, { reply_body: b.reply_body, reply_subject: subject, draft_id: draftId }));
  });

  app.post('/api/items/:id/send', async (req) => {
    const item = getItem(req.params);
    if (item.status !== 'pending') throw Object.assign(new Error('Este item não está mais pendente.'), { statusCode: 409 });
    const b = editBody.partial().parse(req.body ?? {});
    const body = b.reply_body ?? item.reply_body ?? '';
    if (!body.trim()) throw Object.assign(new Error('Resposta vazia.'), { statusCode: 400 });
    const draftId = await syncDraft(item, b.reply_subject ?? item.reply_subject, body);
    await gmail.sendDraft(draftId);
    const out = store.updateItem(item.id, { status: 'sent', reply_body: body, draft_id: draftId });
    bus.emit('change', { type: 'item', id: item.id, status: 'sent' });
    return view(out);
  });

  app.post('/api/items/:id/discard', async (req) => {
    const item = getItem(req.params);
    if (item.draft_id) {
      try { await gmail.deleteDraft(item.draft_id); } catch (e) { if (!(e instanceof GmailError && e.status === 404)) throw e; }
    }
    const out = store.updateItem(item.id, { status: 'discarded', draft_id: null });
    bus.emit('change', { type: 'item', id: item.id, status: 'discarded' });
    return view(out);
  });

  app.post('/api/items/:id/archive', async (req) => {
    const item = getItem(req.params);
    if (item.status !== 'pending' && item.status !== 'error') {
      throw Object.assign(new Error('Só dá para arquivar itens pendentes ou com erro.'), { statusCode: 409 });
    }
    if (item.draft_id) {
      try { await gmail.deleteDraft(item.draft_id); } catch (e) { if (!(e instanceof GmailError && e.status === 404)) throw e; }
    }
    try {
      await gmail.archiveMessage(item.gmail_message_id);
    } catch (e) {
      if (!(e instanceof GmailError && e.status === 404)) throw e;
    }
    const out = store.updateItem(item.id, { status: 'archived', draft_id: null });
    bus.emit('change', { type: 'item', id: item.id, status: 'archived' });
    return view(out);
  });

  app.post('/api/items/:id/regenerate', async (req) => {
    const item = getItem(req.params);
    if (item.status !== 'pending' && item.status !== 'error') throw Object.assign(new Error('Só dá para refazer itens pendentes ou com erro.'), { statusCode: 409 });
    const { instruction } = z.object({ instruction: z.string().max(2000).optional() }).parse(req.body ?? {});
    const built = await buildReply(emailFromItem(item), deps, instruction);
    const model = runtime(store).llm.model;
    const patch = {
      status: 'pending' as const, error: null, risk: built.reply.risk, category: built.reply.category, risk_reasons: built.reply.risk_reasons,
      reply_subject: built.reply.reply_subject, reply_body: built.reply.reply_body, internal_notes: built.reply.internal_notes,
      customer_json: JSON.stringify(built.customer), model, tokens_in: built.tokensIn, tokens_out: built.tokensOut,
    };
    const draftId = await syncDraft(item, patch.reply_subject, patch.reply_body);
    return view(store.updateItem(item.id, { ...patch, draft_id: draftId }));
  });

  app.post('/api/poll', async () => {
    await ctx.poller.tick();
    return { ok: true };
  });

  app.post('/api/sync', async () => {
    if (!gmail.isConnected()) throw Object.assign(new Error('Gmail não conectado.'), { statusCode: 401 });
    const result = await ctx.poller.syncPrevious();
    return result;
  });

  // ── atualizações em tempo real (SSE)
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    const onChange = (e: unknown) => send(e);
    bus.on('change', onChange);
    const hb = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    send({ type: 'hello' });
    req.raw.on('close', () => { clearInterval(hb); bus.off('change', onChange); });
  });

  // ── interface (build do Vite)
  const dist = fileURLToPath(new URL('../web/dist', import.meta.url));
  if (existsSync(dist)) {
    void app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'não encontrado' });
    });
  } else {
    app.get('/', async (_req, reply) => reply.type('text/html').send('<p>Interface ainda não compilada. Rode <code>npm run build</code> (ou <code>npm run dev</code>).</p>'));
  }
  return app;
}
