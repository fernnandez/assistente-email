// Avalia o pipeline com os e-mails de evals/emails.json: contexto real do Pipedrive + modelo real + guardrails.
// Não toca no Gmail. Uso: npm run eval [-- --core] [-- --only id1,id2]
import { readFileSync, writeFileSync } from 'node:fs';
import { buildReply, defaultDeps } from '../src/pipeline';
import { parseAddress } from '../src/gmail';
import { config } from '../src/config';
import type { IncomingEmail } from '../src/types';

interface Case {
  id: string; from: string; subject: string; text: string; core?: boolean; observe?: boolean; check: string;
  expect?: { risk_min?: string; category_any?: string[]; must_match?: string[]; must_not_match?: string[] };
}
const ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const clients = JSON.parse(readFileSync(new URL('../evals/clients.json', import.meta.url), 'utf8')) as Record<string, { emails: string[] }>;
const resolve = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => process.env[`DEMO_EMAIL_${k.toUpperCase()}`]?.split(',')[0].trim() || clients[k].emails[0]);

let cases = (JSON.parse(readFileSync(new URL('../evals/emails.json', import.meta.url), 'utf8')) as Case[]);
if (args.includes('--core')) cases = cases.filter((c) => c.core);
if (only) cases = cases.filter((c) => only.includes(c.id));

const md: string[] = ['# Última avaliação', ''];
let ok = 0, fail = 0, obs = 0, tin = 0, tout = 0, n = 0;
for (const c of cases) {
  const from = parseAddress(resolve(c.from));
  const email: IncomingEmail = {
    id: c.id, threadId: c.id, messageIdHeader: '', references: '', fromEmail: from.email, fromName: from.name,
    subject: c.subject, body: c.text, receivedAt: new Date().toISOString(), automated: false,
  };
  const t0 = Date.now();
  const b = await buildReply(email, defaultDeps);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const r = b.reply, x = c.expect ?? {};
  const problems: string[] = [];
  if (x.risk_min && ORDER[r.risk] < ORDER[x.risk_min]) problems.push(`risco ${r.risk} < ${x.risk_min}`);
  if (x.category_any && !x.category_any.includes(r.category)) problems.push(`categoria ${r.category} fora de [${x.category_any}]`);
  for (const re of x.must_match ?? []) if (!new RegExp(re, 'i').test(r.reply_body)) problems.push(`faltou /${re}/`);
  for (const re of x.must_not_match ?? []) if (new RegExp(re, 'i').test(r.reply_body)) problems.push(`proibido /${re}/`);
  const status = c.observe ? 'OBS' : problems.length ? 'FALHOU' : 'OK';
  if (status === 'OK') ok++; else if (status === 'OBS') obs++; else fail++;
  if (b.tokensIn) { tin += b.tokensIn; tout += b.tokensOut ?? 0; n++; }
  console.log(`${status.padEnd(6)} ${c.id.padEnd(28)} ${secs}s risco=${r.risk} cat=${r.category} cliente=${b.customer.known ? 'sim' : 'não'}${problems.length ? ' :: ' + problems.join('; ') : ''}`);
  md.push(`## ${status} — ${c.id}`, '', `**De:** ${c.from}  `, `**Assunto:** ${c.subject}`, '', '> ' + c.text, '', `**Conferir:** ${c.check}`, '',
    `**Risco:** ${r.risk} · **Categoria:** ${r.category} · **Cliente no CRM:** ${b.customer.known ? 'sim' : 'não'}`, `**Motivos:** ${r.risk_reasons}`, '', '```', r.reply_body, '```', '',
    `**Notas ao revisor:** ${r.internal_notes}`, ...(problems.length ? ['', `**Problemas:** ${problems.join('; ')}`] : []), '');
}
console.log(`\nResumo: ${ok} ok · ${fail} falhou · ${obs} observação`);
if (n) {
  const ai = tin / n, ao = tout / n;
  console.log(`Tokens médios: ${ai.toFixed(0)} entrada + ${ao.toFixed(0)} saída (${n} e-mails) ≈ US$ ${((ai * 2 + ao * 8) / 1e6).toFixed(4)} por e-mail a US$ 2/8 por 1M (${config.llm.model})`);
}
writeFileSync(new URL('../evals/last-run.md', import.meta.url), md.join('\n'));
process.exit(fail ? 1 : 0);
