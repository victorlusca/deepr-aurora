// Aurora · orquestração: boot → ativação → app, roteador de comandos, voz e loop de animação.
import { hasWakeWord, matchCommand, stripWakeWord } from '../core/commands.js';
import { CONFIG, PROFILE } from '../core/config.js';
import { buildContext } from '../core/prompt.js';
import { cap, esc } from '../core/text.js';
import { dateLong, hhmm, MONTHS, WD_SHORT, zParts } from '../core/time.js';
import { agendaCompact, refreshAgenda, tickCountdowns, voiceNext, voiceToday, voiceWeek } from './agenda.js';
import { checkAntenna } from './antenna.js';
import { addContext, addQuestionContext, askAI, modelLabel, usageToday } from './brain.js';
import { digestDue, lastDigestText, runDigest } from './briefing.js';
import { emit, on } from './bus.js';
import { checkDocs, docs, docsContext } from './docs.js';
import { initGraph, tickGraph } from './graph.js';
import { icon, weatherIcon } from './icons.js';
import { bucket, refreshMail, voiceImportant, voiceRefreshMail, voiceSummary } from './mail.js';
import { enter } from './motion.js';
import { refreshNews, voiceAllNews, voiceRefreshNews, voiceTopicNews } from './newsfeed.js';
import { initNotes } from './notes.js';
import { installObservability, tel } from './obs.js';
import { createOrb } from './orb.js';
import { initSettings, openSettings } from './settings.js';
import { initSheet, paintGlances } from './sheet.js';
import { accounts, getKey, net, session, setKey, setState, settings, setupDone, TZ, VERSION } from './state.js';
import { $, bindModals, revealOnScroll, toast } from './ui.js';
import * as voice from './voice.js';
import { refreshWeather, voiceWeather, weather, weatherDesc } from './weather.js';

const A = CONFIG.address;
const FOLLOWUP_MS = 8000;
const bootSpan = tel.startSpan('app.boot', { 'app.version': VERSION });

/* ── conversa ── */
function showBubble(who, text, typing = false) {
  const el = $(who === 'you' ? 'bubbleYou' : 'bubbleAi');
  const p = el.querySelector('p');
  el.hidden = false;
  el.classList.toggle('typing', typing);
  p.innerHTML = typing ? '<span class="dots" aria-label="Pensando"><i></i><i></i><i></i></span>' : esc(text);
  if (!typing) enter(el, { y: 6, dur: 260, blur: 3 });
}
async function respond(text) {
  showBubble('ai', text);
  await voice.speak(text);
}

/* ── ocupado: pausa o microfone durante pensar + falar (ela nunca se ouve) ── */
async function withBusy(fn) {
  session.busy = true;
  voice.pauseRec();
  try {
    return await fn();
  } catch (e) {
    tel.error(e, { tags: { area: 'comando' } });
  } finally {
    session.busy = false;
    session.awakeUntil = Date.now() + FOLLOWUP_MS;
    setState(session.wantListen && !session.micDenied ? 'listening' : 'idle');
    voice.resumeRec();
  }
}

/* ── comandos locais (sem API) ── */
const LOCAL = {
  digest: async () => {
    if (!settings.value.digest.voice) return null;
    const t = await runDigest('voz');
    if (t && settings.value.digest.speak) await respond(t);
    return null;
  },
  'mail.refresh': voiceRefreshMail,
  'news.refresh': voiceRefreshNews,
  'agenda.next': voiceNext,
  'agenda.week': voiceWeek,
  'agenda.today': voiceToday,
  'mail.important': voiceImportant,
  'mail.summary': voiceSummary,
  'news.topic': (arg) => voiceTopicNews(arg),
  'news.all': voiceAllNews,
  weather: voiceWeather,
  time: async () => {
    const p = zParts(Date.now(), TZ);
    return `São ${p.h} horas e ${p.mi} minutos de ${dateLong(Date.now(), TZ)}, ${A}.`;
  }
};

/** Roteador central: tenta resolver localmente; se não for comando, vai para a IA (com contexto). */
async function handleCommand(text) {
  const t = String(text || '').trim();
  if (!t) return;
  showBubble('you', t);
  const local = matchCommand(t);
  return withBusy(async () => {
    setState('thinking');
    showBubble('ai', '', true);
    if (local) {
      tel.log('info', 'comando local', { 'comando.id': local.id });
      const out = await LOCAL[local.id](local.arg);
      if (out) await respond(out);
      else if ($('bubbleAi').classList.contains('typing')) showBubble('ai', lastDigestText() || 'Feito.');
      return;
    }
    await respond(await askAI(t));
  });
}

/* contexto do dia injetado no prompt de toda conversa (compacto) */
addContext(() => {
  const p = zParts(Date.now(), TZ);
  return buildContext({
    now: `${cap(WD_SHORT[p.wd])} ${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')}/${p.y} ${hhmm(Date.now(), TZ)}`,
    topics: settings.value.newsTopics.map((x) => x.label),
    agenda: agendaCompact(),
    actionCount: accounts().some((a) => a.email && a.senha) ? bucket('acao').length : null,
    extra: weather.data ? [`Clima: ${Math.round(weather.data.temp)}°C, ${weatherDesc()}.`] : []
  });
});

/* base de conhecimento: trechos relevantes entram no prompt de cada pergunta livre */
addQuestionContext(docsContext);

/* ── palavra de ativação ── */
function onHeard(raw) {
  const awake = Date.now() < session.awakeUntil;
  const wake = hasWakeWord(raw);
  if (!awake && !wake) { setHint(`Ignorado (sem "Ei Aurora"): “${raw.slice(0, 60)}”`); return; }
  const cmd = wake ? stripWakeWord(raw) : raw.trim();
  if (!cmd) {
    session.awakeUntil = Date.now() + 12000;
    voice.chime();
    setState('listening');
    showBubble('ai', `Pois não, ${A}?`);
    return;
  }
  session.awakeUntil = 0;
  handleCommand(cmd);
}

/* ── interface: estado, microfone, cabeçalho ── */
const STATE_TEXT = {
  idle: () => 'Em espera',
  listening: () => (Date.now() < session.awakeUntil ? 'Ouvindo — pode falar' : 'Diga "Ei Aurora"'),
  thinking: () => 'Pensando…',
  speaking: () => 'Falando'
};
function paintState() {
  $('stateText').textContent = STATE_TEXT[session.state]?.() || '';
  $('btnMic').setAttribute('aria-pressed', String(session.wantListen && !session.micDenied));
  $('btnMic').dataset.state = session.micDenied ? 'denied' : session.wantListen ? 'on' : 'off';
  $('btnSend').dataset.mode = session.speaking ? 'stop' : 'send';
  $('btnSend').setAttribute('aria-label', session.speaking ? 'Interromper a fala' : 'Enviar');
}
let hintT = 0;
function setHint(text, warn = false) {
  const h = $('hint');
  h.textContent = text;
  h.classList.toggle('warn', warn);
  clearTimeout(hintT);
  if (!warn) hintT = setTimeout(() => { h.textContent = ''; }, 5000);
}
function toggleMic(force) {
  if (!voice.sttSupported) { setHint('Este navegador não tem reconhecimento de voz. Use Chrome ou Edge — o campo de texto continua funcionando.', true); return; }
  voice.initRecognition();
  session.wantListen = force === undefined ? !session.wantListen : force;
  if (session.wantListen) {
    session.micDenied = false;
    session.awakeUntil = Date.now() + 15000;
    voice.chime();
    voice.startRec();
  } else voice.pauseRec();
  if (!session.busy) setState(session.wantListen ? 'listening' : 'idle');
  paintState();
}

function paintHeader() {
  const now = Date.now(), p = zParts(now, TZ);
  $('clock').innerHTML = `${icon('clock')}<b>${hhmm(now, TZ)}</b><span>${WD_SHORT[p.wd].toLowerCase()}, ${p.d} ${MONTHS[p.mo - 1].slice(0, 3)}</span>`;
  const d = weather.data;
  $('wx').innerHTML = d ? `${icon(weatherIcon(d.code))}<b>${Math.round(d.temp)}°</b><span>${esc(String(d.label).split('·')[0].trim())}</span>` : `${icon('cloud')}<span>clima…</span>`;
  if (d) $('wx').title = `${weatherDesc()} · máx ${Math.round(d.max)}° mín ${Math.round(d.min)}° · chuva ${d.rain}%`;
  const ant = $('antPill');
  ant.dataset.on = net.antenna ? '1' : net.antenna === false ? '0' : '';
  ant.querySelector('span').textContent = net.antenna ? 'Antena online' : net.antenna === false ? 'Antena offline' : 'Antena…';
  ant.title = net.antenna ? 'server.js rodando' : 'Rode: node server.js';
  $('keyDot').dataset.on = getKey() ? '1' : '';
  const u = usageToday();
  $('footDocs').textContent = docs.status?.available ? `${PROFILE.docs.label}: ${docs.status.files} notas` : `${PROFILE.docs.label}: offline`;
  $('footUsage').textContent = `${modelLabel()} · hoje US$ ${(u.cost || 0).toFixed(4).replace('.', ',')} · ${u.calls || 0} chamadas`;
}

/* ── ativação: o clique é o gesto que libera áudio e microfone ── */
async function activate() {
  if (session.activated) return;
  session.activated = true;
  document.body.dataset.screen = 'app';
  bootSpan.end('ok');
  const first = !setupDone();
  const greet = first ? 'Olá. Eu sou a Aurora, e esta versão de mim é só sua. Vamos criar a minha personalidade.' : `Sistemas online. Estou ouvindo, ${A}.`;
  showBubble('ai', greet);
  voice.openMicMeter();
  session.wantListen = voice.sttSupported;
  voice.initRecognition();
  session.busy = true;
  await voice.speak(greet);
  session.busy = false;
  session.awakeUntil = Date.now() + 15000;
  setState(session.wantListen ? 'listening' : 'idle');
  voice.startRec();
  paintState();
  if (first) { openSettings('personalidade'); return; }
  if (digestDue()) {
    await withBusy(async () => {
      const t = await runDigest('auto');
      if (t && settings.value.digest.speak) await respond(t);
    });
  }
}

/* ── eventos ── */
function bind() {
  $('apiKey').value = getKey();
  $('apiKey').addEventListener('input', (e) => { setKey(e.target.value); paintHeader(); });
  $('btnSettings').addEventListener('click', () => openSettings());
  $('antPill').addEventListener('click', () => openSettings('telemetria'));
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (session.speaking) { voice.stopSpeaking(); return; }
    const v = $('textInput').value.trim();
    if (!v || session.busy) return;
    $('textInput').value = '';
    handleCommand(v);
  });
  $('btnMic').addEventListener('click', () => toggleMic());
  $('orbHit').addEventListener('click', () => {
    if (!session.wantListen || session.micDenied) toggleMic(true);
    else { session.awakeUntil = Date.now() + 15000; voice.chime(); setState('listening'); showBubble('ai', `Pois não, ${A}?`); }
  });
  $('footDiag').addEventListener('click', () => openSettings('diagnostico'));
  $('graphReload').addEventListener('click', () => emit('notes', []));
  $('btnActivate').addEventListener('click', activate);
  on('state', paintState);
  on('mic', (why) => {
    if (why === 'denied') {
      setHint('Permissão do microfone negada. Clique no cadeado da barra de endereço → Microfone → Permitir, e recarregue. O campo de texto continua funcionando.', true);
      if (!session.busy) respond(`${cap(A)}, o acesso ao microfone foi negado. Libere a permissão no navegador.`);
    } else if (why === 'network') setHint('Falha de rede no reconhecimento de voz. Tentando de novo…', true);
    else if (why === 'nomic') setHint('Nenhum microfone encontrado.', true);
    paintState();
  });
  on('voice', (v) => { $('footVoice').textContent = v ? v.name.replace(/Microsoft |Google |Online \(Natural\)| - Portuguese \(Brazil\)/g, '').trim() : 'voz padrão'; });
  on('antenna', (onl) => { paintHeader(); checkDocs(); if (onl) { refreshAgenda(true); refreshMail(true); refreshNews(true); } });
  on('docs', paintHeader);
  on('weather', paintHeader);
  on('usage', paintHeader);
  on('key', paintHeader);
  on('digest-action', async (a) => {
    if (session.busy) return;
    if (a === 'replay') withBusy(() => respond(lastDigestText()));
    else withBusy(async () => {
      const t = await runDigest(a === 'regen' ? 'regen' : 'botao');
      if (t && settings.value.digest.speak) await respond(t);
    });
  });
  on('settings-saved', () => { paintAmbient(); refreshAgenda(true); refreshMail(true); refreshNews(true); refreshWeather(true); paintHeader(); setupTimers(); });
}

let timers = [];
function setupTimers() {
  for (const t of timers) clearInterval(t);
  const s = settings.value;
  timers = [
    setInterval(paintHeader, 15000),
    setInterval(() => { tickCountdowns(); paintGlances(); }, 30000),
    setInterval(() => refreshAgenda(true), s.agendaEvery * 60000),
    setInterval(() => refreshMail(true), s.emailEvery * 60000),
    setInterval(() => refreshNews(false), 5 * 60000),
    setInterval(() => refreshWeather(false), 10 * 60000),
    setInterval(() => checkAntenna(true), 30000)
  ];
}

/* ── loop de animação único (orbe + grafo); pausa sozinho com a aba oculta ── */
function startLoop() {
  const orb = createOrb($('orb'));
  if (!orb.webgl) tel.log('warn', 'WebGL indisponível — orbe em Canvas 2D');
  let last = performance.now();
  const loop = (ts) => {
    const dt = Math.min(0.05, Math.max(0.001, (ts - last) / 1000));
    last = ts;
    try { orb.frame(dt); tickGraph(dt); } catch (e) { tel.error(e, { tags: { area: 'render' } }); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const paintAmbient = () => { document.body.dataset.ambient = settings.value.ambientMotion ? 'on' : 'off'; };

function init() {
  installObservability();
  paintAmbient();
  voice.setHeardHandler(onHeard);
  if (window.speechSynthesis) { voice.pickVoice(); speechSynthesis.onvoiceschanged = voice.pickVoice; }
  bindModals();
  bind();
  initSheet();
  initSettings();
  initNotes();
  initGraph();
  revealOnScroll();
  paintHeader();
  paintState();
  setState('idle');
  setupTimers();
  // lazy: o orbe (WebGL) só liga quando o navegador estiver ocioso
  (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(startLoop);
  checkAntenna(true).then(() => { checkDocs(); paintHeader(); refreshAgenda(true); refreshMail(false); refreshNews(false); });
  refreshWeather(false);
  // TELA 1 (boot) → TELA 2 (ativação) após ~2,2 s
  setTimeout(() => { if (!session.activated) document.body.dataset.screen = 'activate'; }, 2200);
  if (!getKey()) setTimeout(() => toast('Cole sua chave da OpenAI no campo do topo para ativar o cérebro.', { ms: 6000 }), 4000);
}

init();
