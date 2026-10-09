#!/usr/bin/env node
/*
 * ANTENA DA AURORA — ponte entre o jarvis.html e a internet. Local (padrão) ou hospedada (SquareCloud).
 * Node puro: só módulos nativos (http, https, tls). Nada de npm install para rodar.
 *
 *   node server.js                 → só no seu PC (127.0.0.1:4242)
 *   AURORA_HOST=0.0.0.0 + AURORA_PASSWORD → hospedado, com senha (veja squarecloud.app)
 *
 * Rotas:
 *   GET  /                     → o próprio app (dist/jarvis.html)
 *   GET  /health               → status + exportadores de telemetria ativos
 *   GET  /proxy?url=...        → agenda (calendar.google.com) e notícias (news.google.com) com CORS liberado
 *   POST /emails               → {host, usuario, senhaApp, quantidade} → caixa de entrada via IMAP (somente leitura)
 *   POST /telemetry/traces     → OTLP/JSON → OpenTelemetry Collector · Datadog Agent · New Relic
 *   POST /telemetry/logs       → OTLP/JSON → idem
 *   POST /telemetry/sentry     → evento → Sentry (envelope)
 *
 * Telemetria (opcional) — variáveis no arquivo .env ao lado deste arquivo (veja .env.example).
 */
// biome-ignore lint/suspicious/noRedundantUseStrict: arquivo CommonJS (roda direto com node server.js)
'use strict';
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
const VERSION = '6.0.0';
const PROXY_HOSTS = ['calendar.google.com', 'news.google.com'];
const IMAP_HOSTS = ['imap.gmail.com', 'outlook.office365.com', 'imap-mail.outlook.com', 'imap.hostinger.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAX_BODY = 6 * 1024 * 1024;

/* ── log sem credenciais ── */
const hora = () => new Date().toTimeString().slice(0, 8);
const defaultLog = (...a) => console.log(`  ${hora()} │`, ...a);
const maskUser = (u) => {
  const [n, d] = String(u).split('@');
  return `${(n || '').slice(0, 2)}•••${d ? `@${d}` : ''}`;
};
function maskUrl(u) {
  try {
    const x = new URL(u);
    if (x.hostname === 'news.google.com') return `news.google.com  q="${(x.searchParams.get('q') || '').replace(/ when:\d+d$/, '')}"`;
    return `${x.hostname}/•••••• (link secreto oculto)`;
  } catch {
    return '(url inválida)';
  }
}

/* ── CORS ── */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
}
function originOk(req) {
  const o = req.headers.origin;
  if (!o || o === 'null' || o.startsWith('file://')) return true; // jarvis.html aberto com dois cliques
  try {
    const x = new URL(o);
    return x.hostname === '127.0.0.1' || x.hostname === 'localhost' || x.host === req.headers.host; // local ou a própria página servida pela antena
  } catch {
    return false;
  }
}

/* ── senha (modo hospedado): HTTP Basic, comparação em tempo constante, bloqueio após erros ── */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function createGate(password, { maxFails = 10, windowMs = 15 * 60000, now = Date.now } = {}) {
  const fails = new Map();
  const want = password ? sha(password) : null;
  // o último salto do X-Forwarded-For é o que o proxy da hospedagem viu (o primeiro o cliente pode forjar)
  const ipOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket?.remoteAddress || '?';
  return {
    enabled: !!want,
    /** → 'ok' | 'blocked' | 'denied' */
    check(req) {
      if (!want) return 'ok';
      const ip = ipOf(req), t = now();
      const f = fails.get(ip);
      if (f && t - f.since > windowMs) fails.delete(ip);
      if ((fails.get(ip)?.n || 0) >= maxFails) return 'blocked';
      const m = String(req.headers.authorization || '').match(/^Basic ([A-Za-z0-9+/=]+)$/);
      const pass = m ? Buffer.from(m[1], 'base64').toString('utf8').replace(/^[^:]*:/, '') : null;
      if (pass !== null && crypto.timingSafeEqual(sha(pass), want)) { fails.delete(ip); return 'ok'; }
      if (fails.size > 5000) fails.clear();
      if (pass !== null) fails.set(ip, { n: (fails.get(ip)?.n || 0) + 1, since: fails.get(ip)?.since || t });
      return 'denied';
    }
  };
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()'
};
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('corpo grande demais'), { status: 413 })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ══════════════ PROXY COM ALLOWLIST ══════════════ */
const redirectOk = (h) => PROXY_HOSTS.includes(h) || h.endsWith('.google.com') || h.endsWith('.googleusercontent.com');
function fetchUrl(url, left = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5' }, timeout: 20000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (left <= 0) return reject(Object.assign(new Error('redirecionamentos demais'), { code: 502 }));
        let next;
        try { next = new URL(res.headers.location, url); } catch { return reject(Object.assign(new Error('redirect inválido'), { code: 502 })); }
        if (next.protocol !== 'https:' || !redirectOk(next.hostname)) return reject(Object.assign(new Error('redirect para domínio fora da allowlist'), { code: 403 }));
        return resolve(fetchUrl(next.href, left - 1));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { req.destroy(); reject(Object.assign(new Error('resposta grande demais'), { code: 502 })); } else chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || 'text/plain', body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 504 })));
    req.on('error', reject);
  });
}

/* ══════════════ MIME ══════════════ */
function decodeCharset(buf, cs) {
  let c = String(cs || 'utf-8').toLowerCase().replace(/^"|"$/g, '').trim();
  if (c === 'utf8' || c === 'us-ascii' || c === 'ascii') c = 'utf-8';
  let out;
  try { out = new TextDecoder(c).decode(buf); } catch { out = buf.toString('utf8'); }
  if (c === 'utf-8' && (out.match(/\uFFFD/g) || []).length > 2) {
    try { out = new TextDecoder('windows-1252').decode(buf); } catch { out = buf.toString('latin1'); }
  }
  return out;
}
function qpBytes(input) {
  const s = input.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(Number.parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else if (c < 256) out.push(c);
    else for (const b of Buffer.from(s[i], 'utf8')) out.push(b);
  }
  return Buffer.from(out);
}
/** Assuntos/remetentes em MIME encoded-word (=?UTF-8?B?...?= / =?UTF-8?Q?...?=), juntando palavras vizinhas. */
function decodeWords(s) {
  if (!s) return '';
  const re = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
  let out = '', last = 0, pend = null;
  const flush = () => { if (pend) { out += decodeCharset(Buffer.concat(pend.bufs), pend.cs); pend = null; } };
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const between = s.slice(last, m.index);
    if (!(pend && /^\s*$/.test(between))) { flush(); out += between; }
    const cs = m[1].split('*')[0].toLowerCase();
    let bytes;
    try { bytes = m[2].toUpperCase() === 'B' ? Buffer.from(m[3], 'base64') : qpBytes(m[3].replace(/_/g, ' ')); } catch { bytes = Buffer.from(m[0]); }
    if (pend && pend.cs === cs) pend.bufs.push(bytes);
    else { flush(); pend = { cs, bufs: [bytes] }; }
    last = re.lastIndex;
  }
  flush();
  out += s.slice(last);
  return out.replace(/\s+/g, ' ').trim();
}
function parseHeaders(str) {
  const out = {};
  for (const line of String(str).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!(k in out)) out[k] = line.slice(i + 1).trim();
  }
  return out;
}
function parseCT(v) {
  const val = v || 'text/plain';
  const params = {};
  const re = /;\s*([\w\-*]+)\s*=\s*(?:"([^"]*)"|([^;\s]+))/g;
  for (let m = re.exec(val); m; m = re.exec(val)) params[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3];
  return { type: val.split(';')[0].trim().toLowerCase(), params };
}
function decodeBody(buf, cte, charset) {
  const enc = String(cte || '').trim().toLowerCase();
  let bytes = buf;
  if (enc === 'base64') {
    const c = buf.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, '');
    bytes = Buffer.from(c.slice(0, c.length - (c.length % 4)), 'base64');
  } else if (enc === 'quoted-printable') bytes = qpBytes(buf.toString('latin1'));
  return decodeCharset(bytes, charset);
}
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ccedil: 'ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', zwnj: '' };
function stripHtml(h) {
  return h
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(style|script|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(Number.parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
    .replace(/&([a-z]+);/gi, (m, x) => (ENT[x.toLowerCase()] != null ? ENT[x.toLowerCase()] : m));
}
function splitMultipart(buf, boundary) {
  const pieces = buf.toString('latin1').split(`--${boundary}`);
  const parts = [];
  for (let i = 1; i < pieces.length; i++) {
    let p = pieces[i];
    if (p.startsWith('--')) break;
    p = p.replace(/^\r?\n/, '');
    const sep = p.search(/\r?\n\r?\n/);
    const hs = sep < 0 ? p : p.slice(0, sep);
    const body = sep < 0 ? '' : p.slice(sep).replace(/^\r?\n\r?\n/, '');
    parts.push({ h: parseHeaders(hs), body: Buffer.from(body, 'latin1') });
  }
  return parts;
}
/** Texto legível do corpo: prefere text/plain; se só houver HTML, remove as tags. */
function partText(ctype, cte, buf, depth = 0) {
  const ct = parseCT(ctype);
  if (ct.type.startsWith('multipart/') && ct.params.boundary && depth < 5) {
    const parts = splitMultipart(buf, ct.params.boundary).filter((p) => !/attachment/i.test(p.h['content-disposition'] || ''));
    for (const p of parts) {
      const pc = parseCT(p.h['content-type']);
      if (pc.type === 'text/plain') {
        const t = decodeBody(p.body, p.h['content-transfer-encoding'], pc.params.charset);
        if (t.trim()) return t;
      }
    }
    let html = '';
    for (const p of parts) {
      const pc = parseCT(p.h['content-type']);
      if (pc.type.startsWith('multipart/')) {
        const t = partText(p.h['content-type'], p.h['content-transfer-encoding'], p.body, depth + 1);
        if (t.trim()) return t;
      } else if (pc.type === 'text/html' && !html) html = stripHtml(decodeBody(p.body, p.h['content-transfer-encoding'], pc.params.charset));
    }
    return html;
  }
  const t = decodeBody(buf, cte, ct.params.charset);
  return ct.type === 'text/html' ? stripHtml(t) : t;
}
const cleanSnippet = (t) => String(t || '').replace(/[\u200B-\u200D\u00AD\uFEFF\u2007\u00A0]|\u034F/g, ' ').replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 500);
function headerString(buf) {
  const s = buf.toString('utf8');
  return (s.match(/\uFFFD/g) || []).length > 1 ? buf.toString('latin1') : s;
}

/* ══════════════ CLIENTE IMAP MÍNIMO (porta 993, somente leitura) ══════════════ */
const tlsConnect = (host) => tls.connect({ host, port: 993, servername: host });
class Imap {
  constructor(host, connect = tlsConnect) {
    Object.assign(this, { host, connectFn: connect, buf: Buffer.alloc(0), n: 0, waiting: new Map(), untagged: [], cur: null, need: 0, greet: null, dead: null });
  }
  connect(ms) {
    return new Promise((resolve, reject) => {
      this.greet = { resolve, reject };
      this.sock = this.connectFn(this.host);
      this.sock.setTimeout(ms, () => this.fail(new Error('tempo esgotado na conexão IMAP')));
      this.sock.on('data', (d) => this.onData(d));
      this.sock.on('error', (e) => this.fail(e));
      this.sock.on('close', () => this.fail(new Error('conexão encerrada pelo servidor')));
    });
  }
  fail(e) {
    if (this.dead) return;
    this.dead = e;
    if (this.greet) { this.greet.reject(e); this.greet = null; }
    for (const w of this.waiting.values()) w.reject(e);
    this.waiting.clear();
    try { this.sock.destroy(); } catch { /* já fechado */ }
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.need > 0) {
        if (this.buf.length < this.need) return;
        this.cur.lits.push(this.buf.subarray(0, this.need));
        this.buf = this.buf.subarray(this.need);
        this.need = 0;
        continue;
      }
      const i = this.buf.indexOf('\r\n');
      if (i < 0) return;
      const line = this.buf.subarray(0, i).toString('utf8');
      this.buf = this.buf.subarray(i + 2);
      if (!this.cur) this.cur = { texts: [], lits: [] };
      this.cur.texts.push(line);
      const m = line.match(/\{(\d+)\+?\}$/);
      if (m) {
        this.need = Number(m[1]);
        if (!this.need) this.cur.lits.push(Buffer.alloc(0));
        continue;
      }
      const r = this.cur;
      this.cur = null;
      this.onResponse(r);
    }
  }
  onResponse(r) {
    const first = r.texts[0];
    if (this.greet) {
      const g = this.greet;
      this.greet = null;
      if (/^\* (OK|PREAUTH)/i.test(first)) g.resolve();
      else g.reject(new Error('servidor recusou a conexão'));
      return;
    }
    if (first.startsWith('* ')) { this.untagged.push(r); return; }
    const m = first.match(/^(A\d+) (OK|NO|BAD)\s?(.*)$/i);
    if (m && this.waiting.has(m[1])) {
      const w = this.waiting.get(m[1]);
      this.waiting.delete(m[1]);
      const u = this.untagged;
      this.untagged = [];
      w.resolve({ status: m[2].toUpperCase(), text: m[3], untagged: u });
    }
  }
  cmd(c) {
    if (this.dead) return Promise.reject(this.dead);
    const tag = `A${++this.n}`;
    return new Promise((resolve, reject) => {
      this.waiting.set(tag, { resolve, reject });
      this.sock.write(`${tag} ${c}\r\n`);
    });
  }
  close() {
    try { this.sock.write(`A${++this.n} LOGOUT\r\n`); this.sock.end(); } catch { /* já fechado */ }
    setTimeout(() => { try { this.sock.destroy(); } catch { /* já fechado */ } }, 1500).unref?.();
  }
}
const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Converte uma resposta FETCH em objeto de e-mail. */
function parseFetch(r, usuario) {
  const all = r.texts.join(' ');
  let hdr = Buffer.alloc(0), body = Buffer.alloc(0);
  r.lits.forEach((lit, i) => {
    const name = (r.texts[i].match(/(BODY\[[^\]]*\](?:<\d+>)?)\s*\{\d+\+?\}$/i) || [])[1] || '';
    if (/HEADER/i.test(name)) hdr = lit;
    else if (/TEXT/i.test(name)) body = lit;
  });
  const h = parseHeaders(headerString(hdr));
  const uid = (all.match(/UID (\d+)/) || [])[1] || '';
  const flags = (all.match(/FLAGS \(([^)]*)\)/) || [])[1] || '';
  const idate = (all.match(/INTERNALDATE "([^"]+)"/) || [])[1];
  const fromH = decodeWords(h.from || '');
  const fm = fromH.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  const email = fm ? fm[2].trim() : fromH.trim();
  const nome = fm?.[1].trim() ? fm[1].trim() : email;
  let d = Date.parse(h.date || '');
  if (Number.isNaN(d) && idate) d = Date.parse(idate);
  let trecho = '';
  try { trecho = cleanSnippet(partText(h['content-type'], h['content-transfer-encoding'], body, 0)); } catch { /* corpo exótico */ }
  return {
    id: (h['message-id'] || '').replace(/[<>\s]/g, '') || `${usuario}#${uid}`,
    conta: usuario, uid: Number(uid) || 0, remetente: nome, email,
    assunto: decodeWords(h.subject || '') || '(sem assunto)',
    data: Number.isNaN(d) ? null : new Date(d).toISOString(),
    trecho, lido: /\\Seen/i.test(flags)
  };
}

async function fetchEmails({ host, usuario, senhaApp, quantidade, connect }) {
  const im = new Imap(host, connect);
  try {
    await im.connect(25000);
    const login = await im.cmd(`LOGIN ${quote(usuario)} ${quote(senhaApp)}`);
    if (login.status !== 'OK') throw Object.assign(new Error(`login recusado: ${login.text.slice(0, 120)}`), { erro: 'login' });
    const ex = await im.cmd('EXAMINE INBOX'); // EXAMINE = somente leitura
    if (ex.status !== 'OK') throw Object.assign(new Error('não abri a caixa de entrada'), { erro: 'caixa' });
    let exists = 0;
    for (const r of ex.untagged) {
      const m = r.texts[0].match(/^\* (\d+) EXISTS/i);
      if (m) exists = Number(m[1]);
    }
    if (!exists) return [];
    const from = Math.max(1, exists - quantidade + 1);
    // BODY.PEEK: nunca marca como lido
    const f = await im.cmd(`FETCH ${from}:${exists} (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.16000>)`);
    if (f.status !== 'OK') throw Object.assign(new Error('falha ao buscar mensagens'), { erro: 'fetch' });
    return f.untagged
      .filter((r) => /^\* \d+ FETCH/i.test(r.texts[0]))
      .map((r) => parseFetch(r, usuario))
      .sort((a, b) => (Date.parse(b.data) || 0) - (Date.parse(a.data) || 0));
  } finally {
    im.close();
  }
}

/* ══════════════ TELEMETRIA: exportadores (OTLP · Datadog · New Relic · Sentry) ══════════════ */
function parseHeaderList(s) {
  const out = {};
  for (const kv of String(s || '').split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim());
  }
  return out;
}
/** Destinos OTLP a partir do ambiente. */
function otlpTargets(env) {
  const t = [];
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) t.push({ name: 'otlp', base: env.OTEL_EXPORTER_OTLP_ENDPOINT, headers: parseHeaderList(env.OTEL_EXPORTER_OTLP_HEADERS) });
  if (env.DD_OTLP_ENDPOINT) t.push({ name: 'datadog', base: env.DD_OTLP_ENDPOINT, headers: env.DD_API_KEY ? { 'dd-api-key': env.DD_API_KEY } : {} });
  if (env.NEW_RELIC_LICENSE_KEY) t.push({ name: 'newrelic', base: env.NEW_RELIC_OTLP_ENDPOINT || 'https://otlp.nr-data.net', headers: { 'api-key': env.NEW_RELIC_LICENSE_KEY } });
  return t.map((x) => ({ ...x, base: x.base.replace(/\/+$/, '') }));
}
/** https://<chave>@<host>/<projeto> → destino do envelope Sentry. */
function parseDsn(dsn) {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!u.username || !project) return null;
    return { key: u.username, url: `${u.protocol}//${u.host}/api/${project}/envelope/`, dsn };
  } catch {
    return null;
  }
}
function sentryEnvelope(event, dsn) {
  return `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
}
/** POST genérico (http ou https) com timeout. Resolve {status}. */
function postRaw(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'POST', headers: { 'Content-Length': Buffer.byteLength(body), ...headers }, timeout: 10000 }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode < 300 ? resolve({ status: res.statusCode }) : reject(new Error(`HTTP ${res.statusCode}`))));
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    req.end(body);
  });
}

function createTelemetry(env, post = postRaw) {
  const targets = otlpTargets(env);
  const sentry = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null;
  const resource = { attributes: [{ key: 'service.name', value: { stringValue: 'aurora-antena' } }, { key: 'service.version', value: { stringValue: VERSION } }] };
  const spans = [];
  const exporters = { otlp: false, datadog: false, newrelic: false, sentry: !!sentry };
  for (const t of targets) exporters[t.name] = true;

  async function forward(kind, payload) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const res = await Promise.allSettled(targets.map((t) => post(`${t.base}/v1/${kind}`, body, { 'Content-Type': 'application/json', ...t.headers })));
    return res.filter((r) => r.status === 'fulfilled').length;
  }
  async function sendSentry(event) {
    if (!sentry) return 0;
    await post(sentry.url, sentryEnvelope(event, sentry.dsn), { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${sentry.key}, sentry_client=aurora-antena/${VERSION}` });
    return 1;
  }
  /** Span da própria antena (uma requisição). */
  function record(name, start, attrs, error) {
    if (!targets.length) return;
    spans.push({
      traceId: crypto.randomBytes(16).toString('hex'), spanId: crypto.randomBytes(8).toString('hex'), name, kind: 2,
      startTimeUnixNano: `${start * 1e6}`, endTimeUnixNano: `${Date.now() * 1e6}`,
      attributes: Object.entries(attrs).map(([key, v]) => ({ key, value: typeof v === 'number' ? { intValue: String(v) } : { stringValue: String(v) } })),
      status: error ? { code: 2, message: error } : { code: 1 }
    });
    if (spans.length > 500) spans.shift();
  }
  async function flush() {
    if (!spans.length || !targets.length) return 0;
    const batch = spans.splice(0);
    return forward('traces', { resourceSpans: [{ resource, scopeSpans: [{ scope: { name: 'aurora-antena' }, spans: batch }] }] });
  }
  function captureError(err, tags = {}) {
    if (!sentry) return Promise.resolve(0);
    const e = err instanceof Error ? err : new Error(String(err));
    return sendSentry({
      event_id: crypto.randomBytes(16).toString('hex'), timestamp: Date.now() / 1000, platform: 'node', level: 'error', logger: 'aurora-antena',
      release: `aurora-antena@${VERSION}`, environment: 'local', tags, exception: { values: [{ type: e.name, value: e.message }] }
    }).catch(() => 0);
  }
  return { exporters, forward, sendSentry, record, flush, captureError };
}

/* ══════════════ CONHECIMENTO: pasta de notas .md (ex.: vault do Obsidian) indexada ao vivo ══════════════ */
const STOP = new Set('a o e é de da do das dos em no na nos nas um uma uns umas para pra por com sem que se ao aos os as ou mas como mais sua seu suas seus isso esse essa este esta ser foi são tem ter the and of to in is for on it como qual quais onde quando porque sobre funciona fazer faz me fala diga explica explique aurora chefe'.split(' '));
const normText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const stem = (t) => (t.length > 4 && t.endsWith('s') && !/[0-9]/.test(t) ? t.slice(0, -1) : t); // plural simples: preços → preco
const tokenize = (s) => normText(s).replace(/(\d)[.,](\d)/g, '$1_$2').split(/[^a-z0-9_]+/).filter((t) => t.length > 1 && !STOP.has(t)).map(stem);

/** Frontmatter YAML simples (name/description) + corpo. */
function parseFrontmatter(md) {
  const m = String(md).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: String(md) };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: String(md).slice(m[0].length) };
}
const cleanMd = (s) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** Divide uma nota em trechos por seção (título › subtítulo), com no máximo ~1600 caracteres cada. */
function chunkMarkdown(md, relPath, max = 1600) {
  const { meta, body } = parseFrontmatter(md);
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = meta.name || h1 || path.basename(relPath, '.md');
  const chunks = [];
  const heads = [];
  let buf = [];
  const push = () => {
    const text = cleanMd(buf.join('\n'));
    buf = [];
    if (text.replace(/^#+.*$/gm, '').trim().length < 20) return;
    const heading = heads.filter(Boolean).join(' › ');
    for (let i = 0; i < text.length; i += max) {
      let end = Math.min(text.length, i + max);
      if (end < text.length) { const cut = text.lastIndexOf('\n', end); if (cut > i + max / 2) end = cut; }
      chunks.push({ path: relPath, title, description: meta.description || '', heading, text: text.slice(i, end).trim() });
      if (end !== i + max) i = end - max;
    }
  };
  let inCode = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^```/.test(line)) inCode = !inCode;
    const h = !inCode && line.match(/^(#{1,4})\s+(.+)$/);
    if (h) { push(); heads.length = h[1].length - 1; heads[h[1].length - 1] = h[2].trim(); }
    buf.push(line);
  }
  push();
  return { title, description: meta.description || '', chunks };
}

function walkMd(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue; // .obsidian, .trash, .git
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, base, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Índice BM25 (com reforço para título/caminho/seção). */
function buildDocsIndex(dir) {
  const files = walkMd(dir).sort();
  const chunks = [], toc = [];
  for (const rel of files) {
    const r = chunkMarkdown(fs.readFileSync(path.join(dir, rel), 'utf8'), rel);
    toc.push({ path: rel, title: r.title, description: r.description });
    chunks.push(...r.chunks);
  }
  const df = new Map();
  let total = 0;
  for (const c of chunks) {
    const toks = tokenize(c.text);
    c.len = toks.length || 1;
    total += c.len;
    c.tf = new Map();
    for (const t of toks) c.tf.set(t, (c.tf.get(t) || 0) + 1);
    c.meta = new Set(tokenize(`${c.title} ${c.heading} ${c.path.replace(/[/-]/g, ' ').replace(/[.]md$/, '')}`));
    for (const t of new Set([...c.tf.keys(), ...c.meta])) df.set(t, (df.get(t) || 0) + 1);
  }
  return { dir, files: files.length, chunks, toc, df, avgdl: total / (chunks.length || 1), builtAt: Date.now() };
}

function searchDocs(idx, q, k = 6) {
  const terms = [...new Set(tokenize(q))];
  if (!terms.length || !idx.chunks.length) return [];
  const N = idx.chunks.length;
  const scored = [];
  for (const c of idx.chunks) {
    let s = 0;
    for (const t of terms) {
      const n = idx.df.get(t) || 0;
      if (!n) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = c.tf.get(t) || 0;
      if (f) s += idf * ((f * 2.2) / (f + 1.2 * (0.25 + (0.75 * c.len) / idx.avgdl)));
      if (c.meta.has(t)) s += idf * 2.4;
    }
    if (s > 0) scored.push([s, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, k).map(([score, c]) => ({ path: c.path, title: c.title, heading: c.heading, text: c.text, score: Math.round(score * 100) / 100 }));
}

/** Índice preguiçoso + observa a pasta (edições no Obsidian reindexam sozinhas). */
function createDocs(dir, log) {
  let idx = null, watcher = null, dirty = true;
  const available = () => !!dir && fs.existsSync(dir);
  function get() {
    if (!available()) return null;
    if (dirty || !idx) {
      const t0 = Date.now();
      idx = buildDocsIndex(dir);
      dirty = false;
      log('📚 DOCS indexados:', idx.files, 'notas ·', idx.chunks.length, 'trechos', `(${Date.now() - t0} ms)`);
      if (!watcher) {
        try {
          let t = 0;
          watcher = fs.watch(dir, { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => { dirty = true; }, 400); });
          watcher.unref?.();
        } catch { /* sem watch recursivo: reindexa só ao reiniciar */ }
      }
    }
    return idx;
  }
  return {
    status() {
      const i = get();
      if (!i) return { ok: true, available: false, dir };
      const folders = {};
      for (const f of i.toc) { const top = f.path.includes('/') ? f.path.split('/')[0] : '(raiz)'; folders[top] = (folders[top] || 0) + 1; }
      return { ok: true, available: true, dir, files: i.files, chunks: i.chunks.length, builtAt: i.builtAt, folders };
    },
    toc: () => get()?.toc || [],
    search: (q, k) => (get() ? searchDocs(get(), q, k) : []),
    close: () => watcher?.close()
  };
}

/* ══════════════ SERVIDOR ══════════════ */
const ROUTE_NAMES = { '/': 'app', '/index.html': 'app', '/health': 'health', '/proxy': 'proxy', '/emails': 'emails', '/telemetry/traces': 'telemetry', '/telemetry/logs': 'telemetry', '/telemetry/sentry': 'telemetry', '/docs/status': 'docs', '/docs/search': 'docs', '/docs/toc': 'docs' };

const defaultDocsDir = (env) => env.DOCS_DIR || path.join(__dirname, 'knowledge');
const defaultAppFile = (env) => env.AURORA_APP || [path.join(__dirname, 'dist', 'jarvis.html'), path.join(__dirname, 'jarvis.html')].find((f) => fs.existsSync(f));

function createServer({ fetch: doFetch = fetchUrl, connect, env = process.env, log = defaultLog, post, docsDir = defaultDocsDir(env), appFile = defaultAppFile(env), password = env.AURORA_PASSWORD } = {}) {
  const tel = createTelemetry(env, post);
  const docs = createDocs(docsDir, log);
  const gate = createGate(password);

  function serveApp(res) {
    let html;
    try { html = fs.readFileSync(appFile); } catch { return json(res, 404, { ok: false, mensagem: 'app não encontrado — rode npm run build' }); }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  }

  async function handleProxy(res, u) {
    let t;
    try { t = new URL(u.searchParams.get('url')); } catch { return json(res, 400, { ok: false, mensagem: 'url inválida' }); }
    if (t.protocol !== 'https:' || !PROXY_HOSTS.includes(t.hostname)) {
      log('✖ PROXY bloqueado:', t.hostname);
      return json(res, 403, { ok: false, mensagem: 'domínio fora da allowlist' });
    }
    try {
      const r = await doFetch(t.href, 3);
      log(r.status === 200 ? '✔' : '!', 'PROXY', maskUrl(t.href), '→', r.status, `${(r.body.length / 1024).toFixed(1)} KB`);
      cors(res);
      res.writeHead(r.status, { 'Content-Type': r.type, 'Cache-Control': 'no-store' });
      res.end(r.body);
    } catch (e) {
      log('✖ PROXY', maskUrl(t.href), '→', e.message);
      json(res, e.code === 403 ? 403 : 502, { ok: false, mensagem: e.message });
    }
  }

  async function handleEmails(req, res) {
    let p;
    try { p = JSON.parse(await readBody(req, 16384)); } catch { return json(res, 400, { ok: false, erro: 'json', mensagem: 'JSON inválido' }); }
    const host = String(p.host || '').toLowerCase().trim(), usuario = String(p.usuario || '').trim(), senha = String(p.senhaApp || '');
    const qtd = Math.min(50, Math.max(1, Number.parseInt(p.quantidade, 10) || 20));
    if (!IMAP_HOSTS.includes(host)) { log('✖ EMAILS host bloqueado:', host); return json(res, 403, { ok: false, erro: 'host', mensagem: 'servidor IMAP fora da allowlist' }); }
    if (!usuario || !senha) return json(res, 400, { ok: false, erro: 'dados', mensagem: 'e-mail e senha de app são obrigatórios' });
    const t0 = Date.now();
    try {
      const emails = await fetchEmails({ host, usuario, senhaApp: senha, quantidade: qtd, connect });
      log('✔ EMAILS', host, maskUser(usuario), '→', emails.length, 'e-mails', `(${Date.now() - t0} ms)`);
      json(res, 200, { ok: true, conta: usuario, emails });
    } catch (e) {
      log('✖ EMAILS', host, maskUser(usuario), '→', e.erro === 'login' ? 'login recusado' : e.message);
      json(res, e.erro === 'login' ? 401 : 502, { ok: false, erro: e.erro || 'conexao', mensagem: e.erro === 'login' ? 'login recusado pelo provedor' : e.message });
    }
  }

  async function handleTelemetry(req, res, kind) {
    let payload;
    try { payload = JSON.parse(await readBody(req, 512 * 1024)); } catch (e) { return json(res, e.status || 400, { ok: false, mensagem: 'telemetria inválida' }); }
    const valid = kind === 'traces' ? Array.isArray(payload.resourceSpans) : kind === 'logs' ? Array.isArray(payload.resourceLogs) : typeof payload.event_id === 'string';
    if (!valid) return json(res, 400, { ok: false, mensagem: 'formato inesperado' });
    try {
      const n = kind === 'sentry' ? await tel.sendSentry(payload) : await tel.forward(kind, payload);
      json(res, 202, { ok: true, encaminhado: n });
    } catch (e) {
      json(res, 502, { ok: false, mensagem: e.message });
    }
  }

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    if (!originOk(req)) { res.writeHead(403); return res.end('origem não permitida'); }
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
    const g = gate.check(req);
    if (g === 'blocked') { res.writeHead(429, { 'Retry-After': '900' }); return res.end('muitas tentativas — aguarde 15 minutos'); }
    if (g === 'denied') { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Aurora", charset="UTF-8"' }); return res.end('senha necessária'); }
    let u;
    try { u = new URL(req.url, 'http://antena'); } catch { return json(res, 400, { ok: false }); }
    const route = ROUTE_NAMES[u.pathname] || 'desconhecida';
    try {
      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) serveApp(res);
      else if (req.method === 'GET' && u.pathname === '/health') json(res, 200, { ok: true, nome: 'antena-aurora', versao: VERSION, proxy: PROXY_HOSTS, imap: IMAP_HOSTS, exporters: tel.exporters, docs: docs.status().available });
      else if (req.method === 'GET' && u.pathname === '/docs/status') json(res, 200, docs.status());
      else if (req.method === 'GET' && u.pathname === '/docs/toc') json(res, 200, { ok: true, toc: docs.toc() });
      else if (req.method === 'GET' && u.pathname === '/docs/search') {
        const q = String(u.searchParams.get('q') || '').slice(0, 500);
        const k = Math.min(12, Math.max(1, Number.parseInt(u.searchParams.get('k'), 10) || 6));
        json(res, 200, { ok: true, results: docs.search(q, k) });
      }
      else if (req.method === 'GET' && u.pathname === '/proxy') await handleProxy(res, u);
      else if (req.method === 'POST' && u.pathname === '/emails') await handleEmails(req, res);
      else if (req.method === 'POST' && u.pathname.startsWith('/telemetry/')) {
        const kind = u.pathname.split('/')[2];
        if (!['traces', 'logs', 'sentry'].includes(kind)) json(res, 404, { ok: false });
        else await handleTelemetry(req, res, kind);
      } else json(res, 404, { ok: false, mensagem: 'rota não encontrada' });
      if (route !== 'telemetry') tel.record(`antena ${req.method} ${route}`, start, { 'http.route': route, 'http.status_code': res.statusCode });
    } catch (e) {
      log('✖ erro interno:', e.message);
      tel.record(`antena ${req.method} ${route}`, start, { 'http.route': route }, e.message);
      tel.captureError(e, { route });
      if (!res.headersSent) json(res, 500, { ok: false, mensagem: 'erro interno' });
    }
  });
  const timer = setInterval(() => { tel.flush().catch(() => {}); }, 10000);
  timer.unref?.();
  server.on('close', () => { clearInterval(timer); docs.close(); });
  server.telemetry = tel;
  server.docs = docs;
  server.locked = gate.enabled;
  return server;
}

/** Carrega .env (se existir) sem dependências. */
function loadEnv(file = path.join(__dirname, '.env')) {
  if (!fs.existsSync(file)) return false;
  if (typeof process.loadEnvFile === 'function') { process.loadEnvFile(file); return true; }
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return true;
}

/** Onde escutar. Fora do loopback (hospedado) a senha é obrigatória. → { host, port } | { erro } */
function listenConfig(env) {
  const host = env.AURORA_HOST || '127.0.0.1';
  const port = Number(env.PORT || env.AURORA_PORT) || 4242;
  if (!LOOPBACK.includes(host) && String(env.AURORA_PASSWORD || '').length < 12) {
    return { erro: `AURORA_HOST=${host} expõe a antena na rede: defina AURORA_PASSWORD (12+ caracteres) no .env ou nas variáveis da hospedagem.` };
  }
  return { host, port };
}

function start() {
  loadEnv();
  const cfg = listenConfig(process.env);
  if (cfg.erro) { console.error(`\n  ✖ ${cfg.erro}\n`); process.exit(1); }
  const { host: HOST, port: PORT } = cfg;
  const server = createServer();
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  ✖ A porta ${PORT} já está ocupada.\n    Provavelmente a antena já está rodando em outro terminal — use aquele, ou feche-o (Ctrl+C) e rode de novo:  node server.js\n`);
    } else console.error('\n  ✖ Não consegui ligar a antena:', e.message, '\n');
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    const ex = Object.entries(server.telemetry.exporters).filter(([, v]) => v).map(([k]) => k);
    const hosted = !LOOPBACK.includes(HOST);
    console.log(`\n  ⚡ ANTENA DA AURORA ONLINE — porta ${PORT}. ${hosted ? 'Modo hospedado (com senha).' : `Abra http://127.0.0.1:${PORT} ou o dist/jarvis.html.`}`);
    console.log(`  ↳ escutando em ${HOST}${server.locked ? ' · protegida por senha' : ''} · agenda/notícias: ${PROXY_HOSTS.join(', ')} · IMAP: ${IMAP_HOSTS.join(', ')}`);
    const d = server.docs.status();
    console.log(`  ↳ conhecimento: ${d.available ? `${d.files} notas (${d.chunks} trechos)` : `pasta não encontrada (${d.dir}) — defina DOCS_DIR no .env`}`);
    console.log(`  ↳ telemetria: ${ex.length ? ex.join(', ') : 'só local (configure o .env para exportar)'}`);
    console.log('  ↳ deixe este terminal aberto. Ctrl+C desliga.\n');
  });
  process.on('uncaughtException', (e) => { console.error('  ✖', e.message); server.telemetry.captureError(e, { origem: 'uncaughtException' }); });
}

module.exports = { createServer, chunkMarkdown, buildDocsIndex, searchDocs, parseFrontmatter, tokenize, fetchEmails, Imap, decodeWords, partText, parseHeaders, qpBytes, stripHtml, parseDsn, otlpTargets, parseHeaderList, sentryEnvelope, maskUser, maskUrl, originOk, loadEnv, createGate, listenConfig, PROXY_HOSTS, IMAP_HOSTS };

if (require.main === module) start();
