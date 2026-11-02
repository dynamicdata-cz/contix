# AI asistent

Volitelný modul (Administrace → AI asistent). Výstupy jsou **návrhy ke schválení člověkem**, každý dotaz se loguje.
Architektura a governance: [ai_layer.md](../../01_architecture/ai_layer.md), [ADR-016](../../05_decisions/ADR-016-ai-ops-soc2.md).

## Úlohy

| Úloha | Kde | Co model dostane | Co se po přijetí stane |
|---|---|---|---|
| Návrh opatření pro zvládání rizika | detail rizika | název a popis rizika, hrozba, zranitelnost, dotčená aktiva (název, typ, kritičnost), stávající opatření a akce, seznam § vyhlášky dle režimu | vybrané položky se přidají do plánu zvládání rizik (akce, vazba na opatření podle §) |
| Návrh mapování opatření na požadavky | detail opatření | název, popis a způsob plnění opatření, seznam požadavků zvoleného rámce (ZKB, 409, 410, ISO, DORA, SOC 2) | vybrané požadavky se přidají k opatření |
| Klasifikace aktiva (v0.16) | detail aktiva | název, typ, třída, OS, software, procesy, podporovaná primární aktiva a jejich CIA, současné hodnoty | změní se jen vybraná pole (kritičnost, D/I/D 1–4); navrhují se jen změny |
| Nápravná opatření ke zjištění (v0.16) | zjištění auditu | zjištění, závažnost, požadavek, stávající náprava, § vyhlášky | vybraná opatření se připojí k textu nápravného opatření |
| Shrnutí incidentu (v0.16) | detail incidentu | popis, kategorie, příčina, dopad, zvládání, časová osa (bez autorů), dotčená aktiva | shrnutí pro vedení je ke zkopírování; dopad / příčina / poučení se doplní (k existujícímu textu se připojí) |
| Kontrola dokumentu (v0.16) | detail politiky / dokumentu | text poslední verze (max. 60 000 znaků), požadavky oddílů vyhlášky, ke kterým dokument patří | informativní – pokryto / částečně / chybí se zdůvodněním; přijetí = vzato na vědomí |

## Připojení k modelu

- **Open WebUI (OpenAI API)** – adresa `http://<server>:8080/api`, API klíč z Open WebUI (Nastavení → Účet → API klíče).
- **Open WebUI → Ollama proxy** – `http://<server>:8080/ollama`, stejný klíč.
- **Ollama přímo** – `http://<server>:11434` (port musí být publikován), bez klíče.
- Doporučený model: `gpt-oss:20b` (uvažující model, české výstupy, kontext 128k). Časový limit 240 s.
- Tlačítko **Otestovat spojení** ověří seznam modelů a krátký dotaz; výsledek je vidět i v Administrace → Provoz.

## Pravidla

- Oprávnění `ai:use` (CISO, manažer KB, architekt); nastavení `admin:settings`; přehled záznamů i `audit_log:read`.
- Přijmout návrh smí jen ten, kdo smí záznam upravit (správce, vlastník rizika).
- Neplatný JSON, neznámé ID požadavků či čísla § se zahodí – v návrhu zůstane jen ověřitelný obsah.
- Do modelu se neposílají jména osob, e-maily ani vlastníci; doplňující pokyny v nastavení nesmí obsahovat osobní údaje.
- Při přesunu rizika/opatření do jiné společnosti se přesouvají i jeho AI záznamy.
