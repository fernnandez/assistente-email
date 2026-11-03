# assistente-email

Assistente **local** que monitora uma caixa do Gmail, entende cada e-mail de cliente, consulta as **políticas da empresa** e o **histórico do cliente no Pipedrive**, escreve um **rascunho de resposta** e **avisa que há e-mails aguardando aprovação**. Uma tela simples permite revisar, editar, enviar ou descartar.

> Nada é enviado sem aprovação humana. Roda no computador de quem usa: sem servidor, sem custo de infraestrutura. O único custo é o do modelo de linguagem (centavos por e-mail).

```
Gmail (caixa de entrada) ──poll 60s──► [app local: Node + SQLite]
                                          ├─ políticas (.md, tudo no prompt)
                                          ├─ Pipedrive (somente leitura)
                                          ├─ modelo (API compatível com OpenAI) → JSON validado (zod)
                                          ├─ guardrails de risco (em código)
                                          └─ rascunho no Gmail + fila de aprovação
Navegador (http://127.0.0.1:3210) ◄── tela: fila, e-mail original, rascunho editável, Enviar / Descartar / Refazer
```

## Requisitos
- Node.js **≥ 20.6**
- Uma conta Gmail/Google Workspace
- Um cliente OAuth no Google Cloud — passo a passo em [`docs/CONFIGURAR-GOOGLE.md`](docs/CONFIGURAR-GOOGLE.md) (para Workspace, como app **interno**)
- Uma chave de API de modelo (OpenAI, Vercel AI Gateway ou outro compatível) e, opcionalmente, um token do Pipedrive

## Como rodar
```bash
git clone <este repositório> && cd assistente-email
npm install
cp .env.example .env        # preencha (ver abaixo)
npm run build               # compila a interface
npm start                   # sobe em http://127.0.0.1:3210
```
Abra http://127.0.0.1:3210, clique em **Conectar Gmail** e autorize. Deixe a aba aberta e clique em **Ativar avisos** para receber notificações do navegador; o número de pendências também aparece no título da aba.

O app só olha **e-mails que chegarem depois de conectar**. Quando o computador estava desligado, ao abrir ele processa o que chegou nesse intervalo.

### Configuração (`.env`)
| Variável | Para quê |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | cliente OAuth do **seu** projeto Google Cloud |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | modelo (exemplos para OpenAI, Vercel e Ollama no `.env.example`) |
| `PIPEDRIVE_DOMAIN`, `PIPEDRIVE_API_TOKEN` | histórico do cliente (opcional) |
| `COMPANY_NAME`, `SIGNATURE`, `SIGNATURE_EN` | nome da empresa e assinatura das respostas |
| `POLICIES_DIR` | pasta com as políticas em `.md` (padrão `policies/`) |
| `LEAK_PATTERNS` | termos que não podem aparecer na resposta ao cliente (sobem o risco para alto) |
| `POLL_SECONDS` | frequência de consulta ao Gmail (padrão 60) |

### Políticas da empresa
Coloque arquivos `.md` em `policies/`. **Tudo é enviado ao modelo** a cada e-mail (sem banco vetorial), o que funciona bem para dezenas de páginas; passando de `POLICIES_MAX_CHARS` (60 mil caracteres) o texto é cortado e a tela avisa. Linhas com `[INTERNO ...]` nunca vão ao modelo (use para alçadas, limites de desconto, taxas). `policies.exemplo/` traz um exemplo fictício.

Notas do Pipedrive que começam com `[INTERNO]` e atividades futuras (agenda interna) também são omitidas do modelo.

## Comandos
| Comando | O que faz |
|---|---|
| `npm start` | sobe o app (servidor + tela já compilada) |
| `npm run dev` | modo desenvolvimento (API com recarga + Vite em http://localhost:5173). **Não testado**: configurei o proxy do Vite para passar nas validações de segurança, mas não consegui rodá-lo aqui |
| `npm run build` | compila a interface |
| `npm test` | testes unitários (sem rede) |
| `npm run typecheck` | checagem de tipos |
| `npm run eval` | avalia 12 e-mails de `evals/` com **modelo e Pipedrive reais** (não usa o Gmail) |
| `npm run demo:seed` | enche a fila com e-mails de exemplo, sem Gmail, para ver a tela |

## Segurança
- O servidor escuta **somente em 127.0.0.1** e recusa `Host`/`Origin` de outros endereços e escritas sem o cabeçalho próprio (proteção contra um site aberto no navegador chamar o app: CSRF e DNS rebinding).
- Escopos do Gmail mínimos: leitura e rascunho/envio (`gmail.readonly`, `gmail.compose`). Não pede acesso total à caixa.
- O modelo **não tem ferramentas**: só recebe contexto e devolve texto; o e-mail é tratado como dado, não como instrução.
- O token de atualização do Google e os e-mails ficam em `data/assistente.db` (SQLite, **sem criptografia**) no computador. Proteja o disco/usuário do sistema. Cofre do sistema operacional é um próximo passo.
- Os e-mails e dados do Pipedrive são enviados ao provedor do modelo. Confirme se isso é compatível com as obrigações de confidencialidade da empresa.

## Estrutura
| Caminho | Conteúdo |
|---|---|
| `src/pipeline.ts` | contexto → modelo → guardrails → rascunho |
| `src/guardrails.ts` | regras de risco em código (só elevam o risco) e assinatura |
| `src/gmail.ts` | OAuth (PKCE), leitura incremental, rascunhos e envio |
| `src/pipedrive.ts` | histórico do cliente (somente leitura) |
| `src/server.ts`, `src/poller.ts` | API, eventos em tempo real e consulta periódica |
| `web/` | interface (React + Vite) |
| `prompts/system.md` | instruções e tom do modelo |
| `evals/` | e-mails de avaliação e expectativas |

## Estado do protótipo
**Verificado:** 40 testes unitários; avaliação de 12 e-mails com modelo e Pipedrive reais (11 ok + 1 observação); servidor, segurança local e tela renderizada com dados de exemplo.

**Não verificado:** o fluxo real com o Google — login (OAuth), leitura de e-mails novos, criação e envio de rascunho no Gmail. Isso depende de um cliente OAuth do tipo *App para computador* (ver `docs/CONFIGURAR-GOOGLE.md`). Esses trechos estão cobertos só por testes com um Gmail simulado. **Teste primeiro com uma caixa de teste antes de usar na caixa real.** Também não foram testados o `npm run dev` nem o uso em Windows.

**Limites conhecidos:** funciona só com o computador ligado e o app aberto; sem anexos nem imagens; e-mails longos são cortados em 4.000 caracteres; os guardrails de palavras-chave são em português.

## Próximos passos
Cofre do sistema operacional para o token; empacotar como app de desktop (Electron) se uma tela dedicada for importante; aviso no celular (ntfy/Telegram); métricas (quantos rascunhos são enviados sem edição); envio automático só para casos de risco muito baixo, com lista de categorias permitidas e revisão por amostragem.
