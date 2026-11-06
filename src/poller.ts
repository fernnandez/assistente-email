import { EventEmitter } from 'node:events';
import { config } from './config';
import type { Store } from './db';
import { GmailError, type GmailClient } from './gmail';
import { ANSWERED_MARK, answeredNote, handleIncoming, type PipelineDeps } from './pipeline';
import { runtime } from './settings';

/** Avisa a interface (SSE) de que algo mudou. */
export const bus = new EventEmitter();

export interface Poller { tick: () => Promise<void>; stop: () => void; syncPrevious: () => Promise<SyncResult>; recheckAnswered: () => Promise<number> }

export interface SyncResult {
  listed: number;
  processed: number;
  skipped: number;
  errors: string[];
}

/** Traz e-mails não lidos da inbox (últimos N dias) sem alterar o history_id do poll. */
export async function syncPrevious(args: {
  store: Store;
  gmail: GmailClient;
  deps?: PipelineDeps;
  newerThanDays?: number;
  max?: number;
}): Promise<SyncResult> {
  const { store, gmail } = args;
  const ids = await gmail.listRecentInboxIds({
    newerThanDays: args.newerThanDays ?? 7,
    max: args.max ?? 30,
    unreadOnly: true,
  });
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];
  const model = runtime(store).llm.model;
  for (const id of ids) {
    if (store.hasMessage(id)) {
      skipped++;
      continue;
    }
    try {
      const email = await gmail.getEmail(id);
      const item = await handleIncoming(email, { store, gmail, deps: args.deps, model });
      if (!item || item.status === 'ignored') skipped++;
      else {
        processed++;
        bus.emit('change', { type: 'item', id: item.id, status: item.status });
      }
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  bus.emit('change', { type: 'status' });
  return { listed: ids.length, processed, skipped, errors };
}

/**
 * Revê os pendentes: se alguém da equipe já respondeu na conversa (inclusive direto pelo Gmail),
 * apaga o rascunho do assistente e marca o item como "já respondido". Devolve quantos marcou.
 */
export async function recheckAnswered(args: { store: Store; gmail: GmailClient }): Promise<number> {
  const { store, gmail } = args;
  if (!gmail.isConnected()) return 0;
  let marked = 0;
  for (const item of store.listItems('pending')) {
    if (item.internal_notes?.includes(ANSWERED_MARK)) continue;
    try {
      const reply = await gmail.teamReplyAfter(item.thread_id, item.received_at, item.from_email);
      if (!reply) continue;
      if (item.draft_id) {
        try { await gmail.deleteDraft(item.draft_id); } catch (e) { if (!(e instanceof GmailError && e.status === 404)) throw e; }
      }
      const notes = [answeredNote(reply), item.internal_notes].filter(Boolean).join(' ');
      store.updateItem(item.id, { draft_id: null, reply_body: '', internal_notes: notes });
      bus.emit('change', { type: 'item', id: item.id, status: 'pending' });
      marked++;
    } catch { /* tenta de novo na próxima rodada */ }
  }
  return marked;
}

export function startPoller(args: { store: Store; gmail: GmailClient; deps?: PipelineDeps; intervalMs?: number; recheckMs?: number }): Poller {
  const { store, gmail } = args;
  let running = false;

  async function tick(): Promise<void> {
    if (running || !gmail.isConnected()) return;
    running = true;
    try {
      const { ids, nextHistoryId } = await gmail.pollNewMessageIds();
      for (const id of ids) {
        let email;
        try {
          email = await gmail.getEmail(id);
        } catch (e) {
          if (e instanceof GmailError && e.status === 404) continue; // apagado/movido entre o histórico e a leitura
          throw e;
        }
        const item = await handleIncoming(email, { store, gmail, deps: args.deps, model: runtime(store).llm.model });
        if (item && item.status !== 'ignored') bus.emit('change', { type: 'item', id: item.id, status: item.status });
      }
      gmail.commitHistory(nextHistoryId); // só avança depois de processar tudo
      store.setState('last_poll_at', new Date().toISOString());
      store.deleteState('last_error');
    } catch (e) {
      store.setState('last_error', e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
      bus.emit('change', { type: 'status' });
    }
  }

  const timer = setInterval(() => void tick(), (args.intervalMs ?? config.pollSeconds * 1000));
  void tick();
  const recheck = () => recheckAnswered({ store, gmail });
  const recheckTimer = setInterval(() => void recheck(), args.recheckMs ?? 10 * 60 * 1000);
  void recheck();
  return {
    tick,
    stop: () => { clearInterval(timer); clearInterval(recheckTimer); },
    recheckAnswered: recheck,
    syncPrevious: () => syncPrevious({ store, gmail, deps: args.deps }),
  };
}
