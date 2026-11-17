# ADR-122: Mapy a půdorysy s umístěnými aktivy (v1.25)

## Kontext

Technici a správci budov potřebují vidět, **kde** fyzicky je aktivum (server, switch, kamera, datová zásuvka, rack)
a kde se právě něco děje. Podklady existují jako PDF z projektu, výkresy DWG/DXF z CADu nebo obrázky.

## Rozhodnutí

1. Tabulky `site_maps` (podklad, areál / budova / podlaží, původní soubor + převedený obrázek, SHA-256) a `map_placements`
   (mapa × aktivum, souřadnice `x`, `y` v rozsahu 0–1 vůči obrázku – nezávislé na zoomu a rozlišení). Migrace 0093.
2. PNG / JPG / WEBP / SVG se ukládají přímo; PDF, DXF a DWG převádí převodní služba (`/image`: PDF → PNG přes `pdftoppm`,
   DXF → PDF přes LibreOffice Draw → PNG, DWG přes `dwg2SVG` z LibreDWG, je-li v obrazu). Bez `CONVERTER_URL` API odmítne
   PDF/DXF/DWG (409) s návodem nahrát obrázek; chyba převodu = 422. Limit 30 MB.
3. Obrázek se vrací s `nosniff` a CSP `sandbox` (SVG bez skriptů), původní soubor jen jako příloha.
4. Semafor `markerStatus` (`shared/siteMaps.ts`) se **počítá při čtení** dávkově (`markerData` v `assets/maps.ts`):
   červená = otevřený incident (kromě událostí), alert SOC úrovně ≥ 10 (`effLevelSql`), otevřená zranitelnost v KEV,
   červený stav aktiva; oranžová = jiný otevřený alert, kritické / vysoké zranitelnosti, nepřijatelné riziko, oranžový stav;
   zelená = zelený stav aktiva; jinak šedá. Nic se nepersistuje.
5. Nové typy aktiv `network_socket` (datová zásuvka) a `rack` (rack / rozvaděč) ve vrstvě síť.
6. Umístit lze jen aktivum společnosti mapy; přesun aktiva do jiné společnosti jeho umístění smaže. Všechny zápisy auditované
   (`map.created`, `map.updated`, `map.deleted`, `map.asset_placed`, `map.asset_removed`), oprávnění `assets:read` / `assets:write`.
7. Stránka `/assets/maps`: seznam podle budovy, prohlížeč se zoomem, filtr barev, režim umísťování (výběr aktiva, klik, tažení),
   obnova každou minutu; v detailu aktiva karta „Na mapě“.

## Důsledky

- Stav je vždy aktuální bez plánovače; náklad je několik agregačních dotazů na mapu.
- DWG záleží na verzi souboru a dostupnosti LibreDWG – doporučený postup je export do PDF nebo DXF.
- Vektorové vrstvy CADu se nezachovávají (podklad je obrázek); přesnost umístění je na úrovni obrázku do 4000 px.
