// Utilidades de texto puras.

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESC[c]);

/** minúsculas, sem acento, sem pontuação, espaços simples. */
export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Limpa o texto para a voz: sem markdown, URLs ou emojis. */
export const cleanForSpeech = (t) =>
  String(t || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>~|]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+—\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

/** Quebra em trechos de até `max` caracteres em fronteiras de frase (contorna o corte de ~15 s do Chrome). */
export function splitChunks(text, max = 190) {
  const sents = String(text).match(/[^.!?…]+[.!?…]*\s*/g) || [String(text)];
  const out = [];
  let cur = '';
  for (let s of sents) {
    s = s.trim();
    if (!s) continue;
    while (s.length > max) {
      let cut = s.lastIndexOf(',', max);
      if (cut < 60) cut = s.lastIndexOf(' ', max);
      if (cut < 30) cut = max;
      if (cur) { out.push(cur); cur = ''; }
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (!s) continue;
    if (cur && `${cur} ${s}`.length > max) { out.push(cur); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Remove o sufixo " - Fonte" que o Google News põe no título. */
export function stripSource(title, source) {
  if (source && title.endsWith(` - ${source}`)) return title.slice(0, -(source.length + 3));
  return title.replace(/\s+-\s+[^-]{2,40}$/, '');
}
