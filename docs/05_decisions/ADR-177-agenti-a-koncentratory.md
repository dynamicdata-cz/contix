# ADR-177: Agenti a koncentrátory pro sběr ze zón (návrh)

Stav: **návrh** – podrobná architektura v [docs/01_architecture/agenti-koncentratory.md](../01_architecture/agenti-koncentratory.md).

## Kontext

Sběrač ze serverů (ADR-148, ADR-151) je Python skript pro Linux, který posílá celý inventář přímo do CONTIXu.
Nehodí se pro oddělené zóny (OT, DMZ, pobočky), nepozná změny, neumí Windows a nedává důkazy k opatřením.
Wazuh pokrývá logy a zranitelnosti, ne stav služeb vůči schválenému stavu a změnovému řízení.

## Rozhodnutí

1. **Agent** (Go, Linux a Windows) jen čte, nepřijímá příkazy a posílá podepsané zprávy: úplný snímek, změny,
   důkazy a souhrn toků.
2. **Koncentrátor** v každé zóně: registrace agentů, mTLS, fronta na disku, filtry, předání odchozím spojením
   do CONTIXu nebo nadřazeného koncentrátoru, export do souboru pro izolované sítě.
3. **Dva klíče agenta**: TLS pro spojení a Ed25519 pro podpis zpráv ověřovaný až v CONTIXu. Napadený koncentrátor
   data nepodvrhne. Kořen důvěry je podpisový klíč instalace CONTIXu, aktualizace podepisuje klíč vydavatele.
4. **Hodnota pro řízení bezpečnosti**: model služeb, klasifikace změn (očekávaná / schválená / neschválená) s vazbou
   na ISMS → Změny, důkazy pro automatické testy opatření, navržené vazby aktiv z toků, mapa služeb a časová osa.
5. **Samostatný repozitář** `contix-agent`. CONTIX implementuje příjem a zpracování. Schéma protokolu je verzované
   a sdílené.
6. Agent a koncentrátor jsou produkty podle CRA (podepsaná vydání, SBOM, řešení zranitelností).
7. **CONTIX funguje bez agentů.** Agenti jsou volitelný modul; úrovně sběru 0 (bez sběru) → 1 (sběrač) → 2 (agenti
   s koncentrátorem vestavěným v CONTIXu) → 3 (koncentrátory v zónách). Mikro a malé organizace vystačí s úrovní 0 nebo 1.
8. **Kanonický JSON** pro podpisy podle RFC 8785; navázání na existující evidenci (ADR-096, ADR-152, ADR-158) místo nových
   paralelních tabulek – viz architektura, kap. 12.

## Důsledky

- Stávající sběrač zůstává a koncentrátor ho přijímá s nižší úrovní důvěry.
- Implementace po fázích 1–5 (viz architektura), pilot na dvou zónách.
