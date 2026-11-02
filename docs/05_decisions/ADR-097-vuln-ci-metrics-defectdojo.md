# ADR-097: Zranitelnosti z CI/CD, metriky, Qualys a Dependency-Track, konektor DefectDojo; nové členění menu

- Stav: přijato
- Datum: 2026-10-23
- Verze: 1.02

## Kontext
Po ADR-095 zbývaly z DefectDojo: import z pipeline, metriky správy zranitelností a další formáty. Část organizací DefectDojo
už provozuje – CONTIX má být GRC nadstavba, ne náhrada. Levé menu mělo přeplněnou skupinu „Řízení bezpečnosti“
(ISMS, rizika, opatření, audity, SOC 2, incidenty, SOC, kontinuita) a regulatorní programy (GDPR, AI Act, CRA) v „Evidenci“.

## Rozhodnutí
1. **CI/CD**: `POST /api/public/vulnerabilities/scans`, osobní API token (Bearer ctx_…), oprávnění uživatele tokenu (`assets:write`
   ve zvolené společnosti, token omezený na společnost platí jen pro ni); mimo CSRF (bez cookies). Zpracování společné s UI (`uploadScan`).
   Brána `failOn` jen vyhodnotí nové otevřené nálezy (`failed`) – build zastaví pipeline.
2. **Metriky** `GET /vulnerabilities/metrics` (`vulnMetrics`): MTTR podle závažnosti, dodržení lhůt (podle aktuální priority –
   aproximace), otevřené po termínu, stáří, měsíční vývoj, zdroje, triáž. SQL agregace při čtení, nepersistuje se.
3. **Formáty**: Qualys VMDR (detekce i zpráva skenu), Dependency-Track FPF (potlačené = informativní).
4. **DefectDojo**: jen čtení `/api/v2/findings/?active=true` se stránkováním (další stránka jen na stejném serveru), klíč šifrovaně;
   nález = skener `defectdojo`, klíč podle ID nálezu a endpointu; bez endpointu volitelně aktivum podle názvu produktu. Úplný stav zdroje:
   chybějící nálezy se uzavřou na všech aktivech společnosti (`closeAllOfScanner`), ale jen pokud zdroj vrátil aspoň jeden nález.
5. **Menu**: Řízení a rizika (ISMS, rizika, výjimky, akce) · Shoda a audit (opatření, pokrytí, monitorování, audity, SOC 2, portál auditora)
   · Regulace (GDPR, AI Act, CRA, legislativa) · Bezpečnostní provoz (incidenty, phishing, SOC, zranitelnosti, identity, kontinuita, cvičení)
   · Evidence (aktiva, procesy, dodavatelé, organizace) · Dokumentace.

## Nezahrnuto
Zápis zpět do DefectDojo, známka produktu, upozornění na nesplněnou bránu, omezení API tokenu na IP pro CI.
