# ADR-005: Zranitelnosti z Wazuhu a semafor aktiv

- **Stav:** přijato
- **Datum:** 2026-09-30

## Kontext

Uživatel potřebuje u aktiv z Wazuhu vidět zranitelné komponenty (CVE) a zastaralost a mít jednoduchý semafor.
Od Wazuhu 4.8 se výsledky vulnerability detection neposkytují přes Server API, ale jsou v Wazuh Indexeru.

## Rozhodnutí

1. Primární zdroj **Wazuh Indexer** (`wazuh-states-vulnerabilities-*`, scroll API); fallback Server API `/vulnerability` pro Wazuh ≤ 4.7.
2. Zranitelnosti se ukládají do `asset_vulnerabilities` s životním cyklem otevřená → vyřešená (zmizí ze zdroje) a výjimkou (akceptace rizika).
3. Semafor se počítá **deterministicky podle konfigurovatelných pravidel** (čistá funkce `computeHealth` ve `shared`) a výsledek se
   denormalizuje na `assets` kvůli rychlému filtrování/řazení.
4. Zastaralost OS z **vestavěné tabulky EOL** (offline – on-prem prostředí často nemají internet); online zdroj (endoflife.date) jako budoucí rozšíření.
5. Primární aktiva přebírají nejhorší stav podpůrných aktiv (konzistentní s děděním CIA z ADR-004/modulu Asset).

## Důsledky

- (+) Srozumitelný stav pro vedení i auditora, řízené výjimky s auditní stopou.
- (+) Funguje i bez internetu.
- (−) Tabulku EOL je potřeba udržovat; data jsou orientační.
- (−) Uživatel indexeru je další přístupový údaj – doporučen read-only účet.
