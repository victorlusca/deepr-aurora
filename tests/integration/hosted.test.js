import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const antena = require('../../server.js');

const PASS = 'senha-forte-de-teste';
const basic = (p, u = 'qualquer') => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

let dir, app, base;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aurora-hosted-'));
  writeFileSync(join(dir, 'app.html'), '<!doctype html><title>Aurora</title>');
  app = antena.createServer({ log: () => {}, env: {}, docsDir: join(dir, 'sem-docs'), appFile: join(dir, 'app.html'), password: PASS });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
});
afterAll(() => { app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('modo hospedado · senha', () => {
  it('sem senha → 401 pedindo Basic; com a senha → app e API', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/^Basic realm="Aurora"/);
    expect((await fetch(`${base}/health`)).status).toBe(401);
    const ok = await fetch(`${base}/`, { headers: { authorization: basic(PASS) } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/text\/html/);
    expect(ok.headers.get('x-frame-options')).toBe('DENY');
    expect(await ok.text()).toContain('<title>Aurora</title>');
    expect((await fetch(`${base}/health`, { headers: { authorization: basic(PASS, '') } })).status).toBe(200);
    expect(app.locked).toBe(true);
  });
  it('a página servida pela antena pode chamar a API (mesma origem); outros sites não', async () => {
    const host = new URL(base).host;
    const same = await fetch(`${base}/health`, { headers: { authorization: basic(PASS), origin: `http://${host}` } });
    expect(same.status).toBe(200);
    const evil = await fetch(`${base}/health`, { headers: { authorization: basic(PASS), origin: 'https://site-malicioso.com' } });
    expect(evil.status).toBe(403);
  });
});

describe('modo hospedado · bloqueio por tentativas', () => {
  const req = (auth, ip = '1.1.1.1') => ({ headers: { authorization: auth, 'x-forwarded-for': `forjado, ${ip}` }, socket: {} });
  it('10 erros bloqueiam o IP por 15 min, mesmo com a senha certa; outro IP segue livre', () => {
    let t = 0;
    const gate = antena.createGate(PASS, { now: () => t });
    expect(gate.check(req(undefined))).toBe('denied');
    for (let i = 0; i < 10; i++) expect(gate.check(req(basic('errada')))).toBe('denied');
    expect(gate.check(req(basic(PASS)))).toBe('blocked');
    expect(gate.check(req(basic(PASS), '2.2.2.2'))).toBe('ok');
    t = 15 * 60000 + 1;
    expect(gate.check(req(basic(PASS)))).toBe('ok');
  });
  it('acerto zera os erros; sem senha configurada, tudo passa', () => {
    const gate = antena.createGate(PASS, { maxFails: 2 });
    gate.check(req(basic('x')));
    gate.check(req(basic(PASS)));
    expect(gate.check(req(basic('x')))).toBe('denied');
    expect(gate.check(req(basic(PASS)))).toBe('ok');
    expect(antena.createGate('').check(req(undefined))).toBe('ok');
    expect(antena.createGate(PASS).check(req('Bearer abc'))).toBe('denied');
  });
});

describe('modo hospedado · onde escutar', () => {
  it('local por padrão; fora do loopback exige senha de 12+', () => {
    expect(antena.listenConfig({})).toEqual({ host: '127.0.0.1', port: 4242 });
    expect(antena.listenConfig({ AURORA_PORT: '5000' })).toEqual({ host: '127.0.0.1', port: 5000 });
    expect(antena.listenConfig({ AURORA_HOST: '0.0.0.0', PORT: '80' }).erro).toMatch(/AURORA_PASSWORD/);
    expect(antena.listenConfig({ AURORA_HOST: '0.0.0.0', PORT: '80', AURORA_PASSWORD: 'curta' }).erro).toBeTruthy();
    expect(antena.listenConfig({ AURORA_HOST: '0.0.0.0', PORT: '80', AURORA_PASSWORD: PASS })).toEqual({ host: '0.0.0.0', port: 80 });
  });
  it('sem app gerado → 404 com dica', async () => {
    const s = antena.createServer({ log: () => {}, env: {}, docsDir: join(dir, 'x'), appFile: join(dir, 'nao-existe.html') });
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const r = await fetch(`http://127.0.0.1:${s.address().port}/`);
    expect(r.status).toBe(404);
    expect((await r.json()).mensagem).toMatch(/npm run build/);
    s.close();
  });
});

