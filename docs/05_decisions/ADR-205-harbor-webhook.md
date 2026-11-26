# ADR-205: Webhook z Harboru

Stav: **přijato** (v1.113.0) – navazuje na ADR-201 a ADR-202 (Harbor, SBOM).

## Kontext

Výsledky skenu a SBOM z Harboru se načítaly ručně nebo plánovačem (výchozí interval 24 h). Po dokončení skenu nové
verze obrazu tak CONTIX ukazoval stará data až den.

## Rozhodnutí

1. Veřejný endpoint `POST /api/public/harbor/webhook` (mimo CSRF, bez relace). Harbor nemá podpis zpráv, jen
   volitelný „Auth Header“, který posílá beze změny jako `Authorization`. CONTIX vygeneruje token
   (`POST /api/cra/harbor/webhook`, správa systému), zobrazí ho jednou a uloží jen jeho SHA-256; porovnání je
   v konstantním čase, přijme se „Bearer <token>“ i samotný token. Nový token starý zneplatní, `DELETE` webhook vypne.
2. Zpracují se události `SCANNING_COMPLETED` a `PUSH_ARTIFACT` ve formátu Default i CloudEvents. Produkt se načte,
   když sedí projekt a repozitář a tag nebo digest obrazu (i digest z posledního načtení – tag se mohl přesunout).
   Nejvýš 20 produktů na událost; načtení je stejné jako tlačítko „Načíst z Harboru“ (CONTIX z Harboru jen čte).
3. Každé přijetí se zapíše do auditního záznamu (událost, počet produktů a úspěšných načtení).

## Důsledky

- Token je jediná ochrana (vlastnost Harboru) – endpoint má být dostupný jen přes HTTPS, token lze kdykoli vyměnit.
- Plánovač zůstává jako záloha pro výpadek webhooku.
