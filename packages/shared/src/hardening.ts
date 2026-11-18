import type { HostInventory } from "./hostInventory";

/* ============================================================
 * Hardening serveru (v1.85, ADR-180): agent posílá jen zjištěné hodnoty (`inv.hardening`, `sshd.*`, služby, firewall,
 * aktualizace, kontejnerový engine), vyhodnocení je zde – čistá funkce, stejná v API, webu i testech.
 * Kontroly vycházejí z CIS Benchmark (Ubuntu / RHEL, Level 1 Server, Docker) a požadavků vyhlášky 409/2025
 * (bezpečnost technických aktiv, řízení přístupu, zaznamenávání, zranitelnosti). Texty česky a anglicky.
 * ============================================================ */

export const HARDENING_CATEGORIES = ["ssh", "accounts", "network", "kernel", "filesystem", "services", "logging", "updates", "mac", "boot", "containers"] as const;
export type HardeningCategory = (typeof HARDENING_CATEGORIES)[number];

export const HARDENING_CATEGORY_LABELS: Record<HardeningCategory, { cs: string; en: string }> = {
  ssh: { cs: "SSH server", en: "SSH server" },
  accounts: { cs: "Účty a hesla", en: "Accounts and passwords" },
  network: { cs: "Síť a firewall", en: "Network and firewall" },
  kernel: { cs: "Jádro", en: "Kernel" },
  filesystem: { cs: "Souborový systém", en: "File system" },
  services: { cs: "Služby", en: "Services" },
  logging: { cs: "Záznamy a audit", en: "Logging and audit" },
  updates: { cs: "Aktualizace", en: "Updates" },
  mac: { cs: "AppArmor / SELinux", en: "AppArmor / SELinux" },
  boot: { cs: "Zavaděč a moduly jádra", en: "Boot loader and kernel modules" },
  containers: { cs: "Kontejnery", en: "Containers" },
};

export type HardeningSeverity = "high" | "medium" | "low";
export type HardeningStatus = "pass" | "fail" | "na";

interface Ctx {
  /** Hodnota faktu agenta (undefined = neznámo). */
  f: (key: string) => string | undefined;
  inv: HostInventory;
}
interface Outcome {
  s: HardeningStatus;
  /** Zjištěná hodnota pro zobrazení. */
  a?: string;
}

interface Text {
  cs: string;
  en: string;
}
export interface HardeningCheck {
  id: string;
  cat: HardeningCategory;
  sev: HardeningSeverity;
  title: Text;
  /** Očekávaný stav (krátce). */
  expect: Text;
  why: Text;
  fix: Text;
  /** Odkaz na doporučení (CIS kapitola, vyhláška). */
  ref: string;
  /** Nález už hlásí jiná kontrola serveru (evaluateHost) – v nálezech se neopakuje. */
  dup?: boolean;
  /** Požadavky rámců, ke kterým je kontrola důkazem (ID požadavku CONTIXu, v1.87 – ADR-182). */
  reqs?: string[];
  run: (c: Ctx) => Outcome;
}

/* ---------- pomocné funkce ---------- */

const NA: Outcome = { s: "na" };
const ok = (pass: boolean, a?: string): Outcome => ({ s: pass ? "pass" : "fail", a });
const num = (v: string | undefined) => (v == null || v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
/** Fakt jako číslo, porovnání; chybějící fakt = nelze ověřit. */
const sysctl = (c: Ctx, key: string, test: (n: number) => boolean): Outcome => {
  const v = c.f(`sysctl.${key}`);
  const n = num(v);
  return n == null ? NA : ok(test(n), v);
};
const sysctls = (c: Ctx, keys: string[], test: (n: number) => boolean): Outcome => {
  const vals = keys.map((k) => [k, c.f(`sysctl.${k}`)] as const).filter(([, v]) => v != null);
  if (!vals.length) return NA;
  const bad = vals.filter(([, v]) => num(v) == null || !test(num(v)!));
  return ok(!bad.length, bad.length ? bad.map(([k, v]) => `${k}=${v}`).join(", ") : vals.map(([, v]) => v).join(" / "));
};
/** sshd -T: hodnota nastavení (malá písmena). */
const ssh = (c: Ctx, key: string) => c.f(`sshd.${key}`)?.toLowerCase();
const sshEq = (c: Ctx, key: string, want: string[]): Outcome => {
  const v = ssh(c, key);
  return v == null ? NA : ok(want.includes(v), v);
};
/** Práva souboru „0640 0:42“ – režim nanejvýš `max`, vlastník root. */
const perm = (c: Ctx, path: string, max: number): Outcome | null => {
  const v = c.f(`perm.${path}`);
  if (!v) return null;
  const [m, own] = v.split(" ");
  const mode = parseInt(m ?? "", 8);
  const uid = (own ?? "").split(":")[0];
  if (Number.isNaN(mode)) return NA;
  return ok((mode & ~max) === 0 && (uid === "0" || uid === "-1"), v);
};
const perms = (c: Ctx, items: [string, number][]): Outcome => {
  const res = items.map(([p, m]) => [p, perm(c, p, m)] as const).filter(([, r]) => r);
  if (!res.length) return NA;
  const bad = res.filter(([, r]) => r!.s === "fail");
  return ok(!bad.length, (bad.length ? bad : res).map(([p, r]) => `${p} ${r!.a}`).join(", "));
};
/** Volby připojení – `-` = není samostatný oddíl. */
const mountHas = (c: Ctx, mp: string, want: string[], needSeparate: boolean): Outcome => {
  const v = c.f(`mount.${mp}`);
  if (v == null) return NA;
  if (v === "-") return needSeparate ? ok(false, "–") : NA;
  const opts = v.split(",");
  const miss = want.filter((w) => !opts.includes(w));
  return ok(!miss.length, miss.length ? `chybí ${miss.join(", ")}` : v);
};
const svcActive = (inv: HostInventory, names: string[]) =>
  inv.services.filter((s) => names.some((n) => s.name === `${n}.service` || s.name === n) && (s.state === "running" || s.state === "active")).map((s) => s.name.replace(/\.service$/, ""));
const hasServices = (inv: HostInventory) => inv.services.length > 0;
const words = (v: string | undefined) => (v ?? "").split(/[\s,]+/).filter(Boolean);
const engineOf = (c: Ctx) => c.inv.engine;
const runningContainers = (c: Ctx) => c.inv.containers.filter((x) => (x.state ?? x.status).toLowerCase().startsWith("running") || /^up\b/i.test(x.status));

/** Kontejner připojuje soket kontejnerového enginu (= root na hostiteli). */
export const mountsEngineSocket = (m: { source: string; destination: string }) => /(^|\/)(docker|podman|containerd)\.sock$/.test(m.source) || /(^|\/)(docker|podman)\.sock$/.test(m.destination);
/** Citlivé cesty hostitele připojené do kontejneru. */
export const SENSITIVE_HOST_PATHS = ["/", "/etc", "/root", "/boot", "/proc", "/sys", "/dev", "/var/run", "/run", "/var/lib/docker", "/usr", "/lib", "/home"];
/** Nebezpečná oprávnění jádra (cap_add). */
export const DANGEROUS_CAPS = ["ALL", "SYS_ADMIN", "SYS_MODULE", "SYS_PTRACE", "SYS_RAWIO", "DAC_READ_SEARCH", "NET_ADMIN", "SYS_BOOT", "MAC_ADMIN", "BPF"];
export const capName = (c: string) => c.toUpperCase().replace(/^CAP_/, "");

const RISKY_SERVICES = ["telnet", "telnetd", "inetd", "xinetd", "rsh", "rlogin", "rexec", "avahi-daemon", "cups", "cups-browsed", "rpcbind", "nfs-server", "nfs-kernel-server", "snmpd", "vsftpd", "proftpd", "pure-ftpd", "tftpd-hpa", "tftp", "atftpd", "ypserv", "ypbind", "isc-dhcp-server", "talk", "ntalk"];
const SECURITY_AGENTS = ["wazuh-agent", "ossec", "falcon-sensor", "mdatp", "sentinelone", "SentinelAgent", "cbagentd", "elastic-agent", "osqueryd", "auditbeat", "crowdstrike"];
const TIME_SERVICES = ["chrony", "chronyd", "systemd-timesyncd", "ntp", "ntpd", "ntpsec", "openntpd"];

const t = (cs: string, en: string): Text => ({ cs, en });

/* ---------- katalog ---------- */

export const HARDENING_CHECKS: HardeningCheck[] = [
  /* ===== SSH ===== */
  {
    id: "ssh.root_login", cat: "ssh", sev: "medium", ref: "CIS 5.2.7", dup: false,
    title: t("Přihlášení roota přes SSH je zakázané", "Root login over SSH is disabled"),
    expect: t("PermitRootLogin no", "PermitRootLogin no"),
    why: t("Přímé přihlášení roota nejde přiřadit konkrétní osobě a root je hlavním cílem útoků hrubou silou.", "A direct root login cannot be attributed to a person and root is the main target of brute-force attacks."),
    fix: t("V /etc/ssh/sshd_config nastavte PermitRootLogin no a spusťte systemctl reload ssh.", "Set PermitRootLogin no in /etc/ssh/sshd_config and run systemctl reload ssh."),
    run: (c) => sshEq(c, "permitrootlogin", ["no"]),
  },
  {
    id: "ssh.password_auth", cat: "ssh", sev: "medium", ref: "CIS 5.2.x, vyhl. 409 – řízení přístupu", dup: true,
    title: t("Přihlášení heslem přes SSH je vypnuté", "SSH password authentication is disabled"),
    expect: t("PasswordAuthentication no", "PasswordAuthentication no"),
    why: t("Hesla jdou uhodnout nebo odchytit, klíče jsou výrazně odolnější.", "Passwords can be guessed or intercepted; keys are far more resistant."),
    fix: t("Po nasazení klíčů nastavte PasswordAuthentication no a KbdInteractiveAuthentication no.", "After deploying keys, set PasswordAuthentication no and KbdInteractiveAuthentication no."),
    run: (c) => sshEq(c, "passwordauthentication", ["no"]),
  },
  {
    id: "ssh.empty_passwords", cat: "ssh", sev: "high", ref: "CIS 5.2.9", dup: true,
    title: t("SSH nepovoluje prázdná hesla", "SSH does not allow empty passwords"),
    expect: t("PermitEmptyPasswords no", "PermitEmptyPasswords no"),
    why: t("Účet bez hesla by se přihlásil bez ověření.", "An account without a password would log in without authentication."),
    fix: t("Nastavte PermitEmptyPasswords no.", "Set PermitEmptyPasswords no."),
    run: (c) => sshEq(c, "permitemptypasswords", ["no"]),
  },
  {
    id: "ssh.max_auth_tries", cat: "ssh", sev: "low", ref: "CIS 5.2.18",
    title: t("Omezený počet pokusů o přihlášení", "Limited login attempts"),
    expect: t("MaxAuthTries 4 nebo méně", "MaxAuthTries 4 or less"),
    why: t("Méně pokusů na spojení zpomalí hádání hesel a klíčů.", "Fewer attempts per connection slow down guessing of passwords and keys."),
    fix: t("Nastavte MaxAuthTries 4.", "Set MaxAuthTries 4."),
    run: (c) => {
      const n = num(ssh(c, "maxauthtries"));
      return n == null ? NA : ok(n <= 4, String(n));
    },
  },
  {
    id: "ssh.weak_ciphers", cat: "ssh", sev: "medium", ref: "CIS 5.2.13, NÚKIB – kryptografické prostředky",
    title: t("SSH nepoužívá slabé šifry", "SSH uses no weak ciphers"),
    expect: t("bez CBC, 3DES, RC4 (arcfour), Blowfish", "no CBC, 3DES, RC4 (arcfour), Blowfish"),
    why: t("Šifry v režimu CBC a zastaralé algoritmy nesplňují minimální požadavky NÚKIB na kryptografii.", "CBC-mode and legacy ciphers do not meet NÚKIB minimum cryptographic requirements."),
    fix: t("Nastavte např. Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes128-ctr.", "Set e.g. Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes128-ctr."),
    run: (c) => {
      const v = ssh(c, "ciphers");
      if (v == null) return NA;
      const bad = words(v).filter((x) => /cbc|3des|arcfour|blowfish|cast128/.test(x));
      return ok(!bad.length, bad.length ? bad.join(", ") : `${words(v).length} šifer`);
    },
  },
  {
    id: "ssh.weak_macs", cat: "ssh", sev: "medium", ref: "CIS 5.2.14",
    title: t("SSH nepoužívá slabé MAC", "SSH uses no weak MACs"),
    expect: t("bez MD5, SHA-1, UMAC-64", "no MD5, SHA-1, UMAC-64"),
    why: t("Kontrolní součty MD5 a SHA-1 jsou zastaralé.", "MD5 and SHA-1 message authentication codes are deprecated."),
    fix: t("Nastavte např. MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com.", "Set e.g. MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com."),
    run: (c) => {
      const v = ssh(c, "macs");
      if (v == null) return NA;
      const bad = words(v).filter((x) => /md5|sha1(?![0-9])|-sha1-|umac-64|ripemd/.test(x) || /hmac-sha1/.test(x));
      return ok(!bad.length, bad.length ? bad.join(", ") : `${words(v).length} MAC`);
    },
  },
  {
    id: "ssh.weak_kex", cat: "ssh", sev: "medium", ref: "CIS 5.2.15",
    title: t("SSH nepoužívá slabou výměnu klíčů", "SSH uses no weak key exchange"),
    expect: t("bez diffie-hellman-group1 / group14-sha1 / group-exchange-sha1", "no diffie-hellman-group1 / group14-sha1 / group-exchange-sha1"),
    why: t("Výměna klíčů s SHA-1 nebo 1024bitovou skupinou je prolomitelná.", "Key exchange with SHA-1 or a 1024-bit group is breakable."),
    fix: t("Nastavte např. KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512.", "Set e.g. KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512."),
    run: (c) => {
      const v = ssh(c, "kexalgorithms");
      if (v == null) return NA;
      const bad = words(v).filter((x) => /group1-|group14-sha1|group-exchange-sha1/.test(x));
      return ok(!bad.length, bad.length ? bad.join(", ") : `${words(v).length} algoritmů`);
    },
  },
  {
    id: "ssh.idle_timeout", cat: "ssh", sev: "low", ref: "CIS 5.2.21",
    title: t("Nečinné SSH relace se ukončují", "Idle SSH sessions are terminated"),
    expect: t("ClientAliveInterval 1–900 s, ClientAliveCountMax ≤ 3", "ClientAliveInterval 1–900 s, ClientAliveCountMax ≤ 3"),
    why: t("Opuštěná otevřená relace je přístupná komukoli u počítače správce.", "An abandoned open session is available to anyone at the administrator's computer."),
    fix: t("Nastavte ClientAliveInterval 300 a ClientAliveCountMax 3.", "Set ClientAliveInterval 300 and ClientAliveCountMax 3."),
    run: (c) => {
      const i = num(ssh(c, "clientaliveinterval"));
      const m = num(ssh(c, "clientalivecountmax"));
      if (i == null) return NA;
      return ok(i > 0 && i <= 900 && (m == null || m <= 3), `${i} s × ${m ?? "?"}`);
    },
  },
  {
    id: "ssh.login_grace", cat: "ssh", sev: "low", ref: "CIS 5.2.20",
    title: t("Krátký čas na přihlášení", "Short login grace time"),
    expect: t("LoginGraceTime 60 s nebo méně", "LoginGraceTime 60 s or less"),
    why: t("Dlouhý čas na přihlášení usnadňuje vyčerpání spojení.", "A long grace time makes connection exhaustion easier."),
    fix: t("Nastavte LoginGraceTime 60.", "Set LoginGraceTime 60."),
    run: (c) => {
      const n = num(ssh(c, "logingracetime"));
      return n == null ? NA : ok(n > 0 && n <= 60, `${n} s`);
    },
  },
  {
    id: "ssh.forwarding", cat: "ssh", sev: "low", ref: "CIS 5.2.17, 5.2.6",
    title: t("Přesměrování X11 a TCP přes SSH je vypnuté", "X11 and TCP forwarding over SSH is disabled"),
    expect: t("X11Forwarding no, AllowTcpForwarding no", "X11Forwarding no, AllowTcpForwarding no"),
    why: t("Přesměrování umožní obejít firewall a tunelovat provoz do vnitřní sítě.", "Forwarding allows bypassing the firewall and tunnelling traffic into the internal network."),
    fix: t("Nastavte X11Forwarding no a AllowTcpForwarding no (nebo DisableForwarding yes), pokud tunely nepotřebujete.", "Set X11Forwarding no and AllowTcpForwarding no (or DisableForwarding yes) unless tunnels are needed."),
    run: (c) => {
      const x = ssh(c, "x11forwarding");
      const tcp = ssh(c, "allowtcpforwarding");
      if (x == null && tcp == null) return NA;
      if (ssh(c, "disableforwarding") === "yes") return ok(true, "DisableForwarding yes");
      return ok(x !== "yes" && (tcp == null || tcp === "no"), `X11 ${x ?? "?"}, TCP ${tcp ?? "?"}`);
    },
  },
  {
    id: "ssh.hostbased", cat: "ssh", sev: "low", ref: "CIS 5.2.8, 5.2.10",
    title: t("Bez ověření podle hostitele a uživatelského prostředí", "No host-based authentication or user environment"),
    expect: t("HostbasedAuthentication no, IgnoreRhosts yes, PermitUserEnvironment no", "HostbasedAuthentication no, IgnoreRhosts yes, PermitUserEnvironment no"),
    why: t("Ověření podle hostitele a .rhosts je zastaralé; vlastní prostředí uživatele obchází omezení.", "Host-based and .rhosts authentication is obsolete; user environments bypass restrictions."),
    fix: t("Nastavte HostbasedAuthentication no, IgnoreRhosts yes a PermitUserEnvironment no.", "Set HostbasedAuthentication no, IgnoreRhosts yes and PermitUserEnvironment no."),
    run: (c) => {
      const h = ssh(c, "hostbasedauthentication");
      if (h == null) return NA;
      const ir = ssh(c, "ignorerhosts");
      const pe = ssh(c, "permituserenvironment");
      return ok(h === "no" && ir !== "no" && (pe == null || pe === "no"), `hostbased ${h}, rhosts ${ir ?? "?"}, env ${pe ?? "?"}`);
    },
  },
  {
    id: "ssh.access_list", cat: "ssh", sev: "low", ref: "CIS 5.2.4",
    title: t("Přístup přes SSH je omezen na vybrané účty", "SSH access is limited to selected accounts"),
    expect: t("AllowUsers nebo AllowGroups", "AllowUsers or AllowGroups"),
    why: t("Bez seznamu se přes SSH může přihlásit i servisní nebo zapomenutý účet.", "Without a list, service or forgotten accounts can also log in over SSH."),
    fix: t("Nastavte AllowGroups ssh-users (a správce do skupiny přidejte) nebo AllowUsers.", "Set AllowGroups ssh-users (and add administrators to the group) or AllowUsers."),
    run: (c) => {
      if (ssh(c, "permitrootlogin") == null) return NA;
      const v = [ssh(c, "allowusers"), ssh(c, "allowgroups")].filter((x) => x && x !== "none").join(" ");
      return ok(!!v, v || "–");
    },
  },
  {
    id: "ssh.log_level", cat: "ssh", sev: "low", ref: "CIS 5.2.5",
    title: t("SSH zaznamenává přihlášení", "SSH logs logins"),
    expect: t("LogLevel INFO nebo VERBOSE", "LogLevel INFO or VERBOSE"),
    why: t("Bez záznamů nejde dohledat, kdo se přihlásil (vyhláška 409 – zaznamenávání událostí).", "Without logs it is impossible to trace who logged in."),
    fix: t("Nastavte LogLevel VERBOSE (zaznamená i otisk použitého klíče).", "Set LogLevel VERBOSE (also logs the fingerprint of the key used)."),
    run: (c) => sshEq(c, "loglevel", ["info", "verbose"]),
  },

  /* ===== účty ===== */
  {
    id: "acc.empty_password", cat: "accounts", sev: "high", ref: "CIS 6.2.1",
    title: t("Žádný účet nemá prázdné heslo", "No account has an empty password"),
    expect: t("všechny účty mají heslo nebo jsou zamčené", "all accounts have a password or are locked"),
    why: t("Účet s prázdným heslem se přihlásí bez ověření (konzole, su, služby bez SSH).", "An account with an empty password logs in without authentication."),
    fix: t("Zamkněte účet (passwd -l <účet>) nebo mu nastavte heslo.", "Lock the account (passwd -l <account>) or set a password."),
    run: (c) => {
      const v = c.f("accounts.emptyPassword");
      return v == null ? NA : ok(v === "", v || "–");
    },
  },
  {
    id: "acc.uid0", cat: "accounts", sev: "high", ref: "CIS 6.2.10", dup: true,
    title: t("UID 0 má jen root", "Only root has UID 0"),
    expect: t("jediný účet s UID 0 je root", "root is the only UID 0 account"),
    why: t("Další účet s UID 0 má práva roota pod jiným jménem.", "Another UID 0 account has root privileges under another name."),
    fix: t("Odeberte účet nebo mu přidělte jiné UID.", "Remove the account or give it another UID."),
    run: (c) => {
      if (!c.inv.users.length) return NA;
      const other = c.inv.users.filter((u) => u.uid === 0 && u.name !== "root").map((u) => u.name);
      return ok(!other.length, other.join(", ") || "root");
    },
  },
  {
    id: "acc.sudo_nopasswd", cat: "accounts", sev: "medium", ref: "CIS 5.3.4",
    title: t("Sudo vyžaduje heslo", "Sudo requires a password"),
    expect: t("žádné pravidlo NOPASSWD", "no NOPASSWD rules"),
    why: t("Sudo bez hesla znamená, že kdo získá relaci nebo klíč uživatele, je hned root.", "Passwordless sudo means whoever obtains a user's session or key is immediately root."),
    fix: t("Odstraňte NOPASSWD z /etc/sudoers a /etc/sudoers.d (visudo); pro automatizaci povolte jen konkrétní příkazy.", "Remove NOPASSWD from /etc/sudoers and /etc/sudoers.d (visudo); for automation allow only specific commands."),
    run: (c) => {
      const v = c.f("sudo.nopasswd");
      return v == null ? NA : ok(v === "", v || "–");
    },
  },
  {
    id: "acc.password_policy", cat: "accounts", sev: "medium", ref: "CIS 5.4.1, vyhl. 409 – autentizace",
    title: t("Politika kvality hesel", "Password quality policy"),
    expect: t("pam_pwquality s minlen ≥ 14", "pam_pwquality with minlen ≥ 14"),
    why: t("Bez kontroly kvality si uživatelé volí krátká a slovníková hesla.", "Without quality checks users choose short dictionary passwords."),
    fix: t("apt install libpam-pwquality a v /etc/security/pwquality.conf nastavte minlen = 14 (a minclass = 3).", "apt install libpam-pwquality and set minlen = 14 (and minclass = 3) in /etc/security/pwquality.conf."),
    run: (c) => {
      const pq = c.f("pam.pwquality");
      if (pq == null) return NA;
      const min = num(c.f("pwquality.minlen"));
      return ok(pq === "true" && min != null && min >= 14, `pwquality ${pq === "true" ? "ano" : "ne"}, minlen ${min ?? "–"}`);
    },
  },
  {
    id: "acc.lockout", cat: "accounts", sev: "medium", ref: "CIS 5.4.2",
    title: t("Zamčení účtu po neúspěšných pokusech", "Account lockout after failed attempts"),
    expect: t("pam_faillock", "pam_faillock"),
    why: t("Bez zamčení lze heslo zkoušet neomezeně.", "Without lockout passwords can be tried indefinitely."),
    fix: t("Zapněte pam_faillock (Ubuntu: pam-auth-update, RHEL: authselect enable-feature with-faillock), deny = 5, unlock_time = 900.", "Enable pam_faillock (Ubuntu: pam-auth-update, RHEL: authselect enable-feature with-faillock), deny = 5, unlock_time = 900."),
    run: (c) => {
      const v = c.f("pam.lockout");
      return v == null ? NA : ok(v !== "none", v);
    },
  },
  {
    id: "acc.password_age", cat: "accounts", sev: "low", ref: "CIS 5.5.1",
    title: t("Nastavená platnost hesel", "Password ageing configured"),
    expect: t("PASS_MAX_DAYS ≤ 365, PASS_MIN_DAYS ≥ 1, PASS_WARN_AGE ≥ 7", "PASS_MAX_DAYS ≤ 365, PASS_MIN_DAYS ≥ 1, PASS_WARN_AGE ≥ 7"),
    why: t("Heslo bez omezení platnosti zůstane platné i po úniku.", "A password without an expiry stays valid even after a leak."),
    fix: t("V /etc/login.defs nastavte PASS_MAX_DAYS 365, PASS_MIN_DAYS 1, PASS_WARN_AGE 7 (stávajícím účtům chage).", "Set PASS_MAX_DAYS 365, PASS_MIN_DAYS 1, PASS_WARN_AGE 7 in /etc/login.defs (chage for existing accounts)."),
    run: (c) => {
      const max = num(c.f("logindefs.PASS_MAX_DAYS"));
      if (max == null) return NA;
      const min = num(c.f("logindefs.PASS_MIN_DAYS")) ?? 0;
      const warn = num(c.f("logindefs.PASS_WARN_AGE")) ?? 0;
      return ok(max <= 365 && min >= 1 && warn >= 7, `${max} / ${min} / ${warn}`);
    },
  },
  {
    id: "acc.hash", cat: "accounts", sev: "medium", ref: "CIS 5.4.4",
    title: t("Silný hash hesel", "Strong password hashing"),
    expect: t("ENCRYPT_METHOD SHA512 nebo YESCRYPT", "ENCRYPT_METHOD SHA512 or YESCRYPT"),
    why: t("Slabý hash (MD5, DES) se po úniku /etc/shadow rychle prolomí.", "Weak hashes (MD5, DES) are cracked quickly after /etc/shadow leaks."),
    fix: t("V /etc/login.defs nastavte ENCRYPT_METHOD YESCRYPT (nebo SHA512) a hesla nechte změnit.", "Set ENCRYPT_METHOD YESCRYPT (or SHA512) in /etc/login.defs and have passwords changed."),
    run: (c) => {
      const v = c.f("logindefs.ENCRYPT_METHOD");
      return v == null ? NA : ok(/^(SHA512|YESCRYPT|GOST_YESCRYPT)$/i.test(v), v);
    },
  },
  {
    id: "acc.umask", cat: "accounts", sev: "low", ref: "CIS 5.5.4",
    title: t("Výchozí práva nových souborů", "Default permissions of new files"),
    expect: t("UMASK 027 nebo přísnější", "UMASK 027 or stricter"),
    why: t("UMASK 022 dělá nové soubory čitelné všemi uživateli serveru.", "UMASK 022 makes new files readable by all users of the server."),
    fix: t("V /etc/login.defs nastavte UMASK 027.", "Set UMASK 027 in /etc/login.defs."),
    run: (c) => {
      const v = c.f("logindefs.UMASK");
      if (v == null) return NA;
      const m = parseInt(v, 8);
      return Number.isNaN(m) ? NA : ok((m & 0o027) === 0o027, v);
    },
  },

  /* ===== síť a firewall ===== */
  {
    id: "net.firewall", cat: "network", sev: "high", ref: "CIS 3.5, vyhl. 409 – bezpečnost komunikační sítě", dup: true,
    title: t("Firewall je zapnutý s výchozím zákazem", "Firewall is on with default deny"),
    expect: t("nftables / iptables, výchozí politika DROP", "nftables / iptables, default policy DROP"),
    why: t("Bez firewallu jsou dostupné všechny naslouchající služby.", "Without a firewall every listening service is reachable."),
    fix: t("ufw default deny incoming && ufw allow 22/tcp && ufw enable (nebo firewalld).", "ufw default deny incoming && ufw allow 22/tcp && ufw enable (or firewalld)."),
    run: (c) => {
      const fw = c.inv.firewall;
      if (fw.tool === "none") return ok(false, "–");
      return ok(fw.defaultInput === "drop" || fw.defaultInput === "reject", `${fw.tool}, ${fw.defaultInput ?? "?"}`);
    },
  },
  {
    id: "net.ip_forward", cat: "network", sev: "medium", ref: "CIS 3.2.1",
    title: t("Server nesměruje pakety", "Server does not route packets"),
    expect: t("net.ipv4.ip_forward = 0 (kromě směrovačů a hostitelů kontejnerů)", "net.ipv4.ip_forward = 0 (except routers and container hosts)"),
    why: t("Zapnuté směrování z napadeného serveru udělá most mezi sítěmi.", "Routing turns a compromised server into a bridge between networks."),
    fix: t("Nastavte net.ipv4.ip_forward = 0 v /etc/sysctl.d/60-cis.conf a sysctl --system.", "Set net.ipv4.ip_forward = 0 in /etc/sysctl.d/60-cis.conf and run sysctl --system."),
    run: (c) => (engineOf(c) || c.inv.containers.length ? NA : sysctls(c, ["net.ipv4.ip_forward", "net.ipv6.conf.all.forwarding"], (n) => n === 0)),
  },
  {
    id: "net.redirects", cat: "network", sev: "medium", ref: "CIS 3.3.2, 3.2.2",
    title: t("ICMP přesměrování se nepřijímají ani neposílají", "ICMP redirects are neither accepted nor sent"),
    expect: t("accept_redirects = 0, secure_redirects = 0, send_redirects = 0", "accept_redirects = 0, secure_redirects = 0, send_redirects = 0"),
    why: t("Podvržené přesměrování umožní útok man-in-the-middle.", "Forged redirects enable man-in-the-middle attacks."),
    fix: t("V /etc/sysctl.d/60-cis.conf nastavte net.ipv4.conf.all/default.accept_redirects, secure_redirects a send_redirects na 0 a net.ipv6.conf.all/default.accept_redirects na 0.", "Set net.ipv4.conf.all/default.accept_redirects, secure_redirects and send_redirects to 0 and net.ipv6.conf.all/default.accept_redirects to 0 in /etc/sysctl.d/60-cis.conf."),
    run: (c) =>
      sysctls(
        c,
        ["net.ipv4.conf.all.accept_redirects", "net.ipv4.conf.default.accept_redirects", "net.ipv4.conf.all.secure_redirects", "net.ipv4.conf.default.secure_redirects", "net.ipv4.conf.all.send_redirects", "net.ipv4.conf.default.send_redirects", "net.ipv6.conf.all.accept_redirects", "net.ipv6.conf.default.accept_redirects"],
        (n) => n === 0,
      ),
  },
  {
    id: "net.source_route", cat: "network", sev: "medium", ref: "CIS 3.3.1",
    title: t("Pakety se směrováním od zdroje se odmítají", "Source-routed packets are rejected"),
    expect: t("accept_source_route = 0", "accept_source_route = 0"),
    why: t("Zdrojové směrování umožní obejít síťová pravidla.", "Source routing allows bypassing network rules."),
    fix: t("Nastavte net.ipv4.conf.all/default.accept_source_route = 0 a net.ipv6.conf.all.accept_source_route = 0.", "Set net.ipv4.conf.all/default.accept_source_route = 0 and net.ipv6.conf.all.accept_source_route = 0."),
    run: (c) => sysctls(c, ["net.ipv4.conf.all.accept_source_route", "net.ipv4.conf.default.accept_source_route", "net.ipv6.conf.all.accept_source_route"], (n) => n === 0),
  },
  {
    id: "net.rp_filter", cat: "network", sev: "low", ref: "CIS 3.3.7",
    title: t("Kontrola zdrojové adresy (reverse path)", "Reverse path filtering"),
    expect: t("rp_filter = 1", "rp_filter = 1"),
    why: t("Bez kontroly přijme server pakety s podvrženou zdrojovou adresou.", "Without it the server accepts packets with spoofed source addresses."),
    fix: t("Nastavte net.ipv4.conf.all.rp_filter = 1 a net.ipv4.conf.default.rp_filter = 1.", "Set net.ipv4.conf.all.rp_filter = 1 and net.ipv4.conf.default.rp_filter = 1."),
    run: (c) => sysctls(c, ["net.ipv4.conf.all.rp_filter", "net.ipv4.conf.default.rp_filter"], (n) => n === 1 || n === 2),
  },
  {
    id: "net.log_martians", cat: "network", sev: "low", ref: "CIS 3.3.4",
    title: t("Podezřelé pakety se zaznamenávají", "Suspicious packets are logged"),
    expect: t("log_martians = 1", "log_martians = 1"),
    why: t("Záznam nesmyslných adres pomůže odhalit podvržený provoz.", "Logging impossible addresses helps detect spoofed traffic."),
    fix: t("Nastavte net.ipv4.conf.all.log_martians = 1 a net.ipv4.conf.default.log_martians = 1.", "Set net.ipv4.conf.all.log_martians = 1 and net.ipv4.conf.default.log_martians = 1."),
    run: (c) => sysctls(c, ["net.ipv4.conf.all.log_martians", "net.ipv4.conf.default.log_martians"], (n) => n === 1),
  },
  {
    id: "net.syncookies", cat: "network", sev: "medium", ref: "CIS 3.3.8",
    title: t("Ochrana proti zahlcení SYN", "SYN flood protection"),
    expect: t("tcp_syncookies = 1", "tcp_syncookies = 1"),
    why: t("Bez SYN cookies server snadno vyřadí útok zahlcením spojení.", "Without SYN cookies a connection flood easily takes the server down."),
    fix: t("Nastavte net.ipv4.tcp_syncookies = 1.", "Set net.ipv4.tcp_syncookies = 1."),
    run: (c) => sysctl(c, "net.ipv4.tcp_syncookies", (n) => n === 1),
  },
  {
    id: "net.icmp", cat: "network", sev: "low", ref: "CIS 3.3.5, 3.3.6",
    title: t("Ignorování broadcast a chybných ICMP", "Broadcast and bogus ICMP ignored"),
    expect: t("icmp_echo_ignore_broadcasts = 1, icmp_ignore_bogus_error_responses = 1", "icmp_echo_ignore_broadcasts = 1, icmp_ignore_bogus_error_responses = 1"),
    why: t("Server se nesmí zapojit do útoku typu smurf ani plnit záznamy nesmysly.", "The server must not take part in smurf attacks or fill logs with junk."),
    fix: t("Nastavte obě hodnoty na 1.", "Set both values to 1."),
    run: (c) => sysctls(c, ["net.ipv4.icmp_echo_ignore_broadcasts", "net.ipv4.icmp_ignore_bogus_error_responses"], (n) => n === 1),
  },
  {
    id: "net.ipv6_ra", cat: "network", sev: "low", ref: "CIS 3.3.9",
    title: t("Server nepřijímá ohlášení směrovačů IPv6", "Server does not accept IPv6 router advertisements"),
    expect: t("net.ipv6.conf.all.accept_ra = 0", "net.ipv6.conf.all.accept_ra = 0"),
    why: t("Podvržené ohlášení změní výchozí bránu serveru.", "A forged advertisement changes the server's default gateway."),
    fix: t("Nastavte net.ipv6.conf.all.accept_ra = 0 a net.ipv6.conf.default.accept_ra = 0 (pokud IPv6 adresu nedostává automaticky).", "Set net.ipv6.conf.all.accept_ra = 0 and net.ipv6.conf.default.accept_ra = 0 (unless IPv6 is autoconfigured)."),
    run: (c) => sysctl(c, "net.ipv6.conf.all.accept_ra", (n) => n === 0),
  },
  {
    id: "net.risky_modules", cat: "network", sev: "low", ref: "CIS 3.1",
    title: t("Nepoužívané síťové protokoly jsou zakázané", "Unused network protocols are disabled"),
    expect: t("moduly dccp, sctp, rds, tipc zablokované", "dccp, sctp, rds, tipc modules blocked"),
    why: t("Málo používané protokoly mívají neopravené zranitelnosti v jádře.", "Rarely used protocols often have unpatched kernel vulnerabilities."),
    fix: t("Do /etc/modprobe.d/cis.conf přidejte install dccp /bin/false (stejně sctp, rds, tipc) a blacklist dccp.", "Add install dccp /bin/false (likewise sctp, rds, tipc) and blacklist dccp to /etc/modprobe.d/cis.conf."),
    run: (c) => modules(c, ["dccp", "sctp", "rds", "tipc"]),
  },

  /* ===== jádro ===== */
  {
    id: "kernel.aslr", cat: "kernel", sev: "medium", ref: "CIS 1.5.3",
    title: t("Náhodné rozložení paměti (ASLR)", "Address space layout randomisation (ASLR)"),
    expect: t("kernel.randomize_va_space = 2", "kernel.randomize_va_space = 2"),
    why: t("ASLR výrazně ztěžuje zneužití chyb přetečení paměti.", "ASLR makes memory corruption exploits much harder."),
    fix: t("Nastavte kernel.randomize_va_space = 2.", "Set kernel.randomize_va_space = 2."),
    run: (c) => sysctl(c, "kernel.randomize_va_space", (n) => n === 2),
  },
  {
    id: "kernel.ptrace", cat: "kernel", sev: "low", ref: "CIS 1.5.2",
    title: t("Omezené ladění cizích procesů (ptrace)", "Restricted ptrace"),
    expect: t("kernel.yama.ptrace_scope ≥ 1", "kernel.yama.ptrace_scope ≥ 1"),
    why: t("Bez omezení může proces uživatele číst paměť jiných jeho procesů (hesla, klíče).", "Without it a user's process can read the memory of their other processes (passwords, keys)."),
    fix: t("Nastavte kernel.yama.ptrace_scope = 1.", "Set kernel.yama.ptrace_scope = 1."),
    run: (c) => sysctl(c, "kernel.yama.ptrace_scope", (n) => n >= 1),
  },
  {
    id: "kernel.info_leak", cat: "kernel", sev: "low", ref: "KSPP",
    title: t("Jádro neprozrazuje adresy a zprávy", "Kernel does not leak addresses and messages"),
    expect: t("kernel.kptr_restrict ≥ 1, kernel.dmesg_restrict = 1", "kernel.kptr_restrict ≥ 1, kernel.dmesg_restrict = 1"),
    why: t("Adresy jádra a výpis dmesg pomáhají útočníkovi se zneužitím chyb jádra.", "Kernel addresses and dmesg output help an attacker exploit kernel bugs."),
    fix: t("Nastavte kernel.kptr_restrict = 2 a kernel.dmesg_restrict = 1.", "Set kernel.kptr_restrict = 2 and kernel.dmesg_restrict = 1."),
    run: (c) => sysctls(c, ["kernel.kptr_restrict", "kernel.dmesg_restrict"], (n) => n >= 1),
  },
  {
    id: "kernel.bpf", cat: "kernel", sev: "low", ref: "KSPP",
    title: t("eBPF jen pro správce", "eBPF for administrators only"),
    expect: t("kernel.unprivileged_bpf_disabled ≥ 1", "kernel.unprivileged_bpf_disabled ≥ 1"),
    why: t("Neprivilegované eBPF bylo opakovaně zneužito k získání práv roota.", "Unprivileged eBPF has repeatedly been used to gain root."),
    fix: t("Nastavte kernel.unprivileged_bpf_disabled = 1.", "Set kernel.unprivileged_bpf_disabled = 1."),
    run: (c) => sysctl(c, "kernel.unprivileged_bpf_disabled", (n) => n >= 1),
  },
  {
    id: "kernel.links", cat: "kernel", sev: "low", ref: "CIS 1.5",
    title: t("Ochrana odkazů ve sdílených adresářích", "Link protection in shared directories"),
    expect: t("fs.protected_hardlinks = 1, fs.protected_symlinks = 1", "fs.protected_hardlinks = 1, fs.protected_symlinks = 1"),
    why: t("Bez ochrany lze přes odkazy v /tmp přimět privilegovaný proces přepsat cizí soubor.", "Without it links in /tmp can trick a privileged process into overwriting files."),
    fix: t("Nastavte fs.protected_hardlinks = 1 a fs.protected_symlinks = 1.", "Set fs.protected_hardlinks = 1 and fs.protected_symlinks = 1."),
    run: (c) => sysctls(c, ["fs.protected_hardlinks", "fs.protected_symlinks"], (n) => n >= 1),
  },
  {
    id: "kernel.core_dumps", cat: "kernel", sev: "low", ref: "CIS 1.5.1",
    title: t("Výpisy paměti (core dump) jsou omezené", "Core dumps are restricted"),
    expect: t("fs.suid_dumpable = 0 a hard core 0 nebo Storage=none", "fs.suid_dumpable = 0 and hard core 0 or Storage=none"),
    why: t("Výpis paměti programu může obsahovat hesla a klíče.", "A program's memory dump may contain passwords and keys."),
    fix: t("Nastavte fs.suid_dumpable = 0, do /etc/security/limits.conf * hard core 0 a v /etc/systemd/coredump.conf Storage=none.", "Set fs.suid_dumpable = 0, add * hard core 0 to /etc/security/limits.conf and Storage=none in /etc/systemd/coredump.conf."),
    run: (c) => {
      const d = num(c.f("sysctl.fs.suid_dumpable"));
      if (d == null) return NA;
      const st = c.f("core.storage");
      const lim = c.f("core.hardLimit");
      return ok(d === 0 && (st === "none" || lim === "0"), `suid_dumpable ${d}, storage ${st ?? "?"}, limit ${lim ?? "?"}`);
    },
  },

  /* ===== souborový systém ===== */
  {
    id: "fs.tmp", cat: "filesystem", sev: "medium", ref: "CIS 1.1.2",
    title: t("/tmp je samostatný oddíl s noexec, nosuid, nodev", "/tmp is a separate mount with noexec, nosuid, nodev"),
    expect: t("samostatné připojení, noexec, nosuid, nodev", "separate mount, noexec, nosuid, nodev"),
    why: t("Do /tmp může zapisovat kdokoli – útočník tam obvykle spouští stažené nástroje.", "Anyone can write to /tmp – attackers usually run downloaded tools from there."),
    fix: t("systemctl enable tmp.mount (tmpfs) a v jeho nastavení Options=mode=1777,strictatime,noexec,nosuid,nodev.", "systemctl enable tmp.mount (tmpfs) with Options=mode=1777,strictatime,noexec,nosuid,nodev."),
    run: (c) => mountHas(c, "/tmp", ["noexec", "nosuid", "nodev"], true),
  },
  {
    id: "fs.dev_shm", cat: "filesystem", sev: "medium", ref: "CIS 1.1.8",
    title: t("/dev/shm s noexec, nosuid, nodev", "/dev/shm with noexec, nosuid, nodev"),
    expect: t("noexec, nosuid, nodev", "noexec, nosuid, nodev"),
    why: t("Sdílená paměť je zapisovatelná všemi a slouží ke spouštění škodlivého kódu bez stop na disku.", "Shared memory is world-writable and used to run malicious code without traces on disk."),
    fix: t("Do /etc/fstab: tmpfs /dev/shm tmpfs defaults,noexec,nosuid,nodev 0 0 a mount -o remount /dev/shm.", "Add tmpfs /dev/shm tmpfs defaults,noexec,nosuid,nodev 0 0 to /etc/fstab and mount -o remount /dev/shm."),
    run: (c) => mountHas(c, "/dev/shm", ["noexec", "nosuid", "nodev"], false),
  },
  {
    id: "fs.var_tmp", cat: "filesystem", sev: "low", ref: "CIS 1.1.4",
    title: t("/var/tmp s noexec, nosuid, nodev", "/var/tmp with noexec, nosuid, nodev"),
    expect: t("samostatné připojení s noexec, nosuid, nodev", "separate mount with noexec, nosuid, nodev"),
    why: t("/var/tmp je zapisovatelný všemi a přežívá restart.", "/var/tmp is world-writable and survives reboots."),
    fix: t("Připojte /var/tmp jako samostatný oddíl (nebo bind na /tmp) s noexec, nosuid, nodev.", "Mount /var/tmp separately (or bind it to /tmp) with noexec, nosuid, nodev."),
    run: (c) => mountHas(c, "/var/tmp", ["noexec", "nosuid", "nodev"], true),
  },
  {
    id: "fs.var_log", cat: "filesystem", sev: "low", ref: "CIS 1.1.5, 1.1.6",
    title: t("Záznamy na samostatném oddílu", "Logs on a separate partition"),
    expect: t("/var/log (a /var/log/audit) samostatně", "/var/log (and /var/log/audit) separate"),
    why: t("Zaplnění disku záznamy nesmí zastavit systém a naopak výpadek místa nesmí zastavit zaznamenávání.", "Logs filling the disk must not stop the system and vice versa."),
    fix: t("Při instalaci nebo přes LVM vytvořte samostatný oddíl pro /var/log (nodev, nosuid, noexec).", "Create a separate partition for /var/log (nodev, nosuid, noexec) at installation or via LVM."),
    run: (c) => {
      const v = c.f("mount./var/log");
      return v == null ? NA : ok(v !== "-", v === "-" ? "–" : v);
    },
  },
  {
    id: "fs.perm_accounts", cat: "filesystem", sev: "high", ref: "CIS 6.1.2–6.1.9",
    title: t("Práva souborů s účty a hesly", "Permissions of account and password files"),
    expect: t("passwd, group ≤ 644; shadow, gshadow ≤ 640; vlastník root", "passwd, group ≤ 644; shadow, gshadow ≤ 640; owner root"),
    why: t("Čitelné /etc/shadow umožní lámat hesla offline.", "A readable /etc/shadow allows offline password cracking."),
    fix: t("chown root:root /etc/passwd /etc/group && chmod 644 /etc/passwd /etc/group; chown root:shadow /etc/shadow /etc/gshadow && chmod 640 /etc/shadow /etc/gshadow.", "chown root:root /etc/passwd /etc/group && chmod 644 /etc/passwd /etc/group; chown root:shadow /etc/shadow /etc/gshadow && chmod 640 /etc/shadow /etc/gshadow."),
    run: (c) => perms(c, [["/etc/passwd", 0o644], ["/etc/group", 0o644], ["/etc/shadow", 0o640], ["/etc/gshadow", 0o640], ["/etc/passwd-", 0o644], ["/etc/shadow-", 0o640]]),
  },
  {
    id: "fs.perm_config", cat: "filesystem", sev: "low", ref: "CIS 5.1.2–5.1.7, 5.2.1, 1.4.1",
    title: t("Práva konfigurace SSH, cronu, sudo a zavaděče", "Permissions of SSH, cron, sudo and boot loader configuration"),
    expect: t("sshd_config, crontab, grub.cfg ≤ 600; cron.d, cron.daily ≤ 700; sudoers ≤ 440", "sshd_config, crontab, grub.cfg ≤ 600; cron.d, cron.daily ≤ 700; sudoers ≤ 440"),
    why: t("Čitelná konfigurace prozradí nastavení a zapisovatelná umožní získat práva roota.", "Readable configuration reveals settings and writable configuration leads to root."),
    fix: t("chmod 600 /etc/ssh/sshd_config /etc/crontab /boot/grub/grub.cfg; chmod 700 /etc/cron.d /etc/cron.daily; chmod 440 /etc/sudoers.", "chmod 600 /etc/ssh/sshd_config /etc/crontab /boot/grub/grub.cfg; chmod 700 /etc/cron.d /etc/cron.daily; chmod 440 /etc/sudoers."),
    run: (c) =>
      perms(c, [
        ["/etc/ssh/sshd_config", 0o600],
        ["/etc/crontab", 0o600],
        ["/etc/cron.d", 0o700],
        ["/etc/cron.daily", 0o700],
        ["/etc/sudoers", 0o440],
        ["/boot/grub/grub.cfg", 0o600],
        ["/boot/grub2/grub.cfg", 0o600],
      ]),
  },

  /* ===== služby ===== */
  {
    id: "svc.risky", cat: "services", sev: "medium", ref: "CIS 2.2",
    title: t("Neběží zbytečné a nezabezpečené služby", "No unnecessary or insecure services"),
    expect: t("bez telnet, rsh, FTP, TFTP, NIS, avahi, CUPS, rpcbind, NFS, SNMP", "no telnet, rsh, FTP, TFTP, NIS, avahi, CUPS, rpcbind, NFS, SNMP"),
    why: t("Každá služba navíc rozšiřuje plochu útoku; telnet, FTP a rsh přenáší hesla nešifrovaně.", "Every extra service widens the attack surface; telnet, FTP and rsh send passwords unencrypted."),
    fix: t("systemctl disable --now <služba> a balíček odinstalujte (apt purge).", "systemctl disable --now <service> and uninstall the package (apt purge)."),
    run: (c) => {
      if (!hasServices(c.inv)) return NA;
      const on = svcActive(c.inv, RISKY_SERVICES);
      return ok(!on.length, on.join(", ") || "–");
    },
  },
  {
    id: "svc.timesync", cat: "services", sev: "medium", ref: "CIS 2.1, vyhl. 409 – synchronizace času",
    title: t("Čas je synchronizovaný", "Time is synchronised"),
    expect: t("chrony / systemd-timesyncd běží a čas je synchronizovaný", "chrony / systemd-timesyncd running and time synchronised"),
    why: t("Bez přesného času nejdou záznamy z více systémů spojit při řešení incidentu.", "Without accurate time, logs from several systems cannot be correlated during an incident."),
    fix: t("apt install chrony (nebo systemctl enable --now systemd-timesyncd) a nastavte firemní NTP server.", "apt install chrony (or systemctl enable --now systemd-timesyncd) and configure the company NTP server."),
    run: (c) => {
      if (!hasServices(c.inv)) return NA;
      const on = svcActive(c.inv, TIME_SERVICES);
      const synced = c.f("time.synced");
      return ok(on.length > 0 && synced !== "no", `${on.join(", ") || "–"}${synced ? `, synchronizováno: ${synced}` : ""}`);
    },
  },
  {
    id: "svc.security_agent", cat: "services", sev: "low", ref: "vyhl. 409 – detekce kybernetických bezpečnostních událostí",
    title: t("Běží agent detekce (SIEM / EDR)", "A detection agent (SIEM / EDR) is running"),
    expect: t("např. wazuh-agent", "e.g. wazuh-agent"),
    why: t("Bez agenta detekce se útok na serveru nemusí včas odhalit.", "Without a detection agent an attack on the server may go unnoticed."),
    fix: t("Nainstalujte agenta SIEM (Wazuh) nebo EDR a připojte ho k dohledovému centru.", "Install a SIEM (Wazuh) or EDR agent and connect it to the monitoring centre."),
    run: (c) => {
      if (!hasServices(c.inv)) return NA;
      const on = svcActive(c.inv, SECURITY_AGENTS);
      return ok(on.length > 0, on.join(", ") || "–");
    },
  },

  /* ===== záznamy a audit ===== */
  {
    id: "log.auditd", cat: "logging", sev: "medium", ref: "CIS 4.1, vyhl. 409 – zaznamenávání událostí",
    title: t("Audit jádra (auditd) běží a má pravidla", "Kernel audit (auditd) runs with rules"),
    expect: t("auditd aktivní, alespoň základní pravidla", "auditd active, at least basic rules"),
    why: t("Auditd zaznamená změny účtů, práv a spuštěné privilegované příkazy – podklad pro vyšetření incidentu.", "Auditd records account and permission changes and privileged commands – evidence for incident investigation."),
    fix: t("apt install auditd audispd-plugins, systemctl enable --now auditd a doplňte pravidla CIS do /etc/audit/rules.d/.", "apt install auditd audispd-plugins, systemctl enable --now auditd and add CIS rules to /etc/audit/rules.d/."),
    run: (c) => {
      if (!hasServices(c.inv)) return NA;
      const on = svcActive(c.inv, ["auditd"]).length > 0;
      const rules = num(c.f("audit.rules"));
      return ok(on && (rules ?? 0) > 0, `${on ? "běží" : "neběží"}, pravidel ${rules ?? 0}`);
    },
  },
  {
    id: "log.journald", cat: "logging", sev: "low", ref: "CIS 4.2.1",
    title: t("Systémový žurnál se ukládá na disk", "System journal is stored on disk"),
    expect: t("Storage=persistent", "Storage=persistent"),
    why: t("Žurnál jen v paměti se restartem ztratí.", "A memory-only journal is lost on reboot."),
    fix: t("V /etc/systemd/journald.conf nastavte Storage=persistent a systemctl restart systemd-journald.", "Set Storage=persistent in /etc/systemd/journald.conf and systemctl restart systemd-journald."),
    run: (c) => {
      const v = c.f("journald.storage");
      return v == null ? NA : ok(v === "persistent", v);
    },
  },
  {
    id: "log.central", cat: "logging", sev: "low", ref: "CIS 4.2.2, vyhl. 409 – centrální zaznamenávání",
    title: t("Záznamy se posílají mimo server", "Logs are sent off the server"),
    expect: t("vzdálený syslog nebo agent SIEM", "remote syslog or SIEM agent"),
    why: t("Útočník po průniku záznamy na serveru smaže; kopie jinde zůstane.", "After a breach attackers wipe local logs; a copy elsewhere survives."),
    fix: t("Nastavte předávání rsyslogu na sběrný server (*.* @@syslog.firma:514) nebo nainstalujte agenta SIEM.", "Configure rsyslog forwarding to a collector (*.* @@syslog.company:514) or install a SIEM agent."),
    run: (c) => {
      const r = c.f("syslog.remote");
      const siem = svcActive(c.inv, SECURITY_AGENTS);
      if (r == null && !hasServices(c.inv)) return NA;
      return ok(r === "true" || siem.length > 0, [r === "true" ? "syslog" : "", ...siem].filter(Boolean).join(", ") || "–");
    },
  },

  /* ===== aktualizace ===== */
  {
    id: "upd.security", cat: "updates", sev: "medium", ref: "vyhl. 409 – řízení zranitelností", dup: true,
    title: t("Nainstalované bezpečnostní aktualizace", "Security updates installed"),
    expect: t("žádné čekající bezpečnostní aktualizace", "no pending security updates"),
    why: t("Neopravené zranitelnosti jsou nejčastější vstupní bod útoku.", "Unpatched vulnerabilities are the most common entry point."),
    fix: t("apt-get update && apt-get upgrade (nebo dnf upgrade --security) v okně údržby.", "apt-get update && apt-get upgrade (or dnf upgrade --security) in a maintenance window."),
    run: (c) => {
      const n = c.inv.system?.securityUpdates;
      return n == null ? NA : ok(n === 0, String(n));
    },
  },
  {
    id: "upd.auto", cat: "updates", sev: "low", ref: "CIS 1.9", dup: true,
    title: t("Automatické bezpečnostní aktualizace", "Automatic security updates"),
    expect: t("unattended-upgrades / dnf-automatic", "unattended-upgrades / dnf-automatic"),
    why: t("Bez automatických aktualizací závisí oprava na ručním zásahu.", "Without automatic updates fixing depends on manual action."),
    fix: t("apt install unattended-upgrades && dpkg-reconfigure unattended-upgrades.", "apt install unattended-upgrades && dpkg-reconfigure unattended-upgrades."),
    run: (c) => {
      const v = c.inv.system?.autoUpdates;
      return v == null ? NA : ok(v, v ? "ano" : "ne");
    },
  },
  {
    id: "upd.reboot", cat: "updates", sev: "low", ref: "vyhl. 409 – řízení zranitelností", dup: true,
    title: t("Běží aktuální jádro a knihovny", "Current kernel and libraries are running"),
    expect: t("server nečeká na restart", "no reboot pending"),
    why: t("Nainstalované opravy se projeví až po restartu.", "Installed fixes only take effect after a reboot."),
    fix: t("Restartujte server v okně údržby.", "Reboot the server in a maintenance window."),
    run: (c) => {
      const v = c.inv.system?.rebootRequired;
      return v == null ? NA : ok(!v, v ? "čeká na restart" : "ne");
    },
  },

  /* ===== AppArmor / SELinux ===== */
  {
    id: "mac.enabled", cat: "mac", sev: "medium", ref: "CIS 1.6",
    title: t("Povinné řízení přístupu je zapnuté", "Mandatory access control is enabled"),
    expect: t("AppArmor s profily v režimu enforce, nebo SELinux enforcing", "AppArmor with enforcing profiles, or SELinux enforcing"),
    why: t("AppArmor / SELinux omezí, co může napadená služba udělat, i když běží jako root.", "AppArmor / SELinux limit what a compromised service can do, even as root."),
    fix: t("Ubuntu: apt install apparmor apparmor-utils, aa-enforce /etc/apparmor.d/*; RHEL: SELINUX=enforcing v /etc/selinux/config.", "Ubuntu: apt install apparmor apparmor-utils, aa-enforce /etc/apparmor.d/*; RHEL: SELINUX=enforcing in /etc/selinux/config."),
    run: (c) => {
      const aa = c.f("mac.apparmor");
      const se = c.f("mac.selinux");
      if (aa == null && se == null) return NA;
      const enf = Number(/enforce=(\d+)/.exec(aa ?? "")?.[1] ?? 0);
      return ok(se === "enforcing" || (aa?.startsWith("enabled") === true && (enf > 0 || !aa.includes("enforce="))), se === "enforcing" ? "SELinux enforcing" : `AppArmor: ${aa ?? "–"}`);
    },
  },
  {
    id: "mac.complain", cat: "mac", sev: "low", ref: "CIS 1.6.1.4",
    title: t("Žádné profily AppArmor jen v režimu complain", "No AppArmor profiles only in complain mode"),
    expect: t("complain = 0", "complain = 0"),
    why: t("Profil v režimu complain jen zaznamenává, nic neblokuje.", "A complain-mode profile only logs and blocks nothing."),
    fix: t("aa-enforce /etc/apparmor.d/<profil> (po ověření, že aplikace funguje).", "aa-enforce /etc/apparmor.d/<profile> (after verifying the application works)."),
    run: (c) => {
      const aa = c.f("mac.apparmor");
      const m = /complain=(\d+)/.exec(aa ?? "");
      return m ? ok(m[1] === "0", `complain=${m[1]}`) : NA;
    },
  },

  /* ===== zavaděč a moduly ===== */
  {
    id: "boot.password", cat: "boot", sev: "low", ref: "CIS 1.4.1",
    title: t("Zavaděč je chráněný heslem", "Boot loader is password protected"),
    expect: t("GRUB superusers + password_pbkdf2", "GRUB superusers + password_pbkdf2"),
    why: t("Kdo má přístup ke konzoli, může bez hesla zavaděče spustit systém v režimu jednoho uživatele jako root.", "Anyone at the console can boot into single-user mode as root without a boot loader password."),
    fix: t("grub-mkpasswd-pbkdf2, do /etc/grub.d/40_custom set superusers a password_pbkdf2, update-grub.", "grub-mkpasswd-pbkdf2, add set superusers and password_pbkdf2 to /etc/grub.d/40_custom, run update-grub."),
    run: (c) => {
      const v = c.f("boot.password");
      return v == null ? NA : ok(v === "true", v === "true" ? "ano" : "ne");
    },
  },
  {
    id: "boot.usb_storage", cat: "boot", sev: "low", ref: "CIS 1.1.10, vyhl. 409 – výměnná média",
    title: t("USB úložiště jsou zakázaná", "USB storage is disabled"),
    expect: t("modul usb-storage zablokovaný", "usb-storage module blocked"),
    why: t("USB disk umožní vynést data nebo nahrát škodlivý kód (vyhláška 409 – výměnná zařízení).", "A USB disk can exfiltrate data or bring in malware."),
    fix: t("Do /etc/modprobe.d/usb-storage.conf: install usb-storage /bin/false a blacklist usb-storage.", "Add install usb-storage /bin/false and blacklist usb-storage to /etc/modprobe.d/usb-storage.conf."),
    run: (c) => modules(c, ["usb_storage"]),
  },
  {
    id: "boot.fs_modules", cat: "boot", sev: "low", ref: "CIS 1.1.1",
    title: t("Nepotřebné souborové systémy jsou zakázané", "Unneeded file systems are disabled"),
    expect: t("cramfs, freevxfs, hfs, hfsplus, jffs2, udf zablokované", "cramfs, freevxfs, hfs, hfsplus, jffs2, udf blocked"),
    why: t("Ovladače málo používaných souborových systémů bývají zdrojem zranitelností jádra.", "Drivers for rarely used file systems are a source of kernel vulnerabilities."),
    fix: t("Do /etc/modprobe.d/cis.conf přidejte pro každý install <modul> /bin/false a blacklist <modul>.", "Add install <module> /bin/false and blacklist <module> for each to /etc/modprobe.d/cis.conf."),
    run: (c) => modules(c, ["cramfs", "freevxfs", "hfs", "hfsplus", "jffs2", "udf"]),
  },
  {
    id: "boot.banner", cat: "boot", sev: "low", ref: "CIS 1.7",
    title: t("Přihlašovací banner neprozrazuje systém", "Login banner does not reveal the system"),
    expect: t("/etc/issue.net bez verze systému", "/etc/issue.net without OS version"),
    why: t("Verze systému v banneru usnadní výběr útoku.", "The OS version in the banner helps an attacker choose an exploit."),
    fix: t("Nahraďte obsah /etc/issue.net textem upozornění na oprávněné použití.", "Replace /etc/issue.net with an authorised-use warning."),
    run: (c) => {
      const v = c.f("banner.osInfo");
      return v == null ? NA : ok(v !== "true", v === "true" ? "obsahuje verzi" : "ne");
    },
  },

  /* ===== kontejnery ===== */
  {
    id: "ctr.tcp_socket", cat: "containers", sev: "high", ref: "CIS Docker 2.6",
    title: t("API Dockeru není dostupné po síti bez TLS", "Docker API not exposed over the network without TLS"),
    expect: t("bez -H tcp://, nebo s --tlsverify", "no -H tcp://, or with --tlsverify"),
    why: t("Nechráněné API Dockeru na síti = root na serveru pro kohokoli v síti.", "An unprotected Docker API on the network = root on the server for anyone on the network."),
    fix: t("Odeberte tcp:// z hosts v /etc/docker/daemon.json a z ExecStart, nebo zapněte tlsverify s klientskými certifikáty.", "Remove tcp:// from hosts in /etc/docker/daemon.json and ExecStart, or enable tlsverify with client certificates."),
    run: (c) => {
      const e = engineOf(c);
      if (!e) return NA;
      return ok(!e.tcpHosts.length || e.tlsVerify, e.tcpHosts.join(", ") || "jen lokální soket");
    },
  },
  {
    id: "ctr.socket", cat: "containers", sev: "medium", ref: "CIS Docker 3.15",
    title: t("Soket Dockeru má omezená práva", "Docker socket has restricted permissions"),
    expect: t("660, root:docker", "660, root:docker"),
    why: t("Kdo může zapisovat do soketu Dockeru, je root na serveru.", "Whoever can write to the Docker socket is root on the server."),
    fix: t("chown root:docker /var/run/docker.sock && chmod 660 /var/run/docker.sock.", "chown root:docker /var/run/docker.sock && chmod 660 /var/run/docker.sock."),
    run: (c) => {
      const e = engineOf(c);
      if (!e?.socketMode) return NA;
      return ok((parseInt(e.socketMode, 8) & ~0o660) === 0, `${e.socketMode} ${e.socketGroup ?? ""}`.trim());
    },
  },
  {
    id: "ctr.group", cat: "containers", sev: "medium", ref: "CIS Docker 1.1.2",
    title: t("Skupina docker jen pro správce", "Docker group for administrators only"),
    expect: t("ve skupině docker jen osoby se správou serveru", "only server administrators in the docker group"),
    why: t("Člen skupiny docker získá přes kontejner práva roota – je to privilegovaný účet.", "A docker group member can become root through a container – it is a privileged account."),
    fix: t("Ověřte členy (getent group docker) a odeberte nepotřebné: gpasswd -d <uživatel> docker.", "Review members (getent group docker) and remove unneeded ones: gpasswd -d <user> docker."),
    run: (c) => {
      const e = engineOf(c);
      if (!e || e.rootless) return NA;
      return ok(e.groupMembers.length === 0, e.groupMembers.join(", ") || "–");
    },
  },
  {
    id: "ctr.userns", cat: "containers", sev: "low", ref: "CIS Docker 2.10",
    title: t("Kontejnery mají oddělené uživatele (userns / rootless)", "Containers use separate users (userns / rootless)"),
    expect: t("userns-remap nebo rootless režim", "userns-remap or rootless mode"),
    why: t("Bez mapování je root v kontejneru i root na hostiteli.", "Without remapping root in a container is root on the host."),
    fix: t("Do /etc/docker/daemon.json \"userns-remap\": \"default\" (ověřte kompatibilitu), nebo Docker v režimu rootless.", "Add \"userns-remap\": \"default\" to /etc/docker/daemon.json (check compatibility), or run Docker rootless."),
    run: (c) => {
      const e = engineOf(c);
      if (!e) return NA;
      return ok(e.usernsRemap || e.rootless, e.rootless ? "rootless" : e.usernsRemap ? "userns" : "ne");
    },
  },
  {
    id: "ctr.daemon", cat: "containers", sev: "low", ref: "CIS Docker 2.1, 2.14, 2.18",
    title: t("Bezpečné výchozí nastavení Dockeru", "Secure Docker daemon defaults"),
    expect: t("icc false, no-new-privileges true, live-restore true", "icc false, no-new-privileges true, live-restore true"),
    why: t("Výchozí nastavení dovolí kontejnerům volně komunikovat a získávat další práva.", "The defaults let containers talk freely and gain privileges."),
    fix: t("Do /etc/docker/daemon.json: \"icc\": false, \"no-new-privileges\": true, \"live-restore\": true a systemctl restart docker.", "Add \"icc\": false, \"no-new-privileges\": true, \"live-restore\": true to /etc/docker/daemon.json and systemctl restart docker."),
    run: (c) => {
      const e = engineOf(c);
      if (!e || e.name === "podman") return NA;
      const miss = [e.icc === false ? "" : "icc", e.noNewPrivileges ? "" : "no-new-privileges", e.liveRestore ? "" : "live-restore"].filter(Boolean);
      return ok(!miss.length, miss.length ? `chybí ${miss.join(", ")}` : "ano");
    },
  },
  {
    id: "ctr.privileged", cat: "containers", sev: "high", ref: "CIS Docker 5.5", dup: true,
    title: t("Žádný privilegovaný kontejner", "No privileged containers"),
    expect: t("bez --privileged", "no --privileged"),
    why: t("Privilegovaný kontejner má plný přístup k hostiteli.", "A privileged container has full access to the host."),
    fix: t("Odeberte privileged: true a přidejte jen potřebné cap_add / devices.", "Remove privileged: true and add only the needed cap_add / devices."),
    run: (c) => {
      if (!c.inv.containers.length) return NA;
      const bad = c.inv.containers.filter((x) => x.privileged).map((x) => x.name);
      return ok(!bad.length, bad.join(", ") || "–");
    },
  },
  {
    id: "ctr.engine_socket", cat: "containers", sev: "high", ref: "CIS Docker 5.32", dup: true,
    title: t("Žádný kontejner nemá soket Dockeru", "No container mounts the Docker socket"),
    expect: t("bez připojeného docker.sock", "no mounted docker.sock"),
    why: t("Kontejner se soketem Dockeru ovládá celý server.", "A container with the Docker socket controls the whole server."),
    fix: t("Odeberte svazek /var/run/docker.sock; pro správu použijte proxy s omezeným API (např. docker-socket-proxy jen pro čtení).", "Remove the /var/run/docker.sock volume; use a restricted API proxy (e.g. read-only docker-socket-proxy)."),
    run: (c) => {
      if (!c.inv.containers.length) return NA;
      const bad = c.inv.containers.filter((x) => x.mounts.some(mountsEngineSocket)).map((x) => x.name);
      return ok(!bad.length, bad.join(", ") || "–");
    },
  },
  {
    id: "ctr.non_root", cat: "containers", sev: "low", ref: "CIS Docker 4.1",
    title: t("Kontejnery neběží jako root", "Containers do not run as root"),
    expect: t("nastavený neprivilegovaný uživatel", "non-root user set"),
    why: t("Zranitelnost aplikace běžící jako root dává útočníkovi víc možností úniku z kontejneru.", "A vulnerable application running as root gives more ways to escape the container."),
    fix: t("V Dockerfile USER nebo v compose user: \"1000:1000\".", "Set USER in the Dockerfile or user: \"1000:1000\" in compose."),
    run: (c) => {
      const run = runningContainers(c);
      if (!run.length) return NA;
      const root = run.filter((x) => !x.user.trim() || x.user === "root" || x.user === "0" || x.user.startsWith("0:"));
      return ok(!root.length, `${run.length - root.length} / ${run.length}`);
    },
  },
  {
    id: "ctr.readonly", cat: "containers", sev: "low", ref: "CIS Docker 5.13",
    title: t("Kontejnery mají kořen jen pro čtení", "Containers have a read-only root file system"),
    expect: t("read_only: true", "read_only: true"),
    why: t("Zapisovatelný kořen dovolí útočníkovi upravit aplikaci uvnitř kontejneru.", "A writable root lets an attacker modify the application inside the container."),
    fix: t("V compose read_only: true a zapisovatelné cesty jako tmpfs / svazky.", "Set read_only: true in compose and mount writable paths as tmpfs / volumes."),
    run: (c) => {
      const run = runningContainers(c).filter((x) => x.readOnlyRootfs != null);
      if (!run.length) return NA;
      const ro = run.filter((x) => x.readOnlyRootfs).length;
      return ok(ro === run.length, `${ro} / ${run.length}`);
    },
  },
  {
    id: "ctr.limits", cat: "containers", sev: "low", ref: "CIS Docker 5.11, 5.12, 5.29",
    title: t("Kontejnery mají limity paměti a procesů", "Containers have memory and process limits"),
    expect: t("mem_limit a pids_limit", "mem_limit and pids_limit"),
    why: t("Bez limitů jeden kontejner vyčerpá paměť celého serveru (DoS).", "Without limits one container can exhaust the server's memory (DoS)."),
    fix: t("V compose mem_limit, cpus a pids_limit (deploy.resources.limits).", "Set mem_limit, cpus and pids_limit (deploy.resources.limits) in compose."),
    run: (c) => {
      const run = runningContainers(c).filter((x) => x.memoryLimit != null);
      if (!run.length) return NA;
      const okc = run.filter((x) => (x.memoryLimit ?? 0) > 0 && (x.pidsLimit ?? 0) > 0).length;
      return ok(okc === run.length, `${okc} / ${run.length}`);
    },
  },
];

/** Moduly jádra: zablokované = vyhovuje, načtené / povolené = ne. */
function modules(c: Ctx, names: string[]): Outcome {
  const vals = names.map((n) => [n, c.f(`module.${n}`)] as const).filter(([, v]) => v != null);
  if (!vals.length) return NA;
  const bad = vals.filter(([, v]) => v !== "blocked");
  return ok(!bad.length, bad.length ? bad.map(([n, v]) => `${n}: ${v === "loaded" ? "načten" : "povolen"}`).join(", ") : "zablokováno");
}

/**
 * Mapování kontrol na požadavky rámců (v1.87, ADR-182): hardening jako důkaz k opatřením – vyhláška 409 / 410,
 * ISO/IEC 27001:2022 příloha A, CIS Controls v8. ID odpovídají požadavkům v `frameworks` (ověřuje test).
 */
export const HARDENING_REQS: Record<string, string[]> = {
  "ssh.root_login": ["cz409:13/2/b", "cz409:22/4/d", "cz410:7/1/a", "iso27001:A.8.2", "iso27001:A.8.5", "cis8:5.4"],
  "ssh.password_auth": ["cz409:19/2/a", "cz409:19/2/b", "cz410:8/2", "cz410:8/3", "iso27001:A.8.5", "cis8:6.5"],
  "ssh.empty_passwords": ["cz409:19/1/a", "cz410:8/1/c", "iso27001:A.8.5", "cis8:5.2"],
  "ssh.max_auth_tries": ["cz409:19/1/b", "cz410:8/1/a", "iso27001:A.8.5"],
  "ssh.weak_ciphers": ["cz409:25/1/a", "cz409:18/g", "cz410:13/1/a", "cz410:11/c", "iso27001:A.8.24", "cis8:3.10"],
  "ssh.weak_macs": ["cz409:25/1/a", "cz409:18/g", "cz410:13/1/a", "cz410:11/c", "iso27001:A.8.24", "cis8:3.10"],
  "ssh.weak_kex": ["cz409:25/1/a", "cz409:18/g", "cz410:13/1/a", "cz410:11/c", "iso27001:A.8.24", "cis8:3.10"],
  "ssh.idle_timeout": ["cz409:19/1/d", "cz409:18/f", "cz410:8/1/b", "iso27001:A.8.5", "cis8:4.3"],
  "ssh.login_grace": ["cz409:19/1/b", "cz410:8/1/a", "iso27001:A.8.5"],
  "ssh.forwarding": ["cz409:18/b", "cz409:18/d", "cz410:11/d", "iso27001:A.8.20", "iso27001:A.8.22", "cis8:4.1"],
  "ssh.hostbased": ["cz409:19/1/a", "cz410:8/1/c", "iso27001:A.8.5", "cis8:4.1"],
  "ssh.access_list": ["cz409:13/2/b", "cz409:18/d", "cz410:7/1/a", "cz410:11/d", "iso27001:A.5.15", "iso27001:A.8.2", "cis8:5.4"],
  "ssh.log_level": ["cz409:22/3/a", "cz410:9/2/a", "iso27001:A.8.15", "cis8:8.5"],
  "acc.empty_password": ["cz409:19/1/a", "cz410:8/1/c", "iso27001:A.5.17", "cis8:5.2"],
  "acc.uid0": ["cz409:13/2/c", "cz410:7/1/b", "iso27001:A.8.2", "cis8:5.4"],
  "acc.sudo_nopasswd": ["cz409:13/2/b", "cz409:19/1/a", "cz410:7/1/a", "iso27001:A.8.2", "iso27001:A.8.18", "cis8:5.4"],
  "acc.password_policy": ["cz409:19/4/a", "cz409:19/4/f", "cz410:8/4/a", "cz410:8/4/e", "iso27001:A.5.17", "cis8:5.2"],
  "acc.lockout": ["cz409:19/1/b", "cz410:8/1/a", "iso27001:A.8.5"],
  "acc.password_age": ["cz409:19/4/e", "cz410:8/4/d", "iso27001:A.5.17"],
  "acc.hash": ["cz409:19/1/c", "cz410:8/1/c", "iso27001:A.5.17", "iso27001:A.8.24"],
  "acc.umask": ["cz409:20/c", "cz410:8/1/d", "iso27001:A.8.3", "cis8:3.3"],
  "net.firewall": ["cz409:18/b", "cz409:18/e", "cz410:11/b", "iso27001:A.8.20", "cis8:4.4"],
  "net.ip_forward": ["cz409:18/a", "cz409:18/b", "cz410:11/a", "iso27001:A.8.22", "cis8:4.1"],
  "net.redirects": ["cz409:18/h", "cz410:11/c", "iso27001:A.8.20", "cis8:4.1"],
  "net.source_route": ["cz409:18/h", "cz410:11/c", "iso27001:A.8.20", "cis8:4.1"],
  "net.rp_filter": ["cz409:18/h", "cz410:11/c", "iso27001:A.8.20", "cis8:4.1"],
  "net.log_martians": ["cz409:22/2/b", "cz410:9/2/a", "iso27001:A.8.15", "cis8:8.2"],
  "net.syncookies": ["cz409:26/1/b", "iso27001:A.8.20", "cis8:4.1"],
  "net.icmp": ["cz409:18/h", "cz410:11/c", "iso27001:A.8.20", "cis8:4.1"],
  "net.ipv6_ra": ["cz409:18/h", "cz410:11/c", "iso27001:A.8.20", "cis8:4.1"],
  "net.risky_modules": ["cz409:18/e", "cz409:26/4", "iso27001:A.8.9", "cis8:4.8"],
  "kernel.aslr": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1", "cis8:10.5"],
  "kernel.ptrace": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1"],
  "kernel.info_leak": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1"],
  "kernel.bpf": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1"],
  "kernel.links": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1"],
  "kernel.core_dumps": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1"],
  "fs.tmp": ["cz409:21/2/d", "cz409:26/4", "iso27001:A.8.9", "iso27001:A.8.19", "cis8:4.1"],
  "fs.dev_shm": ["cz409:21/2/d", "cz409:26/4", "iso27001:A.8.9", "iso27001:A.8.19", "cis8:4.1"],
  "fs.var_tmp": ["cz409:21/2/d", "cz409:26/4", "iso27001:A.8.9", "iso27001:A.8.19", "cis8:4.1"],
  "fs.var_log": ["cz409:22/5/a", "iso27001:A.8.15", "iso27001:A.8.6", "cis8:8.3"],
  "fs.perm_accounts": ["cz409:19/1/c", "cz409:20/c", "cz410:8/1/c", "cz410:8/1/d", "iso27001:A.5.17", "iso27001:A.8.3", "cis8:3.3"],
  "fs.perm_config": ["cz409:20/c", "cz410:8/1/d", "iso27001:A.8.3", "iso27001:A.8.9", "cis8:3.3"],
  "svc.risky": ["cz409:18/e", "cz409:26/4", "cz410:11/c", "iso27001:A.8.9", "iso27001:A.8.20", "cis8:4.8"],
  "svc.timesync": ["cz409:22/6", "cz410:9/2/b", "iso27001:A.8.17", "cis8:8.4"],
  "svc.security_agent": ["cz409:21/2/a", "cz409:21/2/f", "cz410:9/1/b", "iso27001:A.8.7", "iso27001:A.8.16", "cis8:10.1"],
  "log.auditd": ["cz409:22/3/b", "cz409:22/3/c", "cz410:9/2/a", "iso27001:A.8.15", "cis8:8.2", "cis8:8.5"],
  "log.journald": ["cz409:22/5/a", "cz410:9/3", "iso27001:A.8.15", "cis8:8.3"],
  "log.central": ["cz409:22/5/b", "cz410:9/2/a", "iso27001:A.8.15", "cis8:8.9"],
  "upd.security": ["cz409:24/1", "cz409:24/2/b", "cz410:12/a", "iso27001:A.8.8", "cis8:7.3"],
  "upd.auto": ["cz409:24/1", "cz410:12/a", "iso27001:A.8.8", "cis8:7.3"],
  "upd.reboot": ["cz409:24/2/b", "cz410:12/a", "iso27001:A.8.8", "cis8:7.3"],
  "mac.enabled": ["cz409:21/2/d", "iso27001:A.8.7", "iso27001:A.8.9", "cis8:10.5"],
  "mac.complain": ["cz409:21/2/d", "iso27001:A.8.9", "cis8:10.5"],
  "boot.password": ["cz409:13/2/d", "iso27001:A.8.9", "cis8:4.1"],
  "boot.usb_storage": ["cz409:21/2/b", "cz409:21/2/c", "cz410:9/1/c", "iso27001:A.7.10", "cis8:10.3"],
  "boot.fs_modules": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1"],
  "boot.banner": ["cz409:26/4", "iso27001:A.8.9"],
  "ctr.tcp_socket": ["cz409:18/d", "cz409:13/2/d", "cz410:11/d", "iso27001:A.8.2", "iso27001:A.8.20", "cis8:4.1"],
  "ctr.socket": ["cz409:13/2/c", "cz410:7/1/b", "iso27001:A.8.2", "cis8:4.1"],
  "ctr.group": ["cz409:13/2/b", "cz409:13/2/h", "cz410:7/1/a", "cz410:7/1/d", "iso27001:A.8.2", "cis8:5.4"],
  "ctr.userns": ["cz409:13/2/b", "cz410:7/1/a", "iso27001:A.8.2", "iso27001:A.8.9", "cis8:4.1"],
  "ctr.daemon": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1"],
  "ctr.privileged": ["cz409:13/2/b", "cz410:7/1/a", "iso27001:A.8.2", "iso27001:A.8.9", "cis8:4.1", "cis8:5.4"],
  "ctr.engine_socket": ["cz409:13/2/b", "cz410:7/1/a", "iso27001:A.8.2", "iso27001:A.8.9", "cis8:4.1"],
  "ctr.non_root": ["cz409:13/2/b", "cz410:7/1/a", "iso27001:A.8.2", "iso27001:A.8.9", "cis8:4.1"],
  "ctr.readonly": ["cz409:26/4", "iso27001:A.8.9", "cis8:4.1"],
  "ctr.limits": ["cz409:26/1/b", "iso27001:A.8.6", "cis8:4.1"],
};
for (const ch of HARDENING_CHECKS) ch.reqs = HARDENING_REQS[ch.id] ?? [];

/** Hardening k opatření (GET /api/monitors/control-hardening/:id) – kontroly podle požadavků × aktuální servery. */
export interface ControlHardeningDto {
  /** Počet serverů s aktuálním hlášením (≤ 7 dní). */
  hosts: number;
  /** Podíl splněných (server × kontrola) v %, null = nic vyhodnotitelného. */
  score: number | null;
  checks: { id: string; reqs: string[]; pass: number; fail: number; na: number; failing: { inventoryId: string; host: string; actual: string | null }[] }[];
}

/** Kontroly, které jsou důkazem k některému z požadavků (např. požadavky přiřazené k opatření). */
export function hardeningChecksForRequirements(requirementIds: Iterable<string>): HardeningCheck[] {
  const set = new Set(requirementIds);
  return HARDENING_CHECKS.filter((ch) => (ch.reqs ?? []).some((r) => set.has(r)));
}

export const HARDENING_BY_ID = new Map(HARDENING_CHECKS.map((x) => [x.id, x]));

export interface HardeningResult {
  id: string;
  cat: HardeningCategory;
  sev: HardeningSeverity;
  status: HardeningStatus;
  actual: string | null;
}

export interface HardeningSummary {
  /** Vážené skóre 0–100 z ověřitelných kontrol (null = žádná data). */
  score: number | null;
  pass: number;
  fail: number;
  na: number;
  results: HardeningResult[];
}

const WEIGHT: Record<HardeningSeverity, number> = { high: 3, medium: 2, low: 1 };

/** Vyhodnocení hardeningu serveru – jen pokud agent poslal fakta (`inv.hardening`). */
export function evaluateHardening(inv: HostInventory): HardeningSummary {
  const facts = inv.hardening;
  if (!facts) return { score: null, pass: 0, fail: 0, na: 0, results: [] };
  const ctx: Ctx = { f: (k) => facts[k], inv };
  const results: HardeningResult[] = HARDENING_CHECKS.map((ch) => {
    let o: Outcome;
    try {
      o = ch.run(ctx);
    } catch {
      o = NA;
    }
    return { id: ch.id, cat: ch.cat, sev: ch.sev, status: o.s, actual: o.a ?? null };
  });
  let got = 0;
  let max = 0;
  for (const r of results) {
    if (r.status === "na") continue;
    max += WEIGHT[r.sev];
    if (r.status === "pass") got += WEIGHT[r.sev];
  }
  return {
    score: max ? Math.round((got / max) * 100) : null,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    na: results.filter((r) => r.status === "na").length,
    results,
  };
}

/** Anglické popisky pro t.lbl (en.labels.ts). */
export function hardeningEnLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ch of HARDENING_CHECKS) for (const x of [ch.title, ch.expect, ch.why, ch.fix]) out[`lbl:${x.cs}`] = x.en;
  for (const x of Object.values(HARDENING_CATEGORY_LABELS)) out[`lbl:${x.cs}`] = x.en;
  return out;
}
