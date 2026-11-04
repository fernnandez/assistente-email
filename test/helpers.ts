import type { DriveContext } from '../src/drive';
import type { Customer, IncomingEmail } from '../src/types';
import type { PolicySet } from '../src/policies';
import type { LlmResult } from '../src/llm';
import type { PipelineDeps } from '../src/pipeline';

export const email = (over: Partial<IncomingEmail> = {}): IncomingEmail => ({
  id: 'm1', threadId: 't1', messageIdHeader: '<abc@mail.example>', references: '',
  fromEmail: 'cliente@exemplo.com', fromName: 'Maria Souza', subject: 'Dúvida sobre prazo', body: 'Qual o prazo de suporte?',
  receivedAt: '2026-11-03T12:00:00.000Z', automated: false, ...over,
});

export const known: Customer = { known: true, personId: 9, name: 'Maria Souza', org: 'Acme', driveFolderUrl: null, text: 'Cliente: Maria Souza (Acme)\nSituação: CLIENTE ATIVO' };
export const unknown: Customer = { known: false, personId: null, name: null, org: null, driveFolderUrl: null, text: 'Contato NOVO' };
export const policies: PolicySet = { text: '### sla.md\nPrimeira resposta em 8h úteis.', files: ['sla.md'], chars: 40, truncated: false };
export const noDrive: DriveContext = {
  consulted: false, folderId: null, folderName: null, files: [], note: 'não consultado', text: '(Drive não consultado)',
};

export const okModel = (over: Partial<NonNullable<LlmResult['reply']>> = {}): LlmResult => ({
  reply: { category: 'suporte', risk: 'low', risk_reasons: 'coberto por política', reply_subject: 'Re: Dúvida sobre prazo', reply_body: 'Olá Maria, o prazo é de 8 horas úteis.', internal_notes: 'ok', ...over },
  tokensIn: 100, tokensOut: 50,
});

export const deps = (over: Partial<PipelineDeps> = {}): PipelineDeps => ({
  customer: async () => known,
  policies: () => policies,
  docs: async () => noDrive,
  model: async () => okModel(),
  now: () => new Date('2026-11-03T15:00:00Z'),
  ...over,
});

export function fakeGmail() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec = <T,>(fn: string, ret: T) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret; };
  return {
    calls,
    createDraft: rec('createDraft', 'draft-1'),
    updateDraft: rec('updateDraft', undefined),
    sendDraft: rec('sendDraft', undefined),
    deleteDraft: rec('deleteDraft', undefined),
    archiveMessage: rec('archiveMessage', undefined),
    listRecentInboxIds: rec('listRecentInboxIds', [] as string[]),
    getEmail: rec('getEmail', email()),
  };
}
