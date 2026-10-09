import { describe, expect, it } from 'vitest';
import { costOf, errorSpeech, extractText } from '../../src/core/openai.js';

describe('openai · leitura da resposta', () => {
  it('output_text vazio ou não-texto cai para output[]', () => {
    const output = [{ type: 'message', content: [{ type: 'output_text', text: ' Olá' }] }];
    expect(extractText({ output_text: '', output })).toBe('Olá');
    expect(extractText({ output_text: 42, output })).toBe('Olá');
    expect(extractText({ output_text: 'direto ', output })).toBe('direto');
  });
  it('junta vários pedaços e ignora o que não é mensagem/texto', () => {
    const data = {
      output: [
        { type: 'reasoning', content: [{ type: 'output_text', text: 'pensando' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Bom ' }, { type: 'refusal', text: 'não' }] },
        { type: 'message' },
        { type: 'message', content: [{ type: 'output_text', text: 'dia, chefe. ' }] }
      ]
    };
    expect(extractText(data)).toBe('Bom dia, chefe.');
    expect(extractText({})).toBe('');
  });
});

describe('openai · custo', () => {
  it('preço do modelo ou padrão [2, 10] por milhão; sem uso = 0', () => {
    expect(costOf('desconhecido', { input_tokens: 1e6, output_tokens: 1e6 })).toBe(12);
    expect(costOf('desconhecido', { input_tokens: 5e5 })).toBe(1);
    expect(costOf('desconhecido', { output_tokens: 1e5 })).toBe(1);
    expect(costOf('desconhecido')).toBe(0);
    expect(costOf('desconhecido', null)).toBe(0);
  });
});

describe('openai · erros falados', () => {
  it('frases completas com o tratamento capitalizado', () => {
    expect(errorSpeech({ kind: 'http', status: 403 }, 'chefe')).toBe('Chefe, a OpenAI recusou a chave. Verifique se a chave da API está correta.');
    expect(errorSpeech({ kind: 'http', status: 429 }, 'senhor')).toMatch(/^Senhor, atingimos o limite/);
    expect(errorSpeech({ kind: 'http', status: 502 }, 'chefe')).toBe('Chefe, a API respondeu com erro 502. Verifique sua chave da API e tente novamente.');
    expect(errorSpeech(null, 'chefe')).toBe('Perdão, chefe. Não consegui conectar ao meu cérebro. Verifique sua conexão com a internet.');
    expect(errorSpeech({ kind: 'rede', status: 401 }, 'chefe')).toMatch(/^Perdão, chefe/);
  });
});
