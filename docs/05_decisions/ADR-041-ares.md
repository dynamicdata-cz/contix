# ADR-041: Načtení firmy z ARES

**Stav:** přijato (v0.47.0)

## Kontext
Dodavatele a společnosti skupiny uživatelé zakládali ručním opisem názvu, IČO a sídla. Překlepy v IČO komplikovaly párování
a dotazníky. ARES (Ministerstvo financí) nabízí veřejné REST API bez registrace.

## Rozhodnutí
- Modul `modules/ares`: `GET /api/ares/search?q=` – 6–8 číslic = IČO (`GET /ekonomicke-subjekty/{ico}`), jinak hledání podle
  obchodního jména (`POST /ekonomicke-subjekty/vyhledat`, prvních 10 výsledků). Výsledek `AresSubject` (název, IČO, DIČ, sídlo,
  stát, právní forma, datum zániku). Oprávnění `suppliers:write` nebo `admin:settings`.
- Dotaz jde **ze serveru** (prohlížeč uživatele ARES nevolá); do ARES se posílá jen IČO nebo hledaný název. Odpovědi se cachují
  10 min v paměti; IČO s chybnou kontrolní číslicí (`validIco`, modulo 11) se do ARES vůbec neposílá.
- Konfigurace `ARES_SOURCE=on|off`, `ARES_URL` (proxy / zrcadlo). Nedostupnost ARES = srozumitelná chyba 502, formulář funguje dál.
- UI: panel **Načíst z ARES** ve formuláři dodavatele a společnosti (Administrace → Společnosti); výběr výsledku jen
  předvyplní pole, uložení je na uživateli.

## Důsledky
- Server potřebuje odchozí HTTPS na `ares.gov.cz` (jinak `ARES_SOURCE=off`).
