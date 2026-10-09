// Perfil de EXEMPLO (público). Para usar o seu:
//   cp src/profile/example.js src/profile/local.js   → edite o local.js (ele está no .gitignore)
// O build usa o local.js quando ele existe; os testes usam sempre este arquivo.

export const PROFILE = {
  /** Como a Aurora fala de você na 3ª pessoa ("assistente pessoal do …"). */
  owner: 'Alex',
  /** Como ela te chama. */
  address: 'chefe',
  tz: 'America/Sao_Paulo',
  tzLabel: 'UTC−3, São Paulo',
  /** Cidade padrão do clima (dá para trocar no ⚙). */
  city: { name: 'São Paulo, SP', label: 'São Paulo · SP', lat: -23.5505, lon: -46.6333 },
  /** Última frase do briefing offline (sem chave da API). */
  focus: 'Foco do dia: um passo concreto rumo à sua meta principal',
  /** Notas que o briefing usa como "metas" (além da área metas). */
  goalNotes: ['projeto'],
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
  ],
  /** Second Brain inicial. Depois a própria Aurora atualiza (fica salvo no navegador). */
  notes: [
    { id: 'eu', area: 'meta', title: 'Alex', body: 'Desenvolvedor que usa IA todos os dias. Mora em São Paulo.' },
    { id: 'metas', area: 'metas', title: 'Metas', body: 'Curto prazo: lançar o primeiro produto e conseguir os primeiros clientes. Longo prazo: viver dos próprios sistemas.' },
    { id: 'emprego', area: 'trabalho', title: 'Emprego', body: 'Trabalho atual em tempo integral; os projetos ficam para as noites e fins de semana.' },
    { id: 'projeto', area: 'projetos', title: 'Projeto', body: 'Produto principal: um SaaS em construção, com site, API e painel.' },
    { id: 'api', area: 'projetos', title: 'API', body: 'API do projeto, hospedada na nuvem.' },
    { id: 'reserva', area: 'financas', title: 'Reserva', body: 'Montar uma reserva de 6 meses antes de largar o emprego.' },
    { id: 'ingles', area: 'aprendizado', title: 'Inglês', body: 'Estudando inglês 20 minutos por dia.' },
    { id: 'academia', area: 'saude', title: 'Academia', body: 'Treina 3 vezes por semana.' },
    { id: 'amigo', area: 'relacoes', title: 'Sam', body: 'Melhor amigo, sócio em ideias.' }
  ],
  /** Ligações fixas do grafo (pares de ids). */
  rel: [
    ['metas', 'eu'], ['metas', 'projeto'], ['metas', 'reserva'], ['eu', 'emprego'], ['eu', 'ingles'], ['eu', 'academia'], ['eu', 'amigo'],
    ['projeto', 'api'], ['reserva', 'emprego'], ['amigo', 'projeto']
  ]
};
