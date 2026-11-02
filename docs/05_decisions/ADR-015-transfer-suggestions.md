# ADR-015: Přesun mezi společnostmi a návrhy z provozních dat

**Stav:** přijato · 2. 10. 2026

## Rozhodnutí

1. Přesun záznamu mění jen `company_id` (vazby a historie zůstávají). Kontroluje se viditelnost vazeb z cílové
   společnosti; nekonzistence se nepřesouvají automaticky – uživatel je upozorněn a rozhodne.
2. Wazuh alerty se neukládají jednotlivě, ale seskupené do návrhů (pravidlo + agent) – evidence incidentů zůstává
   řízená člověkem (AI/automatizace = návrh ke schválení, viz ai_layer.md). Potlačení po rozhodnutí 7 dní brání zahlcení.
3. Návrh rizika ze zranitelností a návrh zbytkového rizika jsou deterministická pravidla (žádné ML), vysvětlitelná
   (`basis`), aplikují se jen na pokyn uživatele.
4. Rozsah auditu a pokrytí se řídí režimem společnosti (409 / 410); audit může nést oddíly obou vyhlášek.

## Důsledky

- Korelace alertů (více pravidel → jeden incident) a obohacení o MITRE ATT&CK jsou možná rozšíření.
