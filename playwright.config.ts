import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}/pixijs-3d-poc/`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Software WebGL also compiles the PBR/shadow variants on first use.
  timeout: process.env.CI ? 120_000 : 45_000,
  expect: { timeout: process.env.CI ? 30_000 : 10_000 },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    },
  },
  projects: [{ name: 'chromium', use: {
    ...devices['Desktop Chrome'],
    // Keep the desktop layout while bounding SwiftShader's pixel workload for
    // every test, so the complete suite fits the CI job's 12-minute budget.
    viewport: process.env.CI ? { width: 960, height: 600 } : { width: 1440, height: 900 },
  } }],
  webServer: {
    command: `pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
