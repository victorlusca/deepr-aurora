// Configuração do app. Dados pessoais ficam no perfil (src/profile/local.js, fora do git).
import { PROFILE } from '#profile';

export { PROFILE };

/** Única coisa que vem pronta: a personalidade sugerida (cada navegador pode reescrever no ⚙ → Personalidade). */
export const DEFAULT_PERSONA = 'formal britânico (mordomo): educada, precisa, elegante, leal, com humor seco e sutil';
export const DEFAULT_ADDRESS = 'chefe';

export const CONFIG = {
  name: 'Aurora',
  address: DEFAULT_ADDRESS,
  themeColor: '#1f8b4c',
  persona: DEFAULT_PERSONA,
  wakeWord: 'ei aurora',
  voiceGender: 'feminina',
  model: 'gpt-6.1-sol',
  tz: PROFILE.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
};

export const MODELS = {
  'gpt-6-luna': { label: 'Econômico', short: 'GPT-6 Luna', price: [0.1, 0.5], effort: 'none' },
  'gpt-6.1-sol': { label: 'Equilibrado', short: 'GPT-6.1 Sol', price: [2, 10], effort: 'low' },
  'gpt-6-astra': { label: 'Máximo', short: 'GPT-6 Astra', price: [10, 50], effort: 'low' }
};

export const AREA = {
  metas: { label: 'Metas', color: '#fbbf24' },
  trabalho: { label: 'Carreira', color: '#ff5547' },
  projetos: { label: 'Projetos', color: '#8b7cff' },
  financas: { label: 'Finanças', color: '#f7931a' },
  aprendizado: { label: 'Aprendizado', color: '#2dd4ff' },
  saude: { label: 'Saúde', color: '#10b981' },
  relacoes: { label: 'Relações', color: '#ec4899' },
  meta: { label: 'Você', color: '#8a90a6' }
};

export const DEFAULT_SETTINGS = {
  economy: true,
  ambientMotion: true,
  telemetry: { local: true, export: true },
  emailCount: 5,
  emailEvery: 15,
  newsCount: 4,
  newsEvery: 30,
  agendaEvery: 10,
  newsTopics: PROFILE.newsTopics,
  digest: { auto: true, voice: true, speak: true, size: 'curto', weather: true, city: PROFILE.city.name }
};

export const PROVIDERS = {
  gmail: { host: 'imap.gmail.com', tag: 'Gmail', hint: 'voce@gmail.com' },
  outlook: { host: 'outlook.office365.com', tag: 'Outlook', hint: 'voce@outlook.com' },
  hostinger: { host: 'imap.hostinger.com', tag: 'Hostinger', hint: PROFILE.mailDomainHint }
};

export const DEFAULT_ACCOUNTS = PROFILE.accounts;

/** Mescla configurações salvas com os padrões (sem perder campos novos). */
export function mergeSettings(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    telemetry: { ...DEFAULT_SETTINGS.telemetry, ...(s.telemetry || {}) },
    digest: { ...DEFAULT_SETTINGS.digest, ...(s.digest || {}) },
    newsTopics: Array.isArray(s.newsTopics) && s.newsTopics.length ? s.newsTopics : DEFAULT_SETTINGS.newsTopics
  };
}
