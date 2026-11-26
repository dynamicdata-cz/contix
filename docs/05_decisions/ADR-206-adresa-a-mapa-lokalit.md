# ADR-206: Adresa a mapa lokalit

Stav: **přijato** (v1.114.0) – navazuje na ADR-198 (lokality).

## Kontext

Lokalita měla jen jednořádkovou adresu. Pro přehled budov a datových center (a pro posouzení fyzických hrozeb
podle polohy) je potřeba strukturovaná adresa, poloha a mapa. CONTIX má ale přísnou CSP – prohlížeč nesmí
načítat nic z cizích serverů – a běží i v sítích bez internetu.

## Rozhodnutí

1. `FacilityPhysical` (jsonb, bez migrace) má `street`, `city`, `zip`, `country`, `lat`, `lng`. Jednořádková
   `address` se při uložení přes Lokality skládá ze strukturovaných polí (`formatAddress`), takže ji dál
   používají starší zobrazení. Ve formuláři aktiva se adresa se strukturovanými poli jen zobrazuje.
2. Mapa (Leaflet) bere dlaždice z `GET /api/premises/map/tiles/{z}/{x}/{y}` – server CONTIXu je stáhne ze
   zdroje v nastavení (výchozí OpenStreetMap, jen https, jen obrázky do 1 MB) a drží v paměti (3000 dlaždic,
   7 dní). CSP zůstává „self“. Značky jsou kreslené, bez obrázků.
3. Dohledání souřadnic `POST /api/premises/geocode` (Nominatim, výchozí OpenStreetMap) jen na pokyn uživatele,
   nejvýš 1 dotaz za sekundu, s identifikací CONTIXu v User-Agent (pravidla OSM). Poloha jde zadat i ručně
   nebo kliknutím do mapy.
4. Nastavení `maps` (správa systému): mapu i dohledání lze vypnout (instalace bez internetu, citlivé adresy)
   nebo nasměrovat na vlastní server dlaždic / Nominatim.

## Důsledky

- Dohledání souřadnic posílá adresu externí službě – proto jen tlačítkem a s možností vypnutí.
- Veřejné dlaždice OSM jsou pro malý provoz; při větším nasazení zadat vlastní nebo komerční zdroj.
