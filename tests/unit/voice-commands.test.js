import { describe, expect, it } from 'vitest';
import { hasWakeWord, matchCommand, stripWakeWord } from '../../src/core/commands.js';
import { cap, cleanForSpeech, esc, norm, splitChunks, stripSource } from '../../src/core/text.js';
import { buildTimeline, sampleTimeline, VISEME, wordTimeAt, wordToVisemes } from '../../src/core/visemes.js';

describe('text', () => {
  it('normaliza acentos e pontuação', () => {
    expect(norm('Notícias de Inteligência Artificial, ação!')).toBe('noticias de inteligencia artificial acao');
    expect(norm(null)).toBe('');
  });
  it('escapa HTML e capitaliza', () => {
    expect(esc('<a href="x">\'&')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    expect(esc(undefined)).toBe('');
    expect(cap('chefe')).toBe('Chefe');
    expect(cap('')).toBe('');
  });
  it('limpa texto para a voz', () => {
    expect(cleanForSpeech('**Olá** chefe 😀 veja https://x.com — agora')).toBe('Olá chefe veja, agora');
  });
  it('quebra textos longos em frases (≤ 190)', () => {
    const t = `${'Frase curta. '.repeat(30)}${'palavra '.repeat(60)}`;
    const ch = splitChunks(t);
    expect(ch.every((c) => c.length <= 191)).toBe(true);
    expect(ch.join(' ').replace(/\s+/g, ' ').trim()).toBe(t.replace(/\s+/g, ' ').trim());
    expect(splitChunks('Oi.')).toEqual(['Oi.']);
  });
  it('remove a fonte do título do Google News', () => {
    expect(stripSource('Dólar cai - G1', 'G1')).toBe('Dólar cai');
    expect(stripSource('Dólar cai - Valor Econômico', '')).toBe('Dólar cai');
  });
});

describe('visemas', () => {
  it('regras do português: nasais, dígrafos, u mudo', () => {
    expect(wordToVisemes('bem')).toEqual(['M', 'E']);
    expect(wordToVisemes('chefe')).toEqual(['X', 'E', 'F', 'E']);
    expect(wordToVisemes('quero')).toEqual(['K', 'E', 'Q', 'O']);
    expect(wordToVisemes('olho')).toEqual(['O', 'L', 'O']);
    expect(wordToVisemes('casa')).toEqual(['K', 'A', 'S', 'A']);
    expect(wordToVisemes('cedo')).toEqual(['S', 'E', 'L', 'O']);
    expect(wordToVisemes('gente')).toEqual(['X', 'E', 'L', 'E']);
    expect(wordToVisemes('gato')).toEqual(['K', 'A', 'L', 'O']);
    expect(wordToVisemes('2026')[0]).toBe('E');
    expect(wordToVisemes('h')).toEqual(['E']);
    expect(wordToVisemes('jóia')).toEqual(['X', 'O', 'I', 'A']);
    expect(wordToVisemes('web')).toEqual(['U', 'E', 'M']);
  });
  it('linha do tempo: palavras, pausas e amostragem', () => {
    const tl = buildTimeline('Olá, chefe. Tudo bem?', 14);
    expect(tl.words.map((w) => w.ci)).toEqual([0, 5, 12, 17]);
    expect(tl.total).toBeGreaterThan(1);
    expect(wordTimeAt(tl, 12)).toBe(tl.words[2].t);
    expect(wordTimeAt(tl, 13)).toBe(tl.words[2].t);
    expect(wordTimeAt({ words: [] }, 0)).toBeNull();
    expect(sampleTimeline(tl, -1)).toBe(VISEME.R);
    expect(sampleTimeline(tl, tl.total + 1)).toBe(VISEME.R);
    const mid = sampleTimeline(tl, tl.segs[2].t0 + 0.001); // O · L · A
    expect(mid[0]).toBeGreaterThan(0.5); // "Olá": o "a" abre a boca
    expect(sampleTimeline({ segs: [], total: 0 }, 0)).toBe(VISEME.R);
  });
});

describe('comandos locais', () => {
  const cases = [
    ['Bom dia', 'digest'], ['bom dia aurora', 'digest'],
    ['minha agenda', 'agenda.today'], ['o que eu tenho hoje', 'agenda.today'],
    ['próximo compromisso', 'agenda.next'], ['qual é o meu próximo compromisso', 'agenda.next'],
    ['agenda da semana', 'agenda.week'],
    ['meus e-mails', 'mail.summary'], ['tem e-mail importante?', 'mail.important'],
    ['notícias', 'news.all'], ['atualizar e-mails', 'mail.refresh'], ['atualizar notícias', 'news.refresh'],
    ['previsão do tempo', 'weather'], ['vai chover', 'weather'], ['que horas são', 'time']
  ];
  it.each(cases)('"%s" → %s', (text, id) => {
    expect(matchCommand(text)?.id).toBe(id);
  });
  it('captura o assunto das notícias', () => {
    expect(matchCommand('notícias de inteligência artificial')).toEqual({ id: 'news.topic', arg: 'inteligencia artificial' });
    expect(matchCommand('me fala as notícias sobre futebol hoje')).toEqual({ id: 'news.topic', arg: 'futebol' });
  });
  it('perguntas livres vão para a IA', () => {
    expect(matchCommand('consigo encaixar um almoço amanhã na minha agenda?')).toBeNull();
    expect(matchCommand('me ajuda a pensar num nicho de SaaS')).toBeNull();
    expect(matchCommand('')).toBeNull();
  });
  it('palavra de ativação', () => {
    expect(hasWakeWord('Ei Aurora, minha agenda')).toBe(true);
    expect(hasWakeWord('auróra')).toBe(true);
    expect(hasWakeWord('a hora certa')).toBe(false);
    expect(stripWakeWord('Ei Aurora, minha agenda')).toBe('minha agenda');
    expect(stripWakeWord('bom dia Aurora')).toBe('bom dia');
    expect(stripWakeWord('hey aurora')).toBe('');
  });
});
