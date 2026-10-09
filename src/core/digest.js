// Morning Digest: o pacote compacto enviado à IA e o modelo offline (sem custo).
import { CONFIG, PROFILE } from './config.js';
import { greeting, hhmm, MONTHS, pad2, spokenTime, WD_LONG, zParts } from './time.js';

/**
 * k = { now, tz, weatherOn, weather: {label, compact, spoken}|null, hasCal, events: [{title,start,allDay}],
 *       hasMail, recent, unread, actions: [{remetente,resumo}], heads: [{t, h: [títulos]}], goals: [texto], size }
 */
export function packText(k) {
  const p = zParts(k.now, k.tz);
  const evs = k.events.slice(0, 15).map((e) => `${e.allDay ? 'dia todo' : hhmm(e.start, k.tz)} · ${e.title}`);
  return [
    `DATA: ${WD_LONG[p.wd]}, ${p.d} de ${MONTHS[p.mo - 1]} de ${p.y} · ${pad2(p.h)}:${pad2(p.mi)} · saudação: ${greeting(k.now, k.tz)}`,
    k.weatherOn ? `CLIMA: ${k.weather ? `${k.weather.label} — ${k.weather.compact}` : 'indisponível'}` : '',
    `AGENDA HOJE: ${!k.hasCal ? 'nenhuma agenda conectada (não mencione)' : evs.length ? evs.join(' | ') : 'nenhum evento'}`,
    `E-MAILS: ${!k.hasMail ? 'nenhuma conta conectada (não mencione)' : `${k.recent} nas últimas 24h, ${k.unread} não lidos · AÇÃO (${k.actions.length}): ${k.actions.slice(0, 6).map((m) => `${m.remetente}: ${m.resumo}`).join(' | ') || 'nenhum'}`}`,
    `MANCHETES: ${k.heads.map((x) => `${x.t}: ${x.h.join(' / ')}`).join(' || ') || 'indisponíveis'}`,
    `METAS: ${k.goals.join(' || ')}`
  ].filter(Boolean).join('\n');
}

/** Briefing por modelo local — usado sem chave, sem internet na IA ou se a IA falhar. */
export function templateDigest(k) {
  const A = CONFIG.address, p = zParts(k.now, k.tz), s = [];
  s.push(`${greeting(k.now, k.tz)}, ${A}. Hoje é ${WD_LONG[p.wd]}, ${p.d} de ${MONTHS[p.mo - 1]}.`);
  if (k.weatherOn && k.weather) s.push(k.weather.spoken);
  if (k.hasCal) {
    s.push(k.events.length
      ? `Na agenda: ${k.events.slice(0, 6).map((e) => (e.allDay ? `${e.title}, o dia todo` : `às ${spokenTime(e.start, k.tz)}, ${e.title}`)).join('; ')}.`
      : 'Sua agenda de hoje está livre.');
  }
  if (k.hasMail) {
    s.push(k.actions.length
      ? `${k.actions.length === 1 ? 'Um e-mail pede' : `${k.actions.length} e-mails pedem`} ação: ${k.actions.slice(0, 3).map((m) => `${m.remetente}, ${m.resumo}`).join('; ')}.`
      : 'Nenhum e-mail pedindo ação.');
  }
  const hs = k.heads.slice(0, k.size === 'medio' ? 5 : 3).map((x) => `${x.t}: ${x.h[0]}`);
  if (hs.length) s.push(`Manchetes. ${hs.join('. ')}.`);
  s.push(`${PROFILE.focus}, ${A}.`);
  return s.join(' ');
}
