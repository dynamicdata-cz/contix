# ADR-176: Příručka vedoucího útvaru a garanta, předvolba Mistral (v1.83)

## Kontext

Od v1.69 dostávají vedoucí útvarů a garanti týdenní souhrny, eskalace nálezů a přehled útvaru. Nápověda a příručka
ke stažení ale měly jen role zaměstnanec, gestor, manažer KB a správce – lidé, kterým CONTIX nejčastěji píše,
pro sebe návod neměli.

## Rozhodnutí

- Nová role nápovědy `owner` („Vedoucí útvaru a garant“), nabízí se uživateli s oprávněním číst aktiva, procesy nebo úkoly.
  Téma `owner-guide` (česky i anglicky) a základní témata (začínáme, profil, moje práce, dokumenty, hlášení,
  školení, kvalita dat, nálezy, úkoly) mají tuto roli také – příručka ke stažení se pro ni složí sama.
- Údaje v příručce odpovídají kódu: lhůty `FINDING_SLA_DAYS`, eskalace `FINDING_ESCALATION_DAYS`, souhrn v pondělí.
- `AI_PRESETS` může nést i model a embedding model; přidána předvolba Mistral AI (OpenAI-kompatibilní `/chat/completions`
  a `/embeddings`, bez změny klienta). Jde o cloud – kontrola po aktualizaci to dál hlásí jako odchod dat mimo server.

## Důsledky

- Nová témata pro vedoucí stačí označit rolí `owner`.
