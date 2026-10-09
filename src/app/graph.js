// Second Brain: grafo neural em SVG (string injetada numa DIV — namespace correto em Safari/webviews).
// Cérebro no centro, cada nota é um neurônio ligado a ele; pulsos vão e voltam pelas ligações.
// Carregamento preguiçoso: só monta quando o cartão chega perto da tela.
import { AREA, CONFIG } from '../core/config.js';
import { graphEdges } from '../core/memory.js';
import { esc } from '../core/text.js';
import { on } from './bus.js';
import { iconPaths } from './icons.js';
import { ambientOn, brainStore } from './state.js';
import { $ } from './ui.js';

export const AREA_ICON = { metas: 'target', trabalho: 'briefcase', projetos: 'code', financas: 'coin', aprendizado: 'book', saude: 'heart', relacoes: 'users', meta: 'user' };

const W = 1000, H = 540, CX = 500, CY = 270, CORE = 56, NODE = 23;
const G = { links: [], pulses: [], els: [], nodes: {}, ready: false, visible: false };
const f = (v) => v.toFixed(1);

/** Ícone de 24×24 desenhado em (x, y) com tamanho s. */
const glyph = (name, x, y, s, cls = '') =>
  `<g class="glyph ${cls}" transform="translate(${f(x - s / 2)} ${f(y - s / 2)}) scale(${(s / 24).toFixed(3)})">${iconPaths(name)}</g>`;

function layout(list) {
  const pos = {};
  const n = list.length;
  const rx = n <= 4 ? 300 : 410, ry = n <= 4 ? 170 : 205;
  list.forEach((note, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n % 2 ? 0 : Math.PI / n);
    pos[note.id] = { x: CX + rx * Math.cos(a), y: CY + ry * Math.sin(a), a };
  });
  return pos;
}

/** Dendrito: sai da borda do cérebro e curva levemente até o neurônio. */
function dendrite(p, k) {
  const dx = p.x - CX, dy = p.y - CY, len = Math.hypot(dx, dy) || 1;
  const A = { x: CX + (dx / len) * (CORE + 6), y: CY + (dy / len) * (CORE + 6) };
  const B = { x: p.x - (dx / len) * (NODE + 4), y: p.y - (dy / len) * (NODE + 4) };
  const bend = (k % 2 ? 1 : -1) * Math.min(60, len * 0.14);
  const C = { x: (A.x + B.x) / 2 - (dy / len) * bend, y: (A.y + B.y) / 2 + (dx / len) * bend };
  return { A, B, C };
}

const DEFS = `<defs>
  <radialGradient id="sbCore" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#6ff0a8"/><stop offset=".45" stop-color="#1f8b4c"/><stop offset="1" stop-color="#062615"/></radialGradient>
  <radialGradient id="sbAura" r=".5"><stop offset="0" stop-color="#1f8b4c" stop-opacity=".45"/><stop offset="1" stop-color="#1f8b4c" stop-opacity="0"/></radialGradient>
  <filter id="sbGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;

function coreSVG() {
  return `<circle class="aura" cx="${CX}" cy="${CY}" r="${CORE * 2.3}" fill="url(#sbAura)"/>
    <circle class="core" cx="${CX}" cy="${CY}" r="${CORE}" fill="url(#sbCore)" stroke="#a7f3c9" stroke-opacity=".35" stroke-width="1.5"/>
    <circle class="core-ring" cx="${CX}" cy="${CY}" r="${CORE + 12}" fill="none" stroke="#3ddc84" stroke-opacity=".22" stroke-dasharray="2 7"/>
    ${glyph('brain', CX, CY, 58, 'core-glyph')}`;
}

export function renderGraph() {
  const order = Object.keys(AREA);
  const notes = brainStore.notes;
  const list = notes.slice().sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  const pos = layout(list);
  let s = DEFS;

  if (!list.length) {
    s += coreSVG();
    s += `<text class="empty-t" x="${CX}" y="${CY + CORE + 52}">Second Brain vazio</text>
      <text class="empty-s" x="${CX}" y="${CY + CORE + 78}">Diga “Ei Aurora, meu nome é…” ou toque em + para criar a primeira nota</text>`;
  } else {
    // ligações entre notas da mesma área (sinapses laterais, discretas)
    for (const [a, b] of graphEdges(list, [])) {
      if (pos[a] && pos[b] && list.find((n) => n.id === a).area === list.find((n) => n.id === b).area) {
        s += `<line class="syn" x1="${f(pos[a].x)}" y1="${f(pos[a].y)}" x2="${f(pos[b].x)}" y2="${f(pos[b].y)}" stroke="${AREA[list.find((n) => n.id === a).area].color}"/>`;
      }
    }
    // dendritos cérebro → neurônio
    G.links = list.map((n, k) => {
      const d = dendrite(pos[n.id], k), c = (AREA[n.area] || AREA.meta).color;
      const path = `M${f(d.A.x)} ${f(d.A.y)} Q${f(d.C.x)} ${f(d.C.y)} ${f(d.B.x)} ${f(d.B.y)}`;
      s += `<path class="den" d="${path}" stroke="${c}"/><path class="den-flow" d="${path}" stroke="${c}"/>`;
      return { ...d, id: n.id, color: c };
    });
    s += coreSVG();
    list.forEach((n, i) => {
      const p = pos[n.id], c = (AREA[n.area] || AREA.meta).color;
      const below = p.y >= CY - 10;
      s += `<g class="node" data-id="${esc(n.id)}" tabindex="0" role="button" aria-label="Editar nota ${esc(n.title)}" style="--c:${c}">
        <circle class="halo" cx="${f(p.x)}" cy="${f(p.y)}" r="${NODE + 8}" style="animation-delay:${((i * 0.41) % 3).toFixed(2)}s"/>
        <circle class="nd" cx="${f(p.x)}" cy="${f(p.y)}" r="${NODE}"/>
        ${glyph(AREA_ICON[n.area] || 'user', p.x, p.y, 22)}
        <text x="${f(p.x)}" y="${f(below ? p.y + NODE + 20 : p.y - NODE - 11)}">${esc(n.title.length > 22 ? `${n.title.slice(0, 21)}…` : n.title)}</text>
      </g>`;
    });
    const count = Math.min(28, list.length * 2 + 2);
    for (let i = 0; i < count; i++) s += '<circle class="pulse" r="2.8" opacity="0"/>';
  }

  $('graph').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Grafo do Second Brain">${s}</svg>`;
  G.nodes = Object.fromEntries(Array.from($('graph').querySelectorAll('.node')).map((g) => [g.dataset.id, g]));
  G.els = Array.from($('graph').querySelectorAll('.pulse'));
  G.pulses = G.els.map((_, i) => newPulse(Math.random(), i % 2 ? 1 : -1));
  G.ready = true;

  const areas = Object.keys(AREA).filter((a) => notes.some((n) => n.area === a));
  $('brainCount').textContent = notes.length ? `${notes.length} notas · ${areas.length} áreas` : 'vazio';
  $('legend').innerHTML = notes.length
    ? `${areas.map((a) => `<span class="lg"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="color:${AREA[a].color}">${iconPaths(AREA_ICON[a] || 'user')}</svg>${AREA[a].label}</span>`).join('')}<span class="lg ok">contexto injetado em todos os comandos da ${CONFIG.name}</span>`
    : '<span class="lg">Tudo o que você contar fica salvo no banco da antena — nunca no código.</span>';
}

/** dir 1 = do cérebro para a nota · -1 = da nota para o cérebro. */
function newPulse(t = 0, dir = Math.random() < 0.5 ? 1 : -1) {
  return { l: Math.floor(Math.random() * Math.max(1, G.links.length)), t, dir, sp: 0.35 + Math.random() * 0.45 };
}

function fire(id) {
  const g = G.nodes[id];
  if (!g) return;
  g.classList.remove('fire');
  void g.getBoundingClientRect();
  g.classList.add('fire');
}

/** Pulsos ao longo da Bézier: (1-t)²A + 2(1-t)tC + t²B. */
export function tickGraph(dt) {
  if (!G.ready || !G.visible || !G.links.length || !ambientOn()) return;
  G.pulses.forEach((p, i) => {
    p.t += p.sp * dt;
    if (p.t >= 1) {
      const L = G.links[p.l];
      if (p.dir === 1 && L) fire(L.id); // sinal chegou ao neurônio
      Object.assign(p, newPulse(0, -p.dir)); // e volta
      return;
    }
    const L = G.links[p.l];
    if (!L) return;
    const t = p.dir === 1 ? p.t : 1 - p.t, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t, el = G.els[i];
    el.setAttribute('cx', (a * L.A.x + b * L.C.x + c * L.B.x).toFixed(1));
    el.setAttribute('cy', (a * L.A.y + b * L.C.y + c * L.B.y).toFixed(1));
    el.setAttribute('fill', L.color);
    el.setAttribute('opacity', Math.min(1, Math.sin(Math.PI * p.t) * 1.4).toFixed(2));
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
    else $('brainCount').textContent = brainStore.notes.length ? `${brainStore.notes.length} notas` : 'vazio';
    if (touched?.length) setTimeout(() => flashNodes(touched), 50);
  });
}
