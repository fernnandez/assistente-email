import { describe, expect, it } from 'vitest';
import { applyGuardrails, ensureSignature } from '../src/guardrails';
import { email, okModel } from './helpers';

const run = (over = {}, e = email(), known = true) => applyGuardrails({ email: e, result: okModel(over).reply, customerKnown: known, signature: 'Equipe Acme', signatureEn: 'Acme Team', leakPatterns: 'al[cç]ada|\\[INTERNO' });

describe('guardrails', () => {
  it('mantém risco baixo quando está tudo coberto', () => {
    expect(run().risk).toBe('low');
  });
  it('reembolso sobe para alto', () => {
    expect(run({ category: 'reembolso' }).risk).toBe('high');
  });
  it('preço/comercial sobem para médio, mas não derrubam um risco alto do modelo', () => {
    expect(run({ category: 'comercial' }).risk).toBe('medium');
    expect(run({ category: 'comercial', risk: 'high' }).risk).toBe('high');
  });
  it('cliente fora do CRM sobe para médio', () => {
    expect(run({}, email(), false).risk).toBe('medium');
  });
  it('termos jurídicos no e-mail sobem para alto', () => {
    expect(run({}, email({ body: 'Vou procurar o Procon' })).risk).toBe('high');
  });
  it('menção a desconto sobe para médio', () => {
    expect(run({}, email({ body: 'Tem desconto?' })).risk).toBe('medium');
  });
  it('detecta possível vazamento de regra interna na resposta', () => {
    const r = run({ reply_body: 'Isso depende da alçada da diretoria.' });
    expect(r.risk).toBe('high');
    expect(r.guardrailReasons.join(' ')).toMatch(/vazar/);
  });
  it('saída inválida do modelo vira risco alto com texto padrão e assinatura', () => {
    const r = applyGuardrails({ email: email(), result: null, customerKnown: true, signature: 'Equipe Acme', signatureEn: 'Acme Team' });
    expect(r.risk).toBe('high');
    expect(r.reply_body).toContain('Recebemos sua mensagem');
    expect(r.reply_body.endsWith('Equipe Acme')).toBe(true);
    expect(r.internal_notes).toMatch(/não retornou uma saída válida/);
  });
  it('garante a assinatura, em português ou inglês, sem duplicar', () => {
    expect(ensureSignature('Olá, tudo certo para você.', 'Equipe Acme', 'Acme Team')).toBe('Olá, tudo certo para você.\n\nEquipe Acme');
    expect(ensureSignature('Hello, we can help you with that.', 'Equipe Acme', 'Acme Team')).toBe('Hello, we can help you with that.\n\nAcme Team');
    expect(ensureSignature('Oi!\n\nEquipe Acme', 'Equipe Acme', 'Acme Team')).toBe('Oi!\n\nEquipe Acme');
  });
});
