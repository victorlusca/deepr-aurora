// Clima via Open-Meteo (grátis, sem chave, CORS liberado — direto do navegador).
import { CONFIG, PROFILE } from '../core/config.js';
import { cap } from '../core/text.js';
import { fetchT } from './antenna.js';
import { emit } from './bus.js';
import { tel } from './obs.js';
import { settings, TZ } from './state.js';
import { store } from './store.js';
import { track } from './ui.js';

const UF = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
export const WMO = { 0: 'céu limpo', 1: 'predominantemente limpo', 2: 'parcialmente nublado', 3: 'nublado', 45: 'neblina', 48: 'neblina', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte', 56: 'garoa congelante', 57: 'garoa congelante', 61: 'chuva fraca', 63: 'chuva moderada', 65: 'chuva forte', 66: 'chuva congelante', 67: 'chuva congelante', 71: 'neve fraca', 73: 'neve', 75: 'neve forte', 77: 'grãos de neve', 80: 'pancadas de chuva fracas', 81: 'pancadas de chuva', 82: 'pancadas de chuva fortes', 85: 'neve', 86: 'neve', 95: 'trovoadas', 96: 'trovoadas com granizo', 99: 'trovoadas com granizo' };

export const weather = { data: store.get('jarvis_weather_cache', {}).data || null };

async function geo() {
  const city = settings.value.digest.city || PROFILE.city.name;
  if (!city) return null; // sem cidade definida: sem clima
  const g = store.get('jarvis_geo', null);
  if (g && g.city === city) return g;
  const [name, uf] = city.split(',').map((s) => s.trim());
  let r = PROFILE.city.lat != null && city === PROFILE.city.name ? { city, lat: PROFILE.city.lat, lon: PROFILE.city.lon, label: PROFILE.city.label } : null;
  try {
    const j = await (await fetchT(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=pt&format=json`, {}, 8000)).json();
    const res = (j.results || []).filter((x) => x.country_code === 'BR');
    const want = uf && UF[uf.toUpperCase()];
    const best = res.find((x) => want && x.admin1 === want) || res[0] || (j.results || [])[0];
    if (best) r = { city, lat: best.latitude, lon: best.longitude, label: `${best.name}${uf ? ` · ${uf.toUpperCase()}` : ''}` };
  } catch { /* sem internet: tenta de novo depois */ }
  if (r) store.set('jarvis_geo', r);
  return r;
}

export async function refreshWeather(force = false) {
  const c = store.get('jarvis_weather_cache', {});
  if (!force && c.t && Date.now() - c.t < 30 * 60000 && c.data) { weather.data = c.data; emit('weather'); return; }
  await track(tel.span('clima.refresh', {}, async () => {
    const g = await geo();
    if (!g) { weather.data = null; return; }
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${encodeURIComponent(TZ)}&forecast_days=1`;
    const j = await (await fetchT(u, {}, 10000)).json();
    weather.data = {
      label: g.label, temp: j.current.temperature_2m, feels: j.current.apparent_temperature, hum: j.current.relative_humidity_2m,
      wind: j.current.wind_speed_10m, code: j.current.weather_code, max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0], rain: j.daily.precipitation_probability_max[0]
    };
    store.set('jarvis_weather_cache', { t: Date.now(), data: weather.data });
  }).catch(() => { /* sem internet: mantém o último */ }));
  emit('weather');
}

const city = () => String(weather.data?.label || '').split('·')[0].trim();
export function weatherSpoken() {
  const d = weather.data;
  if (!d) return '';
  return `Em ${city()}, ${Math.round(d.temp)} graus agora, ${WMO[d.code] || ''}. Máxima de ${Math.round(d.max)} e mínima de ${Math.round(d.min)}${d.rain != null ? `, com ${d.rain} por cento de chance de chuva` : ''}.`;
}
export function weatherCompact() {
  const d = weather.data;
  return d ? `${Math.round(d.temp)}°C agora, ${WMO[d.code] || ''}; máx ${Math.round(d.max)}°, mín ${Math.round(d.min)}°, chuva ${d.rain}%` : 'indisponível';
}
export const weatherDesc = () => (weather.data ? cap(WMO[weather.data.code] || '') : '');
export async function voiceWeather() {
  await refreshWeather(false);
  return weather.data ? weatherSpoken() : `Não consegui consultar o clima agora, ${CONFIG.address}.`;
}
