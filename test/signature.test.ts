import { describe, expect, it } from 'vitest';
import { composeMailBodies, plainToHtml } from '../src/signature';

describe('composeMailBodies', () => {
  it('sem HTML só devolve texto com assinatura curta', () => {
    const r = composeMailBodies('Olá cliente', {
      signature: 'Equipe Acme', signatureEn: 'Acme Team', signatureHtml: '', signatureHtmlEn: '',
    });
    expect(r.text).toContain('Equipe Acme');
    expect(r.html).toBeUndefined();
    expect(r.images).toHaveLength(0);
  });

  it('com HTML gera parte html e mantém texto', () => {
    const r = composeMailBodies('Hello there', {
      signature: 'Equipe Acme',
      signatureEn: 'Acme Team',
      signatureHtml: '<b>Equipe</b>',
      signatureHtmlEn: '<b>Acme Team</b><br>Sales',
    });
    expect(r.text).toContain('Acme Team');
    expect(r.html).toContain('<b>Acme Team</b>');
    expect(r.html).toContain(plainToHtml('Hello there').slice(0, 10));
  });
});
