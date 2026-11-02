# ADR-115: Pokrytí katalogu hrozeb a průběžné přehodnocení scénářů z dat (v1.18)

## Kontext

Scénáře z dat (ADR-114) navrhují rizika tam, kde data dokládají slabinu. Pro doložitelnou analýzu rizik podle § 8 vyhlášky
je ale potřeba ukázat i **úplnost**: že každá hrozba z katalogu byla u každého primárního aktiva posouzena – buď je řešena
rizikem, nebo navržena, nebo vědomě vyloučena se zdůvodněním. Zároveň se data mění (nové účty bez MFA, zranitelnosti,
odpojené agenty) a přijatý scénář by měl vlastníka rizika upozornit, že jeho podklady už neplatí.

## Rozhodnutí

1. **Pokrytí katalogu** (`threatCoverage`, `risks/scenarios.ts`) – počítá se při čtení: primární aktiva (aktivní / údržba) ×
   aktivní hrozby katalogu (`risk_catalog.kind = threat`). Rozsah aktiva = vazby na podpůrná aktiva + jeden krok technických
   závislostí (stejně jako u návrhů). Stav buňky jen `threatCellState`: **riziko** (neuzavřené riziko na aktivu rozsahu,
   hlavní hrozba nebo `risk_catalog_links`) > **návrh** (otevřený návrh, hrozba nebo další hrozby šablony) > **nerelevantní**
   > **neposouzeno**. Souhrn `threatCoverageSummary` (podíl posouzených).
2. **Nerelevantní hrozba** – tabulka `threat_assessments` (aktivum × položka katalogu, PK), povinné zdůvodnění (min. 5 znaků),
   autor a datum, audit `risk.threat_not_relevant` / `_removed`. Jen u primárních aktiv a jen pro hrozby. Zdůvodnění zůstává
   uložené i ve chvíli, kdy hrozbu později pokryje riziko (přednost má riziko). Při přesunu aktiva jde zdůvodnění s ním.
3. **Podnět „scenario“** k přehodnocení rizika (ADR-058): `risk_scenario_proposals.fingerprint_changed_at` se nastaví při každé
   změně otisku doložených skutečností. Podnět vznikne pro přijatý / navázaný návrh, jehož otisk se liší od otisku při rozhodnutí
   a změna nastala po základu rizika (`riskBaselineSql`). Silný, když návrh (dopad × pravděpodobnost) vychází výš než riziko.
   Podnět se **jen zobrazí** – `suggestFromTriggers` ho nepoužije (dopad posoudí vlastník). Příznak „data se změnila“ v seznamu
   návrhů se řídí stejným pravidlem, takže potvrzení hodnocení vlastníkem ho zruší.
4. **Denní obnova** `processScenarioRefresh` v plánovači (pod jeho lease, modul rizik zapnutý): jen společnosti, které už mají
   nějaký návrh (scénáře z dat používají), a jen když poslední vyhodnocení je starší než 24 h. Mění jen návrhy, nikdy rizika.

## Důsledky

- Úplnost analýzy rizik je vidět a doložitelná (kdo, kdy, proč hrozbu vyloučil).
- Změna dat se k vlastníkovi rizika dostane stejnou cestou jako incidenty nebo zranitelnosti (podněty, termín 30 dní).
- Žádná automatická změna hodnocení rizik; AI se nepoužívá.
