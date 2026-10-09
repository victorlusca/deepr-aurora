// Second Brain: grafo neural em SVG (string injetada numa DIV — namespace correto em Safari/webviews).
// Carregamento preguiçoso: só monta quando o cartão chega perto da tela.
import { AREA, CONFIG, REL } from '../core/config.js';
import { graphEdges } from '../core/memory.js';
import { esc } from '../core/text.js';
import { on } from './bus.js';
import { ambientOn, brainStore } from './state.js';
import { $ } from './ui.js';

const G = { edges: [], pulses: [], els: [], ready: false, visible: false };

export function renderGraph() {
  const CX = 500, CY = 262, order = Object.keys(AREA);
  const notes = brainStore.notes;
  const list = notes.slice().sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  const edges = graphEdges(notes, REL), deg = {};
  for (const [a, b] of edges) { deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1; }
  const pos = {};
  list.forEach((n, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / list.length;
    pos[n.id] = { x: CX + 405 * Math.cos(a), y: CY + 200 * Math.sin(a), r: Math.min(22, 8 + 1.5 * (deg[n.id] || 0)) };
  });
  const f = (v) => v.toFixed(1);
  let s = `<defs>
    <radialGradient id="sbCore" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ddd6fe"/><stop offset=".45" stop-color="#8b5cf6"/><stop offset="1" stop-color="#2e1065"/></radialGradient>
    <linearGradient id="sbEdge" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="540"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#2dd4ff"/></linearGradient>
    <filter id="sbGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="sbGlow2" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
  G.edges = [];
  for (const n of list) {
    const p = pos[n.id];
    s += `<line x1="${CX}" y1="${CY}" x2="${f(p.x)}" y2="${f(p.y)}" stroke="${AREA[n.area].color}" stroke-width=".7" opacity=".22"/>`;
  }
  for (const [a, b] of edges) {
    const A = pos[a], B = pos[b];
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, C = { x: mx + (CX - mx) * 0.35, y: my + (CY - my) * 0.35 };
    const d = `M${f(A.x)} ${f(A.y)} Q${f(C.x)} ${f(C.y)} ${f(B.x)} ${f(B.y)}`;
    s += `<path d="${d}" fill="none" stroke="url(#sbEdge)" stroke-width="1" opacity=".16"/><path class="edge" d="${d}" fill="none" stroke="url(#sbEdge)" stroke-width="1.3" stroke-linecap="round" opacity=".55" stroke-dasharray="4 10"/>`;
    G.edges.push({ A, B, C });
  }
  s += `<circle class="core" cx="${CX}" cy="${CY}" r="42" fill="url(#sbCore)" filter="url(#sbGlow2)"/><text x="${CX}" y="${CY + 12}" text-anchor="middle" font-size="32">🧠</text>`;
  list.forEach((n, i) => {
    const p = pos[n.id], c = AREA[n.area].color;
    s += `<g class="node" data-id="${esc(n.id)}" tabindex="0" role="button" aria-label="Editar nota ${esc(n.title)}"><circle class="halo" cx="${f(p.x)}" cy="${f(p.y)}" r="${f(p.r + 7)}" fill="none" stroke="${c}" stroke-width="1.5" style="animation-delay:${((i * 0.37) % 3).toFixed(2)}s"/><circle class="nd" cx="${f(p.x)}" cy="${f(p.y)}" r="${f(p.r)}" fill="${c}" fill-opacity=".88" filter="url(#sbGlow)"/><text x="${f(p.x)}" y="${f(p.y + p.r + 17)}">${esc(n.title)}</text></g>`;
  });
  for (let i = 0; i < 12; i++) s += '<circle class="pulse" r="2.6" fill="#fff" filter="url(#sbGlow)" opacity="0"/>';
  $('graph').innerHTML = `<svg viewBox="0 0 1000 540" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Grafo do Second Brain">${s}</svg>`;
  G.els = Array.from($('graph').querySelectorAll('.pulse'));
  G.pulses = G.els.map(() => ({ e: Math.floor(Math.random() * Math.max(1, G.edges.length)), t: Math.random(), sp: 0.22 + Math.random() * 0.4 }));
  G.ready = true;
  const areas = Object.keys(AREA).filter((a) => notes.some((n) => n.area === a));
  $('brainCount').textContent = `${notes.length} notas · ${areas.length} áreas`;
  $('legend').innerHTML = `${areas.map((a) => `<span class="lg"><i class="dot" style="background:${AREA[a].color}"></i>${AREA[a].label}</span>`).join('')}<span class="lg ok">✓ contexto injetado em todos os comandos da ${CONFIG.name}</span>`;
}

/** Pulsos de sinapse: posição na Bézier = (1-t)²A + 2(1-t)tC + t²B. */
export function tickGraph(dt) {
  if (!G.ready || !G.visible || !G.edges.length || !ambientOn()) return;
  G.pulses.forEach((p, i) => {
    p.t += p.sp * dt;
    if (p.t >= 1) { p.t = 0; p.e = Math.floor(Math.random() * G.edges.length); p.sp = 0.22 + Math.random() * 0.4; }
    const E = G.edges[p.e], t = p.t, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t, el = G.els[i];
    el.setAttribute('cx', (a * E.A.x + b * E.C.x + c * E.B.x).toFixed(1));
    el.setAttribute('cy', (a * E.A.y + b * E.C.y + c * E.B.y).toFixed(1));
    el.setAttribute('opacity', Math.sin(Math.PI * t).toFixed(2));
  });
}

export function flashNodes(ids) {
  for (const id of ids) {
    const g = $('graph').querySelector(`.node[data-id="${CSS.escape(id)}"]`);
    if (!g) continue;
    g.classList.remove('flash');
    void g.getBoundingClientRect();
    g.classList.add('flash');
    setTimeout(() => g.classList.remove('flash'), 2600);
  }
}

/** Lazy load: monta o grafo quando o cartão estiver a 120px da tela; pausa os pulsos fora dela. */
export function initGraph() {
  const host = $('graph');
  const io = new IntersectionObserver(([e]) => {
    G.visible = e.isIntersecting;
    if (e.isIntersecting && !G.ready) renderGraph();
  }, { rootMargin: '120px 0px' });
  io.observe(host);
  on('notes', (touched) => {
    if (G.ready) renderGraph();
    else $('brainCount').textContent = `${brainStore.notes.length} notas`;
    if (touched?.length) setTimeout(() => flashNodes(touched), 50);
  });
}
