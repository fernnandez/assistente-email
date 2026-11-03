import { EventEmitter } from 'node:events';
import { config } from './config';
import type { Store } from './db';
import type { GmailClient } from './gmail';
import { handleIncoming, type PipelineDeps } from './pipeline';

/** Avisa a interface (SSE) de que algo mudou. */
export const bus = new EventEmitter();

export interface Poller { tick: () => Promise<void>; stop: () => void }

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
        const item = await handleIncoming(email, { store, gmail, deps: args.deps, model: config.llm.model });
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
  return { tick, stop: () => clearInterval(timer) };
}
