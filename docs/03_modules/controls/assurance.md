# Testy a důkazy

Opatření a shoda → **Testy a důkazy** (`/controls/assurance`) a karty *Důkazy* a *Testy účinnosti* na detailu opatření.
Rozhodnutí: [ADR-017](../../05_decisions/ADR-017-evidence-control-testing.md).

## Důkazy

- Druh (dokument, záznam, snímek obrazovky, export, konfigurace, zpráva, odkaz), pořízení, období, **platnost**.
- Soubory (max. 25 MB) se ukládají do databáze s kontrolním součtem SHA-256; stažení se loguje. Nebo odkaz (SharePoint…).
- Jeden důkaz může dokládat více opatření. Prošlé / brzy končící důkazy jsou v přehledu povinností.

## Testy

| | Test návrhu (Type I) | Test provozní účinnosti (Type II) |
|---|---|---|
| Otázka | Existuje opatření a je správně navrženo? | Fungovalo po celé období? |
| Vzorek | obvykle 1 (směrnice, konfigurace) | podle frekvence: ročně 1, čtvrtletně 2, měsíčně 2–5, týdně 5–15, denně 20–40 |
| Období | – | od–do (např. kalendářní rok / období zprávy SOC 2) |

1. **Naplánovat test** – opatření, druh, metody (dotazování, pozorování, kontrola záznamů, opakované provedení),
   frekvence, populace, období, termín, kdo testuje, postup. Termín je v přehledu povinností.
2. **Vzorky** – přidat (např. „Q1, Q2, Q3“), u každého výsledek (vyhovuje / výjimka / nelze posoudit),
   odkaz na důkaz a poznámku. Výsledek se odvozuje (výjimky nad tolerovaný počet = neúčinné).
3. **Dokončit** – výsledek, závěr, datum; volitelně nastaví účinnost opatření a datum přezkumu.
   Dokončený test nelze měnit (lze znovu otevřít – zaznamená se).

Přehled ukazuje otevřené a zpožděné testy, výsledky za 12 měsíců, **zavedená opatření bez testu a bez důkazu**.

## Rozsah SOC 2

Administrace → Nastavení → *Rozsah zprávy SOC 2* (u dceřiné společnosti může být vlastní). Bezpečnost (CC) je vždy;
kritéria nezvolených kategorií jsou v SoA neaplikovatelná s odůvodněním „Mimo rozsah zprávy SOC 2“.

## Důkazy k požadavkům

Důkaz lze navázat i přímo na požadavek rámce (např. kritérium SOC 2 nebo písmeno vyhlášky) – v detailu důkazu
vyberte rámec a požadavky. V prohlášení o aplikovatelnosti je u každého aplikovatelného požadavku počet důkazů
(přímo + přes opatření), resp. upozornění „bez důkazu“.

## Balíček pro auditora

Testy a důkazy → **Balíček pro auditora**: rámec, období testů, s/bez souborů → ZIP:

| Soubor | Obsah |
|---|---|
| `00_obsah.html` | přehled požadavek → shoda → opatření → testy → důkazy, seznam důkazů s kontrolními součty |
| `01_prohlaseni_o_aplikovatelnosti.html` / `.docx` | SoA k datu vytvoření |
| `testy/*.html` | protokoly testů (parametry, postup, vzorky, závěr) |
| `dukazy/*/…` | soubory důkazů |
| `manifest.csv`, `SHA256SUMS` | kontrolní součty všech souborů (`sha256sum -c SHA256SUMS`) |

Viz [ADR-019](../../05_decisions/ADR-019-audit-package.md).
