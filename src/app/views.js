// Fragmentos de HTML compartilhados pelos painéis.
import { esc } from '../core/text.js';
import { icon } from './icons.js';

export const offline = () =>
  `<div class="notice warn" data-enter>${icon('antenna')}<div><b>Antena offline</b><span>Abra um terminal na pasta e rode <code>node server.js</code>. Deixe-o aberto.</span></div></div>`;

export const emptyState = (ic, title, text) =>
  `<div class="empty" data-enter><span class="empty-ic">${icon(ic)}</span><b>${esc(title)}</b><span>${text}</span></div>`;

export const errorRow = (text) => `<div class="notice err" data-enter>${icon('x')}<span>${esc(text)}</span></div>`;

export const sectionTitle = (text, extra = '') => `<h4 class="sec-title" data-enter><span>${esc(text)}</span>${extra}</h4>`;
