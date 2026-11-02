# Změny (CHANGELOG)

Přehled vydání CONTIXu. Podrobnosti ke každé změně jsou v rozhodnutích [docs/05_decisions](docs/05_decisions/) (ADR).

## 1.24.5

- `publish.sh`, `bundle.sh`, `lib.sh`: proměnné před znakem „…“ ve složených závorkách – výchozí bash 3.2 na macOS jinak hlásil „unbound variable“.

## 1.24.4

- Veřejný repozitář: `github.com/dynamicdata-cz/contix` – adresa v README, návodu k instalaci, dokumentaci CI, `publish.sh` a `server.env.example`.
- Odkaz na zdrojový kód (AGPL) v `/api/health` a v menu je výchozí `https://github.com/dynamicdata-cz/contix`; `CONTIX_SOURCE_URL` ho přepíše (např. u upravené verze).

## 1.24.3

- Administrace: boční menu se skupinami a ikonami (Uživatelé a přístup, Organizace, Integrace, Provoz), obsah vpravo; na úzké obrazovce rozbalovací výběr stránky.

## 1.24.2

- Administrace: odkazy seskupené podle oblasti (Uživatelé a přístup, Organizace, Integrace, Provoz) a zalomené do řádků – bez vodorovného posuvníku, i na menších obrazovkách.

## 1.24.1

- Pravidla projektu přejmenována z `CLAUDE.md` na `AGENTS.md` (otevřená konvence pro AI asistenty, nezávislá na dodavateli); odkazy v README, CONTRIBUTING, SECURITY a dokumentaci upraveny.

## 1.24.0

Vývoj rizik v čase a přehled skupiny (ADR-121).

- Nové měsíční ukazatele trendů: střední a nízká rizika, pokrytí katalogu hrozeb, neposouzené hrozby, slabé schopnosti, rizika nad ochotou, překročené KRI, slepá místa detekce.
- Karta **Vývoj rizik v čase** na stránce Ochota riskovat a KRI.
- **Přehled skupiny společností** z posledních měsíčních snímků (jen společnosti s oprávněním číst rizika).

## 1.23.0

Ochota riskovat a klíčové ukazatele rizik (ADR-120).

- Nová stránka **Ochota riskovat a KRI** (Rizika → tlačítko): nejvyšší přijatelná úroveň rizika pro důvěrnost, integritu, dostupnost a dodavatele s vyjádřením vedení, schválení (kdo a kdy), označení změny po schválení.
- Přehled rizik nad ochotou riskovat (kategorie z CIA hrozeb a vazby na dodavatele), upozornění u rizik bez zvládání.
- Sedm KRI z dat (MFA, EDR, KEV z internetu, zranitelnosti po termínu, neotestovaná obnova, neposouzené hrozby, podněty po termínu) s nastavitelnými prahy; datum překročení, denní přepočet v plánovači.
- Nový podnět k přehodnocení **Překročený ukazatel KRI** u rizik s přijatým scénářem, jehož schopnost ukazatel sleduje.
- Ochota a KRI ve zprávě o hodnocení rizik (část 8) a ve zprávě o přezkoumání ISMS.

## 1.22.0

Pokrytí technik MITRE ATT&CK detekcí (ADR-119).

- Nová záložka **Detekce ATT&CK** u scénářů z dat: techniky ze šablon se stavem zachyceno (alerty SOC za 90 dní), plánované hledání hrozeb, deklarované pravidlo SIEM / EDR, slepé místo; deklarace se zdrojem, poznámkou, autorem a auditem.
- Slepá místa ovlivní scénáře: když se detekce měří a většina technik scénáře je slepá, úroveň zranitelnosti návrhu +1 se zdůvodněním.
- Zpráva o hodnocení rizik: část 7.7 s pokrytím technik a výčtem slepých míst.

## 1.21.0

Rozšířená knihovna scénářů z dat (ADR-118).

- Šest nových šablon: zneužití oprávnění zevnitř, výpadek služby dostupné z internetu, chybná konfigurace cloudu a Microsoft 365, kompromitace softwarové komponenty / dodavatele softwaru, napadení OT a průmyslových systémů, ztráta nebo krádež zařízení (celkem 14).
- Nové signály z dat: podpůrná aktiva s vysokou dostupností bez redundance, nesplněný monitor Microsoft Secure Score, kritické / vysoké zranitelnosti v aplikacích a komponentách, zranitelná nebo vystavená OT / IoT zařízení.
- Šablony s podmínkou rozsahu (typ aktiva, dostupnost z internetu) – návrh vznikne jen tam, kde dává smysl.

## 1.20.0

Plán zvládání a zbytkové riziko z dat (ADR-117).

- Návrh zbytkového rizika bere v úvahu důkazy: opatření s neúčinným posledním testem nebo nesplněným průběžným monitorem se nezapočte, poslední test „účinné s výjimkami“ sníží účinnost na částečnou; zdůvodnění je v návrhu.
- Nový podnět k přehodnocení rizika **Nesplněný monitor opatření** (silný u opatření vedeného jako účinné; zvyšuje návrh úrovně zranitelnosti).
- **Návrhy akcí plánu z dat** na záložce Zvládání: zavést navázané opatření, obnovit účinnost opatření, posílit / doložit slabé schopnosti z přijatých scénářů – výběr, odpovědné místo a termín, akce vzniknou až po potvrzení, bez duplicit.
- Pokrytí katalogu hrozeb: u neposouzené hrozby tlačítko **Úkol** (úkol navázaný na aktivum).

## 1.19.0

Analýza rizik z dat ve zprávě o hodnocení rizik (ADR-116).

- Zpráva o hodnocení rizik má novou část **7. Analýza rizik z dat**: profil bezpečnostních schopností (stav, zdroj – změřeno / deklarováno, pokrytí, produkt a platnost deklarace), pokrytí katalogu hrozeb po primárních aktivech s výčtem neposouzených hrozeb, hrozby vyloučené jako nerelevantní se zdůvodněním a autorem, rozhodnuté scénáře z dat, přehodnocení rizik v hodnoceném období s podněty a otevřené podněty s termínem.
- Stav se zmrazí ve snímku verze (náhled, tisk, Word); část se přidá jen u společností s primárními aktivy nebo scénáři z dat.
- Ukazatele verzí: pokrytí katalogu hrozeb (%) a neposouzené hrozby s rozdílem proti předchozí verzi.

## 1.18.0

Pokrytí katalogu hrozeb a průběžné přehodnocení scénářů z dat (ADR-115).

- Nová záložka **Pokrytí katalogu hrozeb** u rizikových scénářů: primární aktivum × aktivní hrozba z katalogu se stavem pokryto rizikem (i přes podpůrná aktiva a další hrozby scénáře), návrh z dat, nerelevantní se zdůvodněním, neposouzeno; souhrn podílu posouzených kombinací.
- Zdůvodnění „nerelevantní hrozby“ s autorem a datem, zápis do auditního záznamu; při přesunu aktiva do jiné společnosti jde s aktivem.
- Nový podnět k přehodnocení rizika **Změna dat scénáře**: u přijatých a navázaných návrhů, když se doložené skutečnosti změní po posledním hodnocení rizika (silný, když návrh vychází výš). Potvrzení nebo změna hodnocení podnět uzavře.
- Plánovač jednou denně obnoví návrhy scénářů u společností, které je používají (jen návrhy, nikdy rizika).

## 1.17.0

Rizikové scénáře z dat (ADR-114).

- Profil bezpečnostních schopností měřený z dat CONTIXu: EDR (agent Wazuh), MFA a privilegované přístupy (AD / Entra ID), segmentace, správa zranitelností (KEV z internetu, po termínu, EOL), hardening (SCA), zálohy a obnova (BIA a testy plánů), dodavatelé – stav, pokrytí, odkaz na zdroj a související požadavky ISO / NIS2 / CIS / vyhlášky.
- Deklarace schopností s produktem, poznámkou, důkazem a platností tam, kde data chybí; upozornění na rozpor s daty.
- Knihovna 8 šablon scénářů s hrozbami a zranitelnostmi z katalogu vyhlášky a technikami ATT&CK; návrhy pro primární aktiva jen tam, kde data dokládají slabinu – dopad, hrozba a zranitelnost se zdůvodněním a doklady, stávající opatření.
- Rozhodnutí: přijmout jako riziko, navázat na existující, zamítnout se zdůvodněním (při nové skutečnosti se návrh znovu otevře).
- Ukázková data obsahují deklarace schopností a návrhy scénářů.

## 1.16.0

CRA pro dovozce a distributory (ADR-113).

- Kontrola dokladů výrobce u produktů s rolí dovozce / distributor: označení CE, EU prohlášení o shodě, informace a pokyny podle přílohy II, údaje dovozce, u dovozce technická dokumentace a posouzení shody – stav, poznámka, odkaz, přiložené soubory, kdo a kdy ověřil.
- Nové mezery: neověřené doklady, chybějící datum konce podpory výrobce, chybějící zdroj informací o zranitelnostech; konec podpory se hlídá i u dovozce / distributora.
- Oznámení výrobců ve formátu CSAF 2.0 (záložka Oznámení výrobců): párování na produkty podle CPE nebo výrobce, názvu a verze (i rozsahy verzí), nálezy se stavem a nápravou podle výrobce; vlastní posouzení VEX se novou revizí nepřepíše.
- CPE 2.3 u produktu a volitelné dohledání zranitelností v NVD (výchozí vypnuto, odchází jen CPE).
- Přesun produktu do jiné společnosti přenese i nálezy zranitelností.

## 1.15.4

- E2E: bez opakování testů (navazují na sebe), test síťového skenu se bez nmap přeskočí.

## 1.15.3

- E2E: výsledek externí kontroly se v testu posílá přes Playwright (v kontejneru CI poslouchá náhled jen na IPv6), test aktiva odolný proti opakování v CI.

## 1.15.2

- CI: adresář pro výsledky testů (JUnit) se vytvoří před spuštěním testů.

## 1.15.1

- CI: kontrola tajemství v repozitáři se bez gitu v obrazu (oven/bun) přeskočí místo pádu testů.

## 1.15.0

Otevřené vydání – CONTIX pod licencí AGPL-3.0 (ADR-112).

- Licence AGPL-3.0, verze, licence a odkaz na zdrojový kód v menu aplikace (`CONTIX_SOURCE_URL`).
- Ukázková data `bun run demo:seed` – fiktivní společnost s organizací, aktivy, procesy, riziky, opatřeními, dodavateli a úkoly.
- Zveřejnění vydání do veřejného repozitáře `infra/scripts/publish.sh` s kontrolou tajemství a interních údajů.
- Dokumentace pro veřejný repozitář: README, SECURITY, CONTRIBUTING, šablony hlášení, GitHub Actions.

## 1.14.1 (2026-10-25)

- CI stability - no source request spacing in tests, longer per-test timeout in GitLab CI

## 1.14 (2026-10-23)

- Wazuh rule tuning agent phase 1 - data-driven proposals, indexer simulation, four-eyes approval, rules export

## 1.13.2 (2026-10-23)

- legal text sources - no false changes on source switch, source shown, admin choice, ops warning

## 1.13.1 (2026-10-23)

- e-Sbirka open data - designations as literals or in named graphs, keyless web JSON fallback

## 1.13 (2026-10-23)

- automated evidence - GRC data monitors, external checks with token, task on failure

## 1.12.3 (2026-10-23)

- e-Sbirka open data - discover renamed fragment properties, work without order property

## 1.12.2 (2026-10-23)

- legislation sync - fix open data regression, fall back to older version until new text arrives, diagnostics

## 1.12.1 (2026-10-23)

- e-Sbirka fragments - tolerant response parsing, 1-based paging, base URL fallback, diagnostics

## 1.12 (2026-10-23)

- CONTIX security - dependency updates, SBOM from lock files, CSP and security headers

## 1.11 (2026-10-23)

- more links and exceptions - compensating controls, AI system risks and controls, SOC 2 CSOC from supplier reports

## 1.10 (2026-10-23)

- one work queue - My work tabs, bulk task changes, position page with handover

## 1.09 (2026-10-23)

- performance and lists - route-level code splitting, lazy English pack, sorting and saved views for risks, controls and suppliers

## 1.08 (2026-10-23)

- visual refresh - dark mode, refined UI primitives, KPI strip with sparklines, record detail sticky header and tabs

## 1.07 (2026-10-23)

- AI knowledge base - new vector kinds, knowledge articles, index management, HNSW and prefix full-text search

## 1.06 (2026-10-23)

- UI comfort - Ctrl+K quick search, list filters and tabs in URL, confirm dialog and toasts, modal focus/Escape, unsaved-changes guard, mobile menu

## 1.05 (2026-10-23)

- record links - clickable linked records, backlinks card (where is this record used), CRA product links and risk from finding, audit finding to control

## 1.04.1 (2026-10-23)

- OSV download runs in background (202 + status polling, lease), no empty network errors

## 1.04 (2026-10-23)

- customer security questionnaires (import, answer library, AI proposals with sources, approval, XLSX export) and Trust Center (public page, NDA access requests, tokenized stamped PDFs)

## 1.03 (2026-10-23)

- supplier assurance reports (SOC 2/SOC 1/ISO 27001) – CUEC mapping to own controls, exceptions to supplier risks, AI extraction, gaps, validity obligations

## 1.02 (2026-10-23)

- vuln import from CI/CD (API token, failOn gate), metrics, Qualys and Dependency-Track parsers, read-only DefectDojo connector, regrouped navigation

## 1.01 (2026-10-23)

- continuous control monitoring (monitors, immutable runs, period tests for SOC 2 Type II, Secure Score)

## 1.00 (2026-10-22)

- scanner imports (Nessus, OpenVAS, Burp, ZAP, Nuclei, Trivy, Grype, SARIF, CSV), reimport lifecycle, dedup, triage states, exposure priority, AI scan triage

## 0.99 (2026-10-22)

- AI automatizace (screening AI Act, triáž VEX, triáž incidentů), vektory a vazby modulů

## 0.98 (2026-10-22)

- CRA component vulnerabilities – offline OSV database (download per ecosystem or upload), local SBOM matching by purl and version, KEV / EPSS flags, VEX statements and OpenVEX / CycloneDX VEX export, Art. 14 notification from KEV findings (ADR-093)

## 0.97 (2026-10-22)

- Cyber Resilience Act – products with digital elements (role, Annex III/IV category, conformity assessment options, support period, CVD contact), Annex I and role-based requirements, SBOM import (CycloneDX / SPDX JSON), Art. 14 notifications with 24 h / 72 h / final report deadlines and SRP text, obligations (ADR-092)

## 0.96 (2026-10-22)

- SOC 2 engagement – Type I / Type II scope, criteria matrix (controls, tests in scope, samples, exceptions), auditor workpapers, standard PBC requests, system description with CUECs and subservice organisations, readiness check, Word report (sections I–V), TSC ↔ Decree 409 / ISO 27001 mapping (ADR-091)

## 0.95 (2026-10-22)

- AI Act module – AI system register, prohibited practices screening, risk classification (Annex I/III, Art. 6(3), Art. 50), deployer and provider obligations, approval of use, FRIA, AI directive template with employee summary and AI literacy course (ADR-090)

## 0.94 (2026-10-22)

- info service – DE/EN/SK item recognition, default kind per feed, web page sources without RSS (CSIRT.CZ), bulk NÚKIB PDF reports (ADR-089)

## 0.93 (2026-10-22)

- impact review of regulator warnings – status, owner, due date, affected assets with suggestions, follow-up risk / task / event; feed publisher and country (ADR-088)

## 0.92.5 (2026-10-22)

- info service – clearer error when a feed address returns a web page instead of RSS

## 0.92.4 (2026-10-22)

- NÚKIB month entry – month picker first, one "Propose figures for <month>" button (news item or website lookup), optional PDF upload

## 0.92.3 (2026-10-22)

- AI proposal for any month – NÚKIB monthly report looked up by file naming on nukib.gov.cz

## 0.92.2 (2026-10-22)

- NÚKIB month entry – month and year pickers (Safari), report and month stay in sync, form resets on month change

## 0.92.1 (2026-10-22)

- NÚKIB monthly report proposal – canonical severity and class names, no remainder into "Ostatní", swapped-severity check

## 0.92 (2026-10-22)

- current NÚKIB incident statistics – manual monthly figures and AI proposal from the monthly PDF report (ADR-087)

## 0.91.2 (2026-10-22)

- incident open data – stale data notice, distinct label for grouped categories

## 0.91.1 (2026-10-22)

- NÚKIB information service moved to the top menu next to Overview

## 0.91 (2026-10-21)

- NÚKIB information service – RSS news and warnings, incident open data, National MISP status (ADR-087)

## 0.90 (2026-10-21)

- outputs and reports by company framework, DORA incident report, tracked frameworks first (ADR-086)

## 0.89 (2026-10-21)

- shared group assets, risk scenarios with multiple threats and vulnerabilities (ADR-085)

## 0.88 (2026-10-21)

- DORA financial entity flag, DORA incident reporting, framework badge in module headers (ADR-084)

## 0.87 (2026-10-21)

- heatmap for matrix risk methodologies (5x5, imported with axes), clearer group mapping placeholder (ADR-083)

## 0.86 (2026-10-21)

- country packs SK, PL, DE, AT – entity categories, NIS2 main framework, national reporting references (ADR-082)

## 0.85 (2026-10-21)

- profile-driven incident reporting (CZ act / NIS2 Art. 23), legal references only in CZ pack, profile labels in outputs (ADR-081)

## 0.84 (2026-10-21)

- regulatory profile per company – country pack (CZ, generic), main framework from library, audit checklists from any framework, risk methodology from profile (ADR-080)

## 0.83 (2026-10-21)

- framework library – jurisdiction/type metadata, custom frameworks with CSV/XLSX/YAML/JSON/XML/OSCAL import and export, bidirectional mappings (ADR-079)

## 0.82 (2026-10-21)

- sign-in with Active Directory accounts (LDAPS) and SSO providers in administration (ADR-078)

## 0.81 (2026-10-21)

- CIS Controls v8.1 with implementation groups, framework selection in company dialog (ADR-077)

## 0.71.0 (2026-10-17)

- cvičení a tabletop scénáře – šablony, průběh se vstupy, vyhodnocení, test plánů, úkoly, záznam (ADR-066)

## 0.70.0 (2026-10-17)

- analýza odolnosti – RTO/RPO z BIA po grafu, jediné body selhání, kritičnost, mezery v plánech (ADR-065)

## 0.69.0 (2026-10-17)

- shoda konfigurace z Wazuh SCA – politiky, kontroly s rámci, skóre, automatický test opatření (ADR-064)

## 0.68.0 (2026-10-17)

- graf vazeb aktiv – vrstvy, technické závislosti, překryvy, detail uzlu a analýza dopadu výpadku (ADR-063)

## 0.67.0 (2026-10-17)

- napojení Microsoft Sentinel a Elastic Security – webhook i stahování, kurzor, šifrované tajemství (ADR-062)

## 0.66.0 (2026-10-17)

- pohled SOC na hostitele – aktivita v čase, alerty, zranitelnosti, IOC, incidenty, rizika, úkoly (ADR-061)

## 0.65.0 (2026-10-17)

- playbooky SOC s úkoly pro tým – playbooky organizace, úkoly z kroků, splnění = hotový krok (ADR-060)

## 0.64.0 (2026-10-16)

- plánované hledání hrozeb – knihovna dotazů, zkušební běh, alerty nad prahem, plánovač (ADR-059)

## 0.63.0 (2026-10-16)

- přehodnocení rizik z podnětů – incidenty, audity, změny, SOC, zranitelnosti, rozhodnutí vlastníka a historie (ADR-058)

## 0.62.0 (2026-10-16)

- veřejné zdroje hrozeb – abuse.ch a vlastní seznamy, shoda s alerty a hledání ve Wazuhu (ADR-057)

## 0.61.0 (2026-10-16)

- incident × SOC – podklady, doplnění ze SOC a záznam o zvládání incidentu (ADR-056)

## 0.60.0 (2026-10-16)

- reakce s potvrzením – okamžitá upozornění a zásahy SOC se schválením (ADR-055)

## 0.59.0 (2026-10-16)

- indikátory kompromitace (IOC), zpětné hledání a feed k blokaci (ADR-054)

## 0.58.0 (2026-10-16)

- výkonnost SOC a shoda AI triáže s analytiky (ADR-053)

## 0.57.0 (2026-10-16)

- zdroje alertů SOC (webhook s tokenem) a hlášení phishingu (ADR-052)

## 0.56.0 (2026-10-16)

- AI předběžná triáž alertů SOC (ADR-051)

## 0.1–0.55

Základ platformy: aktiva a discovery, zranitelnosti, organizace a procesy, rizika podle vyhlášky, opatření a shoda, dokumentace (DMS), incidenty, audity, kontinuita, dodavatelé, skupina společností, AI asistent na lokálním modelu, SOC. Viz [roadmapa](docs/00_overview/roadmap.md).
