# ADR-053: Úspěšnost SOC a shoda AI triáže

**Stav:** přijato (v0.58.0)

## Kontext
AI předběžná triáž (ADR-051) dává návrhy, ale bez měření nevíme, nakolik jim věřit. Vedení a SOC potřebují vidět doby
reakce, plnění lhůt a zdroje, které generují jen šum.

## Rozhodnutí
- Výpočet jen `computeSocMetrics` / `aiMetrics` (`shared/socMetrics.ts`) nad alerty založenými v období, při čtení, nepersistuje se.
- Skutečný verdikt `actualVerdict`: eskalace = skutečný útok, uzavření = verdikt analytika. Třídy `outcomeOf`: útok / šum
  (falešný poplach + neškodné) / nelze určit. Shoda = stejná třída; návrh „nelze určit“ se nepočítá (abstained),
  rozhodnutí „nelze určit“ se nepočítá. **Přehlédnutý útok** = AI šum, analytik útok – vypisuje se jednotlivě.
- Doby: převzetí = `acknowledgedAt − createdAt`, rozhodnutí = `decidedAt − createdAt` (medián); lhůty podle efektivní
  závažnosti (`effectiveLevel`) a nastavení SOC (alerty v případech se počítají podle vlastní závažnosti – přibližně).
- `GET /soc/metrics?days=7..365` (soc:read, rozsah společností jako fronta); UI záložka Výkonnost.
- Zpráva pro vedení: `soc.mttrHours`, `aiCompared`, `aiAgreement` (až od 5 porovnání), `aiMissed`.

## Důsledky
- Měření začíná od nasazení v0.56 (starší alerty návrh AI nemají).
- Model se neladí automaticky – výsledek slouží lidem (pokyny organizace v nastavení AI, ladění pravidel).
