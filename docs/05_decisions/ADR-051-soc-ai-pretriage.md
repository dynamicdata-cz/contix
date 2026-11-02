# ADR-051: AI předběžná triáž alertů SOC

**Stav:** přijato (v0.56.0)

## Kontext
Analytik u každého nového alertu ručně dohledává, jak dopadly podobné alerty dříve, a odhaduje, zda jde o útok.
Fronta s desítkami alertů denně tak stojí hlavně na rutinním třídění. AI rozbor (ADR-046) běží jen na vyžádání
a historii podobných alertů nezná. Data nesmí opustit lokální model.

## Rozhodnutí
- **Podobné alerty** (`similarAlerts`): rozhodnuté (accepted / dismissed) alerty téže společnosti za 180 dní; skóre
  stejné pravidlo +3, hostitel / aktivum +2, zdrojová IP +2, společná technika ATT&CK +1; nejvýše 5.
- **Návrh** (`triageAlert`): lokální model dostane `alertContext` (alert, aktivum, zranitelnosti) a seznam podobných
  alertů jen s názvem, výsledkem (eskalováno / verdikt), důvodem podobnosti a datem. **Nejdou** jména osob, poznámky
  ani zdůvodnění analytiků. Odpověď je JSON (verdikt, závažnost, jistota, zdůvodnění), validovaný proti výčtům;
  akce se odvodí (`triageAction`: true_positive → eskalovat, false_positive / benign → uzavřít, undetermined → prověřit).
- Uloží se do `alert_suggestions.ai_triage` (jsonb) včetně modelu, času, doby a případné chyby. Chyba alert neblokuje;
  plánovač ji zkusí znovu po 6 h.
- **Plánovač** (`processPreTriage`, v cyklu notifikací po přepočtu expozice): otevřené alerty bez triáže, nejzávažnější
  první, nejvýše 20 za běh a 2 min, nikdy dva běhy současně. Jen když je zapnutý modul SOC, AI asistent a nastavení
  `soc.aiTriage` (výchozí zapnuto).
- **Jen návrh**: nic se neaplikuje samo. V detailu „Použít návrh“ otevře uzavření s předvyplněným verdiktem nebo
  eskalaci; potvrzuje analytik. `POST /soc/alerts/:id/triage` (soc:write + ai:use) posoudí znovu, auditováno.
- Fronta: sloupec a filtr `ai=tp|fp|none`.

## Důsledky
- Zátěž lokálního modelu roste s počtem alertů – omezeno limitem za běh; při velké frontě se doplňuje postupně.
- Kvalita návrhu závisí na historii verdiktů – nová instalace zpočátku navrhuje spíš „nelze určit“.
