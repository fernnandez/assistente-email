import { describe, expect, it } from 'vitest';
import {
  emailDomain,
  escapeDriveQuery,
  extractHints,
  folderSearchNeedles,
  formatDriveContext,
  isGenericEmailDomain,
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
  it('parseFolderId aceita URL, id= e ID', () => {
    expect(parseFolderId('https://drive.google.com/drive/folders/abcXYZ12345')).toBe('abcXYZ12345');
    expect(parseFolderId('https://drive.google.com/open?id=abcXYZ12345')).toBe('abcXYZ12345');
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
    expect(shouldConsultDrive(email({ subject: 'Sobre o contrato', body: 'segue o aditivo' }))).toBe(false);
  });

  it('normalizeName, emailDomain e escapeDriveQuery', () => {
    expect(normalizeName('Ação & Cia!')).toBe('acao cia');
    expect(emailDomain('a@Acme.COM')).toBe('acme.com');
    expect(escapeDriveQuery("O'Brien")).toBe("O\\'Brien");
  });

  it('ignora domínios genéricos nos needles', () => {
    expect(isGenericEmailDomain('gmail.com')).toBe(true);
    expect(isGenericEmailDomain('hotmail.com')).toBe(true);
    expect(isGenericEmailDomain('acme.com')).toBe(false);
    const needles = folderSearchNeedles({
      mode: 'pipedrive_org',
      fromEmail: 'aluno@gmail.com',
      org: 'Maria Silva',
      name: 'Maria Silva',
    });
    expect(needles.some((n) => /gmail/i.test(n))).toBe(false);
    expect(needles).toContain('Maria Silva');
  });

  it('extractHints pega nomes de arquivo', () => {
    expect(extractHints(email({ body: 'segue Contrato_Final.pdf por favor' })).some((h) => /Contrato_Final\.pdf/i.test(h))).toBe(true);
  });

  it('formatDriveContext monta seção legível e modo list-only', () => {
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
    const meta = formatDriveContext({
      consulted: true,
      folderId: 'f1',
      folderName: 'Acme',
      note: 'pipedrive',
      listOnly: true,
      files: [{ id: '1', name: 'passaporte.pdf', mimeType: 'application/pdf', modifiedTime: '2024-01-02T00:00:00Z', webViewLink: 'https://x', read: false }],
      contents: [],
    });
    expect(meta).toContain('somente nomes e datas');
    expect(meta).not.toContain('Trechos lidos');
  });
});
