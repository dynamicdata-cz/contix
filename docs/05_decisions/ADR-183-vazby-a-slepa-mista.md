# ADR-183: Vazby a slepá místa – zjištění dojdou tam, kde mají něco změnit

Stav: **přijato** (v1.88.0) – navazuje na [ADR-101](ADR-101-record-links.md), [ADR-058](ADR-058-risk-reassessment-triggers.md),
[ADR-096](ADR-096-continuous-control-monitoring.md), [ADR-162](ADR-162-naprava-nalezu.md), [ADR-177](ADR-177-agenti-a-koncentratory.md),
[ADR-181](ADR-181-mapa-propojeni.md) a [ADR-182](ADR-182-smer-agentu-a-sond.md).

## Kontext

Analýza vazeb verze 1.87 (234 tabulek, 61 modulů) ukázala, že kostra evidencí je propojená oběma směry, ale zjištění
se často zaeviduje a nedojde tam, kde má něco změnit: do shody s požadavky, k riziku nad primárním aktivem,
k garantovi, do úkolů nebo do upozornění. Zjištěná slepá místa:

| # | Slepé místo | Řešení |
|---|---|---|
| H1 | SoA nereaguje na nesplněné monitory, neshody auditů, incidenty, nálezy testů | Signály u opatření a požadavku, příznak „k přehodnocení“ |
| H2 | Podněty k riziku jen přes přímo navázaná aktiva | Aktiva rizika vč. podpůrných aktiv a aktiv procesů, příznak `indirect` |
| H3 | Balíčky z agenta / sběrače se nezapisují do softwaru aktiva | `syncInventorySoftware` při změně balíčků a při spárování |
| M1 | Výpadek zdroje dat nikoho neupozorní | Druh upozornění `data_source` z mapy propojení |
| M2 | Nálezy identit a SoD mimo registr nálezů a úkoly | Zdroj `identity` v registru a metrikách, zdroje úkolů `identity_finding`, `sod_violation` |
| M3 | Zranitelnosti chybí v souhrnu garantů a v úkolech | Souhrn garantů vč. zranitelností a neshod auditů, úkoly `vulnerability`, krok plánu s jedním nálezem navázaný |
| M4 | Server s agentem do spárování mimo rizika | Upozornění M1 + hromadné spárování / založení aktiv |
| M5 | Kritičnost aktiva se neodvozuje z procesu | Kontrola kvality `assets_crit_below_process` |
| M6 | Zranitelnosti produktů CRA nejsou podnětem k riziku | Podnět `cra_finding` |
| M7 | Rozsah auditu bez vazby na procesy, aktiva a opatření | Tabulky `audit_processes`, `audit_assets`, `audit_controls`, přehled pokrytí audity |
| L1 | Obecné odkazy bez cizího klíče po smazání zůstávají | Úklid v plánovači, počty štítků jen existujících záznamů |
| L3 | Úkoly projektů mimo Moje akce | Druh akce `project_task` |

Bod L2 analýzy (nález testu bez cizího klíče na opatření) se ukázal jako chybný – cizí klíč existuje.

## Rozhodnutí

1. **Signály, ne automatická změna shody.** Signál ukazuje skutečnost (monitor, neshoda, incident, test, důkaz),
   míru shody a účinnost mění dál člověk (stejně jako ADR-182). Závažný signál u požadavku se stavem splněno /
   částečně označí požadavek „k přehodnocení“. Výpočet je jeden (`controls/signals.ts`), používá ho seznam opatření,
   detail i SoA.
2. **Aktiva rizika pro podněty** = přímo navázaná + podpůrná aktiva navázaných primárních aktiv + aktiva navázaných
   procesů a jejich podpůrná aktiva. Nepřímé podněty se označí; přímá vazba má přednost. Incident je silný podnět jen
   přímo.
3. **Úkoly z nálezů** se zakládají ručně z registru (výběr nebo všechny bez úkolu); úkoly ze zranitelností, identit
   a SoD uzavírá plánovač, když zdroj přestane být otevřený. Identity nemají aktivum – úkol je bez řešitele a přidělí
   ho bezpečnostní tým.
4. **Upozornění na zdroje dat** čerpá z mapy propojení (`loadIntegrationMap`) – stav chyba / varování, položka
   kořenové společnosti, jen pro správu systému. Nová kontrola stavu propojení se tím propíše i do upozornění.
5. **Obecné (polymorfní) vazby** bez cizího klíče uklízí plánovač (`quality/dangling.ts`). Nová taková vazba se
   musí přidat do `ENTITY_TABLES`, jinak po smazání záznamu zůstane.
6. **Rozsah auditu** je vazba s cizími klíči (smazání záznamu vazbu odstraní); pokrytí počítá jen dokončené audity
   s datem ukončení.

## Důsledky

- SoA a seznam opatření ukazují i to, co dřív bylo vidět jen v monitoringu, auditech a incidentech.
- Více podnětů k přehodnocení rizik (nepřímé) – vlastník rizika je potvrdí jako dosud.
- Plánovač běží o dva kroky déle (uzavření úkolů, úklid odkazů) – jednoduché dotazy, bez dopadu na výkon.
- Migrace `0128_audit_scope` (tři nové tabulky).
