# ADR-016: AI asistent na lokálním modelu, provoz a SOC 2

**Stav:** přijato · 2. 10. 2026 (doplňuje ADR-003)

## Rozhodnutí

1. **Poskytovatel AI za rozhraním** `createAiClient` (`modules/ai/provider.ts`) se dvěma implementacemi:
   OpenAI-kompatibilní Chat Completions (Open WebUI `/api`, vLLM, LM Studio) a nativní Ollama `/api/chat`.
   Výchozí nasazení je **lokální model** (Ollama + Open WebUI, `gpt-oss:20b`) – data neopouštějí infrastrukturu
   organizace. Anthropic API / jiný cloud lze doplnit jako další implementaci bez změny modulů.
2. **Výstup = návrh** v `ai_suggestions` (stav `running → proposed → accepted / partially_accepted / rejected`, nebo `failed`).
   Aplikuje se až rozhodnutím člověka po položkách; přijmout smí jen ten, kdo smí záznam ručně upravit.
   Každý dotaz se loguje: minimalizovaný kontext, model, surová odpověď, kdo žádal, kdo a jak rozhodl (AI Act čl. 12/14).
3. **Validace výstupu**: model musí vrátit JSON; ID požadavků a čísla § se ověřují proti datům rámců
   (`parseMapping`, `parseTreatment`) – neznámé, duplicitní nebo už namapované položky se zahodí. Model nikdy
   nezakládá identifikátory.
4. **Minimalizace dat**: do modelu jdou jen názvy a popisy rizik, hrozeb, aktiv a opatření; žádná jména osob,
   e-maily, vlastníci ani přihlašovací údaje. API klíč je v DB šifrovaně (`APP_SECRET`).
5. **Asynchronní běh**: odpověď lokálního modelu s uvažováním trvá desítky sekund až minuty → dotaz běží na pozadí,
   UI se dotazuje na stav (žádné dlouhé HTTP spojení přes proxy). Uvízlé běhy po restartu se označí jako chybné.
6. **Plánovač při více instancích**: místo `pg_advisory_lock` (vázaný na spojení, s poolem nespolehlivý)
   **lease v `app_settings`** – atomický `INSERT … ON CONFLICT DO UPDATE … WHERE vlastník = já OR vypršel`.
7. **Zálohy** mimo API: služba `backup` (pg_dump stejné verze jako DB, kontrola `pg_restore --list`, SHA-256,
   volitelně šifrování `age` veřejným klíčem, kopie mimo server, retence). Výsledek zapisuje do `backup_runs` →
   stav v Administrace → Provoz a metrika pro Prometheus. Test obnovy `restore.sh --test` do dočasné DB.
8. **Monitoring**: `/api/health` (bez přihlášení, 503 při výpadku DB) a `/api/metrics` (Prometheus, Bearer token
   `METRICS_TOKEN`, z internetu blokováno v Caddy).
9. **SOC 2** jako další rámec: jen ID kritérií TSC a vlastní popisky (text AICPA je chráněn), crosswalk
   z § vyhlášky 409 (`CROSSWALK_409.soc2`).

## Důsledky

- Další AI úlohy = nový `useCase` v `shared/ai.ts` + příprava kontextu, validátor a `applyItems`.
- Embeddingy (pgvector) a MCP server zůstávají v plánu (ADR-003).
- Lokální model je pomalejší a méně přesný než velké cloudové modely – proto validace a lidské schválení.
