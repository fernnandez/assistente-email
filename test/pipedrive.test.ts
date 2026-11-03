import { describe, expect, it } from 'vitest';
import { formatCustomer } from '../src/pipedrive';

const base = { name: 'Bruna', org: 'Sycode', stages: { 10: 'Negociações', 11: 'Contrato assinado' } };
const deal = (o = {}) => ({ title: 'Plano', status: 'open', stage_id: 10, value: 100, currency: 'BRL', add_time: '2026-09-15 10:00:00', ...o });

describe('formatCustomer', () => {
  it('não inclui notas [INTERNO] nem atividades futuras (agenda interna)', () => {
    const t = formatCustomer({
      ...base, deals: [deal()],
      notes: [{ content: 'Cliente pediu desconto.', add_time: '2026-10-14 11:00:00' }, { content: '[INTERNO] aguardando alçada da diretoria', add_time: '2026-10-27 16:30:00' }],
      activities: [{ subject: 'Demo', type: 'meeting', due_date: '2026-09-18', done: true }, { subject: 'Retorno sobre desconto', type: 'call', due_date: '2026-11-06', done: false }],
    });
    expect(t).toContain('Cliente pediu desconto');
    expect(t).toContain('Demo');
    expect(t).not.toMatch(/alçada|INTERNO|Retorno sobre desconto/);
  });
  it('resume a situação do cliente', () => {
    const f = (deals: ReturnType<typeof deal>[]) => formatCustomer({ ...base, deals, notes: [], activities: [] });
    expect(f([deal({ status: 'won', stage_id: 11 }), deal()])).toContain('CLIENTE ATIVO com negócio em andamento');
    expect(f([deal()])).toContain('EM NEGOCIAÇÃO');
    expect(f([deal({ status: 'won' })])).toContain('Situação: CLIENTE ATIVO');
    expect(f([deal({ status: 'lost', lost_reason: 'Preço' })])).toMatch(/EX-CLIENTE[\s\S]*motivo: Preço/);
    expect(f([])).toContain('contato sem negócios');
  });
  it('mostra o nome da etapa e as datas do negócio', () => {
    const t = formatCustomer({ ...base, deals: [deal({ won_time: '2026-10-01 09:00:00' })], notes: [], activities: [] });
    expect(t).toContain('etapa: Negociações');
    expect(t).toContain('criado em 2026-09-15');
    expect(t).toContain('ganho em 2026-10-01');
  });
});
