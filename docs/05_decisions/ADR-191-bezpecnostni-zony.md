# ADR-191: Bezpečnostní zóny a vrstvená mapa

Stav: **přijato** (v1.97.0) – navazuje na [ADR-190](ADR-190-monitoring-nalezy-reporty-pocitacu.md).

## Kontext

Vyhláška 409/2025 vyžaduje segmentaci sítě. Uživatelé chtěli vidět síť ve vrstvách (Internet, DMZ, interní systémy,
správa, OT) a odhalit, kde segmentace chybí. Každá organizace má zóny jinak, proto musí být základ hotový a zbytek
rozšiřitelný bez úprav kódu.

## Rozhodnutí

1. **Katalog zón per společnost** (`security_zones`): název, druh (`internet`, `dmz`, `guest`, `user`, `server`,
   `management`, `ot`, `custom`), úroveň důvěry 0–4, barva, popis, rozsahy CIDR, pořadí. Výchozí sada 7 zón se
   zakládá tlačítkem (idempotentně – doplní jen chybějící druhy); vlastní zóny mají druh `custom` a libovolnou důvěru.
2. **Zařazení aktiv**: `assets.zone_id` + `zone_manual`. Automaticky podle IP adres, vyhrává nejpřesnější rozsah
   (nejdelší prefix), při shodě pořadí zóny. Ruční zařazení má přednost; volba „podle IP“ ho zruší. Smazání zóny
   vrátí aktiva do automatiky. Přepočet po uložení zóny, tlačítkem a v plánovači.
3. **Hodnocení vazeb přes hranice** (`zoneFlowLevel`, závislosti aktiv): vazba do správy / OT z jiné než serverové,
   správcovské či OT zóny nebo skok důvěry o víc než 1 = vysoké riziko; skok o 1 = varování; jinak v pořádku.
4. **Kontroly zón jako nálezy** v existujícím zdroji `monitoring` (přejmenován na „Monitoring a zóny“), kódy `zone_*`,
   společný životní cyklus `applyMonitoringFindings` s oddělenými obory kódů (`wazuh_*` vs. `zone_*`), takže se
   synchronizace navzájem neuzavírají.

## Důsledky

- Migrace `0133_security_zones`. Oprávnění: čtení `assets:read`, úpravy `assets:write`, modul aktiv.
- IPv6 a překrývání rozsahů mezi společnostmi zatím neřešíme (IPv6 adresy se nezařazují).
- Nový druh zóny nebo nová kontrola = rozšíření `zones.ts` a `syncZoneFindings`, bez změny schématu.
