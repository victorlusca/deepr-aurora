import { describe, expect, it } from 'vitest';
import { expandRRule, parseDate, parseDuration, parseICS, parseLine, parseRRule, unescapeText, validTz } from '../../src/core/ics.js';
import { dateLong, dayKey, duration, greeting, hhmm, relative, spokenTime, startOfDay, zonedToUtc, zParts } from '../../src/core/time.js';

const TZ = 'America/Manaus';
const at = (iso) => Date.parse(iso);

describe('time', () => {
  it('converte horário de parede em UTC (UTC−4)', () => {
    expect(zonedToUtc(2026, 10, 8, 9, 0, 0, TZ)).toBe(at('2026-10-08T13:00:00Z'));
    expect(zonedToUtc(2026, 10, 8, 9, 0, 0, 'UTC')).toBe(at('2026-10-08T09:00:00Z'));
  });
  it('lê partes e dia da semana no fuso', () => {
    const p = zParts(at('2026-10-08T13:05:09Z'), TZ);
    expect(p).toMatchObject({ y: 2026, mo: 10, d: 8, h: 9, mi: 5, s: 9, wd: 4 });
  });
  it('formata chaves, horas e início do dia', () => {
    const ms = at('2026-10-08T03:30:00Z'); // 23:30 do dia 7 em Manaus
    expect(dayKey(ms, TZ)).toBe('2026-10-07');
    expect(hhmm(ms, TZ)).toBe('23:30');
    expect(startOfDay(ms, TZ)).toBe(at('2026-10-07T04:00:00Z'));
  });
  it('fala horários e durações como gente', () => {
    expect(spokenTime(at('2026-10-08T13:00:00Z'), TZ)).toBe('9 horas');
    expect(spokenTime(at('2026-10-08T05:00:00Z'), TZ)).toBe('1 hora');
    expect(spokenTime(at('2026-10-08T18:30:00Z'), TZ)).toBe('14 e 30');
    expect(duration(83 * 60000)).toBe('1h 23min');
    expect(duration(83 * 60000, true)).toBe('1 hora e 23 minutos');
    expect(duration(60000, true)).toBe('1 minuto');
    expect(duration(120 * 60000, true)).toBe('2 horas');
    expect(duration(5 * 60000)).toBe('5min');
  });
  it('tempo relativo, data longa e saudação', () => {
    const now = at('2026-10-08T15:00:00Z');
    expect(relative(now - 20000, now)).toBe('agora');
    expect(relative(now - 40 * 60000, now)).toBe('há 40 min');
    expect(relative(now - 3 * 3600000, now)).toBe('há 3 h');
    expect(relative(now - 26 * 3600000, now)).toBe('ontem');
    expect(relative(now - 72 * 3600000, now)).toBe('há 3 dias');
    expect(dateLong(now, TZ)).toBe('quinta-feira, 8 de outubro');
    expect(greeting(at('2026-10-08T12:00:00Z'), TZ)).toBe('Bom dia');
    expect(greeting(at('2026-10-08T18:00:00Z'), TZ)).toBe('Boa tarde');
    expect(greeting(at('2026-10-09T01:00:00Z'), TZ)).toBe('Boa noite');
  });
});

const CAL = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'UID:1', 'DTSTART;TZID=America/Sao_Paulo:20261007T100000', 'DTEND;TZID=America/Sao_Paulo:20261007T110000',
  'SUMMARY:Reuni', ' ão com cliente\\, Acme', 'LOCATION:Online', 'BEGIN:VALARM', 'SUMMARY:alarme', 'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:2', 'DTSTART:20261008T150000Z', 'DTEND:20261008T160000Z', 'SUMMARY:UTC call', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:3', 'DTSTART;VALUE=DATE:20261009', 'DTEND;VALUE=DATE:20261010', 'SUMMARY:Feriado', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:4', 'DTSTART;TZID=America/Manaus:20250106T190000', 'DURATION:PT2H', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'EXDATE;TZID=America/Manaus:20261009T190000', 'SUMMARY:Faculdade', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:5', 'DTSTART:20261001T120000Z', 'RRULE:FREQ=DAILY;COUNT=10', 'SUMMARY:Daily', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:4', 'RECURRENCE-ID;TZID=America/Manaus:20261012T190000', 'DTSTART;TZID=America/Manaus:20261012T200000',
  'DTEND;TZID=America/Manaus:20261012T210000', 'SUMMARY:Faculdade (movida)', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:6', 'DTSTART;VALUE=DATE:20200315', 'RRULE:FREQ=YEARLY', 'SUMMARY:Aniversário', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:7', 'DTSTART;TZID=America/Manaus:20260101T080000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:Segunda terça', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:8', 'DTSTART:20261008T120000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelado', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:9', 'DTSTART;VALUE=DATE:20261013', 'SUMMARY:Sem fim', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

describe('ics', () => {
  const ws = at('2026-10-07T04:00:00Z'), we = ws + 8 * 86400000;
  const evs = parseICS(CAL, ws, we, TZ);
  const fmt = (e) => `${dayKey(e.start, TZ)} ${e.allDay ? 'DIA' : hhmm(e.start, TZ)} ${e.title}`;

  it('desdobra linhas, decodifica escapes e converte fusos (TZID, UTC, dia inteiro)', () => {
    const list = evs.map(fmt);
    expect(list).toContain('2026-10-07 09:00 Reunião com cliente, Acme');
    expect(list).toContain('2026-10-08 11:00 UTC call');
    expect(list).toContain('2026-10-09 DIA Feriado');
    expect(evs.find((e) => e.title === 'Reunião com cliente, Acme').location).toBe('Online');
  });
  it('expande RRULE semanal respeitando EXDATE e instâncias movidas', () => {
    const fac = evs.filter((e) => e.title.startsWith('Faculdade')).map(fmt);
    expect(fac).toEqual(['2026-10-07 19:00 Faculdade', '2026-10-12 20:00 Faculdade (movida)', '2026-10-14 19:00 Faculdade']);
    expect(evs.find((e) => e.title === 'Faculdade').end - evs.find((e) => e.title === 'Faculdade').start).toBe(2 * 3600000);
  });
  it('respeita COUNT, BYDAY ordinal e ignora cancelados', () => {
    expect(evs.filter((e) => e.title === 'Daily').map(fmt)).toEqual(['2026-10-07 08:00 Daily', '2026-10-08 08:00 Daily', '2026-10-09 08:00 Daily', '2026-10-10 08:00 Daily']);
    expect(evs.filter((e) => e.title === 'Segunda terça').map(fmt)).toEqual(['2026-10-13 08:00 Segunda terça']);
    expect(evs.some((e) => e.title === 'Cancelado')).toBe(false);
    expect(evs.some((e) => e.title === 'Aniversário')).toBe(false);
  });
  it('dia inteiro sem DTEND dura um dia; eventos saem ordenados', () => {
    const sf = evs.find((e) => e.title === 'Sem fim');
    expect(sf.end - sf.start).toBe(86400000);
    expect(evs.map((e) => e.start)).toEqual([...evs.map((e) => e.start)].sort((a, b) => a - b));
  });
  it('rejeita texto que não é agenda', () => {
    expect(() => parseICS('<html>login</html>', ws, we, TZ)).toThrow(/iCal/);
  });
  it('yearly dentro da janela e UNTIL', () => {
    const base = parseDate('20200315', { VALUE: 'DATE' }, TZ);
    const occ = expandRRule(base, 86400000, 'FREQ=YEARLY', at('2027-03-14T00:00:00Z'), at('2027-03-17T00:00:00Z'), new Set(), TZ);
    expect(occ.map((m) => dayKey(m, TZ))).toEqual(['2027-03-15']);
    const b2 = parseDate('20261001T090000', { TZID: TZ }, TZ);
    const until = expandRRule(b2, 0, 'FREQ=DAILY;UNTIL=20261003T235959Z', at('2026-09-30T00:00:00Z'), at('2026-10-10T00:00:00Z'), new Set(), TZ);
    expect(until).toHaveLength(3);
    expect(expandRRule(b2, 0, 'FREQ=SECONDLY', 0, Date.now(), new Set(), TZ)).toEqual([]);
    const monthly = expandRRule(b2, 0, 'FREQ=MONTHLY;BYMONTHDAY=-1;INTERVAL=1', at('2026-10-01T00:00:00Z'), at('2026-12-01T00:00:00Z'), new Set(), TZ);
    expect(monthly.map((m) => dayKey(m, TZ))).toEqual(['2026-10-31', '2026-11-30']);
  });
  it('helpers de linha, duração e regra', () => {
    expect(parseLine('DTSTART;TZID="America/Sao_Paulo":20261007T100000')).toEqual({ name: 'DTSTART', params: { TZID: 'America/Sao_Paulo' }, value: '20261007T100000' });
    expect(parseLine('sem dois pontos')).toBeNull();
    expect(parseDuration('PT1H30M')).toBe(5400000);
    expect(parseDuration('P1W')).toBe(604800000);
    expect(parseDuration('-PT5M')).toBe(-300000);
    expect(parseDuration('lixo')).toBe(0);
    expect(parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=1MO,-1FR;WKST=SU;BYMONTH=1,2', TZ)).toMatchObject({ FREQ: 'WEEKLY', INTERVAL: 2, WKST: 'SU', BYMONTH: [1, 2], BYDAY: [{ n: 1, wd: 1 }, { n: -1, wd: 5 }] });
    expect(unescapeText('a\\nb\\;c\\\\')).toBe('a b;c\\');
    expect(parseDate('invalido', {}, TZ)).toBeNull();
  });
  it('fusos do Windows e caminhos com prefixo', () => {
    expect(validTz('E. South America Standard Time')).toBe('America/Sao_Paulo');
    expect(validTz('/mozilla.org/20050126_1/America/Cuiaba')).toBe('America/Cuiaba');
    expect(validTz('Nada/Disso')).toBeNull();
    expect(validTz('')).toBeNull();
  });
});
