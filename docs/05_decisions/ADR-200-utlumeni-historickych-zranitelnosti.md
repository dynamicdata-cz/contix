# ADR-200: Utlumení historických zranitelností

Stav: **přijato** (v1.106.0) – navazuje na ADR-095 (triáž nálezů) a opravu uzavírání zranitelností z Wazuhu (v1.102.1).

## Kontext

Wazuh Indexer drží stav zranitelností i u agentů, kteří se dlouho nehlásí (vypnuté virtuály, vyřazené počítače),
a u starých detekcí. Na stovkách serverů nejde takové nálezy odklikávat jednotlivě; zároveň je nelze smazat, protože
se vracejí z dalších synchronizací, a nejsou to výjimky (akceptace rizika) ani falešně pozitivní nálezy.

## Rozhodnutí

1. Nový stav `suppressed` (enum `vuln_status`) se sloupci `suppressed_until` a `suppress_rule_id`; zdůvodnění v `triage_reason`.
   Utlumené se nepočítají do semaforu ani přehledů (ty berou jen `open`); v jednotném přehledu nálezů patří mezi odložené.
2. **Kritéria historického nálezu** (`VulnStaleCriteria`): aktivum nehlášeno > N dní (`assets.last_seen_at`), nález starší
   než N dní (`detected_at`, jinak `first_seen_at`), max. závažnost, jen Wazuh, výjimka pro KEV (výchozí zapnutá).
3. **Hromadné utlumení** `POST /api/vulnerabilities/suppress` (s `dryRun` pro náhled) v aktivní společnosti.
4. **Pravidla** (`vuln_suppression_rules`) se použijí po každé synchronizaci Wazuhu, při uložení a změně:
   utlumí odpovídající otevřené nálezy a uvolní ty, které už neodpovídají (aktivum se znovu hlásí). Vypnutí / smazání
   pravidla jeho nálezy otevře.
5. Synchronizace: utlumení s prošlou lhůtou se při dalším výskytu otevře; nález, který zdroj přestal hlásit, je vyřešený
   i z utlumeného stavu.

## Důsledky

- Ruční „znovu otevřít“ u nálezu tlumeného pravidlem pravidlo při příští synchronizaci znovu utlumí – výjimku z pravidla
  je třeba řešit úpravou pravidla (záměrně: pravidlo je zdroj pravdy).
- Metriky (vývoj otevřených) utlumené nálezy nepočítají jako otevřené.
