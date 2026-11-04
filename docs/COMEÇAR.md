# Começar (no seu Mac)

Este app roda **só no seu computador**. Nada é enviado ao cliente sem você aprovar na tela.

> Prefere pedir para o **Claude** (ou outro assistente) configurar? Abra o projeto nessa ferramenta e diga: *“leia o CLAUDE.md e configure o assistente de e-mail pra mim”*. Ele vai pedir as chaves e fazer o setup.

## 1. Abrir o app
1. Instale o **Node.js LTS** em https://nodejs.org (só na primeira vez).
2. Na pasta do projeto, dê um **duplo clique** em `Abrir Assistente.command`.
3. Se o macOS reclamar, clique com o botão direito → *Abrir*.
4. O Terminal pode piscar e **fecha sozinho** — o app continua em segundo plano.
5. O navegador abre em http://127.0.0.1:3210. Na 1ª vez pode demorar 1–2 minutos (instalação); aparece uma notificação quando estiver pronto.
6. Para parar: duplo clique em `Encerrar Assistente.command`.

## 2. Configuração inicial (aba Configuração)
O app já abre nessa aba se faltar algo. Preencha e clique em **Salvar configuração**:

1. **Empresa** — nome, assinatura curta (texto) e assinatura HTML (pode colar a do Gmail e **Inserir imagem**).
2. **Modelo (LLM)** — botão *Vercel AI Gateway* + cole a chave da API.
3. **Google** — Client ID e Client Secret (passo a passo em `CONFIGURAR-GOOGLE.md` em Documentos). **Salve**, depois **Conectar Gmail** e autorize a conta de trabalho.
4. **Pipedrive** (opcional) — domínio (antes de `.pipedrive.com`) e token de API.
5. **Google Drive** (opcional) — ative a Drive API no mesmo projeto GCP, reconecte o Gmail, marque *Consultar documentos*, cole a pasta-raiz dos clientes. Detalhes em `CONFIGURAR-GOOGLE.md`.

Checklist na própria tela mostra o que já está ok.

## 3. Políticas (aba Documentos → Políticas)
Regras da empresa que o modelo usa para rascunhar.

- **Nova política** — crie um `.md` e cole/edite o texto.
- **Copiar exemplos** — traz textos fictícios para você adaptar.
- Linhas com `[INTERNO …]` **não** vão para o modelo (alçadas, descontos internos, etc.).

## 4. Uso no dia a dia
1. Duplo clique em `Abrir Assistente.command` (se já estiver rodando, só reabre o navegador).
2. Deixe a **aba do navegador** aberta; use **Ativar avisos** se quiser notificação de e-mail novo.
3. Na **Fila**, três abas claras (e o mesmo no Gmail):
   - **Não lidos** — ainda na fila / Caixa de entrada
   - **Respondidos** — **Enviar** pelo app, ou **Já respondi** se você já respondeu no Gmail (sai da inbox + marcador Respondidos)
   - **Arquivados** — você clicou em **Arquivar** (sai da inbox + marcador Arquivados)
   - **Descartar** só tira do app (e-mail pode continuar na inbox)
   - Se o e-mail já foi tratado fora do assistente e ainda aparece em Não lidos: use **Já respondi**
   - “Todos os e-mails” no Gmail sempre mostra o histórico — o que esvazia é a **Caixa de entrada**.
4. **Sincronizar anteriores** busca não lidos dos últimos 7 dias (até 30) que chegaram antes do app estar ligado — gera rascunhos (usa o modelo).
5. Ao terminar o dia (opcional): `Encerrar Assistente.command`.

O poll automático só pega e-mails **novos** depois da conexão; use **Sincronizar anteriores** para o que já estava na caixa.

## Se algo der errado
- Log: `data/assistente.log` (na pasta do projeto).
- Porta ocupada / não abre: use `Encerrar Assistente.command` e abra de novo.
- Ainda sem Node: https://nodejs.org (LTS).
