const env = process.env;

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(env.PORT, 3210),
  pollSeconds: num(env.POLL_SECONDS, 60),
  dataDir: env.DATA_DIR || 'data',
  policiesDir: env.POLICIES_DIR || 'policies',
  /** limite de caracteres de políticas enviados ao modelo (tudo vai no prompt; sem banco vetorial) */
  policiesMaxChars: num(env.POLICIES_MAX_CHARS, 60000),
  company: env.COMPANY_NAME || 'a empresa',
  signature: env.SIGNATURE || 'Equipe',
  signatureEn: env.SIGNATURE_EN || env.SIGNATURE || 'Team',
  /** expressões (separadas por |) que, se aparecerem na resposta, indicam possível vazamento de regra interna */
  leakPatterns: env.LEAK_PATTERNS || 'al[cç]ada|\\[INTERNO',
  google: { clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '' },
  llm: {
    baseUrl: env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.LLM_API_KEY ?? '',
    model: env.LLM_MODEL || 'gpt-4.1',
  },
  pipedrive: { domain: env.PIPEDRIVE_DOMAIN ?? '', token: env.PIPEDRIVE_API_TOKEN ?? '' },
};

export const redirectUri = (port = config.port): string => `http://127.0.0.1:${port}/oauth/callback`;

/** Itens do .env que faltam para o app funcionar (mostrados na tela inicial). */
export function configProblems(): string[] {
  const p: string[] = [];
  if (!config.google.clientId || !config.google.clientSecret) p.push('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (cliente OAuth do Google Cloud)');
  if (!config.llm.apiKey) p.push('LLM_API_KEY (chave da OpenAI ou do gateway)');
  if (!config.pipedrive.domain || !config.pipedrive.token) p.push('PIPEDRIVE_DOMAIN / PIPEDRIVE_API_TOKEN (opcional: sem isso o histórico do cliente não é usado)');
  return p;
}
