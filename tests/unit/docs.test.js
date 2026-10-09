import { describe, expect, it } from 'vitest';
import { docsBlock, relevant, searchQuery } from '../../src/core/docs.js';

const hit = (path, score, text = 'conteúdo', heading = 'Seção') => ({ path, title: path, heading, text, score });
const STATUS = { available: true, files: 135, folders: { ADR: 11, Bot: 30, '(raiz)': 9 } };

describe('base de conhecimento', () => {
  it('relevant: placar mínimo, proporção do melhor e sem repetidos', () => {
    expect(relevant([])).toEqual([]);
    expect(relevant([hit('a', 3)])).toEqual([]);
    const r = relevant([hit('a', 20), hit('a', 19), hit('b', 12), hit('c', 5)]);
    expect(r.map((x) => x.path)).toEqual(['a', 'b']);
    expect(relevant([hit('a', 20, 'x', 'S1'), hit('a', 19, 'y', 'S2')]).length).toBe(2);
  });
  it('searchQuery junta a pergunta anterior (continuação de conversa)', () => {
    const h = [{ role: 'user', content: 'como funciona o bateponto?' }, { role: 'assistant', content: 'É por call.' }];
    expect(searchQuery('e no painel?', h)).toBe('e no painel? como funciona o bateponto?');
    expect(searchQuery('oi')).toBe('oi');
  });
  it('docsBlock: anuncia o acervo e inclui só os trechos que cabem', () => {
    expect(docsBlock(null, [])).toBe('');
    expect(docsBlock({ available: false }, [])).toBe('');
    const sem = docsBlock(STATUS, []);
    expect(sem).toContain('135 notas: ADR, Bot');
    expect(sem).not.toContain('(raiz)');
    expect(sem).not.toContain('TRECHOS');
    const b = docsBlock(STATUS, [hit('Bot/Commands/bateponto.md', 10, 'Registro de horas por call.', 'Objetivo'), hit('ADR/ADR-004.md', 9, 'x'.repeat(9000), '')], { maxChars: 1500 });
    expect(b).toContain('### Bot/Commands/bateponto.md — Objetivo\nRegistro de horas por call.');
    expect(b).toContain('### ADR/ADR-004.md\n');
    expect(b.length).toBeLessThanOrEqual(1500);
    expect(b.endsWith('…')).toBe(true);
  });
});
