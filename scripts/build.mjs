// Gera o dist/jarvis.html de ARQUIVO ÚNICO: HTML + CSS + fonte (base64) + JS empacotado.
// O resultado abre com dois cliques, sem servidor, sem CDN, sem dependências em tempo de execução.
// Perfil: src/profile/local.js (seu, fora do git) quando existe; senão o example.js.
//   --profile=example  força o perfil de exemplo · --out=caminho  muda a saída
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const local = join(root, 'src/profile/local.js');
const profile = arg('profile') !== 'example' && existsSync(local) ? local : join(root, 'src/profile/example.js');
const outFile = join(root, arg('out') || 'dist/jarvis.html');
const profilePlugin = {
  name: 'profile',
  setup(b) { b.onResolve({ filter: /^#profile$/ }, () => ({ path: profile })); }
};
const r = (p) => readFileSync(join(root, p));

async function bundle() {
  const out = await esbuild.build({
    entryPoints: [join(root, 'src/app/main.js')],
    bundle: true,
    format: 'iife',
    target: ['chrome110', 'edge110', 'safari16', 'firefox115'],
    charset: 'utf8',
    legalComments: 'none',
    minifySyntax: true,
    plugins: [profilePlugin],
    write: false
  });
  return out.outputFiles[0].text;
}

async function build() {
  const t0 = Date.now();
  const js = (await bundle()).replace(/<\/script/gi, '<\\/script');
  const css = r('src/styles/app.css').toString('utf8').replace('__FONT__', r('src/assets/nunito-latin.woff2').toString('base64'));
  const html = r('src/index.html').toString('utf8').replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  const rel = relative(root, outFile).split(sep).join('/');
  console.log(`✔ ${rel} gerado (${(html.length / 1024).toFixed(0)} KB, perfil ${profile.endsWith('local.js') ? 'local' : 'de exemplo'}) em ${Date.now() - t0} ms`);
}

await build();
if (watch) {
  const { watch: fsWatch } = await import('node:fs');
  let t = 0;
  fsWatch(join(root, 'src'), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => build().catch((e) => console.error(e.message)), 120); });
  console.log('… observando src/ (Ctrl+C para sair)');
}
