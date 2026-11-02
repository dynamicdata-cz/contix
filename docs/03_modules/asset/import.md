# Import aktiv

## v0.1 – generický CSV

- Oddělovač `;` nebo `,` (detekce automaticky), UTF-8 (i s BOM z Excelu).
- Povinný sloupec `name`; ostatní volitelné. Více hodnot v buňce (IP, MAC, tagy) oddělit `|`.
- Hlavičky česky i anglicky (`name`/`název`, `owner`/`vlastník`, `serial`/`sériové číslo`, …).
- `source_ref` = `external_id` → `serial` → `name` ⇒ opakovaný import stejného souboru je idempotentní.
- Řídicí pole (vlastník, kritičnost, umístění, štítky, popis) se použijí **jen při založení** nového aktiva.
- Chybné řádky se přeskočí a vypíšou do logu běhu.
- Vzor: `infra/scripts/sample-assets.csv`.

| Sloupec | Hodnoty |
|---|---|
| `type` | `server, workstation, laptop, virtual_machine, container, network_device, security_device, storage, mobile_device, iot_ot, printer, cloud_resource, application, database, saas_service, information_asset, facility, other` |
| `criticality` | `low, medium, high, critical` |
| `environment` | `production, test, development, other` |

## Plán – importy z jiných asset managementů

Každý zdroj = konektor (soubor nebo API), který mapuje cizí model na `DiscoveredAsset`, `source_type = import`
a `source_ref = "<systém>:<id>"`.

| Systém | Způsob | Poznámka |
|---|---|---|
| **XLSX** | soubor | stejné mapování jako CSV |
| **GLPI** | REST API / CSV export | časté ve veřejné správě |
| **Snipe-IT** | REST API | asset tag, sériové číslo, přiřazení uživateli |
| **Lansweeper** | GraphQL API / export | bohatá HW/SW data |
| **ServiceNow CMDB** | Table API (`cmdb_ci_*`) | včetně vztahů CI |
| **Microsoft Intune / Entra ID** | Microsoft Graph | spravovaná zařízení, vlastník = uživatel |
| **JAMF** | API | Apple zařízení |
| **AWS / Azure / GCP** | cloud inventory API | cloudové zdroje |
| **OCS Inventory, Zabbix, NetBox** | API | NetBox výborný zdroj pro síť/DC |

**Mapovací průvodce (UI):** nahrát soubor → náhled → mapování sloupců (AI návrh) → validace → "dry-run" (co se vytvoří/aktualizuje/konflikty) → potvrzení.
