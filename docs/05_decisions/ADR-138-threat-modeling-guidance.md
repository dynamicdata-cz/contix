# ADR-138: Modelování hrozeb – postup, připravenost dat a fronta rozhodnutí (v1.41)

## Kontext

Modelování hrozeb (ADR-137) mělo čtyři samostatné záložky bez vodítka, kde začít, a výsledky závisely na úplnosti
evidence, kterou uživatel neviděl.

## Rozhodnutí

1. **Připravenost dat** jen `readinessItems` (`shared/threatModeling.ts`): korunní klenoty, aktiva z internetu, podíl
   podpůrných aktiv s vazbou / závislostí (≥ 50 %), segmenty (≥ 2), zranitelnosti, identity, EDR (zdroj Wazuh),
   BIA procesů nad primárními aktivy (≥ 60 %), zavedená opatření s testem za 12 měsíců nebo monitorem (≥ 50 %);
   stav ok / částečně / chybí, odkaz na stránku k doplnění a dotčené části.
2. **Kroky** jen `modelingSteps`: odvětví → data → cesty → kalibrace → threat modely; další krok = první nehotový,
   chybějící data neblokují, když jsou korunní klenoty a cesty k rozhodnutí. Přehled `GET /risks/modeling/overview`
   (`modelingOverview`, jen čtení, nepersistovat).
3. **Pořadí** `pathPriority` (dopad × úroveň, pak pravděpodobnost) a `calibrationPriority` (neohodnocená, pak největší
   odchylka, zvýšení před snížením); první položka „Začněte tímto“, filtr cest k rozhodnutí / rozhodnuté.
4. Nápověda „Jak na to“ v záložkách; skrytí panelu a nápovědy jen v prohlížeči (localStorage, s ošetřením chyb).

## Důsledky

- Nový zdroj dat ovlivňující cesty nebo kalibraci = nová položka `READINESS_KEYS` + výpočet v `modelingOverview` + popisky.
