# ADR-014: Roční hodnotící cykly nad živým registrem a kvantitativní analýza FAIR

**Stav:** přijato · 2. 10. 2026

## Kontext

Uživatel požadoval každoroční novou analýzu rizik a BIA (jako u auditů) a možnost kvalitativní i kvantitativní analýzy.

## Rozhodnutí

1. **Nekopírovat registr každý rok.** Kopie by rozbily vazby (akce plánu, incidenty, zjištění, změny) a historii.
   Místo toho cyklus = událost nad živým registrem se snímky položek „při zahájení“ a „při schválení“.
2. Přehodnocení v kartě rizika / BIA se do běžícího cyklu zapisuje automaticky (`markReassessed`), aby uživatel
   nepracoval dvakrát; potvrzení beze změny je vědomé rozhodnutí s datem a osobou.
3. Kvantitativní analýza FAIR je **doplněk**, ne náhrada kvalitativní metodiky (vyhláška vyžaduje úrovně a kritérium
   akceptovatelnosti). Výsledek se nepersistuje – počítá se z rozpětí (cache v procesu), simulace je deterministická
   (seed z id rizika), takže API, UI i dokument dávají stejná čísla.
4. Portfolio sčítá roční ztráty po iteracích se stejnými seedy jako jednotlivá rizika (předpoklad nezávislosti rizik –
   korelace zatím nemodelujeme).

## Důsledky

- Snímky v cyklu jsou JSON (bez FK na riziko) – historie přežije smazání rizika.
- Korelované scénáře, sekundární ztráty FAIR a kalibrace odhadů (trénink odhadců) jsou možná rozšíření.
