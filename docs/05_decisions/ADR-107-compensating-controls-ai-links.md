# ADR-107: Kompenzační opatření k výjimkám, AI systémy ↔ rizika a opatření, CSOC ze zpráv dodavatelů

**Stav:** přijato (v1.11)

## Kontext

Výjimky (ADR-039) se počítají z modulů a nebylo kam zapsat, čím se riziko po dobu výjimky snižuje. AI systémy
neměly vazbu na registr rizik a katalog opatření. U zakázky SOC 2 se CSOC subdodavatelů opisovaly ručně, ačkoli
zprávy dodavatelů (ADR-098) jsou v evidenci.

## Rozhodnutí

- **Kompenzační opatření**: tabulka `exception_controls` (druh výjimky, id záznamu jako text – neaplikované
  ustanovení má klíč `společnost:požadavek`, opatření, poznámka, název výjimky v době navázání).
  `PUT /api/exceptions/:kind/:id/controls` nahradí seznam; výjimka se ověří načtením přes `loadExceptions` (čtení),
  zápis vyžaduje `EXCEPTION_WRITE[kind]` ve společnosti výjimky, opatření ze stejné společnosti; audit
  `exception.compensating_set`. `ExceptionDto` nese `compensating`, `compensatingNote`, `canEdit`; CSV sloupec.
- **Zpětné vazby**: druh `exception` u opatření (řádky nesou vlastní oprávnění podle druhu výjimky – sloupec `perm`),
  `ai_system` u rizika a opatření.
- **AI systém**: vazební tabulky `ai_system_risks`, `ai_system_controls` (`riskIds`, `controlIds` ve vstupu, `risks`,
  `controls` v DTO).
- **SOC 2 subdodavatel**: u subdodavatele s dodavatelem web ukáže poslední zprávu SOC 2 (výrok, platnost, nedostatky)
  a převezme položky `csoc` zprávy do CSOC (bez duplicit). Nic se nepersistuje navíc.

## Důsledky

Migrace 0085. Nový druh výjimky = také `EXCEPTION_WRITE`. Přesun záznamu výjimky mezi společnostmi kompenzační
opatření nepřesouvá (opatření patří společnosti).
