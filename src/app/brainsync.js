// Second Brain no banco da antena (data/brain.json): puxa ao conectar, salva a cada mudança.
// O navegador guarda só uma cópia de trabalho; nada disso vai para o código, o build ou o git.
import { fetchT } from './antenna.js';
import { on } from './bus.js';
import { tel } from './obs.js';
import { ANTENNA, brainStore, net, setNotes } from './state.js';

const sync = { pulled: false, quiet: false, timer: 0 };

async function pushBrain() {
  if (!net.antenna || !sync.pulled) return;
  try {
    const r = await fetchT(`${ANTENNA}/brain`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: brainStore.notes }) }, 8000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    tel.log('warn', 'second brain: falha ao salvar na antena', { erro: e.message });
  }
}

/** Lê o banco. Banco vazio + notas antigas no navegador → elas sobem (migração). */
export async function pullBrain() {
  if (!net.antenna) return;
  try {
    const j = await (await fetchT(`${ANTENNA}/brain`, {}, 5000)).json();
    if (!Array.isArray(j.notes)) return;
    sync.pulled = true;
    if (j.notes.length) {
      sync.quiet = true;
      setNotes(j.notes);
      sync.quiet = false;
    } else if (brainStore.notes.length) await pushBrain();
  } catch (e) {
    tel.log('warn', 'second brain: falha ao ler da antena', { erro: e.message });
  }
}

export function installBrainSync() {
  on('notes', () => {
    if (sync.quiet) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(pushBrain, 500);
  });
}
