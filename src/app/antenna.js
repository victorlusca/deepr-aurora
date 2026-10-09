// Cliente da antena local (server.js): agenda/notícias via /proxy e e-mails via /emails.
import { emit } from './bus.js';
import { tel } from './obs.js';
import { ANTENNA, net } from './state.js';

export function fetchT(url, opts = {}, ms = 20000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(id));
}

let last = 0;
export async function checkAntenna(force = false) {
  if (!force && net.antenna !== null && Date.now() - last < 20000) return net.antenna;
  last = Date.now();
  const was = net.antenna;
  try {
    const r = await fetchT(`${ANTENNA}/health`, {}, 2500);
    const j = await r.json();
    net.antenna = r.ok;
    net.exporters = j.exporters || {};
  } catch {
    net.antenna = false;
  }
  if (was !== net.antenna) {
    emit('antenna', net.antenna);
    tel.log(net.antenna ? 'info' : 'warn', net.antenna ? 'antena online' : 'antena offline');
  }
  return net.antenna;
}

export async function proxy(url, label) {
  return tel.span('antena.proxy', { 'proxy.alvo': label }, async (sp) => {
    const r = await fetchT(`${ANTENNA}/proxy?url=${encodeURIComponent(url)}`, {}, 25000);
    sp.set('http.status_code', r.status);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}${t ? ` · ${t.slice(0, 100)}` : ''}`);
    }
    return r.text();
  });
}

export async function fetchEmails(body, label) {
  return tel.span('antena.emails', { 'email.conta': label, 'email.host': body.host }, async (sp) => {
    const r = await fetchT(`${ANTENNA}/emails`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 45000);
    const j = await r.json().catch(() => ({}));
    sp.set('http.status_code', r.status);
    if (!r.ok || !j.ok) throw Object.assign(new Error(j.mensagem || `HTTP ${r.status}`), { code: j.erro });
    sp.set('email.quantidade', j.emails.length);
    return j.emails;
  });
}
