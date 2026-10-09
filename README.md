# Aurora

Assistente de voz pessoal no estilo Jarvis: um orbe que reage à fala, Second Brain, agenda, e-mails, notícias, briefing diário e uma **base de conhecimento** (suas notas em Markdown, como um vault do Obsidian).

- `dist/jarvis.html` — o app. **Arquivo único**: abre com dois cliques, sem instalar nada.
- `server.js` — a antena (Node puro, sem dependências). Busca agenda, notícias e e-mails, indexa a base de conhecimento e repassa a telemetria. Roda **no seu PC** ou **hospedada na SquareCloud**.

## Primeiros passos

```bash
npm install
cp src/profile/example.js src/profile/local.js   # seu perfil: nome, cidade, fuso, Second Brain…
npm run build                                    # → dist/jarvis.html
node server.js                                   # antena em 127.0.0.1:4242
```

Abra `http://127.0.0.1:4242` (ou o `dist/jarvis.html` com dois cliques) no Chrome ou no Edge, cole a chave da OpenAI no campo do topo (ela fica só no navegador), clique em **► ATIVAR SISTEMA** e diga **"Ei Aurora, bom dia"**.

### Dados pessoais ficam fora do git

| Arquivo | O que tem | No git? |
|---|---|---|
| `src/profile/example.js` | perfil fictício (usado pelos testes e pelo CI) | sim |
| `src/profile/local.js` | **seu** perfil e o seu Second Brain inicial | não |
| `.env` / `.env.square` | pasta de notas, senha da hospedagem, telemetria | não |
| `dist/`, `*.zip` | build e pacote com o seu perfil | não |
| navegador (localStorage) | chave da OpenAI, senhas de app dos e-mails, links iCal | nunca sai dele, a não ser para a antena |

O `npm run build` usa o `local.js` quando ele existe e o `example.js` quando não existe.

### Agenda e e-mails (⚙ no app)

- **Agenda**: no Google Agenda, vá em ⚙ Configurações → (sua agenda) → "Integrar agenda" e copie o **endereço secreto em formato iCal**.
- **Gmail**: ative a verificação em 2 etapas e crie uma **senha de app** em myaccount.google.com/apppasswords. Não é a sua senha normal.
- **Outlook**: senha de app em account.microsoft.com/security. **Domínio próprio na Hostinger**: a senha da própria caixa.

A Aurora só **lê** os e-mails: nunca envia, responde, apaga ou marca nada.

## Hospedar na SquareCloud

A antena serve o próprio app e fica protegida por senha (HTTP Basic, comparação em tempo constante, bloqueio de 15 min após 10 erros por IP). Sem `AURORA_PASSWORD` ela se recusa a escutar fora do seu PC.

1. `cp .env.square.example .env.square` e preencha `AURORA_PASSWORD` (12+ caracteres). Se quiser a base de conhecimento junto, preencha também `DOCS_DIR`.
2. Rode `npm run pack:square`. Ele faz o build com o seu perfil e gera o `aurora-square.zip`, com:
   ```
   server.js · dist/jarvis.html · squarecloud.app · package.json (sem dependências)
   .env (AURORA_HOST=0.0.0.0, PORT=80, sua senha) · knowledge/ (suas notas .md)
   ```
3. Envie o zip em **squarecloud.app/dashboard → Upload** (ou use `npx @squarecloud/cli upload aurora-square.zip`). O `squarecloud.app` já define site, porta 80, 512 MB e reinício automático. Troque o `SUBDOMAIN` se o nome estiver ocupado.
4. Abra `https://<subdominio>.squareweb.app`. O navegador pede usuário e senha: o usuário pode ser qualquer um, a senha é a do `.env.square`. O HTTPS da SquareCloud libera o microfone.

> O zip contém o seu perfil e a senha. Ele está no `.gitignore`: não faça commit e não compartilhe.
> Para atualizar a hospedagem, rode `npm run pack:square` de novo e reenvie o zip.

## Comandos de voz

"Ei Aurora" + o comando. Por 8 s depois de cada resposta dá para seguir sem repetir "Ei Aurora".

| Comando | O que faz |
|---|---|
| bom dia | briefing: clima, agenda, e-mails de ação, manchetes, foco |
| minha agenda · o que eu tenho hoje | compromissos de hoje |
| próximo compromisso | próximo evento e quanto falta |
| agenda da semana | resumo dos próximos 7 dias |
| meus e-mails · tem e-mail importante? | caixa por balde ou só os de ação |
| notícias · notícias de {assunto} | manchetes do radar ou de qualquer assunto |
| previsão do tempo · vai chover? | clima da sua cidade |
| atualizar e-mails · atualizar notícias | força a atualização |
| qualquer outra pergunta | IA com Second Brain, agenda, e-mails e base de conhecimento |

Só a última linha usa a API. Os outros comandos não gastam nada.

## Base de conhecimento

A antena lê a pasta `DOCS_DIR` (padrão: `./knowledge`), quebra as notas por seção e mantém um índice de busca (BM25, português). Edições nas notas reindexam sozinhas. A cada pergunta, só os trechos relevantes entram no prompt. Status e busca de teste ficam em ⚙ → Conhecimento.

## Observabilidade

Spans e logs no padrão **OpenTelemetry** (OTLP/JSON) e erros no formato **Sentry**, sem SDK. O navegador manda para a antena, que repassa para os destinos configurados no `.env` (modelo em `.env.example`):

| Destino | Variável |
|---|---|
| OpenTelemetry Collector / Grafana / Honeycomb | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` |
| Datadog (via Agent) | `DD_OTLP_ENDPOINT` |
| New Relic | `NEW_RELIC_LICENSE_KEY` |
| Sentry | `SENTRY_DSN` |

Antes de sair, tudo passa por uma limpeza: chaves, senhas e links iCal são removidos, e os e-mails aparecem mascarados.

## Desenvolvimento

O npm é **só para desenvolver**. O app e a antena continuam sem dependências.

```bash
npm run build        # src/ → dist/jarvis.html (esbuild + CSS + fonte embutidos)
npm run dev          # build observando src/
npm run lint         # Biome
npm run arch         # contrato de arquitetura (dependency-cruiser)
npm run knip         # código e dependências mortas
npm test             # Vitest: unitários + integração
npm run coverage     # cobertura (enviada ao Codecov no CI)
npm run test:e2e     # Playwright num build com o perfil de exemplo
npm run mutation     # Stryker
npm run check        # tudo acima, em ordem
npm run pack:square  # zip para a SquareCloud
```

A mutação completa é pesada. Para rodar só um arquivo, apenas com os testes dele:

```bash
STRYKER_TESTS=tests/unit/triage.test.js npx stryker run --mutate src/core/triage.js
```

```
src/core/     lógica pura (sem DOM nem rede): agenda iCal, visemas, comandos, triagem, memória, prompt, telemetria, docs
src/app/      interface: orbe WebGL, voz, painéis, configurações, observabilidade
src/profile/  example.js (público) · local.js (seu, fora do git)
src/styles/   CSS · src/assets/ fonte Nunito (OFL)
server.js     antena · scripts/ build e pacote · tests/ unit · integration · e2e
```

Regras do contrato de arquitetura:

- `src/core` não importa `src/app` nem módulos do Node.
- `src/profile` é só dados.
- `server.js` não importa nada de `src/`.
- Nenhum pacote npm em tempo de execução.
- Sem ciclos.

O movimento segue a skill *design-motion-principles*: entradas com opacidade, deslocamento e blur; saídas mais discretas; esqueletos de carregamento; carregamento sob demanda. O `prefers-reduced-motion` é respeitado em tudo.
