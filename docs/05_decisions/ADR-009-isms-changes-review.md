# ADR-009: Řízení změn a přezkoumání ISMS

**Stav:** přijato · 30. 9. 2026

## Kontext

§ 11 vyhl. 409/2025 vyžaduje stanovit kritéria významných změn, určovat je a řídit (rizika, opatření, dokumentace, test,
návrat, rozhodnutí o pentestu). § 3 písm. f)–h) vyžaduje alespoň ročně vyhodnotit účinnost ISMS v sedmi bodech a zpracovat
zprávu o přezkoumání, se kterou se seznamuje vrcholné vedení.

## Rozhodnutí

1. Nový modul `isms` (změny, cíle) s oprávněními `isms:read`/`isms:write`, protože jde o řízení celého ISMS, ne o modul rizik
   či opatření.
2. Změna je jeden záznam s poli pro jednotlivá písmena § 11 odst. 2; mezery se počítají funkcí `changeGaps` podle fáze
   (sdílená logika pro API i živý náhled ve formuláři). Nejde o ITSM/CAB workflow – CONTIX eviduje bezpečnostní rozměr změny,
   provozní change management zůstává v ITSM nástroji.
3. Kritéria významnosti jsou nastavení organizace (text), u změny se ukládá kopie splněných kritérií, aby změna kritérií
   nezměnila historii.
4. Zpráva o přezkoumání je další druh `document_versions` (ADR-008): snímek automaticky sbírá data ze zapnutých modulů,
   hodnocení bodů doplňuje člověk. Body bez zdrojového modulu (audity, incidenty) jsou zatím text.

## Důsledky

- Po doplnění modulů Audity a Incidenty se body 4 a 6 budou plnit automaticky.
- Změnu kritérií je vhodné provádět přes schválenou bezpečnostní dokumentaci; CONTIX ji jen eviduje (auditní log nastavení).
