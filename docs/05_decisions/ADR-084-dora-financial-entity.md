# ADR-084: Finanční subjekt podle DORA a štítek rámce v modulech

**Stav:** přijato (v0.88)

## Kontext
DORA (nařízení EU 2022/2554) je přímo použitelné nařízení – nezávisí na balíčku země. Společnost v holdingu (banka, pojišťovna) se dříve dala nastavit jen jako „bez národního předpisu + hlavní rámec DORA“, čímž přišla o český zákon, metodiku rizik a hlášení podle správného předpisu.

## Rozhodnutí
- `companies.dora_entity` (příznak nezávislý na balíčku); `profileOf` vrací `doraEntity`, `sector = "dora"` – DORA patří do `baseFrameworks` / `frameworksInScope` vždy.
- Hlavní rámec: CZ – vyhláška podle režimu zůstává (neregulovaná CZ → DORA); ostatní balíčky – zvolený rámec, jinak DORA.
- Hlášení incidentů: `incidentRegime = "dora"` (DORA má u finančních subjektů přednost před NIS2 / ZKB, čl. 4 NIS2 lex specialis) – lhůty `incidentDeadlines`: prvotní 24 h od zjištění (4 h od klasifikace), průběžná 72 h od prvotního, závěrečná 1 měsíc od poslední průběžné (nař. 2025/301); adresát `financial_supervisor` (nová hodnota enumu, `DORA_AUTHORITY` podle jurisdikce).
- Štítek rámce `FrameworkBadge` v `PageHeader` modulů podle profilu aktivní společnosti (v souhrnu skupiny se nezobrazuje).
