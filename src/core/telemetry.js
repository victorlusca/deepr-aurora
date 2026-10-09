// Observabilidade sem SDK: spans e logs no formato OpenTelemetry (OTLP/JSON) e erros no formato do Sentry.
// Tudo passa por `scrub` antes de sair do navegador: nada de chaves, senhas, links secretos ou conteúdo de e-mail.

const SECRET_KEY = /(key|senha|password|pass|token|secret|auth|dsn|cookie|url_secreta|ical)/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const SK = /\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g;
const ICAL = /https:\/\/calendar\.google\.com\/calendar\/ical\/\S+/g;

export function scrubString(s, max = 300) {
  return String(s)
    .replace(SK, '[chave]')
    .replace(ICAL, '[link-ical]')
    .replace(EMAIL, (m) => `${m.slice(0, 2)}•••@${m.split('@')[1]}`)
    .slice(0, max);
}

export function scrub(attrs = {}) {
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (SECRET_KEY.test(k)) { out[k] = '[removido]'; continue; }
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = scrubString(typeof v === 'string' ? v : JSON.stringify(v));
  }
  return out;
}

const hex = (bytes, rnd) => Array.from({ length: bytes }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');

function otlpValue(v) {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
const otlpAttrs = (o) => Object.entries(o).map(([key, v]) => ({ key, value: otlpValue(v) }));
const nanos = (ms) => `${Math.round(ms * 1e6)}`;
const SEVERITY = { debug: 5, info: 9, warn: 13, error: 17 };

export function toOTLPTraces(spans, resource) {
  return {
    resourceSpans: [{
      resource: { attributes: otlpAttrs(resource) },
      scopeSpans: [{
        scope: { name: 'aurora', version: resource['service.version'] },
        spans: spans.map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
          name: s.name,
          kind: 1,
          startTimeUnixNano: nanos(s.start),
          endTimeUnixNano: nanos(s.end),
          attributes: otlpAttrs(s.attrs),
          status: s.status === 'error' ? { code: 2, message: s.error || 'erro' } : { code: 1 }
        }))
      }]
    }]
  };
}

export function toOTLPLogs(logs, resource) {
  return {
    resourceLogs: [{
      resource: { attributes: otlpAttrs(resource) },
      scopeLogs: [{
        scope: { name: 'aurora' },
        logRecords: logs.map((l) => ({
          timeUnixNano: nanos(l.time),
          severityNumber: SEVERITY[l.level] || 9,
          severityText: l.level.toUpperCase(),
          body: { stringValue: l.msg },
          attributes: otlpAttrs(l.attrs)
        }))
      }]
    }]
  };
}

export function parseStack(stack) {
  return String(stack || '')
    .split('\n')
    .map((l) => l.match(/at (?:(.+?) \()?(.*?):(\d+):(\d+)\)?$/))
    .filter(Boolean)
    .map((m) => ({ function: m[1] || '?', filename: m[2].split('/').pop(), lineno: +m[3], colno: +m[4], in_app: true }))
    .reverse();
}

export function toSentryEvent(err, ctx, { eventId, release, now }) {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    event_id: eventId,
    timestamp: now / 1000,
    platform: 'javascript',
    level: 'error',
    logger: 'aurora',
    release,
    environment: 'local',
    exception: { values: [{ type: e.name || 'Error', value: scrubString(e.message), stacktrace: { frames: parseStack(e.stack) } }] },
    tags: scrub(ctx.tags || {}),
    extra: scrub(ctx.extra || {})
  };
}

/**
 * createTelemetry({ service, version, transport, now, rnd })
 * transport(kind, payload) → Promise; kind ∈ 'traces' | 'logs' | 'sentry'
 */
export function createTelemetry({ service = 'aurora', version = '0', transport = null, now = () => Date.now(), rnd = Math.random, max = 300 } = {}) {
  const resource = { 'service.name': service, 'service.version': version, 'deployment.environment': 'local' };
  const spans = [], logs = [], errors = [], pending = { spans: [], logs: [] };
  const subs = new Set();
  let exportEnabled = true;
  const stats = { exported: 0, failed: 0, lastExport: 0, lastError: '' };
  const emit = () => { for (const f of subs) f(); };
  const ring = (arr, item) => { arr.push(item); if (arr.length > max) arr.shift(); };

  function startSpan(name, attrs = {}, parent = null) {
    const s = { traceId: parent?.traceId || hex(16, rnd), spanId: hex(8, rnd), parentSpanId: parent?.spanId, name, start: now(), end: 0, attrs: scrub(attrs), status: 'ok' };
    return {
      ctx: s,
      set(k, v) { Object.assign(s.attrs, scrub({ [k]: v })); },
      end(status = 'ok', extra = {}) {
        if (s.end) return;
        s.end = now();
        s.status = status;
        Object.assign(s.attrs, scrub(extra));
        if (status === 'error') s.error = scrubString(extra.error || 'erro');
        ring(spans, s); pending.spans.push(s); emit();
      }
    };
  }

  /** Mede uma função assíncrona como span. */
  async function span(name, attrs, fn, parent) {
    const sp = startSpan(name, attrs, parent);
    try {
      const r = await fn(sp);
      sp.end('ok');
      return r;
    } catch (e) {
      sp.end('error', { error: e?.message || String(e) });
      throw e;
    }
  }

  function log(level, msg, attrs = {}) {
    const l = { time: now(), level, msg: scrubString(msg), attrs: scrub(attrs) };
    ring(logs, l); pending.logs.push(l); emit();
  }

  function error(err, ctx = {}) {
    const ev = toSentryEvent(err, ctx, { eventId: hex(16, rnd), release: `${service}@${version}`, now: now() });
    ring(errors, ev);
    log('error', ev.exception.values[0].value, { 'error.type': ev.exception.values[0].type, ...(ctx.tags || {}) });
    if (exportEnabled && transport) {
      transport('sentry', ev).then(() => { stats.exported++; }, () => { stats.failed++; });
    }
    emit();
    return ev;
  }

  async function flush() {
    if (!exportEnabled || !transport) { pending.spans.length = 0; pending.logs.length = 0; return false; }
    const sp = pending.spans.splice(0), lg = pending.logs.splice(0);
    if (!sp.length && !lg.length) return true;
    try {
      if (sp.length) await transport('traces', toOTLPTraces(sp, resource));
      if (lg.length) await transport('logs', toOTLPLogs(lg, resource));
      stats.exported += sp.length + lg.length;
      stats.lastExport = now();
      return true;
    } catch (e) {
      stats.failed += sp.length + lg.length;
      stats.lastError = e?.message || String(e);
      // devolve para a fila (limitado) — tenta no próximo ciclo
      pending.spans.unshift(...sp.slice(-100)); pending.logs.unshift(...lg.slice(-100));
      return false;
    }
  }

  return {
    startSpan, span, log, error, flush,
    setExport(v) { exportEnabled = !!v; },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    snapshot: () => ({ spans: spans.slice(), logs: logs.slice(), errors: errors.slice(), stats: { ...stats, pending: pending.spans.length + pending.logs.length } }),
    resource
  };
}
