# ADR-180: Hardening serveru a kontejnery z agenta (v1.85)

Stav: **přijato** – navazuje na [ADR-177](ADR-177-agenti-a-koncentratory.md) a [ADR-148](ADR-148-server-collector.md).

## Kontext

Agent 0.2 posílal porty, služby, balíčky, účty, SSH klíče, firewall a plánované úlohy. Kontejnery, aktualizace a nastavení
SSH uměl jen sběrač (skript), a ani jeden nedával ucelený obraz o zabezpečení serveru (hardening). Správci chtějí vidět
kontejnery s jejich bezpečnostním nastavením a stav hardeningu podle CIS Benchmark / NÚKIB.

## Rozhodnutí

1. **Agent jen sbírá hodnoty, CONTIX vyhodnocuje.** Nové moduly agenta 0.3: `containers`, `images`, `engine` (API Dockeru /
   Podmanu přes lokální soket, jen metoda GET), `system` (aktualizace z lokální cache správce balíčků nejvýš jednou za
   hodinu, restart), `sshd` (vybraná nastavení z `sshd -T`) a `hardening` (fakta klíč → hodnota: sysctl, volby připojení
   z `/proc/1/mountinfo`, práva souborů, AppArmor / SELinux, login.defs, pwquality, PAM, sudoers, coredump, modprobe,
   GRUB, journald, rsyslog, auditd, banner). Prahové hodnoty a texty jsou v katalogu `HARDENING_CHECKS`
   (`packages/shared/src/hardening.ts`) – zpřesnění kontroly nevyžaduje novou verzi agenta.
2. **Žádná tajemství**: z kontejnerů se neposílají proměnné prostředí, příkazy ani štítky (kromě projektu a služby compose),
   z hardeningu jen hodnoty nastavení, práva a jména (účty bez hesla, subjekty pravidel sudo bez hesla) – nikdy obsah
   souborů, hashe hesel ani heslo zavaděče.
3. **Vyhodnocení** `evaluateHardening(inv)` je čistá funkce (API, web, testy): výsledek pass / fail / na, vážené skóre
   (vysoká 3, střední 2, nízká 1) jen z ověřitelných kontrol. Kontrola bez faktu (starší agent, server bez Dockeru) je „na“.
4. **Nálezy**: nesplněné kontroly vysoké a střední závažnosti → nález `hardening` s id kontroly jako předmětem (životní cyklus,
   úkoly, přijetí rizika jako ostatní nálezy serveru). Kontroly označené `dup` se do nálezů nepřidávají, protože je hlásí
   samostatný nález (`fw_none`, `sshd_password_auth`, `updates_security`…). Nové nálezy kontejnerů a enginu jsou
   samostatné kódy (`container_engine_socket`, `container_host_namespace`, `container_capabilities`, `container_unconfined`,
   `container_sensitive_mount`, `engine_tcp_socket`, `engine_group`).
5. Popisky nálezů jen přes `hostFindingLabel` / `hostFindingGuide` / `hostFindingSubject` (u hardeningu z katalogu).

## Důsledky

- Inventář (`HostInventoryInput`) má nové volitelné části `engine` a `hardening` a podrobnosti kontejnerů; starší sběrač
  a agent fungují beze změny (pole mají výchozí hodnoty).
- Nová kontrola = položka v `HARDENING_CHECKS` (česky i anglicky, odkaz na CIS / vyhlášku) a případně nový fakt v agentovi.
