# ADR-060: Playbooky SOC s úkoly pro tým

**Stav:** přijato (v0.65.0)

## Kontext
Vestavěné playbooky (ADR-046) jsou jen kontrolní seznam pro analytika. Reakce na incident ale vyžaduje práci dalších
rolí (správce sítě, vlastník aktiva, helpdesk) s termíny a doložitelným splněním; organizace mají vlastní postupy.

## Rozhodnutí
- Tabulka `soc_playbooks` (za společnost): název, popis, techniky a taktiky ATT&CK (návrh), kroky `{text, ownerPositionId, dueHours}`,
  zapnuto, `basedOn` (vestavěný vzor). Klíč vlastního playbooku v alertu `c:<id>`.
- Výběr `resolvePlaybook` (`soc/playbooks.ts`): uložený klíč (vestavěný nebo vlastní společnosti alertu), jinak `pickPlaybook` –
  nejdřív vlastní podle techniky, pak taktiky, jinak vestavěný `playbookFor`. Stejně pro AI rozbor.
- Úkoly z kroků `POST /soc/alerts/:id/playbook-tasks` (soc:write, otevřený alert): běžné `tasks` se zdrojem `soc_alert`
  a novým sloupcem `source_step`; přeskočí hotové kroky a kroky s otevřeným úkolem; funkční místa jen ze společnosti alertu
  (nebo nadřazených). Priorita podle úrovně alertu. Poznámka do alertu + audit.
- Splnění úkolu (PATCH v modulu Akce a úkoly) → `onPlaybookTaskDone`: krok do `playbook_done` a poznámka alertu.
- Smazání používaného playbooku jen vypne (alerty ho dál zobrazují).

## Důsledky
- Úkoly vidí vlastníci v „Moje povinnosti“ (stávající povinnost `task`), bez nového oprávnění.
- Vrácení úkolu do stavu otevřeno krok automaticky neodškrtne (rozhodne analytik).
