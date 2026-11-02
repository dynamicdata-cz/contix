# ADR-098: Zprávy o ujištění od dodavatelů (SOC 2, SOC 1, ISO 27001) – CUEC, výjimky, rizika

- Stav: přijato
- Datum: 2026-10-23
- Verze: 1.03

## Kontext
Řízení dodavatelů (§ 9 vyhl. 409, DORA, NIS2) vyžaduje ověřit bezpečnost dodavatele. Nejčastější podklad je zpráva SOC 2 Type II
nebo certifikát ISO 27001. Ze zprávy plynou povinnosti pro nás (CUEC), zjištěné výjimky a vyňatí subdodavatelé – v praxi se čtou ručně
a výsledek nikam nevede.

## Rozhodnutí
1. Zpráva `supplier_reports` u dodavatele: druh (`SUPPLIER_REPORT_KINDS`), auditor, období, výrok, platnost (výchozí konec období + 12 měsíců,
   `defaultReportValidity`), bridge letter, vyňatí subdodavatelé, soubor (SHA-256, stažení jen jako příloha se sandbox CSP) a text pro AI
   (PDF jen převodní službou na interní síti, jinak vložený ručně). Nic se neodesílá ven.
2. Položky `supplier_report_items`: CUEC (mapování na vlastní opatření společnosti), výjimka (závažnost, odpověď vedení, riziko), CSOC.
3. Mezery jen `supplierReportGaps` při čtení: platnost, výrok, chybějící bridge letter (> 3 měsíce po období), CUEC bez opatření nebo se slabým
   opatřením, výjimky bez posouzení / rizika, vyňatí subdodavatelé, chybějící soubor.
4. AI `supplier_report_extract`: výňatek zprávy kolem klíčových míst (`reportExcerpt`, max. 24 000 znaků) + názvy vlastních opatření;
   validace `parseReportItems` (kritérium jen z TSC, opatření jen z kontextu, bez duplicit); položky vzniknou až po přijetí (zdroj `ai`).
5. Riziko z výjimky jen na pokyn uživatele (`risks:write`), neohodnocené, navázané přes `supplier_risks`.
6. Povinnost `supplier_report` (konec platnosti nejnovější zprávy dodavatele daného druhu), AI nástroj `supplier_reports`, přesun dodavatele přenese zprávy.

## Nezahrnuto
Automatické stažení zpráv z portálů dodavatelů (Trust Center), vyhodnocení CSOC proti zprávám subdodavatelů.
