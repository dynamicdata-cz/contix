# ADR-150: NetBox a JIRA jako připojení (v1.53)

## Kontext

Námět František 2 a 4: aktiva z CMDB (NetBox) a vazba na JIRA (zakládání úkolů a čtení stavu).
Obojí staví na modelu připojení (ADR-146).

## Rozhodnutí

1. **NetBox** (`kind = netbox`): URL, API token (šifrovaně), ověření TLS, rozsah společnosti nebo tenant → společnost
   (`groupMap`), načítání VM, interval. Discovery konektor `netbox` (migrace 0110 – hodnoty výčtů) čte
   `/api/dcim/devices/` a `/api/virtualization/virtual-machines/` (stránkování `next`), zdroj `netbox`,
   ref `dcim:<id>` / `vm:<id>` s id připojení; typ aktiva podle role. Lokalita a štítky jen při založení aktiva.
2. **JIRA** (`kind = jira`): Cloud (Basic e-mail + API token) nebo Data Center (Bearer PAT), projekt, typ issue,
   stavy „hotovo“, rozsah. `external_issues` (připojení, záznam, klíč, URL, stav). `POST /api/jira/issues`
   založí issue z úkolu (oprávnění `actions:write` ve společnosti úkolu). Plánovač nejvýš jednou za hodinu
   na issue čte stav; stav „hotovo“ uzavře úkol (`done`, `completedAt`, audit `jira.task_closed`).
3. Zatím jen úkoly (Akce a úkoly) – nálezy auditů a zranitelnosti se do úkolů převádějí už dnes.
4. Zápis aktiv z jiných CMDB přes API zůstává na importu (Excel / CSV) a sběrači; obecný zápis s tokenem
   je samostatné rozhodnutí (bezpečnost API).

## Důsledky

Migrace 0110. Do JIRA se posílá jen název, popis a termín úkolu; nic se v JIRA nemaže ani nemění zpětně.
