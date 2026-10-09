import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const antena = require('../../server.js');

/* ── servidor IMAP falso (texto puro sobre TCP) ── */
const MSG1_HDR = 'Message-ID: <abc@x>\r\nFrom: =?UTF-8?B?Sm/Do28=?= <joao@x.com>\r\nSubject: =?UTF-8?Q?Reuni=C3=A3o_amanh=C3=A3?=\r\nDate: Wed, 07 Oct 2026 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n';
const MSG1_BODY = 'Ol=C3=A1, pode confirmar?\r\n';
const MSG2_HDR = 'From: Loja <noreply@loja.com>\r\nSubject: Oferta\r\nDate: Wed, 07 Oct 2026 12:00:00 +0000\r\nContent-Type: text/html; charset=utf-8\r\n\r\n';
const MSG2_BODY = '<html><head><style>p{}</style></head><body><p>Desconto &amp; frete</p></body></html>';
const lit = (s) => `{${Buffer.byteLength(s)}}\r\n${s}`;

function fakeImap({ password = 'certa' } = {}) {
  const seen = [];
  const server = net.createServer((sock) => {
    sock.write('* OK IMAP pronto\r\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString();
      let i = buf.indexOf('\r\n');
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        seen.push(line);
        const [tag, cmd] = line.split(' ');
        if (cmd === 'LOGIN') sock.write(line.includes(`"${password}"`) ? `${tag} OK logado\r\n` : `${tag} NO [AUTHENTICATIONFAILED] credenciais inválidas\r\n`);
        else if (cmd === 'EXAMINE') sock.write(`* 2 EXISTS\r\n* FLAGS (\\Seen)\r\n${tag} OK [READ-ONLY] EXAMINE completo\r\n`);
        else if (cmd === 'FETCH') {
          sock.write(`* 1 FETCH (UID 10 FLAGS (\\Seen) INTERNALDATE "07-Oct-2026 10:00:00 +0000" BODY[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] ${lit(MSG1_HDR)} BODY[TEXT]<0> ${lit(MSG1_BODY)})\r\n`);
          sock.write(`* 2 FETCH (UID 11 FLAGS () BODY[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] ${lit(MSG2_HDR)} BODY[TEXT]<0> ${lit(MSG2_BODY)})\r\n`);
          sock.write(`${tag} OK FETCH completo\r\n`);
        } else if (cmd === 'LOGOUT') { sock.write(`* BYE\r\n${tag} OK\r\n`); sock.end(); }
        i = buf.indexOf('\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return { server, seen };
}

/* ── coletor OTLP / Sentry falso ── */
function fakeCollector() {
  const got = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { got.push({ url: req.url, headers: req.headers, body: b }); res.writeHead(200); res.end('{}'); });
  });
  return { server, got };
}

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
let base, imap, imapPort, coll, collPort, app;
const proxyCalls = [];

beforeAll(async () => {
  imap = fakeImap();
  imapPort = await listen(imap.server);
  coll = fakeCollector();
  collPort = await listen(coll.server);
  app = antena.createServer({
    log: () => {},
    connect: () => net.connect(imapPort, '127.0.0.1'),
    fetch: async (url) => {
      proxyCalls.push(url);
      if (url.includes('quebra')) throw Object.assign(new Error('tempo esgotado'), { code: 504 });
      return { status: 200, type: 'application/rss+xml', body: Buffer.from('<rss/>') };
    },
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collPort}/`,
      OTEL_EXPORTER_OTLP_HEADERS: 'x-chave=abc',
      NEW_RELIC_LICENSE_KEY: 'nr-123',
      NEW_RELIC_OTLP_ENDPOINT: `http://127.0.0.1:${collPort}/nr`,
      SENTRY_DSN: `http://pub@127.0.0.1:${collPort}/42`
    }
  });
  base = `http://127.0.0.1:${await listen(app)}`;
});
afterAll(() => { app.close(); imap.server.close(); coll.server.close(); });

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('antena · rotas básicas', () => {
  it('/health informa exportadores ativos', async () => {
    const j = await (await fetch(`${base}/health`)).json();
    expect(j).toMatchObject({ ok: true, exporters: { otlp: true, newrelic: true, datadog: false, sentry: true } });
  });
  it('responde o preflight CORS (inclusive rede privada)', async () => {
    const r = await fetch(`${base}/emails`, { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-private-network')).toBe('true');
  });
  it('recusa sites de fora (só file:// e localhost)', async () => {
    expect((await fetch(`${base}/health`, { headers: { Origin: 'https://site-malicioso.com' } })).status).toBe(403);
    expect((await fetch(`${base}/health`, { headers: { Origin: 'null' } })).status).toBe(200);
    expect((await fetch(`${base}/nada`)).status).toBe(404);
  });
});

describe('antena · proxy com allowlist', () => {
  it('libera Google News e Agenda', async () => {
    const r = await fetch(`${base}/proxy?url=${encodeURIComponent('https://news.google.com/rss/search?q=ia')}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('<rss/>');
    expect(proxyCalls.at(-1)).toBe('https://news.google.com/rss/search?q=ia');
  });
  it('bloqueia qualquer outro domínio (403) e URL inválida (400)', async () => {
    expect((await fetch(`${base}/proxy?url=${encodeURIComponent('https://example.com/')}`)).status).toBe(403);
    expect((await fetch(`${base}/proxy?url=${encodeURIComponent('http://news.google.com/')}`)).status).toBe(403);
    expect((await fetch(`${base}/proxy?url=lixo`)).status).toBe(400);
  });
  it('falha do destino vira 502 com mensagem', async () => {
    const r = await fetch(`${base}/proxy?url=${encodeURIComponent('https://calendar.google.com/quebra')}`);
    expect(r.status).toBe(502);
    expect((await r.json()).mensagem).toBe('tempo esgotado');
  });
});

describe('antena · e-mails via IMAP', () => {
  it('lê só com EXAMINE + BODY.PEEK e decodifica MIME', async () => {
    const r = await post('/emails', { host: 'imap.gmail.com', usuario: 'fulano@gmail.com', senhaApp: 'certa', quantidade: 5 });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.emails).toHaveLength(2);
    const [oferta, reuniao] = j.emails; // mais recente primeiro
    expect(reuniao).toMatchObject({ id: 'abc@x', remetente: 'João', email: 'joao@x.com', assunto: 'Reunião amanhã', trecho: 'Olá, pode confirmar?', lido: true });
    expect(oferta).toMatchObject({ remetente: 'Loja', trecho: 'Desconto & frete', lido: false, id: 'fulano@gmail.com#11' });
    expect(imap.seen.some((l) => l.includes('EXAMINE INBOX'))).toBe(true);
    const fetchLine = imap.seen.find((l) => l.includes(' FETCH '));
    expect(fetchLine).toContain('BODY.PEEK[TEXT]');
    expect(fetchLine).not.toMatch(/BODY\[TEXT\]/);
    expect(imap.seen.some((l) => / (SELECT|STORE|EXPUNGE)/.test(l))).toBe(false);
  });
  it('senha errada → 401 amigável', async () => {
    const r = await post('/emails', { host: 'imap.gmail.com', usuario: 'fulano@gmail.com', senhaApp: 'errada' });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ ok: false, erro: 'login' });
  });
  it('host fora da allowlist, dados faltando e JSON inválido', async () => {
    expect((await post('/emails', { host: 'imap.evil.com', usuario: 'a', senhaApp: 'b' })).status).toBe(403);
    expect((await post('/emails', { host: 'imap.gmail.com', usuario: '', senhaApp: '' })).status).toBe(400);
    expect((await post('/emails', '{quebrado')).status).toBe(400);
  });
});

describe('antena · telemetria', () => {
  it('repassa traces OTLP para o coletor e o New Relic com os cabeçalhos certos', async () => {
    const before = coll.got.length;
    const r = await post('/telemetry/traces', { resourceSpans: [] });
    expect(r.status).toBe(202);
    expect((await r.json()).encaminhado).toBe(2);
    const novos = coll.got.slice(before);
    expect(novos.map((g) => g.url).sort()).toEqual(['/nr/v1/traces', '/v1/traces']);
    expect(novos.find((g) => g.url === '/v1/traces').headers['x-chave']).toBe('abc');
    expect(novos.find((g) => g.url === '/nr/v1/traces').headers['api-key']).toBe('nr-123');
  });
  it('logs e Sentry (envelope com autenticação)', async () => {
    expect((await post('/telemetry/logs', { resourceLogs: [] })).status).toBe(202);
    const before = coll.got.length;
    expect((await post('/telemetry/sentry', { event_id: 'e1', exception: {} })).status).toBe(202);
    const env = coll.got.slice(before).find((g) => g.url === '/api/42/envelope/');
    expect(env.headers['x-sentry-auth']).toContain('sentry_key=pub');
    const [h, t, ev] = env.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(h.event_id).toBe('e1');
    expect(t.type).toBe('event');
    expect(ev.event_id).toBe('e1');
  });
  it('rejeita formatos errados', async () => {
    expect((await post('/telemetry/traces', { lixo: 1 })).status).toBe(400);
    expect((await post('/telemetry/sentry', { semId: 1 })).status).toBe(400);
    expect((await post('/telemetry/metrics', {})).status).toBe(404);
    expect((await post('/telemetry/logs', 'nao-json')).status).toBe(400);
  });
  it('a própria antena gera spans das requisições', async () => {
    const before = coll.got.length;
    await app.telemetry.flush();
    const spans = coll.got.slice(before).filter((g) => g.url === '/v1/traces').flatMap((g) => JSON.parse(g.body).resourceSpans[0].scopeSpans[0].spans);
    expect(spans.some((s) => s.name === 'antena POST emails')).toBe(true);
    expect(spans.every((s) => !JSON.stringify(s).includes('certa'))).toBe(true); // nunca vaza senha
  });
});

describe('antena · utilitários', () => {
  it('mascara credenciais nos logs', () => {
    expect(antena.maskUser('fulano@gmail.com')).toBe('fu•••@gmail.com');
    expect(antena.maskUrl('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics')).toBe('calendar.google.com/•••••• (link secreto oculto)');
    expect(antena.maskUrl('https://news.google.com/rss/search?q=ia%20when%3A3d')).toBe('news.google.com  q="ia"');
    expect(antena.maskUrl('::')).toBe('(url inválida)');
  });
  it('DSN do Sentry e destinos OTLP', () => {
    expect(antena.parseDsn('https://k@o1.ingest.sentry.io/99')).toEqual({ key: 'k', url: 'https://o1.ingest.sentry.io/api/99/envelope/', dsn: 'https://k@o1.ingest.sentry.io/99' });
    expect(antena.parseDsn('lixo')).toBeNull();
    expect(antena.parseDsn('https://o1.ingest.sentry.io/99')).toBeNull();
    expect(antena.otlpTargets({ DD_OTLP_ENDPOINT: 'http://localhost:4318/', DD_API_KEY: 'd' })).toEqual([{ name: 'datadog', base: 'http://localhost:4318', headers: { 'dd-api-key': 'd' } }]);
    expect(antena.parseHeaderList('a=1, b=x%20y,lixo')).toEqual({ a: '1', b: 'x y' });
    expect(antena.otlpTargets({})).toEqual([]);
  });
  it('MIME: encoded-words vizinhas, quoted-printable, HTML e multipart aninhado', () => {
    expect(antena.decodeWords('=?UTF-8?B?UmV1bmnDo28gZGUg?= =?UTF-8?B?YW1hbmjDow==?= urgente')).toBe('Reunião de amanhã urgente');
    expect(antena.decodeWords('=?iso-8859-1?Q?Fatura_=E9_aqui?=')).toBe('Fatura é aqui');
    expect(antena.decodeWords('')).toBe('');
    const raw = Buffer.from('--b1\r\nContent-Type: multipart/alternative; boundary="b2"\r\n\r\n--b2\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Ol=C3=A1 Fulano &#233; &#x2014; &nbsp;</p>\r\n--b2--\r\n--b1\r\nContent-Disposition: attachment\r\n\r\nxxx\r\n--b1--', 'latin1');
    expect(antena.partText('multipart/mixed; boundary="b1"', '', raw, 0).trim()).toBe('Olá Fulano é —');
    expect(antena.partText('text/plain; charset=utf-8', 'base64', Buffer.from(Buffer.from('Prazo até sexta').toString('base64')), 0)).toBe('Prazo até sexta');
    expect(antena.stripHtml('<script>x</script><b>a</b>&lt;').replace(/ +/g, ' ').trim()).toBe('a <');
    expect(antena.parseHeaders('Subject: a\r\n b\r\nX: 1\r\nX: 2')).toEqual({ subject: 'a b', x: '1' });
    expect(antena.qpBytes('a=3Db=\r\nc').toString()).toBe('a=bc');
  });
  it('origens aceitas', () => {
    const o = (origin) => antena.originOk({ headers: origin ? { origin } : {} });
    expect([o(), o('null'), o('file://'), o('http://localhost:5173'), o('https://x.com'), o('::')]).toEqual([true, true, true, true, false, false]);
  });
});
