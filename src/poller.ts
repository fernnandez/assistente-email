import { EventEmitter } from 'node:events';
import { config } from './config';
import type { Store } from './db';
import type { GmailClient } from './gmail';
import { handleIncoming, type PipelineDeps } from './pipeline';
import { runtime } from './settings';

/** Avisa a interface (SSE) de que algo mudou. */
export const bus = new EventEmitter();

export interface Poller { tick: () => Promise<void>; stop: () => void; syncPrevious: () => Promise<SyncResult> }

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

export function startPoller(args: { store: Store; gmail: GmailClient; deps?: PipelineDeps; intervalMs?: number }): Poller {
  const { store, gmail } = args;
  let running = false;

  async function tick(): Promise<void> {
    if (running || !gmail.isConnected()) return;
    running = true;
    try {
      const { ids, nextHistoryId } = await gmail.pollNewMessageIds();
      for (const id of ids) {
        const email = await gmail.getEmail(id);
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
  return {
    tick,
    stop: () => clearInterval(timer),
    syncPrevious: () => syncPrevious({ store, gmail, deps: args.deps }),
  };
}
