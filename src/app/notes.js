// Editor de notas do Second Brain (clicar num nó edita; "+" cria).
import { AREA } from '../core/config.js';
import { brainStore, setNotes } from './state.js';
import { $, closeModal, openModal, toast } from './ui.js';

let editingId = null, delArmed = 0;

export function openNote(id) {
  editingId = id || null;
  delArmed = 0;
  const n = id ? brainStore.notes.find((x) => x.id === id) : { title: '', area: 'metas', body: '' };
  if (!n) return;
  $('noteHeading').textContent = id ? 'Editar nota' : 'Nova nota';
  $('noteArea').innerHTML = Object.keys(AREA).map((a) => `<option value="${a}">${AREA[a].label}</option>`).join('');
  $('noteTitle').value = n.title;
  $('noteArea').value = n.area;
  $('noteBody').value = n.body;
  $('noteDel').hidden = !id;
  $('noteDel').lastChild.textContent = 'Excluir';
  openModal('noteModal');
}

function save() {
  const title = $('noteTitle').value.trim(), body = $('noteBody').value.trim(), area = $('noteArea').value;
  if (!title) { $('noteTitle').focus(); return; }
  const list = brainStore.notes.map((n) => ({ ...n }));
  let n = editingId && list.find((x) => x.id === editingId);
  if (n) Object.assign(n, { title, body, area });
  else { n = { id: `n${Date.now().toString(36)}`, title, body, area }; list.push(n); }
  setNotes(list, [n.id]);
  closeModal('noteModal');
  toast(`Nota "${title}" salva.`);
}

function del() {
  if (!editingId) return;
  if (Date.now() - delArmed > 3000) { delArmed = Date.now(); $('noteDel').lastChild.textContent = 'Confirmar exclusão'; return; }
  setNotes(brainStore.notes.filter((n) => n.id !== editingId));
  closeModal('noteModal');
  toast('Nota excluída.');
}

export function initNotes() {
  $('noteSave').addEventListener('click', save);
  $('noteDel').addEventListener('click', del);
  $('noteForm').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('noteAdd').addEventListener('click', () => openNote(null));
  $('graph').addEventListener('click', (e) => { const n = e.target.closest('.node'); if (n) openNote(n.dataset.id); });
  $('graph').addEventListener('keydown', (e) => { const n = e.target.closest('.node'); if (n && e.key === 'Enter') openNote(n.dataset.id); });
}
