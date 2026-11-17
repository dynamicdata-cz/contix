# ADR-164: Plnění plánu oprav, lhůty a eskalace nálezů, kvalita dat průběžně (v1.71)

## Kontext

Plán oprav (ADR-163) byl jen doporučení – nedal se převést na práci a nebylo vidět, jak se plní. Nálezy testů
a serverů bez úkolu neměly žádný termín, takže „po termínu“ a eskalace na ně nedosáhly; zranitelnosti po lhůtě
dostával jen garant. Kvalita dat se dala zjistit jen otevřením stránky.

## Rozhodnutí

1. **Úkoly z plánu** (`POST /findings/plan/tasks`, `createPlanTasks`): jeden úkol za krok (bez `source_kind` – zdrojem
   je víc nálezů), ID úkolu se uloží do kroku plánu. Řešitel = garant aktiva s nejvíc nálezy kroku (`technicalAssignee`),
   jinak zakladatel; termín `FINDING_PLAN_DUE_DAYS` podle náročnosti; priorita podle nejzávažnějšího nálezu. Krok
   s existujícím úkolem se přeskočí; kroky s nálezy nečitelných zdrojů se nezakládají. Audit `findings.plan_tasks`.
2. **Plnění** (`planView`): stav nálezů kroku z jejich tabulek (`findingStates`, smazaný = vyřešený), krok splněný =
   úkol splněný nebo žádný nález neotevřený. Počítá se při čtení.
3. **Lhůty**: otevřený nález testu / serveru bez otevřeného úkolu má termín `findingSlaDue` (první zjištění +
   `FINDING_SLA_DAYS`, stejné jako lhůty úkolů), zranitelnost `vulnDueSql`. V přehledu `dueFromSla`, v nápravě se
   „po termínu“ počítá stejně (`openDue`).
4. **Eskalace** (`findings/escalation.ts`): po termínu déle než `FINDING_ESCALATION_DAYS` (7) za aktivum; řetězec od
   funkce garanta (`positionOfUser` → `escalationChain` / `escalationLevel`, stejně jako povinnosti ADR-146). Vedoucí
   ji vidí v `GET /findings/escalations` a v pondělním souhrnu. Úkoly z nálezů dál eskalují i v denním souhrnu
   (obecné povinnosti). V nápravě, Zprávě pro vedení a trendech ukazatel `escalated` / `findings_escalated`.
5. **Kvalita dat průběžně**: `qualityOfCompany` (všechny kontroly zapnutých modulů, bez ohledu na oprávnění) do
   měsíčního snímku trendů (`quality_score`, `quality_issues`), stránka ukazuje vývoj. `qualityGapsByUser`:
   vlastník primárního aktiva bez CIA, vlastník aktiva s nálezy bez technického garanta, autor úkolu bez řešitele.
6. **Týdenní souhrn** (pondělí): jeden e-mail na osobu s oddíly *Nálezy na vašich aktivech*, *Nálezy po termínu
   ve vašem týmu* a *Vaše chybějící údaje* – prázdné oddíly se vynechají, deduplikace `once` za den.

## Důsledky

- Eskalace i chybějící údaje se nepersistují – počítají se při běhu upozornění a při čtení.
- Nový plán (znovu AI) začíná bez úkolů; úkoly z předchozího plánu zůstávají v Akcích.
