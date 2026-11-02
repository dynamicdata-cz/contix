# ADR-072: Síťové segmenty, plánované skeny a neevidovaná zařízení

- Stav: přijato (v0.77)

## Kontext
Jednorázový sken (ADR-002) nalezená zařízení rovnou zakládal jako aktiva. Pro provoz je potřeba opak: pravidelně hlídat více sítí a upozornit, když se v nich objeví zařízení, které v evidenci není (neoprávněné připojení, zapomenutý prvek), nebo když na adrese evidovaného aktiva odpoví jiné zařízení.

## Rozhodnutí
- **Segment** (`net_segments`): název, rozsahy CIDR (vždy v povolených rozsazích skenu), výjimky (`nmap --exclude`, validované), profil, režim, plán (ručně / hodinově / 6 h / denně / týdně v čase Europe/Prague – `nextScanAt`), úroveň alertu.
- **Pozorování** (`net_observations`): hostitel v segmentu (klíč MAC, jinak IP), poslední údaje, stav `unknown` / `known` / `changed` / `approved`, vazba na aktivum a alert. Porovnání jen `matchHost` (`shared/netscan.ts`): MAC → IP → jméno; IP aktiva s jinou MAC = `changed`. Aktiva společnosti segmentu a nadřazených, bez vyřazených.
- **Alert SOC** (`alert_suggestions`, `source = netscan`, pravidla `netscan-unknown` / `netscan-changed`, ATT&CK T1200) – skupina `netscan:<segment>:<hostitel>`, opakovaný sken jen zvýší počet. Schválené zařízení alert nevytváří.
- **Režimy**: `monitor` (výchozí) evidenci nemění, `inventory` navíc zapisuje přes `ingestDiscovered` jako ruční sken.
- **Rozhodnutí člověka**: založit aktivum, přiřadit k aktivu (doplní IP/MAC), schválit s důvodem, zrušit schválení – vše do auditu.
- **Plánovač** `processNetScans` (lease, segmenty postupně); sken běží na pozadí, běh je v `discovery_runs`. Testy používají náhradní skener (`NetScanDeps`).

## Omezení
- API v Dockeru běží jako neprivilegovaný uživatel v síti bridge: nmap používá TCP connect (živost jen přes TCP SYN/connect na `DISCOVERY_PORTS` – od v0.78.1 i porty stanic Windows/Mac a tiskáren, dříve jen 80/443), MAC adresy a výrobce nejsou vidět. Pro klientské sítě je spolehlivější profil „standardní“. Detekce podle MAC vyžaduje sken ze stejného L2 segmentu s oprávněním NET_RAW (samostatný kolektor) – další krok.
