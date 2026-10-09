// Conhecimento: a antena indexa a pasta de notas (.md); aqui só consultamos (status + busca).
import { docsBlock, relevant, searchQuery } from '../core/docs.js';
import { esc } from '../core/text.js';
import { fetchT } from './antenna.js';
import { emit } from './bus.js';
import { tel } from './obs.js';
import { ANTENNA, net, session } from './state.js';

export const docs = { status: null };

export async function checkDocs() {
  if (!net.antenna) { docs.status = null; emit('docs'); return null; }
  try {
    docs.status = await (await fetchT(`${ANTENNA}/docs/status`, {}, 8000)).json();
  } catch {
    docs.status = null;
  }
  emit('docs');
  return docs.status;
}

export async function searchDocs(q, k = 6) {
  if (!net.antenna || !docs.status?.available) return [];
  return tel.span('docs.busca', { 'docs.termos': q.split(/\s+/).length }, async (sp) => {
    const j = await (await fetchT(`${ANTENNA}/docs/search?q=${encodeURIComponent(q)}&k=${k}`, {}, 4000)).json();
    sp.set('docs.resultados', j.results?.length || 0);
    return j.results || [];
  });
}

/** Provedor de contexto da conversa: busca os trechos relevantes para a pergunta atual. */
export async function docsContext(text) {
  if (!docs.status?.available) return '';
  try {
    const hits = relevant(await searchDocs(searchQuery(text, session.history)));
    if (hits.length) tel.log('info', 'documentação consultada', { 'docs.trechos': hits.length, 'docs.nota': hits[0].path });
    return docsBlock(docs.status, hits);
  } catch {
    return docsBlock(docs.status, []);
  }
}

export function docsStatusHTML() {
  const s = docs.status;
  if (!net.antenna) return '<p class="callout">A documentação é lida pela antena. Rode <code>node server.js</code> para conectar.</p>';
  if (!s?.available) return `<p class="callout">Pasta não encontrada: <code>${esc(s?.dir || 'knowledge')}</code>. Defina <code>DOCS_DIR</code> no <code>.env</code> da antena.</p>`;
  return `<div class="kpis"><div class="kpi"><small>Notas</small><b>${s.files}</b></div><div class="kpi"><small>Trechos indexados</small><b>${s.chunks}</b></div><div class="kpi"><small>Pastas</small><b>${Object.keys(s.folders).length}</b></div></div>
    <p class="muted">${esc(s.dir)} · edições no Obsidian são reindexadas sozinhas.</p>
    <div class="chips">${Object.entries(s.folders).sort((a, b) => b[1] - a[1]).map(([f, n]) => `<span class="chip">${esc(f)} · ${n}</span>`).join('')}</div>`;
}

export const resultsHTML = (results) =>
  results.length
    ? `<ul class="doc-results">${results.map((r) => `<li data-enter><b>${esc(r.path)}</b><small>${esc(r.heading)} · relevância ${r.score}</small><p>${esc(r.text.slice(0, 280))}${r.text.length > 280 ? '…' : ''}</p></li>`).join('')}</ul>`
    : '<p class="muted">Nada encontrado.</p>';
