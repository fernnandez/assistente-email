import { z } from 'zod';
import { config } from './config';
import type { Store } from './db';
import { materializeDataUrls, signaturePlainFromHtml } from './signature';

const SETTINGS_KEY = 'settings';

const storedSchema = z.object({
  company: z.object({
    name: z.string().optional(),
    signature: z.string().optional(),
    signatureEn: z.string().optional(),
    signatureHtml: z.string().optional(),
    signatureHtmlEn: z.string().optional(),
  }).optional(),
  google: z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
  }).optional(),
  llm: z.object({
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
  pipedrive: z.object({
    domain: z.string().optional(),
    token: z.string().optional(),
  }).optional(),
});

export type StoredSettings = z.infer<typeof storedSchema>;

export const settingsPatchSchema = z.object({
  company: z.object({
    name: z.string().max(200).optional(),
    signature: z.string().max(500).optional(),
    signatureEn: z.string().max(500).optional(),
    signatureHtml: z.string().max(200_000).optional(),
    signatureHtmlEn: z.string().max(200_000).optional(),
  }).optional(),
  google: z.object({
    clientId: z.string().max(300).optional(),
    clientSecret: z.string().max(300).optional(),
  }).optional(),
  llm: z.object({
    baseUrl: z.string().max(500).optional(),
    apiKey: z.string().max(500).optional(),
    model: z.string().max(200).optional(),
  }).optional(),
  pipedrive: z.object({
    domain: z.string().max(100).optional(),
    token: z.string().max(300).optional(),
  }).optional(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Config efetiva: o que foi salvo na UI sobrescreve o .env; campo vazio na UI cai no .env. */
export interface RuntimeSecrets {
  company: {
    name: string;
    signature: string;
    signatureEn: string;
    signatureHtml: string;
    signatureHtmlEn: string;
  };
  google: { clientId: string; clientSecret: string };
  llm: { baseUrl: string; apiKey: string; model: string };
  pipedrive: { domain: string; token: string };
}

export interface PublicSettings {
  company: {
    name: string;
    signature: string;
    signatureEn: string;
    signatureHtml: string;
    signatureHtmlEn: string;
  };
  google: { clientId: string; clientSecretConfigured: boolean };
  llm: { baseUrl: string; apiKeyConfigured: boolean; model: string };
  pipedrive: { domain: string; tokenConfigured: boolean };
}

export interface SetupStatus {
  company: boolean;
  google: boolean;
  llm: boolean;
  pipedrive: boolean;
  policies: boolean;
  gmail: boolean;
  ready: boolean;
}

let bound: Store | null = null;

export function bindSettings(store: Store): void {
  bound = store;
}

function readStored(store: Store): StoredSettings {
  const raw = store.getState(SETTINGS_KEY);
  if (!raw) return {};
  try {
    return storedSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

function pick(ui: string | undefined, env: string): string {
  const v = ui?.trim();
  return v ? v : env;
}

export function runtime(store: Store | null = bound): RuntimeSecrets {
  const s = store ? readStored(store) : {};
  const signature = pick(s.company?.signature, config.signature);
  const signatureEn = pick(s.company?.signatureEn, config.signatureEn);
  const signatureHtml = (s.company?.signatureHtml ?? '').trim();
  const signatureHtmlEn = (s.company?.signatureHtmlEn ?? '').trim();
  return {
    company: {
      name: pick(s.company?.name, config.company),
      signature: signatureHtml ? signaturePlainFromHtml(signatureHtml, signature) : signature,
      signatureEn: signatureHtmlEn ? signaturePlainFromHtml(signatureHtmlEn, signatureEn) : signatureEn,
      signatureHtml,
      signatureHtmlEn,
    },
    google: {
      clientId: pick(s.google?.clientId, config.google.clientId),
      clientSecret: pick(s.google?.clientSecret, config.google.clientSecret),
    },
    llm: {
      baseUrl: pick(s.llm?.baseUrl, config.llm.baseUrl),
      apiKey: pick(s.llm?.apiKey, config.llm.apiKey),
      model: pick(s.llm?.model, config.llm.model),
    },
    pipedrive: {
      domain: pick(s.pipedrive?.domain, config.pipedrive.domain),
      token: pick(s.pipedrive?.token, config.pipedrive.token),
    },
  };
}

export function publicSettings(store: Store): PublicSettings {
  const s = readStored(store);
  const r = runtime(store);
  return {
    company: {
      name: r.company.name,
      // devolve o texto curto salvo (não o derivado do HTML) para o formulário
      signature: pick(s.company?.signature, config.signature),
      signatureEn: pick(s.company?.signatureEn, config.signatureEn),
      signatureHtml: r.company.signatureHtml,
      signatureHtmlEn: r.company.signatureHtmlEn,
    },
    google: { clientId: r.google.clientId, clientSecretConfigured: !!r.google.clientSecret },
    llm: { baseUrl: r.llm.baseUrl, apiKeyConfigured: !!r.llm.apiKey, model: r.llm.model },
    pipedrive: { domain: r.pipedrive.domain, tokenConfigured: !!r.pipedrive.token },
  };
}

/** Mescla o patch na UI. Secrets: omitido = manter; "" = limpar o valor salvo na UI (volta ao .env). */
export function saveSettings(store: Store, patch: SettingsPatch): PublicSettings {
  const cur = readStored(store);
  const next: StoredSettings = {
    company: { ...cur.company },
    google: { ...cur.google },
    llm: { ...cur.llm },
    pipedrive: { ...cur.pipedrive },
  };

  if (patch.company) {
    if (patch.company.name !== undefined) next.company!.name = patch.company.name.trim();
    if (patch.company.signature !== undefined) next.company!.signature = patch.company.signature.trim();
    if (patch.company.signatureEn !== undefined) next.company!.signatureEn = patch.company.signatureEn.trim();
    if (patch.company.signatureHtml !== undefined) {
      next.company!.signatureHtml = materializeDataUrls(patch.company.signatureHtml);
    }
    if (patch.company.signatureHtmlEn !== undefined) {
      next.company!.signatureHtmlEn = materializeDataUrls(patch.company.signatureHtmlEn);
    }
  }
  if (patch.google) {
    if (patch.google.clientId !== undefined) next.google!.clientId = patch.google.clientId.trim();
    if (patch.google.clientSecret !== undefined) {
      next.google!.clientSecret = patch.google.clientSecret.trim();
    }
  }
  if (patch.llm) {
    if (patch.llm.baseUrl !== undefined) next.llm!.baseUrl = patch.llm.baseUrl.trim();
    if (patch.llm.model !== undefined) next.llm!.model = patch.llm.model.trim();
    if (patch.llm.apiKey !== undefined) next.llm!.apiKey = patch.llm.apiKey.trim();
  }
  if (patch.pipedrive) {
    if (patch.pipedrive.domain !== undefined) next.pipedrive!.domain = patch.pipedrive.domain.trim();
    if (patch.pipedrive.token !== undefined) next.pipedrive!.token = patch.pipedrive.token.trim();
  }

  store.setState(SETTINGS_KEY, JSON.stringify(next));
  return publicSettings(store);
}

/** Itens que faltam para o app funcionar (mostrados na tela). */
export function configProblems(store: Store | null = bound): string[] {
  const r = runtime(store);
  const p: string[] = [];
  if (!r.google.clientId || !r.google.clientSecret) {
    p.push('Google: Client ID e Client Secret (aba Configuração)');
  }
  if (!r.llm.apiKey) {
    p.push('LLM: chave da API — OpenAI ou Vercel AI Gateway (aba Configuração)');
  }
  if (!r.pipedrive.domain || !r.pipedrive.token) {
    p.push('Pipedrive: domínio e token (opcional — sem isso o histórico do cliente não é usado)');
  }
  return p;
}

export function setupStatus(args: {
  store: Store;
  gmailConnected: boolean;
  policiesCount: number;
}): SetupStatus {
  const r = runtime(args.store);
  const google = !!(r.google.clientId && r.google.clientSecret);
  const llm = !!r.llm.apiKey;
  const company = !!(r.company.name && (r.company.signature || r.company.signatureHtml));
  const pipedrive = !!(r.pipedrive.domain && r.pipedrive.token);
  const policies = args.policiesCount > 0;
  const gmail = args.gmailConnected;
  return {
    company, google, llm, pipedrive, policies, gmail,
    ready: google && llm && gmail,
  };
}
