import { describe, expect, it, vi } from 'vitest';
import { Store } from '../src/db';
import { findTeamReply, GmailError, type GmailMessage } from '../src/gmail';
import { handleIncoming } from '../src/pipeline';
import { recheckAnswered, startPoller } from '../src/poller';
import { deps, email, fakeGmail, okModel } from './helpers';

const T0 = Date.parse('2026-11-03T12:00:00.000Z');
const msg = (from: string, offsetMin: number, labelIds: string[] = ['SENT']): GmailMessage => ({
  id: `m${offsetMin}`, threadId: 't1', labelIds, internalDate: String(T0 + offsetMin * 60000),
  payload: { headers: [{ name: 'From', value: from }] },
});
const opts = { selfEmail: 'ana@empresa.com.br', afterMs: T0, customerEmail: 'cliente@exemplo.com' };

describe('findTeamReply', () => {
  it('acha a resposta de um colega do mesmo domínio enviada depois do cliente', () => {
    const r = findTeamReply([msg('Cliente <cliente@exemplo.com>', 0), msg('Beto Lima <beto@empresa.com.br>', 30)], opts);
    expect(r).toMatchObject({ name: 'Beto Lima', email: 'beto@empresa.com.br' });
  });

  it('ignora rascunhos e mensagens anteriores ao e-mail do cliente', () => {
    expect(findTeamReply([msg('beto@empresa.com.br', 30, ['DRAFT']), msg('beto@empresa.com.br', -10)], opts)).toBeNull();
  });

  it('domínio parecido não conta', () => {
    expect(findTeamReply([msg('x@empresa.com', 5), msg('x@outraempresa.com.br', 5), msg('x@mail.empresa.com.br', 5)], opts)).toBeNull();
  });

  it('em caixa de provedor público só vale o endereço exato', () => {
    const o = { ...opts, selfEmail: 'ana@gmail.com' };
    expect(findTeamReply([msg('qualquer@gmail.com', 5)], o)).toBeNull();
    expect(findTeamReply([msg('ana@gmail.com', 5)], o)).toMatchObject({ email: 'ana@gmail.com' });
  });
});

describe('conversa já respondida', () => {
  const answered = { name: 'Beto Lima', email: 'beto@empresa.com.br', at: '2026-11-03T15:37:00.000Z' };
  const ctx = (teamReplyAfter: () => Promise<unknown>, called = { n: 0 }) => ({
    store: new Store(':memory:'),
    gmail: { ...fakeGmail(), teamReplyAfter } as ReturnType<typeof fakeGmail> & { teamReplyAfter: () => Promise<never> },
    deps: deps({ model: async () => { called.n++; return okModel(); } }),
  });

  it('não chama o modelo nem cria rascunho; entra pendente, sem texto, sugerindo arquivar', async () => {
    const called = { n: 0 };
    const c = ctx(async () => answered, called);
    const item = await handleIncoming(email(), c);
    expect(item).toMatchObject({ status: 'pending', reply_body: '', draft_id: null });
    expect(item!.internal_notes).toMatch(/JÁ RESPONDIDO por Beto Lima <beto@empresa.com.br>.*SUGESTÃO: ARQUIVAR/);
    expect(called.n).toBe(0);
    expect(c.gmail.calls.some((x) => x.fn === 'createDraft')).toBe(false);
  });

  it('se a checagem falhar, segue o fluxo normal', async () => {
    const item = await handleIncoming(email(), ctx(async () => { throw new Error('boom'); }));
    expect(item).toMatchObject({ status: 'pending', draft_id: 'draft-1' });
    expect(item!.reply_body).toMatch(/8 horas úteis/);
  });

  it('recheckAnswered apaga o rascunho, marca o pendente e não marca de novo', async () => {
    const c = ctx(async () => null);
    const item = (await handleIncoming(email(), c))!;
    let reply: unknown = answered;
    const gmail = { ...c.gmail, isConnected: () => true, teamReplyAfter: async () => reply } as never;
    expect(await recheckAnswered({ store: c.store, gmail })).toBe(1);
    const after = c.store.getItem(item.id)!;
    expect(after).toMatchObject({ draft_id: null, reply_body: '' });
    expect(after.internal_notes).toMatch(/JÁ RESPONDIDO/);
    expect(c.gmail.calls.filter((x) => x.fn === 'deleteDraft')).toHaveLength(1);
    reply = { ...answered, name: 'Outro' };
    expect(await recheckAnswered({ store: c.store, gmail })).toBe(0);
    expect(c.store.getItem(item.id)!.internal_notes).toBe(after.internal_notes);
  });
});

describe('poll com mensagem apagada', () => {
  it('404 no getEmail pula a mensagem e avança o histórico', async () => {
    const store = new Store(':memory:');
    const committed: string[] = [];
    const gmail = {
      isConnected: () => true,
      pollNewMessageIds: async () => ({ ids: ['gone', 'ok'], nextHistoryId: '99' }),
      getEmail: async (id: string) => {
        if (id === 'gone') throw new GmailError(404, 'Requested entity was not found.');
        return email({ id: 'ok' });
      },
      commitHistory: (id: string) => committed.push(id),
      createDraft: async () => 'd1',
      deleteDraft: async () => undefined,
      teamReplyAfter: async () => null,
    };
    const poller = startPoller({ store, gmail: gmail as never, deps: deps(), intervalMs: 3_600_000, recheckMs: 3_600_000 });
    await vi.waitFor(() => expect(committed).toContain('99')); // o tick inicial roda ao criar o poller
    poller.stop();
    expect(committed).toContain('99');
    expect(store.hasMessage('ok')).toBe(true);
    expect(store.getState('last_error')).toBeNull();
  });
});
