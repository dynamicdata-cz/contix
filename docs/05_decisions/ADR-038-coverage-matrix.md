# ADR-038: Pokrytí předpisu – matice ustanovení × dokumenty × opatření

**Stav:** přijato (v0.42.0)

## Kontext
Skóre dokumentu (AI, `policy_review`) hodnotí jeden dokument. Pro audit a řízení shody je potřeba opačný pohled: ke každému
ustanovení předpisu (vyhláška 409/410, NIS2, DORA, ISO…) vidět, které dokumenty a opatření ho pokrývají, co chybí, a stav doložit k datu.

## Rozhodnutí
- Modul `modules/coverage` (`/api/coverage`, stránka `/controls/coverage`), pod modulem Opatření a shoda (`controls:read`).
- **Matice se počítá při čtení** (`computeCoverage`), nic se nepersistuje kromě snímků:
  - požadavky a míra shody = `loadRequirementRows` (stejně jako SoA),
  - dokumenty = platné i návrhy (ne zrušené) přes `policy_requirements` nebo oddíly vyhlášky režimu společnosti (jen ISMS),
  - verdikt AI = položky posledního dokončeného `policy_review` dokumentu (ne `failed`/`running`); „starší verze“, pokud
    `input.versionId` ≠ nejnovější verze dokumentu,
  - nejlepší verdikt mezi dokumenty (`bestDocState`), mezery `coverageGaps`, souhrn `summarizeCoverage` (`shared/coverage.ts`).
- Dokumenty vidí (a hodnotí) jen uživatel s `policies:read` při zapnutém modulu Dokumentace; jinak matice bez dokumentových mezer.
- **Hromadné AI skóre** (`POST /coverage/score`, `ai:use`): dokumenty bez hodnocení / se změnou, **sekvenčně** na pozadí
  (lokální model), každý jako běžný AI návrh (`prepareRequest` + `runSuggestion`, audit `ai.requested`) – nic se neaplikuje
  automaticky. Stav běhu je v paměti procesu (po restartu se nedokončí; hotová hodnocení zůstávají), jeden běh na společnost.
- **Snímky** `coverage_snapshots` (summary + rows JSON, autor, poznámka) – neměnné, bez mazání; export CSV aktuálního stavu
  i snímku (BOM, středníky, ochrana proti vzorcům, audit `report.exported`).

## Důsledky
- Žádná nová evidence stavu – matice odpovídá datům v okamžiku zobrazení; pro doložení k datu slouží snímek.
- Kvalita verdiktu závisí na lokálním modelu a na navázání dokumentů na požadavky (oddíly / Vazby dokumentu).
