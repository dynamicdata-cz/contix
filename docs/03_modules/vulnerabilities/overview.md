# Modul Zranitelnosti a zastaralost (semafor aktiv)

## Účel

U každého aktiva hlídat zranitelné knihovny a komponenty (CVE) a zastaralost (konec podpory OS)
a shrnout to do **semaforu**: 🟢 v pořádku · 🟠 pozor · 🔴 kritické · ⚪ bez dat.
Barva je v UI vždy doplněná ikonou a textem.

## Zdroj dat – Wazuh vulnerability detection

| Verze Wazuhu | Odkud CONTIX čte | Nastavení |
|---|---|---|
| **4.8 a novější** | Wazuh Indexer (OpenSearch), index `wazuh-states-vulnerabilities-*` – aktuální stav „agent × balíček × CVE“ | Administrace → Konektory → Wazuh → *Zranitelnosti – Wazuh Indexer* (URL `https://…:9200`, uživatel indexeru) |
| 4.7 a starší | Server API `GET /vulnerability/{agent_id}` | stačí připojení k API (fallback, když indexer není vyplněný) |

- Načítání probíhá v rámci **Synchronizace Wazuhu** (Discovery & import): nejdřív agenti → aktiva, pak zranitelnosti, pak přepočet semaforu.
- Čtení z indexeru přes scroll API po 1000 záznamech (škáluje na statisíce záznamů).
- Párování: `agent.id` ↔ `asset_sources(source_type = wazuh, source_ref = agent ID)`. Zranitelnosti agentů, kteří nejsou v inventáři, se jen zalogují.
- **Životní cyklus CVE:** nová → *otevřená*; když ji Wazuh při další synchronizaci už nehlásí → *vyřešená* (datum); když se znovu objeví → znovu otevřená.
- Ochrana: pokud synchronizace nevrátí žádnou zranitelnost (např. chybný index), stávající záznamy se **neuzavírají**.
- Chyba při načítání zranitelností neshodí celý běh – aktiva se načtou, chyba je v logu běhu (`vulnError`).
- Doporučení: pro indexer vytvořit read-only uživatele s právem `read` na `wazuh-states-vulnerabilities-*` (místo `admin`).

Mapovaná pole indexeru: `agent.id`, `package.name`, `package.version`, `vulnerability.id` (CVE), `vulnerability.severity`,
`vulnerability.score.base` (CVSS), `vulnerability.description`, `vulnerability.reference`, `vulnerability.detected_at`,
`vulnerability.published_at`. Mapování je tolerantní k rozdílům mezi verzemi (`sources.ts`).

## Zastaralost – konec podpory (EOL)

Vestavěná orientační tabulka lifecycle výrobců (`packages/shared/src/vuln.ts` → `EOL_RULES`):
Windows / Windows Server, Ubuntu, Debian (LTS), RHEL/Rocky/Alma, CentOS, CentOS Stream, macOS.

| Stav | Význam |
|---|---|
| Podporováno | EOL je dál než limit upozornění |
| Podpora brzy končí | EOL do N dní (výchozí 180) |
| Bez podpory (EOL) | po datu konce standardní/bezpečnostní podpory (bez placených ESU/ESM) |
| Neznámé | OS nerozpoznán nebo verze neznámá |

Data jsou orientační – před auditním použitím ověřit u výrobce / endoflife.date. Tabulku lze rozšiřovat.

## Pravidla semaforu (Administrace → Nastavení)

| Pravidlo | Výchozí |
|---|---|
| 🔴 alespoň N **kritických** CVE | 1 |
| 🔴 alespoň N **vysokých** CVE | 10 |
| 🟠 alespoň N vysokých CVE | 1 |
| 🟠 alespoň N **středních** CVE | 10 |
| OS bez podpory (EOL) | 🔴 (lze přepnout na 🟠) |
| 🟠 podpora končí do N dní | 180 |
| 🟠 agent nehlásí stav N dní (neaktuální data) | 14 |
| Primární aktivum přebírá nejhorší stav svých podpůrných aktiv | zapnuto |

Do výpočtu se počítají jen **otevřené** zranitelnosti (ne vyřešené a ne s výjimkou).
Semafor se přepočítá po synchronizaci, po změně aktiva/vazeb, po udělení/zrušení výjimky a po změně pravidel.

## Výjimky (akceptace rizika)

- Udělit smí správce aktiv (`assets:write`) nebo garant aktiva (`assets:write_own` u svého aktiva).
- Povinné zdůvodnění, doporučená platnost „do“ – po datu platnosti se výjimka automaticky zruší.
- Každá výjimka i její zrušení jsou v auditním logu (`vulnerability.accepted` / `vulnerability.reopened`).

## Data

`asset_vulnerabilities` (asset, CVE, závažnost, CVSS, balíček + verze, stav, výjimka, first/last seen, resolved_at),
na `assets` denormalizované: `health_status`, `health_reasons`, `vuln_critical/high/medium/low`, `support_status`, `os_eol_date`
(rychlé filtrování a řazení seznamu podle rizika).

## API

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `/api/vulnerabilities/summary` | KPI semaforu, závažnost, podpora OS, top aktiva, top komponenty, top CVE, EOL aktiva |
| GET | `/api/vulnerabilities?assetId=&severity=&status=&q=` | seznam |
| POST | `/api/vulnerabilities/:id/accept` | `{ reason, until? }` |
| POST | `/api/vulnerabilities/:id/reopen` | zrušení výjimky |
| POST | `/api/vulnerabilities/recompute` | přepočet semaforu |
| GET | `/api/assets?health=red&sort=risk` | seznam aktiv podle semaforu / rizika |

## Další kroky

- Plánovaná synchronizace (např. každou noc) – fronta úloh.
- Vazba zranitelnost → riziko (modul Risk) a → nápravné opatření s termínem (modul Audit/Control).
- EPSS / CISA KEV (aktivně zneužívané CVE) jako další vstup do priority.
- Zastaralost aplikací (nejen OS) – porovnání verzí balíčků s aktuálními vydáními.
- Trend v čase (snímky počtů po každé synchronizaci).
