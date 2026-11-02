import type { VulnPriority } from "./vulnIntel";
import type { VulnStatus } from "./vuln";

/* ============================================================
 * Detail zranitelnosti a postup odstranění (v0.80, ADR-076).
 * Pevná část (bez AI): rodina OS podle aktiva, příkaz správce balíčků, ověření.
 * AI rozbor: strukturovaný JSON z modelu (`parseVulnAdvice`) – jen návrh, uloží se k CVE a společnosti.
 * Modelu jdou údaje o CVE, balíčcích, verzích a OS – nikdy názvy aktiv, hostitelů ani jména osob.
 * ============================================================ */

export const OS_FAMILIES = ["debian", "rhel", "suse", "alpine", "arch", "windows", "macos", "other"] as const;
export type OsFamily = (typeof OS_FAMILIES)[number];

export const OS_FAMILY_LABELS: Record<OsFamily, string> = {
  debian: "Debian / Ubuntu",
  rhel: "Red Hat / Rocky / Alma / CentOS / Fedora",
  suse: "SUSE",
  alpine: "Alpine",
  arch: "Arch",
  windows: "Windows",
  macos: "macOS",
  other: "Jiný / neznámý OS",
};

/** Rodina OS podle názvu systému z inventáře (Wazuh, sken). */
export function osFamilyOf(os: string | null | undefined): OsFamily {
  const s = (os ?? "").toLowerCase();
  if (!s) return "other";
  if (/windows/.test(s)) return "windows";
  if (/mac ?os|darwin|os x/.test(s)) return "macos";
  if (/ubuntu|debian|mint|kali|raspbian|pop!?_?os/.test(s)) return "debian";
  if (/red ?hat|rhel|centos|rocky|alma|fedora|oracle linux|amazon linux/.test(s)) return "rhel";
  if (/suse|sles/.test(s)) return "suse";
  if (/alpine/.test(s)) return "alpine";
  if (/arch|manjaro/.test(s)) return "arch";
  return "other";
}

const SAFE_PKG = /^[A-Za-z0-9][A-Za-z0-9+._:~-]{0,200}$/;

/** Příkaz pro aktualizaci balíčku na nejnovější verzi z repozitáře distribuce (null = jen ručně / aktualizace systému). */
export function upgradeCommand(family: OsFamily, pkg: string): string | null {
  const p = pkg.trim();
  if (family === "windows") return null;
  if (family === "macos") return "softwareupdate --list && sudo softwareupdate --install --all";
  // název balíčku z inventáře vkládáme do příkazu jen bez mezer a speciálních znaků
  if (!SAFE_PKG.test(p)) return null;
  switch (family) {
    case "debian":
      return `sudo apt-get update && sudo apt-get install --only-upgrade ${p}`;
    case "rhel":
      return `sudo dnf upgrade --refresh ${p}   # starší systémy: sudo yum update ${p}`;
    case "suse":
      return `sudo zypper refresh && sudo zypper update ${p}`;
    case "alpine":
      return `sudo apk update && sudo apk upgrade ${p}`;
    case "arch":
      return `sudo pacman -Syu ${p}`;
    default:
      return null;
  }
}

/** Příkaz k ověření nainstalované verze po opravě. */
export function verifyCommand(family: OsFamily, pkg: string): string | null {
  const p = pkg.trim();
  if (!SAFE_PKG.test(p)) return null;
  switch (family) {
    case "debian":
      return `dpkg -l ${p}`;
    case "rhel":
    case "suse":
      return `rpm -q ${p}`;
    case "alpine":
      return `apk info -v ${p}`;
    case "arch":
      return `pacman -Q ${p}`;
    case "windows":
      return `Get-Package -Name "*${p}*"   # nebo: winget list --name "${p}"`;
    default:
      return null;
  }
}

export interface VulnOccurrence {
  id: string;
  assetId: string;
  assetName: string;
  companyId: string;
  osName: string | null;
  osFamily: OsFamily;
  packageName: string;
  packageVersion: string;
  status: VulnStatus;
  priority: VulnPriority;
  due: string | null;
  overdue: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Postup za rodinu OS a balíček (pevná část bez AI). */
export interface VulnFixGroup {
  osFamily: OsFamily;
  packageName: string;
  versions: string[];
  assets: number;
  command: string | null;
  verify: string | null;
}

export interface VulnAdvice {
  /** Co je zranitelnost (2–4 věty). */
  summary: string;
  /** Dopad při zneužití a na co v organizaci. */
  impact: string;
  /** Zneužitelnost – vzdáleně / lokálně, nutná autentizace, známé zneužití. */
  exploitation: string;
  /** Kroky odstranění v pořadí. */
  remediation: string[];
  /** Dočasná opatření, když opravu nelze nasadit hned. */
  workaround: string[];
  /** Jak ověřit, že je oprava účinná. */
  verification: string[];
  /** Odkazy (výrobce, NVD, bulletin). */
  references: string[];
  /** Nejistota modelu – co ověřit u výrobce. */
  caveats: string;
}

export interface VulnAdviceDto extends VulnAdvice {
  model: string;
  generatedAt: string;
  locale: string;
  durationMs: number;
}

export interface VulnCveDetail {
  cveId: string;
  severity: string;
  cvss: number | null;
  description: string | null;
  reference: string | null;
  publishedAt: string | null;
  kev: boolean;
  kevName: string | null;
  kevDateAdded: string | null;
  kevDueDate: string | null;
  kevRansomware: boolean;
  epss: number | null;
  epssPercentile: number | null;
  /** Nejvyšší priorita z otevřených výskytů (jinak z prvního). */
  priority: VulnPriority;
  open: number;
  occurrences: VulnOccurrence[];
  fix: VulnFixGroup[];
  advice: VulnAdviceDto | null;
  aiAvailable: boolean;
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, n = 12) =>
  (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(/\n+/) : [])
    .map((x) => (typeof x === "string" ? x : typeof x === "object" && x ? String((x as { text?: unknown; step?: unknown }).text ?? (x as { step?: unknown }).step ?? JSON.stringify(x)) : String(x)))
    .map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim().slice(0, 800))
    .filter(Boolean)
    .slice(0, n);

/** Odpověď modelu → strukturovaný rozbor. Snese bloky ```json, text okolo i chybějící pole; bez JSON vrátí text jako shrnutí. */
export function parseVulnAdvice(text: string): VulnAdvice {
  const clean = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const a = clean.indexOf("{");
  const b = clean.lastIndexOf("}");
  let o: Record<string, unknown> | null = null;
  if (a >= 0 && b > a) {
    try {
      o = JSON.parse(clean.slice(a, b + 1));
    } catch {
      o = null;
    }
  }
  if (!o) return { summary: clean.slice(0, 4000) || "—", impact: "", exploitation: "", remediation: [], workaround: [], verification: [], references: [], caveats: "" };
  return {
    summary: str(o.summary) || "—",
    impact: str(o.impact),
    exploitation: str(o.exploitation),
    remediation: list(o.remediation, 15),
    workaround: list(o.workaround),
    verification: list(o.verification),
    references: list(o.references, 8).filter((x) => /^https?:\/\/\S+$/.test(x)),
    caveats: str(o.caveats, 1000),
  };
}


