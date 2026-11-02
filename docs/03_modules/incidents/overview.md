# Modul Incidenty – události, incidenty a hlášení

Modul `incidents`, oprávnění `incidents:report` (nahlásit událost – mají všechny systémové role),
`incidents:read`, `incidents:write`. API `/api/incidents`, UI *Incidenty* (uživatel jen s `incidents:report` vidí
formulář *Nahlásit událost*).

## Zvládání (§ 14 vyhl. č. 409/2025 Sb.)

| Písm. | V CONTIX |
|---|---|
| f) oznamování neobvyklého chování | formulář *Nahlásit událost* pro všechny uživatele (bez klasifikace) |
| g) posouzení událost / incident | klasifikace Neposouzeno / Událost / Incident (jen `incidents:write`) |
| c) odpovědnost | funkční místo odpovědné za zvládání |
| d) věrohodné podklady | pole Podklady a jejich uchování |
| i) opatření ke zmírnění | pole Opatření |
| j) hlášení dle § 15 zákona | lhůty a záznam podaných hlášení |
| k) příčina | přímá příčina (§ 14 vyhl. 410) + prošetření |
| l) záznamy | záznam incidentu, časová osa, auditní log |
| m) závěrečná zpráva | podklad pro závěrečnou zprávu |
| n) vyhodnocení účinnosti | pole Vyhodnocení a vazby na rizika a opatření |

Mezery (`incidentGaps`) se hlídají podle stavu.

## Povinnost hlásit (§ 15 zákona č. 264/2025 Sb.)

- **Režim vyšších povinností:** Úřadu (NÚKIB) se hlásí incident, který se projevil ve stanoveném rozsahu, má původ
  v kybernetickém prostoru a u něhož nelze do 24 h vyloučit úmyslné zavinění.
- **Režim nižších povinností:** Národnímu CERT jen při **významném dopadu** – únosná míra újmy (nastavení organizace) je
  překročena a současně je významná některá oblast § 14 odst. 1 písm. b) vyhl. 410 (provoz, uživatelé, obnova, aktiva,
  data, příčina).
- `isReportable`, `isSignificant` v `shared/incidents.ts`.

## Lhůty (§ 16 zákona) – `incidentDeadlines`

| Hlášení | Lhůta | Podmínka |
|---|---|---|
| Prvotní hlášení | 24 h od zjištění | vždy, podléhá-li hlášení |
| Oznámení (prvotní posouzení, dopad, IoC) | 72 h od zjištění (24 h u služeb vytvářejících důvěru) | nižší režim: významný dopad; vyšší režim: Úřad sdělil významný dopad na kybernetický prostor státu (§ 16 odst. 2) |
| Závěrečná zpráva | 30 dnů od oznámení | – |
| Průběžná zpráva | bez odkladu po uplynutí 30 dnů | incident po 30 dnech stále trvá; závěrečná pak do 30 dnů od vyřešení |
| Ohlášení ÚOOÚ | 72 h od zjištění | porušení zabezpečení osobních údajů (čl. 33 GDPR) |

CONTIX hlášení **neodesílá** – podává se přes Portál Úřadu (§ 16 odst. 4). Pro každou lhůtu je tiskový **podklad**
(`/incidents/:id/report.html?type=…`) s údaji z evidence; obsahové náležitosti stanoví prováděcí vyhláška NÚKIB.
Po podání se zapíše datum, příjemce, způsob a číslo hlášení.

Incidenty za období se automaticky vypíší ve zprávě o hodnocení rizik (§ 8 odst. 1 písm. c) bod 5) a ve zprávě
o přezkoumání ISMS (§ 3 písm. f) bod 6).
