import { z } from "zod";

/* ============================================================
 * Sběrač ze serverů (v1.51, ADR-148): účty, otisky SSH klíčů, kontejnery a image, služby, naslouchající porty
 * a firewall z linuxového serveru → CONTIX (připojení typu `collector`, token). Jen čtení; celé klíče se neposílají.
 * Vyhodnocení shody (`evaluateHost`) je čistá funkce – stejná v API i v testech.
 * ============================================================ */

const s = (max: number) => z.string().trim().max(max);
const list = <T extends z.ZodTypeAny>(t: T, max: number) => z.array(t).max(max).default([]);

export const HostInventoryInput = z.object({
  collectorVersion: s(20).default(""),
  collectedAt: z.string().datetime({ offset: true }),
  host: z.object({
    hostname: s(255).min(1),
    fqdn: s(255).nullable().default(null),
    /** /etc/machine-id – stálá identita i při přejmenování. */
    machineId: s(64).nullable().default(null),
    os: s(200).nullable().default(null),
    kernel: s(200).nullable().default(null),
    ips: list(s(64), 64),
  }),
  users: list(
    z.object({
      name: s(64).min(1),
      uid: z.number().int().min(0),
      shell: s(200).default(""),
      home: s(300).default(""),
      /** Člen sudo / wheel / admin. */
      sudo: z.boolean().default(false),
      /** Heslo zamčené nebo bez hesla (přihlášení jen klíčem / vůbec). */
      locked: z.boolean().default(false),
      lastLogin: s(40).nullable().default(null),
    }),
    2000,
  ),
  sshKeys: list(
    z.object({
      user: s(64).min(1),
      type: s(40),
      bits: z.number().int().min(0).max(65536).nullable().default(null),
      fingerprint: s(120).min(1),
      comment: s(300).default(""),
      options: list(s(300), 20),
    }),
    5000,
  ),
  containers: list(
    z.object({
      name: s(255).min(1),
      image: s(500),
      imageId: s(100).nullable().default(null),
      status: s(100).default(""),
      privileged: z.boolean().default(false),
      /** Uživatel procesu v kontejneru (prázdné = root). */
      user: s(100).default(""),
      ports: list(s(100), 100),
      project: s(200).nullable().default(null),
    }),
    2000,
  ),
  images: list(z.object({ repo: s(500), tag: s(200).default(""), id: s(100).default(""), created: s(60).nullable().default(null) }), 5000),
  services: list(z.object({ name: s(200).min(1), state: s(40), enabled: z.boolean().nullable().default(null) }), 5000),
  listening: list(z.object({ proto: s(10), address: s(100), port: z.number().int().min(0).max(65535), process: s(200).nullable().default(null) }), 5000),
  firewall: z
    .object({
      tool: z.enum(["nftables", "iptables", "none"]),
      /** SHA-256 běžících pravidel. */
      rulesHash: s(64).nullable().default(null),
      /** SHA-256 uložené konfigurace (/etc/nftables.conf, /etc/iptables/rules.v4 …); null = nic uloženo. */
      savedHash: s(64).nullable().default(null),
      defaultInput: z.enum(["accept", "drop", "reject"]).nullable().default(null),
      ruleCount: z.number().int().min(0).default(0),
    })
    .default({ tool: "none", rulesHash: null, savedHash: null, defaultInput: null, ruleCount: 0 }),
  /** Nainstalované balíčky (agent CONTIX, ADR-177). */
  packages: list(z.object({ name: s(200).min(1), version: s(200).default(""), arch: s(40).default("") }), 50000),
  /** Plánované úlohy (agent CONTIX): cron bez příkazu (jen program a otisk řádku), systemd timery. */
  scheduled: list(z.object({ source: s(300), user: s(100).default(""), schedule: s(200).default(""), program: s(300).default(""), state: s(40).default("") }), 2000),
  /** Systém (sběrač 1.1+): běh, restart, aktualizace. */
  system: z
    .object({
      bootedAt: s(40).nullable().default(null),
      uptimeSeconds: z.number().int().min(0).nullable().default(null),
      rebootRequired: z.boolean().nullable().default(null),
      packageManager: s(20).nullable().default(null),
      updatesPending: z.number().int().min(0).nullable().default(null),
      securityUpdates: z.number().int().min(0).nullable().default(null),
      autoUpdates: z.boolean().nullable().default(null),
      /** Prvních až 50 balíčků k aktualizaci (bezpečnostní první). */
      updates: list(z.object({ name: s(200), version: s(200).default(""), security: z.boolean().default(false) }), 50),
    })
    .nullable()
    .default(null),
  /** Efektivní nastavení SSH serveru (`sshd -T`, sběrač 1.1+). */
  sshd: z
    .object({
      permitRootLogin: s(40).nullable().default(null),
      passwordAuthentication: z.boolean().nullable().default(null),
      permitEmptyPasswords: z.boolean().nullable().default(null),
      pubkeyAuthentication: z.boolean().nullable().default(null),
      x11Forwarding: z.boolean().nullable().default(null),
      maxAuthTries: z.number().int().min(0).nullable().default(null),
      ports: list(z.number().int().min(0).max(65535), 20),
      allowUsers: list(s(100), 200),
    })
    .nullable()
    .default(null),
});
export type HostInventoryInput = z.input<typeof HostInventoryInput>;
export type HostInventory = z.infer<typeof HostInventoryInput>;

export const HOST_FINDING_CODES = [
  "uid0_user",
  "ssh_key_weak",
  "ssh_key_root",
  "ssh_key_unlabeled",
  "container_privileged",
  "container_root",
  "fw_none",
  "fw_default_accept",
  "fw_not_persistent",
  "sshd_root_login",
  "sshd_password_auth",
  "sshd_empty_passwords",
  "updates_security",
  "updates_pending",
  "reboot_required",
  "no_auto_updates",
  "service_failed",
] as const;
export type HostFindingCode = (typeof HOST_FINDING_CODES)[number];

export interface HostFinding {
  code: HostFindingCode;
  severity: "high" | "medium" | "low";
  /** Čeho se týká (uživatel, otisk klíče, kontejner). */
  subject: string | null;
}

/** Minimální délka RSA klíče (bity) – NÚKIB doporučuje 3072. */
export const RSA_MIN_BITS = 3072;

/** Shoda serveru: slabé a neoznačené klíče, klíče roota, privilegované kontejnery, firewall. */
export function evaluateHost(inv: HostInventory): HostFinding[] {
  const out: HostFinding[] = [];
  for (const u of inv.users) if (u.uid === 0 && u.name !== "root") out.push({ code: "uid0_user", severity: "high", subject: u.name });
  for (const k of inv.sshKeys) {
    const t = k.type.toLowerCase();
    if (t === "ssh-dss" || (t.includes("dsa") && !t.includes("ecdsa"))) out.push({ code: "ssh_key_weak", severity: "high", subject: `${k.user}: ${k.fingerprint}` });
    else if (t.includes("rsa") && k.bits != null && k.bits < RSA_MIN_BITS) out.push({ code: "ssh_key_weak", severity: k.bits < 2048 ? "high" : "medium", subject: `${k.user}: ${k.fingerprint} (${k.bits})` });
    if (k.user === "root") out.push({ code: "ssh_key_root", severity: "medium", subject: k.comment || k.fingerprint });
    if (!k.comment.trim()) out.push({ code: "ssh_key_unlabeled", severity: "low", subject: `${k.user}: ${k.fingerprint}` });
  }
  for (const c of inv.containers) {
    if (c.privileged) out.push({ code: "container_privileged", severity: "high", subject: c.name });
    else if (!c.user.trim() || c.user === "root" || c.user === "0" || c.user.startsWith("0:")) out.push({ code: "container_root", severity: "medium", subject: c.name });
  }
  const fw = inv.firewall;
  if (fw.tool === "none") out.push({ code: "fw_none", severity: "high", subject: null });
  else {
    if (fw.defaultInput === "accept") out.push({ code: "fw_default_accept", severity: "high", subject: fw.tool });
    if (fw.rulesHash && fw.rulesHash !== fw.savedHash) out.push({ code: "fw_not_persistent", severity: "medium", subject: fw.tool });
  }
  const sd = inv.sshd;
  if (sd) {
    if (sd.permitRootLogin?.toLowerCase() === "yes") out.push({ code: "sshd_root_login", severity: "high", subject: "PermitRootLogin yes" });
    if (sd.passwordAuthentication === true) out.push({ code: "sshd_password_auth", severity: "medium", subject: "PasswordAuthentication yes" });
    if (sd.permitEmptyPasswords === true) out.push({ code: "sshd_empty_passwords", severity: "high", subject: "PermitEmptyPasswords yes" });
  }
  const sy = inv.system;
  if (sy) {
    if (sy.securityUpdates) out.push({ code: "updates_security", severity: "medium", subject: String(sy.securityUpdates) });
    else if (sy.updatesPending) out.push({ code: "updates_pending", severity: "low", subject: String(sy.updatesPending) });
    if (sy.rebootRequired) out.push({ code: "reboot_required", severity: "low", subject: null });
    if (sy.autoUpdates === false) out.push({ code: "no_auto_updates", severity: "low", subject: sy.packageManager });
  }
  for (const sv of inv.services) if (sv.state === "failed") out.push({ code: "service_failed", severity: "low", subject: sv.name });
  return out;
}

export const HOST_FINDING_LABELS: Record<HostFindingCode, string> = {
  uid0_user: "Další účet s UID 0 (práva roota)",
  ssh_key_weak: "Slabý SSH klíč (DSA nebo RSA kratší než 3072 bitů)",
  ssh_key_root: "SSH klíč pro přímé přihlášení roota",
  ssh_key_unlabeled: "SSH klíč bez komentáře – není jasné, čí je",
  container_privileged: "Privilegovaný kontejner (--privileged)",
  container_root: "Kontejner běží jako root",
  fw_none: "Firewall není nastaven (žádná pravidla iptables / nftables)",
  fw_default_accept: "Výchozí politika příchozího provozu je ACCEPT",
  fw_not_persistent: "Pravidla firewallu nejsou uložena – po restartu se ztratí",
  sshd_root_login: "SSH server povoluje přihlášení roota heslem",
  sshd_password_auth: "SSH server povoluje přihlášení heslem",
  sshd_empty_passwords: "SSH server povoluje prázdná hesla",
  updates_security: "Čekají bezpečnostní aktualizace",
  updates_pending: "Čekají aktualizace balíčků",
  reboot_required: "Server čeká na restart (nové jádro nebo knihovny)",
  no_auto_updates: "Automatické bezpečnostní aktualizace nejsou zapnuté",
  service_failed: "Služba skončila chybou",
};

/** Proč nález vadí a jak ho opravit (cs; en přes popisky). Příkazy jsou ukázky pro Debian/Ubuntu a RHEL. */
export const HOST_FINDING_GUIDE: Record<HostFindingCode, { why: string; fix: string }> = {
  uid0_user: { why: "Účet s UID 0 má plná práva roota pod jiným jménem – obchází dohled nad privilegovanými účty a bývá znakem průniku.", fix: "Ověřte, kdo účet založil (auditní záznamy, /var/log/auth.log). Pokud není nutný: userdel <účet>; jinak mu přidělte vlastní UID a práva přes sudo." },
  ssh_key_weak: { why: "Klíče DSA a RSA kratší než 3072 bitů nesplňují doporučení NÚKIB pro kryptografické prostředky.", fix: "Vygenerujte nový klíč (ssh-keygen -t ed25519), vložte ho do authorized_keys a starý řádek odstraňte." },
  ssh_key_root: { why: "Přímé přihlášení roota klíčem neukáže, kdo se přihlásil – chybí osobní odpovědnost.", fix: "Přihlašujte se osobním účtem a používejte sudo; klíč z /root/.ssh/authorized_keys odeberte a nastavte PermitRootLogin no." },
  ssh_key_unlabeled: { why: "Bez komentáře nejde poznat, komu klíč patří – při odchodu zaměstnance se nedá spolehlivě odebrat.", fix: "Doplňte na konec řádku v authorized_keys komentář (jméno, zařízení), nebo klíč odeberte, pokud ho nikdo nezná." },
  container_privileged: { why: "Privilegovaný kontejner má přístup k zařízením hostitele – únik z kontejneru znamená root na serveru.", fix: "Odeberte privileged: true a přidejte jen potřebné cap_add / devices." },
  container_root: { why: "Proces v kontejneru běží jako root – zranitelnost v aplikaci dává větší možnosti útočníkovi.", fix: "Nastavte v Dockerfile nebo compose user: \"1000:1000\" (nebo neprivilegovaného uživatele image)." },
  fw_none: { why: "Bez firewallu jsou dostupné všechny naslouchající služby, i ty určené jen pro localhost nebo správu.", fix: "Zapněte firewall: ufw default deny incoming && ufw allow 22/tcp && ufw enable (Debian/Ubuntu), nebo firewalld (RHEL)." },
  fw_default_accept: { why: "Výchozí ACCEPT propustí vše, co není výslovně zakázané – nová služba je hned dostupná zvenku.", fix: "Nastavte výchozí politiku drop a povolte jen potřebné porty (ufw default deny incoming / firewall-cmd --set-target=DROP)." },
  fw_not_persistent: { why: "Běžící pravidla se liší od uložených – po restartu se server otevře nebo naběhnou stará pravidla.", fix: "Uložte pravidla: netfilter-persistent save (Debian), service iptables save (RHEL), nebo firewall-cmd --runtime-to-permanent." },
  sshd_root_login: { why: "Root s heslem je hlavní cíl útoků hrubou silou a nepřiřaditelný účet.", fix: "V /etc/ssh/sshd_config nastavte PermitRootLogin no (nebo prohibit-password) a systemctl reload sshd." },
  sshd_password_auth: { why: "Hesla jdou hádat a odchytit; klíče jsou výrazně odolnější.", fix: "Po nasazení klíčů nastavte PasswordAuthentication no a systemctl reload sshd." },
  sshd_empty_passwords: { why: "Účet bez hesla se přihlásí bez jakéhokoli ověření.", fix: "Nastavte PermitEmptyPasswords no a účtům bez hesla heslo zamkněte (passwd -l)." },
  updates_security: { why: "Nenainstalované bezpečnostní opravy jsou nejčastější vstupní bod útočníka (vyhláška 409/2025 – řízení zranitelností).", fix: "apt-get update && apt-get upgrade (Debian/Ubuntu) nebo dnf upgrade --security (RHEL); naplánujte okno údržby." },
  updates_pending: { why: "Starší balíčky časem nasbírají zranitelnosti a ztíží pozdější aktualizaci.", fix: "Naplánujte pravidelnou aktualizaci (apt-get upgrade / dnf upgrade)." },
  reboot_required: { why: "Nové jádro nebo knihovny jsou nainstalované, ale běží stará zranitelná verze.", fix: "Restartujte server v okně údržby." },
  no_auto_updates: { why: "Bez automatických bezpečnostních aktualizací závisí oprava na ručním zásahu.", fix: "apt install unattended-upgrades && dpkg-reconfigure unattended-upgrades (Debian/Ubuntu), nebo dnf install dnf-automatic && systemctl enable --now dnf-automatic-install.timer (RHEL)." },
  service_failed: { why: "Služba neběží – může jít o výpadek monitoringu, zálohování nebo bezpečnostního agenta.", fix: "systemctl status <služba> a journalctl -u <služba>; opravte nebo službu vypněte (systemctl disable)." },
};

/* ---------- Změny mezi inventáři (v1.55) ---------- */

export const HOST_CHANGE_KINDS = [
  "user_added",
  "user_removed",
  "sudo_granted",
  "sudo_revoked",
  "key_added",
  "key_removed",
  "container_added",
  "container_removed",
  "container_image",
  "port_opened",
  "port_closed",
  "service_added",
  "service_removed",
  "firewall_changed",
  "sshd_changed",
  "os_changed",
  "finding_new",
  "finding_resolved",
] as const;
export type HostChangeKind = (typeof HOST_CHANGE_KINDS)[number];
export interface HostChange {
  kind: HostChangeKind;
  subject: string;
}

export const HOST_CHANGE_LABELS: Record<HostChangeKind, string> = {
  user_added: "Nový účet",
  user_removed: "Odebraný účet",
  sudo_granted: "Nové právo sudo",
  sudo_revoked: "Odebrané právo sudo",
  key_added: "Nový SSH klíč",
  key_removed: "Odebraný SSH klíč",
  container_added: "Nový kontejner",
  container_removed: "Odebraný kontejner",
  container_image: "Kontejner s jiným image",
  port_opened: "Nový naslouchající port",
  port_closed: "Zavřený port",
  service_added: "Nová služba",
  service_removed: "Odebraná služba",
  firewall_changed: "Změna pravidel firewallu",
  sshd_changed: "Změna nastavení SSH serveru",
  os_changed: "Změna systému nebo jádra",
  finding_new: "Nový nález",
  finding_resolved: "Vyřešený nález",
};

const portKey = (p: HostInventory["listening"][number]) => `${p.proto}/${p.port}${p.process ? ` (${p.process})` : ""}`;

/** Co se změnilo od minulého inventáře (bez šumu: porty podle protokolu a čísla, služby jen přidané / odebrané). */
export function diffHostInventory(prev: HostInventory, next: HostInventory): HostChange[] {
  const out: HostChange[] = [];
  const setDiff = (a: Iterable<string>, b: Iterable<string>, add: HostChangeKind, rem: HostChangeKind) => {
    const A = new Set(a);
    const B = new Set(b);
    for (const x of B) if (!A.has(x)) out.push({ kind: add, subject: x });
    for (const x of A) if (!B.has(x)) out.push({ kind: rem, subject: x });
  };
  setDiff(prev.users.map((u) => u.name), next.users.map((u) => u.name), "user_added", "user_removed");
  const ps = new Map(prev.users.map((u) => [u.name, u.sudo]));
  for (const u of next.users) if (ps.has(u.name) && ps.get(u.name) !== u.sudo) out.push({ kind: u.sudo ? "sudo_granted" : "sudo_revoked", subject: u.name });
  const key = (k: HostInventory["sshKeys"][number]) => `${k.user}: ${k.fingerprint}${k.comment ? ` (${k.comment})` : ""}`;
  setDiff(prev.sshKeys.map(key), next.sshKeys.map(key), "key_added", "key_removed");
  setDiff(prev.containers.map((c) => c.name), next.containers.map((c) => c.name), "container_added", "container_removed");
  const pc = new Map(prev.containers.map((c) => [c.name, c.image]));
  for (const c of next.containers) if (pc.has(c.name) && pc.get(c.name) !== c.image) out.push({ kind: "container_image", subject: `${c.name}: ${pc.get(c.name)} → ${c.image}` });
  const ports = (l: HostInventory["listening"]) => [...new Map(l.map((p) => [`${p.proto}/${p.port}`, portKey(p)])).entries()];
  const pp = new Map(ports(prev.listening));
  const np = new Map(ports(next.listening));
  for (const [k, v] of np) if (!pp.has(k)) out.push({ kind: "port_opened", subject: v });
  for (const [k, v] of pp) if (!np.has(k)) out.push({ kind: "port_closed", subject: v });
  setDiff(prev.services.map((s) => s.name), next.services.map((s) => s.name), "service_added", "service_removed");
  if (prev.firewall.rulesHash !== next.firewall.rulesHash || prev.firewall.defaultInput !== next.firewall.defaultInput) out.push({ kind: "firewall_changed", subject: `${next.firewall.tool}, ${next.firewall.ruleCount}` });
  if (prev.sshd && next.sshd && JSON.stringify(prev.sshd) !== JSON.stringify(next.sshd)) out.push({ kind: "sshd_changed", subject: next.sshd.permitRootLogin ?? "" });
  if (prev.host.os !== next.host.os || prev.host.kernel !== next.host.kernel) out.push({ kind: "os_changed", subject: `${next.host.os ?? "?"} · ${next.host.kernel ?? "?"}` });
  const f = (inv: HostInventory) => evaluateHost(inv).map((x) => `${x.code}${x.subject ? `|${x.subject}` : ""}`);
  setDiff(f(prev), f(next), "finding_new", "finding_resolved");
  return out.slice(0, 500);
}

export interface HostChangeDto {
  collectedAt: string;
  changes: HostChange[];
}

/** Přiřazení serveru k aktivu (agenti CONTIX, ADR-177): id = spárovat s existujícím, null = založit aktivum z inventáře. */
export const HostAssetInput = z.object({ assetId: z.string().uuid().nullable() });
export type HostAssetInput = z.input<typeof HostAssetInput>;

export interface HostDetailDto extends HostInventoryDto {
  changes: HostChangeDto[];
  /** Porty dostupné ze sítě podle posledního testu sondou (v1.56); prázdné = netestováno. */
  reachable: { port: number; proto: string; service: string; at: string | null }[];
}

export interface HostInventoryDto {
  id: string;
  connectionId: string;
  connectionName: string;
  assetId: string | null;
  assetName: string | null;
  companyId: string;
  hostname: string;
  collectedAt: string;
  findings: HostFinding[];
  data: HostInventory;
}

export interface HostSummaryDto {
  id: string;
  assetId: string | null;
  hostname: string;
  os: string | null;
  collectorVersion: string;
  /** Čekající bezpečnostní aktualizace (sběrač 1.1+; null = neznámo). */
  securityUpdates: number | null;
  connectionName: string;
  collectedAt: string;
  users: number;
  sshKeys: number;
  containers: number;
  high: number;
  medium: number;
  low: number;
}

/* ---------- nálezy serveru s životním cyklem (v1.65, ADR-158) ---------- */

export const HOST_FINDING_STATUSES = ["open", "fixed", "accepted", "false_positive"] as const;
export type HostFindingStatus = (typeof HOST_FINDING_STATUSES)[number];

export const HostFindingPatch = z
  .object({
    status: z.enum(HOST_FINDING_STATUSES),
    note: z.string().trim().max(2000).nullable().optional(),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .refine((v) => (v.status !== "accepted" && v.status !== "false_positive") || (v.note ?? "").length >= 5, { message: "Přijetí rizika vyžaduje zdůvodnění (alespoň 5 znaků)", path: ["note"] });
export type HostFindingPatch = z.input<typeof HostFindingPatch>;
