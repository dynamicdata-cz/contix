/**
 * Kontrola exportu před zveřejněním (v1.15, ADR-112): tajemství, soubory s konfigurací a interní údaje.
 * Vestavěná pravidla hledají obecné vzory (klíče, tokeny, soukromé klíče, .env). Interní údaje (IP adresy,
 * názvy serverů, zákazníků) jsou v lokálním souboru mimo repozitář – jinak by je zveřejnil právě seznam zákazů.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface ScanHit {
  file: string;
  line: number;
  rule: string;
  /** Zkrácený výňatek – hodnotu tajemství nikdy nevypisujeme celou. */
  excerpt: string;
}

/** Konfigurace a dokumentace (ne zdrojový kód – tam jsou klíče objektů a konstanty testů). */
const CONFIG_FILE = /(^|\/)(\.env[^/]*|[^/]*\.(env|example|sh|ya?ml|md|txt|conf|ini|toml|properties)|Caddyfile|Dockerfile[^/]*)$/;

export const PUBLISH_RULES: { id: string; re: RegExp; files?: RegExp }[] = [
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: "gitlab-token", re: /\b(?:glpat|glrt|gldt|glptt|glcbt)-[A-Za-z0-9_-]{16,}/ },
  { id: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { id: "openai-like-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { id: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: "contix-token", re: /\b(?:cxt|cxm)_[A-Za-z0-9_-]{30,}/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  /** Proměnná prostředí / YAML s hodnotou (`ADMIN_PASSWORD=…`, `api_token: …`) – kód s konstantami testů se nekontroluje. */
  { id: "secret-assignment", re: /^\s*(?:export\s+|-\s+)?[A-Za-z0-9_]*(?:PASSWORD|SECRET|API_KEY|TOKEN|password|secret|api_key|token)\s*[=:]\s*(?!<|\$\{|\$\(|"?\$|changeme|change-me|CHANGE|xxx|XXX|""|''|null|~)['"]?[^\s'"#]{8,}/, files: CONFIG_FILE },
];

/** Soubory, které do veřejného repozitáře nepatří nikdy (podle názvu). */
const FORBIDDEN_FILE = /(^|\/)(\.env(\.[^/]*)?|server\.env|.*\.(pem|key|p12|pfx|jks|kdbx)|id_(rsa|ed25519|ecdsa)(\.pub)?|\.npmrc|\.netrc)$/;
const ALLOWED_FILE = /(^|\/)(\.env\.example|server\.env\.example)$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|docx|xlsx|pptx|zip|gz|woff2?|ttf|otf)$/i;

/** Lokální seznam zákazů: jeden výraz na řádek – doslovný text, `re:` regulární výraz, `rei:` bez rozlišení velikosti písmen; # komentář. */
export function parseDenyList(text: string): { id: string; re: RegExp }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l, i) => {
      const ci = l.startsWith("rei:");
      const src = ci ? l.slice(4) : l.startsWith("re:") ? l.slice(3) : l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return { id: `deny#${i + 1}`, re: new RegExp(src, ci ? "i" : "") };
    });
}

const mask = (line: string, re: RegExp) => {
  const m = line.match(re);
  if (!m || m.index == null) return line.slice(0, 80);
  const v = m[0];
  const shown = v.length > 8 ? `${v.slice(0, 4)}…(${v.length})` : "…";
  return `${line.slice(Math.max(0, m.index - 30), m.index)}${shown}${line.slice(m.index + v.length, m.index + v.length + 20)}`.trim().slice(0, 120);
};

/** Kontrola jednoho textového souboru (čistá funkce – testy). */
type Rule = { id: string; re: RegExp; files?: RegExp };

export function scanText(file: string, text: string, deny: Rule[] = []): ScanHit[] {
  const hits: ScanHit[] = [];
  const rules: Rule[] = [...PUBLISH_RULES, ...deny];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes("publish-scan: allow")) continue;
    for (const r of rules) if ((!r.files || r.files.test(file)) && r.re.test(line)) hits.push({ file, line: i + 1, rule: r.id, excerpt: r.id.startsWith("deny") ? line.trim().slice(0, 120) : mask(line, r.re) });
  }
  return hits;
}

/** Kontrola názvu a velikosti souboru. */
export function scanFileMeta(file: string, size: number): ScanHit[] {
  const out: ScanHit[] = [];
  if (FORBIDDEN_FILE.test(file) && !ALLOWED_FILE.test(file)) out.push({ file, line: 0, rule: "forbidden-file", excerpt: "soubor s konfigurací nebo klíčem" });
  if (size > MAX_FILE_BYTES) out.push({ file, line: 0, rule: "large-file", excerpt: `${Math.round(size / 1024 / 1024)} MB` });
  return out;
}

/** Projde adresář exportu (bez .git a node_modules). */
export function scanTree(root: string, deny: { id: string; re: RegExp }[] = []): { files: number; hits: ScanHit[] } {
  const hits: ScanHit[] = [];
  let files = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      files++;
      const rel = relative(root, p).split("\\").join("/");
      hits.push(...scanFileMeta(rel, st.size));
      if (BINARY_EXT.test(name) || st.size > MAX_FILE_BYTES) continue;
      hits.push(...scanText(rel, readFileSync(p, "utf8"), deny));
    }
  };
  walk(root);
  return { files, hits };
}
