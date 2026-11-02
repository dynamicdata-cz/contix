# ADR-067: Hlášení incidentu NÚKIB / ÚOOÚ

- Stav: přijato (v0.72)

## Kontext
Lhůty hlášení (`incidentDeadlines`) a záznam o podání už CONTIX eviduje, ale obsah hlášení si pracovník skládal ručně z incidentu, nastavení a SOC. Chyběla kontrola, zda hlášení obsahuje povinné údaje.

## Rozhodnutí
- Čistá funkce `buildIncidentReport` (`packages/shared/src/incidentReport.ts`) sestaví oddíly (identifikace, základní údaje, posouzení, SOC, závěr) podle druhu hlášení; povinná pole podle druhu jsou v mapě `REQUIRED`, výstupem jsou chybějící údaje s místem doplnění (organizace / incident / SOC), prostý text a lhůta.
- API `GET /incidents/:id/report?type=` (JSON) a `/report.txt`; vstupy připraví `reportDraftOf` – SOC podklady jen přes `socEvidenceFor` a jen s oprávněním SOC.
- Kontaktní osoba pro hlášení je v nastavení organizace (`incidentContact`).
- Hlášení se nikdy neodesílá automaticky a nepersistuje se; text se uloží jen jako součást záznamu o podání (`incident_reports.summary`), který zapisuje člověk.

## Důsledky
- Pracovník vidí před podáním, co chybí, a nemusí text skládat ručně.
- Nový povinný údaj = pole v `buildIncidentReport` + `REQUIRED`.
