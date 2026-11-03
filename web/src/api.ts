export type Risk = 'low' | 'medium' | 'high';
export type Status = 'pending' | 'sent' | 'discarded' | 'ignored' | 'error';

export interface Customer { known: boolean; name: string | null; org: string | null; text: string }
export interface Item {
  id: number; from_email: string; from_name: string; subject: string; body: string; received_at: string;
  status: Status; risk: Risk | null; category: string | null; risk_reasons: string | null;
  reply_subject: string | null; reply_body: string | null; internal_notes: string | null; error: string | null;
  customer: Customer | null;
}
export interface SetupStatus {
  company: boolean; google: boolean; llm: boolean; pipedrive: boolean;
  policies: boolean; gmail: boolean; ready: boolean;
}

export interface StatusInfo {
  gmail: { connected: boolean; needsReauth: boolean; email: string | null };
  problems: string[];
  policies: { files: string[]; chars: number; truncated: boolean };
  lastPollAt: string | null; lastError: string | null; pollSeconds: number;
  counts: Record<Status, number>; model: string;
  setup: SetupStatus;
}

export interface PublicSettings {
  company: { name: string; signature: string; signatureEn: string };
  google: { clientId: string; clientSecretConfigured: boolean };
  llm: { baseUrl: string; apiKeyConfigured: boolean; model: string };
  pipedrive: { domain: string; tokenConfigured: boolean };
}

export interface SettingsPatch {
  company?: { name?: string; signature?: string; signatureEn?: string };
  google?: { clientId?: string; clientSecret?: string };
  llm?: { baseUrl?: string; apiKey?: string; model?: string };
  pipedrive?: { domain?: string; token?: string };
}

export interface DocFile { name: string; content: string }

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'assistente-email' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}

export const api = {
  status: () => call<StatusInfo>('/api/status'),
  items: (status: 'pending' | 'all') => call<Item[]>(`/api/items?status=${status}`),
  save: (id: number, reply_body: string) => call<Item>(`/api/items/${id}/draft`, 'PUT', { reply_body }),
  send: (id: number, reply_body: string) => call<Item>(`/api/items/${id}/send`, 'POST', { reply_body }),
  discard: (id: number) => call<Item>(`/api/items/${id}/discard`, 'POST', {}),
  regenerate: (id: number, instruction: string) => call<Item>(`/api/items/${id}/regenerate`, 'POST', { instruction }),
  poll: () => call<{ ok: boolean }>('/api/poll', 'POST', {}),
  disconnect: () => call<{ ok: boolean }>('/api/auth/disconnect', 'POST', {}),
  settings: () => call<PublicSettings>('/api/settings'),
  saveSettings: (patch: SettingsPatch) => call<PublicSettings>('/api/settings', 'PUT', patch),
  docs: () => call<{ files: string[] }>('/api/docs'),
  doc: (name: string) => call<DocFile>(`/api/docs/${encodeURIComponent(name)}`),
  policies: () => call<{ files: string[] }>('/api/policies'),
  policy: (name: string) => call<DocFile>(`/api/policies/${encodeURIComponent(name)}`),
  savePolicy: (name: string, content: string) => call<{ name: string }>(`/api/policies/${encodeURIComponent(name)}`, 'PUT', { content }),
  createPolicy: (name: string, content = '') => call<{ name: string }>('/api/policies', 'POST', { name, content }),
  deletePolicy: (name: string) => call<{ ok: boolean }>(`/api/policies/${encodeURIComponent(name)}`, 'DELETE', {}),
  seedPolicies: () => call<{ copied: string[]; skipped: string[] }>('/api/policies/seed-examples', 'POST', {}),
};
