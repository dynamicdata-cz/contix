# ADR-108: Bezpečnost CONTIXu – závislosti, SBOM ze zámků, bezpečnostní hlavičky

**Stav:** přijato (v1.12)

## Kontext

Kontrola závislostí (`bun audit`) našla zranitelné verze Hono (`serveStatic`, GHSA-5r4p-p66f-jhc7) a Vite
(vývojový server). Web neměl Content-Security-Policy a API vracelo nahrané soubory a tiskové HTML bez výchozí CSP.
Modul CRA uměl načíst jen CycloneDX / SPDX JSON, i když většina týmů má po ruce zámek závislostí.

## Rozhodnutí

- **Závislosti**: Hono ^4.13.13, Vite ^8.3.5. Zbývá esbuild 0.18 uvnitř `drizzle-kit` (jen vývojový nástroj pro
  generování migrací, nespouští se v provozu) – přijato, kontrolovat při aktualizaci drizzle-kit.
- **SBOM ze zámků**: `parseSbom` čte i `bun.lock` (JSON s čárkami na konci), `package-lock.json` v2/v3 a
  `requirements.txt` (aspoň jeden řádek s verzí); purl `pkg:npm/…` (scope `%40`) a `pkg:pypi/…` pro porovnání s OSV.
- **CSP webu** v `infra/proxy/Caddyfile` (jen statický web): `default-src 'self'`, skripty jen z vlastního původu,
  styly `'unsafe-inline'` (atributy style z Reactu a bpmn-js), `frame-ancestors 'none'`. `vite preview` čte tutéž
  hlavičku z Caddyfile, takže všechny e2e testy běží s produkční politikou (porušení = chyba v konzoli = pád testu).
  Dále `Permissions-Policy`, `Cross-Origin-Opener-Policy`, dlouhé cachování `/assets/*`.
- **CSP API** (`API_CSP` v `app.ts`): `default-src 'none'` bez skriptů pro všechny odpovědi, které si nenastaví
  vlastní (stahování souborů má dál `sandbox`).

## Důsledky

Nová externí knihovna ve webu nesmí potřebovat inline skripty, `eval` ani cizí domény – jinak upravit CSP
v Caddyfile (a e2e to ověří). Tiskové HTML z API nesmí obsahovat `<script>`.
