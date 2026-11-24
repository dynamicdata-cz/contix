# ADR-195: Odběr kalendáře lhůt a vylepšení bezpečnostních zón

Stav: **přijato** (v1.101.0) – navazuje na ADR-191 (zóny) a ADR-192 (kalendář lhůt).

## Kontext

Soubor .ics z kalendáře lhůt je jednorázový snímek – po každé změně ho uživatel musí stáhnout znovu. U zón musel
správce rozsahy opisovat ručně, rizikové vazby přes firewall hlásily nález, i když přechod řízený je, a aktiva
s IPv6 adresami se do zón nedostala.

## Rozhodnutí

1. **Odběr kalendáře** (`calendar_feeds`): token `cal_…` (32 B náhodných dat) v adrese
   `/api/public/calendar/<token>.ics`, protože kalendářové aplikace neumí posílat hlavičky. Ukládá se jen SHA-256.
   Token je **jen pro čtení kalendáře** – osobní API tokeny (ADR-097) mají zápis a do adresy nepatří. Rozsah
   a oprávnění se vyhodnotí při každém stažení (`resolveScope`, nutné `obligations:self`); neaktivní uživatel,
   zrušený odběr nebo ztracený přístup ke společnosti = 404. Nejvýš 10 odběrů na uživatele, `lastUsedAt` pro přehled.
2. **Návrh rozsahů**: kandidáti = rozsahy síťových segmentů skenů (ADR-072) a podsítě IPv4 /24 / IPv6 /64 z IP
   adres aktiv mimo zóny, které nepokrývá žádný rozsah zóny. Druh zóny podle většiny typů aktiv
   (`suggestZoneKind`); uživatel návrh potvrdí, nic se nepřidá samo.
3. **Řízený přechod** (`zone_flow_controls`): k vazbě (aktivum používá aktivum) zařízení přechodu z evidence
   a/nebo popis. Hodnocení hranice zůstává (mapa ukazuje, že hranice je riziková), ale nález `zone_boundary_flow`
   se pro řízenou vazbu nezakládá.
4. **IPv6**: `parseIp` / `cidrRangeAny` přes `bigint`; nejpřesnější rozsah = nejméně bitů hostitele, takže se
   IPv4 a IPv6 rozsahy porovnávají férově.

## Důsledky

- Migrace `0134_zone_flow_controls_calendar_feeds`.
- Adresa odběru je tajemství (kdo ji zná, vidí lhůty) – nápověda i okno to říkají, zrušení je okamžité.
- Návrh nepracuje s rozsahy jiných délek než /24 a /64; jiné rozsahy se zapíší ručně nebo jako segment skenu.
