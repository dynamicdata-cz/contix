# ADR-139: Postup krok za krokem v modulech a Cesta k souladu (v1.42)

## Kontext

Uživatelé v jednotlivých modulech nevěděli, v jakém pořadí postupovat a co ještě chybí. Postup z modelování hrozeb
(ADR-138) se osvědčil – zobecňujeme ho na většinu modulů.

## Rozhodnutí

1. Průvodci jsou data `GUIDES` (`shared/guides.ts`): modul, oprávnění, stránka a kroky (`path`, `done`, `count`,
   `waiting`) nad fakty `GuideFacts` (`GUIDE_FACT_KEYS`). Vyhodnocení jen `evaluateGuide` (stav done / todo / waiting,
   další krok, postup %), souhrn `compliancePathSummary`. Texty jen i18n `gd.<průvodce>.<krok>.title|hint|todo`.
2. Fakta jen `guideFacts` (`modules/guides/routes.ts`) – jeden SQL dotaz s poddotazy (jen počty, jen čtení,
   nepersistovat); lhůty 12 měsíců. `GET /api/guides` (Cesta k souladu) a `GET /api/guides/:id` (panel v modulu)
   vrací jen průvodce zapnutých modulů s oprávněním ve společnosti (`hasPermIn`).
3. Web: panel `ProcessGuide` pod záhlavím hlavní stránky modulu (ISMS, rizika, opatření, audity, kontinuita, incidenty,
   dodavatelé, GDPR, AI Act, CRA, legislativa), krok = odkaz, sbalení jen v prohlížeči; stránka `/compliance-path`
   (oblasti s nejmenším postupem první) v hlavním menu.

## Důsledky

- Nový krok = fakt v `GUIDE_FACT_KEYS` + poddotaz v `guideFacts` + krok v `GUIDES` + texty cs/en (hlídá unit test).
- Nový průvodce = položka `GUIDES` + `<ProcessGuide id>` na stránce modulu.
