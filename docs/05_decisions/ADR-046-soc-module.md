# ADR-046: Modul SOC – fronta alertů, triáž, MITRE ATT&CK, playbooky a AI poradci

**Stav:** přijato (v0.51.0)

## Kontext
Wazuh alerty dosud vznikaly jen jako návrhy událostí u incidentů (přijmout / zamítnout). Chyběla práce analytika SOC:
převzetí, postup podle playbooku, mapování na MITRE ATT&CK, poznámky, verdikt, metriky fronty a poradenství k typům útoků
a zranitelnostem – vše na lokálním modelu (data neopouštějí organizaci).

## Rozhodnutí
- **Jedna tabulka** `alert_suggestions` rozšířená o pole SOC (analytik `assignee_id`, `acknowledged_at`, `verdict`, `mitre_ids`,
  `mitre_tactics`, `playbook_key`, `playbook_done`, `notes`, `ai_advice`, `title`, `created_by_id`), stav `in_progress`.
  Návrhy u incidentů i fronta SOC jsou tentýž záznam; ruční alert má `source = manual` a jedinečný `group_key`.
- Wazuh sync čte `rule.mitre.id` / `rule.mitre.tactic`; bez mapování odhad `techniquesFromGroups` (návrh, analytik upraví).
  Taktiky se odvozují `tacticsFor` z katalogu `ATTACK_TACTICS` / `ATTACK_TECHNIQUES` (podmnožina ATT&CK Enterprise, ID + anglické
  názvy s odkazem na attack.mitre.org, česky jen taktiky).
- **Playbooky** jsou data `SOC_PLAYBOOKS` (dvojjazyčné kroky); návrh `playbookFor` podle technik, pak taktik, jinak obecná triáž.
- Eskalace jen přes `escalateAlert` (nový incident nebo připojení k existujícímu ve stejné společnosti; aktivum, techniky, časová osa);
  vyžaduje `soc:write` + `incidents:write`. Uzavření s verdiktem a zdůvodněním, znovuotevření jen uzavřeného.
- Oprávnění `soc:read` / `soc:write` (upgrade 0.51: CISO a manažer KB obě, architekt a auditor čtení); modul `soc` závisí na `incidents`.
  Analytici = aktivní uživatelé s rolí obsahující `soc:write` (provozní přidělení, ne funkční místo).
- **AI poradci** (`soc/advisor.ts`, jen `createAiClient`): rozbor alertu (uloží se k alertu) a obecný poradce (CVE z evidence
  zranitelností v rozsahu uživatele, techniky z katalogu, nejčastější taktiky). Do modelu nejdou jména osob, uživatelské účty
  ze vzorku ani poznámky analytiků. Prompt vede k obranné perspektivě (detekce, ověření, mitigace).
- Metriky (`/soc/summary`) se počítají při čtení: otevřené, nepřevzaté, podle závažnosti, eskalace a uzavření za 30 dní,
  medián doby do převzetí, četnost taktik. Nástroj `soc_alerts` v katalogu AI dotazů / MCP.

## Důsledky
- Nový playbook = položka `SOC_PLAYBOOKS`; nová technika = `ATTACK_TECHNIQUES` (ID neměnit).
- Další zdroj alertů = zápis do `alert_suggestions` s vlastním `source` a `group_key`, MITRE přes `tacticsFor`.
- Možné rozšíření: povinnost pro nepřevzaté kritické alerty, alerty v indexu vektorů záznamů, vlastní playbooky organizace.
