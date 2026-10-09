// Central de Agenda: várias agendas do Google (iCal) mescladas numa linha do tempo.
import { CONFIG } from '../core/config.js';
import { parseICS } from '../core/ics.js';
import { cap, esc } from '../core/text.js';
import { DAY, dateLong, dayKey, duration, hhmm, spokenTime, startOfDay, WD_LONG, WD_SHORT, zParts } from '../core/time.js';
import { checkAntenna, proxy } from './antenna.js';
import { emit } from './bus.js';
import { icon } from './icons.js';
import { skeleton } from './motion.js';
import { tel } from './obs.js';
import { calendars, net, TZ } from './state.js';
import { store } from './store.js';
import { track } from './ui.js';
import { emptyState, errorRow, offline, sectionTitle } from './views.js';

const cache = store.get('jarvis_agenda_cache', { events: [] });
export const agenda = { events: cache.events || [], errors: {}, last: cache.t || 0, loading: false, loaded: !!cache.t };

const linked = () => calendars().filter((c) => c.url);
const A = CONFIG.address;

export async function refreshAgenda(force = false) {
  const cals = linked();
  if (!cals.length) { agenda.events = []; emit('data', 'agenda'); return; }
  if (agenda.loading || (!force && Date.now() - agenda.last < 60000)) return;
  agenda.loading = true;
  emit('data', 'agenda');
  await track(tel.span('agenda.refresh', { 'agenda.quantidade': cals.length }, async () => {
    try {
      if (!(await checkAntenna(true))) return;
      const ws = startOfDay(Date.now(), TZ), we = ws + 8 * DAY, all = [];
      agenda.errors = {};
      await Promise.all(cals.map(async (c) => {
        try {
          const evs = parseICS(await proxy(c.url.trim(), `agenda:${c.nome}`), ws, we, TZ);
          for (const e of evs) all.push({ ...e, cal: c.nome || 'Agenda', color: c.cor || '#3cf0c8' });
        } catch (e) {
          agenda.errors[c.nome || 'Agenda'] = e.message;
        }
      }));
      agenda.events = all.sort((a, b) => a.start - b.start);
      agenda.last = Date.now();
      agenda.loaded = true;
      store.set('jarvis_agenda_cache', { t: agenda.last, events: agenda.events });
    } finally {
      agenda.loading = false;
      emit('data', 'agenda');
    }
  }).catch(() => {}));
}

export function byDay() {
  const ws = startOfDay(Date.now(), TZ), map = {};
  for (const e of agenda.events) {
    if (e.allDay) {
      for (let t = Math.max(e.start, ws); t < e.end; t += DAY) (map[dayKey(t + 3600000, TZ)] ||= []).push(e);
    } else (map[dayKey(e.start, TZ)] ||= []).push(e);
  }
  return map;
}
export const todayEvents = () => byDay()[dayKey(Date.now(), TZ)] || [];
export const nextEvent = () => agenda.events.find((e) => !e.allDay && e.start > Date.now()) || null;
const currentEvent = () => agenda.events.find((e) => !e.allDay && e.start <= Date.now() && e.end > Date.now()) || null;

export function agendaHTML() {
  if (!linked().length) {
    return emptyState('calendar', 'Nenhuma agenda conectada', 'Clique em <b>configurações</b> → <b>Agenda</b> e cole o endereço secreto em formato iCal de cada agenda do Google.');
  }
  if (agenda.loading && !agenda.loaded) return skeleton(5);
  let h = net.antenna === false ? offline() : '';
  for (const [n, m] of Object.entries(agenda.errors)) h += errorRow(`${n}: não consegui ler esta agenda (${m}). Confira o link nas configurações.`);
  const map = byDay(), ws = startOfDay(Date.now(), TZ), nx = nextEvent(), now = Date.now();
  for (let i = 0; i < 8; i++) {
    const ms = ws + i * DAY + 3600000, list = map[dayKey(ms, TZ)] || [];
    if (i > 0 && !list.length) continue;
    const p = zParts(ms, TZ);
    const lbl = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : `${WD_SHORT[p.wd]} · ${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')}`;
    h += sectionTitle(lbl, i === 0 ? `<span class="muted">${list.length} ${list.length === 1 ? 'evento' : 'eventos'}</span>` : '');
    if (!list.length) h += '<p class="muted pad" data-enter>Nada marcado para hoje.</p>';
    for (const e of list) {
      const isNext = nx && e === nx, past = !e.allDay && e.end < now, live = !e.allDay && e.start <= now && e.end > now;
      h += `<article class="ev${isNext ? ' is-next' : ''}${past ? ' is-past' : ''}" style="--c:${esc(e.color)}" data-enter>
        <span class="ev-time">${e.allDay ? 'dia todo' : hhmm(e.start, TZ)}</span>
        <span class="ev-body"><b>${esc(e.title)}</b>${e.location ? `<small>${icon('pin')}${esc(e.location)}</small>` : ''}<small class="ev-cal"><i class="dot" style="background:${esc(e.color)}"></i>${esc(e.cal)}</small></span>
        ${isNext ? `<span class="chip accent" data-countdown="${e.start}">em ${duration(e.start - now)}</span>` : ''}${live ? '<span class="chip live">agora</span>' : ''}
      </article>`;
    }
  }
  return h;
}

export function tickCountdowns() {
  for (const el of document.querySelectorAll('[data-countdown]')) {
    const d = Number(el.dataset.countdown) - Date.now();
    if (d <= 0) emit('data', 'agenda');
    else el.textContent = `em ${duration(d)}`;
  }
}

export function agendaGlance() {
  if (!linked().length) return { text: 'Conectar agenda', sub: 'nenhuma agenda', ic: 'calendar' };
  const n = nextEvent();
  if (!n) return { text: 'Agenda livre', sub: 'próximos 7 dias', ic: 'calendar' };
  const same = dayKey(n.start, TZ) === dayKey(Date.now(), TZ);
  return { text: `${same ? '' : `${WD_SHORT[zParts(n.start, TZ).wd]} `}${hhmm(n.start, TZ)} · ${n.title}`, sub: `em ${duration(n.start - Date.now())}`, ic: 'calendar' };
}

export const agendaCompact = () => {
  if (!linked().length) return null;
  const t = todayEvents().filter((e) => e.allDay || e.end > Date.now() - 3600000);
  return t.length ? t.slice(0, 15).map((e) => `${e.allDay ? 'dia todo' : hhmm(e.start, TZ)} ${e.title}`).join(' · ') : 'nenhum compromisso';
};

const noCal = () => `Ainda não há agendas conectadas, ${A}. Basta colar o endereço secreto iCal nas configurações.`;
export const offlineSpeech = () => `Minha antena está desligada, ${A}. Rode node server.js na pasta do projeto e deixe o terminal aberto.`;

export async function voiceToday() {
  emit('focus', 'agenda');
  if (!linked().length) return noCal();
  if (net.antenna === false && !agenda.loaded) return offlineSpeech();
  const t = todayEvents();
  if (!t.length) return `Sua agenda de hoje está livre, ${A}.`;
  return `Para hoje, ${A}, ${t.length === 1 ? 'há um compromisso' : `há ${t.length} compromissos`}: ${t.map((e) => (e.allDay ? `o dia todo, ${e.title}` : `às ${spokenTime(e.start, TZ)}, ${e.title}`)).join('; ')}.`;
}
export async function voiceNext() {
  emit('focus', 'agenda');
  if (!linked().length) return noCal();
  const cur = currentEvent(), n = nextEvent();
  const s = cur ? `Neste momento: ${cur.title}, até ${spokenTime(cur.end, TZ)}. ` : '';
  if (!n) return `${s}Não há mais compromissos nos próximos dias, ${A}.`;
  const same = dayKey(n.start, TZ) === dayKey(Date.now(), TZ);
  return `${s}Seu próximo compromisso é ${n.title}, ${same ? '' : `${dateLong(n.start, TZ)}, `}às ${spokenTime(n.start, TZ)}, daqui a ${duration(n.start - Date.now(), true)}.`;
}
export async function voiceWeek() {
  emit('focus', 'agenda');
  if (!linked().length) return noCal();
  const map = byDay(), ws = startOfDay(Date.now(), TZ), parts = [];
  for (let i = 1; i < 8; i++) {
    const ms = ws + i * DAY + 3600000, l = map[dayKey(ms, TZ)] || [];
    if (!l.length) continue;
    const name = i === 1 ? 'Amanhã' : cap(WD_LONG[zParts(ms, TZ).wd]);
    const f = l[0];
    parts.push(`${name}: ${l.length === 1 ? 'um compromisso' : `${l.length} compromissos`}, começando com ${f.title}${f.allDay ? '' : ` às ${spokenTime(f.start, TZ)}`}`);
  }
  return parts.length ? `Sua semana, ${A}. ${parts.join('. ')}.` : `Os próximos sete dias estão livres, ${A}.`;
}
