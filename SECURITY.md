# Bezpečnostní politika

## Hlášení zranitelnosti

Zranitelnosti CONTIXu **nehlaste veřejně** (issue, diskuse). Použijte soukromé hlášení na GitHubu:
záložka **Security → Report a vulnerability** tohoto repozitáře.

Uveďte prosím verzi (menu aplikace nebo `GET /api/health`), popis, kroky k reprodukci a dopad. Potvrzení přijetí
pošleme do 5 pracovních dnů, opravu kritických a vysokých zranitelností vydáváme přednostně jako opravnou verzi
(`1.x.y`) a v poznámkách k vydání ji označíme. Po vydání opravy rádi uvedeme, kdo zranitelnost nahlásil (pokud si to přejete).

## Podporované verze

Opravy vydáváme pro **poslední vydání** (větev `main`). Aktualizace: `sudo ./infra/scripts/update.sh`.

## Doporučení pro provoz

- Provozujte CONTIX jen v interní síti nebo za reverzní proxy s TLS (výchozí instalace: Caddy), zapněte MFA pro všechny účty.
- `.env` se vygenerovanými tajemstvími (`APP_SECRET`, hesla DB) nesdílejte; servisní účty konektorů (Wazuh, AD, Entra ID) jen pro čtení.
- Zálohy jsou šifrované – klíč uchovávejte mimo server. Kontrolu stavu najdete v **Administrace → Provoz**.
- Před vydáním každé verze probíhá `bun audit`, typová kontrola, unit, integrační a end-to-end testy; bezpečnostní zásady
  vývoje jsou v [AGENTS.md](AGENTS.md) a [ADR-108](docs/05_decisions/ADR-108-contix-security.md).
