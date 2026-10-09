import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

const APP = pathToFileURL(resolve('dist/e2e.html')).href;
const ANT = 'http://127.0.0.1:4242';

// Second Brain fictício (o real vive no banco da antena). notes: [] → estado vazio.
const DEMO = [
  { id: 'eu', area: 'meta', title: 'Alex', body: 'Desenvolvedor que usa IA todos os dias.' },
  { id: 'metas', area: 'metas', title: 'Metas', body: 'Lançar o primeiro produto.' },
  { id: 'projeto', area: 'projetos', title: 'Projeto', body: 'Um SaaS em construção.' },
  { id: 'amigo', area: 'relacoes', title: 'Sam', body: 'Melhor amigo.' }
];

/* Voz, microfone e reconhecimento simulados — o navegador de teste não tem áudio. */
function stubs(opts) {
  window.__spoken = [];
  localStorage.setItem('jarvis_notes', JSON.stringify(opts.notes));
  // por padrão o briefing de hoje já rodou (o teste dele liga isso de volta)
  if (!opts.autoDigest) localStorage.setItem('jarvis_last_digest', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()));
  class Utt { constructor(t) { this.text = t; } }
  window.SpeechSynthesisUtterance = Utt;
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      speaking: false,
      getVoices: () => [{ name: 'Microsoft Francisca Online (Natural) - Portuguese (Brazil)', lang: 'pt-BR', localService: false }],
      cancel() {}, resume() {},
      speak(u) {
        window.__spoken.push(u.text);
        setTimeout(() => { u.onstart?.(); u.onboundary?.({ name: 'word', charIndex: 0 }); }, 5);
        setTimeout(() => u.onend?.(), 40);
      },
      onvoiceschanged: null
    }
  });
  window.webkitSpeechRecognition = class { start() { this.onstart?.(); } abort() { this.onend?.(); } };
  window.SpeechRecognition = window.webkitSpeechRecognition;
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('sem microfone no teste'));
}

const RSS = (t) => `<?xml version="1.0"?><rss><channel>${[1, 2, 3].map((i) => `<item><title>${t} manchete ${i} - Fonte</title><link>https://news.google.com/${i}</link><pubDate>${new Date(Date.now() - i * 3600000).toUTCString()}</pubDate><source>Fonte</source></item>`).join('')}</channel></rss>`;

async function setup(page, { antenna = false, proxyDelay = 0, autoDigest = false, notes = DEMO } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(stubs, { autoDigest, notes });
  await page.route(`${ANT}/**`, async (route) => {
    if (!antenna) return route.abort('connectionrefused');
    const url = new URL(route.request().url());
    if (url.pathname === '/health') return route.fulfill({ json: { ok: true, exporters: { otlp: true } } });
    if (url.pathname === '/proxy') {
      await new Promise((r) => setTimeout(r, proxyDelay));
      const q = new URL(url.searchParams.get('url')).searchParams.get('q');
      return route.fulfill({ body: RSS(q.split(' ')[0].replace(/"/g, '')), contentType: 'application/rss+xml' });
    }
    if (url.pathname.startsWith('/telemetry/')) return route.fulfill({ status: 202, json: { ok: true } });
    if (url.pathname === '/docs/status') return route.fulfill({ json: { ok: true, available: true, dir: 'knowledge', files: 135, chunks: 1346, folders: { Bot: 30, ADR: 11, API: 2 } } });
    if (url.pathname === '/docs/search') return route.fulfill({ json: { ok: true, results: [{ path: 'Bot/Commands/bateponto.md', title: 'Cog bateponto', heading: 'Objetivo', text: 'Registro de horas por presença em call de voz.', score: 18.2 }] } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('https://*.open-meteo.com/**', (route) => route.fulfill({
    json: route.request().url().includes('geocoding')
      ? { results: [{ name: 'São Paulo', latitude: -23.55, longitude: -46.63, country_code: 'BR', admin1: 'São Paulo' }] }
      : { current: { temperature_2m: 27.4, apparent_temperature: 29, relative_humidity_2m: 40, weather_code: 0, wind_speed_10m: 9 }, daily: { temperature_2m_max: [33], temperature_2m_min: [19], precipitation_probability_max: [10], weather_code: [0] } }
  }));
  return errors;
}

async function activate(page) {
  await page.goto(APP);
  await expect(page.locator('.screen-boot')).toBeVisible();
  await page.getByRole('button', { name: '► ATIVAR SISTEMA' }).click({ timeout: 6000 });
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'app');
}

test('boot → ativação → app: saúda em voz alta e começa a ouvir', async ({ page }) => {
  const errors = await setup(page);
  await page.goto(APP);
  await expect(page.locator('.syncing')).toHaveText('SINCRONIZANDO DADOS...');
  await expect(page.locator('.screen-boot .version')).toHaveText('v5.0 · REBUILD');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'activate', { timeout: 4000 });
  await page.getByRole('button', { name: '► ATIVAR SISTEMA' }).click();
  await expect(page.locator('#bubbleAi')).toContainText('Sistemas online. Estou ouvindo, chefe.');
  await expect.poll(() => page.evaluate(() => window.__spoken[0])).toBe('Sistemas online. Estou ouvindo, chefe.');
  await expect(page.locator('#stateText')).toHaveText(/Ouvindo|Diga "Ei Aurora"/);
  await expect(page.locator('#btnMic')).toHaveAttribute('data-state', 'on');
  expect(errors).toEqual([]);
});

test('antena desligada: painéis avisam com a instrução certa', async ({ page }) => {
  await setup(page, { antenna: false });
  await activate(page);
  await expect(page.locator('#antPill')).toContainText('Antena offline');
  await page.getByRole('tab', { name: /Notícias/ }).click();
  await expect(page.locator('#sheetBody')).toContainText('Antena offline');
  await expect(page.locator('#sheetBody code')).toHaveText('node server.js');
});

test('esqueleto de carregamento → conteúdo com animação de entrada', async ({ page }) => {
  await setup(page, { antenna: true, proxyDelay: 4500 });
  await activate(page);
  await page.getByRole('tab', { name: /Notícias/ }).click();
  await expect(page.locator('#sheetBody .sk-list')).toBeVisible();
  await expect(page.locator('#progress')).toHaveAttribute('data-on', '1');
  await expect(page.locator('#sheetBody .news').first()).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#sheetBody .sk-list')).toHaveCount(0);
  await expect(page.locator('#sheetBody .news-title').first()).not.toContainText(' - Fonte');
  await expect(page.locator('#antPill')).toContainText('Antena online');
});

test('comando local responde sem chamar a API', async ({ page }) => {
  await setup(page);
  let apiCalls = 0;
  await page.route('https://api.openai.com/**', (r) => { apiCalls++; return r.abort(); });
  await activate(page);
  await page.getByLabel('Mensagem para a Aurora').fill('que horas são');
  await page.keyboard.press('Enter');
  await expect(page.locator('#bubbleYou')).toContainText('que horas são');
  await expect(page.locator('#bubbleAi')).toContainText(/São \d+ horas e \d+ minutos/);
  expect(apiCalls).toBe(0);
});

test('pergunta livre vai para a OpenAI com Second Brain e memória viva', async ({ page }) => {
  await setup(page);
  let body = null, auth = null;
  await page.route('https://api.openai.com/v1/responses', async (route) => {
    body = route.request().postDataJSON();
    auth = route.request().headers().authorization;
    await route.fulfill({ json: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Excelente escolha, chefe. Anotei seu novo hábito.\n[[SAVE:saude|Corrida|Corre três vezes por semana]]' }] }], usage: { input_tokens: 1200, output_tokens: 40 } } });
  });
  await activate(page);
  await page.getByLabel('Chave da API da OpenAI').fill('sk-teste-123');
  await expect(page.locator('#brainCount')).toContainText('4 notas');
  await page.getByLabel('Mensagem para a Aurora').fill('comecei a treinar três vezes por semana');
  await page.keyboard.press('Enter');
  await expect(page.locator('#bubbleAi')).toHaveText('Excelente escolha, chefe. Anotei seu novo hábito.');
  expect(auth).toBe('Bearer sk-teste-123');
  expect(body.model).toBe('gpt-6.1-sol');
  expect(body.instructions).toContain('SECOND BRAIN');
  expect(body.instructions).toContain('Projeto: Um SaaS em construção.');
  expect(body.instructions).toContain('Agenda de hoje:');
  expect(body.input.at(-1)).toEqual({ role: 'user', content: 'comecei a treinar três vezes por semana' });
  await expect(page.locator('#brainCount')).toContainText('5 notas');
  const spoken = await page.evaluate(() => window.__spoken.at(-1));
  expect(spoken).not.toContain('[[SAVE');
  await expect(page.locator('#footUsage')).toContainText('1 chamadas');
});

test('configurações: troca o cérebro e persiste', async ({ page }) => {
  await setup(page);
  await activate(page);
  await page.getByRole('button', { name: 'Configurações' }).click();
  const dlg = page.getByRole('dialog', { name: 'Configurações' });
  await expect(dlg).toBeVisible();
  await dlg.getByText('Máximo').click();
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#footUsage')).toContainText('GPT-6 Astra');
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('jarvis_model'))).toBe('gpt-6-astra');
});

test('diagnóstico mostra spans de observabilidade', async ({ page }) => {
  await setup(page, { antenna: true });
  await activate(page);
  await page.getByRole('button', { name: 'Diagnóstico' }).click();
  const dlg = page.getByRole('dialog', { name: 'Configurações' });
  await expect(dlg.getByRole('heading', { name: 'Diagnóstico' })).toBeVisible();
  await expect(dlg.locator('.diag-list li').first()).toBeVisible();
  await expect(dlg).toContainText('antena.proxy');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('Second Brain carrega sob demanda e o nó abre o editor', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 360 });
  await setup(page);
  await activate(page);
  await expect(page.locator('#graph svg')).toHaveCount(0);
  await page.locator('#brain').scrollIntoViewIfNeeded();
  await expect(page.locator('#graph svg .node')).toHaveCount(4);
  await page.locator('#graph .node[data-id="projeto"]').focus(); // teclado: o halo "respira", então o nó nunca fica estático para um clique
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Editar nota' });
  await expect(dlg.getByLabel('Título')).toHaveValue('Projeto');
});

test('movimento reduzido: tudo funciona sem animação', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await setup(page);
  await activate(page);
  await page.getByRole('tab', { name: /Briefing/ }).click();
  await expect(page.locator('#sheetBody')).toContainText('Seu briefing ainda não foi gerado');
  expect(errors).toEqual([]);
});

test('briefing automático na 1ª ativação do dia (modo offline, sem chave) e não repete', async ({ page }) => {
  await setup(page, { autoDigest: true });
  await activate(page);
  await expect(page.locator('#sheetBody .digest-text')).toContainText('Foco do dia', { timeout: 30000 });
  await expect(page.locator('#sheetBody .chip.warn')).toContainText('modo offline');
  await expect.poll(() => page.evaluate(() => window.__spoken.some((s) => s.includes('Foco do dia')))).toBe(true);
  const last = await page.evaluate(() => localStorage.getItem('jarvis_last_digest'));
  expect(last).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
});

test('pergunta sobre o projeto leva os trechos da documentação ao prompt', async ({ page }) => {
  await setup(page, { antenna: true });
  let body = null;
  await page.route('https://api.openai.com/v1/responses', async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { output_text: 'O bateponto registra horas por presença em call de voz, chefe.', usage: { input_tokens: 900, output_tokens: 20 } } });
  });
  await activate(page);
  await page.getByLabel('Chave da API da OpenAI').fill('sk-teste-123');
  await expect(page.locator('#footDocs')).toHaveText('Docs: 135 notas');
  await page.getByLabel('Mensagem para a Aurora').fill('como funciona o bateponto?');
  await page.keyboard.press('Enter');
  await expect(page.locator('#bubbleAi')).toContainText('registra horas');
  expect(body.instructions).toContain('CONHECIMENTO · DOCS');
  expect(body.instructions).toContain('### Bot/Commands/bateponto.md — Objetivo');
  expect(body.instructions).toContain('Registro de horas por presença em call de voz.');
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByRole('dialog', { name: 'Configurações' }).getByRole('button', { name: 'Conhecimento' }).click();
  await expect(page.locator('#docsStatus')).toContainText('135');
  await page.getByLabel('Buscar na documentação').fill('bateponto');
  await page.keyboard.press('Enter');
  await expect(page.locator('#docResults')).toContainText('Bot/Commands/bateponto.md');
});

test('Second Brain vazio: cérebro no centro e convite para a primeira nota', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 360 });
  await setup(page, { notes: [] });
  await activate(page);
  await page.locator('#brain').scrollIntoViewIfNeeded();
  await expect(page.locator('#graph svg .core-glyph')).toHaveCount(1);
  await expect(page.locator('#graph svg')).toContainText('Second Brain vazio');
  await expect(page.locator('#graph svg .node')).toHaveCount(0);
  await expect(page.locator('#brainCount')).toHaveText('vazio');
});
