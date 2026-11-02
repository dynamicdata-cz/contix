# Dotazy v přirozeném jazyce a MCP server (v0.20)

## Zeptat se AI

Menu **Zeptat se AI** (oprávnění „Používat AI asistenta“, zapnutý AI asistent). Napište dotaz běžnou řečí, např.:

- Která kritická aktiva nemají vlastníka?
- Jaká rizika jsou nad hranicí akceptovatelnosti a nemají rozhodnutí o zvládání?
- Která zavedená opatření nebyla za poslední rok otestována?
- Které požadavky vyhlášky 409 nejsou splněné?

Model vybere až 3 přehledy z katalogu, CONTIX je spustí s vašimi oprávněními a model výsledek shrne. Pod odpovědí jsou
tabulky s odkazy přímo z dat – ty jsou závazné. Model nedostává jména osob a nemůže nic měnit.

## MCP server – jen pro klienty s lokálním modelem

Data, která si klient přes MCP načte, zpracuje **model klienta** (ne model nastavený v CONTIXu). Proto:

- MCP je ve výchozím stavu vypnuté a zapnout ho lze **jen se seznamem povolených IP adres** klientů.
- Povolujte jen klienty, jejichž model běží ve vaší infrastruktuře – typicky **Open WebUI s Ollamou**.
- Cloudové klienty (Claude Code/Desktop, ChatGPT…) nepřipojujte bez posouzení dle GDPR a vnitřní směrnice o AI.
- Volání z jiné adresy server odmítne a zapíše `mcp.denied_ip` do auditního logu.

### Připojení Open WebUI (s Ollamou)

1. **CONTIX – Administrace → AI asistent:** zaškrtněte *Zapnout MCP server* a do *Povolených IP adres* zadejte adresu
   serveru, na kterém běží Open WebUI, tak jak ji vidí CONTIX (volání jdou z backendu Open WebUI, ne z prohlížeče).
   Pokud adresu neznáte, zkuste spojení – odmítnutá adresa je v chybě i v auditním logu.
2. **CONTIX – Profil → API tokeny (MCP):** vytvořte token (např. „Open WebUI – ai-server“, platnost 90 dní). Token se
   zobrazí jen jednou. Volání poběží s oprávněními vlastníka tokenu – pro sdílené Open WebUI použijte servisní účet
   s rolí jen pro čtení (např. Čtenář + „Vytvářet osobní API tokeny“).
3. **Open WebUI (novější verze s nativní podporou MCP)** – Nastavení správce → Externí nástroje (External Tools) →
   přidat server: typ **MCP (Streamable HTTP)**, URL `https://<contix>/api/mcp`, ověření **Bearer** = token.
   Starší verze Open WebUI MCP neumí přímo – použijte proxy `mcpo` (převádí MCP na OpenAPI) nebo Open WebUI aktualizujte.
4. **Model:** u modelu (např. `gpt-oss:20b`) zapněte volání funkcí (*Function Calling: Native*) a v chatu povolte
   nástroj CONTIX. Malé modely bez podpory nástrojů MCP nevyužijí.
5. **Síť:** server s Open WebUI musí dosáhnout na CONTIX (HTTPS přes Caddy). CONTIX bere IP klienta z hlavičky
   `X-Forwarded-For`, kterou Caddy přepisuje – API proto nevystavujte do sítě napřímo, jen přes reverzní proxy.

Nástroje: `assets_search`, `risks_search`, `controls_search`, `requirements_gaps`, `incidents_search`,
`findings_search`, `suppliers_search`, `processing_search`, `obligations` – podle oprávnění a zapnutých modulů.
U tokenu v profilu vidíte poslední použití a IP adresu; každé volání nástroje je v auditním logu (`mcp.tool_call`).

## Duplicity aktiv

**Aktiva → Duplicity** ukáže dvojice, které jsou nejspíš tentýž objekt (typicky stejný server z Wazuh i z ručního
importu). **Sloučit** – zvolíte, které aktivum ponechat; vazby (procesy, rizika, opatření, primární aktiva,
zranitelnosti, zdroje discovery) se přesunou. **Nejde o duplicitu** – dvojice se už nenabídne.
