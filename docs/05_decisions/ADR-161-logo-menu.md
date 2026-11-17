# ADR-161: Logo CONTIX v brandu DynamicData a uspořádání menu (v1.68)

## Kontext

CONTIX měl jako logo jen písmeno „C“ v modrém čtverci, bez vazby na značku výrobce DynamicData. Menu rostlo
po modulech, takže související věci byly roztroušené (zranitelnosti a testy v provozu / nástrojích, nálezy
v řízení, informační servis nahoře, akce a úkoly v řízení).

## Rozhodnutí

1. **Logo** odvozené z loga DynamicData (zaoblený rámeček, geometrické písmo, dvě barvy): písmena c, n, t, i
   převzaté z tvarů loga DynamicData, o a x dokreslené ve stejné tloušťce tahů. Značka = rámeček + „c“ (hlavní
   barva) a „x“ (šedá); slovní značka *contix* = „con“ hlavní + „tix“ šedá. Ve webu jen `ContixMark` /
   `ContixWordmark` (`components/logo.tsx`) s barvami ze škály slate (tmavý panel a režim je přepíší), ikona
   prohlížeče `public/favicon.svg` (světlá/tmavá podle systému). Zdrojová SVG a varianty v `docs/brand/`.
2. **Menu** podle toku práce: nahoře osobní práce; skupiny Řízení → Evidence → Rizika a nálezy → Shoda a audit →
   Bezpečnostní provoz → Regulace → Dokumentace → Nástroje a správa. Odkazy a oprávnění beze změny, mění se jen pořadí
   a skupiny (sbalení skupin se pamatuje pod novými klíči).
