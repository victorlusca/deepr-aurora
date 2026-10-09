// Movimento (skill design-motion-principles · Jakub primário, Emil secundário):
// entrada = opacidade + translateY + blur, saída mais sutil, curvas próprias, nada de scale(0),
// só transform/opacity/filter, e tudo respeita prefers-reduced-motion.
import { reducedMotion } from './state.js';

export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)';

/** Entrada: materializa (blur → nítido). */
export function enter(el, { delay = 0, y = 8, dur = 320, blur = 4 } = {}) {
  if (!el?.animate || reducedMotion()) return null;
  return el.animate(
    [{ opacity: 0, transform: `translateY(${y}px)`, filter: `blur(${blur}px)` }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
    { duration: dur, delay, easing: EASE_OUT, fill: 'backwards' }
  );
}

/** Saída: mais curta e discreta que a entrada. Resolve quando termina. */
export function exit(el, { dur = 180, y = -4 } = {}) {
  if (!el?.animate || reducedMotion()) return Promise.resolve();
  const a = el.animate(
    [{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: `translateY(${y}px) scale(0.98)`, filter: 'blur(3px)' }],
    { duration: dur, easing: EASE_IN, fill: 'forwards' }
  );
  return a.finished.catch(() => {});
}

/** Entrada em cascata dos filhos marcados com [data-enter] (ou dos filhos diretos). Máx. 10 itens animados. */
export function staggerIn(root, { step = 35, y = 6, dur = 280 } = {}) {
  const marked = root.querySelectorAll('[data-enter]');
  const items = Array.from(marked.length ? marked : root.children);
  items.forEach((el, i) => { if (i < 10) enter(el, { delay: i * step, y, dur }); });
}

/**
 * Troca o conteúdo de um contêiner.
 * animate=true (ação do usuário): sai o antigo, entra o novo em cascata.
 * animate=false (atualização em segundo plano): troca direto, e só se mudou.
 */
export async function swap(root, html, { animate = true } = {}) {
  if (root.dataset.html === html) return;
  root.dataset.html = html;
  if (animate && root.childElementCount && !reducedMotion()) {
    await root.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(2px)' }], { duration: 120, easing: EASE_IN }).finished.catch(() => {});
  }
  root.innerHTML = html;
  if (animate) staggerIn(root);
}

/** Remove um elemento com a saída animada (ex.: e-mail marcado como resolvido). */
export async function removeAnimated(el) {
  await exit(el, { dur: 200, y: 0 });
  el.remove();
}

/** Esqueleto de carregamento (lista). */
export function skeleton(rows = 4) {
  let h = '<div class="sk-list" role="status" aria-label="Carregando">';
  for (let i = 0; i < rows; i++) {
    h += `<div class="sk-row"><span class="sk sk-dot"></span><span class="sk-col"><span class="sk sk-line" style="--w:${78 - i * 9}%"></span><span class="sk sk-line sm" style="--w:${42 + (i % 2) * 22}%"></span></span></div>`;
  }
  return `${h}</div>`;
}
