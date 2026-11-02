# ADR-049: Prioritizace zranitelností – CISA KEV, EPSS, plán oprav

**Stav:** přijato (v0.54.0)

## Kontext
Wazuh hlásí na serverech tisíce otevřených vysokých a kritických CVE (2 000–2 900 na aktivum). Závažnost (CVSS) sama
neříká, co opravit nejdřív. Veřejné zdroje hrozeb – katalog **CISA KEV** (aktivně zneužívané zranitelnosti) a **EPSS**
(FIRST, pravděpodobnost zneužití v příštích 30 dnech) – umožňují soustředit se na malou část, která skutečně hrozí.

## Rozhodnutí
- Globální tabulka `vuln_intel` (CVE → KEV: název, datum přidání, termín, ransomware; EPSS: skóre, percentil, datum).
  KEV se ukládá celý (tisíce záznamů, co z katalogu vypadne, přestane být KEV), EPSS jen pro CVE z evidence (soubor má
  stovky tisíc řádků). Data se jen **stahují** z veřejných adres (výchozí cisa.gov a epss.cyentia.com, nastavitelné);
  nic se neodesílá. Server bez internetu: ruční nahrání JSON / CSV / CSV.GZ (`/vulnerabilities/intel/upload`, admin:settings).
- Plánovač stahuje jednou denně (`maybeRefreshVulnIntel`, na pozadí, po chybě nejdřív za 6 h); chyba se ukáže ve stavu.
- **Priorita** se nepersistuje: `vulnPriority` (TS) a `vulnPrioritySql` (SQL, stejná pravidla): P1 = KEV nebo EPSS ≥ 50 %;
  P2 = EPSS ≥ 10 % nebo kritická na aktivu vysoké / kritické kritičnosti; P3 = ostatní kritické a vysoké; P4 = ostatní.
  Výpis zranitelností řazen podle priority, filtry priorita / KEV / balíček; souhrn `openByPriority`, `kevOpen`, stav zdrojů.
- **Plán oprav** `/vulnerabilities/fix-plan`: otevřené zranitelnosti podle balíčku (co odstraní jedna aktualizace), řazeno
  podle počtu P1, P2, P3; počet nepokrytých kritických / vysokých pro riziko.
- **Riziko za balíček** `/risks/from-package`: všechna aktiva společnosti s nepokrytými kritickými / vysokými CVE balíčku
  (alternativa k jednomu riziku na aktivum s tisíci CVE).
- Poradce SOC dostává ke zmíněným CVE i údaj z KEV / EPSS.

## Důsledky
- Prahy (`EPSS_P1`, `EPSS_P2`) a pravidla měnit na obou místech (`vulnPriority` i `vulnPrioritySql`).
- Semafor aktiv (`computeHealth`) priority zatím nezohledňuje – možné rozšíření (P1 = červená).
