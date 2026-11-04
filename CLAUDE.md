# Instruções para assistentes de IA (Claude, Cursor, etc.)

Este repositório é um **assistente local de e-mail**. A usuária final (não técnica) vai pedir que você configure tudo na máquina **dela**. Siga este playbook.

## Objetivo
Deixar o app rodando em `http://127.0.0.1:3210`, com:
- empresa / assinatura
- chave do modelo (em geral **Vercel AI Gateway**)
- Google OAuth (Client ID + Secret)
- Pipedrive (opcional)
- políticas em `policies/*.md`

**Nada é enviado ao cliente sem aprovação humana na UI.**

## Regras absolutas
1. **Nunca** commitar `.env`, `data/`, tokens, Client Secret, API keys ou conteúdo real de e-mail.
2. **Nunca** imprimir segredos no chat/terminal depois de salvos. Use `npm run configure -- --status` (mostra só flags booleanas).
3. Preferir gravar config com `scripts/configure.ts` (SQLite) ou pela aba Configuração — não espalhar secrets em arquivos versionados.
4. OAuth do Gmail **exige clique humano** no navegador (“Conectar Gmail”). Você prepara tudo; ela autoriza.
5. App só escuta `127.0.0.1` — não exponha na rede.

## Checklist (faça nesta ordem)

### 1. Pré-requisitos
- Node.js **≥ 20.6** (`node -v`). Se faltar: orientar instalar LTS em https://nodejs.org.
- Estar na raiz do repo.

### 2. Instalar e build
```bash
test -f .env || cp .env.example .env
npm install
npm run build
```

### 3. Pedir dados à usuária (cole no chat com ela; não invente)
Peça explicitamente (pode ir aos poucos):

| Dado | Obrigatório? | Onde ela pega |
|---|---|---|
| Nome da empresa | sim | ela sabe |
| Assinatura PT / EN | sim | ela define |
| `LLM_API_KEY` (+ se não for Vercel, URL/modelo) | sim | Vercel AI Gateway / OpenAI |
| `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` | sim | Google Cloud — guia `docs/CONFIGURAR-GOOGLE.md` |
| Pipedrive domain + API token | não | Pipedrive → settings → API |
| Textos de política (`.md` ou texto) | sim, para respostas úteis | documentos internos dela |

Se ela ainda **não tem** o cliente OAuth Google: abra/mostre `docs/CONFIGURAR-GOOGLE.md` e ajude passo a passo (app **interno** no Workspace). Não pule isso.

### 4. Gravar configuração (sem UI)
Com os valores que ela colou (substitua; não logue de volta):

```bash
npm run configure -- \
  --company "NOME" \
  --signature "Equipe NOME" \
  --signature-en "NOME Team" \
  --llm-key "CHAVE" \
  --llm-url "https://ai-gateway.vercel.sh/v1" \
  --llm-model "openai/gpt-4.1" \
  --google-id "….apps.googleusercontent.com" \
  --google-secret "SEGredo" \
  --pipedrive-domain "dominio" \
  --pipedrive-token "token" \
  --drive-enabled --drive-root "FOLDER_ID_OU_URL" --drive-mode pipedrive_org
```

Drive (opcional): mesma OAuth do Gmail com escopo `drive.readonly`. Ativar **Google Drive API** no GCP; a usuária deve **Desconectar → Conectar Gmail** de novo. Pasta-raiz = pasta onde ficam as pastas dos clientes.

Verificar (sem secrets):
```bash
npm run configure -- --status
```

### 5. Políticas
- Se ela mandar textos: grave em `policies/nome.md` (UTF-8). Linhas com `[INTERNO …]` não vão ao modelo.
- Se quiser exemplos para editar: `npm run configure -- --seed-policies`
- Não use `policies.exemplo/` em produção sem revisar — é fictício.

### 6. Subir o app
```bash
npm start
```
No macOS dela (preferível no dia a dia): duplo clique em **`Abrir Assistente.command`** — sobe em segundo plano, abre o navegador e **fecha o Terminal**. Para parar: **`Encerrar Assistente.command`**. Log: `data/assistente.log`.

Abrir http://127.0.0.1:3210 → pedir que ela clique **Conectar Gmail** e autorize a conta de trabalho.

### 7. Validar
- Status na UI: Gmail conectado, sem avisos críticos de Google/LLM.
- `npm run configure -- --status` → `setup.ready` tende a true depois do OAuth (`gmail: true`).
- Ela usa a **Fila** no navegador; o servidor fica em background até encerrar.

## O que você NÃO precisa fazer
- Deploy em servidor / Docker / expor porta pública
- Configurar CI
- Commitar a config dela
- Reescrever o produto “só para facilitar” no meio do setup — use as ferramentas acima

## Arquivos úteis
| Arquivo | Para quê |
|---|---|
| `docs/COMEÇAR.md` | guia humano curto |
| `docs/CONFIGURAR-GOOGLE.md` | OAuth Workspace passo a passo |
| `Abrir Assistente.command` | start em background + browser (Terminal some) |
| `Encerrar Assistente.command` | para o processo na porta 3210 |
| `scripts/configure.ts` | setup headless para agentes |
| `web/` + `/api/settings` | UI e API de configuração |

## Se algo falhar
- `EADDRINUSE 3210`: matar processo na porta e subir de novo.
- Google “redirect_uri”: o app usa `http://127.0.0.1:3210/oauth/callback` (Desktop app + PKCE).
- Build da UI: `npm run build` antes de `npm start` se `web/dist` não existir.
- `better-sqlite3` / node-gyp: garantir Node LTS e ferramentas de build do macOS (`xcode-select --install`) se o `npm install` quebrar.
