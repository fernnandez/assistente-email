import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPolicies } from '../src/policies';

describe('loadPolicies', () => {
  it('remove linhas [INTERNO] e ignora arquivos que não são .md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pol-'));
    writeFileSync(join(dir, 'a.md'), '# Preços\n- Starter: R$ 199\n- [INTERNO - NÃO DIVULGAR] desconto máximo 10%\n');
    writeFileSync(join(dir, 'b.txt'), 'ignorar');
    const p = loadPolicies(dir, 10000);
    expect(p.files).toEqual(['a.md']);
    expect(p.text).toContain('Starter: R$ 199');
    expect(p.text).not.toMatch(/INTERNO|desconto máximo/);
  });
  it('corta no limite e avisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pol-'));
    writeFileSync(join(dir, 'a.md'), 'x'.repeat(500));
    const p = loadPolicies(dir, 100);
    expect(p.truncated).toBe(true);
    expect(p.chars).toBe(100);
  });
  it('pasta inexistente devolve vazio', () => {
    expect(loadPolicies('/nao/existe').files).toEqual([]);
  });
});
