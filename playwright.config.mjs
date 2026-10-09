import { defineConfig } from '@playwright/test';

// E2E no dist/e2e.html (build com o perfil de exemplo) (file://), sem antena e com a OpenAI simulada.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1360, height: 860 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure'
  }
});
