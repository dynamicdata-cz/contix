# ADR-189: Test obnovy z aplikace, kontrola sítě sondy, pojistka spustitelnosti skriptů

Stav: **přijato** (v1.95.0) – navazuje na [ADR-188](ADR-188-podnety-pilotu.md).

## Kontext

Pilotní nasazení ukázala tři provozní slabiny: test obnovy vyžadoval příkaz na serveru, instalace sondy na Kali bez
DNS skončila jen obecnou chybou a skript `update.sh` dvakrát ztratil příznak spustitelnosti (`command not found`).

## Rozhodnutí

1. **Záloha s testem obnovy z Administrace → Provoz**: API zapíše požadavek do `app_settings` (`backup.request`);
   služba záloh ho ve smyčce každou minutu převezme smazáním (jen jednou) a spustí zálohu s vynuceným testem obnovy.
   API nepotřebuje přístup k Dockeru ani k souborům záloh. Nepřevzatý požadavek po 5 minutách = upozornění se
   zástupným ručním příkazem (starý kontejner, neběžící služba).
2. **Instalátor sondy kontroluje síť**: DNS server, překlad jména CONTIXu, TCP spojení na port, internet. Chybějící
   DNS server a IP CONTIXu doplní z parametrů `--dns`, `--contix-ip` nebo dotazem v terminálu; vypíše chybějící
   nástroje s příkazem `apt install`.
3. **Pojistka**: jednotkový test vyžaduje příznak spustitelnosti u `infra/scripts/*.sh` na disku i v gitu.

## Důsledky

- Bez migrace. Funkce 1 vyžaduje aktualizovaný kontejner `backup` (sestaví se při `update.sh`).
