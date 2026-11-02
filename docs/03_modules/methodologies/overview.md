# Metodiky analýzy rizik a auditu

Metodika je **balíček dat** (YAML, JSON nebo XML), ne kód. Definice se ověří schématem (`MethodologyDef` ve
`shared/methodology.ts`), zkontroluje se vzorec a vazby a zaregistruje se do sdíleného registru – výpočet je stejný
v API, dokumentech i UI.

## Vestavěné metodiky

| Id | Druh | Popis |
| --- | --- | --- |
| `zkb409` | rizika | Příloha č. 4 vyhl. 409/2025 (aktivum × hrozba × zranitelnost, 3–5 úrovní) – nastavení v Administraci |
| `octave_allegro` | rizika | OCTAVE Allegro (CERT/SEI): 5 oblastí dopadu s vahami, dopad 1–3 v každé oblasti, pravděpodobnost 1–3, relativní skóre = vážený součet, pooly 1–4 |
| `matrix_5x5` | rizika | Dopad × pravděpodobnost 5×5 (ISO/IEC 27005) – vzor pro vlastní metodiku |
| `zkb409_audit`, `zkb410_audit` | audit | Kontrolní seznamy generované z požadavků vyhlášek (položka = požadavek, omezení rozsahem auditu) |

**OCTAVE Allegro – výchozí hranice poolů** (relativní matice, skóre 15–45): pool 1 = pravděpodobnost 3 a skóre ≥ 30;
pool 2 = pravděpodobnost 3 a skóre ≥ 16, pravděpodobnost 2 a skóre ≥ 16, nebo pravděpodobnost 1 a skóre ≥ 30;
pool 3 = ostatní s pravděpodobností 2 a pravděpodobnost 1 se skóre ≥ 16; pool 4 = zbytek (akceptovatelné).
Váhy oblastí i hranice jsou **výchozí – organizace je má ověřit a upravit** (export → úprava → import pod vlastním id).

## Formát (YAML)

```yaml
kind: risk                 # risk | audit
id: moje_metodika          # malá písmena, číslice, _ (max. 40)
name: Moje metodika
version: "1.0"
formula: dopad * pravdepodobnost     # + - * / ^, závorky, min max round ceil floor sqrt
areas:                     # volitelné – oblasti dopadu s vahou
  - { key: finance, label: Finance, weight: 3 }
areaAggregate: weighted_sum          # weighted_sum | sum | max | weighted_max
factors:
  - key: dopad
    label: Dopad
    perArea: true          # hodnotí se v každé oblasti
    scale: [{ value: 1, label: nízký }, { value: 2, label: střední }, { value: 3, label: vysoký }]
  - key: pravdepodobnost
    label: Pravděpodobnost
    scale: [{ value: 1, label: nízká }, { value: 2, label: střední }, { value: 3, label: vysoká }]
levels:                    # mapsTo = úroveň CONTIX (low/medium/high/critical)
  - { key: ok, label: Přijatelné, mapsTo: low, max: 3, acceptable: true }
  - { key: zvysene, label: Zvýšené, mapsTo: high, min: 4 }
rules:                     # volitelné – místo rozsahů skóre; první shoda vyhrává
  - { level: zvysene, when: { pravdepodobnost: { min: 3 } } }
steps: [{ key: krok1, title: Identifikace aktiv }]
```

Audit: `kind: audit` a `checklist: [{ id, question, section?, ref?, requirementId?, guidance? }]`. `requirementId`
(např. `cz409:8/1/c`) propojí neshodu s požadavkem katalogu.

XML: kořen `<methodology kind="…" id="…" version="…">`, skalární vlastnosti jako atributy nebo prvky, kolekce v obalech
`<factors><factor>`, `<scale><step>`, `<areas><area>`, `<levels><level>`, `<rules><rule level="…"><when var="…" min="…"/>`,
`<steps><step>`, `<checklist><item>`. Nejjednodušší je exportovat vestavěnou metodiku jako XML a upravit ji.

## Použití

- Metodika rizik: Administrace → Nastavení (celá skupina) nebo u společnosti (Administrace → Společnosti).
  Riziko si pamatuje metodiku, ve které bylo hodnoceno (`methodology_key`, `factor_values`); po změně metodiky je
  označeno k přehodnocení a dál se počítá ve své původní metodice.
- Metodika auditu: u auditu (kontrolní seznam). Výsledky položek `audit_checks`; z neshody lze založit zjištění.
- Zpráva o hodnocení rizik obsahuje zmrazenou definici metodiky (faktory, oblasti, vzorec, úrovně, pravidla, postup).

## API

`GET /api/methodologies` · `POST /validate` · `POST /import` (`admin:settings`, `replace` pro přepsání) ·
`GET /:id/export?format=yaml|json|xml` · `DELETE /:id` (jen nepoužitá importovaná) ·
`GET|PUT /api/audits/:id/checklist` · `POST /api/audits/:id/checklist/finding`.

## Bezpečnost

Vzorec se nikdy nevyhodnocuje přes `eval` – vlastní tokenizer a vyhodnocovač (shunting-yard) s povolenými operátory
a funkcemi; proměnné musí být klíče faktorů (`score` v pravidlech). XML parser bez externích entit.
