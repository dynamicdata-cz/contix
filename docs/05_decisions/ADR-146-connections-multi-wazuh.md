# ADR-146: Připojení – víc instancí Wazuhu, rozsah a schopnosti (v1.49)

## Kontext

Wazuh byl v instalaci jen jeden (jediný záznam v `app_settings`, čtený z 18 míst). Vazba agenta na aktivum
(`asset_sources`) byla jedinečná podle (typ, ID agenta) – ID agenta (001, 002…) je ale jedinečné jen v jednom
Wazuhu, druhý Wazuh by vazby prvního přepsal. Zákazníci potřebují tři situace: každá společnost svůj Wazuh,
jedna společnost s víc Wazuhy (kancelář a OT) a jeden Wazuh pro víc společností (MSSP / holding).

## Rozhodnutí

1. Tabulka `connections` (kind, name, enabled, companyId, config, secrets, groupMap, state) – obecná pro budoucí
   typy (NetBox, JIRA, sběrač ze serverů). Tajemství šifrovaně (AES-GCM, APP_SECRET), do UI se nevrací.
2. **Připojení → schopnosti → rozsah**: u Wazuhu inventář, zranitelnosti, SCA, alerty (úroveň, index, stav
   synchronizace v `state`) a Active Response (volitelný vlastní účet, jinak společný ze SOC → Reakce).
   Rozsah: `companyId` (vše patří společnosti, párování jen v ní), nebo celá skupina s `groupMap`
   (skupina agentů → společnost, první shoda shora; jinak společnost spuštění). `companyForAgent`,
   `connectionCovers` ve shared.
3. `asset_sources.connection_id` + jedinečnost (typ, ref, připojení) NULLS NOT DISTINCT; `discovery_runs` a
   `alert_suggestions` nesou připojení. Klíč skupiny alertu Wazuh = `<připojení>:<pravidlo>:<agent>`;
   threat intel u dalších připojení přidá připojení do klíče (primární zachová starší klíč).
4. Spotřebitelé: discovery (každé připojení zvlášť, plánovač podle intervalu připojení), zranitelnosti (mapa
   agentů jen daného připojení – „vyřešené“ se uzavírají jen u jeho aktiv), SCA, alerty (chyba jednoho Wazuhu
   nezastaví ostatní), hunting a IOC (všechna připojení pokrývající společnost, výsledky sečtené), threat intel
   (všechna), ladění pravidel (první připojení pokrývající společnost – výjimka patří do jednoho manageru),
   Active Response (připojení alertu, jinak první pokrývající společnost).
5. Převod: při startu API jednou (`connections.migrated`) – nastavení z `app_settings` (jinak z `.env`) a alertů
   → připojení „Wazuh“; existujícím vazbám agentů, během a alertům se doplní jeho id.
6. Starší rozhraní zůstávají a pracují s **primárním** (nejstarším) připojením: `/admin/connectors/wazuh`,
   `/alerts/settings`, `getWazuhConfig`. Nové: `/admin/connections` (CRUD, test, test indexeru),
   `POST /discovery/wazuh` s volitelným `connectionId`.

## Důsledky

Migrace 0106 (nová tabulka a sloupce, výměna jedinečného indexu). Smazání připojení zruší vazby agentů
(cascade), aktiva, zranitelnosti a alerty zůstávají. Další typy připojení se přidají jako nový `kind`
bez nové tabulky.
