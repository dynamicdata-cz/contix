# ADR-181: Mapa propojení po zónách se stavy a v Přehledu (v1.86)

Stav: **přijato** – navazuje na [ADR-177](ADR-177-agenti-a-koncentratory.md) a [ADR-180](ADR-180-hardening-a-kontejnery-z-agenta.md).

## Kontext

Mapa propojení v Konektorech (v1.84) kreslila uzly z několika přehledů přímo v prohlížeči. Stav byl jen barva bez
vysvětlení, zóny nebyly vidět, servery sběrače se k němu přiřazovaly podle názvu připojení a mapa byla jen pro správce.
Uživatelé chtějí vidět, co nefunguje a proč, a mít souhrn v Přehledu.

## Rozhodnutí

1. **Výpočet na serveru, jedna čistá funkce** `buildIntegrationMap` (`packages/shared/src/integrationMap.ts`): skupiny
   (zóny koncentrátorů, sběrače, monitoring, evidence, služby), uzly se stavem `ok / warn / error / off`, **důvody**
   (kód + parametry, překlad `imap.r.*`), údaje, odkazy a spojení s protokolem a počtem zpráv za 24 h. API
   `GET /api/integrations/map` jen sbírá vstupy (přehledy konektorů, agenti, servery, zdroje identit, kontroly provozu,
   počty zpráv agentů, pokrytí serverů).
2. **Vazby jen podle ID**: agent → koncentrátor (`concentratorId`), server → připojení (`connectionId`), server → aktivum.
   Zóny se slučují podle názvu bez ohledu na velikost písmen. Server hlášený přes neexistující připojení je problém jádra.
3. **Prahy**: agent a koncentrátor se hlásí po 15 min – upozornění po 35 min, chyba po 2 h; sběrač upozornění po 13 h,
   chyba po 48 h; synchronizace s intervalem upozorní po dvojnásobku intervalu. Starší verze agenta než
   `AGENT_LATEST_VERSION` je upozornění.
4. **Pokrytí serverů**: aktivní servery (údržba se počítá) a zdroj dat – agent (připojení `concentrator`), sběrač,
   Wazuh (`asset_sources`); server bez zdroje a server s agentem i sběračem jsou upozornění.
5. **Oprávnění**: mapu vidí `admin:settings`, `discovery:run` nebo `soc:read`. Bez správy systému jen záznamy v rozsahu
   společností, bez adres, otisků, tokenů a služeb (kontroly provozu obsahují nastavení) a bez odkazů do Administrace.
6. **Zobrazení**: Konektory i stránka `/discovery/map` používají stejnou komponentu (pruhy zón, panel detailu,
   jen problémy, celá obrazovka); Přehled má dlaždici *Stav sběru dat* (zmenšená mapa skupin, problémy, pokrytí).

## Důsledky

- Nový druh spojení = vstup a větev v `buildIntegrationMap` + test vazby; komponenta se nemění.
- Stav uzlu musí mít důvod – uzel bez důvodu je vždy „v pořádku“ nebo „vypnuto“.
