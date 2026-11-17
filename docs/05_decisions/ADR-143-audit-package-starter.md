# ADR-143: Balíček pro auditora z přípravy na audit, neposouzené požadavky, startovací balíček, souhrn kroků (v1.46)

## Kontext

Příprava na audit (ADR-142) dávala jen Word / tisk, počítala požadavky bez opatření jako nesplněné, garant dostával
stejný krok v každém denním souhrnu a nová společnost neměla výchozí podklady.

## Rozhodnutí

1. `GET /guides/audit?format=zip` = stávající balíček `buildAuditPackage` (ADR-019) + `extras`: zpráva o připravenosti
   (HTML, Word) a platné dokumenty po oddílech (`sectionDocuments`: aktuální soubor schválené verze dokumentů
   navázaných v pokrytí předpisu, limit 150 MB); vše v manifestu s SHA-256.
2. `CoverageRow.assessed` (ruční míra shody nebo navázané opatření). Připravenost oddílu = shoda posouzených;
   neposouzené se počítají zvlášť a mezera „nesplňuje“ se u nich neuvádí.
3. Startovací balíček `POST /guides/starter`: složky dokumentace (`/setup/doc-folders`), katalog opatření
   (`/controls/generate`, jen balíček CZ s režimem vyšší / nižší), koncept politiky (`/policies`), vzorové cíle
   (`/isms/objectives`) – vždy přes existující API jménem uživatele, jen co chybí; audit `guide.starter`.
4. `guideStepsFresh`: položka `guide_step` v souhrnu (e-mail, Teams) jen při změně kroku nebo počtu, jinak jednou
   za týden ISO; záznam v `notification_log` (kanál `guide`) až po úspěšném odeslání.
5. Odkazy kroků GDPR / AI Act / CRA pevně v `GUIDE_STATIC_REFS` (nezávisle na hlavním rámci).
6. Výkon (load-test, 5 000 aktiv / 40 000 zranitelností / 800 rizik): `/guides` ~0,3 s, `/guides/:id` ~0,1 s,
   `/guides/audit` ~0,2 s – bez mezipaměti (data musí být po úpravě hned aktuální).
