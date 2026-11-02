# ADR-117: Plán zvládání a zbytkové riziko z dat (v1.20)

## Kontext

Cyklus analýza → plán zvládání → zbytkové riziko → ověření účinnosti (§ 8 vyhlášky č. 409/2025 Sb., ISO 27001 6.1.3, 8.3)
měl v CONTIXu slabé místo: návrh zbytkového rizika (`suggestResidual`) vycházel jen z deklarované účinnosti opatření,
i když CONTIX zná výsledky testů (ADR assurance) a průběžných monitorů (ADR-096). Z mezer zjištěných ve scénářích z dat
(ADR-114/115) se navíc akce plánu musely přepisovat ručně.

## Rozhodnutí

1. **Účinnost podle důkazů** – `evidencedEffectiveness` (shared): neúčinný poslední dokončený test nebo nesplněný zapnutý
   monitor = opatření se do zbytkového rizika nezapočte; poslední test „účinné s výjimkami“ = nejvýš částečně účinné.
   API dodává `lastTestResult` / `monitorFailing` u opatření rizika (`controlEvidenceCols`). Návrh zůstává jen návrhem.
2. **Podnět `control_monitor`** (ADR-058): zapnutý monitor navázaného opatření je naposledy nesplněný a nesplnění nastalo
   po základu rizika. Silný u opatření vedeného jako účinné; patří na stranu zranitelnosti v `suggestFromTriggers`.
3. **Návrhy akcí plánu** – `planSuggestions` (shared, deterministicky): zavést nezavedené navázané opatření, obnovit účinnost
   (test / monitor / hodnocení neúčinné), posílit slabou nebo doložit neznámou schopnost z přijatých a navázaných scénářů
   rizika. `GET /risks/:id/plan-suggestions`; založení jen `POST /risks/:id/plan-suggestions/apply` (vlastník rizika nebo
   správce rizik, vybrané klíče, odpovědné místo, termín), návrhy už v plánu (stejné opatření nebo název) se nezaloží znovu.
4. **Úkol k neposouzené hrozbě** v pokrytí katalogu (ADR-115) – běžný úkol navázaný na aktivum přes API úkolů.

## Důsledky

- Zbytkové riziko odpovídá doloženému stavu opatření; neúčinný test nebo monitor se promítne do návrhu i do podnětů.
- Plán zvládání vzniká z dat rychleji, ale vždy rozhodnutím člověka; žádná AI.
