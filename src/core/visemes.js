// Fala → formas de boca (visemas). Alimenta o orbe: amplitude (jaw), largura (wide), lábios fechados (close).

//               jaw   wide  close  ftooth
export const VISEME = {
  R: [0.04, 0, 0, 0], // repouso
  A: [0.95, 0.2, 0, 0],
  E: [0.55, 0.55, 0, 0],
  I: [0.3, 0.85, 0, 0],
  O: [0.62, -0.6, 0, 0],
  U: [0.3, -1, 0, 0],
  M: [0, 0, 1, 0], // m b p
  F: [0.12, 0.1, 0, 1], // f v
  L: [0.32, 0.2, 0, 0], // l n t d lh nh
  S: [0.16, 0.45, 0, 0], // s z ç
  X: [0.22, -0.45, 0, 0], // ch x j
  Q: [0.34, 0.1, 0, 0], // r
  K: [0.38, 0.15, 0, 0] // k q g
};
const WEIGHT = { A: 1.25, E: 1.15, I: 1.05, O: 1.2, U: 1.1, M: 0.85, F: 0.8, L: 0.7, S: 0.85, X: 0.85, Q: 0.6, K: 0.7 };
const FRONT = 'eéêií';
const front = (ch) => ch !== '' && FRONT.includes(ch);

/** Palavra em português → sequência de visemas (regras ortográficas aproximadas). */
export function wordToVisemes(word) {
  const w = String(word).toLowerCase();
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i], n = w[i + 1] || '', p = w[i - 1] || '';
    let v = null;
    if ('aáàâã'.includes(c)) v = 'A';
    else if ('eéê'.includes(c)) v = 'E';
    else if ('iíîy'.includes(c)) v = 'I';
    else if ('oóôõ'.includes(c)) v = 'O';
    else if ('uúü'.includes(c)) {
      if ((p === 'q' || p === 'g') && front(n)) continue; // "que", "gui": u mudo
      v = 'U';
    } else if (c === 'm') {
      if (i === w.length - 1 && i > 0) continue; // "bem", "sim": nasal, sem fechar os lábios
      v = 'M';
    } else if (c === 'b' || c === 'p') v = 'M';
    else if (c === 'f' || c === 'v') v = 'F';
    else if (c === 'c' && n === 'h') { v = 'X'; i++; }
    else if ((c === 'l' || c === 'n') && n === 'h') { v = 'L'; i++; }
    else if (c === 'n') {
      if (i === w.length - 1) continue;
      v = 'L';
    } else if ('ltd'.includes(c)) v = 'L';
    else if ('szç'.includes(c)) v = 'S';
    else if (c === 'c') v = front(n) ? 'S' : 'K';
    else if (c === 'x' || c === 'j') v = 'X';
    else if (c === 'g') v = front(n) ? 'X' : 'K';
    else if (c === 'k' || c === 'q') v = 'K';
    else if (c === 'r') v = 'Q';
    else if (c === 'w') v = 'U';
    else if (/[0-9]/.test(c)) { out.push('E', 'A'); continue; }
    else continue;
    if (out[out.length - 1] !== v) out.push(v);
  }
  return out.length ? out : ['E'];
}

/** Linha do tempo de visemas para um trecho. cps = caracteres por segundo da voz. */
export function buildTimeline(text, cps = 14) {
  const segs = [], words = [];
  let t = 0.04;
  const re = /([0-9A-Za-zÀ-ÿ]+)|([,;:—–])|([.!?…]+)|(\n)/g;
  let m = re.exec(text);
  while (m) {
    if (m[1]) {
      const word = m[1], vs = wordToVisemes(word);
      const letters = word.length + (/[0-9]/.test(word) ? word.length * 2 : 0);
      const dur = Math.max(0.12, letters / cps);
      const tw = vs.reduce((a, v) => a + (WEIGHT[v] || 0.8), 0);
      words.push({ ci: m.index, t });
      for (const v of vs) {
        const d = (dur * (WEIGHT[v] || 0.8)) / tw;
        segs.push({ t0: t, t1: t + d, v });
        t += d;
      }
      t += 0.02;
    } else if (m[2]) { segs.push({ t0: t, t1: t + 0.2, v: 'R' }); t += 0.2; }
    else { segs.push({ t0: t, t1: t + 0.36, v: 'R' }); t += 0.36; }
    m = re.exec(text);
  }
  return { segs, words, total: t };
}

/** Instante (s) planejado da palavra que começa em charIndex (evento onboundary da voz). */
export function wordTimeAt(tl, charIndex) {
  let w = null;
  for (const x of tl.words) {
    if (x.ci <= charIndex) w = x;
    else break;
  }
  return w ? w.t : null;
}

/** Forma da boca no tempo t, com coarticulação (antecipa o próximo som no fim do segmento). */
export function sampleTimeline(tl, t) {
  const s = tl.segs;
  if (!s.length || t < 0 || t > tl.total + 0.4) return VISEME.R;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  const cur = s[lo];
  if (t > cur.t1 + 0.05) return VISEME.R;
  const a = VISEME[cur.v], nx = s[lo + 1];
  if (!nx) return a;
  const p = (t - cur.t0) / Math.max(0.001, cur.t1 - cur.t0);
  const k = p < 0.55 ? 0 : Math.min(1, (p - 0.55) / 0.45);
  const kk = k * k * (3 - 2 * k) * 0.6, b = VISEME[nx.v];
  return a.map((x, i) => x + (b[i] - x) * kk);
}
