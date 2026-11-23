# Bezpečnostní testy a sonda na Kali Linuxu

Modul **Bezpečnostní testy** (ADR-153) spouští základní testy z Kali Linuxu ve schváleném rozsahu
a ukládá nálezy s historií. Výstupy nástrojů spuštěných ručně lze nahrát.

## 1. Sonda

1. Administrace → Konektory → **Sondy bezpečnostních testů** → Vytvořit sondu (rozsah = společnost, nebo celá skupina).
2. **Stáhnout instalátor** (certifikát interní CA se doplní sám) a na Kali:

```bash
scp install-contix-probe.sh kali:
ssh -t kali sudo sh install-contix-probe.sh
```

Instalátor založí uživatele `contix-probe`, nainstaluje `/usr/local/sbin/contix-probe.py`, `/etc/contix-probe.env`
a službu `contix-probe.service`, vypíše dostupné nástroje, ověří spojení a smaže se (obsahuje token).

Nástroje (Kali je má, jinak `apt install`): `nmap`, `testssl.sh`, `ssh-audit`, `nikto`, `netexec`.

- Stav: `systemctl status contix-probe`, log: `journalctl -u contix-probe -f`.
- Ruční dotaz: `sudo -u contix-probe python3 /usr/local/sbin/contix-probe.py --once`.
- Odebrání: `sudo sh install-contix-probe.sh --uninstall`.
- **Kontrola sítě** (od 1.95): instalátor ověří DNS server, překlad jména CONTIXu, spojení na port CONTIXu
  a internet. Když sonda nemá DNS nebo nezná jméno CONTIXu, zeptá se (nebo použije parametry):
  `sudo sh install-contix-probe.sh --dns 10.0.0.1 --contix-ip 10.0.0.5` – DNS se zapíše do `/etc/resolv.conf`
  (u dhcpcd i do `/etc/resolv.conf.head`), CONTIX do `/etc/hosts`. Chybějící nástroje vypíše s příkazem `apt install`.

## 2. Rozsah

Bezpečnostní testy → **Rozsahy** → Nový rozsah: cíle, výjimky, platnost, podklad (objednávka, souhlas vlastníka).
Rozsah schvaluje uživatel s oprávněním *Schvalovat rozsah bezpečnostních testů*. Úprava schválení zruší.

## 3. Testy

Bezpečnostní testy → **Běhy a import** → *Spustit test sondou* (sonda si úlohu vyzvedne do minuty), nebo
*Importovat výstup nástroje*. Ukázkové příkazy pro ruční spuštění jsou v **Katalogu testů**.

| Test | Nástroj | Import |
|---|---|---|
| Otevřené porty, verze služeb, SMB | nmap | `-oX vystup.xml` |
| TLS | testssl.sh | `--jsonfile vystup.json` |
| SSH | ssh-audit | `-j > vystup.json` |
| Bezpečnostní hlavičky | sonda | – |
| Webový server | nikto | `-Format json -o vystup.json` |
| Anonymní sdílení, LDAP | netexec | textový výstup |

### Víc testů najednou

*Spustit test sondou* = **sada**: zaškrtněte testy nebo zvolte předvolbu, cíle napište nebo přidejte z aktiv.
- **Navazující testy podle nalezených služeb** – po průzkumu portů sonda sama otestuje SSH, TLS, web, SMB a LDAP tam, kde je našla.
- **AI automaticky po dokončení** – rozbor závažných nálezů, shrnutí každého testu a celé sady s doporučenými testy.

## 4. Nálezy a AI

Nález se dá rozkliknout, přijmout jako riziko, označit jako falešně pozitivní nebo opravený. **Vysvětlit AI**
(lokální model z Administrace → AI) doplní postup nápravy, ověření, navazující testy a související opatření;
u běhu **Shrnutí pro zprávu**. Do modelu nejde název ani IP adresa serveru.
