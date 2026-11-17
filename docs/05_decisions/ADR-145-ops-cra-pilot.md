# ADR-145: Test obnovy v Provozu, SBOM a security.txt CONTIXu, export přehledu skupiny, import organizace (v1.48)

## Kontext

Před pilotními nasazeními chyběly: doklad o pravidelném testu obnovy (§ 26 vyhl. 409, SOC 2 A1.3) jinde než
v ruční poznámce, soupis komponent CONTIXu pro zákazníky a CRA (CONTIX je produkt s digitálními prvky),
souhrn skupiny pro vedení mimo obrazovku a hromadné založení organizační struktury, na které stojí garanti,
vlastníci rizik a RACI.

## Rozhodnutí

1. `backup_runs.kind` (`backup` / `restore_test`, migrace 0105). `restore.sh --test` zapíše výsledek (OK s počty
   tabulek, uživatelů, rizik a migrací, nebo chybu pg_restore). Kontrola Provozu `restore_test`: žádný test nebo
   úspěšný starší než `RESTORE_TEST_MAX_DAYS` (92) = varování, poslední neúspěšný = chyba. Stav zálohy počítá jen
   `kind = backup`. Automatický test se nespouští – šifrované zálohy nejde obnovit bez privátního klíče, který na
   serveru být nemá.
2. SBOM: `lib/sbom.ts` skládá CycloneDX 1.6 z `bun.lock` – jen produkční závislosti workspace api, web a shared
   (tranzitivně, vnořené verze „a/b“), purl `pkg:npm`, SHA-512 z integrity, licence z `node_modules` (hoisted
   i izolované). `GET /api/ops/sbom` (admin:settings, audit), skript `src/scripts/sbom.ts`, artefakt CI `build`.
   Obraz API obsahuje `bun.lock`.
3. `/.well-known/security.txt` (RFC 9116) z API přes Caddy: `SECURITY_CONTACT` provozovatele, jinak soukromé
   hlášení u výrobce; Expires +180 dní, Policy = SECURITY.md.
4. CI job `audit`: `bun audit --audit-level=high` zastaví pipeline při vysoké / kritické zranitelnosti.
5. `GET /guides/group.xlsx`: list „Přehled skupiny“ (ukazatele z `groupOverview`, vytaženo z `/companies/overview`)
   a list „Cesta k souladu“ po průvodcích; respektuje oprávnění jako obrazovky; audit `group.exported`.
6. Import `positions` (Útvary a funkční místa): útvar podle názvu / kódu, chybějící se při zápisu založí jednou přes
   `POST /org/units`; místo se páruje podle kódu nebo útvaru + názvu; držitelé seznamem e-mailů (`users`),
   neznámé e-maily jen varování. Zápis jako vždy přes stejná API jako ruční evidence.
7. Kontrolní seznam pilotu `docs/04_operations/pilot.md`.

## Důsledky

Migrace 0105 (sloupec s výchozí hodnotou, bez přepisu dat). Nový job CI může pipeline zastavit i bez změny kódu
(nová advisory) – oprava je `bun audit fix` a nová verze.
