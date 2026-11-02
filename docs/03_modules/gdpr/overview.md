# Ochrana osobních údajů (GDPR)

Modul `gdpr` – menu **Osobní údaje (GDPR)**. Rozhodnutí: [ADR-020](../../05_decisions/ADR-020-process-versions-gdpr.md).

## Záznam o činnosti zpracování (čl. 30)

Účel, právní základ (čl. 6), kategorie subjektů a údajů, zvláštní kategorie (čl. 9, 10), příjemci, předání do třetích
zemí, lhůty pro výmaz, technická a organizační opatření. Vazby: procesy, aktiva (systémy, úložiště), zpracovatelé
(dodavatelé, čl. 28) a bezpečnostní opatření z katalogu (čl. 32). Chybějící náležitosti se zobrazují jako mezery.

Výstup **Záznamy čl. 30** (tisk/PDF, Word) za společnost – pro ÚOOÚ nebo audit.

## DPIA (čl. 35)

- Screening: 9 kritérií EDPB (WP248); 2 a více → DPIA zpravidla nutné.
- Posouzení: popis zpracování, nezbytnost a přiměřenost, rizika (P × Z, 1–4) a opatření se zbytkovým rizikem,
  stanovisko pověřence, závěr. Zbytkové riziko ≥ 12 → upozornění na předchozí konzultaci (čl. 36).
- Schvaluje `gdpr:write`; schválené DPIA je zamčené, další přezkum je v povinnostech.

## Role

CISO a manažer KB: čtení i zápis; auditor: čtení. Vlastník (funkční místo) může svůj záznam upravit a potvrdit přezkum.
