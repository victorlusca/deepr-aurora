// Observabilidade do navegador: spans/logs (OpenTelemetry) e erros (Sentry) → antena → exportadores.
// A antena só repassa se o exportador estiver configurado no .env dela (chaves nunca ficam no navegador).
import { createTelemetry } from '../core/telemetry.js';
import { ANTENNA, net, settings, VERSION } from './state.js';

async function transport(kind, payload) {
  if (!net.antenna) throw new Error('antena offline');
  const r = await fetch(`${ANTENNA}/telemetry/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export const tel = createTelemetry({ service: 'aurora-web', version: VERSION, transport });

export function installObservability() {
  tel.setExport(settings.value.telemetry.export);
  addEventListener('error', (e) => tel.error(e.error || e.message, { tags: { source: 'window.onerror' } }));
  addEventListener('unhandledrejection', (e) => tel.error(e.reason, { tags: { source: 'unhandledrejection' } }));
  // tarefas longas (> 50 ms) travam a interface — registradas como aviso
  try {
    new PerformanceObserver((list) => {
      for (const t of list.getEntries()) if (t.duration > 120) tel.log('warn', 'tarefa longa na thread principal', { 'longtask.ms': Math.round(t.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* navegador sem longtask */ }
  setInterval(() => tel.flush(), 15000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tel.flush(); });
}
