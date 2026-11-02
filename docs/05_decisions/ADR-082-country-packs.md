# ADR-082: Balíčky států EU (SK, PL, DE, AT)

**Stav:** přijato (v0.86)

## Kontext
Regulatorní profil (ADR-080, ADR-081) zatím znal jen Česko a obecný balíček. Pro nabídku CONTIXu v dalších státech je potřeba znát kategorie subjektů, úřad a pravidla hlášení podle národní transpozice NIS2.

## Rozhodnutí
- Balíčky jsou data v `REGULATORY_PACKS` (`shared/regulatory.ts`) se stavem znění `asOf` (10/2026, ověřit při každé aktualizaci):
  - **SK** – zákon č. 69/2018 Z. z. ve znění transpozice NIS2 (účinnost 1. 1. 2025): prevádzkovateľ základnej služby (§ 17), opatrenia § 20, hlásenie § 24, NBÚ / SK-CERT.
  - **PL** – ustawa o krajowym systemie cyberbezpieczeństwa, novela Dz.U. 2026 poz. 252 (od 3. 4. 2026): podmiot kluczowy / ważny, CSIRT NASK / GOV / MON, system S46.
  - **DE** – BSIG ve znění NIS2UmsuCG (od 12/2025): besonders wichtige / wichtige Einrichtung (§ 28), opatření § 30, hlášení § 32, registrace § 33, BSI.
  - **AT** – NISG 2026, BGBl. I Nr. 94/2025 (od 1. 10. 2026): wesentliche / wichtige Einrichtung, registrace do 31. 12. 2026, hlášení CSIRT, dozor Bundesamt für Cybersicherheit.
- Úrovně se mapují na existující `regime` (higher = klíčový / essential, lower = důležitý / important, none = mimo působnost); balíček může mít jen některé úrovně.
- Hlavní rámec = vestavěná NIS2 (směrnice + 2024/2690); zvolený rámec z knihovny (importované znění národního zákona) má přednost.
- Hlášení podle čl. 23 NIS2 (24 h / 72 h / 1 měsíc) s národním ustanovením v textu lhůty (`reportingRef`); adresát „jiný“ (CSIRT / úřad balíčku). Mimo působnost (none) bez povinnosti hlásit.
- Plná znění národních zákonů se nedodávají v kódu – importují se do knihovny rámců (balíček YAML) a sdílejí exportem.

## Důsledky
Doplňující národní specifika (např. odlišné prahy významnosti, formuláře hlášení, povinné dokumenty) se doplní do balíčků, až budou ověřena; do té doby platí obecná pravidla NIS2 a nastavení společnosti.
