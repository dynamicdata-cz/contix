# ADR-118: Rozšířená knihovna scénářů z dat (v1.21)

## Kontext

Prvních osm šablon (ADR-114) pokrývalo hlavně útoky na identity, zranitelnosti a zálohy. Pokrytí katalogu hrozeb (ADR-115)
ukázalo, že hrozby jako H07 (přerušení služeb), H10 (ztráta aktiva), H19 (závislost na dodavateli softwaru) nebo útoky
na OT zůstávaly bez návrhu, i když CONTIX k nim data má.

## Rozhodnutí

1. Šest nových šablon v `SCENARIO_TEMPLATES`: `insider_misuse`, `ddos_outage`, `cloud_misconfig`, `software_supply_chain`,
   `ot_compromise`, `device_loss` – kódy katalogu vyhlášky, techniky ATT&CK (u OT ATT&CK for ICS), signály, schopnosti, CIA.
2. Volitelná podmínka rozsahu `requires` (typy aktiv, aktivum dostupné z internetu), vyhodnocení `templateApplies` nad
   primárním aktivem a jeho podpůrnými aktivy. Firemní signály (MFA, Secure Score) tak nevytvoří např. scénář OT u firmy bez OT.
3. Nové signály z existujících dat (jen čtení v `measureCompany`): `no_redundancy` (podpůrné aktivum s dostupností ≥ 3 nebo
   vysokou kritičností a bez `redundant`), `secure_score_low` (nesplněný zapnutý monitor `m365_secure_score`), `component_vuln`
   (kritické / vysoké zranitelnosti aplikací, kontejnerů, databází, SaaS), `ot_vulnerable` (OT / IoT se zranitelností, EOL nebo
   z internetu).

## Důsledky

- Víc hrozeb z katalogu dostane návrh z dat a pokrytí katalogu roste bez vymýšlení scénářů.
- Stále deterministicky a bez AI; nový signál nebo šablona = data + měření + popisky + test.
