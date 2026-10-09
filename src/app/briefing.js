// Morning Digest: junta tudo localmente, faz UMA chamada compacta (ou usa o modelo offline) e fala.
import { PROFILE } from '../core/config.js';
import { packText, templateDigest } from '../core/digest.js';
import { digestSystem } from '../core/prompt.js';
import { esc } from '../core/text.js';
import { dayKey, hhmm } from '../core/time.js';
import { refreshAgenda, todayEvents } from './agenda.js';
import { callAI } from './brain.js';
import { emit } from './bus.js';
import { icon } from './icons.js';
import { bucket, mail, refreshMail } from './mail.js';
import { refreshNews, topHeadlines } from './newsfeed.js';
import { tel } from './obs.js';
import { accounts, brainStore, calendars, getKey, settings, TZ } from './state.js';
import { store } from './store.js';
import { track } from './ui.js';
import { emptyState } from './views.js';
import { refreshWeather, weather, weatherCompact, weatherSpoken } from './weather.js';

export const digest = { running: false, step: 0, steps: 5, text: '', via: '', at: 0 };

export const digestDue = () => settings.value.digest.auto && store.raw('jarvis_last_digest') !== dayKey(Date.now(), TZ);

function pack() {
  const actions = bucket('acao');
  return {
    now: Date.now(), tz: TZ, size: settings.value.digest.size, weatherOn: settings.value.digest.weather,
    weather: weather.data ? { label: weather.data.label, compact: weatherCompact(), spoken: weatherSpoken() } : null,
    hasCal: calendars().some((c) => c.url), events: todayEvents(),
    hasMail: accounts().some((a) => a.email && a.senha),
    recent: mail.items.filter((m) => Date.now() - (Date.parse(m.data) || 0) < 86400000).length,
    unread: mail.items.filter((m) => !m.lido).length,
    actions,
    heads: settings.value.newsTopics.map((t) => ({ t: t.label, h: topHeadlines(t.id, 3).map((i) => i.title) })).filter((x) => x.h.length),
    goals: brainStore.notes.filter((n) => n.area === 'metas' || PROFILE.goalNotes.includes(n.id)).slice(0, 2).map((n) => `${n.title}: ${n.body}`)
  };
}

/** Gera o briefing. Devolve o texto (quem chama decide se fala). */
export async function runDigest(trigger) {
  if (digest.running) return '';
  digest.running = true;
  digest.step = 0;
  emit('focus', 'digest');
  emit('data', 'digest');
  const stepDone = () => { digest.step++; emit('digest-step', digest.step); };
  try {
    return await tel.span('digest.gerar', { 'digest.gatilho': trigger }, async (sp) => {
      // 1–4: dados (em paralelo, com teto de 12 s) · cada etapa avança a barra de progresso
      const jobs = [
        refreshAgenda(false), refreshMail(false), refreshNews(false),
        settings.value.digest.weather ? refreshWeather(false) : Promise.resolve()
      ].map((p) => Promise.resolve(p).finally(stepDone));
      await track(Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 12000))]));
      const k = pack(), today = dayKey(Date.now(), TZ), cache = store.get('jarvis_digest_cache', {});
      let text = '', via = 'modo offline';
      if (settings.value.economy && cache.date === today && cache.text && trigger !== 'regen') {
        text = cache.text;
        via = `${cache.via} · cache`;
      } else if (getKey()) {
        try {
          text = (await callAI({ system: digestSystem(k.size), messages: [{ role: 'user', content: packText(k) }], maxTokens: k.size === 'medio' ? 800 : 500, purpose: 'digest' }))
            .replace(/\[\[SAVE:[^\]]*\]\]/g, '').trim();
          via = 'IA';
        } catch (e) {
          tel.error(e, { tags: { area: 'digest' } });
        }
      }
      if (!text) { text = templateDigest(k); via = 'modo offline'; }
      if (!via.includes('cache')) store.set('jarvis_digest_cache', { date: today, text, via });
      store.setRaw('jarvis_last_digest', today);
      stepDone();
      sp.set('digest.via', via);
      Object.assign(digest, { text, via, at: Date.now() });
      return text;
    });
  } finally {
    digest.running = false;
    emit('data', 'digest');
  }
}

export function digestHTML() {
  if (digest.running) {
    const pct = Math.round((digest.step / digest.steps) * 100);
    const labels = ['Agenda', 'E-mails', 'Notícias', 'Clima', 'Redigindo'];
    return `<div class="digest-progress" data-enter role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
      <div class="dp-head"><span>${icon('sparkle')}Preparando seu briefing</span><b>${pct}%</b></div>
      <div class="dp-track"><span style="transform:scaleX(${(digest.step / digest.steps).toFixed(2)})"></span></div>
      <ul class="dp-steps">${labels.map((l, i) => `<li class="${i < digest.step ? 'ok' : i === digest.step ? 'now' : ''}">${i < digest.step ? icon('check') : '<i></i>'}${l}</li>`).join('')}</ul>
    </div>`;
  }
  const c = store.get('jarvis_digest_cache', {});
  const text = digest.text || (c.date === dayKey(Date.now(), TZ) ? c.text : '');
  if (!text) return emptyState('sparkle', 'Seu briefing ainda não foi gerado', 'Diga <b>"Ei Aurora, bom dia"</b> ou toque em <b>Gerar briefing</b>.') + actions(false);
  const via = digest.via || `${c.via} · cache`;
  const k = pack();
  return `<div class="digest" data-enter>
    <div class="chips">${weather.data && k.weatherOn ? `<span class="chip">${icon('sun')}${Math.round(weather.data.temp)}°</span>` : ''}${k.hasCal ? `<span class="chip">${icon('calendar')}${k.events.length} hoje</span>` : ''}${k.hasMail ? `<span class="chip">${icon('bolt')}${k.actions.length} ação</span>` : ''}<span class="chip ${via.startsWith('IA') ? 'violet' : 'warn'}">${esc(via)}</span></div>
    <p class="digest-text">${esc(text)}</p>
    <small class="muted">${digest.at ? `gerado às ${hhmm(digest.at, TZ)}` : 'de hoje'}</small>
  </div>${actions(true)}`;
}
const actions = (has) => `<div class="actions" data-enter>
  <button class="btn primary" data-digest="${has ? 'replay' : 'run'}">${icon('play')}${has ? 'Ouvir de novo' : 'Gerar briefing'}</button>
  ${has ? `<button class="btn" data-digest="regen">${icon('refresh')}Gerar novamente</button>` : ''}
</div>`;

export const lastDigestText = () => digest.text || store.get('jarvis_digest_cache', {}).text || '';
