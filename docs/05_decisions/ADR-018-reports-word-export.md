# ADR-018: Zpráva pro vedení a export do Wordu

**Stav:** přijato · 2. 10. 2026

## Rozhodnutí

1. **Jeden zdroj pravdy pro tiskové výstupy** – HTML z `documents/render.ts` (escapované). Z něj vzniká tisk / PDF
   (prohlížeč) i **Word (.docx)**: převodník `documents/docx.ts` mapuje omezenou podmnožinu HTML (nadpisy, odstavce,
   tabulky, seznamy, tučné, `muted`/`small`, barva textu) na knihovnu `docx`. Nepoužívá se obecný HTML→DOCX ani
   headless prohlížeč na serveru (bez Chromia v kontejneru API, deterministický výstup).
2. Dokumenty se širokými tabulkami (SoA, zpráva o hodnocení rizik, plán zvládání) jsou ve Wordu na šířku; záhlaví
   s názvem organizace, zápatí s číslem stránky. Export uložené verze se zapisuje do auditního logu.
3. **Zpráva pro vedení** se nepersistuje (na rozdíl od dokumentů ISMS) – počítá se z evidence za zvolené období:
   výpočty zprávy o přezkoumání ISMS (`ismsReviewSnapshot`) + ověřování opatření (`assuranceStats`) + povinnosti
   (`collectObligations`) + stav aktiv. Semafor ukazatelů má pevné prahy (`levelByThreshold`); červené ukazatele
   tvoří oddíl „Co vyžaduje rozhodnutí vedení“. Formální záznam o projednání zůstává zprávou o přezkoumání ISMS.

## Důsledky

- Nový tiskový výstup = HTML v podporované podmnožině → Word funguje automaticky.
- Prahy semaforu lze později přesunout do nastavení společnosti.
