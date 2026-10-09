// Configurações (⚙) + Diagnóstico (observabilidade ao vivo).
import { CONFIG, DEFAULT_PERSONA, MODELS, PROFILE, PROVIDERS } from '../core/config.js';
import { esc, norm } from '../core/text.js';
import { hhmm } from '../core/time.js';
import { emit } from './bus.js';
import { checkDocs, docsStatusHTML, resultsHTML, searchDocs } from './docs.js';
import { icon } from './icons.js';
import { swap } from './motion.js';
import { tel } from './obs.js';
import { accounts, brainStore, calendars, net, saveSettings, setNotes, settings, setupDone, TZ } from './state.js';
import { store } from './store.js';
import { $, closeModal, openModal, toast } from './ui.js';
import { listPtVoices, pickVoice } from './voice.js';

const SECTIONS = [
  ['personalidade', 'Personalidade', 'user'], ['cerebro', 'Cérebro', 'bolt'], ['voz', 'Voz e movimento', 'wave'], ['agenda', 'Agenda', 'calendar'], ['emails', 'E-mails', 'mail'],
  ['noticias', 'Notícias', 'news'], ['briefing', 'Briefing', 'sparkle'], ['conhecimento', 'Conhecimento', 'brain'], ['telemetria', 'Telemetria', 'antenna'], ['diagnostico', 'Diagnóstico', 'activity']
];
let section = 'personalidade', unsub = null, personaChanged = false;

const field = (label, input, hint = '') => `<label class="field"><span>${label}</span>${input}${hint ? `<small>${hint}</small>` : ''}</label>`;
const toggle = (id, label, on, hint = '') => `<label class="switch"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span class="track"><span class="thumb"></span></span><span class="switch-text"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span></label>`;
const rowDel = `<button type="button" class="icon-btn sm" data-del aria-label="Remover">${icon('x')}</button>`;

const calRow = (c) => `<div class="list-row" data-row="cal">
  <input data-f="nome" placeholder="Nome (ex.: Pessoal)" value="${esc(c.nome || '')}" class="w-sm">
  <input type="color" data-f="cor" value="${esc(c.cor || '#46f0c4')}" aria-label="Cor">
  <input data-f="url" type="password" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value="${esc(c.url || '')}" class="grow" autocomplete="off">${rowDel}</div>`;
const mailRow = (a) => `<div class="list-row" data-row="mail" data-id="${esc(a.id || `c${Date.now()}`)}">
  <select data-f="provider" aria-label="Provedor">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}"${k === a.provider ? ' selected' : ''}>${v.tag}</option>`).join('')}</select>
  <input data-f="email" type="email" placeholder="${(PROVIDERS[a.provider] || PROVIDERS.gmail).hint}" value="${esc(a.email || '')}" class="grow">
  <input data-f="senha" type="password" placeholder="senha de app" value="${esc(a.senha || '')}" autocomplete="new-password" class="grow">
  <input data-f="apelido" placeholder="Apelido" value="${esc(a.apelido || '')}" class="w-xs">
  <input type="color" data-f="cor" value="${esc(a.cor || '#3ddc84')}" aria-label="Cor">${rowDel}</div>`;
const topicRow = (t) => `<div class="list-row" data-row="topic" data-id="${esc(t.id || `t${Date.now()}`)}">
  <input data-f="label" placeholder="Nome no painel" value="${esc(t.label || '')}" class="w-sm">
  <input data-f="q" placeholder="termo de busca" value="${esc(t.q || '')}" class="grow">
  <input type="hidden" data-f="alias" value="${esc(t.alias || '')}">${rowDel}</div>`;

function sectionHTML(id) {
  const s = settings.value;
  switch (id) {
    case 'personalidade': {
      const me = brainStore.notes.find((n) => n.area === 'meta');
      return `<h3>${setupDone() ? 'Personalidade' : 'Crie a sua Aurora'}</h3>
        <p class="lead">${setupDone() ? 'Quem a Aurora é e como ela fala com você. Fica salvo só neste navegador.' : 'Esta Aurora é sua: nada vem pronto. Defina como ela fala com você; o cérebro começa vazio e ela aprende conversando. Tudo fica só neste navegador.'}</p>
        ${field('Como ela te chama', `<input id="pAddress" maxlength="40" value="${esc(CONFIG.address)}" placeholder="chefe">`)}
        ${field('Seu nome', `<input id="pOwner" maxlength="60" value="${esc(me?.title || '')}" placeholder="como você se chama">`, 'Vira a nota "Você" do Second Brain.')}
        ${field('Personalidade', `<textarea id="pPersona" rows="4" maxlength="600">${esc(CONFIG.persona)}</textarea>`, 'Escreva do seu jeito: tom, humor, formalidade, o que ela deve evitar.')}
        <button type="button" class="btn ghost" id="pReset">Voltar à personalidade sugerida</button>
        ${field('Sua cidade (clima)', `<input id="pCity" maxlength="60" value="${esc(s.digest.city || '')}" placeholder="ex.: Curitiba, PR">`, 'Opcional. Temas de notícias, agenda e e-mails ficam nas outras seções.')}`;
    }
    case 'cerebro':
      return `<h3>Cérebro</h3><p class="lead">A chave da OpenAI fica no campo de chave do topo, salva só neste navegador.</p>
        <div class="choice-grid">${Object.entries(MODELS).map(([k, m]) => `<label class="choice"><input type="radio" name="model" value="${k}"${CONFIG.model === k ? ' checked' : ''}><span><b>${m.label}</b><small>${k}</small><small>US$ ${String(m.price[0]).replace('.', ',')} / ${String(m.price[1]).replace('.', ',')} por 1M tokens</small></span></label>`).join('')}</div>
        ${toggle('setEconomy', 'Modo economia', s.economy, 'Comandos comuns sem API, triagem em lote com cache, briefing 1×/dia, contexto compacto.')}`;
    case 'voz': {
      const vs = listPtVoices(), cur = store.raw('jarvis_voice');
      return `<h3>Voz e movimento</h3>
        ${field('Voz da Aurora', `<select id="setVoice"><option value="">Automática (feminina pt-BR)</option>${vs.map((v) => `<option value="${esc(v.name)}"${cur === v.name ? ' selected' : ''}>${esc(v.name)}${v.localService ? ' · local' : ''}</option>`).join('')}</select>`, 'Vozes da Microsoft (Francisca, Thalita, Maria) avisam cada palavra: a sincronia do orbe fica exata.')}
        ${toggle('setAmbient', 'Animações ambientes', s.ambientMotion, 'Orbe em movimento contínuo, pulsos e respiração do grafo. Desligue para uma interface parada (a preferência "reduzir movimento" do sistema também é respeitada).')}`;
    }
    case 'agenda':
      return `<h3>Agenda · Google Agenda (iCal)</h3>
        <ol class="steps"><li>Abra o Google Agenda <b>no computador</b> → ⚙ Configurações.</li><li>Clique na agenda na lista à esquerda → <b>Integrar agenda</b>.</li><li>Copie o <b>Endereço secreto em formato iCal</b> e cole abaixo.</li></ol>
        <p class="callout">${icon('key')}Este link dá acesso de leitura à sua agenda. Ele fica salvo só no seu navegador e nunca é enviado para a IA.</p>
        <div id="calList">${calendars().map(calRow).join('')}</div><button type="button" class="btn ghost" data-add="cal">${icon('plus')}Adicionar agenda</button>`;
    case 'emails':
      return `<h3>E-mails · IMAP (somente leitura)</h3>
        <ol class="steps"><li><b>Primeiro</b> ative a verificação em 2 etapas em myaccount.google.com/security.</li><li><b>Depois</b> abra myaccount.google.com/apppasswords, crie um app chamado "Jarvis" e copie a senha de 16 letras.</li><li>Cole aqui — <b>não</b> é a sua senha normal do Gmail.</li></ol>
        <p class="muted">Outlook: senha de app em account.microsoft.com/security (se recusar, encaminhe para o Gmail). ${esc(PROFILE.customDomain.hint)}</p>
        <p class="callout">${icon('key')}Sua senha de app fica salva só no seu navegador e viaja apenas até a antena local e o seu provedor. Para a triagem, remetente, assunto e um trecho do e-mail são enviados à API da OpenAI. A Aurora só LÊ: nunca envia, responde, apaga ou marca nada.</p>
        <div id="mailList">${accounts().map(mailRow).join('')}</div><button type="button" class="btn ghost" data-add="mail">${icon('plus')}Adicionar conta</button>
        <div class="grid2">${field('E-mails por conta', `<input id="setMailCount" type="number" min="1" max="50" value="${s.emailCount}">`)}${field('Atualizar a cada (min)', `<input id="setMailEvery" type="number" min="5" max="240" value="${s.emailEvery}">`)}</div>`;
    case 'noticias':
      return `<h3>Radar de notícias</h3><p class="lead">Google News · Brasil · português. Nome no painel + termo buscado.</p>
        <div id="topicList">${s.newsTopics.map(topicRow).join('')}</div><button type="button" class="btn ghost" data-add="topic">${icon('plus')}Adicionar assunto</button>
        <div class="grid2">${field('Manchetes por assunto', `<input id="setNewsCount" type="number" min="1" max="10" value="${s.newsCount}">`)}${field('Atualizar a cada (min)', `<input id="setNewsEvery" type="number" min="10" max="240" value="${s.newsEvery}">`)}</div>`;
    case 'briefing':
      return `<h3>Morning Digest</h3>
        ${toggle('dgAuto', 'Automático', s.digest.auto, 'Na primeira ativação do dia.')}
        ${toggle('dgVoice', 'Por voz', s.digest.voice, 'Dizendo "bom dia".')}
        ${toggle('dgSpeak', 'Ler em voz alta', s.digest.speak)}
        ${toggle('dgWeather', 'Previsão do tempo', s.digest.weather, 'Open-Meteo, grátis e sem chave.')}
        <div class="grid2">${field('Tamanho', `<select id="dgSize"><option value="curto"${s.digest.size === 'curto' ? ' selected' : ''}>Curto (~30 s)</option><option value="medio"${s.digest.size === 'medio' ? ' selected' : ''}>Médio (~1 min)</option></select>`)}${field('Cidade do clima', `<input id="dgCity" value="${esc(s.digest.city)}">`)}</div>`;
    case 'telemetria': {
      const ex = net.exporters || {};
      const st = (k, name, how) => `<li class="${ex[k] ? 'ok' : ''}">${icon(ex[k] ? 'check' : 'x')}<b>${name}</b><small>${ex[k] ? 'ativo na antena' : how}</small></li>`;
      return `<h3>Telemetria</h3><p class="lead">Spans e logs no padrão <b>OpenTelemetry</b> e erros no formato do <b>Sentry</b>. O navegador envia para a antena, e a antena repassa para os serviços configurados no arquivo <code>.env</code> dela. As chaves desses serviços nunca ficam no navegador. Antes de sair, tudo passa por uma limpeza: nada de chaves, senhas, links da agenda ou conteúdo de e-mail.</p>
        ${toggle('telExport', 'Exportar pela antena', s.telemetry.export, 'Desligado: a telemetria fica só aqui, na aba Diagnóstico.')}
        <ul class="exporters">${st('otlp', 'OpenTelemetry (OTLP)', 'OTEL_EXPORTER_OTLP_ENDPOINT')}${st('datadog', 'Datadog', 'DD_OTLP_ENDPOINT (Datadog Agent)')}${st('newrelic', 'New Relic', 'NEW_RELIC_LICENSE_KEY')}${st('sentry', 'Sentry', 'SENTRY_DSN')}</ul>
        <p class="muted">${net.antenna ? 'Antena online.' : 'Antena offline — rode node server.js.'} Veja o modelo em <code>.env.example</code>.</p>`;
    }
    case 'conhecimento':
      return `<h3>Conhecimento · ${esc(PROFILE.docs.label)}</h3><p class="lead">A Aurora consulta ${esc(PROFILE.docs.about)} a cada pergunta: só os trechos relevantes entram no prompt, então ela sabe de tudo gastando pouco.</p>
        <div id="docsStatus">${docsStatusHTML()}</div>
        <form class="doc-search" id="docSearch"><input id="docQ" placeholder="Teste a busca: ex. como funciona o login" aria-label="Buscar na documentação"><button class="btn primary" type="submit">${icon('send')}Buscar</button></form>
        <div id="docResults"></div>`;
    case 'diagnostico':
      return diagHTML();
    default:
      return '';
  }
}

function diagHTML() {
  const snap = tel.snapshot();
  const spans = snap.spans.slice(-40).reverse();
  const errs = snap.errors.slice(-8).reverse();
  const avg = (name) => {
    const l = snap.spans.filter((s) => s.name === name);
    return l.length ? Math.round(l.reduce((a, s) => a + (s.end - s.start), 0) / l.length) : null;
  };
  const kpi = (label, v, unit = '') => `<div class="kpi"><small>${label}</small><b>${v ?? '—'}${v != null ? unit : ''}</b></div>`;
  return `<h3>Diagnóstico</h3>
    <div class="kpis">${kpi('Latência IA (média)', avg('llm.request'), ' ms')}${kpi('Proxy antena', avg('antena.proxy'), ' ms')}${kpi('Erros', snap.errors.length)}${kpi('Exportados', snap.stats.exported)}${kpi('Na fila', snap.stats.pending)}</div>
    ${errs.length ? `<h4>Erros recentes</h4><ul class="diag-list">${errs.map((e) => `<li class="err"><b>${esc(e.exception.values[0].type)}</b><span>${esc(e.exception.values[0].value)}</span><time>${hhmm(e.timestamp * 1000, TZ)}</time></li>`).join('')}</ul>` : ''}
    <h4>Spans recentes</h4>
    <ul class="diag-list">${spans.map((s) => `<li class="${s.status === 'error' ? 'err' : ''}"><b>${esc(s.name)}</b><span>${esc(Object.entries(s.attrs).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' · '))}</span><time>${s.end - s.start} ms</time></li>`).join('') || '<li class="muted">Nada registrado ainda.</li>'}</ul>
    <div class="actions"><button type="button" class="btn ghost" id="diagExport">${icon('download')}Baixar diagnóstico (JSON)</button><button type="button" class="btn ghost" id="diagFlush">${icon('refresh')}Enviar agora</button></div>`;
}

function showSection(id, animate = true) {
  section = id;
  for (const b of document.querySelectorAll('[data-sec]')) b.setAttribute('aria-current', b.dataset.sec === id ? 'true' : 'false');
  swap($('setBody'), sectionHTML(id), { animate });
  unsub?.();
  unsub = id === 'diagnostico' ? tel.subscribe(() => { if (section === 'diagnostico') swap($('setBody'), diagHTML(), { animate: false }); }) : null;
}

/** Lê os campos visíveis de volta para as configurações (cada seção salva o que mostra). */
function collect() {
  const s = structuredClone(settings.value);
  const val = (id) => $(id)?.value;
  const chk = (id, fallback) => ($(id) ? $(id).checked : fallback);
  const num = (id, lo, hi, d) => { const v = Number.parseInt(val(id), 10); return Number.isNaN(v) ? d : Math.min(hi, Math.max(lo, v)); };
  const rows = (kind) => Array.from(document.querySelectorAll(`[data-row="${kind}"]`)).map((r) => {
    const o = { id: r.dataset.id };
    for (const i of r.querySelectorAll('[data-f]')) o[i.dataset.f] = i.value.trim();
    return o;
  });
  if ($('pPersona')) {
    const p = { address: val('pAddress').trim() || 'chefe', persona: val('pPersona').trim() || DEFAULT_PERSONA, done: true };
    const old = store.get('aurora_persona', null);
    personaChanged = !old?.done || old.address !== p.address || old.persona !== p.persona;
    store.set('aurora_persona', p);
    s.digest = { ...s.digest, city: val('pCity').trim() };
    const name = val('pOwner').trim(), me = brainStore.notes.find((n) => n.area === 'meta');
    if (name && name !== me?.title) setNotes(me ? brainStore.notes.map((n) => (n === me ? { ...n, title: name } : n)) : [...brainStore.notes, { id: `eu${Date.now()}`, area: 'meta', title: name, body: '' }], [me?.id || '']);
  }
  const model = document.querySelector('input[name="model"]:checked')?.value;
  if (model) { CONFIG.model = model; store.setRaw('jarvis_model', model); }
  s.economy = chk('setEconomy', s.economy);
  s.ambientMotion = chk('setAmbient', s.ambientMotion);
  if ($('setVoice')) { store.setRaw('jarvis_voice', val('setVoice')); pickVoice(); }
  if ($('calList')) store.set('jarvis_calendars', rows('cal').filter((c) => c.url || c.nome).map((c) => ({ nome: c.nome || 'Agenda', cor: c.cor, url: c.url })));
  if ($('mailList')) store.set('jarvis_emails', rows('mail').map((a) => ({ ...a, apelido: a.apelido || PROVIDERS[a.provider].tag })));
  if ($('setMailCount')) { s.emailCount = num('setMailCount', 1, 50, 5); s.emailEvery = num('setMailEvery', 5, 240, 15); }
  if ($('topicList')) {
    const t = rows('topic').filter((x) => x.label && x.q).map((x) => ({ id: x.id, label: x.label, q: x.q, alias: x.alias || norm(x.label) }));
    if (t.length) s.newsTopics = t;
    s.newsCount = num('setNewsCount', 1, 10, 4);
    s.newsEvery = num('setNewsEvery', 10, 240, 30);
  }
  s.digest = { ...s.digest, auto: chk('dgAuto', s.digest.auto), voice: chk('dgVoice', s.digest.voice), speak: chk('dgSpeak', s.digest.speak), weather: chk('dgWeather', s.digest.weather), size: val('dgSize') || s.digest.size, city: ($('dgCity') ? val('dgCity') : s.digest.city).trim() };
  s.telemetry = { ...s.telemetry, export: chk('telExport', s.telemetry.export) };
  return s;
}

export function openSettings(id = 'personalidade') {
  openModal('setModal');
  showSection(id, false);
}

export function initSettings() {
  $('setBody').addEventListener('submit', async (e) => {
    if (e.target.id !== 'docSearch') return;
    e.preventDefault();
    const q = $('docQ').value.trim();
    if (!q) return;
    $('docResults').innerHTML = '<div class="sk-list"><div class="sk-row"><span class="sk-col"><span class="sk sk-line"></span><span class="sk sk-line sm"></span></span></div><div class="sk-row"><span class="sk-col"><span class="sk sk-line"></span><span class="sk sk-line sm"></span></span></div></div>';
    try { swap($('docResults'), resultsHTML(await searchDocs(q, 5))); } catch { $('docResults').innerHTML = '<p class="muted">Antena offline.</p>'; }
  });
  $('setNav').innerHTML = SECTIONS.map(([id, label, ic]) => `<button type="button" data-sec="${id}">${icon(ic)}<span>${label}</span></button>`).join('');
  $('setNav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]');
    if (!b || b.dataset.sec === section) return;
    saveSettings(collect()); // guarda o que foi editado antes de trocar de seção
    showSection(b.dataset.sec);
  });
  $('setBody').addEventListener('click', (e) => {
    if (e.target.closest('#pReset')) { $('pPersona').value = DEFAULT_PERSONA; return; }
    const add = e.target.closest('[data-add]');
    if (add) {
      const host = $({ cal: 'calList', mail: 'mailList', topic: 'topicList' }[add.dataset.add]);
      host.insertAdjacentHTML('beforeend', { cal: calRow({}), mail: mailRow({ provider: 'gmail', cor: '#3ddc84' }), topic: topicRow({}) }[add.dataset.add]);
      host.lastElementChild.querySelector('input')?.focus();
    }
    const del = e.target.closest('[data-del]');
    if (del) del.closest('.list-row').remove();
    if (e.target.closest('#diagExport')) {
      const blob = new Blob([JSON.stringify(tel.snapshot(), null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `aurora-diagnostico-${Date.now()}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
    }
    if (e.target.closest('#docRefresh')) checkDocs().then(() => { $('docsStatus').innerHTML = docsStatusHTML(); });
    if (e.target.closest('#diagFlush')) tel.flush().then((ok) => toast(ok ? 'Telemetria enviada.' : 'Não consegui enviar (antena offline ou sem exportador).'));
  });
  $('setSave').addEventListener('click', () => {
    saveSettings(collect());
    tel.setExport(settings.value.telemetry.export);
    closeModal('setModal');
    toast('Configurações salvas.');
    emit('settings-saved');
    if (personaChanged) setTimeout(() => location.reload(), 700); // a nova personalidade vale em todos os módulos
  });
}
