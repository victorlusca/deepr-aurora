// Datas e fusos sem bibliotecas: tudo via Intl.DateTimeFormat.

export const WD_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WD_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const DAY = 86400000;

const fmtCache = new Map();
function tzFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Partes de calendário de um instante (ms) no fuso `tz`. wd: 0 = domingo. */
export function zParts(ms, tz) {
  const o = {};
  for (const p of tzFmt(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  const y = o.year, mo = o.month, d = o.day;
  return { y, mo, d, h: o.hour % 24, mi: o.minute, s: o.second, wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

function tzOffset(ms, tz) {
  const p = zParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Horário de parede (y-mo-d h:mi:s) no fuso `tz` → instante UTC em ms. */
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (tz === 'UTC') return guess;
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}

const pad = (n) => String(n).padStart(2, '0');
export const pad2 = pad;

export const dayKey = (ms, tz) => {
  const p = zParts(ms, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
};
export const hhmm = (ms, tz) => {
  const p = zParts(ms, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
};
export function startOfDay(ms, tz) {
  const p = zParts(ms, tz);
  return zonedToUtc(p.y, p.mo, p.d, 0, 0, 0, tz);
}
/** "9 horas", "1 hora", "14 e 30" — como uma pessoa fala. */
export function spokenTime(ms, tz) {
  const p = zParts(ms, tz);
  if (p.mi === 0) return p.h === 1 ? '1 hora' : `${p.h} horas`;
  return `${p.h} e ${p.mi}`;
}
/** Duração: "1h 05min" (tela) ou "1 hora e 5 minutos" (fala). */
export function duration(ms, spoken = false) {
  const m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60), r = m % 60;
  if (spoken) {
    if (!h) return `${r} ${r === 1 ? 'minuto' : 'minutos'}`;
    return `${h} ${h === 1 ? 'hora' : 'horas'}${r ? ` e ${r} ${r === 1 ? 'minuto' : 'minutos'}` : ''}`;
  }
  return h ? `${h}h ${pad(r)}min` : `${r}min`;
}
export function relative(ms, now = Date.now()) {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
export function dateLong(ms, tz) {
  const p = zParts(ms, tz);
  return `${WD_LONG[p.wd]}, ${p.d} de ${MONTHS[p.mo - 1]}`;
}
export function greeting(ms, tz) {
  const h = zParts(ms, tz).h;
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
