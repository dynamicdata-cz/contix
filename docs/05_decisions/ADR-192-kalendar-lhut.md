# ADR-192: Kalendář zákonných lhůt a přehled „Tento týden“

Stav: **přijato** (v1.98.0) – navazuje na [ADR-188](ADR-188-podnety-pilotu.md) (rozhodnutí o registraci) a povinnosti Moje práce.

## Kontext

Uživatelé z pilotního provozu potřebují vidět, co musí udělat tento týden, a mít zákonné lhůty ve svém kalendáři
(Outlook, Google). Termíny už existují jako povinnosti (Moje práce, přehled týmu), ale jen jako fronta „blíží se /
po termínu“ bez výhledu na rok a bez exportu.

## Rozhodnutí

1. **Kalendář nad existujícími povinnostmi** – žádná nová tabulka: `collectObligations` s `includeLater`, stejné druhy
   podle modulů a stejná čtecí oprávnění jako přehled (`NEED`). Navíc periodický **test obnovy zálohy** (poslední
   úspěšný + `RESTORE_TEST_MAX_DAYS`, jen pro `admin:settings`).
2. **Právní základ** každé lhůty (`deadlineBasis`): zákon o kybernetické bezpečnosti, vyhláška o bezpečnostních
   opatřeních, GDPR, AI Act, CRA, nebo interní termín. Filtr „jen zákonné“ skryje interní. Neuvádíme konkrétní
   paragrafy – ty se liší podle režimu a znění předpisu.
3. **Export iCalendar** (RFC 5545) ke stažení: celodenní události (hlášení incidentu jako událost v čase), stabilní
   UID podle klíče povinnosti (opakovaný import přepíše), připomínka 7 dní předem u zákonných lhůt, odkaz do CONTIXu.
   Export jen od začátku období, bez dávno prošlých lhůt; zapisuje se do auditu.
4. **Karta „Co mám udělat tento týden“** na Přehledu skládá existující zdroje: kalendář (7 dní, zákonné + po termínu),
   registr nálezů (kritické vždy, vysoké s termínem do týdne) a průvodce nastavením (nehotové povinné kroky).

## Důsledky

- Bez migrace. Odběr kalendáře přes URL (webcal s tokenem) zatím neděláme – vyžadoval by správu tokenů mimo
  přihlášení; soubor .ics je jednorázový snímek.
- Nový druh povinnosti se zákonným základem = doplnit mapu `BASIS` v `packages/shared/src/calendar.ts`.
