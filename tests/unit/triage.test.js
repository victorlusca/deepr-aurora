import { describe, expect, it } from 'vitest';
import { BUCKETS, heuristic, parseTriage, pruneCache, triagePrompt } from '../../src/core/triage.js';

const m = (assunto, extra = {}) => ({ remetente: 'Fulano', email: 'f@x.com', assunto, trecho: '', ...extra });
const balde = (assunto, extra) => heuristic(m(assunto, extra)).balde;

describe('triagem · heurística', () => {
  it('ruído só quando não envolve dinheiro/prazo', () => {
    expect(balde('Newsletter semanal')).toBe('ruido');
    expect(balde('Boleto disponível', { email: 'noreply@banco.com' })).toBe('acao');
    expect(balde('Newsletter: confirme sua inscrição?')).toBe('ruido');
    expect(balde('Resumo', { remetente: 'Marketing Loja' })).toBe('ruido');
    expect(balde('Olá', { email: 'no-reply@x.com', trecho: 'cupom de desconto' })).toBe('ruido');
  });
  it('ação por palavra-chave ou pergunta, em qualquer campo', () => {
    expect(balde('Contrato', { trecho: 'Preciso da sua assinatura' })).toBe('acao');
    expect(balde('Contrato', { trecho: 'Consegue assinar?' })).toBe('acao');
    expect(balde('Você vem?')).toBe('acao');
    expect(balde('Reunião amanhã')).toBe('acao');
    expect(balde('Recibo do pagamento')).toBe('info');
    expect(balde('Contrato', { trecho: 'segue em anexo' })).toBe('info');
  });
  it('resumo é o assunto, ou "(sem assunto)"', () => {
    expect(heuristic(m('Recibo')).resumo).toBe('Recibo');
    expect(heuristic({ remetente: '', email: '', assunto: '', trecho: '' })).toEqual({ balde: 'info', resumo: '(sem assunto)' });
  });
  it('baldes conhecidos', () => {
    expect(BUCKETS).toEqual(['acao', 'info', 'ruido']);
  });
});

describe('triagem · prompt do lote', () => {
  it('numera a partir de 1, uma linha por e-mail, trecho opcional', () => {
    const p = triagePrompt([m('A', { trecho: 'abc' }), m('B', { trecho: undefined })]);
    expect(p).toContain('1. De: Fulano <f@x.com> | Assunto: A | Trecho: abc\n2. De: Fulano <f@x.com> | Assunto: B | Trecho: ');
    const long = triagePrompt([m('C', { trecho: 'y'.repeat(300) })]);
    expect(long).toContain(`Trecho: ${'y'.repeat(200)}\n`);
    expect(p.startsWith('Classifique cada e-mail em um balde:\n')).toBe(true);
    expect(p.trim().endsWith(']')).toBe(true);
  });
});

describe('triagem · leitura da resposta', () => {
  const batch = [m('A'), m('B'), m('C')];
  it('mapeia id (1-based) para índice e usa o assunto quando falta resumo', () => {
    const r = parseTriage('[{"id":3,"balde":"ruido"},{"id":"2","balde":"info","resumo":"ok"}]', batch);
    expect(r.get(2)).toEqual({ balde: 'ruido', resumo: 'C' });
    expect(r.get(1)).toEqual({ balde: 'info', resumo: 'ok' });
    expect(r.size).toBe(2);
  });
  it('corta o resumo em 180 caracteres', () => {
    const r = parseTriage(`[{"id":1,"balde":"acao","resumo":"${'z'.repeat(400)}"}]`, batch);
    expect(r.get(0).resumo).toHaveLength(180);
  });
  it('ignora itens nulos, id 0 e colchetes fora de ordem', () => {
    expect(parseTriage('[null,{"id":0,"balde":"acao"}]', batch).size).toBe(0);
    expect(parseTriage('] texto [', batch).size).toBe(0);
    expect(parseTriage('{"id":1}', batch).size).toBe(0);
    expect(parseTriage(null, batch).size).toBe(0);
    expect(parseTriage('[{"id":1,"balde":"acao"}', batch).size).toBe(0);
  });
  it('recorta o JSON do meio do texto', () => {
    expect(parseTriage('Claro, chefe:\n[{"id":2,"balde":"info"}]\nPronto.', batch).get(1).balde).toBe('info');
  });
  it('aceita o JSON exatamente nas bordas do texto', () => {
    expect(parseTriage('[{"id":1,"balde":"acao","resumo":"r"}]', batch).get(0).resumo).toBe('r');
  });
});

describe('triagem · cache', () => {
  it('não mexe abaixo ou no limite', () => {
    const c = { a: { t: 1 }, b: { t: 2 } };
    expect(pruneCache(c, 2)).toBe(c);
    expect(Object.keys(c)).toEqual(['a', 'b']);
  });
  it('descarta os mais antigos (sem data conta como mais antigo)', () => {
    const c = { novo: { t: 9 }, semData: {}, velho: { t: 1 }, medio: { t: 5 } };
    expect(Object.keys(pruneCache(c, 2)).sort()).toEqual(['medio', 'novo']);
    const big = {};
    for (let i = 0; i < 405; i++) big[`k${i}`] = { t: i };
    expect(Object.keys(pruneCache(big))).toHaveLength(400);
    expect(big.k0).toBeUndefined();
    expect(big.k404).toBeDefined();
  });
});
