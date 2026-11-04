/**
 * Popula a UI com e-mails fake em Não lidos / Respondidos / Arquivados (sem Gmail/LLM).
 * Uso: npx tsx --env-file=.env scripts/demo-ui-seed.ts
 */
import { Store } from '../src/db';
import type { NewItem } from '../src/db';
import type { Risk } from '../src/types';

const store = new Store();
store.db.exec('DELETE FROM items'); // fila limpa só com os exemplos da UI

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

function item(over: Partial<NewItem> & Pick<NewItem, 'gmail_message_id' | 'from_email' | 'from_name' | 'subject' | 'body' | 'status' | 'received_at'>): NewItem {
  return {
    thread_id: `ui-demo-t-${over.gmail_message_id}`,
    message_id_header: `<${over.gmail_message_id}@local>`,
    references_header: '',
    risk: (over.risk ?? 'low') as Risk,
    category: over.category ?? 'suporte',
    risk_reasons: over.risk_reasons ?? 'exemplo local',
    reply_subject: over.reply_subject ?? `Re: ${over.subject}`,
    reply_body: over.reply_body ?? null,
    internal_notes: over.internal_notes ?? null,
    draft_id: over.status === 'pending' ? `ui-draft-${over.gmail_message_id}` : null,
    customer_json: over.customer_json ?? JSON.stringify({ known: true, name: over.from_name, org: 'Cliente Demo', text: `Cliente: ${over.from_name}\nSituação: CLIENTE ATIVO` }),
    model: 'demo-ui',
    tokens_in: 100,
    tokens_out: 50,
    error: over.error ?? null,
    ...over,
  };
}

const seeds: NewItem[] = [
  // Não lidos (pending)
  item({
    gmail_message_id: 'ui-demo-u1',
    from_email: 'maria@padaria.com',
    from_name: 'Maria Souza',
    subject: 'Prazo de suporte no plano Pro',
    body: 'Oi! Qual o prazo de primeira resposta no plano Pro? Preciso alinhar com a equipe.',
    status: 'pending',
    received_at: ago(25),
    risk: 'low',
    category: 'suporte',
    reply_body: 'Olá Maria,\n\nNo plano Pro a primeira resposta é em até 8 horas úteis.\n\nEquipe Demo',
    internal_notes: 'Coberto pela política de SLA.',
  }),
  item({
    gmail_message_id: 'ui-demo-u2',
    from_email: 'joao@sycode.io',
    from_name: 'João Lima',
    subject: 'Pedido de desconto anual',
    body: 'Conseguimos 20% de desconto se fecharmos o anual ainda este mês?',
    status: 'pending',
    received_at: ago(80),
    risk: 'medium',
    category: 'preco',
    risk_reasons: 'categoria preco; menciona desconto',
    reply_body: 'Olá João,\n\nConsigo verificar as condições do plano anual e te retorno com o que é possível dentro da política comercial.\n\nEquipe Demo',
    internal_notes: 'Não prometer desconto sem alçada.',
  }),
  item({
    gmail_message_id: 'ui-demo-u3',
    from_email: 'ana@novaempresa.com',
    from_name: 'Ana Costa',
    subject: 'Cancelamento e reembolso',
    body: 'Quero cancelar hoje e pedir reembolso integral. Meu advogado acompanha o caso.',
    status: 'pending',
    received_at: ago(140),
    risk: 'high',
    category: 'reembolso',
    risk_reasons: 'categoria reembolso; termos jurídicos no e-mail',
    reply_body: 'Olá Ana,\n\nRecebemos sua solicitação e vamos analisar com cuidado. Retornaremos em breve com os próximos passos.\n\nEquipe Demo',
    internal_notes: 'Risco alto — revisar com calma antes de enviar.',
    customer_json: JSON.stringify({ known: false, name: null, org: null, text: 'Contato NOVO' }),
  }),

  // Respondidos (sent)
  item({
    gmail_message_id: 'ui-demo-s1',
    from_email: 'pedro@loja.com',
    from_name: 'Pedro Alves',
    subject: 'Nota fiscal de março',
    body: 'Podem reenviar a NF do mês passado?',
    status: 'sent',
    received_at: ago(60 * 6),
    risk: 'low',
    category: 'outro',
    reply_body: 'Olá Pedro,\n\nReenviamos a nota fiscal para este e-mail. Qualquer dúvida, estamos à disposição.\n\nEquipe Demo',
  }),
  item({
    gmail_message_id: 'ui-demo-s2',
    from_email: 'lucia@agencia.com',
    from_name: 'Lúcia Mendes',
    subject: 'Acesso de novo usuário',
    body: 'Preciso liberar acesso para a Carla (carla@agencia.com).',
    status: 'sent',
    received_at: ago(60 * 20),
    risk: 'low',
    category: 'suporte',
    reply_body: 'Olá Lúcia,\n\nConvite enviado para carla@agencia.com. Ela já pode criar a senha.\n\nEquipe Demo',
  }),

  // Arquivados
  item({
    gmail_message_id: 'ui-demo-a1',
    from_email: 'spam@newsletter.example',
    from_name: 'Newsletter',
    subject: 'Promoção da semana',
    body: 'Não precisamos responder — só arquivar.',
    status: 'archived',
    received_at: ago(60 * 30),
    risk: 'low',
    category: 'outro',
    reply_body: null,
    internal_notes: 'Arquivado sem resposta.',
    customer_json: JSON.stringify({ known: false, name: null, org: null, text: 'Contato NOVO' }),
  }),
  item({
    gmail_message_id: 'ui-demo-a2',
    from_email: 'ricardo@cliente.com',
    from_name: 'Ricardo Nunes',
    subject: 'Duplicado — já resolvido no telefone',
    body: 'Pode ignorar, falamos por telefone.',
    status: 'archived',
    received_at: ago(60 * 48),
    risk: 'low',
    category: 'suporte',
    reply_body: 'Olá Ricardo,\n\nPerfeito — seguimos com o combinado na ligação.\n\nEquipe Demo',
  }),
];

for (const s of seeds) store.insertItem(s);

const c = store.counts();
console.log(`Demo UI: não lidos=${c.pending}, respondidos=${c.sent}, arquivados=${c.archived}`);
console.log('Abra http://127.0.0.1:3210 e alterne as abas.');
