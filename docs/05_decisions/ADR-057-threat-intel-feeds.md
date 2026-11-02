# ADR-057: Veřejné zdroje hrozeb (abuse.ch, vlastní seznamy)

**Stav:** přijato (v0.62.0)

## Kontext
IOC z vlastních incidentů (ADR-054) pokrývají jen to, co organizace už viděla. Veřejné zdroje (abuse.ch) obsahují
aktuální C2 servery botnetů, distribuční URL malwaru a IOC kampaní. Data nesmí opustit organizaci – zdroje se jen stahují.

## Rozhodnutí
- Zdroje `TI_FEEDS` (Feodo Tracker – veřejný, URLhaus a ThreatFox – od 2025 vyžadují bezplatný **Auth-Key** z auth.abuse.ch,
  vkládá se do cesty exportu `{key}` a posílá i v hlavičce `Auth-Key`) a vlastní textové seznamy (https). Adresy jsou nastavitelné
  (abuse.ch je mění); klíč šifrovaně (`authKeyEnc`), do chyb ani auditu se nezapisuje.
- Parsery `parseUrlhausCsv` / `parseThreatfoxCsv` / `parsePlainList` (`shared/threatIntel.ts`) – sloupce podle hlavičky
  (komentář `#`), jinak výchozí pořadí; gzip / ZIP se rozbalí (`decodeFeed`, `safeUnzip`). Nejvýše 200 000 záznamů na zdroj.
- Tabulka `threat_intel` (globální): každé stažení zdroj **nahradí** (`storeFeed`) – co ze zdroje vypadlo, se už neporovnává.
  Server bez internetu: ruční nahrání souboru.
- **Shoda s alerty** `matchAlerts`: hodnoty alertů za 14 dní (zdrojová / cílová IP, URL a domény, odesílatel, hashe) →
  `alert_suggestions.intel` (jen při změně). Zobrazení odznakem / bannerem, filtr fronty `intel=1`, kontext AI triáže.
- **Hledání ve Wazuhu** `huntThreatIntel`: IP a domény ze zdrojů (nejvýše 20 000 každého) jako `terms` ve vybraných polích
  alertů Wazuh Indexeru od posledního hledání (poprvé 7 dní), jen čtení. Shoda → alert `source = threatintel`
  „Komunikace se známou hrozbou“ (seskupení hodnota + agent, úroveň 12, T1071), potlačení jako u Wazuhu, okamžité upozornění.
  Při chybě se okno neposouvá.
- Plánovač `processThreatIntel` (interval, výchozí vypnuto) v cyklu upozornění; ruční stažení `soc:write`, nastavení `admin:settings`.

## Důsledky
- Veřejné zdroje mají falešné shody (sdílené hostingy, CDN) – shoda je signál pro analytika, ne automatický zásah.
- Formáty abuse.ch se mohou měnit – při chybě parseru je vidět chyba u zdroje a lze upravit adresu nebo nahrát soubor.
