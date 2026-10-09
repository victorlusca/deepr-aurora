// Radar de notícias: Google News RSS (grátis, sem chave).
import { norm, stripSource } from './text.js';

export const feedUrl = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:3d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

/** Lê o XML do RSS. `DOMParserImpl` é injetável (navegador: window.DOMParser). */
export function parseRSS(xml, DOMParserImpl) {
  const doc = new DOMParserImpl().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('RSS inválido');
  const tx = (el, s) => el.querySelector(s)?.textContent.trim() || '';
  return Array.from(doc.querySelectorAll('item'))
    .map((it) => {
      const source = tx(it, 'source');
      return { title: stripSource(tx(it, 'title'), source), source, link: tx(it, 'link'), date: Date.parse(tx(it, 'pubDate')) || 0 };
    })
    .sort((a, b) => b.date - a.date);
}

/** "inteligência artificial" → tópico IA (por nome ou apelidos). */
export function findTopic(topics, spoken) {
  const s = norm(spoken);
  if (!s) return null;
  return (
    topics.find((t) =>
      [t.label, ...String(t.alias || '').split(',')]
        .map(norm)
        .filter(Boolean)
        .some((a) => s === a || s.includes(a) || a.includes(s))
    ) || null
  );
}

export const isGenericNewsWord = (s) => /^(hoje|agora|do dia|ultimas|principais)$/.test(norm(s));
