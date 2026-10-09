// OpenAI · Responses API. Monta o pedido e lê a resposta — sem SDK.
import { MODELS } from './config.js';

export const OPENAI_URL = 'https://api.openai.com/v1/responses';

/**
 * Os modelos GPT-6 raciocinam e esse raciocínio conta no limite de saída,
 * então o esforço fica no mínimo (fala rápida) e o teto é folgado.
 */
export function buildRequest({ model, system, messages, maxTokens }) {
  return {
    model,
    instructions: system,
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: maxTokens * 3,
    reasoning: { effort: MODELS[model]?.effort || 'low' },
    store: false
  };
}

export function extractText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text.trim();
  return (data.output || [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('')
    .trim();
}

export function costOf(model, usage) {
  const p = MODELS[model]?.price || [2, 10];
  return ((usage?.input_tokens || 0) * p[0] + (usage?.output_tokens || 0) * p[1]) / 1e6;
}

/** Erro → frase falada amigável. */
export function errorSpeech(err, address) {
  const A = address.charAt(0).toUpperCase() + address.slice(1);
  if (err?.kind === 'http') {
    if (err.status === 401 || err.status === 403) return `${A}, a OpenAI recusou a chave. Verifique se a chave da API está correta.`;
    if (err.status === 429) return `${A}, atingimos o limite de uso da API por agora. Tente em instantes e confira seus créditos e a chave.`;
    return `${A}, a API respondeu com erro ${err.status}. Verifique sua chave da API e tente novamente.`;
  }
  return `Perdão, ${address}. Não consegui conectar ao meu cérebro. Verifique sua conexão com a internet.`;
}
