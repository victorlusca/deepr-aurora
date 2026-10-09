// Triagem de e-mails em 3 baldes: acao · info · ruido.
import { norm } from './text.js';

export const BUCKETS = ['acao', 'info', 'ruido'];

const NOISE = /(no ?reply|noreply|nao responda|newsletter|unsubscribe|descadastr|cancelar inscricao|promo|oferta|desconto|cupom|black friday|liquidacao|marketing|notification|notificacao|mailer|digest)/;
const MONEY = /(fatura|vencimento|vence|prazo|boleto)/;
const ACTION = /(prazo|vence|vencimento|fatura|boleto|reuniao|confirme|confirmar|por favor|poderia|preciso|aguardo|responder|responda|urgente|asap|ate amanha|ate hoje|convite|aprovar|revisar|pendente)/;

/** Triagem local (sem chave de API): heurística por palavras-chave. */
export function heuristic(m) {
  const s = norm(`${m.remetente} ${m.email} ${m.assunto} ${m.trecho}`);
  const raw = `${m.assunto} ${m.trecho}`;
  const noise = NOISE.test(s), money = MONEY.test(s);
  const action = /\?/.test(raw) || ACTION.test(s);
  const balde = noise && !money ? 'ruido' : action ? 'acao' : 'info';
  return { balde, resumo: m.assunto || '(sem assunto)' };
}

/** Mensagem única para classificar um lote — só remetente, assunto e 200 caracteres do trecho. */
export function triagePrompt(batch) {
  const list = batch
    .map((m, k) => `${k + 1}. De: ${m.remetente} <${m.email}> | Assunto: ${m.assunto} | Trecho: ${(m.trecho || '').slice(0, 200)}`)
    .join('\n');
  return [
    'Classifique cada e-mail em um balde:',
    '- "acao": pede resposta, tarefa, decisão ou tem prazo — alguém esperando o usuário.',
    '- "info": vale a pena saber, mas não exige nada — confirmação, recibo, atualização.',
    '- "ruido": promoção, newsletter, notificação automática — pode ignorar.',
    '',
    `E-mails:\n${list}`,
    '',
    'Devolva APENAS um array JSON: [{"id": <número>, "balde": "acao"|"info"|"ruido", "resumo": "uma frase curta em português do Brasil"}]'
  ].join('\n');
}

/** Lê a resposta da IA (tolerante a texto em volta do JSON). → Map(index → {balde, resumo}) */
export function parseTriage(text, batch) {
  const out = new Map();
  const s = String(text || '');
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b < a) return out;
  let arr;
  try {
    arr = JSON.parse(s.slice(a, b + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(arr)) return out;
  for (const x of arr) {
    const i = Number(x?.id) - 1;
    const m = batch[i];
    if (m && BUCKETS.includes(x.balde)) out.set(i, { balde: x.balde, resumo: String(x.resumo || m.assunto).slice(0, 180) });
  }
  return out;
}

/** Mantém o cache em no máximo `max` entradas, descartando as mais antigas. */
export function pruneCache(cache, max = 400) {
  const keys = Object.keys(cache);
  if (keys.length <= max) return cache;
  keys.sort((x, y) => (cache[x].t || 0) - (cache[y].t || 0));
  for (const k of keys.slice(0, keys.length - max)) delete cache[k];
  return cache;
}
