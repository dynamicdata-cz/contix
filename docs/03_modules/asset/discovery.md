# Discovery – Wazuh a síťový sken

## Architektura konektorů

Každý konektor implementuje rozhraní `Connector` (`apps/api/src/modules/discovery/types.ts`) – async generátor,
který vrací normalizované položky `DiscoveredAsset`. Zbytek (párování, zápis, statistiky, log) je společný:

```
konektor.collect()  ──▶  DiscoveredAsset  ──▶  ingestDiscovered()  ──▶  assets + asset_sources + asset_software
                                               (reconcile.ts)            discovery_runs (stav, statistiky, log)
```

Přidání nového zdroje = nový soubor v `connectors/` + route. Párování a UI se nemění.

## Wazuh

**Zdroj:** Wazuh Server API (manager, výchozí port 55000).

| Endpoint | Data |
|---|---|
| `POST /security/user/authenticate` | JWT token |
| `GET /agents` (stránkováno) | ID, jméno, IP, stav, verze agenta, skupiny, OS |
| `GET /syscollector/{id}/os` | hostname, OS, verze, architektura |
| `GET /syscollector/{id}/hardware` | sériové číslo desky, CPU, RAM |
| `GET /syscollector/{id}/netiface`, `/netaddr` | MAC a IP adresy |
| `GET /syscollector/{id}/packages` | instalovaný software |

**Nastavení:** Administrace → **Konektory** → Wazuh (URL, uživatel, heslo, TLS) → *Otestovat připojení* → *Uložit*.
Heslo se ukládá šifrovaně (AES-256-GCM, klíč z `APP_SECRET`) a do prohlížeče se nevrací.
Alternativně `.env`: `WAZUH_API_URL`, `WAZUH_API_USER`, `WAZUH_API_PASSWORD`, `WAZUH_VERIFY_TLS` (použije se, dokud se nastavení neuloží v administraci).

**Doporučení:**

- V Wazuhu vytvořit **dedikovaného read-only uživatele** (RBAC politika jen `agent:read` a `syscollector:read`).
- `WAZUH_VERIFY_TLS=false` jen pro test s self-signed certifikátem; v provozu přidat CA Wazuhu.
- `source_ref` = ID agenta → opakovaná synchronizace je idempotentní.
- Agenti ve stavu `never_connected` se přeskakují.
- Novější verze Wazuhu ukládají inventář (IT Hygiene) také do Wazuh Indexeru – pro velká prostředí (tisíce agentů) může být
  efektivnější číst přímo z indexeru hromadně. Ověřit podle nasazené verze Wazuhu; konektor lze rozšířit bez změny zbytku.
- Budoucí rozšíření: zranitelnosti agentů (vulnerability detector) → vazba na rizika.

## Síťový sken (nmap)

**Výchozí stav: vypnuto.** Aktivní skenování sítě může narušit provoz (OT/ICS zařízení!) a v cizí síti je nelegální –
proto platí:

1. Sken musí zapnout správce v Administraci → **Konektory** (nebo `SCAN_ENABLED=true` v `.env`).
2. Allow-list povolených rozsahů (max /16 na rozsah); každý cíl musí ležet uvnitř.
3. nmap musí být nainstalovaný tam, kde běží API (`brew install nmap` / `apt install nmap`); administrace to ověří.
4. Cíle se validují: pouze IPv4 adresa nebo CIDR (žádné hostname ani přepínače nmapu → ochrana proti injection).
5. Limit velikosti jednoho skenu (4096 adres).
6. Každý běh se zapisuje do `discovery_runs` (kdo/kdy/co) – auditní stopa.

**Profily:**

| Profil | nmap | Poznámka |
|---|---|---|
| `ping` | `-sn -T4` | jen živé hosty (+ MAC v lokálním segmentu) |
| `standard` | `-T4 -F -sV --version-light` | top 100 portů + služby |
| `os_detect` | `-T4 -F -O --osscan-limit` | detekce OS, vyžaduje root / CAP_NET_RAW |

**Typ aktiva** se odhaduje z OS, výrobce MAC a portů (např. port 9100 → tiskárna, Fortinet → bezpečnostní zařízení).
`source_ref` = MAC (pokud je vidět), jinak IP.

**Cílová architektura – collector:** v produkci nespouštět sken z API serveru, ale z malého **collectoru**
(`apps/collector`, Bun binárka / kontejner) umístěného v daném síťovém segmentu. Collector si stáhne úlohu,
provede sken a výsledky (`DiscoveredAsset[]`) pošle na API s tokenem `discovery:write`. Kód parseru je sdílený.

**Alternativy / doplňky ke zvážení:** pasivní discovery (ARP/DHCP logy, NetFlow), SNMP dotazy na switche (ARP/MAC tabulky, LLDP),
Active Directory (počítačové účty), cloud API (AWS/Azure/GCP inventory), Microsoft Intune / Entra ID zařízení.

## Fronta úloh

Skeleton pouští běh na pozadí v procesu API. Pro produkci: **pg-boss** (fronta nad PostgreSQL – žádná další infrastruktura),
plánované synchronizace (např. Wazuh každou hodinu), retry a zámky proti souběhu.
