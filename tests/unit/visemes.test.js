import { describe, expect, it } from 'vitest';
import { buildTimeline, sampleTimeline, VISEME, wordTimeAt, wordToVisemes } from '../../src/core/visemes.js';

const vis = (w) => wordToVisemes(w).join('');

describe('visemas · tabela', () => {
  it('formas [jaw, wide, close, ftooth] de cada som', () => {
    expect(VISEME).toEqual({
      R: [0.04, 0, 0, 0], A: [0.95, 0.2, 0, 0], E: [0.55, 0.55, 0, 0], I: [0.3, 0.85, 0, 0], O: [0.62, -0.6, 0, 0],
      U: [0.3, -1, 0, 0], M: [0, 0, 1, 0], F: [0.12, 0.1, 0, 1], L: [0.32, 0.2, 0, 0], S: [0.16, 0.45, 0, 0],
      X: [0.22, -0.45, 0, 0], Q: [0.34, 0.1, 0, 0], K: [0.38, 0.15, 0, 0]
    });
  });
});

describe('visemas · ortografia', () => {
  it('cada consoante no seu grupo', () => {
    expect(['b', 'p', 'f', 'v', 'x', 'j', 'k', 'q', 'r', 'w', 's', 'z', 'ç', 't', 'd', 'l'].map(vis)).toEqual(
      ['M', 'M', 'F', 'F', 'X', 'X', 'K', 'K', 'Q', 'U', 'S', 'S', 'S', 'L', 'L', 'L']
    );
    expect(vis('bpf')).toBe('MF');
    expect(vis('h')).toBe('E');
    expect(vis('7')).toBe('EA');
    expect(vis('42')).toBe('EAEA');
  });
  it('c e g: suave antes de e/i, duro antes de a/o e no fim da palavra', () => {
    expect([vis('ce'), vis('ca'), vis('ge'), vis('ga'), vis('mac'), vis('big')]).toEqual(['SE', 'KA', 'XE', 'KA', 'MAK', 'MIK']);
  });
  it('u mudo só em que/gui; nos demais casos é U', () => {
    expect([vis('que'), vis('gui'), vis('quando'), vis('água'), vis('pue'), vis('ue'), vis('qu')]).toEqual(['KE', 'KI', 'KUALO', 'AKUA', 'MUE', 'UE', 'KU']);
  });
  it('m e n nasais no fim não fecham a boca; no começo/meio sim', () => {
    expect([vis('bem'), vis('m'), vis('amor'), vis('hífen'), vis('ne'), vis('n')]).toEqual(['ME', 'M', 'AMOQ', 'IFE', 'LE', 'E']);
  });
  it('dígrafos ch, lh, nh', () => {
    expect([vis('chave'), vis('lhe'), vis('banho'), vis('ilha')]).toEqual(['XAFE', 'LE', 'MALO', 'ILA']);
  });
});

describe('visemas · linha do tempo', () => {
  it('duração da palavra dividida pelo peso de cada som', () => {
    const tl = buildTimeline('pa', 10);
    expect(tl.words).toEqual([{ ci: 0, t: 0.04 }]);
    expect(tl.segs.map((s) => s.v)).toEqual(['M', 'A']);
    expect(tl.segs[0].t0).toBeCloseTo(0.04);
    expect(tl.segs[0].t1).toBeCloseTo(0.04 + (0.2 * 0.85) / 2.1);
    expect(tl.segs[1].t1).toBeCloseTo(0.24);
    expect(tl.total).toBeCloseTo(0.26);
  });
  it('mínimo de 0,12 s por palavra; números contam triplo', () => {
    expect(buildTimeline('a').segs[0].t1).toBeCloseTo(0.16);
    const n = buildTimeline('12', 10);
    expect(n.segs.map((s) => s.v)).toEqual(['E', 'A', 'E', 'A']);
    expect(n.segs[3].t1).toBeCloseTo(0.64);
    expect(n.segs[0].t1 - n.segs[0].t0).toBeCloseTo((0.6 * 1.15) / 4.8);
  });
  it('vírgula pausa 0,2 s; ponto e quebra de linha 0,36 s', () => {
    const tl = buildTimeline('a, b. c\n');
    const r = (x) => [x.v, +x.t0.toFixed(2), +x.t1.toFixed(2)];
    expect(tl.segs.map(r)).toEqual([['A', 0.04, 0.16], ['R', 0.18, 0.38], ['M', 0.38, 0.5], ['R', 0.52, 0.88], ['K', 0.88, 1], ['R', 1.02, 1.38]]);
    expect(tl.total).toBeCloseTo(1.38);
    expect(tl.words.map((w) => w.ci)).toEqual([0, 3, 6]);
    expect(buildTimeline('').total).toBeCloseTo(0.04);
  });
  it('wordTimeAt acha a palavra pelo índice do caractere', () => {
    const tl = buildTimeline('a, b. c');
    expect(wordTimeAt(tl, -1)).toBeNull();
    expect(wordTimeAt(tl, 0)).toBeCloseTo(0.04);
    expect(wordTimeAt(tl, 4)).toBeCloseTo(0.38);
    expect(wordTimeAt(tl, 6)).toBeCloseTo(0.88);
    expect(wordTimeAt(tl, 99)).toBeCloseTo(0.88);
  });
});

describe('visemas · amostragem', () => {
  const tl = buildTimeline('pa', 10);
  const close = (got, want) => {
    got.forEach((x, i) => {
      expect(x).toBeCloseTo(want[i], 4);
    });
  };
  it('fora do tempo ou sem segmentos → repouso', () => {
    expect(sampleTimeline(tl, -0.01)).toBe(VISEME.R);
    expect(sampleTimeline({ segs: [], total: 0 }, 0)).toBe(VISEME.R);
    expect(sampleTimeline(tl, 0.67)).toBe(VISEME.R);
    expect(sampleTimeline(tl, 0.3)).toBe(VISEME.R);
  });
  it('início do segmento: forma pura; fim: coarticula 60% rumo ao próximo', () => {
    expect(sampleTimeline(tl, 0)).toEqual(VISEME.M);
    expect(sampleTimeline(tl, 0.06)).toEqual(VISEME.M);
    close(sampleTimeline(tl, 0.11), [0.4464103, 0.0939811, 0.5300944, 0]);
    close(sampleTimeline(tl, tl.segs[0].t1 - 1e-9), [0.57, 0.12, 0.4, 0]);
  });
  it('último segmento segura a forma até 50 ms depois do fim', () => {
    expect(sampleTimeline(tl, 0.2)).toBe(VISEME.A);
    expect(sampleTimeline(tl, 0.28)).toBe(VISEME.A);
    expect(sampleTimeline(tl, 0.2905)).toBe(VISEME.R);
  });
  it('busca binária acha o segmento certo em linhas longas', () => {
    const b = buildTimeline('a, b. c\n');
    close(sampleTimeline(b, 0.45), [0.0003756, 0, 0.9906112, 0]);
    expect(sampleTimeline(b, 0.9)).toEqual(VISEME.K);
    close(sampleTimeline(b, 0.17), [0.404, 0.08, 0, 0]);
    expect(sampleTimeline(b, 0.38)).toEqual(VISEME.M);
    expect(sampleTimeline(b, 1.1)).toEqual(VISEME.R);
  });
});
