# ADR-190: Nálezy monitoringu (Wazuh) a report počítačů z AD

Stav: **přijato** (v1.96.0) – navazuje na [ADR-185](ADR-185-ad-pocitace.md) a [ADR-187](ADR-187-wazuh-agenti-v-mape.md).

## Kontext

Mapa propojení ukazuje odpojené a zastaralé agenty Wazuhu, ale nikdo za ně neodpovídá a nemají termín. Počítače
z AD měly jen tabulku a export; vedení a správci potřebují report k rozhodnutí (servery bez podpory, bez sběru dat,
neaktivní počítače).

## Rozhodnutí

1. **Nový zdroj registru nálezů „Monitoring (Wazuh)“** (`monitoring_findings`): agent bez spojení déle než
   `WAZUH_STALE_DAYS` (server = vysoká, jinak střední) a agent se starší verzí než manager (nízká). Klíč předmětu
   `<připojení>:<id agenta>`, vazba na aktivum a společnost aktiva.
2. **Životní cyklus**: přepočet po každé synchronizaci Wazuhu a v plánovači (doba bez spojení roste i bez
   synchronizace). Pominulá příčina → opraveno (zavřou se i úkoly), znovu vzniklá → otevřeno; výjimka s důvodem a
   termínem, po termínu se nález znovu otevře. Vypnuté / smazané připojení → nálezy opravené.
3. Úkoly z nálezů jako u zranitelností (garant aktiva, termín podle závažnosti), lhůty a metriky nápravy jako ostatní
   zdroje. Do AI plánu oprav jde jen druh nálezu a pseudonym serveru (bez jména a IP).
4. **Report „Počítače a servery z AD“** (Word / tisk, i v měsíčním rozesílání): stav, systém bez podpory výrobce
   (s kolonkou rozhodnutí), aktivní servery bez sběru dat, neaktivní počítače podle OU, počítače bez LAPS nebo
   s neomezenou delegací, podpis.

## Důsledky

- Migrace `0132_monitoring_findings`. Oprávnění: čtení `assets:read` + modul discovery, výjimka `assets:write`.
