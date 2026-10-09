// Central de E-mails: várias contas IMAP, triagem AÇÃO · INFO · RUÍDO (1 chamada por lote + cache).
import { CONFIG, PROFILE, PROVIDERS } from '../core/config.js';
import { esc } from '../core/text.js';
import { relative } from '../core/time.js';
import { heuristic, parseTriage, pruneCache, triagePrompt } from '../core/triage.js';
import { checkAntenna, fetchEmails } from './antenna.js';
import { callAI } from './brain.js';
import { emit } from './bus.js';
import { icon } from './icons.js';
import { skeleton } from './motion.js';
import { tel } from './obs.js';
import { accounts, getKey, net, settings } from './state.js';
import { store } from './store.js';
import { track } from './ui.js';
import { emptyState, errorRow, offline } from './views.js';

const cached = store.get('jarvis_email_cache', {});
export const mail = { items: cached.items || [], errors: {}, last: cached.t || 0, loading: false, loaded: !!cached.t, noiseOpen: false };

const ready = () => accounts().filter((a) => a.email && a.senha);
const A = CONFIG.address;

const LOGIN_MSG = {
  gmail: 'Senha de app inválida ou 2 etapas desativada — refaça em myaccount.google.com/apppasswords',
  outlook: 'A Microsoft recusou o login por senha (pode exigir OAuth). Plano B: encaminhe o Outlook para o Gmail.',
  hostinger: PROFILE.customDomain.error
};

export async function refreshMail(force = false) {
  const accs = ready();
  if (!accs.length) { emit('data', 'emails'); return; }
  if (mail.loading || (!force && Date.now() - mail.last < 60000)) return;
  mail.loading = true;
  emit('data', 'emails');
  await track(tel.span('email.refresh', { 'email.contas': accs.length }, async () => {
    try {
      if (!(await checkAntenna(true))) return;
      const all = [];
      mail.errors = {};
      await Promise.all(accs.map(async (a) => {
        const pv = PROVIDERS[a.provider] || PROVIDERS.gmail;
        const senha = a.provider === 'gmail' ? a.senha.replace(/\s+/g, '') : a.senha;
        try {
          const list = await fetchEmails({ host: pv.host, usuario: a.email.trim(), senhaApp: senha, quantidade: settings.value.emailCount }, `${a.apelido}/${pv.tag}`);
          for (const m of list) all.push({ ...m, acc: a.id, apelido: a.apelido, cor: a.cor, tag: pv.tag });
        } catch (e) {
          mail.errors[a.id] = `${a.apelido} · ${pv.tag}: ${e.code === 'login' ? LOGIN_MSG[a.provider] || e.message : e.message}`;
        }
      }));
      all.sort((x, y) => (Date.parse(y.data) || 0) - (Date.parse(x.data) || 0));
      await triage(all);
      mail.items = all;
      mail.last = Date.now();
      mail.loaded = true;
      store.set('jarvis_email_cache', { t: mail.last, items: all });
    } finally {
      mail.loading = false;
      emit('data', 'emails');
    }
  }).catch(() => {}));
}

/** Triagem: e-mails já classificados nunca voltam à API (cache por Message-ID). */
async function triage(items) {
  const cache = store.get('jarvis_email_triage', {});
  const pending = items.filter((m) => !cache[m.id] || (cache[m.id].by === 'local' && getKey()));
  if (pending.length) {
    let ok = false;
    if (getKey()) {
      try {
        await tel.span('email.triagem', { 'email.lote': pending.length }, async () => {
          for (let i = 0; i < pending.length; i += 25) {
            const batch = pending.slice(i, i + 25);
            const text = await callAI({
              system: 'Você é um classificador de e-mails. Responda APENAS com JSON válido, sem nenhum texto antes ou depois.',
              messages: [{ role: 'user', content: triagePrompt(batch) }],
              maxTokens: Math.min(2500, 90 * batch.length + 120),
              purpose: 'triagem'
            });
            for (const [idx, r] of parseTriage(text, batch)) {
              const m = batch[idx];
              cache[m.id] = { ...r, by: 'ia', t: Date.now(), done: cache[m.id]?.done };
            }
          }
        });
        ok = true;
      } catch (e) {
        tel.error(e, { tags: { area: 'triagem' } });
      }
    }
    for (const m of pending) if (!cache[m.id] || (!ok && cache[m.id].by !== 'ia')) cache[m.id] = { ...heuristic(m), by: 'local', t: Date.now() };
    store.set('jarvis_email_triage', pruneCache(cache));
  }
  for (const m of items) Object.assign(m, cache[m.id] || heuristic(m));
}

export const bucket = (b) => mail.items.filter((m) => m.balde === b && !(b === 'acao' && m.done));
export function markDone(id) {
  const c = store.get('jarvis_email_triage', {});
  if (c[id]) { c[id].done = true; store.set('jarvis_email_triage', c); }
  const m = mail.items.find((x) => x.id === id);
  if (m) m.done = true;
  emit('badge', bucket('acao').length);
}

const row = (m) => `<article class="mail${m.lido ? '' : ' unread'}" data-mid="${esc(m.id)}" data-enter tabindex="0">
  <div class="mail-top"><i class="dot" style="background:${esc(m.cor)}"></i><b class="mail-from">${esc(m.remetente)}</b><span class="tag">${esc(m.tag)}</span><time>${m.data ? relative(Date.parse(m.data)) : ''}</time></div>
  <p class="mail-sum">${esc(m.resumo)}</p>
  <div class="mail-more"><div><b>${esc(m.assunto)}</b><p>${esc(m.trecho || '')}</p></div></div>
  ${m.balde === 'acao' ? `<button class="icon-btn sm done-btn" data-done="${esc(m.id)}" title="Marcar como resolvido (só na Aurora)" aria-label="Marcar como resolvido">${icon('check')}</button>` : ''}
</article>`;

export function mailHTML() {
  if (!ready().length) {
    return emptyState('mail', 'Nenhuma conta conectada', 'Clique em <b>configurações</b> → <b>E-mails</b> e cole o e-mail e a <b>senha de app</b>. Gmail, Outlook e domínio próprio (Hostinger) já estão pré-configurados.');
  }
  if (mail.loading && !mail.loaded) return skeleton(6);
  let h = net.antenna === false ? offline() : '';
  for (const e of Object.values(mail.errors)) h += errorRow(e);
  const mode = mail.items.some((m) => m.by === 'local') ? '<span class="chip warn">triagem local</span>' : mail.items.length ? '<span class="chip violet">triagem IA</span>' : '';
  const sec = (b, title, ic) => {
    const l = bucket(b), noise = b === 'ruido';
    return `<section class="bucket b-${b}${noise && !mail.noiseOpen ? ' closed' : ''}">
      <button class="bucket-head" ${noise ? 'data-toggle-noise' : 'tabindex="-1"'} aria-expanded="${!noise || mail.noiseOpen}">${icon(ic)}<span>${title}</span><span class="count">${l.length}</span>${noise ? icon('chevron', 'chev') : ''}</button>
      <div class="bucket-items">${l.map(row).join('') || '<p class="muted pad">nada aqui.</p>'}</div>
    </section>`;
  };
  h += `<div class="row-between" data-enter>${mode}</div>`;
  h += sec('acao', 'Pedem ação', 'bolt') + sec('info', 'Informativos', 'mail') + sec('ruido', 'Ruído', 'wave');
  return h;
}

export function mailGlance() {
  if (!ready().length) return { text: 'Conectar e-mails', sub: 'nenhuma conta', ic: 'mail' };
  const n = bucket('acao').length;
  return { text: n ? `${n} ${n === 1 ? 'pede' : 'pedem'} ação` : 'Caixa sob controle', sub: `${mail.items.length} recentes`, ic: 'mail', hot: n > 0 };
}

export async function voiceSummary() {
  emit('focus', 'emails');
  if (!ready().length) return `Nenhuma conta de e-mail conectada ainda, ${A}. Cole o e-mail e a senha de app nas configurações.`;
  if (net.antenna === false && !mail.items.length) return `Minha antena está desligada, ${A}. Rode node server.js na pasta do projeto.`;
  const a = bucket('acao'), i = bucket('info'), r = bucket('ruido');
  let s = `Na caixa de entrada, ${A}: ${a.length} ${a.length === 1 ? 'pede' : 'pedem'} ação, ${i.length} informativos e ${r.length} de ruído.`;
  if (a.length) s += ` Os que pedem ação: ${a.slice(0, 5).map((m) => `de ${m.remetente}: ${m.resumo}`).join('. ')}.`;
  return s;
}
export async function voiceImportant() {
  emit('focus', 'emails');
  if (!ready().length) return `Nenhuma conta de e-mail conectada ainda, ${A}.`;
  const a = bucket('acao');
  if (!a.length) return `Excelente notícia, ${A}: nenhum e-mail pedindo ação. Caixa sob controle.`;
  return `${a.length === 1 ? 'Há um e-mail' : `Há ${a.length} e-mails`} pedindo sua atenção, ${A}. ${a.slice(0, 5).map((m) => `De ${m.remetente}: ${m.resumo}`).join('. ')}.`;
}
export async function voiceRefreshMail() {
  emit('focus', 'emails');
  await refreshMail(true);
  return `E-mails atualizados, ${A}. ${bucket('acao').length} pedindo ação.`;
}
