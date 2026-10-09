// Perfil de EXEMPLO (público). Para usar o seu:
//   cp src/profile/example.js src/profile/local.js   → edite o local.js (ele está no .gitignore)
// O build usa o local.js quando ele existe; os testes usam sempre este arquivo.
// O Second Brain (nome, metas, relações…) NÃO fica aqui: ele vive no banco da antena (data/brain.json).

export const PROFILE = {
  /** Como ela te chama. */
  address: 'chefe',
  tz: 'America/Sao_Paulo',
  tzLabel: 'UTC−3, São Paulo',
  /** Cidade padrão do clima (dá para trocar no ⚙). */
  city: { name: 'São Paulo, SP', label: 'São Paulo · SP', lat: -23.5505, lon: -46.6333 },
  /** Última frase do briefing offline (sem chave da API). */
  focus: 'Foco do dia: um passo concreto rumo à sua meta principal',
  /** Base de conhecimento indexada pela antena (pasta de .md, ex.: um vault do Obsidian). */
  docs: {
    label: 'Docs',
    about: 'a documentação do seu projeto (pasta de notas em Markdown)',
    topics: 'o projeto, o produto, a API, planos, fluxos ou o roadmap'
  },
  mailDomainHint: 'voce@seudominio.com',
  customDomain: { tag: 'Hostinger', hint: 'Hostinger (domínio próprio): a senha da própria caixa.', error: 'Senha da caixa do domínio próprio incorreta — confira no painel da Hostinger.' },
  accounts: [
    { id: 'gmail', provider: 'gmail', email: '', senha: '', apelido: 'Pessoal', cor: '#3ddc84' },
    { id: 'outlook', provider: 'outlook', email: '', senha: '', apelido: 'Pessoal', cor: '#3ddc84' },
    { id: 'trabalho', provider: 'hostinger', email: '', senha: '', apelido: 'Trabalho', cor: '#f4f7f5' }
  ],
  newsTopics: [
    { id: 'ia', label: 'IA', q: '"inteligência artificial" OR IA', alias: 'ia, inteligencia artificial, ai' },
    { id: 'saas', label: 'SaaS', q: 'SaaS', alias: 'saas, software como servico, startups' },
    { id: 'tec', label: 'Tecnologia', q: 'tecnologia', alias: 'tecnologia, tech' },
    { id: 'eco', label: 'Economia', q: 'economia', alias: 'economia, mercado, dolar' },
    { id: 'cidade', label: 'São Paulo', q: '"São Paulo" SP', alias: 'sao paulo, minha cidade, cidade' }
  ]
};
