import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Modelování hrozeb podle reality prostředí (v1.40, ADR-137) – deterministicky, bez AI:
 *  1. útočné cesty z grafu aktiv (vstup z internetu / phishing → korunní klenoty, kroky ATT&CK, úzká hrdla),
 *  2. kalibrace dopadu a pravděpodobnosti z dat (BIA, incidenty, alerty, expozice, účinnost opatření),
 *  3. relevantní aktéři hrozeb pro odvětví (katalog + zmínky NÚKIB / CERT, MISP, techniky v SOC) → váha scénářů,
 *  4. řízený threat modeling STRIDE (prvky, toky, zóny důvěry → hrozby → rizika a bezpečnostní požadavky).
 * Nic se nepoužije samo: riziko vznikne jen na pokyn člověka (POST /api/risks), hodnoty kalibrace jsou návrh.
 * ============================================================ */

const clampLvl = (v: number, n: number) => Math.min(n, Math.max(1, Math.round(v)));
export type Reason = { text: string; params?: Record<string, string | number> };

/* ---------- 1. útočné cesty ---------- */

export interface PathNode {
  id: string;
  name: string;
  assetType: string;
  assetClass: string;
  criticality: "low" | "medium" | "high" | "critical";
  cia: { c: number | null; i: number | null; a: number | null };
  internetFacing: boolean;
  /** Otevřené zranitelnosti: z katalogu KEV, kritické a vysoké. */
  kev: number;
  critical: number;
  high: number;
  noEdr: boolean;
  eol: boolean;
  /** Síťový segment (podle IP adres aktiva). */
  segment: string | null;
}
export interface PathEdge {
  /** `from` závisí na `to` (aplikace běží na serveru) / u vazby primární → podpůrné aktivum. */
  from: string;
  to: string;
  kind: "runs_on" | "uses" | "network" | "located_in" | "backup" | "link";
}
export interface PathInput {
  nodes: PathNode[];
  edges: PathEdge[];
  identity: { known: boolean; privileged: number; privNoMfa: number; mfaGap: number; kerberosWeak: number };
  /** Stav schopnosti segmentace (měřené / deklarované). */
  segmentation: "strong" | "partial" | "weak" | "unknown";
  levels: number;
  maxPaths?: number;
}
export interface AttackStep {
  assetId: string;
  assetName: string;
  technique: string;
  /** Snadnost kroku 0–1 (odhad podle doložených slabin). */
  ease: number;
  reason: Reason;
}
export interface AttackPath {
  key: string;
  entry: "internet" | "phishing";
  entryId: string;
  targetId: string;
  targetName: string;
  targetCriticality: string;
  steps: AttackStep[];
  /** Součin snadností kroků. */
  probability: number;
  /** Úroveň pravděpodobnosti na stupnici metodiky. */
  level: number;
  techniques: string[];
  assetIds: string[];
}
export interface Chokepoint {
  assetId: string;
  assetName: string;
  paths: number;
  /** Doložené slabiny, jejichž odstranění cesty přeruší / zkomplikuje. */
  fixes: string[];
}
export interface AttackPathsResult {
  paths: AttackPath[];
  chokepoints: Chokepoint[];
  entries: number;
  targets: number;
  lowConfidence: boolean;
}

export const IDENTITY_NODE = "identity:domain";
const ENDPOINT = new Set(["workstation", "laptop"]);
const HOSTS = new Set(["server", "virtual_machine", "workstation", "laptop", "container", "database", "application", "storage", "cloud_resource", "network_device", "security_device", "iot_ot"]);

/** Cíle útoku: kritická / důležitá primární aktiva (při jejich absenci kritická podpůrná aktiva s daty). */
export function attackTargets(nodes: PathNode[]): PathNode[] {
  const important = (n: PathNode) => n.criticality === "critical" || n.criticality === "high" || Math.max(n.cia.c ?? 0, n.cia.i ?? 0, n.cia.a ?? 0) >= 3;
  const prim = nodes.filter((n) => n.assetClass === "primary" && important(n));
  if (prim.length) return prim;
  return nodes.filter((n) => (n.assetType === "database" || n.assetType === "storage" || n.assetType === "application") && important(n));
}

/** Úroveň pravděpodobnosti z pravděpodobnosti cesty (1 = jistá → nejvyšší stupeň, 0,01 → nejnižší). */
export function pathLevel(p: number, n: number): number {
  return clampLvl(n * (1 + Math.log10(Math.max(p, 1e-6)) / 2.2), n);
}

/** Technika závěrečného kroku podle nejvyšší ohrožené složky CIA cíle. */
function impactStep(t: PathNode): { technique: string; text: string } {
  const c = t.cia.c ?? 0;
  const i = t.cia.i ?? 0;
  const a = t.cia.a ?? 0;
  if (a >= c && a >= i) return { technique: "T1486", text: "tm.step.encrypt" };
  if (c >= i) return { technique: "T1567", text: "tm.step.exfil" };
  return { technique: "T1565", text: "tm.step.manipulate" };
}

type Move = { to: string; ease: number; technique: string; reason: Reason };

/** Vstupní kroky a pohyby útočníka – snadnost podle doložených slabin cíle kroku. */
function buildMoves(x: PathInput) {
  const byId = new Map(x.nodes.map((n) => [n.id, n]));
  const moves = new Map<string, Move[]>();
  const add = (from: string, m: Move) => {
    if (from === m.to) return;
    const l = moves.get(from) ?? [];
    const prev = l.find((y) => y.to === m.to);
    if (prev && prev.ease >= m.ease) return;
    if (prev) l.splice(l.indexOf(prev), 1);
    l.push(m);
    moves.set(from, l);
  };
  const exploit = (n: PathNode, base: number): { ease: number; technique: string; reason: Reason } => {
    if (n.kev > 0) return { ease: 0.85, technique: "T1210", reason: { text: "tm.why.kev", params: { n: n.kev } } };
    if (n.critical > 0) return { ease: Math.max(base, 0.6), technique: "T1210", reason: { text: "tm.why.critical", params: { n: n.critical } } };
    if (n.eol) return { ease: Math.max(base, 0.55), technique: "T1210", reason: { text: "tm.why.eol" } };
    if (n.high > 0) return { ease: Math.max(base, 0.45), technique: "T1210", reason: { text: "tm.why.high", params: { n: n.high } } };
    return { ease: base, technique: "T1021", reason: { text: "tm.why.remote" } };
  };
  const edrBonus = (n: PathNode, e: number) => (n.noEdr ? Math.min(0.95, e * 1.25) : e);
  // vstupy
  const entries: { id: string; entry: "internet" | "phishing"; ease: number; technique: string; reason: Reason }[] = [];
  for (const n of x.nodes) {
    if (n.internetFacing && n.assetClass !== "primary") {
      if (n.kev > 0) entries.push({ id: n.id, entry: "internet", ease: 0.9, technique: "T1190", reason: { text: "tm.why.entryKev", params: { n: n.kev } } });
      else if (n.critical > 0) entries.push({ id: n.id, entry: "internet", ease: 0.7, technique: "T1190", reason: { text: "tm.why.entryCritical", params: { n: n.critical } } });
      else if (x.identity.mfaGap > 0) entries.push({ id: n.id, entry: "internet", ease: 0.45, technique: "T1078", reason: { text: "tm.why.entryNoMfa", params: { n: x.identity.mfaGap } } });
      else entries.push({ id: n.id, entry: "internet", ease: n.high > 0 || n.eol ? 0.4 : 0.25, technique: "T1133", reason: { text: "tm.why.entryExposed" } });
    }
  }
  const endpoints = x.nodes.filter((n) => ENDPOINT.has(n.assetType));
  // phishing: reprezentativně nejslabší koncové stanice (bez EDR / se zranitelnostmi), nejvýš 5
  const phish = [...endpoints].sort((a, b) => Number(b.noEdr) - Number(a.noEdr) || b.kev + b.critical - (a.kev + a.critical)).slice(0, 5);
  for (const n of phish) {
    const e = x.identity.mfaGap > 0 ? 0.45 : 0.3;
    entries.push({ id: n.id, entry: "phishing", ease: edrBonus(n, e), technique: "T1566", reason: { text: n.noEdr ? "tm.why.phishNoEdr" : "tm.why.phish" } });
  }
  // závislosti
  for (const d of x.edges) {
    const a = byId.get(d.from);
    const b = byId.get(d.to);
    if (!a || !b) continue;
    if (d.kind === "link") {
      // podpůrné → primární: kdo ovládá podpůrné aktivum, ovládá i informace / službu na něm
      add(b.id, { to: a.id, ease: 0.95, technique: impactStep(a).technique, reason: { text: impactStep(a).text } });
      continue;
    }
    if (d.kind === "located_in") continue;
    if (d.kind === "runs_on") {
      add(b.id, { to: a.id, ease: 0.9, technique: "T1005", reason: { text: "tm.why.hostControl" } });
      const ex = exploit(b, 0.4);
      add(a.id, { to: b.id, ease: edrBonus(b, ex.ease), technique: ex.ease > 0.4 ? "T1068" : "T1548", reason: ex.ease > 0.4 ? ex.reason : { text: "tm.why.escalate" } });
    } else if (d.kind === "uses") {
      add(a.id, { to: b.id, ease: 0.6, technique: "T1552", reason: { text: "tm.why.appCreds" } });
      const ex = exploit(a, 0.3);
      add(b.id, { to: a.id, ease: ex.ease, technique: ex.technique, reason: ex.reason });
    } else if (d.kind === "backup") {
      add(a.id, { to: b.id, ease: 0.5, technique: "T1490", reason: { text: "tm.why.backup" } });
    } else {
      const e1 = exploit(b, 0.4);
      const e2 = exploit(a, 0.4);
      add(a.id, { to: b.id, ease: edrBonus(b, e1.ease), technique: e1.technique, reason: e1.reason });
      add(b.id, { to: a.id, ease: edrBonus(a, e2.ease), technique: e2.technique, reason: e2.reason });
    }
  }
  // laterální pohyb v segmentu (bez segmentace = celá síť je jeden segment)
  const flat = x.segmentation === "weak" || x.segmentation === "unknown";
  const base = flat ? 0.4 : x.segmentation === "partial" ? 0.3 : 0.2;
  const groups = new Map<string, PathNode[]>();
  for (const n of x.nodes) {
    if (!HOSTS.has(n.assetType) || n.assetClass === "primary") continue;
    const g = n.segment ?? (flat ? "*" : null);
    if (!g) continue;
    groups.set(g, [...(groups.get(g) ?? []), n]);
  }
  for (const [, list] of groups) {
    if (list.length > 400) continue;
    // laterálně se vyplatí jen cíle se slabinou nebo servery (zbytek by graf jen nafukoval)
    const interesting = list.filter((n) => n.kev + n.critical + n.high > 0 || n.eol || n.noEdr || n.assetType === "server" || n.assetType === "virtual_machine" || n.assetType === "database");
    for (const a of list)
      for (const b of interesting) {
        if (a.id === b.id) continue;
        const ex = exploit(b, base);
        if (ex.technique === "T1021" && !b.noEdr && base < 0.3) continue;
        add(a.id, { to: b.id, ease: edrBonus(b, ex.ease), technique: ex.technique, reason: ex.technique === "T1021" ? { text: flat ? "tm.why.flatNetwork" : "tm.why.sameSegment" } : ex.reason });
      }
  }
  // identita: z ovládnutého stroje na doménu (krádež přihlašovacích údajů) a z domény na servery
  const id = x.identity;
  const domEase = !id.known ? 0.3 : id.privNoMfa > 0 || id.kerberosWeak > 0 ? 0.55 : id.privileged > 0 ? 0.2 : 0.15;
  const domReason: Reason = !id.known ? { text: "tm.why.identityUnknown" } : id.privNoMfa > 0 ? { text: "tm.why.privNoMfa", params: { n: id.privNoMfa } } : id.kerberosWeak > 0 ? { text: "tm.why.kerberos", params: { n: id.kerberosWeak } } : { text: "tm.why.credTheft" };
  const hosts = x.nodes.filter((n) => n.assetClass !== "primary" && (ENDPOINT.has(n.assetType) || n.assetType === "server" || n.assetType === "virtual_machine"));
  if (hosts.length) {
    for (const n of hosts) add(n.id, { to: IDENTITY_NODE, ease: domEase, technique: "T1003", reason: domReason });
    for (const n of hosts.filter((h) => !ENDPOINT.has(h.assetType))) add(IDENTITY_NODE, { to: n.id, ease: 0.85, technique: "T1078", reason: { text: "tm.why.domainAdmin" } });
  }
  return { moves, entries, byId };
}

/** Nejschůdnější cesta (Dijkstra nad −ln snadnosti) ze všech vstupů ke každému cíli; druhá cesta s jiným vstupem. */
export function attackPaths(x: PathInput): AttackPathsResult {
  const { moves, entries, byId } = buildMoves(x);
  const targets = attackTargets(x.nodes);
  const nameOf = (id: string) => (id === IDENTITY_NODE ? "AD / doména" : (byId.get(id)?.name ?? id));
  type Lab = { cost: number; prev: string | null; move: Move | null; entry: (typeof entries)[number] | null };
  const run = (excluded: Set<string>) => {
    const lab = new Map<string, Lab>();
    const open = new Set<string>();
    for (const e of entries) {
      if (excluded.has(e.id)) continue;
      const c = -Math.log(e.ease);
      if ((lab.get(e.id)?.cost ?? Infinity) > c) {
        lab.set(e.id, { cost: c, prev: null, move: null, entry: e });
        open.add(e.id);
      }
    }
    const done = new Set<string>();
    while (open.size) {
      let best: string | null = null;
      for (const k of open) if (best == null || lab.get(k)!.cost < lab.get(best)!.cost) best = k;
      open.delete(best!);
      done.add(best!);
      const cur = lab.get(best!)!;
      if (pathDepth(lab, best!) >= 8) continue;
      for (const m of moves.get(best!) ?? []) {
        if (done.has(m.to)) continue;
        const c = cur.cost - Math.log(m.ease);
        if ((lab.get(m.to)?.cost ?? Infinity) > c + 1e-12) {
          lab.set(m.to, { cost: c, prev: best, move: m, entry: cur.entry });
          open.add(m.to);
        }
      }
    }
    return lab;
  };
  function pathDepth(lab: Map<string, Lab>, id: string) {
    let d = 0;
    let k: string | null = id;
    while (k && d < 20) {
      k = lab.get(k)?.prev ?? null;
      d++;
    }
    return d;
  }
  const build = (lab: Map<string, Lab>, t: PathNode): AttackPath | null => {
    const l = lab.get(t.id);
    if (!l) return null;
    const chain: string[] = [];
    let k: string | null = t.id;
    while (k) {
      chain.unshift(k);
      k = lab.get(k)!.prev;
    }
    const entry = lab.get(chain[0]!)!.entry!;
    const steps: AttackStep[] = [{ assetId: entry.id, assetName: nameOf(entry.id), technique: entry.technique, ease: entry.ease, reason: entry.reason }];
    for (const id of chain.slice(1)) {
      const m = lab.get(id)!.move!;
      steps.push({ assetId: id, assetName: nameOf(id), technique: m.technique, ease: m.ease, reason: m.reason });
    }
    // cíl bez vazby podpůrné → primární (podpůrné aktivum jako cíl) – doplnit dopad
    if (t.assetClass !== "primary") {
      const s = impactStep(t);
      steps.push({ assetId: t.id, assetName: t.name, technique: s.technique, ease: 1, reason: { text: s.text } });
    }
    const probability = steps.reduce((p, s) => p * s.ease, 1);
    return {
      key: `${entry.entry}:${entry.id}>${t.id}`,
      entry: entry.entry,
      entryId: entry.id,
      targetId: t.id,
      targetName: t.name,
      targetCriticality: t.criticality,
      steps,
      probability: Math.round(probability * 1000) / 1000,
      level: pathLevel(probability, x.levels),
      techniques: [...new Set(steps.map((s) => s.technique))],
      assetIds: [...new Set(steps.map((s) => s.assetId).filter((id) => id !== IDENTITY_NODE))],
    };
  };
  const first = run(new Set());
  const altRuns = new Map<string, Map<string, Lab>>();
  const out: AttackPath[] = [];
  for (const t of targets) {
    const p = build(first, t);
    if (!p) continue;
    out.push(p);
    // alternativní cesta jiným vstupem (když hlavní vstup opravíte, útočník zkusí jiný)
    if (!altRuns.has(p.entryId)) altRuns.set(p.entryId, run(new Set([p.entryId])));
    const alt = build(altRuns.get(p.entryId)!, t);
    if (alt && alt.key !== p.key && alt.probability >= 0.01) out.push(alt);
  }
  out.sort((a, b) => b.probability - a.probability || a.steps.length - b.steps.length);
  const paths = out.slice(0, x.maxPaths ?? 30);
  // úzká hrdla: aktiva (mimo cíl) na nejvíce cestách
  const cnt = new Map<string, number>();
  for (const p of paths) for (const s of p.steps.slice(0, -1)) if (s.assetId !== p.targetId) cnt.set(s.assetId, (cnt.get(s.assetId) ?? 0) + 1);
  const chokepoints: Chokepoint[] = [...cnt.entries()]
    .filter(([, n]) => n >= 2 || paths.length === 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, n]) => {
      const node = byId.get(id);
      const fixes: string[] = [];
      if (id === IDENTITY_NODE) {
        if (x.identity.privNoMfa > 0) fixes.push("tm.fix.privMfa");
        if (x.identity.kerberosWeak > 0) fixes.push("tm.fix.kerberos");
        if (!fixes.length) fixes.push("tm.fix.tiering");
      } else if (node) {
        if (node.kev > 0) fixes.push("tm.fix.kev");
        else if (node.critical > 0) fixes.push("tm.fix.critical");
        if (node.eol) fixes.push("tm.fix.eol");
        if (node.noEdr) fixes.push("tm.fix.edr");
        if (node.internetFacing) fixes.push("tm.fix.exposure");
        if (!fixes.length) fixes.push("tm.fix.segment");
      }
      return { assetId: id, assetName: nameOf(id), paths: n, fixes };
    });
  const known = x.nodes.some((n) => n.kev + n.critical + n.high > 0 || n.noEdr) || x.identity.known;
  return { paths, chokepoints, entries: new Set(entries.map((e) => e.id)).size, targets: targets.length, lowConfidence: !known || x.edges.length === 0 };
}

/** Mapování IPv4 na segment (první CIDR, který adresu obsahuje). */
export function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
}
export function cidrContains(cidr: string, ip: string): boolean {
  const [net, bitsS] = cidr.trim().split("/");
  const n = ipv4ToInt(net ?? "");
  const a = ipv4ToInt(ip);
  if (n == null || a == null) return false;
  const bits = bitsS == null ? 32 : Number(bitsS);
  if (!(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((a & mask) >>> 0);
}
export function segmentOf(ips: string[], segments: { name: string; cidrs: string[] }[]): string | null {
  for (const s of segments) if (ips.some((ip) => s.cidrs.some((c) => cidrContains(c, ip)))) return s.name;
  return null;
}

export const AttackPathDecisionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("risk"), name: z.string().trim().min(1).max(500).optional(), ownerPositionId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal("accept"), reason: z.string().trim().min(5).max(2000) }),
  z.object({ action: z.literal("reopen") }),
]);
export type AttackPathDecisionInput = z.input<typeof AttackPathDecisionInput>;

export interface AttackPathDto extends AttackPath {
  decision: { status: "risk" | "accepted"; riskId: string | null; riskName: string | null; reason: string | null; byName: string | null; at: string } | null;
  impact: number;
  /** Relevantní aktéři pro odvětví používající techniky cesty. */
  sector: { delta: number; actors: string[] };
}
export interface AttackPathsDto {
  levels: number;
  paths: AttackPathDto[];
  chokepoints: Chokepoint[];
  entries: number;
  targets: number;
  lowConfidence: boolean;
  segmentation: string;
  identityKnown: boolean;
}

/* ---------- 2. kalibrace z dat ---------- */

export interface CalibrationInput {
  levels: number;
  /** Primární / dotčená aktiva rizika (CIA 1–4, kritičnost) – záložní dopad. */
  cia: { c: number | null; i: number | null; a: number | null } | null;
  criticality: "low" | "medium" | "high" | "critical" | null;
  /** BIA procesů, které aktiva rizika podporují. */
  bia: { process: string; mtpdHours: number | null; maxImpact: number | null; financial: number | null }[];
  personalData: { any: boolean; special: boolean };
  incidents: { total: number; significant: number; downtimeHours: number; financialLoss: number };
  alerts: number;
  exposure: { internet: boolean; kev: number; critical: number };
  controls: { total: number; effective: number; partial: number; ineffective: number };
  /** Váha z relevantních aktérů hrozeb pro odvětví (−1 / 0 / +1). */
  sectorDelta: number;
  sectorActors?: string[];
}
export interface CalibrationResult {
  impact: number;
  threatLevel: number;
  vulnLevel: number;
  likelihood: number;
  confidence: "high" | "medium" | "low";
  /** Počet zdrojů dat, ze kterých návrh vychází. */
  sources: number;
  reasons: (Reason & { kind: "impact" | "threat" | "vuln" })[];
}

/** Dopad z MTPD (nejkratší maximální přípustná doba výpadku): ≤ 4 h kritický, ≤ 24 h vysoký, ≤ 72 h střední. */
export const mtpdLevel4 = (h: number) => (h <= 4 ? 4 : h <= 24 ? 3 : h <= 72 ? 2 : 1);

export function calibrateRisk(x: CalibrationInput): CalibrationResult {
  const n = x.levels;
  const to = (v4: number) => clampLvl((v4 / 4) * n, n);
  const reasons: CalibrationResult["reasons"] = [];
  let sources = 0;
  // dopad – nejvyšší z doložených faktorů (stupnice vyhlášky 1–4)
  const f: number[] = [];
  const mtpd = x.bia.map((b) => b.mtpdHours).filter((h): h is number => h != null);
  if (mtpd.length) {
    const h = Math.min(...mtpd);
    f.push(mtpdLevel4(h));
    reasons.push({ kind: "impact", text: "tm.cal.mtpd", params: { h, p: x.bia.find((b) => b.mtpdHours === h)!.process } });
  }
  const bi = x.bia.map((b) => b.maxImpact).filter((v): v is number => v != null);
  if (bi.length) {
    const m = Math.max(...bi);
    if (m > 0) f.push(Math.min(4, m));
    reasons.push({ kind: "impact", text: "tm.cal.biaImpact", params: { v: m } });
  }
  const fin = x.bia.map((b) => b.financial).filter((v): v is number => v != null);
  if (fin.length && Math.max(...fin) >= 3) reasons.push({ kind: "impact", text: "tm.cal.biaFinancial", params: { v: Math.max(...fin) } });
  if (x.bia.length) sources++;
  if (x.personalData.special) (f.push(4), reasons.push({ kind: "impact", text: "tm.cal.special" }));
  else if (x.personalData.any) (f.push(3), reasons.push({ kind: "impact", text: "tm.cal.personal" }));
  if (x.personalData.any) sources++;
  if (x.incidents.significant > 0 || x.incidents.financialLoss > 0) {
    f.push(3);
    reasons.push({ kind: "impact", text: "tm.cal.incImpact", params: { n: x.incidents.significant, loss: Math.round(x.incidents.financialLoss), h: Math.round(x.incidents.downtimeHours) } });
  }
  let impact4: number;
  if (f.length) impact4 = Math.max(...f);
  else {
    const cia = x.cia ? [x.cia.c, x.cia.i, x.cia.a].filter((v): v is number => v != null) : [];
    impact4 = cia.length ? Math.max(...cia) : x.criticality ? { low: 1, medium: 2, high: 3, critical: 4 }[x.criticality] : 2;
    reasons.push({ kind: "impact", text: cia.length ? "tm.cal.impactCia" : "tm.cal.impactCrit", params: { v: impact4 } });
  }
  // hrozba – střed stupnice, posun podle historie a aktuálních signálů
  let threat = Math.ceil(n / 2);
  if (x.incidents.total > 0) {
    threat += x.incidents.total >= 3 ? 2 : 1;
    reasons.push({ kind: "threat", text: "tm.cal.incidents", params: { n: x.incidents.total } });
    sources++;
  }
  if (x.alerts > 0) {
    threat++;
    reasons.push({ kind: "threat", text: "tm.cal.alerts", params: { n: x.alerts } });
    sources++;
  }
  if (x.exposure.internet && (x.exposure.kev > 0 || x.exposure.critical > 0)) {
    threat++;
    reasons.push({ kind: "threat", text: "tm.cal.exposed", params: { kev: x.exposure.kev, n: x.exposure.critical } });
  }
  if (x.sectorDelta) {
    threat += x.sectorDelta;
    reasons.push({ kind: "threat", text: x.sectorDelta > 0 ? "tm.cal.sectorUp" : "tm.cal.sectorDown", params: { a: (x.sectorActors ?? []).join(", ") || "–" } });
    sources++;
  }
  if (!x.incidents.total && !x.alerts) reasons.push({ kind: "threat", text: "tm.cal.noHistory" });
  // zranitelnost – účinnost opatření doložená testy / monitory, otevřené zranitelnosti
  let vuln = Math.ceil(n / 2);
  const c = x.controls;
  if (c.total) {
    sources++;
    const share = (c.effective + c.partial * 0.5) / c.total;
    if (c.ineffective > 0) (vuln++, reasons.push({ kind: "vuln", text: "tm.cal.ctlIneffective", params: { n: c.ineffective } }));
    if (share >= 0.8) (vuln -= 2, reasons.push({ kind: "vuln", text: "tm.cal.ctlStrong", params: { e: c.effective, n: c.total } }));
    else if (share >= 0.5) (vuln--, reasons.push({ kind: "vuln", text: "tm.cal.ctlPartial", params: { e: c.effective, n: c.total } }));
    else reasons.push({ kind: "vuln", text: "tm.cal.ctlWeak", params: { e: c.effective, n: c.total } });
  } else reasons.push({ kind: "vuln", text: "tm.cal.noControls" });
  if (x.exposure.kev > 0) (vuln += 2, reasons.push({ kind: "vuln", text: "tm.cal.kev", params: { n: x.exposure.kev } }));
  else if (x.exposure.critical > 0) (vuln++, reasons.push({ kind: "vuln", text: "tm.cal.critical", params: { n: x.exposure.critical } }));
  if (x.exposure.kev + x.exposure.critical > 0) sources++;
  const threatLevel = clampLvl(threat, n);
  const vulnLevel = clampLvl(vuln, n);
  return {
    impact: to(impact4),
    threatLevel,
    vulnLevel,
    likelihood: clampLvl((threatLevel + vulnLevel) / 2, n),
    confidence: sources >= 4 ? "high" : sources >= 2 ? "medium" : "low",
    sources,
    reasons,
  };
}

export interface CalibrationDto {
  riskId: string;
  riskCode: string | null;
  riskName: string;
  companyId: string;
  levels: number;
  method: "two_factor" | "three_factor";
  current: { impact: number | null; threatLevel: number | null; vulnLevel: number | null; likelihood: number | null };
  proposed: CalibrationResult;
  /** Rozdíl návrhu proti aktuálnímu hodnocení (dopad / pravděpodobnost) – null = neohodnoceno. */
  drift: { impact: number | null; likelihood: number | null };
  outdated: boolean;
}

export const CalibrationApplyInput = z.object({
  impact: z.number().int().min(1).max(5),
  threatLevel: z.number().int().min(1).max(5).optional(),
  vulnLevel: z.number().int().min(1).max(5).optional(),
  likelihood: z.number().int().min(1).max(5).optional(),
  note: z.string().trim().max(2000).optional(),
});

/* ---------- 3. aktéři hrozeb podle odvětví ---------- */

export const SECTORS = [
  "energy",
  "transport",
  "banking",
  "finance_infra",
  "health",
  "water",
  "digital_infra",
  "ict_services",
  "public_admin",
  "defense",
  "manufacturing",
  "chemicals",
  "food",
  "digital_providers",
  "research",
  "education",
  "postal",
  "waste",
  "retail",
  "other",
] as const;
export type Sector = (typeof SECTORS)[number];
export const SECTOR_LABELS: Record<Sector, string> = {
  energy: "Energetika",
  transport: "Doprava",
  banking: "Bankovnictví",
  finance_infra: "Infrastruktura finančních trhů",
  health: "Zdravotnictví",
  water: "Vodárenství",
  digital_infra: "Digitální infrastruktura",
  ict_services: "Řízení služeb IKT (MSP)",
  public_admin: "Veřejná správa",
  defense: "Obrana a obranný průmysl",
  manufacturing: "Výroba a průmysl",
  chemicals: "Chemický průmysl",
  food: "Potravinářství",
  digital_providers: "Poskytovatelé digitálních služeb",
  research: "Výzkum",
  education: "Vzdělávání",
  postal: "Poštovní a kurýrní služby",
  waste: "Odpadové hospodářství",
  retail: "Obchod a služby",
  other: "Jiné",
};

export type ActorMotivation = "espionage" | "sabotage" | "financial" | "hacktivism";
export interface ThreatActor {
  key: string;
  name: string;
  aliases: string[];
  motivation: ActorMotivation;
  origin: string;
  /** Typicky cílená odvětví; `all` = oportunistický aktér napříč odvětvími. */
  sectors: Sector[] | "all";
  techniques: string[];
}

/** Orientační katalog aktérů z veřejných zpráv (NÚKIB, CISA, ENISA) – ověřte podle aktuálních varování a zpráv. */
export const THREAT_ACTORS: ThreatActor[] = [
  { key: "ransomware", name: "Ransomware jako služba", aliases: ["ransomware", "LockBit", "Akira", "Black Basta", "Qilin", "RansomHub", "Play", "8Base"], motivation: "financial", origin: "kriminální", sectors: "all", techniques: ["T1190", "T1133", "T1078", "T1566", "T1021", "T1486", "T1490", "T1567"] },
  { key: "access_brokers", name: "Infostealery a prodejci přístupů", aliases: ["infostealer", "Lumma", "RedLine", "initial access broker"], motivation: "financial", origin: "kriminální", sectors: "all", techniques: ["T1566", "T1204", "T1555", "T1078", "T1133"] },
  { key: "apt28", name: "APT28", aliases: ["APT28", "Fancy Bear", "Sofacy", "Forest Blizzard", "Strontium"], motivation: "espionage", origin: "RU", sectors: ["public_admin", "defense", "transport", "energy", "digital_infra", "research"], techniques: ["T1566", "T1190", "T1110", "T1078", "T1003", "T1114"] },
  { key: "apt29", name: "APT29", aliases: ["APT29", "Cozy Bear", "Midnight Blizzard", "Nobelium"], motivation: "espionage", origin: "RU", sectors: ["public_admin", "defense", "research", "ict_services", "digital_providers"], techniques: ["T1566", "T1195", "T1078", "T1098", "T1114", "T1567"] },
  { key: "apt31", name: "APT31", aliases: ["APT31", "Zirconium", "Violet Typhoon", "Judgment Panda"], motivation: "espionage", origin: "CN", sectors: ["public_admin", "defense", "research", "digital_infra"], techniques: ["T1190", "T1566", "T1078", "T1505", "T1071"] },
  { key: "sandworm", name: "Sandworm", aliases: ["Sandworm", "Seashell Blizzard", "Voodoo Bear", "APT44"], motivation: "sabotage", origin: "RU", sectors: ["energy", "water", "transport", "public_admin", "digital_infra"], techniques: ["T1190", "T1078", "T1485", "T1489", "T1490", "T1562"] },
  { key: "volt_typhoon", name: "Volt Typhoon", aliases: ["Volt Typhoon", "Bronze Silhouette"], motivation: "sabotage", origin: "CN", sectors: ["energy", "water", "transport", "digital_infra", "ict_services"], techniques: ["T1190", "T1078", "T1003", "T1059", "T1047"] },
  { key: "turla", name: "Turla", aliases: ["Turla", "Snake", "Venomous Bear", "Secret Blizzard"], motivation: "espionage", origin: "RU", sectors: ["public_admin", "defense", "research"], techniques: ["T1566", "T1071", "T1505", "T1027"] },
  { key: "mustang_panda", name: "Mustang Panda", aliases: ["Mustang Panda", "RedDelta", "Bronze President"], motivation: "espionage", origin: "CN", sectors: ["public_admin", "research", "transport", "defense"], techniques: ["T1566", "T1204", "T1091", "T1071"] },
  { key: "lazarus", name: "Lazarus", aliases: ["Lazarus", "APT38", "Hidden Cobra", "Diamond Sleet"], motivation: "financial", origin: "KP", sectors: ["banking", "finance_infra", "digital_providers", "defense"], techniques: ["T1566", "T1204", "T1195", "T1567"] },
  { key: "scattered_spider", name: "Scattered Spider", aliases: ["Scattered Spider", "Octo Tempest", "UNC3944"], motivation: "financial", origin: "kriminální", sectors: ["ict_services", "digital_providers", "retail", "banking"], techniques: ["T1566", "T1621", "T1078", "T1219", "T1486"] },
  { key: "noname", name: "NoName057(16)", aliases: ["NoName057", "NoName057(16)", "DDoSia"], motivation: "hacktivism", origin: "pro-RU hacktivisté", sectors: ["public_admin", "transport", "banking", "finance_infra", "energy", "digital_infra"], techniques: ["T1498", "T1499"] },
];
export const actorByKey = (k: string) => THREAT_ACTORS.find((a) => a.key === k) ?? null;

export const ThreatProfileInput = z.object({
  sector: z.enum(SECTORS).nullable(),
  /** Ručně potvrzení / vyloučení aktéři: klíč → rozhodnutí se zdůvodněním. */
  overrides: z
    .record(z.string().max(40), z.object({ relevant: z.boolean(), reason: z.string().trim().min(3).max(1000) }))
    .default({}),
});
export type ThreatProfileInput = z.input<typeof ThreatProfileInput>;

export type ActorRelevance = "high" | "medium" | "low";
export interface ActorSignals {
  /** Zmínky v informačním servisu (NÚKIB, CERT) za 180 dní. */
  mentions: { title: string; link: string; at: string | null; feed: string }[];
  /** Indikátory MISP / TI se jménem aktéra za 90 dní. */
  intel: number;
  /** Alerty SOC s technikami aktéra za 90 dní. */
  alerts: number;
}
export interface ActorRelevanceDto {
  key: string;
  name: string;
  aliases: string[];
  motivation: ActorMotivation;
  origin: string;
  sectorMatch: "sector" | "all" | "none";
  score: number;
  relevance: ActorRelevance;
  override: { relevant: boolean; reason: string } | null;
  signals: ActorSignals;
  techniques: string[];
}

/** Skóre relevance: odvětví nebo oportunistický aktér +3, zmínky +1 (max 3), MISP +2, techniky v SOC +1; ruční rozhodnutí má přednost. */
export function actorRelevance(a: ThreatActor, sector: Sector | null, s: ActorSignals, override?: { relevant: boolean; reason: string } | null): Omit<ActorRelevanceDto, "name" | "aliases" | "motivation" | "origin" | "techniques" | "key" | "signals"> {
  const sectorMatch = a.sectors === "all" ? "all" : sector && a.sectors.includes(sector) ? "sector" : "none";
  let score = sectorMatch === "sector" || sectorMatch === "all" ? 3 : 0;
  score += Math.min(3, s.mentions.length);
  if (s.intel > 0) score += 2;
  if (s.alerts > 0) score += 1;
  let relevance: ActorRelevance = score >= 5 ? "high" : score >= 3 ? "medium" : "low";
  if (override) relevance = override.relevant ? (relevance === "low" ? "medium" : relevance) : "low";
  return { sectorMatch, score, relevance, override: override ?? null };
}

/** Posun úrovně hrozby scénáře podle relevantních aktérů (jen se zadaným odvětvím): +1 = technika vysoce relevantního aktéra, −1 = technika nikoho relevantního. */
export function sectorDelta(attack: string[], actors: Pick<ActorRelevanceDto, "name" | "relevance" | "techniques">[], sectorSet: boolean): { delta: number; actors: string[] } {
  const uses = (a: { techniques: string[] }) => a.techniques.some((t) => attack.some((x) => t === x || t.startsWith(`${x}.`) || x.startsWith(`${t}.`)));
  const high = actors.filter((a) => a.relevance === "high" && uses(a));
  // bez zadaného odvětví se úroveň nemění (profil hrozeb je vědomé rozhodnutí společnosti)
  if (!sectorSet) return { delta: 0, actors: high.map((a) => a.name) };
  if (high.length) return { delta: 1, actors: high.map((a) => a.name) };
  const medium = actors.filter((a) => a.relevance === "medium" && uses(a));
  if (medium.length || !sectorSet || !attack.length) return { delta: 0, actors: medium.map((a) => a.name) };
  return { delta: -1, actors: [] };
}

export interface ThreatLandscapeDto {
  sector: Sector | null;
  updatedAt: string | null;
  updatedByName: string | null;
  actors: ActorRelevanceDto[];
  /** Vliv na šablony scénářů. */
  templates: { key: string; delta: number; actors: string[] }[];
  /** Nejčastější techniky relevantních aktérů a jejich pokrytí detekcí. */
  techniques: { id: string; actors: string[]; detection: "covered" | "partial" | "blind" | "unknown" }[];
}

/* ---------- 4. řízený threat modeling (STRIDE) ---------- */

export const TM_ELEMENT_KINDS = ["external", "process", "store", "flow"] as const;
export type TmElementKind = (typeof TM_ELEMENT_KINDS)[number];
export const TM_ZONES = ["internet", "partner", "dmz", "internal", "restricted", "cloud"] as const;
export type TmZone = (typeof TM_ZONES)[number];
export const TM_DATA = ["public", "internal", "confidential", "personal", "special"] as const;
export type TmData = (typeof TM_DATA)[number];
export const TM_AUTH = ["none", "password", "mfa", "certificate", "unknown"] as const;
export type TmAuth = (typeof TM_AUTH)[number];
export const STRIDE = ["S", "T", "R", "I", "D", "E"] as const;
export type Stride = (typeof STRIDE)[number];
export const TM_SCOPES = ["application", "process", "project", "asset", "other"] as const;
export type TmScope = (typeof TM_SCOPES)[number];
export const TM_STATUSES = ["draft", "review", "done"] as const;
export type TmStatus = (typeof TM_STATUSES)[number];
export const TM_THREAT_STATUSES = ["open", "mitigate", "accepted", "not_applicable", "risk"] as const;
export type TmThreatStatus = (typeof TM_THREAT_STATUSES)[number];

/** Důvěryhodnost zóny (vyšší = důvěryhodnější); tok z méně důvěryhodné zóny překračuje hranici důvěry. */
export const ZONE_TRUST: Record<TmZone, number> = { internet: 0, partner: 1, cloud: 2, dmz: 2, internal: 3, restricted: 4 };
const DATA_WEIGHT: Record<TmData, number> = { public: 0, internal: 1, confidential: 2, personal: 2, special: 3 };

export const TmElement = z.object({
  id: z.string().trim().min(1).max(40),
  kind: z.enum(TM_ELEMENT_KINDS),
  name: z.string().trim().min(1).max(200),
  zone: z.enum(TM_ZONES).default("internal"),
  data: z.enum(TM_DATA).default("internal"),
  auth: z.enum(TM_AUTH).default("unknown"),
  encrypted: z.boolean().nullable().default(null),
  logging: z.boolean().nullable().default(null),
  assetId: z.string().uuid().nullable().default(null),
  from: z.string().max(40).nullable().default(null),
  to: z.string().max(40).nullable().default(null),
  note: z.string().trim().max(1000).nullable().default(null),
});
export type TmElement = z.output<typeof TmElement>;

export const TmThreat = z.object({
  key: z.string().max(120),
  elementId: z.string().max(40),
  stride: z.enum(STRIDE),
  title: z.string().max(500),
  attack: z.array(z.string().max(20)).max(10),
  severity: z.number().int().min(1).max(4),
  requirement: z.string().max(1000),
  status: z.enum(TM_THREAT_STATUSES).default("open"),
  note: z.string().trim().max(2000).nullable().default(null),
  riskId: z.string().uuid().nullable().default(null),
  custom: z.boolean().default(false),
});
export type TmThreat = z.output<typeof TmThreat>;

export const ThreatModelInput = z.object({
  companyId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(300),
  scope: z.enum(TM_SCOPES).default("application"),
  scopeId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(TM_STATUSES).default("draft"),
  elements: z.array(TmElement).max(200).default([]),
  threats: z.array(TmThreat).max(1000).default([]),
});
export type ThreatModelInput = z.input<typeof ThreatModelInput>;
export const ThreatModelPatch = patchOf(ThreatModelInput.omit({ companyId: true }));
export type ThreatModelPatch = z.input<typeof ThreatModelPatch>;

export interface ThreatModelDto {
  id: string;
  companyId: string;
  name: string;
  scope: TmScope;
  scopeId: string | null;
  scopeName: string | null;
  description: string | null;
  status: TmStatus;
  elements: TmElement[];
  threats: TmThreat[];
  summary: { threats: number; open: number; high: number; risks: number; requirements: number };
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Hrozby STRIDE podle typu prvku (STRIDE-per-element). */
export const STRIDE_PER_ELEMENT: Record<TmElementKind, Stride[]> = {
  external: ["S", "R"],
  process: ["S", "T", "R", "I", "D", "E"],
  store: ["T", "R", "I", "D"],
  flow: ["T", "I", "D"],
};

/** Kódy katalogu hrozeb a zranitelností (vyhl. 409) pro založení rizika z hrozby STRIDE. */
export const STRIDE_CATALOG: Record<Stride, { threat: string; weakness: string }> = {
  S: { threat: "H03", weakness: "Z06" },
  T: { threat: "H09", weakness: "Z10" },
  R: { threat: "H01", weakness: "Z08" },
  I: { threat: "H09", weakness: "Z11" },
  D: { threat: "H07", weakness: "Z11" },
  E: { threat: "H01", weakness: "Z06" },
};

type Gen = { title: string; attack: string[]; requirement: string; bump?: number };
/** Konkrétní hrozba a bezpečnostní požadavek podle prvku a jeho vlastností. */
function strideFor(e: TmElement, s: Stride, ctx: { crossing: boolean; exposed: boolean }): Gen | null {
  const n = e.name;
  const k = e.kind;
  if (s === "S") {
    if (k === "external") return { title: `Podvržení identity „${n}“ (ukradené nebo uhodnuté přihlašovací údaje)`, attack: ["T1078", "T1110"], requirement: e.auth === "mfa" || e.auth === "certificate" ? `Udržovat vícefaktorové ověření „${n}“ a omezení pokusů o přihlášení.` : `Zavést vícefaktorové ověření (MFA) nebo certifikát pro „${n}“, omezit počet pokusů o přihlášení.`, bump: e.auth === "none" || e.auth === "password" ? 1 : e.auth === "mfa" || e.auth === "certificate" ? -1 : 0 };
    return { title: `Vydávání se za službu „${n}“ / zneužití jejího účtu`, attack: ["T1078", "T1556"], requirement: `Ověřovat identitu „${n}“ vůči volajícím (TLS s ověřeným certifikátem, servisní účty bez interaktivního přihlášení, správa tajemství mimo kód).`, bump: ctx.exposed ? 1 : 0 };
  }
  if (s === "T") {
    if (k === "flow") return { title: `Změna dat při přenosu „${n}“ (man-in-the-middle)`, attack: ["T1557", "T1565"], requirement: `Šifrovat a chránit integritu toku „${n}“ (TLS 1.2+, ověření certifikátu, podpis zpráv).`, bump: e.encrypted === false ? 1 : e.encrypted ? -1 : 0 };
    if (k === "store") return { title: `Neoprávněná změna dat v úložišti „${n}“`, attack: ["T1565", "T1485"], requirement: `Řídit oprávnění k zápisu do „${n}“ (nejnižší oprávnění), auditovat změny a zálohovat odděleně (neměnné zálohy).` };
    return { title: `Podvržení vstupů / změna kódu „${n}“ (injection, nasazení upraveného balíčku)`, attack: ["T1190", "T1195", "T1059"], requirement: `Validovat všechny vstupy „${n}“, používat parametrizované dotazy, podepisovat a kontrolovat sestavení a závislosti (SCA).`, bump: ctx.exposed ? 1 : 0 };
  }
  if (s === "R") return { title: `Popření provedené akce v „${n}“ (chybí průkazné záznamy)`, attack: ["T1070"], requirement: `Zaznamenávat bezpečnostně významné události „${n}“ (kdo, co, kdy, odkud), chránit záznamy proti změně a předávat je do SIEM/SOC.`, bump: e.logging === false ? 1 : e.logging ? -1 : 0 };
  if (s === "I") {
    if (k === "flow") return { title: `Odposlech dat při přenosu „${n}“`, attack: ["T1040", "T1557"], requirement: `Šifrovat tok „${n}“ (TLS 1.2+, bez zastaralých šifer), nepřenášet tajemství v URL.`, bump: e.encrypted === false ? 1 : e.encrypted ? -1 : 0 };
    if (k === "store") return { title: `Únik dat z úložiště „${n}“`, attack: ["T1005", "T1530", "T1567"], requirement: `Šifrovat data v „${n}“ v klidu, omezit přístup na nezbytné role, sledovat hromadné čtení a export.`, bump: e.encrypted === false ? 1 : 0 };
    return { title: `Prozrazení informací ze služby „${n}“ (chybové hlášky, nadbytečná data v odpovědích)`, attack: ["T1005", "T1213"], requirement: `Vracet z „${n}“ jen nezbytná data, skrýt technické detaily chyb, oddělit oprávnění podle rolí.` };
  }
  if (s === "D") {
    if (k === "flow") return ctx.crossing || ctx.exposed ? { title: `Zahlcení nebo přerušení toku „${n}“`, attack: ["T1498"], requirement: `Zajistit pro „${n}“ ochranu proti DDoS, omezení rychlosti a záložní cestu.` } : null;
    if (k === "store") return { title: `Nedostupnost nebo zašifrování úložiště „${n}“ (ransomware)`, attack: ["T1486", "T1490"], requirement: `Zálohovat „${n}“ podle RPO, mít offline / neměnnou kopii a pravidelně testovat obnovu podle RTO.` };
    return { title: `Odstavení služby „${n}“ (zahlcení, vyčerpání zdrojů)`, attack: ctx.exposed ? ["T1498", "T1499"] : ["T1499", "T1489"], requirement: `Omezit rychlost a velikost požadavků na „${n}“, nastavit limity zdrojů, monitorovat dostupnost a mít plán obnovy.`, bump: ctx.exposed ? 1 : 0 };
  }
  // E
  return { title: `Zvýšení oprávnění v „${n}“ (obejití autorizace, zneužití administrátorského účtu)`, attack: ["T1068", "T1548", "T1078"], requirement: `Kontrolovat oprávnění u každého požadavku „${n}“ na straně serveru, oddělit administraci (PAM, MFA), spouštět s nejnižšími oprávněními.`, bump: ctx.exposed ? 1 : 0 };
}

/** Vygenerované hrozby modelu – ruční hrozby a rozhodnutí u stávajících zůstávají (podle klíče). */
export function strideThreats(elements: TmElement[], existing: TmThreat[] = []): TmThreat[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out: TmThreat[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    let crossing = false;
    let exposed = e.zone === "internet" || e.zone === "partner";
    let data = DATA_WEIGHT[e.data];
    if (e.kind === "flow") {
      const a = e.from ? byId.get(e.from) : undefined;
      const b = e.to ? byId.get(e.to) : undefined;
      if (a && b && a.zone !== b.zone) crossing = true;
      if (a && (a.zone === "internet" || a.zone === "partner")) exposed = true;
      data = Math.max(data, a ? DATA_WEIGHT[a.data] : 0, b ? DATA_WEIGHT[b.data] : 0);
    } else {
      // proces / úložiště, do kterého vede tok z internetu, je vystavené; prvek na hranici důvěry má tok do jiné zóny
      for (const f of elements.filter((x) => x.kind === "flow" && (x.to === e.id || x.from === e.id))) {
        const other = byId.get((f.to === e.id ? f.from : f.to) ?? "");
        if (f.to === e.id && other && (other.zone === "internet" || other.zone === "partner")) exposed = true;
        if (other && other.zone !== e.zone) crossing = true;
      }
    }
    for (const s of STRIDE_PER_ELEMENT[e.kind]) {
      const g = strideFor(e, s, { crossing, exposed });
      if (!g) continue;
      const key = `${e.id}:${s}`;
      seen.add(key);
      // závažnost 1–4: základ 1, citlivá data, hranice důvěry, vystavení / vlastnosti prvku
      let sev = 1 + (data >= 3 ? 1 : 0) + (data >= 2 && (s === "I" || s === "T") ? 1 : 0) + (crossing ? 1 : 0) + (g.bump ?? 0);
      if (e.kind === "store" && s !== "R" && data >= 2) sev += 1;
      sev = Math.min(4, Math.max(1, sev));
      const prev = existing.find((t) => t.key === key);
      out.push({ key, elementId: e.id, stride: s, title: g.title, attack: g.attack, severity: sev, requirement: prev?.requirement && prev.status === "mitigate" ? prev.requirement : g.requirement, status: prev?.status ?? "open", note: prev?.note ?? null, riskId: prev?.riskId ?? null, custom: false });
    }
  }
  // ruční hrozby a hrozby odebraných prvků s rizikem zůstávají
  for (const t of existing) if (!seen.has(t.key) && (t.custom || t.riskId)) out.push(t);
  return out.sort((a, b) => b.severity - a.severity || a.key.localeCompare(b.key));
}

export function threatModelSummary(threats: TmThreat[]): ThreatModelDto["summary"] {
  return {
    threats: threats.length,
    open: threats.filter((t) => t.status === "open").length,
    high: threats.filter((t) => t.severity >= 3 && t.status !== "not_applicable").length,
    risks: threats.filter((t) => t.riskId).length,
    requirements: threats.filter((t) => t.status === "mitigate").length,
  };
}

/** Výchozí prvky modelu z grafu aktiv: aplikace / služba, na čem běží, co používá, uživatelé z internetu. */
export function seedElements(root: { id: string; name: string; assetType: string; internetFacing: boolean; c: number | null }, deps: { id: string; name: string; assetType: string; kind: string; internetFacing: boolean; dir: "out" | "in" }[]): TmElement[] {
  const el: TmElement[] = [];
  const base = { encrypted: null, logging: null, note: null, from: null, to: null } as const;
  const dataOf = (c: number | null): TmData => (c == null ? "internal" : c >= 4 ? "special" : c >= 3 ? "confidential" : c >= 2 ? "internal" : "public");
  const rootZone: TmZone = root.internetFacing ? "dmz" : "internal";
  el.push({ ...base, id: "p1", kind: "process", name: root.name, zone: rootZone, data: dataOf(root.c), auth: "unknown", assetId: root.id });
  el.push({ ...base, id: "e1", kind: "external", name: root.internetFacing ? "Uživatelé z internetu" : "Interní uživatelé", zone: root.internetFacing ? "internet" : "internal", data: "internal", auth: "unknown", assetId: null });
  el.push({ ...base, id: "f1", kind: "flow", name: `${root.internetFacing ? "HTTPS" : "Přístup"} → ${root.name}`, zone: rootZone, data: dataOf(root.c), auth: "unknown", assetId: null, from: "e1", to: "p1" });
  let i = 2;
  for (const d of deps.slice(0, 15)) {
    const store = d.assetType === "database" || d.assetType === "storage" || d.assetType === "information_asset";
    const kind: TmElementKind = store ? "store" : d.assetType === "saas_service" || d.assetType === "supplier" ? "external" : "process";
    const zone: TmZone = d.assetType === "saas_service" || d.assetType === "cloud_resource" ? "cloud" : d.assetType === "supplier" ? "partner" : d.internetFacing ? "dmz" : store ? "restricted" : "internal";
    if (d.kind === "runs_on" || d.kind === "located_in") continue;
    const id = `${store ? "s" : kind === "external" ? "e" : "p"}${i}`;
    el.push({ ...base, id, kind, name: d.name, zone, data: store ? dataOf(root.c) : "internal", auth: "unknown", assetId: d.id });
    el.push({ ...base, id: `f${i}`, kind: "flow", name: `${root.name} ↔ ${d.name}`, zone, data: store ? dataOf(root.c) : "internal", auth: "unknown", assetId: null, from: d.dir === "out" ? "p1" : id, to: d.dir === "out" ? id : "p1" });
    i++;
  }
  return el;
}

export const TM_LABELS = {
  kind: { external: "Externí entita", process: "Proces / služba", store: "Úložiště dat", flow: "Datový tok" } satisfies Record<TmElementKind, string>,
  zone: { internet: "Internet", partner: "Partner / dodavatel", dmz: "DMZ", internal: "Interní síť", restricted: "Chráněná zóna", cloud: "Cloud" } satisfies Record<TmZone, string>,
  data: { public: "Veřejná", internal: "Interní", confidential: "Důvěrná", personal: "Osobní údaje", special: "Zvláštní kategorie / utajované" } satisfies Record<TmData, string>,
  auth: { none: "Bez ověření", password: "Heslo", mfa: "MFA", certificate: "Certifikát", unknown: "Neznámé" } satisfies Record<TmAuth, string>,
  stride: { S: "Podvržení identity (Spoofing)", T: "Neoprávněná změna (Tampering)", R: "Popření (Repudiation)", I: "Únik informací (Information disclosure)", D: "Odepření služby (Denial of service)", E: "Zvýšení oprávnění (Elevation of privilege)" } satisfies Record<Stride, string>,
  scope: { application: "Aplikace", process: "Proces", project: "Projekt", asset: "Aktivum", other: "Jiné" } satisfies Record<TmScope, string>,
  status: { draft: "Rozpracovaný", review: "Ke kontrole", done: "Dokončený" } satisfies Record<TmStatus, string>,
  threatStatus: { open: "Neposouzeno", mitigate: "Zmírnit (požadavek)", accepted: "Akceptováno", not_applicable: "Nerelevantní", risk: "Řešit jako riziko" } satisfies Record<TmThreatStatus, string>,
  motivation: { espionage: "Špionáž", sabotage: "Sabotáž", financial: "Finanční zisk", hacktivism: "Hacktivismus" } satisfies Record<ActorMotivation, string>,
  relevance: { high: "Vysoká", medium: "Střední", low: "Nízká" } satisfies Record<ActorRelevance, string>,
};

/* ---------- 5. postup a připravenost dat (v1.41) ---------- */

export const READINESS_KEYS = ["crown_jewels", "internet_facing", "dependencies", "segments", "vulns", "identity", "edr", "bia", "controls_tested"] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];
export type ReadinessStatus = "ok" | "partial" | "missing";
export interface ReadinessItem {
  key: ReadinessKey;
  status: ReadinessStatus;
  value: number;
  total: number | null;
  /** Stránka, kde se údaje doplní. */
  path: string;
  /** Které části modelování údaj ovlivňuje. */
  affects: ("paths" | "calibration" | "landscape")[];
}
export interface ReadinessInput {
  crownJewels: number;
  internetFacing: number;
  supporting: number;
  supportingLinked: number;
  segments: number;
  vulnData: boolean;
  identityAccounts: number;
  edrMeasured: boolean;
  primaryProcesses: number;
  primaryProcessesWithBia: number;
  controlsImplemented: number;
  controlsEvidenced: number;
}

/** Připravenost dat pro modelování – co chybí pro přesné cesty a kalibraci (stav, počty, kde doplnit). */
export function readinessItems(x: ReadinessInput): ReadinessItem[] {
  const share = (v: number, t: number, ok = 0.6): ReadinessStatus => (t === 0 || v === 0 ? "missing" : v / t >= ok ? "ok" : "partial");
  return [
    { key: "crown_jewels", status: x.crownJewels > 0 ? "ok" : "missing", value: x.crownJewels, total: null, path: "/assets", affects: ["paths"] },
    { key: "internet_facing", status: x.internetFacing > 0 ? "ok" : "missing", value: x.internetFacing, total: null, path: "/assets", affects: ["paths", "calibration"] },
    { key: "dependencies", status: share(x.supportingLinked, x.supporting, 0.5), value: x.supportingLinked, total: x.supporting, path: "/assets/graph", affects: ["paths"] },
    { key: "segments", status: x.segments >= 2 ? "ok" : x.segments === 1 ? "partial" : "missing", value: x.segments, total: null, path: "/discovery", affects: ["paths"] },
    { key: "vulns", status: x.vulnData ? "ok" : "missing", value: x.vulnData ? 1 : 0, total: null, path: "/vulnerabilities", affects: ["paths", "calibration"] },
    { key: "identity", status: x.identityAccounts > 0 ? "ok" : "missing", value: x.identityAccounts, total: null, path: "/identity", affects: ["paths"] },
    { key: "edr", status: x.edrMeasured ? "ok" : "missing", value: x.edrMeasured ? 1 : 0, total: null, path: "/admin/connectors", affects: ["paths"] },
    { key: "bia", status: share(x.primaryProcessesWithBia, x.primaryProcesses), value: x.primaryProcessesWithBia, total: x.primaryProcesses, path: "/bia", affects: ["calibration"] },
    { key: "controls_tested", status: share(x.controlsEvidenced, x.controlsImplemented, 0.5), value: x.controlsEvidenced, total: x.controlsImplemented, path: "/controls", affects: ["calibration"] },
  ];
}

export const MODELING_STEPS = ["sector", "data", "paths", "calibration", "models"] as const;
export type ModelingStep = (typeof MODELING_STEPS)[number];
export interface ModelingStepState {
  key: ModelingStep;
  state: "done" | "todo" | "waiting";
  /** Počet položek k vyřízení (nerozhodnuté cesty, odchylky, neposouzené hrozby, chybějící data). */
  count: number;
}
export interface ModelingOverviewDto {
  sector: Sector | null;
  readiness: ReadinessItem[];
  steps: ModelingStepState[];
  next: ModelingStep | null;
  counts: { paths: number; pathsOpen: number; drift: number; unrated: number; models: number; openThreats: number };
}

/** Stav kroků postupu a doporučený další krok (první nehotový; chybějící data postup neblokují). */
export function modelingSteps(x: { sector: Sector | null; readiness: ReadinessItem[]; counts: ModelingOverviewDto["counts"] }): { steps: ModelingStepState[]; next: ModelingStep | null } {
  const missing = x.readiness.filter((r) => r.status !== "ok").length;
  const crown = x.readiness.find((r) => r.key === "crown_jewels")?.status === "ok";
  const c = x.counts;
  const steps: ModelingStepState[] = [
    { key: "sector", state: x.sector ? "done" : "todo", count: x.sector ? 0 : 1 },
    { key: "data", state: missing ? "todo" : "done", count: missing },
    { key: "paths", state: !crown || !c.paths ? "waiting" : c.pathsOpen ? "todo" : "done", count: c.pathsOpen },
    { key: "calibration", state: c.drift + c.unrated ? "todo" : "done", count: c.drift + c.unrated },
    { key: "models", state: !c.models || c.openThreats ? "todo" : "done", count: c.models ? c.openThreats : 1 },
  ];
  // připravenost dat je doporučení – když už jsou cesty k rozhodnutí, pokračuje se jimi
  const next = steps.find((s) => s.state === "todo" && !(s.key === "data" && crown && c.paths > 0)) ?? steps.find((s) => s.state === "todo") ?? null;
  return { steps, next: next?.key ?? null };
}

/** Pořadí útočných cest k rozhodnutí: nerozhodnuté, pak dopad × pravděpodobnost, pak pravděpodobnost cesty. */
export function pathPriority(p: { impact: number; level: number; probability: number }): number {
  return p.impact * p.level * 100 + p.probability * 10;
}

/** Pořadí kalibrace: neohodnocená rizika, pak největší odchylka (vyšší návrh dřív), pak navržená úroveň. */
export function calibrationPriority(c: { drift: { impact: number | null; likelihood: number | null }; proposed: { impact: number; likelihood: number } }): number {
  const unrated = c.drift.impact == null || c.drift.likelihood == null;
  const d = Math.abs(c.drift.impact ?? 0) + Math.abs(c.drift.likelihood ?? 0);
  const up = (c.drift.impact ?? 0) + (c.drift.likelihood ?? 0) > 0 ? 0.5 : 0;
  return (unrated ? 1000 : 0) + (d + up) * 100 + c.proposed.impact * c.proposed.likelihood;
}
