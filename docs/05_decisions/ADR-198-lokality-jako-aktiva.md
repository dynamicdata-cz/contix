# ADR-198: Lokality jako aktiva (budovy, patra, místnosti, datová centra)

Stav: **přijato** (v1.104.0) – navazuje na ADR-191 (bezpečnostní zóny) a ADR-122 (mapy a půdorysy).

## Kontext

Zákazníci potřebují modelovat budovy a datová centra, umisťovat do nich techniku a bezpečnostní zóny a evidovat
fyzickou bezpečnost (vyhláška 410/2025, 409/2025). Budova je zároveň aktivum – má vlastníka, kritičnost a rizika.
CONTIX už měl typ aktiva `facility` (prostory), `rack` a vazbu závislosti `located_in` („umístěno v“).

## Rozhodnutí

1. **Lokalita = aktivum typu `facility`** s novým sloupcem `facility_kind` (areál, budova, patro, místnost, datové
   centrum, serverovna, technická místnost, jiné) a `physical` (JSON: prvky fyzické bezpečnosti ano/částečně/ne,
   adresa, poznámka, datum kontroly). Žádná samostatná tabulka lokalit – rizika, vlastníci, CIA a graf aktiv fungují beze změny.
2. **Strom i umístění techniky tvoří vazba `located_in`** (aktivum → kontejner). Kontejnerem je lokalita nebo rack;
   rack leží v místnosti. Aktivum má nejvýš jeden kontejner – umístění (`placeAsset`) nahrazuje dosavadní vazbu.
   Obecné přidání závislosti `located_in` jinam než do lokality/racku API odmítne.
3. **Zóna a půdorys** dostaly `location_id` (FK na aktivum, `on delete set null`). Mapa zón `/api/zones/map?location=`
   filtruje zóny v podstromu lokality. Vazba `located_in` se z toků přes hranice zón vylučuje.
4. **Kontrola vazeb** (`/api/premises` → `issues`): `located_in` mimo kontejner, více umístění, cyklus, nelogické
   vnoření (podle pořadí druhů), kritická technika bez umístění. Kontrola nic neopravuje sama.
5. API `/api/premises` (název `/api/locations` už nese umístění dat – GDPR), obrazovka Aktiva → Lokality.

## Důsledky

- Existující aktiva typu `facility` se v lokalitách objeví hned (druh „neurčen“), stávající vazby `located_in` tvoří strom.
- Doporučené minimum fyzické bezpečnosti je pevné podle druhu lokality; zatím se nepropisuje do nálezů ani SoA.
