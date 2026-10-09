// Folha lateral com abas. Lazy: só a aba ativa é renderizada; troca de aba com saída/entrada suave.
import { hhmm } from '../core/time.js';
import { agenda, agendaGlance, agendaHTML, refreshAgenda } from './agenda.js';
import { digest, digestHTML } from './briefing.js';
import { emit, on } from './bus.js';
import { icon } from './icons.js';
import { bucket, mail, mailGlance, mailHTML, markDone, refreshMail } from './mail.js';
import { removeAnimated, swap } from './motion.js';
import { news, newsHTML, refreshNews } from './newsfeed.js';
import { TZ } from './state.js';
import { $ } from './ui.js';

const TABS = [
  { id: 'agenda', label: 'Agenda', ic: 'calendar', html: agendaHTML, refresh: () => refreshAgenda(true), last: () => agenda.last, loading: () => agenda.loading },
  { id: 'emails', label: 'E-mails', ic: 'mail', html: mailHTML, refresh: () => refreshMail(true), last: () => mail.last, loading: () => mail.loading },
  { id: 'news', label: 'Notícias', ic: 'news', html: newsHTML, refresh: () => refreshNews(true), last: () => Math.max(0, ...Object.values(news.data).map((d) => d.t || 0)), loading: () => news.loading },
  { id: 'digest', label: 'Briefing', ic: 'sparkle', html: digestHTML, refresh: null, last: () => digest.at, loading: () => digest.running }
];
let active = 'agenda';

function paintHeader() {
  const t = TABS.find((x) => x.id === active);
  const last = t.last();
  $('sheetMeta').textContent = t.loading() ? 'atualizando…' : last ? `atualizado ${hhmm(last, TZ)}` : '';
  const btn = $('sheetRefresh');
  btn.hidden = !t.refresh;
  btn.dataset.busy = t.loading() ? '1' : '';
  btn.setAttribute('aria-label', `Atualizar ${t.label}`);
}

function render(animate) {
  const t = TABS.find((x) => x.id === active);
  const body = $('sheetBody');
  const html = t.html();
  const wasSkeleton = body.dataset.sk === '1';
  body.dataset.sk = html.includes('sk-list') ? '1' : '';
  swap(body, html, { animate: animate || wasSkeleton });
  body.setAttribute('aria-busy', t.loading() ? 'true' : 'false');
  paintHeader();
}

export function focusTab(id, { animate = true } = {}) {
  if (!TABS.some((t) => t.id === id)) return;
  const changed = id !== active;
  active = id;
  for (const b of document.querySelectorAll('[data-tab]')) {
    const on2 = b.dataset.tab === id;
    b.setAttribute('aria-selected', on2 ? 'true' : 'false');
    b.tabIndex = on2 ? 0 : -1;
  }
  const idx = TABS.findIndex((t) => t.id === id);
  $('tabsIndicator').style.transform = `translateX(${idx * 100}%)`;
  if (changed || !$('sheetBody').childElementCount) render(animate);
  if (matchMedia('(max-width: 980px)').matches && changed) $('sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function paintGlances() {
  const a = agendaGlance(), m = mailGlance();
  const d = digest.text ? { text: 'Briefing pronto', sub: 'ouvir de novo' } : { text: 'Briefing do dia', sub: 'diga "bom dia"' };
  const chip = (id, ic, g, hot) => `<button class="glance${hot ? ' hot' : ''}" data-glance="${id}">${icon(ic)}<span><b>${g.text}</b><small>${g.sub}</small></span></button>`;
  const html = chip('agenda', 'calendar', a) + chip('emails', 'mail', m, m.hot) + chip('digest', 'sparkle', d);
  const host = $('glances');
  if (host.dataset.html !== html) { host.dataset.html = html; host.innerHTML = html; }
  const n = bucket('acao').length;
  for (const b of document.querySelectorAll('[data-badge]')) { b.textContent = n; b.hidden = !n; }
}

export function initSheet() {
  $('tabs').innerHTML = `${TABS.map((t, i) => `<button role="tab" data-tab="${t.id}" aria-selected="${i === 0}" aria-controls="sheetBody">${icon(t.ic)}<span>${t.label}</span>${t.id === 'emails' ? '<span class="badge" data-badge hidden>0</span>' : ''}</button>`).join('')}<span class="tabs-indicator" id="tabsIndicator" aria-hidden="true"></span>`;
  $('tabs').style.setProperty('--n', TABS.length);
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) focusTab(b.dataset.tab); });
  $('tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === active), n = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    focusTab(TABS[n].id, { animate: false }); // teclado: sem animação
    document.querySelector(`[data-tab="${TABS[n].id}"]`).focus();
  });
  $('sheetRefresh').addEventListener('click', () => TABS.find((t) => t.id === active).refresh?.());
  $('glances').addEventListener('click', (e) => { const g = e.target.closest('[data-glance]'); if (g) focusTab(g.dataset.glance); });
  $('sheetBody').addEventListener('click', async (e) => {
    const done = e.target.closest('[data-done]');
    if (done) {
      e.stopPropagation();
      markDone(done.dataset.done);
      await removeAnimated(done.closest('.mail'));
      $('sheetBody').dataset.html = '';
      return;
    }
    if (e.target.closest('[data-toggle-noise]')) {
      mail.noiseOpen = !mail.noiseOpen;
      e.target.closest('.bucket').classList.toggle('closed', !mail.noiseOpen);
      e.target.closest('[data-toggle-noise]').setAttribute('aria-expanded', String(mail.noiseOpen));
      return;
    }
    const m = e.target.closest('.mail');
    if (m) m.classList.toggle('open');
    const d = e.target.closest('[data-digest]');
    if (d) emit('digest-action', d.dataset.digest);
  });
  $('sheetBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('mail')) e.target.classList.toggle('open'); });
  on('data', (id) => { if (id === active) render(false); else paintHeader(); paintGlances(); });
  on('focus', (id) => focusTab(id));
  on('badge', paintGlances);
  focusTab('agenda', { animate: false });
  render(false);
  paintGlances();
}
