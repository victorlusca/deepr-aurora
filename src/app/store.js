// localStorage com try/catch (modo privado, armazenamento bloqueado, etc.).
export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ }
  },
  raw(k) {
    try { return localStorage.getItem(k) || ''; } catch { return ''; }
  },
  setRaw(k, v) {
    try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ }
  }
};
