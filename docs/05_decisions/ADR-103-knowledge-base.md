# ADR-103: AI znalostní báze – nové druhy vektorů, znalostní články, správa indexu, HNSW a fulltext

**Stav:** přijato (v1.07)

## Kontext

Vektory záznamů (ADR-044) pokrývaly jen rizika, zranitelnosti, incidenty, výjimky, zjištění, AI systémy a nálezy CRA.
Správce neviděl, co přesně model dostává, nemohl záznam vyřadit ani vypnout druh; vlastní znalosti mimo DMS nešly
přidat; dotaz nad vektory bez pevné dimenze procházel celou tabulku; hledání slov bylo jen LIKE (bez tvarů slov).

## Rozhodnutí

- **Nové druhy** (`RECORD_KINDS`): opatření, aktiva (bez vlastníka, IP, MAC, sériových čísel), procesy, dodavatelé
  (bez kontaktních osob), posouzení změn předpisů, schválené odpovědi knihovny dotazníků, znalostní články.
  Přístup `RECORD_ACCESS` (čtecí oprávnění + modul), text jen z `collectRecordDocs`.
- **Znalostní články** (`knowledge_articles`, modul `knowledge`, oprávnění `knowledge:read` / `knowledge:write`):
  Markdown; koncept vidí jen autoři; zveřejněný se indexuje po úsecích podle nadpisů (`knowledgeChunks`, ref `id#n`).
- **Správa indexu** (`records.index` v app_settings): vypnuté druhy se z indexu odeberou; vyřazení záznamu
  `record_vectors.excluded` (přežije přeindexování, nehledá se, modelu se neposílá); náhled textu
  `GET /records/index/items`; ruční přeindexování na pozadí s lease (`startRecordReindex`), průběh ve stavu.
- **HNSW**: částečné indexy nad přetypováním `embedding::vector(d)` pro d ∈ {384, 768, 1024, 1536} (migrace 0084);
  dotazy jen přes `cosine()` (`lib/vector.ts`) – stejný výraz a literál dimenze, jinak se index nepoužije.
- **Fulltext**: `search_tsv` (generovaný `to_tsvector('simple', search_text)` – bez diakritiky) + GIN; dotaz
  `prefixTsQuery` (předpony slov ≈ tvary slov v češtině), LIKE jen jako záloha.
- **Dotazníky zákazníků**: kandidáti z knihovny a opatření i podle významu (`QaSemantic`, jen záznamy společnosti
  dotazníku, které uživatel smí číst) – doplní podobnost slov.

## Důsledky

Nový druh = `RECORD_KINDS` + `RECORD_LABELS` + větev v `collectRecordDocs` + `RECORD_ACCESS` + test. Model s jinou
dimenzí funguje (bez HNSW); pro novou běžnou dimenzi stačí přidat částečný index a hodnotu do `INDEXED_DIMS`.
