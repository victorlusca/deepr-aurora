import { describe, expect, it } from 'vitest';
import { expandRRule, parseDate, parseDuration, parseICS, parseLine, parseRRule, unescapeText, validTz } from '../../src/core/ics.js';

// Tudo em UTC para as datas esperadas ficarem legíveis.
const U = 'UTC';
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const ex = (dt, rule, from, to, { dur = 0, skip = [] } = {}) =>
  expandRRule(parseDate(dt, {}, U), dur, rule, Date.parse(from), Date.parse(to), new Set(skip.map(Date.parse)), U).map(iso);
const days = (...ds) => ds.map((d) => `${d}T09:00`);

describe('RRULE · diária', () => {
  it('intervalo, BYDAY, BYMONTH e BYMONTHDAY', () => {
    expect(ex('20261001T090000', 'FREQ=DAILY;INTERVAL=2', '2026-10-01', '2026-10-08')).toEqual(days('2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07'));
    expect(ex('20261001T090000', 'FREQ=DAILY;BYDAY=MO,WE', '2026-10-01', '2026-10-10')).toEqual(days('2026-10-05', '2026-10-07'));
    expect(ex('20261001T090000', 'FREQ=DAILY;BYMONTH=11;BYMONTHDAY=1,15', '2026-10-01', '2027-01-01')).toEqual(days('2026-11-01', '2026-11-15'));
  });
  it('janela começando bem depois do início, e evento que atravessa a borda', () => {
    expect(ex('20260101T090000', 'FREQ=DAILY', '2026-10-08', '2026-10-10')).toEqual(days('2026-10-08', '2026-10-09'));
    expect(ex('20261001T230000', 'FREQ=DAILY', '2026-10-08', '2026-10-09', { dur: 2 * H })).toEqual(['2026-10-07T23:00', '2026-10-08T23:00']);
    expect(ex('20261001T000000', 'FREQ=DAILY', '2026-10-08', '2026-10-09')).toEqual(['2026-10-08T00:00']);
    expect(ex('20261001T090000', 'FREQ=DAILY', '2026-10-02', '2026-10-03T09:00Z')).toEqual(days('2026-10-02'));
  });
  it('COUNT conta desde o início, mesmo fora da janela', () => {
    expect(ex('20261001T090000', 'FREQ=DAILY;COUNT=3', '2026-10-02', '2026-10-30')).toEqual(days('2026-10-02', '2026-10-03'));
  });
  it('UNTIL de data inteira vale até o fim do dia; UNTIL com hora é inclusivo', () => {
    expect(ex('20261001T090000', 'FREQ=DAILY;UNTIL=20261003', '2026-09-01', '2026-11-01')).toEqual(days('2026-10-01', '2026-10-02', '2026-10-03'));
    expect(ex('20261001T090000', 'FREQ=DAILY;UNTIL=20261003T090000Z', '2026-09-01', '2026-11-01')).toHaveLength(3);
    expect(ex('20261001T090000', 'FREQ=DAILY;UNTIL=20261003T085959Z', '2026-09-01', '2026-11-01')).toHaveLength(2);
  });
  it('instantes pulados (EXDATE) e frequência desconhecida', () => {
    expect(ex('20261001T090000', 'FREQ=DAILY', '2026-10-01', '2026-10-04', { skip: ['2026-10-02T09:00Z'] })).toEqual(days('2026-10-01', '2026-10-03'));
    expect(ex('20261001T090000', 'FREQ=HOURLY', '2026-10-01', '2026-10-04')).toEqual([]);
    expect(ex('20261001T090000', 'COUNT=2', '2026-10-01', '2026-10-04')).toEqual([]);
  });
});

describe('RRULE · semanal', () => {
  it('vários dias, ignorando os anteriores ao início', () => {
    expect(ex('20261001T090000', 'FREQ=WEEKLY;BYDAY=MO,FR', '2026-09-01', '2026-10-10')).toEqual(days('2026-10-02', '2026-10-05', '2026-10-09'));
    expect(ex('20261001T090000', 'FREQ=WEEKLY', '2026-09-01', '2026-10-16')).toEqual(days('2026-10-01', '2026-10-08', '2026-10-15'));
  });
  it('INTERVAL=2 depende do início da semana (WKST)', () => {
    const r = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU';
    expect(ex('20260929T090000', `${r};WKST=MO`, '2026-09-01', '2026-10-19')).toEqual(days('2026-09-29', '2026-10-04', '2026-10-13', '2026-10-18'));
    expect(ex('20260929T090000', `${r};WKST=SU`, '2026-09-01', '2026-10-19')).toEqual(days('2026-09-29', '2026-10-11', '2026-10-13'));
    expect(ex('20260929T090000', `${r};WKST=XX`, '2026-09-01', '2026-10-19')).toHaveLength(4);
  });
  it('BYMONTH filtra semanas e COUNT encerra', () => {
    expect(ex('20261029T090000', 'FREQ=WEEKLY;BYMONTH=11', '2026-10-01', '2026-11-13')).toEqual(days('2026-11-05', '2026-11-12'));
    expect(ex('20261001T090000', 'FREQ=WEEKLY;COUNT=2', '2026-09-01', '2026-12-01')).toEqual(days('2026-10-01', '2026-10-08'));
  });
});

describe('RRULE · mensal', () => {
  it('dia 31 pula meses curtos; -1 é o último dia', () => {
    expect(ex('20260831T090000', 'FREQ=MONTHLY', '2026-08-01', '2027-01-01')).toEqual(days('2026-08-31', '2026-10-31', '2026-12-31'));
    expect(ex('20260831T090000', 'FREQ=MONTHLY;BYMONTHDAY=-1', '2026-08-01', '2027-01-01')).toEqual(days('2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31'));
    expect(ex('20261001T090000', 'FREQ=MONTHLY;BYMONTHDAY=40,1', '2026-10-01', '2026-11-02')).toEqual(days('2026-10-01', '2026-11-01'));
    expect(ex('20261001T090000', 'FREQ=MONTHLY;BYMONTHDAY=-40,-31', '2026-10-01', '2027-01-01')).toEqual(days('2026-10-01', '2026-12-01'));
  });
  it('BYDAY ordinal (2ª segunda, última sexta) e todos os dias da semana', () => {
    expect(ex('20261001T090000', 'FREQ=MONTHLY;BYDAY=2MO', '2026-10-01', '2027-01-01')).toEqual(days('2026-10-12', '2026-11-09', '2026-12-14'));
    expect(ex('20261001T090000', 'FREQ=MONTHLY;BYDAY=-1FR', '2026-10-01', '2027-01-01')).toEqual(days('2026-10-30', '2026-11-27', '2026-12-25'));
    expect(ex('20261001T090000', 'FREQ=MONTHLY;BYDAY=5MO', '2026-10-01', '2027-01-01')).toEqual(days('2026-11-30'));
    expect(ex('20261001T090000', 'FREQ=MONTHLY;BYDAY=FR,1FR', '2026-10-01', '2026-11-01')).toEqual(days('2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30'));
    expect(ex('20261001T090000', 'FREQ=MONTHLY;BYDAY=TH,1MO', '2026-10-01', '2026-10-09')).toEqual(days('2026-10-01', '2026-10-05', '2026-10-08'));
  });
  it('intervalo atravessa a virada do ano; BYMONTH filtra', () => {
    expect(ex('20261015T090000', 'FREQ=MONTHLY;INTERVAL=5', '2026-10-01', '2028-02-01')).toEqual(days('2026-10-15', '2027-03-15', '2027-08-15', '2028-01-15'));
    expect(ex('20261015T090000', 'FREQ=MONTHLY;BYMONTH=1,12', '2026-10-01', '2027-03-01')).toEqual(days('2026-12-15', '2027-01-15'));
  });
});

describe('RRULE · anual', () => {
  it('29 de fevereiro só em ano bissexto', () => {
    expect(ex('20240229T090000', 'FREQ=YEARLY', '2024-01-01', '2033-01-01')).toEqual(days('2024-02-29', '2028-02-29', '2032-02-29'));
  });
  it('BYMONTH ordenado, BYMONTHDAY e BYDAY ordinal', () => {
    expect(ex('20260110T090000', 'FREQ=YEARLY;BYMONTH=3,1;BYMONTHDAY=10', '2026-01-01', '2028-01-01')).toEqual(days('2026-01-10', '2026-03-10', '2027-01-10', '2027-03-10'));
    expect(ex('20261126T090000', 'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', '2026-01-01', '2028-01-01')).toEqual(days('2026-11-26', '2027-11-25'));
    expect(ex('20261001T090000', 'FREQ=YEARLY;INTERVAL=2;COUNT=2', '2026-01-01', '2035-01-01')).toEqual(days('2026-10-01', '2028-10-01'));
  });
});

describe('RRULE · fuso e dia inteiro', () => {
  it('hora de parede fixa no fuso do evento; dia inteiro no fuso do usuário', () => {
    const tz = 'America/Manaus';
    const st = parseDate('20261001T090000', { TZID: tz }, tz);
    expect(expandRRule(st, H, 'FREQ=DAILY;COUNT=2', 0, Date.parse('2027-01-01'), new Set(), tz).map(iso)).toEqual(['2026-10-01T13:00', '2026-10-02T13:00']);
    const ad = parseDate('20261001', { VALUE: 'DATE' }, tz);
    expect(expandRRule(ad, 86400e3, 'FREQ=WEEKLY;COUNT=2', 0, Date.parse('2027-01-01'), new Set(), tz).map(iso)).toEqual(['2026-10-01T04:00', '2026-10-08T04:00']);
  });
});

describe('ics · leitura de linhas e valores', () => {
  it('parseLine: dois-pontos entre aspas, parâmetros inválidos', () => {
    expect(parseLine('DTSTART;TZID="America/Sao_Paulo:x":20261001T090000')).toEqual({ name: 'DTSTART', params: { TZID: 'America/Sao_Paulo:x' }, value: '20261001T090000' });
    expect(parseLine('x;=ruim;a=1;b:v:w')).toEqual({ name: 'X', params: { A: '1' }, value: 'v:w' });
    expect(parseLine('sem valor')).toBeNull();
    expect(parseLine('"a:b"')).toBeNull();
  });
  it('unescapeText', () => {
    const bs = String.fromCharCode(92);
    expect(unescapeText(` a${bs}nb${bs}, c${bs}; d${bs}${bs}e${bs}N `)).toBe(`a b, c; d${bs}e`);
  });
  it('parseDate: segundos, UTC, sem segundos, DATE forçado, inválido', () => {
    expect(parseDate('20261001T090507Z', {}, U)).toMatchObject({ allDay: false, s: 7, tz: 'UTC', ms: Date.UTC(2026, 9, 1, 9, 5, 7) });
    expect(parseDate('20261001T0905', { TZID: 'America/Manaus' }, U)).toMatchObject({ s: 0, tz: 'America/Manaus', ms: Date.UTC(2026, 9, 1, 13, 5) });
    expect(parseDate('20261001T0905', { TZID: 'Nada/Disso' }, 'America/Manaus').tz).toBe('America/Manaus');
    expect(parseDate(' 20261001T090000 ', { VALUE: 'DATE' }, U)).toMatchObject({ allDay: true, h: 0, ms: Date.UTC(2026, 9, 1) });
    expect(parseDate('2026-10-01', {}, U)).toBeNull();
  });
  it('parseDuration: todos os campos e sinal', () => {
    expect(parseDuration('P1W2DT3H4M5S')).toBe((604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000);
    expect(parseDuration('-PT15M')).toBe(-900000);
    expect(parseDuration('+P1D')).toBe(86400000);
    expect(parseDuration('PT30S')).toBe(30000);
    expect(parseDuration('1 hora')).toBe(0);
  });
  it('parseRRule: valores inválidos caem no padrão', () => {
    expect(parseRRule('FREQ=weekly;INTERVAL=0;COUNT=x;BYDAY=1mo,XX,-2FR,ZZ;BYMONTH=0,3;BYMONTHDAY=x,5;WKST=su;FOO=1;BAR', U)).toEqual({
      FREQ: 'WEEKLY', INTERVAL: 1, COUNT: 0, UNTIL: null, BYDAY: [{ n: 1, wd: 1 }, { n: -2, wd: 5 }], BYMONTH: [3], BYMONTHDAY: [5], WKST: 'SU'
    });
    expect(parseRRule('UNTIL=20261003', U).UNTIL).toBe(Date.UTC(2026, 9, 4) - 1);
    expect(parseRRule('UNTIL=lixo;interval=3', U)).toMatchObject({ UNTIL: null, INTERVAL: 3 });
  });
  it('validTz: aspas, prefixos, nomes do Windows e lixo', () => {
    expect(validTz('"America/Sao_Paulo"')).toBe('America/Sao_Paulo');
    expect(validTz('/mozilla.org/20050126_1/America/Manaus')).toBe('America/Manaus');
    expect(validTz('Central Brazilian Standard Time')).toBe('America/Cuiaba');
    expect(validTz('Nada/Disso')).toBeNull();
    expect(validTz('Nada/Disso')).toBeNull();
    expect(validTz('')).toBeNull();
  });
});

describe('ics · eventos', () => {
  const cal = (body) => `BEGIN:VCALENDAR\r\n${body.trim().split('\n').map((l) => l.trim()).join('\r\n')}\r\nEND:VCALENDAR`;
  const win = [Date.parse('2026-10-01'), Date.parse('2026-10-31')];
  it('ignora VALARM, mantém a primeira propriedade repetida, usa DURATION e corta duração negativa', () => {
    const t = cal(`
      BEGIN:VEVENT
      DTSTART:20261005T120000Z
      DURATION:PT90M
      SUMMARY:Primeiro
      SUMMARY:Segundo
      BEGIN:VALARM
      SUMMARY:Alarme
      DTSTART:20261231T000000Z
      END:VALARM
      LOCATION:Sala 2
      END:VEVENT
      BEGIN:VEVENT
      DTSTART:20261006T120000Z
      DTEND:20261006T110000Z
      END:VEVENT
      BEGIN:VEVENT
      SUMMARY:Sem início
      END:VEVENT
      BEGIN:VEVENT
      DTSTART:lixo
      END:VEVENT
    `);
    const evs = parseICS(t, ...win, U);
    expect(evs).toHaveLength(2);
    expect(evs[0]).toEqual({ title: 'Primeiro', location: 'Sala 2', start: Date.UTC(2026, 9, 5, 12), end: Date.UTC(2026, 9, 5, 13, 30), allDay: false });
    expect(evs[1]).toMatchObject({ title: '(sem título)', location: '', end: evs[1].start });
  });
  it('evento fora da janela fica de fora; EXDATE de dia inteiro e instância movida', () => {
    const t = cal(`
      BEGIN:VEVENT
      DTSTART:20260920T120000Z
      SUMMARY:Velho
      END:VEVENT
      BEGIN:VEVENT
      UID:a
      DTSTART;VALUE=DATE:20261001
      RRULE:FREQ=DAILY;COUNT=4
      EXDATE;VALUE=DATE:20261002,20261003
      SUMMARY:Plantão
      END:VEVENT
      BEGIN:VEVENT
      UID:a
      RECURRENCE-ID;VALUE=DATE:20261004
      DTSTART;VALUE=DATE:20261010
      SUMMARY:Plantão movido
      END:VEVENT
    `);
    const evs = parseICS(t, ...win, U);
    expect(evs.map((e) => [e.title, iso(e.start)])).toEqual([['Plantão', '2026-10-01T00:00'], ['Plantão movido', '2026-10-10T00:00']]);
    expect(evs[0].end - evs[0].start).toBe(86400e3);
  });
});
