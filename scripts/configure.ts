/**
 * Configura o app sem abrir a UI (útil para assistentes de IA).
 * Grava em data/assistente.db — nunca imprime segredos.
 *
 * Exemplos:
 *   npx tsx --env-file=.env scripts/configure.ts --company "Acme" --signature "Equipe Acme" \
 *     --llm-key "$LLM_API_KEY" --google-id "$GID" --google-secret "$GSEC"
 *   npx tsx scripts/configure.ts --seed-policies
 *   npx tsx scripts/configure.ts --status
 */
import { existsSync, copyFileSync } from 'node:fs';
import { Store } from '../src/db';
import { seedExamplePolicies } from '../src/docsfiles';
import { bindSettings, publicSettings, saveSettings, setupStatus } from '../src/settings';
import { loadPolicies } from '../src/policies';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) return '';
  return v;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

if (!existsSync('.env') && existsSync('.env.example')) {
  copyFileSync('.env.example', '.env');
  console.log('Criado .env a partir de .env.example');
}

const store = new Store();
bindSettings(store);

if (hasFlag('status')) {
  const pol = loadPolicies();
  const pub = publicSettings(store);
  const setup = setupStatus({
    store,
    gmailConnected: !!store.getState('google_refresh_token') && store.getState('google_needs_reauth') !== '1',
    policiesCount: pol.files.length,
  });
  console.log(JSON.stringify({
    setup,
    company: pub.company.name,
    googleConfigured: pub.google.clientSecretConfigured && !!pub.google.clientId,
    llmConfigured: pub.llm.apiKeyConfigured,
    llmModel: pub.llm.model,
    pipedriveConfigured: pub.pipedrive.tokenConfigured && !!pub.pipedrive.domain,
    policies: pol.files,
    gmailEmail: store.getState('google_email'),
  }, null, 2));
  process.exit(0);
}

if (hasFlag('seed-policies')) {
  const r = seedExamplePolicies();
  console.log(`Políticas: copiados ${r.copied.length}, ignorados (já existiam) ${r.skipped.length}`);
  if (r.copied.length) console.log('  +', r.copied.join(', '));
}

const companyName = arg('company');
const signature = arg('signature');
const signatureEn = arg('signature-en');
const llmKey = arg('llm-key');
const llmUrl = arg('llm-url');
const llmModel = arg('llm-model');
const googleId = arg('google-id');
const googleSecret = arg('google-secret');
const pdDomain = arg('pipedrive-domain');
const pdToken = arg('pipedrive-token');

const touched =
  companyName !== undefined || signature !== undefined || signatureEn !== undefined ||
  llmKey !== undefined || llmUrl !== undefined || llmModel !== undefined ||
  googleId !== undefined || googleSecret !== undefined ||
  pdDomain !== undefined || pdToken !== undefined;

if (touched) {
  saveSettings(store, {
    company: {
      ...(companyName !== undefined ? { name: companyName } : {}),
      ...(signature !== undefined ? { signature } : {}),
      ...(signatureEn !== undefined ? { signatureEn } : {}),
    },
    llm: {
      ...(llmKey !== undefined ? { apiKey: llmKey } : {}),
      ...(llmUrl !== undefined ? { baseUrl: llmUrl } : {}),
      ...(llmModel !== undefined ? { model: llmModel } : {}),
    },
    google: {
      ...(googleId !== undefined ? { clientId: googleId } : {}),
      ...(googleSecret !== undefined ? { clientSecret: googleSecret } : {}),
    },
    pipedrive: {
      ...(pdDomain !== undefined ? { domain: pdDomain } : {}),
      ...(pdToken !== undefined ? { token: pdToken } : {}),
    },
  });
  console.log('Configuração salva em data/assistente.db (segredos não são exibidos).');
}

if (!touched && !hasFlag('seed-policies') && !hasFlag('status')) {
  console.log(`Uso:
  npx tsx scripts/configure.ts --status
  npx tsx scripts/configure.ts --seed-policies
  npx tsx scripts/configure.ts \\
    --company "Nome" --signature "Equipe Nome" --signature-en "Name Team" \\
    --llm-key "…" --llm-url "https://ai-gateway.vercel.sh/v1" --llm-model "openai/gpt-4.1" \\
    --google-id "….apps.googleusercontent.com" --google-secret "…" \\
    --pipedrive-domain "empresa" --pipedrive-token "…"

Depois: npm run build && npm start
A usuária ainda precisa abrir http://127.0.0.1:3210 e clicar em Conectar Gmail.
Leia CLAUDE.md se for um assistente de IA fazendo o setup.
`);
}
