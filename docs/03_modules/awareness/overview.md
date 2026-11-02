# Bezpečnostní povědomí a školení (§ 10 vyhl. 409, § 5 vyhl. 410)

Plán rozvoje bezpečnostního povědomí = sada školení (druh: vstupní, pravidelné, vedení, odborné, ověřování povědomí;
forma; témata; periodicita; odpovědné místo; navazující dokument) s okruhem osob, které je musí absolvovat.

- Termíny školení s účastníky; stav „Proběhlo“ zapíše absolvování (§ 10 odst. 5) a hodnocení účinnosti (odst. 4 písm. c).
- Ruční zápis absolvování (e-learning, externí kurz) s výsledkem testu.
- Stav každé osoby počítá `trainingState` (`shared/awareness.ts`): platné / brzy vyprší (30 dní) / po termínu / neabsolvováno
  (u nového zaměstnance běží lhůta `dueDaysForNew` od nástupu do funkčního místa).
- Přehled poučení a školení se seznamem osob za období, export CSV.
- Záznamy o absolvování se nemažou se školením – školení s historií lze jen deaktivovat.

Návrhy témat jsou vlastní formulace; ověřte je proti příloze č. 6 vyhl. 409 (příloze č. 3 vyhl. 410).
