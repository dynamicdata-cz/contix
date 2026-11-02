# ADR-079: Knihovna rámců – vlastní rámce, země a import/export

**Stav:** přijato (v0.83)

## Kontext
CONTIX se má nabízet i v dalších zemích EU, kde neplatí česká legislativa. Rámce byly napevno v kódu (`FRAMEWORK_IDS`) a mapování vedlo jen z vyhlášky 409.

## Rozhodnutí
- Každý rámec má metadata **země** (`jurisdiction`: kód státu, EU, INT), **typ** (zákon, vyhláška, směrnice EU, norma, rámec, interní) a **použití** (`gap`, `audit`, `risk`). Vestavěné rámce je mají v kódu.
- **Vlastní rámce** (ID `x-<klíč>`) jsou globální pro skupinu v tabulce `custom_frameworks` (celý balíček jako jsonb). Sdílený registr (`registerCustomFrameworks`) je doplní do `FRAMEWORKS`, `requirementsOf`, `requirementById` – API načítá z DB (`ensureFrameworks`, middleware + start serveru), web z `/frameworks/catalog`. Vstupy s ID rámce se ověřují `FrameworkIdSchema` (vestavěný nebo načtený vlastní).
- **ID požadavku** = `x-<klíč>:<ref>` (normalizovaná citace, max. 100 znaků) – opakovaný import se stejným klíčem rámec nahradí a posouzení požadavků se stejným označením zůstanou; náhled ukáže přidané / odebrané a počet posouzení u odebraných.
- **Formáty importu:** tabulka CSV / XLSX (sloupce v češtině, slovenštině, angličtině, polštině, němčině; metadata z formuláře), nativní balíček CONTIX YAML / JSON / XML (stejný jako export – přenos mezi instalacemi, základ balíčků zemí) a katalog **OSCAL** (JSON / YAML). Export YAML / JSON / XML / CSV i pro vestavěné rámce.
- **Mapování** u požadavku vlastního rámce (ID požadavků jiných rámců) platí oboustranně (`mappedRequirements`); neznámá ID se při importu vynechají s varováním. **Doplnit mapování opatření** přidá požadavky vybraných rámců ke všem opatřením, která mají namapovaný příbuzný požadavek (vedle crosswalku vyhlášky 409 pro výchozí katalog).
- Vlastní rámec lze zvolit ve sledovaných rámcích, posuzovat v SoA, mapovat na opatření, dokumenty a důkazy. Smazání s posouzeními/vazbami jen s potvrzením (smažou se i ony).

## Důsledky
Další krok (0.84): kontrolní seznam auditu z libovolného rámce, katalogy hrozeb a opatření pro analýzu rizik z knihovny a režim společnosti jako země + rámec místo pevného 409/410. Balíčky zemí (SK, PL, DE/AT) se pak dodají jako soubory pro knihovnu.
