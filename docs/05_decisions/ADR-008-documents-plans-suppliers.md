# ADR-008: Dokumenty ISMS jako snímky, plány kontinuity, evidence dodavatelů

**Stav:** přijato · 30. 9. 2026

## Kontext

Vyhláška 409/2025 vyžaduje zprávu o hodnocení rizik, prohlášení o aplikovatelnosti a plán zvládání rizik schválené
vrcholným vedením s prokazatelným seznámením; vyhl. 410 vyžaduje přehled opatření uchovávat 4 roky. § 15 písm. e)
vyžaduje plány kontinuity a obnovy a jejich testování, § 9 evidenci významných dodavatelů a smlouvy dle přílohy č. 5.

## Rozhodnutí

1. **Dokument = neměnný snímek dat (JSON) + renderer HTML**, ne generovaný soubor. Stav v čase je tak doložitelný i po
   změně registrů, HTML lze kdykoli znovu vykreslit a tisk do PDF zajistí prohlížeč (žádná serverová PDF knihovna).
   Jedna tabulka `document_versions` pro všechny druhy; workflow návrh → schváleno → nahrazeno.
2. **Oprávnění** k dokumentu se odvozuje od modulu (controls/risks); schvalování je samostatné `documents:approve`.
3. **Plány kontinuity** mají vlastní verzi a schválení (nikoli přes `document_versions`), protože jsou editovatelné
   pracovní dokumenty s testy; věcná změna schváleného plánu vytvoří novou verzi v návrhu.
4. **Ustanovení smluv** (přílohy č. 5 / č. 2) jsou data ve `shared` s klíči písmen; stav ustanovení se ukládá do JSONB
   smlouvy, neznámé klíče se zahazují.

## Důsledky

- Snímky rostou s velikostí registru (jednotky MB u velkých organizací) – přijatelné.
- Vstupy § 8 odst. 1 písm. c) jsou zatím volný text; napojení na incidenty/audity přijde s těmito moduly.
