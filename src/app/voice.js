// Voz: síntese (TTS) com sincronia por visemas + reconhecimento contínuo (STT) com palavra de ativação.
import { CONFIG } from '../core/config.js';
import { cleanForSpeech, splitChunks } from '../core/text.js';
import { buildTimeline, sampleTimeline, VISEME, wordTimeAt } from '../core/visemes.js';
import { emit } from './bus.js';
import { tel } from './obs.js';
import { session, setState } from './state.js';
import { store } from './store.js';

/* ── vozes ── */
let VOICE = null;
export function listPtVoices() {
  const vs = window.speechSynthesis?.getVoices() || [];
  const pt = vs.filter((v) => /^pt[-_]BR/i.test(v.lang) || /brasil|brazil/i.test(v.name));
  return pt.length ? pt : vs.filter((v) => /^pt/i.test(v.lang));
}
export function pickVoice() {
  const pool = listPtVoices();
  if (!pool.length) return;
  const chosen = store.raw('jarvis_voice');
  const fixed = chosen && pool.find((v) => v.name === chosen);
  if (fixed) VOICE = fixed;
  else {
    const fem = /(francisca|thalita|maria|luciana|vit[oó]ria|leila|yara|camila|brenda|elza|giovanna|leticia|manuela|fernanda|female|feminin|google portugu[eê]s do brasil)/i;
    const masc = /(antonio|ant[oô]nio|daniel|donato|fabio|humberto|julio|nicolau|valerio|male\b|masculin)/i;
    const wantFem = CONFIG.voiceGender === 'feminina';
    const score = (v) => (fem.test(v.name) ? (wantFem ? 50 : -40) : 0) + (masc.test(v.name) ? (wantFem ? -60 : 50) : 0)
      + (/natural|neural|online/i.test(v.name) ? 20 : 0) + (v.localService ? 8 : 0) + (/microsoft/i.test(v.name) ? 6 : 0);
    VOICE = pool.slice().sort((a, b) => score(b) - score(a))[0];
  }
  emit('voice', VOICE);
}

/* ── sincronia: linha do tempo de visemas ancorada nos eventos de palavra ── */
const cpsStore = store.get('jarvis_tts_cps', {});
const cpsFor = () => cpsStore[VOICE ? VOICE.name : '_'] || 14;
let tl = null;
const now = () => performance.now() / 1000;
function lipBegin(text) { tl = buildTimeline(text, cpsFor()); tl.anchor = now(); tl.seen = false; }
function lipBoundary(ci) {
  if (!tl) return;
  const t = wordTimeAt(tl, ci);
  if (t != null) { tl.seen = true; tl.anchor = now() - t; }
}
function lipEnd(actual) {
  if (tl && actual > 0.6 && !tl.seen && tl.total > 0.6) {
    const ratio = Math.min(2, Math.max(0.5, tl.total / actual));
    cpsStore[VOICE ? VOICE.name : '_'] = Math.min(24, Math.max(8, cpsFor() * (0.65 + 0.35 * ratio)));
    store.set('jarvis_tts_cps', cpsStore);
  }
  tl = null;
}
/** Forma atual da boca → [jaw, wide, close, ftooth]. O orbe lê isso a cada quadro. */
export const mouth = () => (tl ? sampleTimeline(tl, now() - tl.anchor) : VISEME.R);

/* ── TTS ── */
let seq = 0, pendingResolve = null;
const keep = [];
export function speak(raw) {
  const text = cleanForSpeech(raw);
  if (!text) return Promise.resolve();
  return new Promise((resolve) => {
    const my = ++seq;
    if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(); }
    pendingResolve = resolve;
    session.speaking = true;
    setState('speaking');
    const sp = tel.startSpan('voz.falar', { 'tts.caracteres': text.length, 'tts.voz': VOICE?.name || 'padrão' });
    const finish = () => {
      if (my !== seq) return;
      session.speaking = false;
      lipEnd(0);
      sp.end('ok');
      if (pendingResolve === resolve) pendingResolve = null;
      resolve();
    };
    const synth = window.speechSynthesis;
    if (!synth) { lipBegin(text); setTimeout(finish, buildTimeline(text, cpsFor()).total * 1000 + 200); return; }
    try { synth.cancel(); synth.resume(); } catch { /* ignore */ }
    const chunks = splitChunks(text);
    let i = 0;
    const next = () => {
      if (my !== seq) return;
      if (i >= chunks.length) { finish(); return; }
      const chunk = chunks[i++];
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = 'pt-BR';
      if (VOICE) u.voice = VOICE;
      u.rate = 1.02; u.pitch = 1.04;
      let started = 0, ended = false, wd = 0;
      const done = () => {
        if (ended) return;
        ended = true;
        clearTimeout(wd);
        lipEnd(started ? (performance.now() - started) / 1000 : 0);
        next();
      };
      const guard = () => {
        wd = setTimeout(() => { if (synth.speaking && started) guard(); else done(); }, (buildTimeline(chunk, cpsFor()).total * 2 + 4) * 1000);
      };
      u.onstart = () => { started = performance.now(); lipBegin(chunk); };
      u.onboundary = (e) => { if (!e.name || e.name === 'word') lipBoundary(e.charIndex); };
      u.onend = done;
      u.onerror = done;
      keep.push(u);
      if (keep.length > 10) keep.shift();
      guard();
      synth.speak(u);
    };
    next();
  });
}
export function stopSpeaking() {
  seq++;
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  lipEnd(0);
  session.speaking = false;
  if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(); }
}

/* ── chime curto de "pois não" (sem TTS) ── */
let ac = null;
export function chime() {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = 'sine';
    o.frequency.setValueAtTime(740, t);
    o.frequency.exponentialRampToValueAtTime(1180, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 0.26);
  } catch { /* sem áudio */ }
}

/* ── nível do microfone (o orbe reage enquanto você fala) ── */
let analyser = null, buf = null;
export async function openMicMeter() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    buf = new Uint8Array(analyser.fftSize);
    ac.createMediaStreamSource(stream).connect(analyser);
    return true;
  } catch {
    return false;
  }
}
export function micLevel() {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.min(1, Math.sqrt(s / buf.length) * 4);
}

/* ── STT: escuta contínua e robusta ── */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;
let rec = null, onHeard = () => {};
export const setHeardHandler = (fn) => { onHeard = fn; };

export function initRecognition() {
  if (rec || !SR) return;
  rec = new SR();
  rec.lang = 'pt-BR';
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onstart = () => { session.recRunning = true; emit('mic'); };
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      if (session.busy || session.speaking || performance.now() < session.ignoreUntil) continue; // nunca se ouve falando
      onHeard(e.results[i][0].transcript);
    }
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      session.micDenied = true;
      session.wantListen = false;
      tel.log('warn', 'microfone negado');
      emit('mic', 'denied');
    } else if (e.error === 'network') emit('mic', 'network');
    else if (e.error === 'audio-capture') emit('mic', 'nomic');
  };
  rec.onend = () => {
    session.recRunning = false;
    emit('mic');
    if (session.wantListen && !session.busy && !session.micDenied) setTimeout(startRec, 250);
  };
}
export function startRec() {
  if (!rec || session.micDenied || session.busy || session.recRunning || !session.wantListen) return;
  try { rec.start(); } catch { /* already started */ }
}
export function pauseRec() {
  if (rec && session.recRunning) { try { rec.abort(); } catch { /* ignore */ } }
}
export function resumeRec() {
  session.ignoreUntil = performance.now() + 400;
  if (session.wantListen) setTimeout(startRec, 300);
}
