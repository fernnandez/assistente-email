import { config } from './config';
import type { GuardedReply, IncomingEmail, ModelReply, Risk } from './types';

const ORDER: Record<Risk, number> = { low: 0, medium: 1, high: 2 };

/**
 * Regras em código aplicadas depois do modelo. Só ELEVAM o risco (nunca baixam) e garantem a assinatura.
 * `result` é null quando o modelo não devolveu uma saída válida.
 */
export function applyGuardrails(args: {
  email: Pick<IncomingEmail, 'subject' | 'body' | 'fromName'>;
  result: ModelReply | null;
  customerKnown: boolean;
  leakPatterns?: string;
  signature?: string;
  signatureEn?: string;
}): GuardedReply {
  const { email, result, customerKnown } = args;
  const leak = new RegExp(`(${args.leakPatterns ?? config.leakPatterns})`, 'i');
  const reasons: string[] = [];
  let risk: Risk = result?.risk ?? 'high';
  if (!result) reasons.push('resposta do modelo inválida');
  else if (result.risk_reasons) reasons.push(result.risk_reasons);

  const bump = (level: Risk, why: string) => {
    if (ORDER[level] > ORDER[risk]) risk = level;
    reasons.push(`[guardrail] ${why}`);
  };

  const category = result?.category ?? 'outro';
  const text = `${email.subject} ${email.body}`;
  if (category === 'reembolso') bump('high', 'categoria reembolso');
  if (category === 'preco' || category === 'comercial') bump('medium', `categoria ${category}`);
  if (!customerKnown) bump('medium', 'cliente não encontrado no CRM');
  if (/(procon|advogad|jur[ií]dic|process(ar|o judicial)|a[cç][aã]o judicial|lgpd|reclame aqui)/i.test(text)) bump('high', 'termos jurídicos/reputação no e-mail');
  if (/(desconto|reembolso|estorno|dinheiro de volta)/i.test(text)) bump('medium', 'menciona desconto/reembolso');
  if (result?.reply_body && leak.test(result.reply_body)) bump('high', 'resposta pode vazar regra interna');

  const fallbackBody = `Olá${email.fromName ? ' ' + email.fromName.split(' ')[0] : ''},\n\nRecebemos sua mensagem e vamos analisá-la internamente. Retornaremos em breve.`;
  const body = result?.reply_body?.trim() || fallbackBody;
  return {
    category,
    risk,
    risk_reasons: reasons.join('; '),
    reply_subject: result?.reply_subject?.trim() || `Re: ${email.subject}`,
    reply_body: ensureSignature(body, args.signature ?? config.signature, args.signatureEn ?? config.signatureEn),
    internal_notes: result?.internal_notes || (result ? '' : 'O modelo não retornou uma saída válida: usado texto padrão. Revise com atenção.'),
    guardrailReasons: reasons.filter((r) => r.startsWith('[guardrail]')),
  };
}

/** Garante a assinatura no fim (na língua do texto: PT por padrão, EN se parecer inglês). */
export function ensureSignature(body: string, signature: string, signatureEn: string): string {
  const text = body.trim();
  const tail = text.slice(-120).toLowerCase();
  if (tail.includes(signature.toLowerCase()) || tail.includes(signatureEn.toLowerCase())) return text;
  const english = /\b(the|you|your|our|please|regards|hello|hi)\b/i.test(text) && !/\b(voc[eê]|nosso|nossa|obrigad|para)\b/i.test(text);
  return `${text}\n\n${english ? signatureEn : signature}`;
}
