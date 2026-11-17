# ADR-149: Společné štítky a umístění dat s pravidly podle země (v1.52)

## Kontext

Náměty z analýzy: Pavel – společné štítkování objektů (např. „dostupné z internetu“) napříč evidencemi;
Radek 9 – evidence hostingů, zemí a pravidel, která se na ně vztahují.

## Rozhodnutí

1. Katalog `tags` (název jedinečný bez ohledu na velikost písmen, barva, popis) a `object_tags`
   (štítek, typ záznamu, id, společnost) pro rizika, dodavatele, procesy, opatření a umístění dat.
   Aktiva drží štítky dál v `assets.tags` (filtry, import) – katalog je s nimi propojen názvem; přejmenování
   a smazání štítku se promítne i do aktiv.
2. API `/tags`: katalog s počty v rozsahu uživatele, `of/:typ/:id` (čtení / nastavení – oprávnění k úpravě
   záznamu, chybějící štítky se založí), `:id/objects` (záznamy napříč evidencemi podle oprávnění čtení).
   Správa katalogu jen `admin:settings`.
3. `data_locations` (služba, dodavatel nebo poskytovatel, země ISO, region, druhy dat, záruka předání,
   smlouva o zpracování) a čistá funkce `locationRules`: EU/EHP, odpovídající ochrana (seznam Komise k 10. 11. 2026
   včetně Brazílie; Kanada a USA částečně), USA jen DPF / SCC / BCR, třetí země se zárukami (TIA) nebo bez nich,
   chybějící smlouva podle čl. 28, země se zvýšeným rizikem dodavatelského řetězce (orientačně CN, RU, BY, IR, KP),
   DORA u finančního subjektu. Pravidla jsou orientační.
4. UI: lišta štítků nad detailem rizika, opatření, procesu a dodavatele; stránka Štítky; stránka Umístění dat
   (z Dodavatelů).

## Důsledky

Migrace 0109. Seznam zemí s odpovídající ochranou je v kódu – při změně rozhodnutí Komise se upraví
v nové verzi. Smazání záznamu nechá osiřelé řádky `object_tags` (v přehledu se nezobrazí).
