import { describe, expect, it } from 'vitest';
import {
  emailDomain,
  extractHints,
  formatDriveContext,
  normalizeName,
  parseDomainMap,
  parseFolderId,
  rankFiles,
  scoreFolderName,
  shouldConsultDrive,
} from '../src/drive';
import { bindSettings, saveSettings } from '../src/settings';
import { Store } from '../src/db';
import { email } from './helpers';

describe('drive helpers', () => {
  it('parseFolderId aceita URL e ID', () => {
    expect(parseFolderId('https://drive.google.com/drive/folders/abcXYZ12345')).toBe('abcXYZ12345');
    expect(parseFolderId('  abcXYZ12345  ')).toBe('abcXYZ12345');
    expect(parseFolderId('nope')).toBeNull();
  });

  it('parseDomainMap lê linhas dominio=id', () => {
    const map = parseDomainMap('# c\nacme.com=folderAcme99\n@outro.io = https://drive.google.com/drive/folders/foldOutro1\n');
    expect(map['acme.com']).toBe('folderAcme99');
    expect(map['outro.io']).toBe('foldOutro1');
  });

  it('scoreFolderName prioriza match exato / inclusão', () => {
    expect(scoreFolderName('Acme Ltda', ['Acme'])).toBeGreaterThanOrEqual(70);
    expect(scoreFolderName('Acme Ltda', ['Acme Ltda'])).toBe(100);
    expect(scoreFolderName('Outro', ['Acme'])).toBe(0);
  });

  it('rankFiles sobe arquivos citados no e-mail', () => {
    const ranked = rankFiles(
      [
        { id: '1', name: 'outro.pdf', mimeType: 'application/pdf', modifiedTime: '2024-01-01', webViewLink: '', read: false },
        { id: '2', name: 'Contrato_2024.pdf', mimeType: 'application/pdf', modifiedTime: '2024-06-01', webViewLink: '', read: false },
      ],
      ['contrato 2024'],
    );
    expect(ranked[0]!.name).toMatch(/Contrato/);
  });

  it('shouldConsultDrive só com palavras de documento e Drive ligado', () => {
    const store = new Store(':memory:');
    bindSettings(store);
    expect(shouldConsultDrive(email({ subject: 'Sobre o contrato', body: 'segue o aditivo' }))).toBe(false);
    saveSettings(store, { drive: { enabled: true, rootFolderId: 'rootFolder99' } });
    // tokenGetter ainda null → isDriveConfigured false
    expect(shouldConsultDrive(email({ subject: 'Sobre o contrato', body: 'segue o aditivo' }))).toBe(false);
  });

  it('normalizeName e emailDomain', () => {
    expect(normalizeName('Ação & Cia!')).toBe('acao cia');
    expect(emailDomain('a@Acme.COM')).toBe('acme.com');
  });

  it('extractHints pega nomes de arquivo', () => {
    expect(extractHints(email({ body: 'segue Contrato_Final.pdf por favor' })).some((h) => /Contrato_Final\.pdf/i.test(h))).toBe(true);
  });

  it('formatDriveContext monta seção legível', () => {
    const text = formatDriveContext({
      consulted: true,
      folderId: 'f1',
      folderName: 'Acme',
      note: 'por domínio',
      files: [{ id: '1', name: 'c.pdf', mimeType: 'application/pdf', modifiedTime: '2024-01-02T00:00:00Z', webViewLink: 'https://x', read: true }],
      contents: [{ name: 'c.pdf', body: 'cláusula 3' }],
    });
    expect(text).toContain('Pasta: Acme');
    expect(text).toContain('cláusula 3');
    expect(text).toContain('[conteúdo lido]');
  });
});
