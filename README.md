# CONTIX

**Otevřená GRC platforma pro kybernetickou bezpečnost** – řízení aktiv, rizik, opatření, dokumentace, incidentů a auditů
podle zákona o kybernetické bezpečnosti (vyhlášky 409/2025 a 410/2025 Sb.), NIS2, ISO 27001, DORA, SOC 2, CRA a AI Act.
Běží na vlastním serveru, AI funkce používají **lokální model** – data neodcházejí mimo organizaci.

*English:* CONTIX is an open-source, self-hosted GRC platform for cybersecurity compliance (Czech Cyber Security Act, NIS2,
ISO 27001, DORA, SOC 2, CRA, EU AI Act). The UI is available in Czech and English; AI features run on a local model.

[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE) · Aktuální verze a změny: [CHANGELOG.md](CHANGELOG.md)

## Co CONTIX umí

| Oblast | Funkce |
|---|---|
| **Řízení a rizika** | organizace a funkční místa, procesy (karta, RACI, BPMN), aktiva primární / podpůrná s děděním CIA, rizika podle katalogu vyhlášky i vlastních metodik (OCTAVE, 5×5, FAIR), BIA, plán zvládání rizik, roční hodnoticí cykly |
| **Shoda a audit** | opatření s mapováním na rámce (409/410, ZKB, NIS2, ISO 27001, DORA, SOC 2, CIS v8.1, vlastní rámce s importem OSCAL/XLSX), SoA, testy a důkazy, průběžné monitorování opatření, audity, portál externího auditora, balíček pro auditora |
| **Regulace** | legislativa ze Sbírky (e-Sbírka) a EUR-Lex se sledováním změn, informační servis NÚKIB, hlášení incidentů, DORA registr, CRA (SBOM, VEX), AI Act, GDPR (záznamy, DPIA) |
| **Bezpečnostní provoz** | SOC nad Wazuhem a dalšími zdroji (případy, IOC, hledání hrozeb, playbooky, reakce se schválením, ladění pravidel), zranitelnosti s prioritou KEV/EPSS a lhůtami, importy skenerů, identity a přístupy (AD, Entra ID) |
| **Evidence a dokumentace** | DMS se schvalovacím oběhem, revizemi a úpravami ve Wordu, portál pro zaměstnance se seznámením a testem, školení, dodavatelé a jejich zprávy o ujištění, dotazníky zákazníků a Trust Center, kontinuita a cvičení |
| **AI (lokální model)** | dotazy nad daty a dokumentací s citacemi, MCP server pro AI klienty, návrhy (opatření, triáž, VEX, odpovědi na dotazníky) vždy ke schválení člověkem |

Skupina společností (holding), role podle ZKB, MFA, SSO (Entra ID, AD FS, OIDC), auditní log, čeština i angličtina.

## Rychlé vyzkoušení (vývojové prostředí)

Potřebujete [Bun](https://bun.sh) 1.3+ a Docker (nebo PostgreSQL 17 s rozšířením pgvector).

```bash
git clone https://github.com/dynamicdata-cz/contix.git && cd contix
cp .env.example .env
bun install
docker compose up -d db
bun run db:migrate
bun run db:seed        # administrátor admin@contix.local (vypíše dočasné heslo) a demo účty
bun run demo:seed      # ukázková fiktivní společnost s aktivy, riziky, opatřeními a úkoly
bun run dev            # web http://localhost:5173, API http://localhost:3000
```

Po přihlášení se v horní liště přepněte na společnost **„Vzorová strojírna a.s. (ukázka)“**.

## Instalace na server

Docker Compose s Caddy (TLS), denními šifrovanými zálohami, převodní službou dokumentů a kontrolou po instalaci.
Předpoklad: Linux x86_64 (Ubuntu 22.04/24.04, Debian 12, RHEL/Rocky 9), 2 vCPU, 4 GB RAM, 40 GB disk, volné porty 80 a 443.

**1. Docker** (pokud ještě není – `docker compose version` vypíše verzi):

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
less get-docker.sh                      # volitelně: prohlédnout skript před spuštěním
sudo sh get-docker.sh                   # Docker Engine + plugin docker compose z oficiálního repozitáře Dockeru
sudo systemctl enable --now docker
docker compose version
```

Instalace z repozitáře balíčků ručně (bez skriptu) viz [požadavky na server](docs/04_operations/install.md#1-požadavky-na-server).

**2. CONTIX:**

```bash
sudo mkdir -p /opt/contix && sudo chown "$USER": /opt/contix
git clone https://github.com/dynamicdata-cz/contix.git /opt/contix && cd /opt/contix
sudo ./infra/scripts/install.sh --domain contix.firma.cz --tls internal --admin spravce@firma.cz
sudo ./infra/scripts/update.sh      # aktualizace na novou verzi (záloha → git pull → restart)
```

Podrobně, včetně instalace bez internetu z balíčku: [docs/04_operations/install.md](docs/04_operations/install.md) ·
[nasazení](docs/04_operations/deployment.md) · [zálohy](docs/04_operations/backup.md) · [monitoring](docs/04_operations/monitoring.md).
Konfigurace serveru: [infra/server.env.example](infra/server.env.example).

## Vývoj

```bash
bun run typecheck
bun test                                                                         # unit testy
TEST_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_test bun test   # + integrační (DB se vyprázdní)
E2E_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_e2e bun run e2e  # Playwright
```

Stack: **Bun + Hono** · **Drizzle + PostgreSQL (pgvector)** · **Zod** · **React 19 + Vite + TanStack** · Tailwind 4 · Caddy.

```
apps/api        API (Bun + Hono), moduly v src/modules/<modul>
apps/web        webová aplikace (React)
packages/shared sdílená schémata, výčty, rámce, popisky a překlady
docs/           vize, architektura, moduly, provoz, rozhodnutí (ADR)
infra/          Dockerfile, Caddy, skripty instalace, aktualizace a záloh
e2e/            testy v prohlížeči
```

Pravidla projektu (pro lidi i AI asistenty) jsou v [AGENTS.md](AGENTS.md), rozhodnutí v [docs/05_decisions](docs/05_decisions/).
Jak přispět: [CONTRIBUTING.md](CONTRIBUTING.md). Bezpečnostní chyby hlaste podle [SECURITY.md](SECURITY.md) – ne veřejně.

## Dokumentace

| | |
|---|---|
| Přehled | [vize](docs/00_overview/vision.md) · [roadmapa](docs/00_overview/roadmap.md) |
| Architektura | [tech stack](docs/01_architecture/tech_stack.md) · [AI vrstva](docs/01_architecture/ai_layer.md) · [přihlašování, role, MFA, SSO](docs/01_architecture/authentication.md) |
| Moduly | [aktiva](docs/03_modules/asset/overview.md) · [rizika](docs/03_modules/risk/overview.md) · [opatření a shoda](docs/03_modules/controls/overview.md) · [dokumentace](docs/03_modules/policies) · [incidenty](docs/03_modules/incidents/overview.md) · [audity](docs/03_modules/audits/overview.md) · [zranitelnosti](docs/03_modules/vulnerabilities/overview.md) · [AI asistent](docs/03_modules/ai/overview.md) · [další](docs/03_modules) |

Nápověda a uživatelská příručka (Word / PDF) jsou přímo v aplikaci.

## Licence

CONTIX je svobodný software pod licencí **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)).
Můžete ho používat, upravovat a šířit. Pokud upravenou verzi zpřístupníte uživatelům přes síť, musíte jim nabídnout
její zdrojový kód (čl. 13 licence) – odkaz se nastaví v `CONTIX_SOURCE_URL` a zobrazí se v menu aplikace.

Texty norem ISO a kritérií AICPA (SOC 2) CONTIX neobsahuje (autorské právo) – jen čísla, vlastní popisky a mapování.
