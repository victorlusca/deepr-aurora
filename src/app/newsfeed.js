// Radar de notícias: um bloco por assunto, cache com validade e voz sem o sufixo " - Fonte".
import { CONFIG } from '../core/config.js';
import { feedUrl, findTopic, isGenericNewsWord, parseRSS } from '../core/news.js';
import { esc } from '../core/text.js';
import { relative } from '../core/time.js';
import { checkAntenna, proxy } from './antenna.js';
import { emit } from './bus.js';
import { icon } from './icons.js';
import { skeleton } from './motion.js';
import { tel } from './obs.js';
import { net, settings } from './state.js';
import { store } from './store.js';
import { track } from './ui.js';
import { offline, sectionTitle } from './views.js';

export const news = { data: store.get('jarvis_news_cache', {}), loading: false };
const A = CONFIG.address;
const topics = () => settings.value.newsTopics;
const parse = (xml) => parseRSS(xml, window.DOMParser);

export async function refreshNews(force = false) {
  if (news.loading) return;
  const ttl = settings.value.newsEvery * 60000;
  const todo = topics().filter((t) => force || !news.data[t.id] || Date.now() - news.data[t.id].t > ttl);
  if (!todo.length) { emit('data', 'news'); return; }
  news.loading = true;
  emit('data', 'news');
  await track(tel.span('noticias.refresh', { 'noticias.assuntos': todo.length }, async () => {
    try {
      if (!(await checkAntenna(true))) return;
      await Promise.all(todo.map(async (t) => {
        try {
          news.data[t.id] = { t: Date.now(), items: parse(await proxy(feedUrl(t.q), `noticias:${t.label}`)).slice(0, 10) };
        } catch (e) {
          news.data[t.id] = { ...(news.data[t.id] || { items: [] }), t: Date.now() - ttl + 120000, error: e.message };
        }
      }));
      store.set('jarvis_news_cache', news.data);
    } finally {
      news.loading = false;
      emit('data', 'news');
    }
  }).catch(() => {}));
}

export const topHeadlines = (id, n) => (news.data[id]?.items || []).slice(0, n || settings.value.newsCount);

export function newsHTML() {
  const any = topics().some((t) => news.data[t.id]?.items?.length);
  if (news.loading && !any) return skeleton(6);
  let h = net.antenna === false ? offline() : '';
  for (const t of topics()) {
    const d = news.data[t.id], items = topHeadlines(t.id);
    h += sectionTitle(t.label);
    if (!items.length) { h += `<p class="muted pad" data-enter>${d?.error ? 'Não consegui buscar agora.' : 'Carregando…'}</p>`; continue; }
    for (const it of items) {
      h += `<a class="news" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer" data-enter>
        <span class="news-title">${esc(it.title)}</span>
        <span class="news-meta">${esc(it.source || 'Google News')} · ${it.date ? relative(it.date) : ''}${icon('external')}</span>
      </a>`;
    }
  }
  return h;
}

const speakList = (items) => `${items.map((i) => i.title).join('. ')}.`;

export async function voiceAllNews() {
  emit('focus', 'news');
  if (net.antenna === false && !Object.keys(news.data).length) return `Minha antena está desligada, ${A}. Rode node server.js na pasta do projeto.`;
  await refreshNews(false);
  const parts = topics().map((t) => {
    const it = topHeadlines(t.id, 2);
    return it.length ? `${t.label}: ${speakList(it)}` : '';
  }).filter(Boolean);
  return parts.length ? `As principais manchetes, ${A}. ${parts.join(' ')}` : `Não consegui buscar as notícias agora, ${A}.`;
}

export async function voiceTopicNews(spoken) {
  emit('focus', 'news');
  if (!spoken || isGenericNewsWord(spoken)) return voiceAllNews();
  const tp = findTopic(topics(), spoken);
  if (tp) {
    await refreshNews(false);
    const it = topHeadlines(tp.id, 3);
    return it.length ? `Sobre ${tp.label}, ${A}: ${speakList(it)}` : `Não encontrei manchetes recentes sobre ${tp.label}.`;
  }
  if (!(await checkAntenna())) return `Minha antena está desligada, ${A}. Rode node server.js na pasta do projeto.`;
  try {
    const items = parse(await proxy(feedUrl(spoken), `noticias:${spoken}`)).slice(0, 3);
    return items.length ? `Sobre ${spoken}, ${A}: ${speakList(items)}` : `Não encontrei notícias recentes sobre ${spoken}.`;
  } catch {
    return `Não consegui buscar notícias sobre ${spoken} agora, ${A}.`;
  }
}

export async function voiceRefreshNews() {
  emit('focus', 'news');
  await refreshNews(true);
  return `Notícias atualizadas, ${A}.`;
}
