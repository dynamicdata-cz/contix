# ADR-022: Pilotní nasazení, e2e testy a import dat

**Stav:** přijato · 3. 10. 2026

## Nasazení

1. Jeden způsob provozu – **Docker Compose** (`db`, `api`, `web` = Caddy + SPA, `backup`) – pro test i zákazníka.
   Instalace a aktualizace jen skripty `infra/scripts/install.sh` / `update.sh` (záloha před každou aktualizací).
2. Dva zdroje: **git** (testovací server s deploy key do GitLabu, obrazy se sestaví na serveru) a **balíček**
   `bundle.sh` (`docker save` obrazů pro linux/amd64 + compose bez sekcí `build` + skripty + návod) pro zákazníky
   bez přístupu do GitLabu a internetu. Obrazy mají značku verze (`CONTIX_TAG`).
3. TLS volitelně `auto` (ACME), `internal` (CA Caddy – kořenový certifikát se rozdá klientům, svazek `caddy_data`
   se zálohuje) nebo `files` (certifikát od CA zákazníka). Režim vybírá `import tls-<režim>.caddy` v Caddyfile.
4. Tajemství generuje instalace do `.env` (600); `APP_URL` odpovídá doméně a portu.

## Testy v CI

1. GitLab CI: typecheck → unit + integrační testy (PostgreSQL s pgvector, JUnit) → **e2e Playwright** (obraz
   `mcr.microsoft.com/playwright` ve verzi `@playwright/test`) → build. E2E spouští skutečné API (migrace, admin
   z env) a `vite preview` s proxy; databáze `*_e2e` se před během vytvoří znovu (`e2e-reset.ts` jiné DB odmítne).
2. E2E pokrývá hlavní průchody a otevření všech stránek menu bez chyb v konzoli (první běh odhalil chybu odhlášení).

## Import dat

1. Definice polí, mapování sloupců a převod hodnot jsou ve `shared/import.ts` (sdíleno API i UI); čtení XLSX/CSV
   bez nové závislosti (`fflate` + `fast-xml-parser`, vlastní tabulka Windows-1250 – Bun ji nemá).
2. **Zápis přes existující API** (interní požadavek s relací uživatele a cílovou společností) – stejná validace,
   oprávnění, číslování, audit a vedlejší efekty jako ruční evidence; import nemá vlastní zápisovou logiku.
3. Bezstavový průběh: náhled a zápis dostávají tentýž soubor a mapování; zápis náhled přepočítá (nic se
   neukládá mezi kroky). Existující záznamy se párují podle přirozených klíčů a mění jen vyplněnými sloupci.
