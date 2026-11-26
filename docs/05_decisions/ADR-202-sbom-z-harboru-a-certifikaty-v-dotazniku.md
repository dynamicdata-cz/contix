# ADR-202: SBOM z Harboru a certifikáty pracovníků v dotazníku dodavatele

Stav: **přijato** (v1.110.0) – navazuje na ADR-201 (Harbor) a ADR-199 (certifikáty osob).

## Kontext

1. Komponenty produktu CRA se dosud nahrávaly jen ručně (SBOM / zámek závislostí). Harbor od verze 2.11 umí
   k obrazu vygenerovat SBOM (ručně „Generate SBOM“ nebo automaticky při push) a uložit ho jako příslušenství obrazu.
2. Certifikáty pracovníků dodavatele (ADR-199) zapisoval správce ručně, přestože je dodavatel stejně dokládá
   v bezpečnostním dotazníku jako přílohy bez struktury.

## Rozhodnutí

1. Synchronizace Harboru navíc čte `GET …/artifacts/{ref}/additions/sbom`. Odpověď je dokument SPDX / CycloneDX,
   případně zabalený v objektu (podle verze Harboru) – `harborSbomDoc` ho najde nejvýš do hloubky 2.
   Chybějící nebo nečitelný SBOM synchronizaci skenu neruší, jen se zapíše `harbor_state.sbomStatus`
   (`imported` / `manual` / `missing` / `error`) a `sbomComponents`.
2. Komponenty produktu se SBOMem z Harboru nahradí, jen když produkt komponenty nemá nebo je má z Harboru
   (`sbomFromHarbor`). Ručně nahraný SBOM má přednost – nahradí se až výslovně (`POST /api/cra/:id/harbor`
   s `{ replaceSbom: true }`, v UI „Nahradit SBOMem z Harboru“). Ruční nahrání příznak `sbomFromHarbor` vypne.
   Po nahrazení proběhne párování s OSV.
3. Dotazník dodavatele má sloupec `staff_certs` (jsonb, nejvýš 50 položek: id, držitel, název, vydavatel, číslo,
   vydáno, platnost). Doklad je příloha dotazníku s `questionKey = cert:<id>` – jen k uloženému certifikátu,
   jedna na certifikát; přílohy odebraných certifikátů se smažou. Pole chybí → seznam beze změny (starší klient).
4. Při odevzdání se certifikáty zapíší do `person_certificates` jako externí držitel u dodavatele (s kopií dokladu
   a poznámkou o původu). Stejný certifikát (dodavatel + držitel + název + číslo) se při dalším odevzdání
   aktualizuje, nezdvojí se. Hlídání platnosti a upozornění pak běží jako u ostatních certifikátů (ADR-199).

## Důsledky

- Údaje od dodavatele se do evidence zapíší bez ručního přepisování; zdroj je zřejmý z poznámky a z dotazníku.
- Data od dodavatele nejsou ověřená – správce je posoudí při vyhodnocení dotazníku (stejně jako odpovědi).
- Harbor bez SBOM (starší verze) funguje beze změny; CONTIX dál jen čte.
