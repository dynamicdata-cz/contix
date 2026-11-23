# ADR-187: Připojená zařízení Wazuhu v mapě propojení

Stav: **přijato** (v1.93.0) – navazuje na [ADR-181](ADR-181-mapa-propojeni.md).

## Kontext

Uzel Wazuhu v mapě propojení ukazoval jen stav spojení CONTIX → Wazuh a počet aktiv. Správce ale potřebuje vidět,
které agenty Wazuh „ztratil“ – odpojený server je slepé místo stejně jako server bez agenta. Data už CONTIX má:
synchronizace ukládá u každého agenta odpověď Wazuh API (`asset_sources.raw.agent`: stav, verze, skupiny, IP,
poslední keep-alive).

## Rozhodnutí

1. Stav agentů se počítá **z poslední synchronizace** (bez dalšího volání Wazuh API při otevření mapy): aktivní,
   odpojený, čekající; agent, jehož záznam je starší než začátek poslední úspěšné synchronizace, je **odebraný**
   z Wazuhu. Agent `000` (manager) se nezobrazuje, jeho verze je referencí pro „starší verzi“.
2. Odpojený agent je problém po **7 dnech** bez spojení (`WAZUH_STALE_DAYS`) – kratší výpadek (restart, notebook)
   jen informuje. Do důvodů uzlu: „N agentů bez spojení > 7 dní“ (varování), odpojení a starší verze (informace).
3. Panel uzlu: souhrn (aktivní / bez spojení > 7 dní / odpojené / čekající / starší verze / odebrané), problémové
   agenty a okno se všemi zařízeními (filtry, hledání, export CSV / XLSX), odkaz na aktivum a jeho zranitelnosti.
4. API `GET /api/integrations/wazuh/:id/agents` (+ `.csv`, `.xlsx`), stejná oprávnění jako mapa; mimo správu systému
   jen agenti, jejichž aktivum je v rozsahu uživatele.

## Důsledky

- Bez migrace.
- Další krok: bezpečnostní zóny a vrstvená mapa aktiv (samostatné ADR).
