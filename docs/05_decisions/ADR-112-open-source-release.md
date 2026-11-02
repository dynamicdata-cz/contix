# ADR-112: Otevřené vydání – licence AGPL-3.0, čisté zveřejnění, ukázková data (v1.15)

## Kontext

CONTIX se uvolňuje jako open source pro pilotní zákazníky (reference). Interní repozitář v GitLabu obsahuje úplnou
historii vývoje, interní adresy testovací infrastruktury a pracovní poznámky; zákazníci potřebují instalaci a aktualizace
bez přístupu do interní sítě a možnost aplikaci vyzkoušet bez vlastních dat.

## Rozhodnutí

1. **Licence AGPL-3.0-only** (`LICENSE`, `license` v package.json, `CONTIX_LICENSE`). Chrání před převzetím kódu do uzavřené
   služby: kdo upravenou verzi zpřístupní přes síť, musí nabídnout zdrojový kód (čl. 13). Aplikace proto ukazuje verzi,
   licenci a odkaz na zdrojový kód (`CONTIX_SOURCE_URL`, `GET /api/health` → `license`, `sourceUrl`; dole v menu).
2. **GitLab zůstává hlavním repozitářem.** Do veřejného repozitáře se přenáší jen vydání skriptem `infra/scripts/publish.sh`:
   `git archive` revize (respektuje `export-ignore` v `.gitattributes`) → kontrola `publish-scan.ts` → jeden commit
   „CONTIX <verze>“ s poznámkami z `CHANGELOG.md` a tag `v<verze>`. Historie, autoři interních commitů a pracovní větve
   se nezveřejňují; větev `main` veřejného repozitáře = poslední vydání (instalace a `update.sh` přes `git pull`).
3. **Kontrola před zveřejněním** (`publishScan.ts`): vestavěné vzory tajemství (soukromé klíče, tokeny GitLab/GitHub/OpenAI/AWS/
   Slack/CONTIX, JWT, hesla v konfiguraci a dokumentaci), zakázané soubory (`.env`, klíče, certifikáty) a velikost; interní
   údaje z **lokálního** seznamu zákazů mimo repozitář (`~/.config/contix/publish-deny.txt` / `CONTIX_PUBLISH_DENY`).
   Výňatky tajemství se nevypisují celé. Nález = nic se nezapíše. Výjimka na řádku jen komentářem `publish-scan: allow`.
4. **Ukázková data** `bun run demo:seed` (`scripts/demoData.ts`): fiktivní společnost skupiny „Vzorová strojírna a.s. (ukázka)“,
   vše přes API (validace, oprávnění, audit), adresy z dokumentačního rozsahu 192.0.2.0/24, žádné skutečné osoby ani firmy;
   idempotentní podle názvu společnosti. CLI použije krátkou relaci aktivního administrátora a po dokončení ji smaže.
5. Interní údaje v dokumentaci a testech nahrazeny příklady (192.0.2.x, `<skupina>`, `contix-test`, `ai-server`).
6. Veřejný repozitář: README (cs + krátce en), `SECURITY.md` (soukromé hlášení přes GitHub), `CONTRIBUTING.md`
   (příspěvky pod AGPL-3.0 s DCO, `git commit -s`), šablony issue / PR, GitHub Actions (`.github/workflows/ci.yml`, obdoba GitLab CI).

## Důsledky

- Nový soubor s tajemstvím nebo interní adresou zastaví zveřejnění, ne až únik. Seznam zákazů je nutné udržovat lokálně.
- Příspěvky z GitHubu se převezmou do GitLabu a vyjdou v dalším vydání (veřejný repozitář nemá vlastní vývojové větve).
- Při případném duálním (komerčním) licencování by bylo třeba místo DCO zavést CLA – rozhodnutí odloženo.
