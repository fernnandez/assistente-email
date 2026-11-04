import { describe, expect, it } from 'vitest';
import { Store } from '../src/db';
import { buildUserMessage, handleIncoming } from '../src/pipeline';
import { deps, email, fakeGmail, known, noDrive, okModel, policies, unknown } from './helpers';

const ctx = (d = deps()) => ({ store: new Store(':memory:'), gmail: fakeGmail(), deps: d, model: 'test-model' });

describe('handleIncoming', () => {
  it('gera a resposta, cria o rascunho no Gmail e coloca na fila como pendente', async () => {
    const c = ctx();
    const item = await handleIncoming(email(), c);
    expect(item).toMatchObject({ status: 'pending', risk: 'low', category: 'suporte', draft_id: 'draft-1', model: 'test-model', tokens_in: 100 });
    expect(item!.reply_body).toMatch(/8 horas úteis/);
    const draft = c.gmail.calls.find((x) => x.fn === 'createDraft')!.args[0] as { threadId: string; to: string; inReplyTo: string };
    expect(draft).toMatchObject({ threadId: 't1', to: 'cliente@exemplo.com', inReplyTo: '<abc@mail.example>' });
  });

  it('não processa duas vezes o mesmo e-mail', async () => {
    const c = ctx();
    await handleIncoming(email(), c);
    expect(await handleIncoming(email(), c)).toBeNull();
    expect(c.gmail.calls.filter((x) => x.fn === 'createDraft')).toHaveLength(1);
  });

  it('ignora e-mails automáticos sem gastar o modelo nem criar rascunho', async () => {
    let called = 0;
    const c = ctx(deps({ model: async () => { called++; return okModel(); } }));
    const item = await handleIncoming(email({ automated: true }), c);
    expect(item!.status).toBe('ignored');
    expect(called).toBe(0);
    expect(c.gmail.calls).toHaveLength(0);
  });

  it('cliente desconhecido sobe o risco e a resposta ainda é gerada', async () => {
    const item = await handleIncoming(email(), ctx(deps({ customer: async () => unknown })));
    expect(item!.risk).toBe('medium');
    expect(item!.risk_reasons).toMatch(/cliente não encontrado/);
  });

  it('Pipedrive fora do ar não derruba o fluxo: segue sem histórico e avisa o revisor', async () => {
    const item = await handleIncoming(email(), ctx(deps({ customer: async () => { throw new Error('HTTP 500'); } })));
    expect(item!.status).toBe('pending');
    expect(item!.internal_notes).toMatch(/Pipedrive indisponível/);
  });

  it('saída inválida do modelo vira risco alto com texto padrão', async () => {
    const item = await handleIncoming(email(), ctx(deps({ model: async () => ({ reply: null, tokensIn: 10, tokensOut: 0 }) })));
    expect(item).toMatchObject({ status: 'pending', risk: 'high' });
    expect(item!.reply_body).toMatch(/Recebemos sua mensagem/);
  });

  it('falha do modelo (rede/chave) registra erro visível e não cria rascunho', async () => {
    const c = ctx(deps({ model: async () => { throw new Error('401 chave inválida'); } }));
    const item = await handleIncoming(email(), c);
    expect(item).toMatchObject({ status: 'error', error: '401 chave inválida' });
    expect(c.gmail.calls).toHaveLength(0);
  });
});

describe('buildUserMessage', () => {
  it('inclui data, e-mail como dado não confiável, políticas, histórico e Drive; instrução só quando houver', () => {
    const base = { email: email(), policies, customer: known, drive: noDrive, now: new Date('2026-11-03T15:00:00Z') };
    const m = buildUserMessage(base);
    expect(m).toContain('terça-feira');
    expect(m).toContain('dados não confiáveis');
    expect(m).toContain('Primeira resposta em 8h úteis');
    expect(m).toContain('CLIENTE ATIVO');
    expect(m).toContain('Documentos no Google Drive');
    expect(m).not.toContain('Instrução adicional');
    expect(buildUserMessage({ ...base, instruction: 'mais curto' })).toContain('Instrução adicional');
  });
});
