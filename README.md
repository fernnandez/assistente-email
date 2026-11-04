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

## Como rodar (uso no dia a dia — Mac)

1. Instale o **Node.js LTS** em https://nodejs.org (só na primeira vez).
2. Baixe/clone este repositório e abra a pasta.
3. **Duplo clique** em `Abrir Assistente.command` (se o macOS bloquear: botão direito → *Abrir*).
4. O Terminal fecha sozinho; o app sobe **em segundo plano** e o navegador abre em http://127.0.0.1:3210.
5. Na primeira vez vá em **Configuração**: empresa, chave do modelo, Google, Pipedrive (opcional). Salve e **Conectar Gmail**.
6. Em **Documentos**, leia `COMEÇAR.md` / `CONFIGURAR-GOOGLE.md` e cadastre as **políticas** (ou *Copiar exemplos* e edite).
7. Para parar: `Encerrar Assistente.command`.

**Pedindo para o Claude configurar:** abra esta pasta no Claude/Cursor e diga *“leia o CLAUDE.md e configure o assistente de e-mail pra mim”*. O playbook está em [`CLAUDE.md`](CLAUDE.md); o comando headless é `npm run configure`.

Nada é enviado sem aprovação na **Fila**. Clique em **Ativar avisos** se quiser notificação no navegador.

### Como rodar (terminal)
```bash
git clone <este repositório> && cd assistente-email
npm install
cp .env.example .env   # opcional — o restante vai pela tela
npm run build && npm start
# ou: npm run abrir
```

O app só olha **e-mails que chegarem depois de conectar**. Quando o computador estava desligado, ao abrir ele processa o que chegou nesse intervalo.

### Configuração na tela (recomendado)
Na aba **Configuração** você define:
- **Google** — Client ID e Client Secret (passo a passo em Documentos → `CONFIGURAR-GOOGLE.md`)
- **LLM** — URL, chave e modelo (preset Vercel AI Gateway ou OpenAI)
- **Pipedrive** — domínio e token (opcional)

Os segredos ficam em `data/assistente.db` neste computador. Valores no `.env` continuam valendo como reserva se o campo correspondente na tela estiver vazio.

### `.env` (empresa e avançado)
| Variável | Para quê |
|---|---|
| `COMPANY_NAME`, `SIGNATURE`, `SIGNATURE_EN` | nome da empresa e assinatura das respostas |
| `POLICIES_DIR` | pasta com as políticas em `.md` (padrão `policies/`) |
| `LEAK_PATTERNS` | termos que não podem aparecer na resposta ao cliente (sobem o risco para alto) |
| `POLL_SECONDS` | frequência de consulta ao Gmail (padrão 60) |
| `GOOGLE_*`, `LLM_*`, `PIPEDRIVE_*` | opcional — mesma coisa que a aba Configuração (fallback) |

### Políticas da empresa
Edite na aba **Documentos → Políticas**, ou coloque arquivos `.md` em `policies/`. **Tudo é enviado ao modelo** a cada e-mail (sem banco vetorial), o que funciona bem para dezenas de páginas; passando de `POLICIES_MAX_CHARS` (60 mil caracteres) o texto é cortado e a tela avisa. Linhas com `[INTERNO ...]` nunca vão ao modelo (use para alçadas, limites de desconto, taxas). `policies.exemplo/` traz um exemplo fictício.

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
- Escopos do Gmail: leitura, rascunho/envio e modificar labels (`gmail.readonly`, `gmail.compose`, `gmail.modify` — para arquivar). Não pede acesso total à caixa.
- O modelo **não tem ferramentas**: só recebe contexto e devolve texto; o e-mail é tratado como dado, não como instrução.
- O token de atualização do Google, as chaves salvas na Configuração e os e-mails ficam em `data/assistente.db` (SQLite, **sem criptografia**) no computador. Proteja o disco/usuário do sistema. Cofre do sistema operacional é um próximo passo.
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
