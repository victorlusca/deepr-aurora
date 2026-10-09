/** Contrato de arquitetura (arch-contract): quem pode depender de quem. */
module.exports = {
  forbidden: [
    {
      name: 'core-e-puro',
      comment: 'src/core é lógica pura e testável: não pode depender da camada de app (DOM, rede, voz).',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/app' }
    },
    {
      name: 'core-sem-dom-nem-node',
      comment: 'src/core roda no navegador e nos testes: nada de módulos do Node.',
      severity: 'error',
      from: { path: '^src/core' },
      to: { dependencyTypes: ['core'] }
    },
    {
      name: 'antena-isolada',
      comment: 'server.js é a antena standalone (node server.js): não importa nada de src/.',
      severity: 'error',
      from: { path: '^server[.]js$' },
      to: { path: '^src/' }
    },
    {
      name: 'app-nao-importa-testes',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^tests' }
    },
    {
      name: 'perfil-so-dados',
      comment: 'src/profile/* (perfil público de exemplo e o seu local, fora do git) é só dados: não importa nada.',
      severity: 'error',
      from: { path: '^src/profile' },
      to: {}
    },
    { name: 'sem-ciclos', severity: 'error', from: {}, to: { circular: true } },
    { name: 'sem-orfaos', severity: 'warn', from: { orphan: true, pathNot: ['[.]d[.]ts$', '(^|/)[.][^/]+[.](js|cjs|mjs)$', 'config[.](js|mjs|cjs)$', '^src/profile/local[.]js$'] }, to: {} },
    { name: 'sem-dependencias-npm-em-runtime', comment: 'o jarvis.html e a antena rodam sem npm install.', severity: 'error', from: { path: '^(src|server[.]js)' }, to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'] } }
  ],
  options: { doNotFollow: { path: 'node_modules' }, moduleSystems: ['es6', 'cjs'] }
};
