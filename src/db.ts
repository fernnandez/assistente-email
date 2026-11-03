import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config';
import type { Item, ItemStatus } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_message_id  TEXT NOT NULL UNIQUE,
  thread_id         TEXT NOT NULL,
  message_id_header TEXT NOT NULL DEFAULT '',
  references_header TEXT NOT NULL DEFAULT '',
  from_email        TEXT NOT NULL,
  from_name         TEXT NOT NULL DEFAULT '',
  subject           TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  received_at       TEXT NOT NULL,
  status            TEXT NOT NULL,
  risk              TEXT,
  category          TEXT,
  risk_reasons      TEXT,
  reply_subject     TEXT,
  reply_body        TEXT,
  internal_notes    TEXT,
  draft_id          TEXT,
  customer_json     TEXT,
  model             TEXT,
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  error             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, received_at);
`;

export type NewItem = Omit<Item, 'id' | 'created_at' | 'updated_at'>;

export class Store {
  readonly db: Database.Database;

  constructor(file: string = join(config.dataDir, 'assistente.db')) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  getState(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  deleteState(key: string): void {
    this.db.prepare('DELETE FROM state WHERE key = ?').run(key);
  }

  hasMessage(gmailMessageId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM items WHERE gmail_message_id = ?').get(gmailMessageId);
  }

  insertItem(item: NewItem): Item {
    const cols = Object.keys(item) as (keyof NewItem)[];
    const sql = `INSERT INTO items (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`;
    const info = this.db.prepare(sql).run(item);
    return this.getItem(Number(info.lastInsertRowid))!;
  }

  getItem(id: number): Item | undefined {
    return this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Item | undefined;
  }

  listItems(status?: ItemStatus | 'visible'): Item[] {
    if (status === 'visible') {
      return this.db.prepare("SELECT * FROM items WHERE status != 'ignored' ORDER BY received_at DESC LIMIT 200").all() as Item[];
    }
    if (status) return this.db.prepare('SELECT * FROM items WHERE status = ? ORDER BY received_at DESC LIMIT 200').all(status) as Item[];
    return this.db.prepare('SELECT * FROM items ORDER BY received_at DESC LIMIT 200').all() as Item[];
  }

  updateItem(id: number, patch: Partial<Omit<Item, 'id' | 'created_at'>>): Item {
    const cols = Object.keys(patch);
    if (cols.length) {
      const sets = [...cols.map((c) => `${c} = @${c}`), "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"].join(', ');
      this.db.prepare(`UPDATE items SET ${sets} WHERE id = @id`).run({ ...patch, id });
    }
    return this.getItem(id)!;
  }

  counts(): Record<ItemStatus, number> {
    const rows = this.db.prepare('SELECT status, count(*) AS n FROM items GROUP BY status').all() as { status: ItemStatus; n: number }[];
    const out: Record<ItemStatus, number> = { pending: 0, sent: 0, discarded: 0, ignored: 0, error: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }
}
