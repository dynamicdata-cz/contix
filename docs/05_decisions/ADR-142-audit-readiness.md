# ADR-142: Příprava na audit, odkazy na předpis, úvodní cesta, kvalita záznamů a barva horní lišty (v1.45)

## Kontext

Průvodci (ADR-139–141) ukazovali kroky bez vazby na ustanovení předpisu, nehodnotili kvalitu záznamů a nová
společnost neměla doporučené pořadí. Uživatelé chtěli rozlišit společnosti / prostředí barvou horní lišty.

## Rozhodnutí

1. **Vazba na předpis**: kroky → oddíly vyhlášky 409 (`GUIDE_SECTIONS_409`), ostatní rámce přes stávající crosswalk
   (`relatedRequirements`), DORA registr přímo (`GUIDE_DIRECT_REFS`). `stepRefs` pro hlavní rámec společnosti
   (`profileOf().defaultFramework`) v `GuideStepDto.refs`.
2. **Příprava na audit** (`GET /guides/audit?framework=&format=json|html|docx`, `controls:read`): oddíly rámce
   z `computeCoverage` (shoda, opatření, dokumenty, mezery), kroky průvodců přes `stepRequirements`, stav oddílu
   `auditSectionState` (připraveno ≥ 80 % bez otevřeného kroku). Výchozí rámec z profilu (bez literálu vyhlášky).
   Nic se neukládá; doklad k datu = snímek pokrytí předpisu (ADR-038).
3. **Úvodní cesta**: `ONBOARDING_PHASES` (základy → analýza → opatření → provoz → ověření), `onboardingState`.
4. **Kvalita**: fakta `risksIncomplete` (bez hrozby nebo bez aktiv / procesů), `plansIncomplete` (bez aktivace,
   kroků nebo kontaktů), `suppliersWithGaps` (`loadSuppliers` → `supplierGaps`), `policiesWithGaps`
   (`loadPolicies` → `policyGaps`). Nové průvodce `org` a `exceptions` (`loadExceptions`). Skupina: mezipaměť 2 min.
5. **Barva horní lišty**: `TOPBAR_COLORS`; společnost `overrides.topbarColor` (v `/auth/me` u společnosti) má
   přednost před volbou uživatele v prohlížeči. Vzhled jen třídy `topbar-c-*` / `tb-*` ve `styles.css`.

## Důsledky

- Přesnost vazby na předpis závisí na crosswalku vyhlášky 409 – při novele aktualizovat crosswalk a `GUIDE_SECTIONS_409`.
