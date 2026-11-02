# Modul Dodavatelé – § 9 vyhl. č. 409/2025 Sb.

Modul `suppliers`, oprávnění `suppliers:read` / `suppliers:write`. API `/api/suppliers`, UI *Dodavatelé*.

## Evidence

- Identifikace (název, IČO – 8 číslic, sídlo, stát), kontakt, předmět plnění, stav (aktivní / ukončen).
- **Významný dodavatel** (§ 2 písm. h) s odůvodněním; příznak zpracování dat / provozu aktiv **mimo ČR**
  (hrozby H08, H20, H21 přílohy č. 3, ustanovení r) přílohy č. 5).
- Vazby na aktiva, procesy a rizika.

## Povinnosti § 9 a mezery

U aktivního významného dodavatele se hlídá (seznam `gaps`):

| Povinnost | Pole |
|---|---|
| § 9 odst. 1 písm. b) – seznámení s pravidly pro dodavatele | `rulesAcknowledgedAt` |
| § 9 odst. 1 písm. e) a odst. 3 – písemné informování o evidenci | `notifiedAt`, `notificationRef` |
| § 9 odst. 2 písm. a) – hodnocení rizik před uzavřením smlouvy | `riskAssessedAt` |
| § 9 odst. 1 písm. f) – smlouva s relevantními ustanoveními | smlouvy |
| § 9 odst. 1 písm. g) – pravidelný přezkum plnění | `lastReviewAt` + `reviewIntervalMonths` |

## Smlouvy a ustanovení

Ke smlouvě se vybírá sada požadavků: **příloha č. 5 vyhl. 409/2025** (a–r) nebo **příloha č. 2 vyhl. 410/2025** (a–n);
texty jsou doslovně z e-Sbírky (`shared/suppliers.ts`). Každé ustanovení: obsaženo / částečně / chybí / nerelevantní /
neposouzeno. Chybějící = vše kromě „obsaženo“ a „nerelevantní“; počítají se jen smlouvy, které nevypršely.

## Oznámení dle § 9 odst. 3

`GET /api/suppliers/:id/notification.html` – tisková podoba písemného informování (a) identifikace povinné osoby,
b) regulovaná služba, c) skutečnost evidence, d) poučení). Údaje o organizaci z Administrace → Nastavení
(IČO, sídlo, regulované služby). Doručení je třeba doložit (datová schránka, č. j.) a zapsat do evidence.
