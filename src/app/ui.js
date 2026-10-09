// Componentes de UI genéricos: barra de progresso global, avisos (toast) e modais.
import { enter, exit } from './motion.js';

export const $ = (id) => document.getElementById(id);

/* ── progresso global: cada tarefa de rede conta; a barra avança conforme terminam ── */
const prog = { total: 0, done: 0, hideT: 0 };
function paint() {
  const bar = $('progress');
  if (!bar) return;
  clearTimeout(prog.hideT);
  const ratio = prog.total ? prog.done / prog.total : 1;
  bar.dataset.on = '1';
  bar.style.transform = `scaleX(${(0.08 + 0.92 * ratio).toFixed(3)})`;
  if (prog.done >= prog.total) {
    prog.hideT = setTimeout(() => {
      bar.dataset.on = '';
      prog.total = 0; prog.done = 0;
      setTimeout(() => { if (!prog.total) bar.style.transform = 'scaleX(0)'; }, 260);
    }, 280);
  }
}
/** Acompanha uma promessa na barra de progresso do topo. */
export function track(promise) {
  prog.total++;
  paint();
  return Promise.resolve(promise).finally(() => { prog.done++; paint(); });
}

/* ── toast ── */
export function toast(msg, { ms = 4000, kind = '' } = {}) {
  const host = $('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  host.appendChild(t);
  enter(t, { y: 10, dur: 300 });
  let timer = setTimeout(close, ms);
  // pausa enquanto o mouse está em cima (Sonner)
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => { timer = setTimeout(close, 1500); });
  async function close() { await exit(t, { dur: 180, y: 6 }); t.remove(); }
}

/* ── modais: transição por estado (interrompível), foco devolvido ao fechar ── */
let lastFocus = null;
export function openModal(id) {
  const m = $(id);
  if (!m) return;
  lastFocus = document.activeElement;
  m.hidden = false;
  requestAnimationFrame(() => { m.dataset.open = '1'; });
  const f = m.querySelector('[autofocus], input, select, textarea, button');
  setTimeout(() => f?.focus(), 60);
}
export function closeModal(id) {
  const m = $(id);
  if (!m || m.hidden) return;
  m.dataset.open = '';
  const done = () => { if (!m.dataset.open) m.hidden = true; };
  const card = m.querySelector('.modal-card');
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else setTimeout(done, 200);
  lastFocus?.focus?.();
}
export function bindModals() {
  for (const m of document.querySelectorAll('.modal')) {
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('[data-close]')) closeModal(m.id);
    });
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const m of document.querySelectorAll('.modal[data-open="1"]')) closeModal(m.id);
  });
}

/** Reveal suave de seções quando entram na tela (uma vez). */
export function revealOnScroll(sel = '[data-reveal]') {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      e.target.dataset.reveal = 'in';
      enter(e.target, { y: 12, dur: 420 });
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of document.querySelectorAll(sel)) io.observe(el);
}
