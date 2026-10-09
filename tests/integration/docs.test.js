import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const antena = require('../../server.js');

const NOTE_BP = `---
name: Cog bateponto
description: Sistema de ponto por call de voz
---

# Cog — bateponto.py

Visão geral do sistema de ponto.

## Objetivo
Registro de horas por presença em call de voz. O membro abre ponto ao entrar numa call da categoria bateponto.

## Responsabilidades
- Painel com botões ABRIR/FECHAR, ligado a [[Hierarquia|hierarquia por horas]].
`;
const NOTE_SQ = '# Square Cloud\n\nA hospedagem dos bots e da API do projeto é feita na [[Square Cloud]]. Deploy via upload do zip.\n';
const NOTE_REL = '# Release 2.0\n\nHoras totais contínuas: semana × total com fronteiras explícitas no fuso de São Paulo.\n';

let dir, app, base;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aurora-docs-'));
  mkdirSync(join(dir, 'Bot', 'Commands'), { recursive: true });
  mkdirSync(join(dir, 'Roadmap'));
  mkdirSync(join(dir, '.trash'));
  mkdirSync(join(dir, '.obsidian'));
  writeFileSync(join(dir, 'Bot', 'Commands', 'bateponto.md'), NOTE_BP);
  writeFileSync(join(dir, 'Square Cloud.md'), NOTE_SQ);
  writeFileSync(join(dir, 'Roadmap', 'Release-2.0-horas.md'), NOTE_REL);
  writeFileSync(join(dir, '.trash', 'velho.md'), '# Lixo\n\nbateponto antigo apagado, não deve aparecer nunca.');
  writeFileSync(join(dir, '.obsidian', 'app.json'), '{}');
  writeFileSync(join(dir, 'Bot', 'imagem.png'), 'x');
  app = antena.createServer({ log: () => {}, docsDir: dir, env: {} });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
});
afterAll(() => { app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('conhecimento · indexação', () => {
  it('quebra a nota por seções com título do frontmatter e wikilinks limpos', () => {
    const r = antena.chunkMarkdown(NOTE_BP, 'Bot/Commands/bateponto.md');
    expect(r.title).toBe('Cog bateponto');
    expect(r.description).toBe('Sistema de ponto por call de voz');
    expect(r.chunks.map((c) => c.heading)).toEqual(['Cog — bateponto.py', 'Cog — bateponto.py › Objetivo', 'Cog — bateponto.py › Responsabilidades']);
    expect(r.chunks[2].text).toContain('ligado a hierarquia por horas');
    expect(r.chunks[2].text).not.toContain('[[');
  });
  it('trechos longos são divididos', () => {
    const long = `# T\n\n${'linha de texto comprida sobre o bot.\n'.repeat(200)}`;
    const r = antena.chunkMarkdown(long, 'x.md', 1600);
    expect(r.chunks.length).toBeGreaterThan(3);
    expect(r.chunks.every((c) => c.text.length <= 1600)).toBe(true);
    expect(antena.chunkMarkdown('# só título', 'y.md').chunks).toEqual([]);
    expect(antena.parseFrontmatter('sem frontmatter').meta).toEqual({});
  });
  it('tokeniza sem acento, sem palavras vazias, com versões e plural simples', () => {
    expect(antena.tokenize('Como funciona a Release 2.0 dos preços?')).toEqual(['release', '2_0', 'preco']);
  });
  it('ignora .trash/.obsidian e arquivos que não são markdown; busca ranqueada', () => {
    const idx = antena.buildDocsIndex(dir);
    expect(idx.files).toBe(3);
    expect(idx.toc.map((t) => t.path)).toEqual(['Bot/Commands/bateponto.md', 'Roadmap/Release-2.0-horas.md', 'Square Cloud.md']);
    expect(antena.searchDocs(idx, 'como funciona o bateponto')[0].path).toBe('Bot/Commands/bateponto.md');
    expect(antena.searchDocs(idx, 'onde fica a hospedagem dos bots')[0].path).toBe('Square Cloud.md');
    expect(antena.searchDocs(idx, 'release 2.0')[0].path).toBe('Roadmap/Release-2.0-horas.md');
    expect(antena.searchDocs(idx, 'como qual')).toEqual([]);
    expect(antena.searchDocs(idx, 'xyzinexistente')).toEqual([]);
  });
});

describe('conhecimento · rotas da antena', () => {
  it('/docs/status e /health', async () => {
    const s = await (await fetch(`${base}/docs/status`)).json();
    expect(s).toMatchObject({ ok: true, available: true, files: 3, folders: { Bot: 1, Roadmap: 1, '(raiz)': 1 } });
    expect((await (await fetch(`${base}/health`)).json()).docs).toBe(true);
  });
  it('/docs/search e /docs/toc', async () => {
    const j = await (await fetch(`${base}/docs/search?q=${encodeURIComponent('abrir ponto na call')}&k=2`)).json();
    expect(j.results).toHaveLength(2);
    expect(j.results[0]).toMatchObject({ path: 'Bot/Commands/bateponto.md', heading: 'Cog — bateponto.py › Objetivo' });
    expect(j.results.every((r) => !r.path.includes('.trash'))).toBe(true);
    const toc = await (await fetch(`${base}/docs/toc`)).json();
    expect(toc.toc.find((t) => t.path === 'Bot/Commands/bateponto.md').title).toBe('Cog bateponto');
    expect((await (await fetch(`${base}/docs/search`)).json()).results).toEqual([]);
  });
  it('reindexa sozinho quando uma nota muda', async () => {
    writeFileSync(join(dir, 'Roadmap', 'Nova.md'), '# Planos\n\nPlano Pro custa trinta reais por mês para organizações de roleplay.\n');
    await new Promise((r) => setTimeout(r, 900));
    const j = await (await fetch(`${base}/docs/search?q=plano%20pro%20mensal`)).json();
    expect(j.results[0].path).toBe('Roadmap/Nova.md');
  });
  it('pasta inexistente → indisponível, sem quebrar', async () => {
    const s2 = antena.createServer({ log: () => {}, docsDir: join(dir, 'nao-existe'), env: {} });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    const j = await (await fetch(`http://127.0.0.1:${s2.address().port}/docs/status`)).json();
    expect(j).toMatchObject({ ok: true, available: false });
    const q = await (await fetch(`http://127.0.0.1:${s2.address().port}/docs/search?q=x`)).json();
    expect(q.results).toEqual([]);
    s2.close();
  });
});
