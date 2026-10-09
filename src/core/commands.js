// Comandos de voz resolvidos localmente (sem gastar API). Só frases "com cara de comando" casam:
// "minha agenda" → local; "consigo encaixar um almoço amanhã na minha agenda?" → vai para a IA.
import { norm } from './text.js';

const PRE = '^(?:(?:por favor|ei|oi|aurora|me|fala|falar|diga|diz|mostra|mostre|abre|abra|abrir|leia|ler|le|quais|qual|sao|e|as|os|a|o|minha|minhas|meu|meus|ultimas|ultimos|principais|tem|ha|algum|alguma|eu|voce|pode|poderia|ver|veja|da|de|me da|manda)\\s+)*';
const SUF = '(?:\\s+(?:de hoje|pra hoje|para hoje|hoje|agora|por favor|aurora|pra mim|para mim|ai|ja))*$';
const R = (core) => new RegExp(`${PRE}(?:${core})${SUF}`);
const EM = 'e ?mails?';

export const COMMANDS = [
  { id: 'digest', re: R('bom dia|briefing|digest|resumo do dia|meu briefing|briefing do dia') },
  { id: 'mail.refresh', re: R(`(?:atualizar|atualiza|atualize|recarregar|recarrega|sincronizar|sincroniza) (?:os |meus )?${EM}`) },
  { id: 'news.refresh', re: R('(?:atualizar|atualiza|atualize|recarregar|recarrega) (?:as )?noticias') },
  { id: 'agenda.next', re: R('proximo compromisso|proxima reuniao|proximo evento|proxima tarefa|qual (?:e )?(?:o )?meu proximo compromisso') },
  { id: 'agenda.week', re: R('agenda da semana|agenda semanal|compromissos da semana|minha semana|o que (?:eu )?tenho (?:na|essa|esta) semana') },
  { id: 'agenda.today', re: R('agenda|compromissos|o que (?:eu )?tenho(?: pra| para)?|como (?:esta|ta) (?:minha|a) agenda|como (?:esta|ta) (?:o )?meu dia|meu dia') },
  { id: 'mail.important', re: R(`(?:tem|tenho|ha|chegou|chegaram|algum)?\\s?(?:algum )?${EM} importantes?|${EM} urgentes?|algo importante no ${EM}`) },
  { id: 'mail.summary', re: R(`${EM}|caixa(?: de entrada)?|ler (?:os |meus )?${EM}|como (?:esta|ta) (?:meu|o) ${EM}|como (?:estao|tao) (?:meus|os) ${EM}`) },
  { id: 'news.topic', re: R('noticias? (?:de|sobre|da|do|das|dos|em) (.+?)'), arg: 1 },
  { id: 'news.all', re: R('noticias|manchetes|ultimas noticias|o que (?:ha|tem) de novo|novidades') },
  { id: 'weather', re: R('clima|tempo|previsao(?: do tempo)?|como (?:esta|ta) o (?:tempo|clima)|vai chover|temperatura|qual a temperatura') },
  { id: 'time', re: R('que horas sao|horas|que dia e|data') }
];

/** → { id, arg } ou null (pergunta livre, vai para a IA). */
export function matchCommand(text) {
  const t = norm(text);
  if (!t) return null;
  for (const c of COMMANDS) {
    const m = t.match(c.re);
    if (m) return { id: c.id, arg: c.arg ? m[c.arg] : undefined };
  }
  return null;
}

/** Remove a palavra de ativação ("Ei Aurora", "hey Aurora"...) e devolve o resto da frase. */
export function stripWakeWord(raw) {
  return String(raw).replace(/(?:\b(?:ei|hey|hei|oi|ok|ô|e a[ií]|a[ií])[\s,]+)?aurora\b[\s,.!?:;-]*/i, ' ').trim();
}
export const hasWakeWord = (raw) => /\baurora\b/.test(norm(raw));
