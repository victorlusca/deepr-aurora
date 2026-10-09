// Memória viva: a IA termina a resposta com [[SAVE:area|titulo|texto]] e a nota nasce/atualiza.
import { norm } from './text.js';

export const SAVE_RE = /\[\[SAVE:([a-z_]+)\|([^|]+)\|([\s\S]+?)\]\]/g;

/** → { text: resposta limpa, saves: [{area, title, body}] } */
export function extractSaves(text, areas) {
  const saves = [];
  const src = String(text || '');
  for (const m of src.matchAll(SAVE_RE)) {
    saves.push({ area: areas[m[1]] ? m[1] : 'meta', title: m[2].trim().slice(0, 40), body: m[3].trim() });
  }
  const clean = src.replace(/\[\[SAVE:[^\]]*\]\]/g, '').replace(/\s+$/g, '').trim();
  return { text: clean, saves };
}

/** Aplica os SAVEs às notas (imutável). → { notes, touched: ids } */
export function applySaves(notes, saves, newId) {
  const next = notes.map((n) => ({ ...n }));
  const touched = [];
  for (const s of saves) {
    let n = next.find((x) => norm(x.title) === norm(s.title));
    if (n) Object.assign(n, { body: s.body, area: s.area });
    else {
      n = { id: newId(), area: s.area, title: s.title, body: s.body };
      next.push(n);
    }
    touched.push(n.id);
  }
  return { notes: next, touched };
}

/** Arestas do grafo: relações fixas + notas novas ligadas à mesma área e ao hub de metas. */
export function graphEdges(notes, rel) {
  const ids = new Set(notes.map((n) => n.id));
  const seen = new Set(), out = [];
  const add = (a, b) => {
    if (a === b || !ids.has(a) || !ids.has(b)) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([a, b]);
  };
  for (const [a, b] of rel) add(a, b);
  for (const n of notes) {
    if (rel.some((r) => r.includes(n.id))) continue;
    for (const o of notes.filter((x) => x.area === n.area && x.id !== n.id).slice(0, 2)) add(n.id, o.id);
    add(n.id, ids.has('metas') ? 'metas' : notes[0].id);
  }
  return out;
}
