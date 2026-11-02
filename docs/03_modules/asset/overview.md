# Modul Asset – přehled

## Účel

Jednotný inventář aktiv organizace jako základ pro rizika, kontroly, procesy a audity
(NIS2 / ZKB – evidence aktiv, ISO 27001 A.5.9 – inventář informací a souvisejících aktiv).

## Způsoby, jak aktiva vznikají

| Zdroj | Stav v0.1 | Co přináší |
|---|---|---|
| **Ruční zadání** | ✅ | Aktiva, která nelze objevit: informační aktiva, SaaS, prostory, smlouvy, OT zařízení. |
| **Wazuh** | ✅ konektor | Agenti + syscollector: OS, HW, sériové číslo, síťová rozhraní, software. |
| **Síťový sken (nmap)** | ✅ konektor (vypnutý ve výchozím stavu) | Zařízení bez agenta: síťové prvky, tiskárny, IoT, neznámé stroje. |
| **Import CSV** | ✅ | Hromadné nahrání z Excelu nebo exportu jiného nástroje. |
| Import z jiných AM | plán | GLPI, Snipe-IT, Lansweeper, ServiceNow CMDB, Microsoft Intune/Entra, JAMF, cloud (AWS/Azure) – viz [import.md](import.md). |

Detail discovery a bezpečnostních zásad: [discovery.md](discovery.md).

## Primární a podpůrná aktiva

Rozdělení odpovídá zákonu o kybernetické bezpečnosti (ZKB / NIS2) a ISO 27005:

| Třída | Co to je | Typy v CONTIXu |
|---|---|---|
| **Primární aktiva** | informace, služby a procesy, které organizace chrání | Informační aktivum, Služba, Proces / činnost |
| **Podpůrná aktiva** | na čem primární aktiva závisí | servery, stanice, síť, aplikace, databáze, cloud, SaaS, **zaměstnanci / role**, **dodavatelé**, objekty a prostory… |

- Třída se nastaví automaticky podle typu, lze ji ručně změnit (jen pokud aktivum nemá vazby).
- **Vazba** podpůrné → primární aktivum (N:M, s poznámkou), tabulka `asset_links`.
- **Dědění hodnocení CIA:** podpůrné aktivum má efektivní důvěrnost / integritu / dostupnost = maximum z vlastního
  hodnocení a všech primárních aktiv, která podporuje. V detailu je zděděná hodnota označená.
- Hodnocení CIA se zadává hlavně u primárních aktiv (dle dopadu), podpůrná ho přebírají – méně ruční práce a konzistentní výsledek.

## Garant / vlastník aktiva

- `owner_user_id` = uživatel CONTIXu (garant aktiva dle ZKB). Uživatel s rolí *Garant / vlastník aktiva* upravuje jen svá aktiva.
- `owner_name` = volný text pro útvar / externí subjekt (např. z importu).
- Přehled ukazuje počet aktiv bez vlastníka.

## Klíčové koncepty

**Zlatý záznam.** Tabulka `assets` drží jeden záznam za skutečné aktivum. Tabulka `asset_sources` eviduje,
odkud ho známe (`manual`, `wazuh`, `network_scan`, `import`) a pod jakým ID (`source_ref`).

**Reconciliation (párování).** Při každém discovery/importu se pro nalezenou položku hledá existující aktivum:

1. stejný zdroj + `source_ref` (nejsilnější – opakovaná synchronizace),
2. sériové číslo (ignoruje nesmysly typu "To Be Filled By O.E.M."),
3. průnik MAC adres,
4. hostname (krátké jméno, bez domény, case-insensitive).

Shoda 2–4 se použije, jen když je jednoznačná. Víc kandidátů = **konflikt** → zapíše se do logu běhu
(v další verzi fronta "k posouzení" s ručním/AI sloučením).

**Kdo co vlastní.**

| Atributy | Mění |
|---|---|
| Technické: hostname, FQDN, IP, MAC, OS, výrobce, model, sériové číslo, software, `last_seen_at` | konektory (sjednocení; IP/MAC se sčítají) |
| Řídicí: název, popis, typ*, vlastník, kritičnost, CIA, životní cyklus, prostředí, umístění, štítky | pouze člověk (import je nastaví jen při založení) |

\* typ navrhne konektor při založení, pak už ho mění jen člověk.

## API (v0.2)

Všechny endpointy vyžadují přihlášení a oprávnění (`assets:read`, `assets:write`, `assets:write_own`, `assets:delete`, `discovery:run`).

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `/api/assets?q=&assetClass=&assetType=&criticality=&source=&ownerUserId=&limit=&offset=` | seznam s filtrováním a fulltextem (název, hostname, IP, S/N) |
| GET | `/api/assets/stats` | počty podle typu, kritičnosti, zdroje |
| GET | `/api/assets/:id` | detail + zdroje + software + vazby + efektivní CIA + `canEdit` |
| POST | `/api/assets/links` | `{ primaryId, supportingId, note }` – vazba podpůrné → primární |
| DELETE | `/api/assets/links?primaryId=&supportingId=` | zrušení vazby |
| POST | `/api/assets` | ruční založení (zdroj `manual`) |
| PATCH | `/api/assets/:id` | změna jen zaslaných polí |
| DELETE | `/api/assets/:id` | smazání (později soft-delete + audit) |
| GET | `/api/discovery/connectors` | stav konektorů |
| POST | `/api/discovery/wazuh` | spustí synchronizaci (202 + runId) |
| POST | `/api/discovery/network-scan` | `{ targets: ["10.0.0.0/24"], profile }` |
| POST | `/api/discovery/import/csv` | multipart `file` nebo `text/csv` tělo |
| GET | `/api/discovery/runs[/:id]` | historie běhů, statistiky, log |

## UI (v0.2)

Přehled (KPI vč. primárních/podpůrných a aktiv bez vlastníka) · Seznam aktiv s filtry (třída, typ, kritičnost, zdroj) ·
Detail (vazby primární ↔ podpůrná, efektivní CIA, řídicí a technické údaje, zdroje, software) · Formulář nové/upravit
(třída, garant z uživatelů) · Discovery & import.

## Další kroky modulu

1. Fronta konfliktů + ruční sloučení dvou aktiv (merge) a rozpojení.
2. Technické vztahy mezi podpůrnými aktivy (běží na, závisí na, zálohuje) → dopadové analýzy.
3. Notifikace garantům (aktivum bez hodnocení CIA, dlouho neviděné aktivum).
4. Plánované synchronizace (cron) a detekce "zmizelých" aktiv (nevidět X dní → návrh na vyřazení).
5. Vazba software → zranitelnosti (Wazuh vulnerability detector).
6. Historie změn (audit log) a soft-delete.
7. Import XLSX a konektory na další asset management nástroje.
