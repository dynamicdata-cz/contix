# ADR-091: Zakázka SOC 2 a zpráva Type I / Type II

**Stav:** přijato (v0.96)

## Kontext
Auditor SOC 2 potřebuje vést zakázku (rozsah kategorií TSC, období, PBC, pracovní papíry, výjimky a vyjádření vedení) a vydat zprávu Type I / Type II ve Wordu. CONTIX už má rámec soc2 (jen ID kritérií a vlastní popisky), opatření s mapováním na požadavky, testy opatření se vzorky a důkazy, audity se zjištěními a portál externího auditora (PBC, ADR-071).

## Rozhodnutí
- Modul `soc2` (závisí na `audits` a `controls`, oprávnění audits:read / audits:write). Zakázka = audit typu `soc2` (`AUDIT_TYPES`) + `soc2_engagements` (1:1 přes `audit_id`, kaskádní smazání). PBC, auditoři a zjištění se nezdvojují – používají se tabulky auditu; přesun auditu mezi společnostmi přesune i zakázku.
- Matice kritérium → opatření (`control_requirements` „soc2:…“ ve společnosti zakázky) → testy v rozsahu (`soc2TestInScope`: Type I testy návrhu ke dni, Type II testy účinnosti s překrývajícím se obdobím) → vzorky → výjimky se počítá při čtení (`soc2Matrix`), nepersistuje se.
- Výjimka = zjištění auditu s `requirement_id = soc2:<kritérium>` a volitelně `control_test_id` (nový sloupec `audit_findings`); vyjádření vedení = `corrective_action`.
- Pracovní papíry = `soc2_engagements.workpapers` (závěr pending / no_exceptions / exceptions / na, poznámka, kdo, kdy). Závěr `na` vyřadí kritérium z oddílu IV i z kontrol připravenosti.
- Připravenost zprávy jen `soc2Readiness` (nepersistovat). Zpráva jen `soc2ReportBody` (`modules/soc2/report.ts`) – vlastní texty CONTIXu (cs/en), ne vzorová zpráva AICPA; text kritérií TSC se nevkládá. Výstup tisk / Word přes `htmlToDocx`.
- Mapování TSC ↔ ISO 27001:2022 je vlastní tabulka `TSC_ISO`; TSC ↔ vyhl. 409 je obrácený `CROSSWALK_409` (`tscCrosswalk`). Standardní PBC `SOC2_PBC_TEMPLATE` (vlastní formulace, u Type II i populace); vložení nezdvojuje podle názvu.

## Důsledky
Auditor pracuje v instanci / společnosti klienta (opatření, testy a důkazy klienta). Bridge letter, SOC 3 a SOC 1 nejsou v rozsahu.
