# ADR-062: Napojení Microsoft Sentinel a Elastic Security

**Stav:** přijato (v0.67.0)

## Kontext
Část zákazníků provozuje vedle Wazuhu SIEM v cloudu (Microsoft Sentinel) nebo Elastic Security. Webhook (ADR-052)
vyžaduje konfiguraci na straně SIEM (Logic App, konektor Kibany), která není vždy k dispozici.

## Rozhodnutí
- Nové šablony zdroje `sentinel` a `elastic` (`SOC_SOURCE_PRESETS`, zdroj alertu stejného jména). Normalizátory v `soc/ingest.ts`:
  Sentinel = incident (REST i Logic App `object.properties`), uzavřené se přeskočí, `ruleId = sentinel:inc-<číslo>`, techniky
  z `additionalData.techniques`; Elastic = detekční alert (klíče s tečkami i vnořené), závažnost z `kibana.alert.severity`
  nebo `risk_score`, techniky a podtechniky z `kibana.alert.rule.threat`.
- Stahování (pull, `soc/pull.ts`) – volitelně u týchž zdrojů: `soc_sources.pull_config` (bez tajemství), `secret_enc`
  (šifrovaně, do API ani auditu nikdy), `pull_cursor`, `last_pull`. Sentinel: token client credentials z Entra ID →
  Azure Resource Manager `SecurityInsights/incidents` s filtrem `lastModifiedTimeUtc gt kurzor`; Elastic: `_search`
  v indexu alertů s `@timestamp gt kurzor` (a `workflow_status = open`), `search_after`. Nejvýše 10 stránek na běh.
  Zápis stejně jako webhook (`normalizeEvents` → `ingestEvents`: seskupení, potlačení, aktivum, korelace, upozornění).
  Kurzor = nejnovější čas staženého záznamu; při chybě se neposouvá.
- Plánovač `processPullSources` podle intervalu (5–1440 min), ruční `POST /soc/sources/:id/pull` (admin:settings).
- Adresy přihlášení a ARM jsou nastavitelné (suverénní cloudy); stránkování jen v rámci stejné služby.

## Důsledky
- Server CONTIXu potřebuje odchozí přístup na login.microsoftonline.com a management.azure.com (Sentinel) nebo na Elasticsearch.
  Ze SIEM se jen čte; do SIEM se nic neposílá kromě přihlášení a dotazu. Data se nepředávají žádnému AI modelu mimo lokální.
- Změněný incident Sentinelu se při dalším stažení připíše k otevřenému alertu (navýší počet).
