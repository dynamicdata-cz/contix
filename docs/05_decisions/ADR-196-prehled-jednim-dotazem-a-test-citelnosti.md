# ADR-196: Technické karty Přehledu jedním dotazem a trvalá kontrola čitelnosti

Stav: **přijato** (v1.102.0) – navazuje na ADR-193 (technická bezpečnost na Přehledu).

## Kontext

Po v1.99 posílal Přehled kolem 15 požadavků; technické karty z nich sedm a dva z nich stahovaly celé seznamy
(všechny certifikáty TLS, celá mapa zón s aktivy a vazbami), přestože karta potřebuje jen několik čísel.
Ve verzích 1.98.1–1.98.2 se objevily chyby čitelnosti (bílý text na bílé, tmavé barvy podle systému), které
odhalil až uživatel.

## Rozhodnutí

1. **`GET /api/dashboard/tech`** skládá souhrn z existujících rout uvnitř procesu (`app.request`, paralelně,
   s cookie a hlavičkou společnosti volajícího). Oprávnění, moduly a rozsah tak rozhodují stejné routy jako
   u samostatných obrazovek – žádná druhá kopie pravidel. Nedostupná část (403 / 404 / chyba) = `null`, karta se
   nezobrazí; jedna chyba nepoloží Přehled. Mapa zón jen při zvolené jedné společnosti.
2. Odpověď nese **jen čísla** pro karty (`DashboardTechDto`), ne seznamy.
3. **Test čitelnosti** jako poslední e2e test (nad daty předchozích testů): ~70 hlavních obrazovek × světlý
   a tmavý režim, systém přepnutý do tmavého režimu. Kontroluje kontrast textu proti skutečnému pozadí (≥ 2,5 : 1 –
   pojistka proti nečitelnosti, ne audit WCAG), texty v grafech SVG (průhledná výplň = pozadí pod grafem),
   až 3 vyplněná tlačítka na obrazovce při najetí myší, vodorovné přetečení a zúžené záhlaví. Barvy převádí canvas
   (Tailwind 4 vrací `oklch`). Funkčnost ověřena úmyslně rozbitým stylem (detektor hlásí desítky tlačítek).

## Důsledky

- Na serveru se dílčí souhrny počítají stejně jako dřív (sedmkrát ověření relace uvnitř procesu); úspora je
  v počtu požadavků prohlížeče a v objemu přenesených dat. Pokud by byl některý souhrn pomalý, lze ho později
  vytáhnout do sdílené služby bez změny API.
- E2E sada se prodlouží asi o 3–4 minuty. Nová obrazovka se do kontroly dostane přidáním adresy do
  `READABILITY_ROUTES` v `e2e/smoke.e2e.ts`.
