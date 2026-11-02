# Návrhy událostí z Wazuh alertů (§ 14 odst. 1 – detekce událostí)

- Zdroj: Wazuh Indexer (stejné připojení jako zranitelnosti), index `wazuh-alerts-*`, alerty s úrovní pravidla ≥ prahu
  (výchozí 10). Načítání každých 15 minut (plánovač API) nebo tlačítkem „Načíst“.
- Alerty se seskupí podle pravidla a agenta → **návrh**; přiřadí se k aktivu podle agenta Wazuh (discovery) a k jeho společnosti.
- Opakované alerty navyšují počet u otevřeného návrhu. Po přijetí nebo zamítnutí se stejné pravidlo na stejném agentovi
  7 dní nenavrhuje znovu (jen se navýší počet).
- **Přijetí** založí bezpečnostní událost (k posouzení) s kategorií podle skupin pravidla, časem zjištění = první alert,
  vazbou na aktivum a záznamem v časové ose. **Zamítnutí** vyžaduje zdůvodnění. Obojí je v auditním logu.
- Nastavení: Incidenty → Návrhy z Wazuh → Nastavení (`admin:settings`).
