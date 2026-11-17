# ADR-147: Smluvní požadavky zákazníků a doklady firmy (v1.50)

## Kontext

Námět z analýzy (František 1 a 5): bezpečnostní požadavky ze smluv se zákazníky vůči službě evidovat a
dokládat stejně jako předpisy; firemní doklady (ISO certifikát, pentesty, bug bounty) mít s platností.
Analýza ukázala, že většina už existuje: knihovna rámců (ADR-079) s importem z tabulky, důkazy s platností
a upozorněním `evidence_expiry`, u dodavatelů zprávy SOC 2 / ISO 27001 / pentest (supplier_report).

## Rozhodnutí

1. Nový druh rámce `contract` („Smluvní požadavky zákazníka“) a volitelná metadata `contract`
   (zákazník, služba, číslo smlouvy, platnost) v balíčku rámce – v exportu i importu (YAML / JSON / XML / tabulka).
   Mapování na opatření, SoA, pokrytí a audit fungují beze změny; knihovna ukazuje zákazníka a platnost.
2. Nové druhy důkazů `certificate`, `pentest`, `bug_bounty` (migrace 0107 – hodnoty výčtu). Platnost,
   upozornění a balíček pro auditora beze změny.
3. Bez samostatné evidence „dokladů“ – zbytečně by zdvojila důkazy.

## Důsledky

Konec platnosti smlouvy se zatím jen zobrazuje (bez úkolu v Moje práce); rozšíření o povinnost je možné
přes `contract.validUntil`.
