# Configurar o Google (Workspace) — passo a passo para a administradora

Objetivo: criar um cliente OAuth **interno** da organização, para o assistente ler a caixa e criar/enviar rascunhos.
Tempo: ~15 minutos. Custo: zero (a Gmail API não exige faturamento).

> Pré-requisito: conta de **administradora do Google Workspace** e acesso à organização no Google Cloud.

## 1. Entrar no console certo
1. Acesse https://console.cloud.google.com logada com a conta de administradora.
2. No seletor de projetos (barra superior), confirme que aparece a **organização do domínio**. Se não aparecer organização nenhuma, pare e avise.

## 2. Criar um projeto dentro da organização
- *Novo projeto* → nome `assistente-email` → em **Local / Organização** escolha a organização do domínio (não "Sem organização") → *Criar*.
- Se der erro de permissão: em *IAM e administrador* (nível da organização) conceda a si mesma o papel *Project Creator* (ou *Organization Administrator*).

> Usar um projeto novo é mais seguro que reaproveitar um existente: cada projeto tem uma única tela de consentimento, e mudá-la para "Interno" pode afetar outros apps.

## 3. Ativar a Gmail API
*APIs e serviços → Biblioteca → Gmail API → Ativar* (com o projeto novo selecionado).

## 4. Tela de consentimento como **Interna**
1. *APIs e serviços → Tela de permissão OAuth* (ou *Google Auth Platform*) → *Começar*.
2. Nome do app (`Assistente de e-mail`), e-mail de suporte e de contato.
3. Em **Público (Audience)**, escolha **Interno**. Se a opção não aparecer, o projeto não está na organização: volte ao passo 2.
4. Em **Acesso a dados (Data access)**, adicione estes escopos:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.modify` (arquivar / tirar da inbox)

Se o app já estava conectado sem o escopo `modify`, em **Configuração** use **Desconectar** e **Conectar Gmail** de novo para autorizar.

## 5. Criar o cliente OAuth
*Clientes → Criar cliente* → tipo **App para computador (Desktop app)** → nome `assistente-desktop` → *Criar*.
Anote o **ID do cliente** e a **chave secreta do cliente**. Para apps de computador a chave não é secreta de verdade, mas **não a coloque em repositório público**.

## 6. Liberar no Admin console (só se necessário)
https://admin.google.com → *Segurança → Controle de acesso e de dados → Controles de API*
(os nomes do menu variam com o idioma). Se o acesso de apps de terceiros estiver restrito, configure o app pelo **ID do cliente** e marque como **Confiável**. Se não houver restrição, não precisa fazer nada.

## 7. Colar na aplicação
1. `npm start` e abra http://127.0.0.1:3210.
2. Vá em **Configuração → Google**.
3. Cole o **ID do cliente** e a **chave secreta do cliente** → *Salvar configuração*.
4. Clique em **Conectar Gmail**. A autorização é feita com a conta dela, no navegador.

(Opcional: as mesmas variáveis `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` no `.env` ainda funcionam como reserva se a tela estiver vazia.)

## O que NÃO foi comprovado
- Pela documentação do Google, apps internos não precisam de verificação e o token não deve expirar em 7 dias (a regra dos 7 dias vale para apps externos em modo de teste). **Confirme na prática:** anote a data da primeira autorização e verifique, uma semana depois, se o app continua conectado.
