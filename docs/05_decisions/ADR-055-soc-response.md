# ADR-055: Reakce s potvrzením – okamžitá upozornění a zásahy SOC se schválením

**Stav:** přijato (v0.60.0)

## Kontext
Kritický alert čekal na denní souhrn nebo na vypršení lhůty převzetí. Zásahy (blokace IP, zakázání účtu) se dělaly mimo
CONTIX bez záznamu, kdo je schválil – pro NIS2 / ZKB a audit chybí stopa. Automatické zásahy bez člověka jsou riziko
(falešný poplach zablokuje provoz).

## Rozhodnutí
- **Okamžitá upozornění** `notifyNewAlerts`: otevřené alerty za 24 h od `notifyMinSeverity` (výchozí `critical`, `off` vypne)
  → `sendSocNotices` (e-mail týmu `soc:write`, Teams) s odstraněním duplicit přes `notification_log` (`soc_alert:<id>`).
  Volá se v plánovači po synchronizaci Wazuhu, po příjmu webhooku a po hlášení phishingu.
- **Zásahy** `soc_actions` (`block_ip`, `disable_account`, `reset_password`, `isolate_host`, `custom`): návrh `soc:write`,
  rozhodnutí a provedení nové oprávnění **`soc:respond`** (upgrade 0.60 pro CISO / bezpečnostního manažera).
  Výchozí **čtyři oči** – navrhovatel nemůže schválit. Stavy proposed → approved → done | failed, rejected, cancelled;
  nic se nemaže. Každý krok: audit, poznámka alertu, časová osa navázaného incidentu.
- **Automaticky jen `block_ip`** po schválení: `wazuhBlockIp` – `PUT /active-response?agents_list=…` s příkazem
  `blockCommand` (výchozí `!firewall-drop`), **samostatný účet** Wazuh API (heslo šifrovaně, jen `active-response:command`);
  účet pro inventář zůstává jen pro čtení. Interní IP nelze blokovat; zablokovaná IP se zapíše do IOC (feed pro firewall).
  Selhání (vypnuto, chyba API, žádný agent) = stav `failed` s textem a upozornění schvalovatelům; lze zopakovat.
- **Ostatní zásahy ručně**: CONTIX nemění účty v AD ani zařízení (ADR-029 – adresáře jen čte). Správce provede zásah
  a zapíše výsledek (`complete`). Automatizaci AD lze doplnit později se samostatným delegovaným účtem.

## Důsledky
- Odblokování IP řídí Wazuh (timeout v `ossec.conf`); CONTIX neeviduje stav pravidel na agentech.
- Upozornění používají kanály z Administrace → Upozornění; bez zapnutého e-mailu / Teams se nic neodešle.
