import { config } from './config';
import type { Customer } from './types';

// ───────── formatação (pura, testável) ─────────

export interface PdDeal {
  title: string; status: string; stage_id: number; value: number; currency: string;
  add_time?: string; won_time?: string | null; lost_time?: string | null; lost_reason?: string | null; expected_close_date?: string | null;
}
export interface PdActivity { subject: string; type: string; due_date: string; done: boolean }
export interface PdNote { content: string; add_time: string }

const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : null);

export function formatCustomer(args: {
  name: string; org: string | null; deals: PdDeal[]; activities: PdActivity[]; stages: Record<number, string>; notes: PdNote[];
}): string {
  // Confidencial e fora do modelo: notas [INTERNO] e a agenda futura (atividades não realizadas).
  const notes = args.notes.filter((n) => !/\[INTERNO/i.test(String(n.content)));
  const acts = args.activities.filter((a) => a.done).sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)));
  const open = args.deals.filter((d) => d.status === 'open');
  const won = args.deals.filter((d) => d.status === 'won');
  const situacao =
    open.length && won.length ? 'CLIENTE ATIVO com negócio em andamento (upgrade/negociação)'
    : open.length ? 'EM NEGOCIAÇÃO (ainda não é cliente)'
    : won.length ? 'CLIENTE ATIVO'
    : args.deals.length ? 'EX-CLIENTE / negócio perdido'
    : 'contato sem negócios';
  const fmtDeal = (d: PdDeal) =>
    `- ${d.title} | status: ${d.status} | etapa: ${args.stages[d.stage_id] ?? d.stage_id} | valor: ${d.value} ${d.currency}` +
    ` | criado em ${d10(d.add_time)}` + (d.won_time ? ` | ganho em ${d10(d.won_time)}` : '') +
    (d.lost_time ? ` | perdido/cancelado em ${d10(d.lost_time)}` : '') +
    (d.expected_close_date ? ` | previsão de fechamento ${d.expected_close_date}` : '') +
    (d.lost_reason ? ` | motivo: ${d.lost_reason}` : '');
  return [
    `Cliente: ${args.name}${args.org ? ` (${args.org})` : ''}`,
    `Situação: ${situacao}`,
    'Negócios:', args.deals.length ? args.deals.map(fmtDeal).join('\n') : '- nenhum',
    'Atividades já realizadas:', acts.length ? acts.map((a) => `- ${a.due_date} ${a.type}: ${a.subject}`).join('\n') : '- nenhuma',
    'Notas do CRM (mais recentes primeiro; uso interno, não cite literalmente):',
    notes.length ? notes.map((n) => `- ${d10(n.add_time)}: ${String(n.content).replace(/<[^>]+>/g, ' ').trim()}`).join('\n') : '- nenhuma',
  ].join('\n');
}

// ───────── chamadas à API (somente leitura) ─────────

const NEW_CONTACT = 'Contato NOVO: nenhum cadastro no Pipedrive para este e-mail.';
export const isPipedriveConfigured = () => !!(config.pipedrive.domain && config.pipedrive.token);

async function pd<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`https://${config.pipedrive.domain}.pipedrive.com/api${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('api_token', config.pipedrive.token);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Pipedrive ${path}: HTTP ${res.status}`);
  const json = (await res.json()) as { success?: boolean; data?: T; error?: string };
  if (json.success === false) throw new Error(`Pipedrive ${path}: ${json.error ?? 'erro'}`);
  return json.data as T;
}

/** Procura o cliente pelo e-mail do remetente (correspondência exata) e monta o histórico. */
export async function lookupCustomer(email: string): Promise<Customer> {
  if (!isPipedriveConfigured()) {
    return { known: false, personId: null, name: null, org: null, text: 'Pipedrive não configurado: sem histórico do cliente.' };
  }
  const search = await pd<{ items?: { item: { id: number; name: string; organization?: { name: string } | null } }[] }>('/v1/persons/search', {
    term: email, fields: 'email', exact_match: 'true', limit: 1,
  });
  const person = search?.items?.[0]?.item;
  if (!person) return { known: false, personId: null, name: null, org: null, text: NEW_CONTACT };

  const [deals, activities, stagesList, notes] = await Promise.all([
    pd<PdDeal[] | null>(`/v1/persons/${person.id}/deals`, { limit: 10 }),
    pd<PdActivity[] | null>('/v2/activities', { person_id: person.id, limit: 30 }),
    pd<{ id: number; name: string }[] | null>('/v1/stages'),
    pd<PdNote[] | null>('/v1/notes', { person_id: person.id, limit: 15, sort: 'add_time DESC' }),
  ]);
  const stages = Object.fromEntries((stagesList ?? []).map((s) => [s.id, s.name]));
  const org = person.organization?.name ?? null;
  return {
    known: true, personId: person.id, name: person.name, org,
    text: formatCustomer({ name: person.name, org, deals: deals ?? [], activities: activities ?? [], stages, notes: notes ?? [] }),
  };
}
