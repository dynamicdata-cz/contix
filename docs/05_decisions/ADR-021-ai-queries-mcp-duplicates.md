# ADR-021: Dotazy v přirozeném jazyce, MCP server a duplicity aktiv

**Stav:** přijato · 3. 10. 2026

## Katalog čtecích nástrojů

1. Jediný katalog `modules/ai/tools.ts` (aktiva, rizika, opatření, požadavky bez shody, incidenty, zjištění auditů,
   dodavatelé, činnosti zpracování, povinnosti). Každý nástroj má Zod schéma vstupu, potřebné oprávnění a modul
   a vrací tabulku `{columns, rows[{cells, link}], total}` (nejvýš 50 řádků).
2. Nástroj běží jen nad společnostmi v rozsahu, kde má uživatel jeho oprávnění (`byCompany`); povinnosti se navíc
   filtrují podle čtecího oprávnění druhu povinnosti. **Žádný nástroj nezapisuje.**
3. Katalog sdílí dotaz v přirozeném jazyce i MCP – nový přehled = nový nástroj, dostupný v obou.

## Dotaz v přirozeném jazyce

1. Dva kroky: (a) model dostane katalog (názvy, popisy, JSON Schema) a vrátí plán `{"calls":[{tool,args}]}` –
   validace `parseQueryPlan` (jen známé nástroje, nejvýš 3); (b) CONTIX nástroje spustí a model dostane výsledky
   ke shrnutí. Model tedy nikdy nevidí víc, než uživatel smí, a nemůže spustit SQL ani zápis.
2. Do shrnutí se neposílají sloupce s možnými jmény osob (`Vlastník`); uživatel je vidí v tabulkách.
3. Odpověď je výslovně označena jako shrnutí modelu; závazné jsou tabulky s odkazy přímo z dat.
4. Běh je asynchronní (`ai_queries`, polling), jeden běžící dotaz na uživatele; dotaz, plán, výsledky a odpověď se
   logují (Administrace → AI asistent, auditní akce `ai.query`).

## MCP server

1. `POST /api/mcp` – Model Context Protocol, transport Streamable HTTP, odpovědi jen `application/json` (bez SSE),
   metody `initialize`, `ping`, `tools/list`, `tools/call`; nástroje mají `readOnlyHint`.
2. Autentizace **osobním API tokenem** (`ctx_…`, v DB jen SHA-256, platnost 30/90/365 dní nebo bez expirace,
   volitelně omezení na jednu společnost, zneplatnění). Token nese oprávnění uživatele v okamžiku volání – odebrání
   role se projeví hned. Vytvářet tokeny smí role s `api:tokens`.
3. Server je ve výchozím stavu vypnutý (`mcpEnabled` v nastavení AI). Každé `tools/call` se zapisuje do auditního logu.
4. Session cookie se pro MCP nepoužívá; CSRF ochrana se netýká (JSON + Bearer).
5. **Data neopouštějí lokální model (v0.20.1):** data z nástrojů zpracuje model klienta, proto MCP lze zapnout jen
   se seznamem povolených IP adres (`mcpAllowedIps`, IPv4/CIDR/IPv6) – typicky server s Open WebUI a Ollamou.
   Jiná adresa = 403 a `mcp.denied_ip` v auditu; u tokenu se ukládá poslední IP. IP se bere z `X-Forwarded-For`,
   který přepisuje Caddy – API se nevystavuje bez reverzní proxy. Cloudové klienty organizace zatím nepovoluje.

## Duplicity aktiv

1. Heuristika `duplicateReasons` (shared): sériové číslo (60), MAC (50), hostname (40), stejný/podobný název (35/20),
   IP (20); různý typ −15; pod 30 bodů nejde o kandidáta. Samotná shoda IP (DHCP, NAT) nestačí.
2. Kandidáti jen ze sdílených klíčů („blokování“), ne n²; zamítnuté dvojice v `asset_duplicate_dismissals`.
3. Sloučení (`assets:delete` + `assets:write`) přesune **všechny** cizí klíče na `assets.id` zjištěné z katalogu
   Postgresu (i budoucí tabulky) řádek po řádku v savepointu; kolize s jedinečností = vazba už existuje → řádek se
   smaže. Prázdná pole ponechaného aktiva se volitelně doplní, IP/MAC/štítky se sloučí. Nic se neslučuje automaticky.
