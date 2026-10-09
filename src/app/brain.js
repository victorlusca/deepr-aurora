// Cérebro: OpenAI (Responses API) + memória viva + custo do dia.
import { AREA, CONFIG, MODELS } from '../core/config.js';
import { applySaves, extractSaves } from '../core/memory.js';
import { buildRequest, costOf, errorSpeech, extractText, OPENAI_URL } from '../core/openai.js';
import { buildSystemPrompt } from '../core/prompt.js';
import { emit } from './bus.js';
import { tel } from './obs.js';
import { brainStore, getKey, session, setNotes } from './state.js';
import { store } from './store.js';

/* contexto extra no prompt (agenda, e-mails…) — os módulos da Parte 2 registram aqui */
const contextProviders = [];
export const addContext = (fn) => contextProviders.push(fn);
/* contexto que depende da pergunta (ex.: trechos da base de conhecimento) — com teto de 3 s */
const askProviders = [];
export const addQuestionContext = (fn) => askProviders.push(fn);
async function questionContext(text) {
  const timeout = new Promise((r) => setTimeout(() => r([]), 3000));
  const parts = await Promise.race([Promise.all(askProviders.map((f) => Promise.resolve(f(text)).catch(() => ''))), timeout]);
  return parts.filter(Boolean).join('\n\n');
}
export function systemPrompt() {
  const base = buildSystemPrompt(brainStore.notes);
  const extra = contextProviders.map((f) => f()).filter(Boolean);
  return extra.length ? `${base}\n\n${extra.join('\n')}` : base;
}

function trackUsage(usage) {
  if (!usage) return;
  const today = new Date().toISOString().slice(0, 10);
  const st = store.get('jarvis_usage', {});
  const cur = st.date === today ? st : { date: today, in: 0, out: 0, calls: 0, cost: 0 };
  cur.in += usage.input_tokens || 0;
  cur.out += usage.output_tokens || 0;
  cur.calls++;
  cur.cost += costOf(CONFIG.model, usage);
  store.set('jarvis_usage', cur);
  emit('usage', cur);
}
export const usageToday = () => {
  const u = store.get('jarvis_usage', {});
  return u.date === new Date().toISOString().slice(0, 10) ? u : { cost: 0, calls: 0 };
};

/** Chamada única à OpenAI. Lança {kind:'http', status} ou erro de rede. */
export async function callAI({ system, messages, maxTokens, purpose }) {
  return tel.span('llm.request', { 'gen_ai.system': 'openai', 'gen_ai.request.model': CONFIG.model, 'aurora.purpose': purpose }, async (sp) => {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildRequest({ model: CONFIG.model, system, messages, maxTokens }))
    });
    sp.set('http.status_code', res.status);
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error?.message || ''; } catch { /* sem corpo */ }
      throw Object.assign(new Error(msg || `HTTP ${res.status}`), { kind: 'http', status: res.status });
    }
    const data = await res.json();
    sp.set('gen_ai.usage.input_tokens', data.usage?.input_tokens || 0);
    sp.set('gen_ai.usage.output_tokens', data.usage?.output_tokens || 0);
    trackUsage(data.usage);
    return extractText(data);
  });
}

const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Aplica [[SAVE:...]] e devolve o texto limpo (sem a linha de memória). */
export function applyMemory(text) {
  const { text: clean, saves } = extractSaves(text, AREA);
  if (saves.length) {
    const { notes, touched } = applySaves(brainStore.notes, saves, newId);
    setNotes(notes, touched);
    tel.log('info', 'memória atualizada', { 'memoria.notas': touched.length });
  }
  return clean;
}

/** Pergunta livre → resposta falável. Erros viram frases faladas. */
export async function askAI(userText) {
  if (!getKey()) return `${CONFIG.address.charAt(0).toUpperCase()}${CONFIG.address.slice(1)}, preciso da sua chave da API da OpenAI. Cole a chave no campo de chave, no topo da tela.`;
  const extra = await questionContext(userText);
  session.history.push({ role: 'user', content: userText });
  while (session.history.length > 16) session.history.splice(0, 2);
  try {
    const system = extra ? `${systemPrompt()}\n\n${extra}` : systemPrompt();
    const raw = await callAI({ system, messages: session.history, maxTokens: 400, purpose: 'conversa' });
    if (!raw) {
      session.history.pop();
      return `Perdão, ${CONFIG.address}, não obtive resposta desta vez. Pode repetir?`;
    }
    const text = applyMemory(raw) || `Anotado, ${CONFIG.address}.`;
    session.history.push({ role: 'assistant', content: text });
    return text;
  } catch (e) {
    session.history.pop();
    tel.error(e, { tags: { area: 'llm' }, extra: { status: e.status || 0, modelo: CONFIG.model } });
    return errorSpeech(e, CONFIG.address);
  }
}

export const modelLabel = () => MODELS[CONFIG.model]?.short || CONFIG.model;
