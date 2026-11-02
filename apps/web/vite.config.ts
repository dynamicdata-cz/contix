import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

/** CSP z produkční proxy (infra/proxy/Caddyfile) – e2e testy přes vite preview běží se stejnou politikou (ADR-108). */
const CSP = (() => {
  try {
    return readFileSync(new URL("../../infra/proxy/Caddyfile", import.meta.url), "utf8").match(/header Content-Security-Policy "([^"]+)"/)?.[1];
  } catch {
    return undefined; // sestavení v Dockeru Caddyfile nekopíruje – preview se tam nepoužívá
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: {
    port: 5173,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:3000", "/dav": process.env.API_URL ?? "http://localhost:3000" },
  },
  // vite preview (e2e testy) – stejná proxy na API
  preview: {
    port: 4173,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:3000" },
    headers: CSP ? { "Content-Security-Policy": CSP } : {},
  },
});
