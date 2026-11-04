export type Risk = 'low' | 'medium' | 'high';

export const CATEGORIES = ['duvida_produto', 'preco', 'suporte', 'reembolso', 'comercial', 'outro'] as const;
export type Category = (typeof CATEGORIES)[number];

export type ItemStatus = 'pending' | 'sent' | 'discarded' | 'archived' | 'ignored' | 'error';

/** E-mail recebido, já normalizado. */
export interface IncomingEmail {
  id: string; // id da mensagem no Gmail
  threadId: string;
  messageIdHeader: string; // cabeçalho Message-ID (para encadear a resposta)
  references: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
  receivedAt: string; // ISO
  /** true para no-reply, listas, respostas automáticas */
  automated: boolean;
}

export interface Customer {
  known: boolean;
  personId: number | null;
  name: string | null;
  org: string | null;
  /** Link/ID da pasta no Drive vindo de campo personalizado do Pipedrive (negócio). */
  driveFolderUrl: string | null;
  /** texto com o histórico, pronto para o prompt */
  text: string;
}

/** Saída estruturada do modelo. */
export interface ModelReply {
  category: Category;
  risk: Risk;
  risk_reasons: string;
  reply_subject: string;
  reply_body: string;
  internal_notes: string;
}

/** Resposta depois dos guardrails. */
export interface GuardedReply extends ModelReply {
  guardrailReasons: string[];
}

export interface Item {
  id: number;
  gmail_message_id: string;
  thread_id: string;
  message_id_header: string;
  references_header: string;
  from_email: string;
  from_name: string;
  subject: string;
  body: string;
  received_at: string;
  status: ItemStatus;
  risk: Risk | null;
  category: Category | null;
  risk_reasons: string | null;
  reply_subject: string | null;
  reply_body: string | null;
  internal_notes: string | null;
  draft_id: string | null;
  customer_json: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
