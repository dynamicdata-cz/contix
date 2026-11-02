# ADR-080: Regulatorní profil společnosti

**Stav:** přijato (v0.84)

## Kontext
Moduly odvozovaly vyhlášku přímo z režimu (`regime === "lower" ? "cz410" : "cz409"`) – CONTIX tak šel použít jen s českou legislativou. Knihovna rámců (ADR-079) umožnila vlastní rámce; chyběl mechanismus, podle kterého se jim přizpůsobí ostatní moduly.

## Rozhodnutí
- **Profil** = balíček země (`companies.pack`: `cz` | `generic`) + úroveň povinností (`regime`) + hlavní rámec z knihovny (`companies.primary_framework`). Počítá ho jen `profileOf` (`shared/regulatory.ts`): `primary`, `law`, `defaultFramework`, `auditMethodology`, `riskMethodology`, `authority`.
- **Balíček CZ**: vyšší povinnosti → 409 + ZKB, nižší → 410 + ZKB, neregulovaná → hlavní rámec volitelně z knihovny (výchozí výběry zůstávají 409 kvůli návaznosti). **Obecný balíček**: bez národního zákona, hlavní rámec z knihovny, metodika rizik 5 × 5.
- Moduly (opatření, SoA, pokrytí, přehledy, zprávy, trendy, audity, AI, legislativa, dokumenty) berou rámec z profilu; `frameworksInScope` přijímá profil. Funkce vázané na strukturu české vyhlášky (výchozí katalog V-xx/N-xx, oddíly ISMS, šablony dotazníků a doložek) jen přes `czDecreeOf`. Test v `review.test.ts` hlídá literál `"cz409"`/`"cz410"` – seznam povolených souborů se má jen zmenšovat.
- **Audity**: kontrolní seznam z libovolného rámce s použitím „audit“ jako dynamická metodika `fw:<rámec>` (`frameworkChecklist`, cache podle verze registru rámců); nový audit dostane seznam podle profilu; pokrytí auditů podle hlavního rámce.
- **Rizika**: doporučená metodika balíčku. Dceřiná společnost bez vlastní metodiky v jiném balíčku než kořen dostane metodiku svého balíčku (`companySettings`); změna balíčku kořene přepne výchozí metodiku skupiny, jen pokud se používala výchozí metodika původního balíčku.

## Důsledky
Další krok (0.85): pravidla hlášení incidentů, povinné dokumenty ISMS, významné změny a školení jako data balíčku. 0.86: balíčky SK, PL, DE/AT.
