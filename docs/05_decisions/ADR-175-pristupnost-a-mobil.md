# ADR-175: Přístupnost a mobilní zobrazení (v1.82)

## Kontext

CONTIX používají i vedoucí a garanti mimo IT, často z telefonu; veřejný sektor má povinnost přístupnosti
(zákon č. 99/2019 Sb., WCAG 2.1 AA). Systematická kontrola dosud chyběla.

## Rozhodnutí

- Jednorázový audit nástrojem axe-core (pravidla wcag2a, wcag2aa, wcag21aa) a měřením šířky stránky na 80 obrazovkách
  (ukázková data), mobil 390 px a počítač, světlý i tmavý režim. Nástroj není závislostí projektu.
- Opravy:
  - `.text-slate-400` se vykresluje odstínem slate-500 (světlý ≥ 4,6 : 1, tmavý ≥ 6 : 1); ohraničení a pozadí beze změny.
  - `Select` bez popisku (`<label>`, `aria-label`, `aria-labelledby`) dostane přístupný název z textu první volby –
    pokrývá filtry v lištách i budoucí výběry; hlavní filtry mají název i výslovně.
  - Posuvné oblasti bez ovládacích prvků `tabIndex=0`; graf vazeb `role="group"` (obsahuje ovládací prvky); ukazatel
    stavu aktiva `role="img"`; odkaz v textu podtržený.
  - Tmavý režim: `!text-white` (aktivní podsekce) ve vrstvě `utilities` (důležitost ve vrstvě přebíjí nevrstvenou),
    `text-brand-600` a `text-red-600` světlejší; náhled hlavičky dokumentu má pevné barvy papíru.
  - Dlaždice taktik SOC bez výskytu bez průhlednosti (průhlednost snižovala kontrast textu).
- Regrese hlídá e2e test: na hlavních obrazovkách na šířce telefonu žádný vodorovný posun stránky a každý viditelný
  ovládací prvek má název.

## Důsledky

- Tlumený text je o stupeň výraznější. Nové filtry bez popisku dostanou název automaticky, výslovný `aria-label` je lepší.
