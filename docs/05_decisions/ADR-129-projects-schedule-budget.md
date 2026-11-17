# ADR-129: Projekty – harmonogram, rozpočet, vlastní šablony a vazby (v1.32)

## Kontext

Projekty s branami (ADR-128) potřebují pro vedení a sponzory i časový plán, sledování nákladů, šablony podle zvyklostí
organizace a propojení s aktivy a riziky, kterých se týkají.

## Rozhodnutí

1. Harmonogram jen z plánovaného začátku a konce fází (`project_phases.planned_start`, `planned_end`); skutečný konec
   fáze = schválení brány. Žádné závislosti úkolů ani kritická cesta – jednoduchý Gantt (`timelineRange`, `timelinePct`).
2. Rozpočet `projects.budget` (numeric, Kč) a náklady `project_costs` (datum, popis, částka, fáze, dodavatel); čerpání
   `budgetState`: varování od 90 %, překročení nad 100 %. Záporná částka = dobropis.
3. Vlastní šablony `project_templates` (fáze a dokumenty v JSON, stejný tvar jako vestavěné), klíč `custom:<id>`;
   použít jen aktivní šablonu téže společnosti; použitou šablonu nelze smazat, jen vyřadit. Projekt si fáze a dokumenty
   při založení zkopíruje – pozdější změna šablony běžící projekty nemění.
4. Vazby `project_assets` / `project_risks` / `project_suppliers` / `project_processes` (kontrola rozsahu jako u CRA)
   a zpětná vazba `project` u aktiv, rizik, dodavatelů a procesů.
5. Migrace 0099; vše auditováno.

## Důsledky

- Měna pevně Kč; víceměnové projekty a plán čerpání po měsících zatím ne.
