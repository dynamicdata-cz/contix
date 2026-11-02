# ADR-069: DORA – registr informací

- Stav: přijato (v0.74)

## Kontext
Finanční subjekty musí podle čl. 28 odst. 3 DORA vést registr informací o smluvních ujednáních s poskytovateli služeb IKT ve struktuře prováděcího nařízení Komise (EU) 2024/2956 (šablony B_01–B_07) a předávat ho příslušnému orgánu (ČNB). CONTIX už eviduje dodavatele, smlouvy, procesy a BIA – registr z nich lze sestavit, místo aby se vedl ručně v Excelu.

## Rozhodnutí
- Registr se **nepersistuje** – sestavuje ho čistá funkce `buildDoraRegister` (`shared/dora.ts`) při čtení z evidence. Ukládají se jen doplňkové údaje: `companies.dora` (finanční subjekt: LEI, typ, postavení ve skupině), `suppliers.dora` (poskytovatel IKT: příznak, LEI/EUID, země, nejvyšší mateřský podnik), `supplier_contracts.dora` (druh ujednání, služby S01–S19, náklady, údaje pro kritickou funkci, posouzení, dodavatelský řetězec) a vazba `supplier_contract_processes`.
- **Funkce = proces.** Identifikátor F<n> je stálý (`processes.function_no`, identity); kritičnost, RTO a RPO se berou z procesu a BIA (bez BIA „neposouzeno“), licencovaná činnost `processes.dora_activity` (prázdné = „support functions“).
- Kód poskytovatele: LEI → EUID → IČO (`CZ_CRN`); LEI se ověřuje kontrolním součtem ISO 17442 (`validLei`).
- Kontrola úplnosti: povinná pole podle šablon (u smluv podporujících kritickou funkci rozšířená), kódy sloupců v nálezu; koncentrace podle nejvyššího mateřského podniku (≥ 2 kritické funkce a podíl ≥ 50 % nebo obtížná nahraditelnost).
- Export `GET /suppliers/dora/export.zip`: CSV soubory v rozvržení sloupců šablon (c0010 …), číselníky jako pořadové číslo možnosti z ITS, ano/ne jako true/false. **Nejde o balíček xBRL-CSV** (kódy DPM `eba_*`, parametry, filing indicators) – ten vytvoří nástroj pro vykazování; CONTIX nic neodesílá.
- Oprávnění: čtení `suppliers:read`, úpravy `suppliers:write` ve společnosti dodavatele, licencovaná činnost `processes:write`.

## Důsledky
- Změna v evidenci (nový proces, BIA, smlouva) se v registru projeví hned.
- Při změně ITS (např. oprava 2025) stačí upravit `COLS` a sestavení řádků v `buildDoraRegister`.
