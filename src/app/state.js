// Estado compartilhado do app.
import { CONFIG, DEFAULT_ACCOUNTS, MODELS, mergeSettings, NOTES } from '../core/config.js';
import { emit } from './bus.js';
import { store } from './store.js';

export const VERSION = '6.0.0';
// Servido pela própria antena (local em :4242 ou hospedado) → mesma origem; aberto com dois cliques → antena local.
export const ANTENNA = /^https?:$/.test(location.protocol) ? location.origin : 'http://127.0.0.1:4242';
export const TZ = CONFIG.tz;

CONFIG.model = MODELS[store.raw('jarvis_model')] ? store.raw('jarvis_model') : CONFIG.model;

export const settings = { value: mergeSettings(store.get('jarvis_settings', {})) };
export function saveSettings(v) {
  settings.value = mergeSettings(v);
  store.set('jarvis_settings', settings.value);
  emit('settings', settings.value);
}

export const session = {
  state: 'idle', busy: false, speaking: false, wantListen: false, recRunning: false,
  micDenied: false, awakeUntil: 0, ignoreUntil: 0, history: [], activated: false
};
export function setState(st) {
  session.state = st;
  document.body.dataset.state = st;
  emit('state', st);
}

export const net = { antenna: null, exporters: {} };

export const brainStore = { notes: loadNotes() };
function loadNotes() {
  const saved = store.get('jarvis_notes', null);
  if (Array.isArray(saved) && saved.length) return saved;
  const fresh = NOTES.map((n) => ({ ...n }));
  store.set('jarvis_notes', fresh);
  return fresh;
}
export function setNotes(list, touched = []) {
  brainStore.notes = list;
  store.set('jarvis_notes', list);
  emit('notes', touched);
}
export function reloadNotes() {
  const saved = store.get('jarvis_notes', null);
  if (Array.isArray(saved) && saved.length) setNotes(saved);
}

export const getKey = () => store.raw('openai_key').trim();
export const setKey = (k) => { store.setRaw('openai_key', String(k).trim()); emit('key'); };
export const accounts = () => store.get('jarvis_emails', DEFAULT_ACCOUNTS);
export const calendars = () => store.get('jarvis_calendars', []);

/** Movimento reduzido: preferência do sistema OU "animações ambientes" desligadas no ⚙. */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ambientOn = () => !reducedMotion() && settings.value.ambientMotion;
