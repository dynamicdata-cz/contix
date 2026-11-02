# ADR-010: Incidenty s lhůtami hlášení a audity KB

**Stav:** přijato · 1. 10. 2026

## Kontext

§ 14 vyhl. 409 vyžaduje zvládání událostí a incidentů a jejich hlášení dle § 15–16 zákona č. 264/2025 Sb. (24 h / 72 h /
30 dnů, podmínky se liší podle režimu). § 16 vyhl. 409 vyžaduje plán auditu, četnost (2 roky, po celcích 5 let),
nápravná opatření a nezávislého auditora (§ 5 odst. 4). Body 4 a 6 přezkoumání ISMS byly dosud jen textem.

## Rozhodnutí

1. Dva samostatné moduly `incidents` a `audits`, každý s vlastními oprávněními. Incidenty jsou citlivé – čtení mají jen
   bezpečnostní role; nahlásit událost (`incidents:report`) může každý uživatel bez přístupu k ostatním záznamům.
2. Lhůty hlášení se nepersistují, počítá je čistá funkce `incidentDeadlines` (sdílená API i UI, testovatelná s pevným
   „now“) z okamžiku zjištění, záznamů podaných hlášení, režimu organizace a sdělení Úřadu.
3. CONTIX hlášení neodesílá (Portál Úřadu nemá veřejné API pro povinné osoby); generuje podklad a eviduje podání.
   Obsahové náležitosti hlášení stanoví prováděcí vyhláška – podklad je proto „podklad“, ne formulář.
4. Pokrytí auditem se vyhodnocuje po oddílech vyhl. 409 z dokončených auditů; audit při významné změně automaticky
   uzavírá krok auditu u navázané změny (§ 16 odst. 4 písm. a).
5. Opraven zbývající výskyt chyby `.partial()` s výchozími hodnotami u PATCH nastavení, rolí, skupin a BIA (`patchOf`).

## Důsledky

- Napojení na SIEM/Wazuh alerty (automatické zakládání událostí) je možné doplnit později přes konektor.
- Při změně lhůt v zákoně se upravuje jen `incidentDeadlines` a její testy.
