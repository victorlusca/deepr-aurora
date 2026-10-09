// Monta o aurora-square.zip para enviar à SquareCloud (upload no painel ou `squarecloud upload`).
// Conteúdo: server.js · dist/jarvis.html (com SEU perfil) · squarecloud.app · package.json mínimo · .env · knowledge/ (suas notas .md)
// O zip tem dados pessoais e a senha — ele está no .gitignore e NUNCA deve ir para o GitHub.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => { console.error(`\n  ✖ ${msg}\n`); process.exit(1); };

/* lê KEY=valor de um .env sem interpretar nada além disso */
const readEnv = (file) => {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
};

const local = readEnv(join(root, '.env'));
const square = readEnv(join(root, '.env.square'));
if (String(square.AURORA_PASSWORD || '').length < 12) {
  fail('Crie o arquivo .env.square (copie de .env.square.example) com AURORA_PASSWORD de 12+ caracteres.\n    Ela protege o app hospedado: o navegador pede essa senha ao abrir.');
}

/* 1. build com o seu perfil */
execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });

/* 2. arquivos */
const files = [];
const add = (name, data) => files.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
add('server.js', readFileSync(join(root, 'server.js')));
add('dist/jarvis.html', readFileSync(join(root, 'dist/jarvis.html')));
// LF obrigatório: com CRLF (checkout no Windows) a SquareCloud lê "MAIN=server.js<CR>" e não acha o arquivo
add('squarecloud.app', readFileSync(join(root, 'squarecloud.app'), 'utf8').replaceAll(String.fromCharCode(13), ''));
add('package.json', `${JSON.stringify({ name: 'aurora', private: true, main: 'server.js', scripts: { start: 'node server.js' }, engines: { node: '>=20' } }, null, 2)}\n`);

const env = { ...square, AURORA_HOST: '0.0.0.0', PORT: '80' };
delete env.DOCS_DIR;
add('.env', `# Gerado por scripts/pack-square.mjs — não edite aqui, edite o .env.square\n${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);

const docsSrc = square.DOCS_DIR || local.DOCS_DIR;
let notes = 0;
if (docsSrc) {
  const base = resolve(root, docsSrc);
  if (!existsSync(base)) fail(`DOCS_DIR não encontrado: ${base}`);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.md') && statSync(p).size < 2 * 1024 * 1024) {
        add(`knowledge/${relative(base, p).split(sep).join('/')}`, readFileSync(p));
        notes++;
      }
    }
  };
  walk(base);
}

/* 3. zip (deflate) sem dependências — "criado em Unix" com permissão 644, senão o Linux da hospedagem pode não conseguir ler */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const dosTime = 0, dosDate = (2026 - 1980) << 9 | 1 << 5 | 1;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE((3 << 8) | 20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); cen.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, comp);
    centrals.push(cen, nameBuf);
    offset += head.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const out = join(root, 'aurora-square.zip');
const buf = zip(files);
writeFileSync(out, buf);
console.log(`\n  ✔ aurora-square.zip (${(buf.length / 1024).toFixed(0)} KB) — ${files.length} arquivos, ${notes} notas em knowledge/`);
console.log('  → envie em squarecloud.app/dashboard → Upload, ou:  npx @squarecloud/cli upload aurora-square.zip');
console.log('  ⚠ o zip tem seu perfil e a senha: não compartilhe e não faça commit.\n');
