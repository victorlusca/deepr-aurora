import { describe, expect, it } from 'vitest';
import { AREA, DEFAULT_SETTINGS, mergeSettings, NOTES, REL } from '../../src/core/config.js';
import { packText, templateDigest } from '../../src/core/digest.js';
import { applySaves, extractSaves, graphEdges } from '../../src/core/memory.js';
import { buildRequest, costOf, errorSpeech, extractText } from '../../src/core/openai.js';
import { buildContext, buildSystemPrompt, digestSystem } from '../../src/core/prompt.js';
import { heuristic, parseTriage, pruneCache, triagePrompt } from '../../src/core/triage.js';

describe('memória viva', () => {
  it('extrai [[SAVE]] e limpa a resposta', () => {
    const r = extractSaves('Anotado, chefe.\n[[SAVE:saude|Academia|Treina 3x por semana]]', AREA);
    expect(r.text).toBe('Anotado, chefe.');
    expect(r.saves).toEqual([{ area: 'saude', title: 'Academia', body: 'Treina 3x por semana' }]);
    expect(extractSaves('x [[SAVE:inexistente|T|b]]', AREA).saves[0].area).toBe('meta');
  });
  it('atualiza nota existente pelo título (sem acento/caixa) ou cria nova', () => {
    let n = 0;
    const id = () => `novo${++n}`;
    const { notes, touched } = applySaves(NOTES, [{ area: 'metas', title: 'metas', body: 'nova meta' }, { area: 'saude', title: 'Sono', body: '7h' }], id);
    expect(notes.find((x) => x.id === 'metas').body).toBe('nova meta');
    expect(notes.find((x) => x.id === 'novo1')).toMatchObject({ title: 'Sono', area: 'saude' });
    expect(touched).toEqual(['metas', 'novo1']);
    expect(NOTES.find((x) => x.id === 'metas').body).not.toBe('nova meta'); // imutável
  });
  it('grafo: relações fixas + notas novas ligadas à área e ao hub', () => {
    const edges = graphEdges([...NOTES, { id: 'x', area: 'relacoes', title: 'X', body: '' }], REL);
    expect(edges.length).toBe(REL.length + 2); // 1 colega de área (perfil de exemplo) + metas
    expect(edges).toContainEqual(['x', 'metas']);
    expect(graphEdges([{ id: 'a', area: 'meta' }], [['a', 'a'], ['a', 'z']])).toEqual([]);
  });
});

describe('prompt e configurações', () => {
  it('system prompt traz identidade, Second Brain inteiro e protocolo de memória', () => {
    const p = buildSystemPrompt(NOTES);
    expect(p).toContain('Aurora');
    expect(p).toContain('"chefe"');
    for (const n of NOTES) expect(p).toContain(n.title);
    expect(p).toContain('[[SAVE:area|titulo|texto]]');
  });
  it('contexto compacto do dia', () => {
    const c = buildContext({ now: 'Qui 08/10/2026 09:00', topics: ['IA'], agenda: '09:00 X', actionCount: 2, extra: ['Clima: 24°C.'] });
    expect(c).toContain('Agenda de hoje: 09:00 X');
    expect(c).toContain('E-mails pedindo ação: 2');
    expect(c).toContain('Clima: 24°C.');
    expect(buildContext({ now: '', topics: [], agenda: null, actionCount: null })).toContain('nenhuma conta conectada');
    expect(digestSystem('medio')).toContain('150 a 170');
    expect(digestSystem('curto')).toContain('70 a 90');
  });
  it('mescla configurações sem perder padrões', () => {
    const s = mergeSettings({ economy: false, digest: { size: 'medio' }, newsTopics: [] });
    expect(s.economy).toBe(false);
    expect(s.digest).toMatchObject({ size: 'medio', auto: true });
    expect(s.newsTopics).toEqual(DEFAULT_SETTINGS.newsTopics);
    expect(mergeSettings(null).emailCount).toBe(5);
  });
});

describe('OpenAI', () => {
  it('monta o pedido da Responses API', () => {
    const r = buildRequest({ model: 'gpt-6-luna', system: 'S', messages: [{ role: 'user', content: 'oi', extra: 1 }], maxTokens: 400 });
    expect(r).toEqual({ model: 'gpt-6-luna', instructions: 'S', input: [{ role: 'user', content: 'oi' }], max_output_tokens: 1200, reasoning: { effort: 'none' }, store: false });
    expect(buildRequest({ model: 'x', system: '', messages: [], maxTokens: 1 }).reasoning.effort).toBe('low');
  });
  it('lê o texto da resposta', () => {
    expect(extractText({ output_text: ' oi ' })).toBe('oi');
    expect(extractText({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Olá' }, { type: 'refusal' }] }] })).toBe('Olá');
    expect(extractText(null)).toBe('');
  });
  it('custo e mensagens de erro faladas', () => {
    expect(costOf('gpt-6.1-sol', { input_tokens: 1e6, output_tokens: 1e6 })).toBe(12);
    expect(costOf('desconhecido', {})).toBe(0);
    expect(errorSpeech({ kind: 'http', status: 401 }, 'chefe')).toMatch(/recusou a chave/);
    expect(errorSpeech({ kind: 'http', status: 429 }, 'chefe')).toMatch(/limite/);
    expect(errorSpeech({ kind: 'http', status: 500 }, 'chefe')).toMatch(/erro 500/);
    expect(errorSpeech(new TypeError('fetch'), 'chefe')).toMatch(/Não consegui conectar/);
  });
});

describe('triagem', () => {
  const m = (assunto, extra = {}) => ({ remetente: 'Fulano', email: 'f@x.com', assunto, trecho: '', ...extra });
  it('heurística local', () => {
    expect(heuristic(m('Oferta imperdível', { email: 'noreply@loja.com' })).balde).toBe('ruido');
    expect(heuristic(m('Sua fatura vence amanhã', { email: 'noreply@banco.com' })).balde).toBe('acao');
    expect(heuristic(m('Podemos marcar a reunião?')).balde).toBe('acao');
    expect(heuristic(m('Seu pedido foi enviado')).balde).toBe('info');
    expect(heuristic(m('')).resumo).toBe('(sem assunto)');
  });
  it('prompt de lote só com remetente, assunto e 200 caracteres', () => {
    const p = triagePrompt([m('A', { trecho: 'x'.repeat(500) })]);
    expect(p).toContain('1. De: Fulano <f@x.com> | Assunto: A');
    expect(p).not.toContain('x'.repeat(201));
  });
  it('lê a resposta JSON (tolerante) e descarta lixo', () => {
    const batch = [m('A'), m('B')];
    const r = parseTriage('Claro! [{"id":1,"balde":"acao","resumo":"Responder"},{"id":2,"balde":"spam"},{"id":9,"balde":"info"}] fim', batch);
    expect([...r]).toEqual([[0, { balde: 'acao', resumo: 'Responder' }]]);
    expect(parseTriage('sem json', batch).size).toBe(0);
    expect(parseTriage('[quebrado', batch).size).toBe(0);
    expect(parseTriage('[1,2]', batch).size).toBe(0);
  });
  it('cache limitado', () => {
    const c = {};
    for (let i = 0; i < 10; i++) c[`k${i}`] = { t: i };
    expect(Object.keys(pruneCache(c, 4))).toEqual(['k6', 'k7', 'k8', 'k9']);
  });
});

describe('digest', () => {
  const base = {
    now: Date.parse('2026-10-08T11:00:00Z'), tz: 'America/Manaus', size: 'curto', weatherOn: true,
    weather: { label: 'Manaus · AM', compact: '24°C agora', spoken: 'Em Manaus, 24 graus agora.' },
    hasCal: true, events: [{ title: 'Dentista', start: Date.parse('2026-10-08T18:00:00Z'), allDay: false }, { title: 'Feriado', allDay: true, start: 0 }],
    hasMail: true, recent: 5, unread: 2, actions: [{ remetente: 'Ana', resumo: 'Responder sobre o jantar' }],
    heads: [{ t: 'IA', h: ['Manchete 1', 'Manchete 2'] }], goals: ['Metas: SaaS']
  };
  it('pacote compacto para a IA', () => {
    const t = packText(base);
    expect(t).toContain('quinta-feira, 8 de outubro de 2026');
    expect(t).toContain('14:00 · Dentista');
    expect(t).toContain('dia todo · Feriado');
    expect(t).toContain('AÇÃO (1): Ana: Responder sobre o jantar');
    expect(t).toContain('IA: Manchete 1 / Manchete 2');
    expect(packText({ ...base, hasCal: false, hasMail: false, heads: [], weatherOn: false })).toContain('não mencione');
  });
  it('modelo offline fala tudo sem IA', () => {
    const t = templateDigest(base);
    expect(t).toMatch(/^Bom dia, chefe\. Hoje é quinta-feira, 8 de outubro\./);
    expect(t).toContain('às 14 horas, Dentista');
    expect(t).toContain('Um e-mail pede ação');
    expect(t).toContain('Foco do dia');
    const vazio = templateDigest({ ...base, events: [], actions: [], heads: [], weather: null });
    expect(vazio).toContain('agenda de hoje está livre');
    expect(vazio).toContain('Nenhum e-mail pedindo ação');
    expect(templateDigest({ ...base, actions: [base.actions[0], base.actions[0]] })).toContain('2 e-mails pedem');
  });
});
