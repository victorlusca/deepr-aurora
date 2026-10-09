// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/config.js';
import { feedUrl, findTopic, isGenericNewsWord, parseRSS } from '../../src/core/news.js';
import { createTelemetry, parseStack, scrub, scrubString, toOTLPLogs, toOTLPTraces, toSentryEvent } from '../../src/core/telemetry.js';

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>IA avança no Brasil - G1</title><link>https://news.google.com/a</link><pubDate>Wed, 07 Oct 2026 10:00:00 GMT</pubDate><source url="https://g1.globo.com">G1</source></item>
<item><title>Mais nova - Valor</title><link>https://news.google.com/b</link><pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate><source>Valor</source></item>
</channel></rss>`;

describe('notícias', () => {
  it('lê o RSS, tira a fonte do título e ordena por data', () => {
    const items = parseRSS(RSS, window.DOMParser);
    expect(items.map((i) => i.title)).toEqual(['Mais nova', 'IA avança no Brasil']);
    expect(items[1]).toMatchObject({ source: 'G1', link: 'https://news.google.com/a' });
    expect(() => parseRSS('<rss><item>', window.DOMParser)).toThrow('RSS inválido');
  });
  it('URL do Google News para Brasil/português', () => {
    expect(feedUrl('"Manaus" AM')).toBe('https://news.google.com/rss/search?q=%22Manaus%22%20AM%20when%3A3d&hl=pt-BR&gl=BR&ceid=BR:pt-419');
  });
  it('encontra o assunto pelo nome ou apelido', () => {
    const t = DEFAULT_SETTINGS.newsTopics;
    expect(findTopic(t, 'inteligência artificial').id).toBe('ia');
    expect(findTopic(t, 'minha cidade').id).toBe('cidade');
    expect(findTopic(t, 'futebol')).toBeNull();
    expect(findTopic(t, '')).toBeNull();
    expect(isGenericNewsWord('hoje')).toBe(true);
    expect(isGenericNewsWord('futebol')).toBe(false);
  });
});

describe('telemetria', () => {
  it('scrub remove segredos, e-mails, chaves e links iCal', () => {
    expect(scrub({ apiKey: 'sk-abc', senhaApp: 'x', 'http.status_code': 200, ok: true, nada: null, obj: { a: 1 } }))
      .toEqual({ apiKey: '[removido]', senhaApp: '[removido]', 'http.status_code': 200, ok: true, obj: '{"a":1}' });
    expect(scrubString('chave sk-proj-ABCDEFGH1234 de fulano@gmail.com em https://calendar.google.com/calendar/ical/abc/private/basic.ics'))
      .toBe('chave [chave] de fu•••@gmail.com em [link-ical]');
  });
  it('spans, logs e erros com exportação OTLP/Sentry', async () => {
    let t = 1000;
    const sent = [];
    const transport = vi.fn(async (kind, p) => { sent.push([kind, p]); });
    const tel = createTelemetry({ service: 's', version: '1', transport, now: () => t, rnd: () => 0.5 });
    const seen = vi.fn();
    const off = tel.subscribe(seen);
    await tel.span('ok', { a: 1 }, async (sp) => { t += 25; sp.set('b', 'x'); return 1; });
    await expect(tel.span('falha', {}, async () => { throw new Error('boom senha=123'); })).rejects.toThrow('boom');
    const manual = tel.startSpan('manual');
    manual.end(); manual.end();
    tel.log('warn', 'atenção', { k: 1 });
    const ev = tel.error(new Error('quebrou'), { tags: { area: 'x' } });
    off();
    expect(seen).toHaveBeenCalled();
    expect(ev.exception.values[0]).toMatchObject({ type: 'Error', value: 'quebrou' });
    const snap = tel.snapshot();
    expect(snap.spans.map((s) => s.name)).toEqual(['ok', 'falha', 'manual']);
    expect(snap.spans[0].end - snap.spans[0].start).toBe(25);
    expect(snap.spans[1].status).toBe('error');
    expect(await tel.flush()).toBe(true);
    expect(sent.map((s) => s[0])).toEqual(['sentry', 'traces', 'logs']);
    expect(sent[1][1].resourceSpans[0].scopeSpans[0].spans).toHaveLength(3);
    expect(await tel.flush()).toBe(true); // nada pendente
    expect(tel.snapshot().stats.exported).toBe(6);
  });
  it('falha de exportação volta para a fila; exportação desligada descarta', async () => {
    const tel = createTelemetry({ transport: async () => { throw new Error('offline'); } });
    tel.log('info', 'x');
    expect(await tel.flush()).toBe(false);
    expect(tel.snapshot().stats).toMatchObject({ failed: 1, lastError: 'offline', pending: 1 });
    tel.setExport(false);
    expect(await tel.flush()).toBe(false);
    expect(tel.snapshot().stats.pending).toBe(0);
    const semTransporte = createTelemetry();
    semTransporte.error('texto');
    expect(semTransporte.snapshot().errors).toHaveLength(1);
  });
  it('formatos OTLP e Sentry', () => {
    const res = { 'service.name': 's', 'service.version': '1' };
    const tr = toOTLPTraces([{ traceId: 't', spanId: 's', parentSpanId: 'p', name: 'n', start: 1, end: 2, attrs: { i: 1, d: 1.5, b: true, s: 'x' }, status: 'error', error: 'e' }], res);
    const span = tr.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.attributes.map((a) => Object.keys(a.value)[0])).toEqual(['intValue', 'doubleValue', 'boolValue', 'stringValue']);
    expect(span).toMatchObject({ parentSpanId: 'p', startTimeUnixNano: '1000000', status: { code: 2, message: 'e' } });
    const lg = toOTLPLogs([{ time: 1, level: 'error', msg: 'm', attrs: {} }, { time: 2, level: 'x', msg: 'm', attrs: {} }], res);
    expect(lg.resourceLogs[0].scopeLogs[0].logRecords.map((r) => r.severityNumber)).toEqual([17, 9]);
    const se = toSentryEvent('não é Error', { tags: { token: 'x' } }, { eventId: 'e', release: 'r', now: 2000 });
    expect(se).toMatchObject({ event_id: 'e', timestamp: 2, platform: 'javascript', tags: { token: '[removido]' } });
    expect(parseStack('Error: x\n    at foo (file:///a/b/app.js:10:5)\n    at file:///a/c.js:1:2')).toEqual([
      { function: '?', filename: 'c.js', lineno: 1, colno: 2, in_app: true },
      { function: 'foo', filename: 'app.js', lineno: 10, colno: 5, in_app: true }
    ]);
  });
});
