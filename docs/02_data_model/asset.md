# Datový model – Asset

Zdroj pravdy: `apps/api/src/db/schema.ts`. Migrace: `apps/api/drizzle/`.

```mermaid
erDiagram
  assets ||--o{ asset_sources : "známe z"
  assets ||--o{ asset_software : "má nainstalováno"
  assets ||--o{ asset_links : "primární"
  assets ||--o{ asset_links : "podpůrné"
  users ||--o{ assets : "garant"
  discovery_runs }o..o{ asset_sources : "vytváří / aktualizuje"

  assets {
    uuid id PK
    varchar name
    enum asset_type
    enum asset_class
    uuid owner_user_id FK
    text description
    varchar hostname
    varchar fqdn
    text[] ip_addresses
    text[] mac_addresses
    varchar os_name
    varchar os_version
    varchar manufacturer
    varchar model
    varchar serial_number
    varchar location
    varchar owner_name
    enum criticality
    smallint confidentiality
    smallint integrity
    smallint availability
    enum lifecycle_status
    enum environment
    text[] tags
    jsonb attributes
    timestamptz first_seen_at
    timestamptz last_seen_at
  }
  asset_sources {
    uuid id PK
    uuid asset_id FK
    enum source_type
    varchar source_ref
    jsonb raw
    timestamptz last_synced_at
  }
  asset_software {
    uuid id PK
    uuid asset_id FK
    varchar name
    varchar version
    varchar vendor
    enum source_type
  }
  asset_links {
    uuid primary_id PK
    uuid supporting_id PK
    varchar note
  }
  discovery_runs {
    uuid id PK
    enum connector
    enum status
    jsonb params
    jsonb stats
    jsonb log
    text error
  }
```

## Poznámky k návrhu

- `(source_type, source_ref)` je unikátní → idempotentní synchronizace.
- IP/MAC jako `text[]` s GIN indexem (rychlé hledání průniku); pro pokročilou práci se sítěmi lze přejít na `inet[]`.
- `attributes` (jsonb) pro data specifická pro zdroj (Wazuh skupiny, otevřené porty, CPU/RAM) – bez migrací.
- `asset_sources.raw` drží poslední surová data zdroje (diagnostika, budoucí AI analýza).
- CIA hodnocení 1–4 (nízká – kritická) – sladit s metodikou hodnocení rizik (modul Risk).

## Plánované vazby na další moduly

| Tabulka | Účel |
|---|---|
| `asset_relations (from_id, to_id, type)` | technické vztahy podpůrných aktiv: běží na / zálohuje |
| `process_assets (process_id, step_id?, asset_id, role)` | které procesy aktivum používají |
| `risk_assets (risk_id, asset_id)` | rizika vztažená k aktivu |
| `control_assets (control_id, asset_id)` | kontroly aplikované na aktivum |
| `asset_roles (asset_id, user_id, role)` | další role k aktivu – správce, uživatel (garant je `owner_user_id`) |
| `ai_suggestions` | návrhy AI ke schválení |

Identity a přístup (users, roles, groups, sessions, audit_log…) popisuje [authentication.md](../01_architecture/authentication.md).
