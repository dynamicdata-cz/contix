# Modul Audity – audit kybernetické bezpečnosti (§ 16 vyhl. č. 409/2025 Sb.)

Modul `audits`, oprávnění `audits:read` / `audits:write` (role Auditor KB má zápis). API `/api/audits`, UI *Audity*.

- **Plán auditu** (odst. 1): audity se stavem Plánovaný → Probíhá → Dokončený.
- **Druhy:** plný rozsah (odst. 4 písm. b), průběžný po celcích (odst. 5), při významné změně (odst. 4 písm. a –
  vazba na změny; dokončením se u změny splní krok auditu), audit dodavatele, kontrola v oblasti KB, kontrola NÚKIB.
- **Rozsah:** oddíly vyhl. 409 (§ 3–27) + popis dle odst. 2.
- **Auditor** (§ 5 odst. 4): jméno nebo funkční místo; kontrola praxe ≥ 3 roky a vyškolení (písm. a), nestrannosti
  (písm. b) a toho, že funkční místo nezastává jinou bezpečnostní roli (písm. c).
- **Zjištění:** závažnost, vazba na požadavek vyhlášky, nápravné opatření (odst. 3 písm. b) s odpovědností a termínem,
  ověření účinnosti, zahrnutí do řízení rizik (vazba na riziko) a do plánu rozvoje bezpečnostního povědomí (odst. 3 písm. a).
- **Seznámení vedení** s výsledky (§ 4 odst. 2 písm. e) – datum.
- **Pokrytí:** pro každý oddíl vyhl. 409 poslední dokončený audit; v pořádku do 2 let, 2–5 let jen při průběžném auditu
  po celcích, jinak po termínu (`coverageState`).
- Mezery auditu: `auditGaps` v `shared/audits.ts`.

Dokončené audity a otevřená zjištění se vypíší ve zprávě o hodnocení rizik (§ 8 odst. 1 písm. c) bod 6) a ve zprávě
o přezkoumání ISMS (§ 3 písm. f) bod 4).
