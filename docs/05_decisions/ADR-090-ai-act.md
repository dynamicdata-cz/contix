# ADR-090: Modul AI Act – registr AI systémů, klasifikace, povinnosti, FRIA, směrnice

**Stav:** přijato (v0.95)

## Kontext
Nařízení (EU) 2024/1689 (AI Act) ve znění nařízení (EU) 2026/1744 (Digital Omnibus) ukládá organizacím povinnosti podle role (zavádějící subjekt / poskytovatel) a klasifikace AI systému. Zakázané praktiky a AI gramotnost platí od 2. 2. 2025, transparentnost od 2. 8. 2026, nové zákazy (čl. 5 písm. ba, bb) od 2. 12. 2026, vysoké riziko podle přílohy III od 2. 12. 2027 a podle přílohy I od 2. 8. 2028. Český adaptační zákon se připravuje (dozor nad trhem ČTÚ).

## Rozhodnutí
- Nový modul `aiact` (oprávnění `aiact:read` / `aiact:write`, `PERMISSION_UPGRADES` a `MODULE_UPGRADES` 0.95). Evidence `ai_systems` (`company_id`, přesun `ai_systems` v `transferRecords`) + vazby na procesy, aktiva, dodavatele a činnosti zpracování (`ai_system_*`).
- Persistují se jen **odpovědi screeningu** (`screening`, schéma `AiScreening`) a **stav povinností** (`obligations` = { klíč: stav, poznámka, datum }). Klasifikace (`classifyAiSystem`), seznam povinností (`aiObligationsFor` z katalogu `AI_OBLIGATIONS`), potřeba FRIA (`friaRequired`) a mezery (`aiSystemGaps`) se počítají při čtení v `shared/aiact.ts`.
- Klasifikace: zakázaná praktika (čl. 5) → vysoké riziko (příloha I nebo III bez výjimky čl. 6 odst. 3; výjimka neplatí při profilování) → omezené riziko (čl. 50) → minimální. Použití z přílohy III s výjimkou = `annexIIIExempt` (poskytovatel: dokumentace a registrace).
- Schválení použití jen `POST /aiact/:id/decision` (vlastník = držitel funkčního místa nebo `aiact:write`), ne přes stav v PATCH. Nelze schválit bez screeningu, zakázanou praktiku ani vysoké riziko bez lidského dohledu; změna screeningu na zakázanou praktiku rozhodnutí zruší. Do stavu `in_use` jen schválený systém; schválený systém se nemaže (vyřadit).
- FRIA (čl. 27, prvky a–f) v `ai_systems.fria`; dokončení (`/fria/approve`, `aiact:write`) vyžaduje všechny prvky, zamyká záznam a označí povinnost `fria` jako splněnou; znovuotevření `/fria/reopen`.
- AI gramotnost: kurzy s tématem `AI_LITERACY_TOPIC` („AI gramotnost“); šablona směrnice `aiDirectiveTemplate` (`shared/aiactDirective.ts`, vlastní text CONTIXu, cs/en) – `POST /aiact/directive` založí návrh směrnice (seznam schválených nástrojů z registru), podřízené shrnutí pro zaměstnance s testem a seznámením všech a volitelně kurz navázaný na shrnutí. Vše jako návrh – schválení běží běžným oběhem DMS.
- Povinnost `ai_review` (přezkum schváleného systému, přezkum FRIA) v `collectObligations`; nástroj AI dotazů / MCP `ai_systems` (jen čtení); tisk a Word registru `/aiact/register.html|docx`.

## Důsledky
Dovozce a distributor nejsou v rozsahu. Povinnosti poskytovatele modelu GPAI (čl. 53) se neevidují – příznak `gpai` je informativní. Při novele předpisu se mění jen katalogy a data v `shared/aiact.ts` (klíče povinností neměnit bez migrace `ai_systems.obligations`).
