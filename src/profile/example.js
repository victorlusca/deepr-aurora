// Perfil padrão (público). A Aurora vem SEM configuração pessoal: cada navegador cria a sua
// (personalidade, cérebro, cidade, notícias, contas) na tela "Crie a sua Aurora" e no ⚙.
// Para uma instalação sua com outros padrões: cp src/profile/example.js src/profile/local.js (fora do git).

export const PROFILE = {
  /** Fuso: vazio = o do navegador de quem usa. */
  tz: '',
  /** Cidade padrão do clima: vazia = a pessoa informa na primeira vez. */
  city: { name: '', label: '', lat: null, lon: null },
  /** Última frase do briefing offline (sem chave da API). */
  focus: 'Foco do dia: um passo concreto rumo à sua meta principal',
  /** Base de conhecimento indexada pela antena (pasta de .md, ex.: um vault do Obsidian). */
  docs: {
    label: 'Docs',
    about: 'a documentação disponível na antena (pasta de notas em Markdown)',
    topics: 'o projeto, o produto, a API, planos, fluxos ou o roadmap'
  },
  mailDomainHint: 'voce@seudominio.com',
  customDomain: { tag: 'Hostinger', hint: 'Hostinger (domínio próprio): a senha da própria caixa.', error: 'Senha da caixa do domínio próprio incorreta — confira no painel da Hostinger.' },
  accounts: [],
  newsTopics: []
};
