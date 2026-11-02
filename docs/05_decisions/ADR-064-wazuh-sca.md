# ADR-064: Shoda konfigurace z Wazuh SCA

**Stav:** přijato (v0.69.0)

## Kontext
Wazuh na agentech vyhodnocuje Security Configuration Assessment (CIS benchmarky a další politiky). Výsledky jsou
přímým důkazem provozní účinnosti opatření (bezpečná konfigurace, hesla, auditní záznamy), ale v CONTIXu chyběly.

## Rozhodnutí
- Načtení `syncSca` (`modules/sca/service.ts`) přes Wazuh API (`wazuhApiClient`, jen GET): pro aktiva spárovaná s agentem
  `GET /sca/{agent}` (politiky, skóre) a při změně `end_scan` `GET /sca/{agent}/checks/{policy}` (stránkování).
  Tabulky `sca_results` (aktivum × politika), `sca_check_defs` (sdílené definice kontrol vč. `compliance` – CIS, ISO 27001,
  NIST, PCI…) a `sca_check_results` (aktivum × kontrola). Výsledek kontroly jen `scaResultOf` (4.x `result`, starší `status`).
- Plánovač jednou denně (`maybeSyncSca`, je-li Wazuh API zapnuté), ručně `POST /sca/sync` (discovery:run).
- Skóre jen `scaScore` = splněné / (splněné + nesplněné); přehled `GET /sca`, detail aktiva `GET /sca/assets/:id`.
- Automatický test opatření: druh `sca` v `control_automations` (politiky v rozsahu, prahy účinné / s výjimkami) –
  dokončený test + CSV důkaz (sdílené `storeAutomationEvidence` / `finishAutomationTest`), výsledek `scaTestResult`;
  při chybě posledního načtení se test neprovede. Správa v `/sca/automations` (controls:test), v Identitě se nezobrazuje.

## Důsledky
- Kontroly bez skenu (agent odpojený) se nemažou – zůstává poslední známý stav s časem skenu.
- Mapování na požadavky vyhlášky je zatím informativní (zobrazení `compliance`), přiřazení k opatření je ruční (automatický test).
