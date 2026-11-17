# ADR-155: Úrovně vlastnictví aktiv, úkoly z nálezů a eskalace v hierarchii (v1.60)

## Kontext

Aktivum mělo jediného „garanta / vlastníka“. V praxi za aktivum odpovídá business vlastník (hodnocení, rizika,
audity), ale technické nálezy (zranitelnosti, výsledky testů z Kali Linuxu) řeší správce – technický garant.
Nálezy bezpečnostních testů neměly vazbu na úkoly a povinnosti po termínu nikdo výš neviděl.

## Rozhodnutí

1. **Aktivum** (migrace 0115): `owner_user_id` = business vlastník, nově `technical_owner_user_id` (technický garant)
   a `technical_deputy_user_id` (zástupce). Garant a zástupce mají k aktivu stejná práva jako vlastník
   (`assets:write_own`, triáž zranitelností); měnit odpovědné osoby smí jen `assets:write`. Výjimky (přijetí rizika)
   zůstávají vlastníkovi. Povinnost „Oprava zranitelností“ jde garantovi a zástupci, bez garanta vlastníkovi.
2. **Úkoly z nálezů** (`tasks.source_kind = sectest_finding`): odpovědná **funkce** = funkce technického garanta →
   zástupce → business vlastníka (uživatel → `position_holders`; přednost funkce ve stejné společnosti a nevedoucí).
   Termín podle závažnosti 7 / 14 / 30 / 90 dní, priorita vysoká / střední / nízká. Nejvýš jeden otevřený úkol na nález.
   Endpoint `POST /api/security-tests/findings/tasks` (`sectests:run` + `actions:write`); sada s `auto_tasks`
   (migrace 0115) zakládá úkoly po každém běhu pro střední a vyšší závažnost.
3. **Automatické uzavření**: když opakovaný test nález nenajde (stav `fixed`), otevřené úkoly se označí jako splněné
   s poznámkou; ruční „opraveno“ také. Přijetí a falešně pozitivní úkol zruší.
4. **Zjištění auditu** (`audit_findings.asset_id`, migrace 0115): bez zadané funkce dostane funkci business vlastníka
   aktiva, jinak vlastníka opatření. Aktivum musí patřit společnosti auditu nebo s ní být sdílené.
5. **Eskalace** se počítá při čtení (nic se neukládá): pro položku s odpovědnou funkcí je řetězec vedoucí funkce
   vlastního útvaru → vedoucí nadřazených útvarů (`org_units.parent_id`, `positions.is_manager`). Úroveň =
   `floor(dní po termínu / 7)`, nejvýš délka řetězce. `personalObligations` přidá nadřízeným eskalované položky
   (`escalation: { level, daysOverdue }`, bez akce v řádku) – fronta Moje práce i e-mailová upozornění.
6. **Sonda 1.1**: testy UDP, NLA RDP, FTP, SMTP, databáze, SNMP, NFS, VNC (skripty nmap jen z katalogu sondy),
   AXFR (`dig`) a citlivé cesty na webu (vestavěné GET s `Range`, vyhodnocení obsahu proti soft-404).
   Systemd jednotka dostává jen `CAP_NET_RAW CAP_NET_ADMIN` (ambient + bounding set), uživatel zůstává bez roota.

## Důsledky

- Úkoly jdou na funkce: osoba bez funkce v organizační struktuře úkol nedostane (endpoint vrací počet
  `unassigned`, UI to ukáže). Vlastník / garant tak musí mít funkci.
- Eskalace nepotřebuje nastavení ani plánovač; mění se s organizační strukturou.
- Stávající „garant / vlastník“ je nyní business vlastník; sloupec importu „Garant“ dál mapuje na něj
  (zpětná kompatibilita), technický garant má vlastní sloupec.

## Doplnění v1.62 – úkol přímo osobě

Úkoly přidělované jen funkčním místům se k odpovědným osobám nedostaly, pokud garant neměl funkci v organizační
struktuře (častý stav u správců a administrátorů). Proto:

- `tasks.assignee_user_id` (migrace 0117): odpovědná osoba úkolu. Úkol z nálezu = technický garant, jinak zástupce,
  jinak business vlastník; `owner_position_id` = funkce této osoby, jinak první funkce v pořadí (kvůli eskalaci a přehledu).
- Osoba úkol vidí a plní (Moje práce, e-mail, `canRead` / PATCH stavu) i bez funkce; zástupce technického garanta
  u úkolů z nálezů také. Eskalace úkolu bez funkce vychází z funkce přidělené osoby.
- Přepočet otevřených úkolů `reassignFindingTasks` po změně odpovědných osob aktiva, po přiřazení nálezu k aktivu a při
  opakovaném „Založit úkoly“ (doplní osobu ke starším úkolům). Úkoly „rozpracováno“ se nepřesouvají.
- Pravidlo „odpovědnost = funkční místo“ (AGENTS.md) platí dál; osoba je doplněk tam, kde odpovědnost vychází z karty aktiva.
