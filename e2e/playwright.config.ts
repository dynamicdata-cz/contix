import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end testy CONTIX (prohlížeč → web → API → PostgreSQL).
 * Lokálně:  E2E_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_e2e bunx playwright test -c e2e
 * Databáze (název musí končit na _e2e) se před během vyprázdní.
 */
const DB = process.env.E2E_DATABASE_URL ?? "postgres://contix:contix@localhost:5432/contix_e2e";
const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
const WEB = "http://localhost:4173";
export const ADMIN = { email: "admin@e2e.test", password: "E2e-Heslo-Spravne-2026!" };
/** Náhradní CELLAR (EUR-Lex) – spouští ho test legislativy EU. */
export const CELLAR_PORT = Number(process.env.E2E_CELLAR_PORT ?? 3199);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: false,
  workers: 1,
  // testy na sebe navazují (sdílená stránka a data) – opakování by zakládalo duplicitní záznamy a maskovalo skutečnou chybu
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["junit", { outputFile: "../test-results/e2e-junit.xml" }], ["html", { outputFolder: "../playwright-report", open: "never" }]] : "list",
  outputDir: "../test-results/e2e",
  use: {
    baseURL: WEB,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: "bun src/scripts/e2e-reset.ts && bun src/db/migrate.ts && bun src/index.ts",
      cwd: "../apps/api",
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: DB,
        PORT: String(API_PORT),
        NODE_ENV: "development",
        APP_URL: WEB,
        CORS_ORIGINS: WEB,
        APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
        ADMIN_EMAIL: ADMIN.email,
        ADMIN_PASSWORD: ADMIN.password,
        EURLEX_SPARQL_URL: `http://127.0.0.1:${CELLAR_PORT}/sparql`,
      },
    },
    {
      command: "bunx vite build && bunx vite preview --strictPort",
      cwd: "../apps/web",
      url: WEB,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
