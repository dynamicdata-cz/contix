# ADR-159: Nálezy testů a serverů v ekosystému (v1.66)

## Kontext

Moduly bezpečnostních testů a sběrače (ADR-148, ADR-153, ADR-158) nebyly napojené na průřezové funkce:
rychlé hledání, dotazy AI a MCP, vektorový index, trendy, průvodce a balíček pro auditora.

## Rozhodnutí

1. **Rychlé hledání**: druhy `sectest_finding` (`sec_test_findings`: název, host) a `server` (`host_inventories`:
   hostname, klíč) s vlastním odkazem (`Def.link`), oprávnění `sectests:read` / `assets:read` a modul.
2. **Nástroje AI / MCP** (jen čtení): `security_test_findings` (modul sectests) a `server_findings` (modul aktiva),
   s odpovědnou osobou a úkolem; rozsah přes `allowedIds` jako ostatní nástroje.
3. **Vektorový index**: druh `sectest_finding` – otevřené a přijaté nálezy, text z popisu a uloženého AI rozboru,
   bez důkazů (výstupů nástrojů) a bez jmen osob.
4. **Trendy**: `sectest_critical_high`, `server_findings_high`, `finding_tasks_overdue`; výjimky v trendu ze všech
   druhů výjimek.
5. **Průvodce** `sectests` a krok `assets.serverFindings` – fakta jen z dat (SQL v `guideFacts`).
6. **Balíček pro auditora** (Opatření i Připravenost na audit): `03_bezpecnostni_testy.html|docx` přes
   `secTestPackageExtras` – jen se zapnutým modulem a `sectests:read` ve společnosti balíčku; vynechá se, když
   v období neproběhl test a nejsou otevřené nálezy.
