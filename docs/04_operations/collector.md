# Sběrač ze serverů (contix-collect.py)

Skript pro linuxové servery, který do CONTIXu posílá inventář pro kontrolu přístupů a hygieny serveru (ADR-148).
**Jen čte**, nic na serveru nemění. Vyžaduje Python 3.6+ (standardní knihovna), spouští se jako root.

## Co posílá

| Oblast | Zdroj | Poznámka |
|---|---|---|
| Účty | /etc/passwd, /etc/group, /etc/shadow | jen účty s přihlašovacím shellem a UID 0; heslo se neposílá, jen příznak „zamčeno“ |
| SSH klíče | ~/.ssh/authorized_keys(2) každého účtu | otisk SHA256, typ, délka, komentář, omezení (`from=`, `command=`) – **nikdy celý klíč** |
| Kontejnery a image | `docker ps`, `docker inspect`, `docker image ls` | privilegovaný režim, uživatel, porty, compose projekt |
| Služby | `systemctl` | stav a zapnutí při startu |
| Porty | `ss -tulnp` | naslouchající adresy a procesy |
| Firewall | firewalld, ufw, nftables, iptables | otisk běžících a uložených pravidel, výchozí politika |
| SSH server (1.1) | `sshd -T` | PermitRootLogin, přihlášení heslem, prázdná hesla, porty, AllowUsers |
| Systém (1.1) | apt / dnf, /proc/uptime, reboot-required | čekající a bezpečnostní aktualizace (max. 50 balíčků), automatické aktualizace, restart, doba běhu |
| Poslední přihlášení (1.1) | `lastlog` | jen datum, u účtů s přihlašovacím shellem |

Detail serveru (nálezy s nápravou, účty s klíči, kontejnery, porty, služby, historie změn) je v
**Discovery & import → Servery ze sběrače → název serveru**.

## Instalace (instalátor, doporučeno)

1. Administrace → Konektory → **Sběrač ze serverů** → Vytvořit připojení (rozsah = společnost serverů).
2. U připojení **Instalátor**: zkontrolujte adresu, případně vyplňte IP adresu CONTIXu (servery bez DNS záznamu)
   a certifikát CA (u interní CA Caddy se načte sám) → **Stáhnout install-contix-collect.sh**.
3. Na server (jeden nebo víc):

```bash
scp install-contix-collect.sh server:
ssh -t server sudo sh install-contix-collect.sh
```

```bash
for h in server1 server2 server3; do scp install-contix-collect.sh $h: && ssh -t $h sudo sh install-contix-collect.sh; done
```

Instalátor ověří root a `python3`, doplní `/etc/hosts` (jen když se název nepřeloží), nainstaluje
`/usr/local/sbin/contix-collect.py`, `/etc/contix-ca.pem`, `/etc/contix-collect.env` (0600) a
`/etc/cron.d/contix-collect`, hned pošle první inventář a smaže se (obsahuje token). Smažte i svou staženou kopii.

- Aktualizace (nová verze sběrače, nový token): stáhnout instalátor znovu a spustit stejně.
- Odebrání: `sudo sh install-contix-collect.sh --uninstall`.
- Ponechat soubor po instalaci: `--keep`.

Připojení vytvořená před verzí 1.54 mají token uložen jen jako otisk – instalátor vyžaduje **Nový token**
(servery se starým tokenem pak přeinstalujte instalátorem).

## Ruční instalace

```bash
sudo install -m 0755 contix-collect.py /usr/local/sbin/contix-collect.py
sudo sh -c 'umask 077; printf "CONTIX_URL=https://contix.firma.cz\nCONTIX_TOKEN=ctxh_...\n" > /etc/contix-collect.env'
sudo /usr/local/sbin/contix-collect.py --dry-run | less
sudo /usr/local/sbin/contix-collect.py
echo '17 */6 * * * root /usr/local/sbin/contix-collect.py >/dev/null' | sudo tee /etc/cron.d/contix-collect
```

Vlastní certifikační autorita: `CONTIX_CA=/cesta/k/ca.pem` v `/etc/contix-collect.env`; kořenový certifikát
interní CA je na `https://<contix>/.well-known/contix-ca.pem`. Token je na připojení, ne na server.

## Uložená pravidla firewallu

- **iptables**: porovná `iptables-save` s `/etc/iptables/rules.v4` (Debian) nebo `/etc/sysconfig/iptables` (RHEL).
- **nftables**: uložená = existuje `/etc/nftables.conf` s tabulkami a služba `nftables` se spouští při startu.
- **ufw**: ukládá vždy; **firewalld**: porovná běžící a trvalou konfiguraci (`--permanent`).

Nesoulad se v CONTIXu ukáže jako „Pravidla firewallu nejsou uložena – po restartu se ztratí“.
