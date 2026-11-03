// Popula a fila com e-mails de exemplo (modelo e Pipedrive reais, SEM Gmail): útil para ver a interface funcionando.
// Uso: npm run demo:seed   (apaga a fila atual do banco local e recria)
import { readFileSync } from 'node:fs';
import { Store } from '../src/db';
import { parseAddress } from '../src/gmail';
import { handleIncoming } from '../src/pipeline';
import { config } from '../src/config';

const store = new Store();
store.db.exec('DELETE FROM items');
const clients = JSON.parse(readFileSync(new URL('../evals/clients.json', import.meta.url), 'utf8')) as Record<string, { emails: string[] }>;
const resolve = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => process.env[`DEMO_EMAIL_${k.toUpperCase()}`]?.split(',')[0].trim() || clients[k].emails[0]);
const cases = JSON.parse(readFileSync(new URL('../evals/emails.json', import.meta.url), 'utf8')) as { id: string; from: string; subject: string; text: string; core?: boolean }[];

let n = 0;
const gmail = { createDraft: async () => `demo-draft-${++n}`, updateDraft: async () => {}, sendDraft: async () => {}, deleteDraft: async () => {} };
const now = Date.now();
for (const [i, c] of cases.filter((x) => x.core).entries()) {
  const from = parseAddress(resolve(c.from));
  await handleIncoming(
    { id: `demo-${c.id}`, threadId: `demo-t${i}`, messageIdHeader: `<demo${i}@local>`, references: '', fromEmail: from.email, fromName: from.name, subject: c.subject, body: c.text, receivedAt: new Date(now - (i + 1) * 7 * 60000).toISOString(), automated: false },
    { store, gmail, model: config.llm.model },
  );
}
console.log(`${store.counts().pending} itens de exemplo na fila (rascunhos de mentira: nada foi criado no Gmail).`);
