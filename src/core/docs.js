// Base de conhecimento (pasta de notas .md indexada pela antena): escolhe os trechos relevantes e monta o bloco do prompt.
import { PROFILE } from './config.js';

/** Fica só com o que é relevante: placar mínimo e próximo do melhor resultado. */
export function relevant(results, { min = 6, ratio = 0.45, max = 5 } = {}) {
  if (!results?.length || results[0].score < min) return [];
  const top = results[0].score;
  const seen = new Set();
  return results
    .filter((r) => r.score >= top * ratio)
    .filter((r) => {
      const k = `${r.path}|${r.heading}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
}

/** Consulta de busca: a pergunta atual + a anterior (para perguntas de continuação, tipo "e no bot?"). */
export function searchQuery(text, history = []) {
  const prev = [...history].reverse().find((m) => m.role === 'user' && m.content !== text)?.content || '';
  return `${text} ${prev}`.trim().slice(0, 400);
}

/** Bloco para o system prompt. status = { files, folders }. */
export function docsBlock(status, hits, { maxChars = 6500 } = {}) {
  if (!status?.available) return '';
  const folders = Object.keys(status.folders || {}).filter((f) => f !== '(raiz)').slice(0, 14).join(', ');
  const { label, about, topics } = PROFILE.docs;
  let out = `CONHECIMENTO · ${label.toUpperCase()}: você tem acesso a ${about} — ${status.files} notas: ${folders}. Quando a pergunta for sobre ${topics}, baseie-se nos trechos abaixo, cite o nome da nota quando ajudar e diga com franqueza quando a documentação não cobrir o assunto.`;
  if (!hits.length) return out;
  out += '\n\nTRECHOS RELEVANTES DA DOCUMENTAÇÃO:';
  let used = out.length;
  for (const h of hits) {
    const head = `\n\n### ${h.path}${h.heading ? ` — ${h.heading}` : ''}\n`;
    const room = maxChars - used - head.length;
    if (room < 200) break;
    const body = h.text.length > room ? `${h.text.slice(0, room - 1)}…` : h.text;
    out += head + body;
    used += head.length + body.length;
  }
  return out;
}
