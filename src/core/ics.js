// Leitor de agendas iCal (RFC 5545) — o suficiente para o Google Agenda, sem bibliotecas.
import { DAY as DAY_MS, zonedToUtc } from './time.js';

const WIN_TZ = {
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/Manaus',
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Eastern Standard Time': 'America/New_York',
  'Pacific Standard Time': 'America/Los_Angeles'
};
const tzOk = new Map();
export function validTz(raw) {
  if (!raw) return null;
  let tz = String(raw).replace(/^"|"$/g, '');
  if (WIN_TZ[tz]) return WIN_TZ[tz];
  const m = tz.match(/([A-Za-z_]+\/[A-Za-z_+\-0-9]+(?:\/[A-Za-z_]+)?)$/);
  if (m) tz = m[1];
  if (!tzOk.has(tz)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      tzOk.set(tz, tz);
    } catch {
      tzOk.set(tz, null);
    }
  }
  return tzOk.get(tz);
}

export function parseLine(line) {
  let inQ = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) { colon = i; break; }
  }
  if (colon < 0) return null;
  const parts = line.slice(0, colon).split(';');
  const params = {};
  for (let k = 1; k < parts.length; k++) {
    const eq = parts[k].indexOf('=');
    if (eq > 0) params[parts[k].slice(0, eq).toUpperCase()] = parts[k].slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

export const unescapeText = (v) => v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();

export function parseDate(value, params, userTz) {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (params.VALUE === 'DATE' || m[4] === undefined) {
    return { allDay: true, y, mo, d, h: 0, mi: 0, s: 0, tz: userTz, ms: zonedToUtc(y, mo, d, 0, 0, 0, userTz) };
  }
  const h = +m[4], mi = +m[5], s = +(m[6] || 0);
  if (m[7]) return { allDay: false, y, mo, d, h, mi, s, tz: 'UTC', ms: Date.UTC(y, mo - 1, d, h, mi, s) };
  const tz = validTz(params.TZID) || userTz;
  return { allDay: false, y, mo, d, h, mi, s, tz, ms: zonedToUtc(y, mo, d, h, mi, s, tz) };
}

export function parseDuration(v) {
  const m = String(v).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = ((+m[2] || 0) * 604800 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

const WDC = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
export function parseRRule(str, userTz) {
  const r = { FREQ: null, INTERVAL: 1, COUNT: 0, UNTIL: null, BYDAY: [], BYMONTHDAY: [], BYMONTH: [], WKST: 'MO' };
  for (const kv of String(str).split(';')) {
    const [k, v] = kv.split('=');
    if (!v) continue;
    switch (k.toUpperCase()) {
      case 'FREQ': r.FREQ = v.toUpperCase(); break;
      case 'INTERVAL': r.INTERVAL = Math.max(1, +v || 1); break;
      case 'COUNT': r.COUNT = +v || 0; break;
      case 'UNTIL': {
        const d = parseDate(v, {}, userTz);
        if (d) r.UNTIL = d.allDay ? d.ms + DAY_MS - 1 : d.ms;
        break;
      }
      case 'BYDAY':
        r.BYDAY = v.split(',').map((x) => {
          const mm = x.trim().match(/^([+-]?\d+)?([A-Z]{2})$/i);
          return mm ? { n: mm[1] ? +mm[1] : 0, wd: WDC[mm[2].toUpperCase()] } : null;
        }).filter((x) => x && x.wd !== undefined);
        break;
      case 'BYMONTHDAY': r.BYMONTHDAY = v.split(',').map(Number).filter(Boolean); break;
      case 'BYMONTH': r.BYMONTH = v.split(',').map(Number).filter(Boolean); break;
      case 'WKST': r.WKST = v.toUpperCase(); break;
      default:
    }
  }
  return r;
}

const civil = (y, mo, d) => {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};
const wdOf = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
export const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

function monthDays(y, mo, r, defDay) {
  const n = daysInMonth(y, mo);
  let set = [];
  if (r.BYMONTHDAY.length) set = r.BYMONTHDAY.map((x) => (x > 0 ? x : n + x + 1)).filter((x) => x >= 1 && x <= n);
  else if (r.BYDAY.length) {
    for (const b of r.BYDAY) {
      const days = [];
      for (let d = 1; d <= n; d++) if (wdOf(y, mo, d) === b.wd) days.push(d);
      if (!b.n) set.push(...days);
      else {
        const pick = b.n > 0 ? days[b.n - 1] : days[days.length + b.n];
        if (pick) set.push(pick);
      }
    }
  } else if (defDay <= n) set = [defDay];
  return [...new Set(set)].sort((a, b) => a - b);
}

/** Expande uma RRULE dentro de [winStart, winEnd). `skip` = instantes removidos (EXDATE / instâncias movidas). */
export function expandRRule(base, dur, rule, winStart, winEnd, skip, userTz) {
  const r = parseRRule(rule, userTz);
  const out = [];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ)) return out;
  let count = 0, stop = false, guard = 0;
  const emit = (y, mo, d) => {
    const approx = Date.UTC(y, mo - 1, d, base.h, base.mi, base.s);
    if (approx - 2 * DAY_MS > winEnd) return false;
    if (r.UNTIL != null && approx - 2 * DAY_MS > r.UNTIL) return false;
    if (!r.COUNT && approx + dur + 2 * DAY_MS < winStart) return true;
    const ms = base.allDay ? zonedToUtc(y, mo, d, 0, 0, 0, userTz) : zonedToUtc(y, mo, d, base.h, base.mi, base.s, base.tz);
    if (ms < base.ms) return true;
    if (r.UNTIL != null && ms > r.UNTIL) return false;
    count++;
    if (r.COUNT && count > r.COUNT) return false;
    if (ms >= winEnd) return false;
    if (ms + Math.max(dur, 1) > winStart && !skip.has(ms)) out.push(ms);
    return true;
  };
  const I = r.INTERVAL;
  if (r.FREQ === 'DAILY') {
    let [y, mo, d] = [base.y, base.mo, base.d];
    while (!stop && guard++ < 40000) {
      const ok = (!r.BYDAY.length || r.BYDAY.some((b) => b.wd === wdOf(y, mo, d)))
        && (!r.BYMONTH.length || r.BYMONTH.includes(mo))
        && (!r.BYMONTHDAY.length || r.BYMONTHDAY.includes(d));
      if (ok && !emit(y, mo, d)) stop = true;
      [y, mo, d] = civil(y, mo, d + I);
    }
  } else if (r.FREQ === 'WEEKLY') {
    const wk = WDC[r.WKST] ?? 1;
    const days = r.BYDAY.length ? r.BYDAY.map((b) => b.wd) : [wdOf(base.y, base.mo, base.d)];
    const offs = [...new Set(days.map((w) => (w - wk + 7) % 7))].sort((a, b) => a - b);
    let [y, mo, d] = civil(base.y, base.mo, base.d - ((wdOf(base.y, base.mo, base.d) - wk + 7) % 7));
    while (!stop && guard++ < 10000) {
      for (const o of offs) {
        const [yy, mm, dd] = civil(y, mo, d + o);
        if ((!r.BYMONTH.length || r.BYMONTH.includes(mm)) && !emit(yy, mm, dd)) { stop = true; break; }
      }
      [y, mo, d] = civil(y, mo, d + 7 * I);
    }
  } else if (r.FREQ === 'MONTHLY') {
    let y = base.y, mo = base.mo;
    while (!stop && guard++ < 3000) {
      if (!r.BYMONTH.length || r.BYMONTH.includes(mo)) {
        for (const d of monthDays(y, mo, r, base.d)) if (!emit(y, mo, d)) { stop = true; break; }
      }
      mo += I;
      while (mo > 12) { mo -= 12; y++; }
    }
  } else {
    let y = base.y;
    while (!stop && guard++ < 300) {
      const months = (r.BYMONTH.length ? r.BYMONTH : [base.mo]).slice().sort((a, b) => a - b);
      for (const mo of months) {
        const days = r.BYMONTHDAY.length || r.BYDAY.length ? monthDays(y, mo, r, base.d) : base.d <= daysInMonth(y, mo) ? [base.d] : [];
        for (const d of days) if (!emit(y, mo, d)) { stop = true; break; }
        if (stop) break;
      }
      y += I;
    }
  }
  return out;
}

/**
 * Lê um .ics e devolve os eventos que tocam a janela [winStart, winEnd), ordenados.
 * Lança erro se o texto não for uma agenda; eventos exóticos são ignorados sem derrubar o resto.
 */
export function parseICS(text, winStart, winEnd, userTz) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('o link não devolveu uma agenda iCal');
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const evs = [];
  let cur = null, depth = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (/^BEGIN:VEVENT$/i.test(line)) { cur = { ex: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) { depth++; continue; }
    if (/^END:VEVENT$/i.test(line)) { evs.push(cur); cur = null; continue; }
    if (/^END:/i.test(line)) { depth--; continue; }
    if (depth > 0) continue; // VALARM e afins
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'EXDATE') cur.ex.push(p);
    else if (!(p.name in cur)) cur[p.name] = p;
  }
  const overrides = new Map();
  for (const e of evs) {
    if (!e['RECURRENCE-ID'] || !e.UID) continue;
    const d = parseDate(e['RECURRENCE-ID'].value, e['RECURRENCE-ID'].params, userTz);
    if (!d) continue;
    if (!overrides.has(e.UID.value)) overrides.set(e.UID.value, new Set());
    overrides.get(e.UID.value).add(d.ms);
  }
  const out = [];
  for (const e of evs) {
    try {
      if (!e.DTSTART) continue;
      if (e.STATUS && /CANCELLED/i.test(e.STATUS.value)) continue;
      const st = parseDate(e.DTSTART.value, e.DTSTART.params, userTz);
      if (!st) continue;
      let dur;
      if (e.DTEND) {
        const en = parseDate(e.DTEND.value, e.DTEND.params, userTz);
        dur = en ? en.ms - st.ms : 0;
      } else if (e.DURATION) dur = parseDuration(e.DURATION.value);
      else dur = st.allDay ? DAY_MS : 0;
      dur = Math.max(0, dur);
      const title = e.SUMMARY ? unescapeText(e.SUMMARY.value) : '(sem título)';
      const location = e.LOCATION ? unescapeText(e.LOCATION.value) : '';
      const mk = (ms) => ({ title, location, start: ms, end: ms + dur, allDay: st.allDay });
      if (e.RRULE && !e['RECURRENCE-ID']) {
        const skip = new Set(overrides.get(e.UID?.value) || []);
        for (const x of e.ex) {
          for (const v of x.value.split(',')) {
            const d = parseDate(v, x.params, userTz);
            if (d) skip.add(d.allDay ? zonedToUtc(d.y, d.mo, d.d, 0, 0, 0, userTz) : d.ms);
          }
        }
        for (const ms of expandRRule(st, dur, e.RRULE.value, winStart, winEnd, skip, userTz)) out.push(mk(ms));
      } else if (st.ms < winEnd && st.ms + Math.max(dur, 1) > winStart) out.push(mk(st.ms));
    } catch {
      // evento exótico: ignorado sem derrubar a agenda
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
