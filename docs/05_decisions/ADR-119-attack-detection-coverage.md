# ADR-119: Pokrytí technik MITRE ATT&CK detekcí (v1.22)

## Kontext

Scénáře z dat (ADR-114) nesou techniky ATT&CK a hrozbu zvyšují jen tehdy, když SOC útok už zaznamenal. Chyběla opačná
informace: které techniky SOC vůbec neumí zachytit. Slabá detekce je zranitelnost (Z07, Z08 katalogu vyhlášky).

## Rozhodnutí

1. Rozsah = techniky ze `SCENARIO_TEMPLATES` (`scenarioTechniques`). Stav `detectionState`: zachyceno (alert se stejnou
   technikou nebo podtechnikou za 90 dní, bez falešných poplachů) > plánované hledání (zapnuté `soc_hunts` s technikou) >
   deklarované pravidlo (`detection_declarations`: zdroj, poznámka, autor; audit) > slepé místo.
2. `detectionFor` (jen čtení) vrací techniky, doklady, šablony a souhrn; `measured` = společnost má alespoň jeden alert,
   zapnuté hledání nebo deklaraci. Bez měření se scénáře neupravují (neznámé se nepovažuje za slabé ani silné).
3. `evaluateScenario` dostane `detection { blind, total }` pro techniky šablony; je-li slepých ≥ 50 %, zranitelnost +1 s důvodem
   `rsc.why.detectionBlind`. Otisk scénáře se nemění (deklarace detekce sama znovu neotevře zamítnutý návrh).
4. Zpráva o hodnocení rizik: `RiskDataReport.detection` → část 7.7.

## Důsledky

- Plán monitoringu SOC má podklad (slepá místa podle scénářů) a scénáře odrážejí skutečnou schopnost detekce.
- CONTIX do SIEM nic nezapisuje; pravidla mimo CONTIX se jen deklarují.
