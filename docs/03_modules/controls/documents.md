# Dokumenty ISMS – verze, schválení, seznámení

API `/api/documents`, sdílené typy `shared/documents.ts`. Panel „Verze dokumentu“ je na stránce SoA (pro každý rámec),
v Rizicích (zpráva o hodnocení rizik) a v Plánu zvládání rizik.

| Druh | Právní základ | Modul / oprávnění |
|---|---|---|
| `soa` – Prohlášení o aplikovatelnosti (u vyhl. 410 *Přehled bezpečnostních opatření*, sloupce dle příl. č. 1) | § 8 odst. 1 písm. f) vyhl. 409; § 3 odst. 2 vyhl. 410 | controls |
| `risk_report` – Zpráva o hodnocení rizik | § 8 odst. 1 písm. e) vyhl. 409 | risks |
| `treatment_plan` – Plán zvládání rizik | § 8 odst. 1 písm. g) vyhl. 409 | risks |
| `isms_review` – Zpráva o přezkoumání ISMS (viz [Řízení ISMS](../isms/overview.md)) | § 3 písm. f) a g) vyhl. 409 | isms |

- **Snímek:** vytvoření verze uloží neměnný JSON snímek (`document_versions.snapshot`) a klíčové ukazatele (`metrics`),
  z nichž UI ukazuje vývoj proti předchozí verzi. Čísla verzí jsou řazena per druh + rámec (advisory lock).
- **Zpráva o hodnocení rizik:** metodika (hranice, stupnice, kritérium akceptovatelnosti), zohledněné vstupy dle § 8 odst. 1
  písm. c) body 1–8 (volný text zadaný při vytvoření), výsledky a matice, registr rizik, rizika nad hranicí s plánem
  zvládání (body 1–7), pokrytí hrozeb a zranitelností přílohy č. 3.
- **Schválení:** oprávnění `documents:approve` (admin, CISO). Předchozí schválená verze se označí jako nahrazená.
- **Seznámení:** kdokoli se čtecím oprávněním potvrdí seznámení se schválenou verzí (§ 4 odst. 2 vyhl. 409).
- **Uchování:** schválené a nahrazené verze nelze smazat (alespoň 4 roky, § 3 odst. 2 vyhl. 410); mazat lze jen návrhy.
- **Tisk:** `/:id/html` a `/preview.html` vrací samostatné HTML (A4, vodoznak NÁHLED/NÁVRH/NAHRAZENO) s přísnou CSP;
  všechny hodnoty jsou escapované. PDF = „Tisk / uložit jako PDF“ v prohlížeči.
