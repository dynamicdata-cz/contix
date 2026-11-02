# ADR-020: Verze procesů a modul GDPR

**Stav:** přijato · 3. 10. 2026

## Verze procesů

1. Proces se dál edituje „živě“; **verze** je neměnný snímek (`process_versions.snapshot`) procesní karty, kroků
   s RACI a aktivy, aktiv a dokumentů procesu – bez rizik a jmen uživatelů. Snímek vzniká z detailu procesu
   (`processSnapshotOf`), takže odpovídá tomu, co uživatel vidí.
2. Najednou smí existovat jen jeden návrh verze. Schválení (`processes:write` nebo `documents:approve`) nahradí
   předchozí schválenou verzi a návrhový proces převede do stavu „Platný“. Schválené verze nelze mazat.
3. Porovnání (`diffProcess`) běží v prohlížeči nad dvěma snímky (nebo snímkem a aktuálním stavem); kroky se párují
   podle názvu.

## GDPR

1. Samostatný modul `gdpr` (zapínatelný) s oprávněními `gdpr:read` / `gdpr:write`. Záznam o činnosti zpracování
   obsahuje náležitosti čl. 30 odst. 1 a vazby na procesy, aktiva, dodavatele (zpracovatele) a opatření z katalogu –
   GDPR tak využívá existující evidenci místo duplicitních seznamů systémů.
2. **Screening DPIA** podle 9 kritérií WP248; 2+ kritéria → DPIA zpravidla nutné. Mezery záznamu (`activityGaps`)
   se počítají, nepersistují.
3. DPIA: popis, nezbytnost, rizika pro práva a svobody (pravděpodobnost × závažnost 1–4, zbytkové po opatřeních),
   stanovisko pověřence, závěr, předchozí konzultace. Schválené DPIA je zamčené; úprava = vrácení do zpracování.
4. Přezkum záznamu (výchozí 12 měsíců) a DPIA jsou povinnosti (`processing_review`). Výstup „Záznamy o činnostech
   zpracování“ v HTML/Wordu přes sdílený převodník (ADR-018).
