# ADR-178: Publikace vydání z GitLabu na GitHub tagem a úlohou CI

Stav: **přijato** – navazuje na [ADR-112](ADR-112-open-source-release.md).

## Kontext

Zveřejnění na GitHub (ADR-112) bylo jen ruční (`publish.sh` na počítači vývojáře) a zaostávalo: veřejně byla verze 1.24.6,
interně 1.83.0. Interní vydání neměla tagy. Přibývá druhý repozitář (`contix-agent`, ADR-177), který se má zveřejňovat
stejně. Zrcadlení celé historie (push mirror) nepřichází v úvahu – historie může obsahovat interní údaje.

## Rozhodnutí

1. **GitLab zůstává zdrojem pravdy**, GitHub dostává jen vydání jako čistou historii (beze změny proti ADR-112).
2. **Každé vydání má v GitLabu tag `v<verze>`** (chráněný). Tag musí odpovídat `CONTIX_VERSION`; `publish.sh` nesoulad odmítne.
3. **Úloha `publish` v GitLab CI** běží jen u tagu, ručně a po úspěšných testech. Deploy klíč s právem zápisu jen do veřejného
   repozitáře, klíč github.com připnutý v proměnné (ne `ssh-keyscan`), seznam zákazů jako chráněná proměnná typu soubor;
   v CI je seznam zákazů povinný (`--require-deny`).
4. **`publish.sh` pro více repozitářů**: `--source` (např. `contix-agent`), verze z tagu, kontrola vždy `publish-scan.ts` CONTIXu.
5. Mezilehlé verze se nezveřejňují; veřejný repozitář přeskočí na nové vydání. Příspěvky z GitHubu se přenášejí do GitLabu.

## Důsledky

- Zveřejnění je jeden klik po vydání, nezávislé na počítači vývojáře; seznam zákazů je nutné udržovat i v proměnné CI.
- Runner potřebuje odchozí SSH na github.com.
- `contix-agent` používá stejný postup a cestu modulu `github.com/dynamicdata-cz/contix-agent`.
