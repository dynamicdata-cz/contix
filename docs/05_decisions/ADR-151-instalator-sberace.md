# ADR-151: Instalátor sběrače ze serverů (v1.54)

## Kontext

Ruční instalace sběrače (ADR-148) měla na každém serveru šest kroků: zkopírovat skript a certifikát CA,
nainstalovat je, napsat `/etc/contix-collect.env` s tokenem, doplnit `/etc/hosts` (servery bez DNS záznamu
CONTIXu), spustit a nastavit cron. Při prvním nasazení (dva testovací servery) chyběl soubor, překlad
názvu a důvěra v interní CA – pokaždé jiný krok.

## Rozhodnutí

1. **Jeden soubor na připojení**: `POST /api/admin/connections/collector/:id/installer` (`admin:settings`)
   vrátí `install-contix-collect.sh` (POSIX sh) se sběračem (heredoc), adresou, tokenem, CA, IP pro
   `/etc/hosts` a intervalem. Skript ověří root a `python3`, záznam do `/etc/hosts` přidá jen když se název
   nepřeloží, cron s náhodnou minutou, hned spustí sběrač a po úspěchu se smaže (obsahuje token).
   Opakované spuštění = aktualizace; `--uninstall` odebere skript, konfiguraci, CA a cron; `--keep` soubor ponechá.
2. **Token šifrovaně**: při založení a novém tokenu se kromě otisku (ověřování) ukládá token šifrovaný
   `APP_SECRET` v `connections.secrets.token` – jen kvůli instalátoru. Tokeny z doby před v1.54 mají jen otisk,
   instalátor pak vrátí 409 a UI nabídne nový token. Stažení instalátoru se audituje
   (`connection.installer_downloaded`).
3. **CA automaticky**: v režimu TLS `internal` Caddy vydává kořenový certifikát své CA na
   `/.well-known/contix-ca.pem` (veřejný údaj). UI ho načte a předvyplní; u vlastní CA zákazníka se vloží ručně,
   u veřejného certifikátu zůstane prázdné. IP adresa a CA se u připojení zapamatují.

## Důsledky

- Nasazení na server: `scp` + `ssh -t server sudo sh install-contix-collect.sh`; pro víc serverů smyčka.
- Token jde z CONTIXu znovu získat (správce s `admin:settings`) – stejná úroveň jako ostatní tajemství připojení.
- Hromadné nasazení (Ansible) může instalátor použít jako jediný soubor.
