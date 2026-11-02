# ADR-025: Převodní služba dokumentů, razítko PDF, vyhledávání a porovnání verzí

**Stav:** přijato · 4. 10. 2026

1. **Samostatný kontejner `converter`** (LibreOffice headless + poppler, malý HTTP server v Bunu) místo LibreOffice
   v obrazu API: izolace (dokumenty z cizích zdrojů se zpracovávají mimo API), samostatné prostředky (`mem_limit`),
   API zůstává malé. Kontejner je jen v **interní síti** Dockeru (`internal: true`) – dokument nemůže stahovat vzdálené
   obrázky ani volat ven; běží jako neprivilegovaný uživatel, souborový systém jen pro čtení, `/tmp` jako tmpfs,
   převody sériově s časovým limitem a vlastním profilem LibreOffice pro každý převod.
   Hotové řešení (Gotenberg) by vyžadovalo stejně vlastní obraz kvůli písmům a nepřináší potřebnou kontrolu.
2. **Originál se nikdy nemění.** Ukládá se jen odvozené PDF (`policy_files.pdf`) a text (`text`, `search_text`).
   Kompatibilita s Microsoft 365 tak není ohrožena – zaměstnanec si může stáhnout přesně nahraný soubor.
3. **Razítko při stažení** (pdf-lib + písmo DejaVu Sans pro češtinu), ne při převodu: doložka a vodoznak vždy odpovídají
   aktuálnímu stavu verze a obsahují kdo a kdy stáhl. Chráněné / poškozené PDF se vydá bez razítka (`x-contix-stamped: 0`).
4. **Text z formátů Office čte API samo** (ZIP + XML), takže vyhledávání a porovnání funguje i bez převodní služby;
   ta je potřeba jen pro PDF (pdftotext), starší formáty (.doc, .xls) a PDF náhled.
5. **Fronta ve sloupci `pdf_status`** (pending → ok / failed / native / none) bez další infrastruktury: zpracování hned po
   nahrání na pozadí + dávky plánovače (i pro existující soubory po aktualizaci). Bez převodní služby soubory čekají.
6. **Vyhledávání** přes normalizovaný text (malá písmena, bez diakritiky) a `LIKE` – pro rozsah dokumentace organizace
   dostačuje bez rozšíření PostgreSQL (unaccent, české slovníky). Při růstu lze doplnit index pg_trgm.
7. **Porovnání** po odstavcích (`diffArrays`) a ve dvojicích změněných odstavců po slovech (`diffWordsWithSpace`, knihovna
   jsdiff); formátování se neporovnává. Word a jeho PDF export ve stejné verzi se nepočítají dvakrát.
