# ADR-054: Indikátory kompromitace (IOC), zpětné hledání a feed k blokaci

**Stav:** přijato (v0.59.0)

## Kontext
Z phishingu, alertů a incidentů vznikají indikátory (IP, domény, URL, hashe, e-maily), které je třeba zablokovat na firewallu
a proxy a dohledat, zda se už v síti objevily. Dosud se přepisovaly ručně a nikde nestárly.

## Rozhodnutí
- Evidence `soc_iocs` (jedna hodnota daného typu na společnost, unikátní index), akce `block` | `monitor`, platnost
  (výchozí 90 dní, nejvýše rok, `null` = bez omezení), zrušení `revokedAt` (nemazat). Stav jen `iocState` při čtení.
- Normalizace a typ jen `normalizeIoc` / `detectIocType` (`shared/socIoc.ts`), převod „defanged“ zápisu `refang`,
  zobrazení vždy `defang`. Interní IP (`isPrivateIp`) nelze blokovat.
- Kandidáti z alertu `iocCandidatesOf` – nic se neuloží, dokud je analytik nevybere (`POST /soc/iocs` se `sourceAlertId`).
- **Zpětné hledání** `huntIoc`: Wazuh Indexer jen čtení (`_search`, `size: 0`, `multi_match` frázově ve vybraných polích
  podle typu, agregace podle `agent.name`) + alerty CONTIXu (`sample` / popis); výsledek `last_hunt`. Chyba indexeru se uloží,
  hledání v CONTIXu proběhne vždy. Nález se nezakládá jako alert automaticky – rozhodne analytik.
- **Export** (`/soc/iocs/export`, txt / CSV) a **feed** `/api/public/soc/feed/<token>/<ip|domain|url|hash>.txt` – jen platné
  IOC s akcí blokovat; token `cxf_…` jen jako SHA-256 (`soc_ioc_feeds`), cesta `/api/public/` se nezapisuje do logu.

## Důsledky
- Firewall / proxy musí dosáhnout na server CONTIXu; feed vrací jen hodnoty jedné společnosti.
- Sdílení IOC navenek (MISP, STIX/TAXII) zatím ne – lze doplnit nad stejnou evidencí.
