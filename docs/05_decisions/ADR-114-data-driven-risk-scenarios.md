# ADR-114: Rizikové scénáře z dat a profil bezpečnostních schopností (v1.17)

## Kontext

Analýza rizik podle vyhlášky stojí na scénářích hrozba × zranitelnost × aktivum. V praxi se scénáře a jejich hodnocení
vymýšlejí, přestože CONTIX má o skutečném stavu řadu dat (Wazuh, zranitelnosti a KEV, AD / Entra ID, SCA, síťové segmenty,
BIA a testy plánů, dodavatelé, SOC s technikami ATT&CK). Cílem je navrhovat scénáře z těchto dat, s doklady, a nechat
rozhodnutí na člověku.

## Rozhodnutí

1. **Profil schopností** (`measureCompany`, `risks/scenarios.ts`) – osm schopností (`CAPABILITY_KEYS`): EDR (pokrytí koncových
   zařízení aktivním agentem Wazuh), MFA a privilegované přístupy (identity_accounts / identity_findings), segmentace
   (segmenty, neevidovaná zařízení), správa zranitelností (KEV na aktivech z internetu, po termínu, EOL), hardening (SCA),
   zálohy a obnova (BIA s RTO a úspěšný test plánu za 12 měsíců), dodavatelé (významní s platnou zprávou o ujištění).
   Jen čtení, nic se nepersistuje kromě deklarací. Stav z pokrytí `coverageStatus`; **„neznámá“ se nikdy nepočítá jako zavedená**.
2. **Deklarace** (`capability_declarations`, za společnost): stav, produkt, poznámka, odkaz na důkaz, platnost. Použije se jen
   tam, kde měření chybí; lepší deklarace než změřený stav = upozornění na rozpor (rozhodují data).
3. **Knihovna šablon** `SCENARIO_TEMPLATES` (data v `shared/riskScenarios.ts`): hrozba a zranitelnosti z katalogu vyhlášky
   (`BUILTIN_THREATS` / `BUILTIN_WEAKNESSES`), techniky ATT&CK, signály s váhou, zmírňující schopnosti, ohrožené složky CIA.
   Schopnost ↔ požadavky (`CAPABILITY_REFS`: ISO 27001 příl. A, NIS2 čl. 21, CIS v8.1), vyhláška 409/410 dopočtem přes `CROSSWALK_409`.
4. **Vyhodnocení** jen `evaluateScenario` – deterministické a vysvětlitelné (žádná AI): dopad z CIA primárního aktiva
   (ohrožené složky; bez CIA podle kritičnosti), hrozba = střed stupnice +1 za alerty SOC se stejnými technikami za 90 dní,
   +1 za KEV / kritickou zranitelnost z internetu; zranitelnost z podílu vah doložených signálů a slabých / částečných schopností;
   bez měření střed stupnice s příznakem nízké jistoty. Každá složka má zdůvodnění (`reasons`) a doklady s odkazy.
5. **Návrh vzniká jen z dat** (`scenarioTriggered`): hlavní signál šablony (váha ≥ 2, ne kontextový `internet_exposed`) nebo slabá
   zmírňující schopnost (změřená nebo deklarovaná). Pro primární aktiva přes vazby (`asset_links`) a jeden krok technických závislostí.
6. **Návrhy** `risk_scenario_proposals` (unikátně společnost + šablona + primární aktivum) se snímkem důkazů a otiskem
   `scenarioFingerprint`. Stav: návrh / přijato / navázáno / zamítnuto / neaktuální. Přijetí = **nové riziko přes `POST /api/risks`**
   (stejné validace, oprávnění a audit; katalog, aktiva, opatření, hodnocení u vestavěné metodiky). Zamítnutí vyžaduje zdůvodnění;
   změna otisku zamítnutý návrh znovu otevře; u přijatých a navázaných se změna dat jen označí (`changedSinceDecision`).
   Nic se neaplikuje automaticky.
7. Stávající opatření ke scénáři = opatření společnosti namapovaná na požadavky zmírňujících schopností.
8. Přesun aktiva do jiné společnosti smaže jeho návrhy (v cílové se vygenerují z jejího profilu).

## Důsledky

- Analýza rizik je dohledatelná: každé číslo má zdroj; auditor vidí, z čeho scénář vznikl a kdo rozhodl.
- Kvalita návrhů roste s napojenými zdroji; další konektory (EDR, firewall, PAM, zálohy) rozšíří měření, šablony a vzorec zůstávají.
- Další krok (v1.18): pokrytí katalogu hrozeb po primárních aktivech, podněty k přehodnocení rizik ze změny dat (ADR-058).
