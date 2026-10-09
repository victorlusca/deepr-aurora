// Barramento de eventos mínimo: desacopla os módulos (sem dependências circulares).
const subs = new Map();

export function on(ev, fn) {
  if (!subs.has(ev)) subs.set(ev, new Set());
  subs.get(ev).add(fn);
  return () => subs.get(ev).delete(fn);
}

export function emit(ev, data) {
  for (const fn of subs.get(ev) || []) {
    try { fn(data); } catch (e) { console.error(`[bus:${ev}]`, e); }
  }
}
