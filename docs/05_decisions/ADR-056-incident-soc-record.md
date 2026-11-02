# ADR-056: Incident × SOC – podklady, návrh doplnění a záznam o zvládání incidentu

**Stav:** přijato (v0.61.0)

## Kontext
Po eskalaci alertu na incident se podklady (alerty, IOC, zásahy, schválení) ze SOC ručně přepisovaly do incidentu.
§ 14 odst. 1 vyhlášky č. 409/2025 Sb. vyžaduje doložit postup zvládání (odpovědnost, podklady, opatření, příčinu,
vyhodnocení) – auditor a NÚKIB chtějí jeden ucelený záznam.

## Rozhodnutí
- Podklady `socEvidenceFor` (`soc/incident.ts`): alerty s `incident_id` nebo v případu eskalovaném na incident, IOC
  se `source_alert_id` z těchto alertů, zásahy k alertům / případům (se jmény navrhovatele, schvalovatele, vykonavatele).
  `GET /incidents/:id/soc` jen se zapnutým modulem SOC a `soc:read` ve společnosti incidentu, jinak `null`.
- **Návrh doplnění** `socDraftFor` (`GET /incidents/:id/soc-draft`): celé nové texty polí podklady / indikátory /
  přijatá opatření (`appendLines` – jen řádky, které v záznamu ještě nejsou), nové položky průběhu (`mergeTimeline`,
  bez duplicit), vznik podle prvního alertu, chybějící aktiva. **Nic se nezapisuje** – UI převezme vybrané části do
  formuláře a uloží je člověk (běžný PATCH incidentu s auditem). Opakované použití nic neduplikuje.
- **Záznam o zvládání** `incidentRecordHtml` (`incidents/record.ts`): podmnožina HTML pro `printPage` i `htmlToDocx`;
  oddíly 1–9 (identifikace, klasifikace, dopad, detekce SOC, podklady a IOC, opatření a zásahy, hlášení a lhůty,
  příčina a poučení, průběh) + nesplněné kroky `incidentGaps`. `GET /incidents/:id/record.html|docx` (incidents:read),
  export do Wordu se audituje. Jména osob v záznamu jsou záměrně (odpovědnost) – dokument není pro AI.

## Důsledky
- Bez modulu SOC je záznam o zvládání stejný, jen bez oddílu Detekce a tabulek IOC / zásahů.
- Hlášení NÚKIB dál podle formulářů `report.html` (typ hlášení); záznam o zvládání je interní dokument organizace.
