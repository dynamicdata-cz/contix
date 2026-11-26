# ADR-203: Revize prvků fyzické bezpečnosti lokalit

Stav: **přijato** (v1.111.0) – navazuje na ADR-198 (lokality) a nálezy / monitor z v1.109.

## Kontext

Lokalita eviduje, zda má prvky fyzické bezpečnosti (EPS, hašení, UPS, EZS…). Auditor se ale ptá i na to, zda
fungují – doloženě revizí nebo kontrolou provozuschopnosti v předepsaném intervalu. Prošlá revize EPS nebo
hasicího zařízení v serverovně je častý nález.

## Rozhodnutí

1. `FacilityPhysical.revisions` (jsonb u lokality, bez migrace): pro prvek datum poslední revize a interval
   v měsících; bez intervalu platí doporučený (`PHYSICAL_REVISION_MONTHS` – ročně, záložní zdroj půlročně).
2. Hlídá se jen prvek, který lokalita má (ano / částečně) a má zapsanou poslední revizi – evidence je dobrovolná,
   bez data nevzniká šum. Termín = poslední revize + interval (`addMonthsIso`, konec měsíce se zarovná);
   stav `overdue` / `soon` (do 30 dní) / `ok`.
3. Termíny jsou povinnost `premise_revision` (modul Aktiva, odkaz `/assets/locations?id=`), revize po termínu je
   nález monitoringu `premise_revision_overdue` (EPS / hašení / UPS v serverovně nebo datovém centru = vysoká,
   jinak střední) a monitor „Fyzická bezpečnost lokalit“ ji započítá vedle chybějících prvků.

## Důsledky

- Interval je doporučení, ne výklad předpisů o požární ochraně – u konkrétního zařízení ho lze změnit.
- Termíny revizí jsou interní (kalendář je nepřiřazuje k právnímu základu kybernetické bezpečnosti).
