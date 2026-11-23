# ADR-193: Technická bezpečnost na Přehledu

Stav: **přijato** (v1.99.0)

## Kontext

Sekce Technická bezpečnost na Přehledu ukazovala jen aktiva, zranitelnosti, incidenty, identity a servery ze sběrače.
Bezpečnostní testy byly v souhrnu skupiny skryté a výsledky novějších modulů (monitoring a zóny, certifikáty TLS,
SOC, konfigurace serverů, provoz a zálohy) se na úvodní stránku nedostaly – uživatel je musel hledat v menu.

## Rozhodnutí

1. Karty skládá web z existujících souhrnných API (žádné nové endpointy): registr nálezů se zdrojem `monitoring`
   (počty `open`), mapa zón (jen pro jednu společnost), přehled certifikátů, souhrn SOC, přehled SCA a stav provozu.
2. Karta se zobrazí jen při zapnutém modulu a oprávnění ke čtení; prázdná oblast (žádná data) jde do „Zatím
   nevyplněné oblasti“ s nápovědou, co nastavit. Certifikáty a SCA se bez dat nezobrazují vůbec.
3. Bezpečnostní testy se zobrazují i v souhrnu skupiny – souhrnné API už sčítá všechny společnosti v rozsahu.
4. Provoz a zálohy jen pro `admin:settings` (stav instalace je společný pro všechny společnosti).

## Důsledky

- Přehled dělá víc dotazů (každá karta svůj, s cache 60 s); u velkých instalací je nejdražší souhrn nálezů – volá se
  s minimálním limitem položek, potřebné jsou jen počty.
- Nová technická oblast = karta v `Dashboard.tsx` + klíč v `TECH_AREAS`.
