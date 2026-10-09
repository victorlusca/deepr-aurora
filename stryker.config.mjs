// Teste de mutação (Stryker). Roda o Vitest de verdade para cada mutante.
// A sandbox fica FORA do OneDrive: dentro dele, a sincronização trava as cópias e gera falsos timeouts.
// (O @stryker-mutator/vitest-runner não casa os IDs de teste com caminhos do Windows — por isso o executor por comando.)
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// STRYKER_TESTS restringe os testes por mutante (ex.: tests/unit/triage.test.js) — mais leve em memória.
const tests = process.env.STRYKER_TESTS || 'tests/unit';

export default {
  testRunner: 'command',
  commandRunner: { command: `node node_modules/vitest/vitest.mjs run ${tests} --reporter=dot` },
  coverageAnalysis: 'off',
  tempDirName: join(tmpdir(), 'aurora-stryker'),
  mutate: [
    'src/core/ics.js', 'src/core/time.js', 'src/core/visemes.js', 'src/core/commands.js',
    'src/core/triage.js', 'src/core/memory.js', 'src/core/docs.js', 'src/core/openai.js'
  ],
  mutator: { excludedMutations: ['StringLiteral', 'Regex', 'ObjectLiteral'] },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: 50 },
  concurrency: 2,
  timeoutMS: 30000
};
