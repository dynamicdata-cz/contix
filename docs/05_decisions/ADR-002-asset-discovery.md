# ADR-002: Discovery aktiv přes konektory se společným párováním

- **Stav:** přijato
- **Datum:** 2026-09-28

## Kontext

Aktiva mají vznikat ručně, z Wazuhu, síťovým skenem a později importem z různých asset managementů.
Stejné zařízení se často objeví ve více zdrojích (Wazuh agent + nmap + import z GLPI).

## Rozhodnutí

1. Všechny zdroje produkují jednotný `DiscoveredAsset`; párování a zápis řeší jedna společná funkce (`ingestDiscovered`).
2. Model "zlatý záznam + zdroje": `assets` (1) – `asset_sources` (N), unikátní `(source_type, source_ref)`.
3. Párování deterministicky: zdroj+ref → sériové číslo → MAC → hostname; jen jednoznačná shoda, jinak konflikt.
4. Konektory mění jen technické atributy; řídicí atributy patří člověku.
5. Síťový sken je opt-in s allow-listem rozsahů; v produkci poběží v samostatném collectoru.
6. Každý běh = záznam v `discovery_runs` (auditní stopa).

## Alternativy

- *Každý zdroj vlastní tabulka bez sjednocení* – jednodušší, ale pro GRC nepoužitelné (duplicitní aktiva v rizicích).
- *Pravděpodobnostní / AI párování hned od začátku* – méně předvídatelné; AI přidáme jako **návrhy** nad frontou konfliktů.

## Důsledky

- Nový zdroj = jeden soubor konektoru.
- Konflikty vyžadují UI pro ruční sloučení (další iterace).
