# ADR-110: Zdroje textu Sbírky – záloha z webu, přepínání bez falešných změn, volba v administraci

**Stav:** přijato (v1.13.2)

## Kontext

Otevřená data e-Sbírky (SPARQL) přestala u znění vracet obsah fragmentů. v1.12.2–v1.13.1 doplnily zjišťování
vlastností a zálohu z veřejného JSON webu e-Sbírky (`sbr-cache`). Text téhož znění se ale mezi zdroji liší
formátováním, takže přepnutí zdroje by vyrobilo falešnou změnu předpisu a posouzení dopadu.

## Rozhodnutí

- Každé uložené znění nese `meta.textSource` (`opendata` / `web` / `api` / `eurlex`); starší znění se odvodí
  `versionSource`. Předpis nese `meta.textSource` a `meta.webSince` (od kdy se čte ze zálohy).
- **Stejné znění z jiného zdroje** (`storeVersion` s `textSource`): text se uloží jako nové znění bez `legal_changes`
  a bez posouzení.
- **Nové znění z jiného zdroje než uložené**: rozdíl se počítá proti staršímu znění staženému ze stejného zdroje
  (`baseline`), když ho zdroj vrátí; jinak proti uloženému.
- **Volba zdroje** `settings.legalTextSource` (`auto` / `opendata` / `web` / `api`), přepis konfigurace jen
  `withTextMode` / `effectiveLegalConfig`; `ESBIRKA_SOURCE=off` a `ESBIRKA_WEB_FALLBACK=off` v server.env mají přednost.
  Režim `web` = seznam znění z otevřených dat, text jen z webu (`ESBIRKA_WEB_FALLBACK=only`).
- **Provoz**: v režimu `auto` upozornění, když se text čte ze zálohy déle než 7 dní (`legislationStatus().fallback`).

## Důsledky

Web e-Sbírky je neoficiální rozhraní – při jeho změně pomůže diagnostika v chybě kontroly. Nový zdroj textu =
hodnota `textSource` + větev v `textSourceOf` + popisek `leg.textSource.*`.
