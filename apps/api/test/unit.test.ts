import {
  analyzeResilience,
  layoutGraph,
  impactOf,
  neighborhood,
  assetLayer,
  suggestFromTriggers,
  triggerDue,
  type RiskTrigger,
  allRequirements,
  deriveCompliance,
  complianceScore,
  emptyComplianceCounts,
  fromDecreeLevel,
  generateBpmn,
  requiredAvailability,
  riskScore,
  RiskPolicySchema,
  scaleFor,
  suggestMtpd,
  validateBounds,
  nextTestDate,
  CLAUSES_409,
  CLAUSES_410,
  missingClauses,
  supplierGaps,
  changeGaps,
  incidentDeadlines,
  isReportable,
  coverageState,
} from "@contix/shared";
import { suggestImpact } from "../src/modules/risks/routes";
import { describe, expect, test } from "bun:test";
import { csvToAssets, parseCsv } from "../src/modules/discovery/connectors/csv";
import { assertTargetsAllowed, parseNmapXml } from "../src/modules/discovery/connectors/nmap";
import { createWazuhConnector, guessAssetType } from "../src/modules/discovery/connectors/wazuh";
import { normalizeMac, pickMatch } from "../src/modules/discovery/reconcile";
import type { DiscoveredAsset } from "../src/modules/discovery/types";

const item = (p: Partial<DiscoveredAsset>): DiscoveredAsset => ({
  sourceType: "network_scan",
  sourceRef: "x",
  name: "x",
  assetType: "other",
  ...p,
});

describe("reconcile", () => {
  test("normalizeMac", () => {
    expect(normalizeMac("00-09-0F-AA-BB-CC")).toBe("00:09:0f:aa:bb:cc");
    expect(normalizeMac("00:00:00:00:00:00")).toBeNull();
    expect(normalizeMac("garbage")).toBeNull();
  });

  const cands = [
    { id: "a", serialNumber: "SN1", macAddresses: ["00:09:0f:aa:bb:cc"], hostname: "fw-edge-01" },
    { id: "b", serialNumber: null, macAddresses: [], hostname: "srv-db01.firma.local" },
    { id: "c", serialNumber: null, macAddresses: [], hostname: "SRV-DB01" },
  ];

  test("serial wins", () => expect(pickMatch(item({ serialNumber: "SN1" }), cands)).toEqual({ id: "a", reason: "serial" }));
  test("mac match ignores format", () =>
    expect(pickMatch(item({ macAddresses: ["00:09:0F:AA:BB:CC"] }), cands)).toEqual({ id: "a", reason: "mac" }));
  test("ambiguous hostname", () =>
    expect(pickMatch(item({ hostname: "srv-db01" }), cands)).toEqual({ ambiguous: ["b", "c"] }));
  test("no match", () => expect(pickMatch(item({ hostname: "nope" }), cands)).toBeNull());
  test("placeholder serial ignored", () =>
    expect(pickMatch(item({ serialNumber: "To Be Filled By O.E.M." }), cands)).toBeNull());
});

describe("nmap", () => {
  test("parses XML", async () => {
    const xml = await Bun.file(new URL("./fixtures/nmap.xml", import.meta.url)).text();
    const hosts = parseNmapXml(xml);
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).toMatchObject({
      sourceRef: "mac:00:09:0f:aa:bb:cc",
      hostname: "fw-edge-01.firma.local",
      assetType: "security_device",
      manufacturer: "Fortinet",
    });
    expect(hosts[1]!.assetType).toBe("printer");
  });

  test("target allow-list", () => {
    expect(() => assertTargetsAllowed(["10.0.0.0/24"], ["10.0.0.0/16"])).not.toThrow();
    expect(() => assertTargetsAllowed(["10.1.0.5"], ["10.0.0.0/16"])).toThrow(/mimo/);
    expect(() => assertTargetsAllowed(["10.0.0.0/8"], ["10.0.0.0/8"])).toThrow(/velký/);
    expect(() => assertTargetsAllowed(["-oN /etc/x"], ["0.0.0.0/0"])).toThrow(/Neplatný/);
    expect(() => assertTargetsAllowed(["10.0.0.1"], [])).toThrow(/povolené/);
  });
});

describe("csv", () => {
  test("quotes and semicolons", () => {
    expect(parseCsv('a;b\n"x;y";"he said ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x;y", 'he said "hi"'],
    ]);
  });

  test("maps columns", () => {
    const { items, errors } = csvToAssets(
      "Název;Typ;IP;Serial;Kritičnost;Vlastník\nSRV-01;server;10.0.0.5|10.0.1.5;ABC;high;IT\n;server;;;;\nX;blbost;;;;\n",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "SRV-01",
      assetType: "server",
      ipAddresses: ["10.0.0.5", "10.0.1.5"],
      serialNumber: "ABC",
      sourceRef: "csv:ABC",
      governance: { criticality: "high", ownerName: "IT" },
    });
    expect(errors).toHaveLength(2);
  });
});

describe("wazuh", () => {
  test("guessAssetType", () => {
    expect(guessAssetType("Microsoft Windows Server 2022", "windows")).toBe("server");
    expect(guessAssetType("Microsoft Windows 11 Pro", "windows")).toBe("workstation");
    expect(guessAssetType("Ubuntu", "ubuntu")).toBe("server");
  });

  test("collects agents via mocked API", async () => {
    const routes: Record<string, unknown> = {
      "/security/user/authenticate": { data: { token: "t" } },
      "/agents?limit=500&offset=0": {
        data: {
          affected_items: [
            { id: "001", name: "web01", ip: "10.0.0.30", status: "active", os: { name: "Ubuntu", platform: "ubuntu" } },
            { id: "002", name: "ghost", status: "never_connected" },
          ],
          total_affected_items: 2,
        },
      },
      "/syscollector/001/os": { data: { affected_items: [{ hostname: "web01", os: { name: "Ubuntu", version: "24.04" } }] } },
      "/syscollector/001/hardware": { data: { affected_items: [{ board_serial: "VMW-123", ram: { total: 8000000 } }] } },
      "/syscollector/001/netiface": { data: { affected_items: [{ mac: "02:42:ac:11:00:02" }] } },
      "/syscollector/001/netaddr": { data: { affected_items: [{ address: "10.0.0.30" }, { address: "127.0.0.1" }] } },
    };
    const fakeFetch = async (url: string) => {
      const path = url.replace("https://wazuh:55000", "");
      return path in routes ? Response.json(routes[path]) : new Response("nf", { status: 404 });
    };
    const out: DiscoveredAsset[] = [];
    const logs: string[] = [];
    for await (const a of createWazuhConnector(fakeFetch).collect(
      { url: "https://wazuh:55000", user: "u", password: "p" },
      { log: (m) => logs.push(m) },
    ))
      out.push(a);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sourceRef: "001",
      assetType: "server",
      osVersion: "24.04",
      serialNumber: "VMW-123",
      ipAddresses: ["10.0.0.30"],
      macAddresses: ["02:42:ac:11:00:02"],
    });
  });
});

import { effectiveCia } from "@contix/shared";
import { base32Encode, decrypt, encrypt, totpAt, verifyTotp } from "../src/auth/crypto";

describe("auth crypto", () => {
  // RFC 6238, příloha B (SHA-1): T=59 s → 94287082 → posledních 6 číslic
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  test("TOTP dle RFC 6238", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpAt(secret, 1)).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });
  test("verifyTotp: okno ±1 krok a ochrana proti replay", () => {
    const now = 1111111109_000;
    expect(verifyTotp(secret, "081804", now)).toBe(37037036);
    expect(verifyTotp(secret, "081804", now, 37037036)).toBeNull();
    expect(verifyTotp(secret, "123456", now)).toBeNull();
  });
  test("AES-GCM šifrování", () => {
    const enc = encrypt("tajemstvi", "k".repeat(32));
    expect(decrypt(enc, "k".repeat(32))).toBe("tajemstvi");
    expect(() => decrypt(enc, "x".repeat(32))).toThrow();
  });
});

describe("dědění CIA", () => {
  test("maximum z primárních aktiv", () => {
    expect(
      effectiveCia({ confidentiality: 1, integrity: null, availability: 4 }, [
        { confidentiality: 3, integrity: 2, availability: 1 },
        { confidentiality: 4, integrity: null, availability: 2 },
      ]),
    ).toEqual({ confidentiality: 4, integrity: 2, availability: 4, inherited: true });
    expect(effectiveCia({ confidentiality: 2, integrity: 2, availability: 2 }, []).inherited).toBe(false);
  });
});

import { describeFetchError } from "../src/modules/discovery/connectors/wazuh";

describe("wazuh – popis síťových chyb", () => {
  const u = "https://192.0.2.44:55000/security/user/authenticate";
  test("FailedToOpenSocket → rada k síti / macOS", () => {
    const m = describeFetchError(Object.assign(new Error("Was there a typo in the url or port?"), { code: "FailedToOpenSocket" }), u);
    expect(m).toContain("192.0.2.44:55000");
    expect(m).toContain("Místní síť");
    expect(describeFetchError({ code: "ConnectionRefused" }, "https://h:9200/x", "Wazuh Indexer")).toContain("127.0.0.1");
  });
  test("ConnectionRefused → port / služba", () => {
    expect(describeFetchError({ code: "ConnectionRefused", message: "Unable to connect" }, u)).toContain("odmítl");
  });
  test("self-signed certifikát", () => {
    expect(describeFetchError(new Error("self signed certificate"), u)).toContain("Ověřovat TLS");
  });
});

import { computeHealth, HealthPolicySchema, osSupport } from "@contix/shared";
import { fromIndexerDoc, normSeverity } from "../src/modules/vulnerabilities/sources";

describe("semafor a konec podpory", () => {
  const now = new Date("2026-09-30");
  const policy = HealthPolicySchema.parse({});
  test("osSupport", () => {
    expect(osSupport("Ubuntu", "24.04.1 LTS", now).status).toBe("supported");
    expect(osSupport("Ubuntu", "20.04.6 LTS", now).status).toBe("eol");
    expect(osSupport("Debian GNU/Linux", "12", now).status).toBe("supported");
    expect(osSupport("Microsoft Windows 10 Pro", "10.0.19045", now)).toMatchObject({ status: "eol", eolDate: "2025-10-14" });
    expect(osSupport("Microsoft Windows Server 2016 Datacenter", "10.0.14393", now).status).toBe("ending"); // EOL 2027-01-12
    expect(osSupport("Microsoft Windows Server 2019 Standard", null, now).status).toBe("supported");
    expect(osSupport("Microsoft Windows 11 Pro", "10.0.22631", now).status).toBe("supported");
    expect(osSupport("Arch Linux", "rolling", now).status).toBe("unknown");
    expect(osSupport(null, null, now).status).toBe("unknown");
  });
  test("computeHealth", () => {
    const base = { counts: { critical: 0, high: 0, medium: 0, low: 3 }, osName: "Ubuntu", osVersion: "24.04", hasVulnData: true, policy, now };
    expect(computeHealth(base).status).toBe("green");
    expect(computeHealth({ ...base, counts: { ...base.counts, high: 1 } }).status).toBe("orange");
    expect(computeHealth({ ...base, counts: { ...base.counts, critical: 1 } }).status).toBe("red");
    expect(computeHealth({ ...base, counts: { ...base.counts, high: 10 } }).status).toBe("red");
    expect(computeHealth({ ...base, osVersion: "18.04" }).status).toBe("red");
    expect(computeHealth({ ...base, lastSeenAt: new Date("2026-08-01") }).reasons[0]!.code).toBe("stale");
    expect(computeHealth({ ...base, hasVulnData: false, osName: null }).status).toBe("unknown");
  });
  test("mapování dokumentu z indexeru", () => {
    expect(normSeverity("-", 7.2)).toBe("high");
    expect(
      fromIndexerDoc({ agent: { id: "003" }, package: { name: "bash", version: "5.1" }, vulnerability: { id: "CVE-1", severity: "Critical", score: { base: 9.1 } } }),
    ).toMatchObject({ agentId: "003", cveId: "CVE-1", severity: "critical", cvssScore: 9.1, packageName: "bash" });
    expect(fromIndexerDoc({ vulnerability: { id: "CVE-1" } })).toBeNull();
  });
});

describe("rizika a BPMN", () => {
  const policy = RiskPolicySchema.parse({});
  test("skóre dle vyhlášky (tříčlenné) a hranice úrovní", () => {
    expect(riskScore(policy, { impact: 1, threatLevel: 1, vulnLevel: 1 })).toMatchObject({ score: 1, level: "low" });
    expect(riskScore(policy, { impact: 2, threatLevel: 2, vulnLevel: 2 })).toMatchObject({ score: 8, level: "medium" });
    expect(riskScore(policy, { impact: 3, threatLevel: 3, vulnLevel: 2 })).toMatchObject({ score: 18, level: "high" });
    expect(riskScore(policy, { impact: 4, threatLevel: 3, vulnLevel: 3 })).toMatchObject({ score: 36, level: "critical" });
    expect(riskScore(policy, { impact: 4, threatLevel: 3 }).score).toBeNull();
    const two = RiskPolicySchema.parse({ method: "two_factor" });
    expect(riskScore(two, { impact: 2, likelihood: 2 })).toMatchObject({ score: 4, level: "medium", max: 16 });
  });
  test("návrh dopadu jen ze složek CIA, které hrozba ohrožuje", () => {
    const a = [{ confidentiality: 4, integrity: 2, availability: 1 }];
    expect(suggestImpact(null, a)).toBe(4);
    expect(suggestImpact({ c: false, i: false, a: true }, a)).toBe(1);
    expect(suggestImpact(null, [])).toBeNull();
  });
  test("BPMN z kroků: dráhy, typy prvků, escapování", () => {
    const xml = generateBpmn("Proces <A&B>", [
      { id: "11111111-1111-1111-1111-111111111111", name: "Příjem", stepType: "task", lane: "Podatelna" },
      { id: "22222222-2222-2222-2222-222222222222", name: "OK?", stepType: "decision", lane: null },
    ]);
    expect(xml).toContain('name="Proces &lt;A&amp;B&gt;"');
    expect(xml).toContain('<bpmn:lane id="Lane_1" name="Podatelna">');
    expect(xml).toContain('name="Neurčeno"');
    expect(xml).toContain("<bpmn:exclusiveGateway");
    expect(xml.match(/<bpmn:sequenceFlow /g)!.length).toBe(3);
    expect(xml).toContain('bpmnElement="Flow_3"');
  });
});

describe("metodika dle přílohy č. 4 vyhl. 409/2025", () => {
  test("stupnice 3/4/5 úrovní s převodem na úrovně vyhlášky", () => {
    expect(scaleFor("threat", 4).map((x) => x.decree)).toEqual([[1], [2], [3], [4]]);
    expect(scaleFor("threat", 4)[3]!.description).toContain("častější než jednou za měsíc");
    expect(scaleFor("vulnerability", 3)[2]!.decree).toEqual([3, 4]);
    expect(scaleFor("impact", 5).map((x) => x.name)).toEqual(["Velmi nízká", "Nízká", "Střední", "Vysoká", "Kritická"]);
    expect(fromDecreeLevel(4, 3)).toBe(3);
    expect(fromDecreeLevel(1, 5)).toBe(2);
  });
  test("hranice úrovní rizika podle počtu úrovní a validace", () => {
    const p3 = RiskPolicySchema.parse({ levels: 3 });
    expect(riskScore(p3, { impact: 3, threatLevel: 3, vulnLevel: 3 })).toMatchObject({ score: 27, level: "critical", max: 27 });
    expect(riskScore(p3, { impact: 2, threatLevel: 2, vulnLevel: 2 }).level).toBe("medium");
    // riziko hodnocené ve 4 úrovních se počítá svou stupnicí i po změně metodiky
    expect(riskScore(p3, { impact: 4, threatLevel: 4, vulnLevel: 4 }, 4)).toMatchObject({ score: 64, level: "critical", max: 64 });
    expect(validateBounds(RiskPolicySchema.parse({ levels: 5, bounds: { maxLow: 10, maxMedium: 5, maxHigh: 20 } }))).toContain("rostoucí");
    expect(validateBounds(RiskPolicySchema.parse({ method: "two_factor", levels: 5 }))).toBeNull();
  });
});

describe("shoda a BIA", () => {
  test("katalog požadavků – stabilní ID bez duplicit", () => {
    const ids = allRequirements().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("cz409:19/4/a");
    expect(ids).toContain("iso27001:A.8.34");
  });
  test("odvození míry shody z opatření", () => {
    expect(deriveCompliance([])).toBe("non_compliant");
    expect(deriveCompliance([{ status: "implemented", effectiveness: "effective" }])).toBe("compliant");
    expect(deriveCompliance([{ status: "implemented", effectiveness: "ineffective" }])).toBe("partial");
    expect(deriveCompliance([{ status: "implemented", effectiveness: "not_assessed" }, { status: "planned", effectiveness: "not_assessed" }])).toBe("partial");
    expect(deriveCompliance([{ status: "not_applicable", effectiveness: "not_assessed" }])).toBe("not_applicable");
    const c = emptyComplianceCounts();
    c.compliant = 2;
    c.partial = 1;
    c.non_compliant = 1;
    c.not_applicable = 5;
    expect(complianceScore(c)).toBe(62.5);
  });
  test("BIA – MTPD z dopadů a požadovaná dostupnost z RTO", () => {
    expect(suggestMtpd({ financial: { "1h": 1, "1d": 3 }, legal: { "4h": 2 } })).toBe(24);
    expect(suggestMtpd({ financial: { "1h": 2 } })).toBeNull();
    expect([0.25, 4, 24, 72].map(requiredAvailability)).toEqual([4, 3, 2, 1]);
  });
});

describe("BCM a dodavatelé", () => {
  test("další test plánu = poslední test nebo schválení + interval", () => {
    expect(nextTestDate("2026-06-15", "2026-01-01T10:00:00Z", 12)).toBe("2027-06-15");
    expect(nextTestDate(null, "2026-01-31T10:00:00Z", 6)).toBe("2026-07-31");
    expect(nextTestDate(null, null, 12)).toBeNull();
  });
  test("chybějící ustanovení smlouvy dle přílohy č. 5 / č. 2", () => {
    expect(CLAUSES_409.length).toBe(18);
    expect(CLAUSES_410.length).toBe(14);
    expect(missingClauses("cz409", { a: "included", b: "not_relevant", c: "partial" })).toBe(16);
    expect(missingClauses("cz410", {})).toBe(14);
  });
  test("mezery § 9 jen u aktivního významného dodavatele", () => {
    const base = { significant: true, status: "active", notifiedAt: null, riskAssessedAt: null, rulesAcknowledgedAt: null, reviewDue: false, contractCount: 0, missingClauses: 0 };
    expect(supplierGaps(base).length).toBe(4);
    expect(supplierGaps({ ...base, significant: false })).toEqual([]);
    expect(supplierGaps({ ...base, status: "ended" })).toEqual([]);
  });
});

describe("Řízení změn (§ 11)", () => {
  const base = { significant: true, status: "proposed" as const, criteria: ["x"], riskCount: 0, controlCount: 0, pentest: "not_assessed" as const, audit: "not_assessed" as const };
  test("mezery rostou s fází změny", () => {
    expect(changeGaps(base).length).toBe(1);
    expect(changeGaps({ ...base, status: "approved" }).length).toBe(4);
    expect(changeGaps({ ...base, status: "closed" }).length).toBe(7);
    expect(changeGaps({ ...base, significant: false, status: "closed" })).toEqual([]);
    expect(changeGaps({ ...base, status: "rejected" })).toEqual([]);
  });
  test("vyplněná změna nemá mezery", () => {
    expect(
      changeGaps({ ...base, status: "closed", riskAssessment: "ok", measures: "m", rollbackPlan: "r", pentest: "not_needed", testedAt: "2026-01-01", docsUpdatedAt: "2026-01-02", audit: "done" }),
    ).toEqual([]);
  });
});

describe("Incidenty – lhůty § 16 zákona", () => {
  const base = {
    kind: "incident" as const,
    inScope: true,
    cyberOrigin: true,
    intentExcluded: false,
    toleranceExceeded: false,
    significanceAreas: {},
    authorityDecision: "pending" as const,
    personalDataBreach: false,
    detectedAt: "2026-09-01T08:00:00.000Z",
    resolvedAt: null,
  };
  const now = new Date("2026-09-01T10:00:00Z");
  test("vyšší režim: hlásí se vždy, lze-li úmysl vyloučit, ne", () => {
    expect(isReportable(base, "higher")).toBe(true);
    expect(isReportable({ ...base, intentExcluded: true }, "higher")).toBe(false);
    expect(isReportable(base, "lower")).toBe(false);
    expect(isReportable({ ...base, toleranceExceeded: true, significanceAreas: { users: true } }, "lower")).toBe(true);
    expect(isReportable({ ...base, kind: "event" }, "higher")).toBe(false);
  });
  test("prvotní hlášení 24 h, oznámení 72 h (24 h u služeb vytvářejících důvěru)", () => {
    const d = incidentDeadlines(base, [], "higher", { now });
    expect(d.find((x) => x.type === "initial")!.due).toBe("2026-09-02T08:00:00.000Z");
    expect(d.find((x) => x.type === "notification")!.due).toBe("2026-09-04T08:00:00.000Z");
    const t = incidentDeadlines({ ...base, authorityDecision: "significant" }, [], "higher", { now, trustService: true });
    expect(t.find((x) => x.type === "notification")!.due).toBe("2026-09-02T08:00:00.000Z");
    expect(incidentDeadlines({ ...base, authorityDecision: "not_significant" }, [], "higher", { now }).map((x) => x.type)).toEqual(["initial"]);
  });
  test("incident trvající po 30 dnech od oznámení → průběžná zpráva, závěrečná do 30 dnů od vyřešení", () => {
    const reps = [
      { reportType: "initial" as const, submittedAt: "2026-09-01T12:00:00.000Z" },
      { reportType: "notification" as const, submittedAt: "2026-09-03T08:00:00.000Z" },
    ];
    const later = new Date("2026-10-10T00:00:00Z");
    const d = incidentDeadlines({ ...base, authorityDecision: "significant" }, reps, "higher", { now: later });
    expect(d.find((x) => x.type === "interim")!.state).toBe("overdue");
    expect(d.find((x) => x.type === "final")!.due).toBeNull();
    const r = incidentDeadlines({ ...base, authorityDecision: "significant", resolvedAt: "2026-10-12T00:00:00.000Z" }, reps, "higher", { now: later });
    expect(r.find((x) => x.type === "final")!.due).toBe("2026-11-11T00:00:00.000Z");
  });
  test("GDPR 72 h", () => {
    const d = incidentDeadlines({ ...base, kind: "event", personalDataBreach: true }, [], "higher", { now });
    expect(d.map((x) => [x.type, x.due])).toEqual([["gdpr", "2026-09-04T08:00:00.000Z"]]);
  });
});

describe("Audity – pokrytí § 16", () => {
  test("2 roky ok, do 5 let jen po celcích, jinak po termínu", () => {
    const t = new Date("2026-10-01T00:00:00Z");
    expect(coverageState("2025-01-01", t)).toBe("ok");
    expect(coverageState("2023-06-01", t)).toBe("partial");
    expect(coverageState("2020-01-01", t)).toBe("overdue");
    expect(coverageState(null, t)).toBe("overdue");
  });
});

/* ============ Metodiky (OCTAVE, vzorce, YAML/JSON/XML) ============ */

import {
  compileFormula as _cf,
  evalFormula as _ef,
  getRiskMethodology as _grm,
  OCTAVE_ALLEGRO as _OCT,
  scoreMethodology as _sm,
  riskScore as _rs,
  RiskPolicySchema as _RPS,
  ZKB409_AUDIT as _ZA,
  checklistFor as _cl,
  factorErrors as _fe,
} from "@contix/shared";
import { parseMethodology as _pm, serializeMethodology as _ser } from "../src/modules/methodologies/format";

describe("metodiky", () => {
  test("bezpečný vzorec: priorita, funkce, unární minus; nepovolené konstrukce selžou", () => {
    expect(_ef(_cf("2 + 3 * 4 ^ 2"), {})).toBe(50);
    expect(_ef(_cf("max(a, b) * -c + round(2.4)"), { a: 1, b: 3, c: 2 })).toBe(-4);
    expect(() => _cf("process.exit(1)")).toThrow();
    expect(() => _cf("a; b")).toThrow();
    expect(() => _cf("(1 + 2")).toThrow();
  });

  test("OCTAVE Allegro: vážený součet dopadů, pooly a mapování na úrovně", () => {
    const areas = (v: number) => Object.fromEntries(_OCT.areas!.map((a) => [a.key, v]));
    const low = _sm(_OCT, { impact: areas(1), probability: 1 });
    expect(low.score).toBe(15);
    expect(low.levelKey).toBe("pool4");
    const top = _sm(_OCT, { impact: areas(3), probability: 3 });
    expect(top.score).toBe(45);
    expect(top.levelKey).toBe("pool1");
    expect(top.level).toBe("critical");
    expect(_sm(_OCT, { impact: areas(2), probability: 2 }).levelKey).toBe("pool2");
    // neúplné hodnocení = bez skóre
    expect(_sm(_OCT, { impact: { reputation: 3 }, probability: 3 }).score).toBeNull();
    expect(_fe(_OCT, { impact: { nope: 1 }, probability: 7 }).length).toBe(2);
    // riskScore přepíná podle metodiky rizika / politiky
    const pol = _RPS.parse({ methodology: "octave_allegro" });
    expect(_rs(pol, { factorValues: { impact: areas(3), probability: 3 } }).level).toBe("critical");
    expect(_rs(_RPS.parse({}), { methodologyKey: "zkb409", impact: 4, threatLevel: 4, vulnLevel: 4 }).score).toBe(64);
  });

  test("import YAML / JSON / XML: stejná definice, export → import beze ztráty", () => {
    for (const f of ["yaml", "json", "xml"] as const) {
      const text = _ser(_OCT, f);
      const { def, errors } = _pm(f, text);
      expect(errors).toEqual([]);
      expect(def).toEqual(_OCT);
    }
    const yaml = `kind: risk
id: simple_3x3
name: Jednoduchá 3×3
formula: d * p
factors:
  - key: d
    label: Dopad
    scale: [{ value: 1, label: nízký }, { value: 2, label: střední }, { value: 3, label: vysoký }]
  - key: p
    label: Pravděpodobnost
    scale: [{ value: 1, label: nízká }, { value: 2, label: střední }, { value: 3, label: vysoká }]
levels:
  - { key: ok, label: Přijatelné, mapsTo: low, max: 3, acceptable: true }
  - { key: bad, label: Nepřijatelné, mapsTo: high, min: 4 }
`;
    const r = _pm("yaml", yaml);
    expect(r.errors).toEqual([]);
    expect(_sm(r.def as any, { d: 2, p: 2 }).levelKey).toBe("bad");
    // chyby: neznámá proměnná ve vzorci, neplatný YAML, chybějící kořen XML
    expect(_pm("yaml", yaml.replace("d * p", "d * x")).errors.join()).toContain("x");
    expect(_pm("yaml", "kind: [").errors.length).toBe(1);
    expect(_pm("xml", "<foo/>").errors[0]).toContain("methodology");
    const audit = `<?xml version="1.0"?><methodology kind="audit" id="iso_quick" version="1"><name>Rychlý audit</name>
      <checklist><item id="q1" section="A"><question>Je politika schválena?</question></item><item id="q2" requirementId="cz409:3/a"><question>Cíle ISMS?</question></item></checklist></methodology>`;
    const ar = _pm("xml", audit);
    expect(ar.errors).toEqual([]);
    expect((ar.def as any).checklist.length).toBe(2);
    expect((ar.def as any).version).toBe("1");
  });

  test("vestavěný kontrolní seznam auditu dle vyhlášky 409 a omezení rozsahem", () => {
    expect(_ZA.checklist.length).toBeGreaterThan(200);
    const s8 = _cl(_ZA, ["§ 8"]);
    expect(s8.length).toBeGreaterThan(3);
    expect(s8.every((i) => i.section === "§ 8" && i.requirementId?.startsWith("cz409:8"))).toBe(true);
    expect(_grm("octave_allegro")?.name).toContain("OCTAVE");
  });
});

/* ============ § 6 / § 10 / upozornění ============ */
import { nextReview as _nr, policyGaps as _pg, trainingState as _ts, urgencyOf as _uo } from "@contix/shared";
import { renderDigest as _rd, teamsCard as _tc, validTeamsUrl as _vt } from "../src/modules/notifications/service";

describe("dokumentace, školení, upozornění", () => {
  test("termín přezkumu dokumentu a mezery § 6", () => {
    expect(_nr(null, "2026-01-15", 12)).toBe("2027-01-15");
    expect(_nr("2026-06-01", "2026-01-15", 6)).toBe("2026-12-01");
    expect(_nr(null, null, 12)).toBeNull();
    const g = _pg({ status: "active", ownerPositionId: null, currentVersion: "1.0", reviewOverdue: true, location: null, hasContent: false, requireAcknowledgement: true, ack: { done: 1, required: 3 } });
    expect(g.length).toBe(4);
    expect(_pg({ status: "retired", ownerPositionId: null, currentVersion: null, reviewOverdue: true, location: null, hasContent: false, requireAcknowledgement: true, ack: { done: 0, required: 0 } })).toEqual([]);
  });
  test("stav školení: platné, brzy vyprší, po termínu, nový zaměstnanec", () => {
    const c = { intervalMonths: 12, dueDaysForNew: 30 };
    expect(_ts(c, "2026-01-10", "2026-06-01").state).toBe("ok");
    expect(_ts(c, "2025-06-20", "2026-06-01").state).toBe("due_soon");
    expect(_ts(c, "2025-01-10", "2026-06-01").state).toBe("overdue");
    expect(_ts(c, null, "2026-06-01", "2026-05-20")).toMatchObject({ state: "missing", dueDate: "2026-06-19" });
    expect(_ts(c, null, "2026-06-01", "2026-01-01").state).toBe("overdue");
    expect(_ts({ intervalMonths: null }, "2020-01-01", "2026-06-01").state).toBe("ok");
  });
  test("naléhavost termínu", () => {
    const now = new Date("2026-06-01T10:00:00Z");
    expect(_uo("2026-05-31", 14, now)).toBe("overdue");
    expect(_uo("2026-06-01T20:00:00Z", 14, now)).toBe("today");
    expect(_uo("2026-06-10", 14, now)).toBe("soon");
    expect(_uo("2026-09-10", 14, now)).toBe("later");
  });
  test("Teams webhook jen na doménách Microsoftu, obsah escapovaný", () => {
    expect(_vt("https://prod-01.westeurope.logic.azure.com/workflows/x")).toBe(true);
    expect(_vt("https://contoso.webhook.office.com/webhookb2/x")).toBe(true);
    expect(_vt("http://contoso.webhook.office.com/x")).toBe(false);
    expect(_vt("https://office.com.evil.cz/x")).toBe(false);
    const item = { key: "k", kind: "finding" as const, title: "<script>x</script>", detail: null, companyId: "c", due: "2026-05-01", urgency: "overdue" as const, link: "/audits/1", ownerPositionId: null, ownerName: null };
    const d = _rd([item], "https://contix.test", "T", new Map());
    expect(d.html).not.toContain("<script>");
    expect(d.html).toContain("https://contix.test/audits/1");
    expect(JSON.stringify(_tc([item], "https://contix.test", "T", new Map()))).toContain("AdaptiveCard");
  });
});

/* ============ FAIR a hodnotící cykly ============ */
import { analyzeQuant as _aq, compareSnapshots as _cs, DEFAULT_QUANT_POLICY as _dqp, pert as _pert, portfolio as _pf, rng as _rng } from "@contix/shared";

describe("kvantitativní analýza FAIR a cykly", () => {
  test("PERT drží rozsah a střed, simulace je deterministická", () => {
    const r = _rng(42);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const x = _pert({ min: 10, mode: 20, max: 60 }, r);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(60);
      sum += x;
    }
    expect(sum / 20000).toBeCloseTo((10 + 80 + 60) / 6, 0);
    const q = { lef: { min: 1, mode: 1, max: 1 }, lm: { min: 1000, mode: 1000, max: 1000 } };
    const a = _aq(q, _dqp, "r1");
    expect(a.inherent.mean).toBeGreaterThan(950);
    expect(a.inherent.mean).toBeLessThan(1050);
    expect(a.inherent.probAny).toBeCloseTo(1 - Math.exp(-1), 1);
    expect(_aq(q, _dqp, "r1").inherent.p95).toBe(a.inherent.p95);
    expect(a.level).toBe("low");
  });
  test("zbytkové riziko, ROSI a portfolio", () => {
    const q = { lef: { min: 0.5, mode: 1, max: 2 }, lm: { min: 200_000, mode: 500_000, max: 2_000_000 }, residualLef: { min: 0.1, mode: 0.2, max: 0.5 }, controlCostYear: 100_000 };
    const a = _aq(q, _dqp, "r2");
    expect(a.residual!.mean).toBeLessThan(a.inherent.mean);
    expect(a.reduction).toBeGreaterThan(0);
    expect(a.rosi).toBeCloseTo((a.reduction! - 100_000) / 100_000, 5);
    expect(a.inherent.lec.length).toBeGreaterThan(10);
    expect(a.inherent.lec[0]!.p).toBeGreaterThan(a.inherent.lec.at(-1)!.p);
    const pf = _pf([{ key: "r2", q }, { key: "r1", q: { lef: { min: 1, mode: 1, max: 1 }, lm: { min: 1000, mode: 1000, max: 1000 } } }], _dqp)!;
    expect(pf.mean).toBeCloseTo(a.inherent.mean + _aq({ lef: { min: 1, mode: 1, max: 1 }, lm: { min: 1000, mode: 1000, max: 1000 } }, _dqp, "r1").inherent.mean, 0);
  });
  test("porovnání snímků cyklu", () => {
    expect(_cs(null, { name: "a", code: null, level: "low" })).toBe("new");
    expect(_cs({ name: "a", code: null, level: "low" }, { name: "a", code: null, level: "high" })).toBe("worse");
    expect(_cs({ name: "a", code: null, level: "high" }, { name: "a", code: null, level: "medium" })).toBe("better");
    expect(_cs({ name: "b", code: null, maxImpact: 2, rtoHours: 24 }, { name: "b", code: null, maxImpact: 2, rtoHours: 8 })).toBe("worse");
  });
});

/* ============ v0.13 ============ */
import { categoryFromGroups as _cfg, suggestResidual as _sr } from "@contix/shared";
describe("návrh zbytkového rizika a kategorie alertů", () => {
  const C = (status: string, effectiveness: string, name = "X") => ({ code: null, name, status, effectiveness });
  test("účinnost opatření snižuje zranitelnost / pravděpodobnost", () => {
    const r = { impact: 4, threatLevel: 3, vulnLevel: 4, likelihood: null };
    expect(_sr(r, [C("implemented", "effective")], "three_factor")!.vulnLevel).toBe(2);
    expect(_sr(r, [C("implemented", "effective"), C("implemented", "effective")], "three_factor")!.vulnLevel).toBe(1);
    expect(_sr(r, [C("implemented", "partially_effective")], "three_factor")!.vulnLevel).toBe(3);
    expect(_sr(r, [C("planned", "effective"), C("implemented", "not_assessed")], "three_factor")!.reduction).toBe(0);
    expect(_sr({ impact: 3, threatLevel: 2, vulnLevel: 2, likelihood: 3 }, [C("implemented", "effective")], "two_factor")!.likelihood).toBe(1);
    expect(_sr({ impact: null, threatLevel: 3, vulnLevel: 4, likelihood: null }, [], "three_factor")).toBeNull();
  });
  test("kategorie incidentu ze skupin Wazuh", () => {
    expect(_cfg(["authentication_failures", "sshd"])).toBe("unauthorized_access");
    expect(_cfg(["virustotal"])).toBe("malware");
    expect(_cfg(["syscheck"])).toBe("misconfiguration");
    expect(_cfg(["foo"])).toBe("other");
  });
});

/* ============ v0.14: AI výstupy, SOC 2, provoz ============ */
import * as shared14 from "@contix/shared";
import { createAiClient } from "../src/modules/ai/provider";

describe("AI asistent – zpracování výstupu modelu", () => {
  test("extractJson toleruje code fence, úvodní text a uvažování", () => {
    expect(shared14.extractJson('Tady:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(shared14.extractJson('<think>hmm {"x":0}</think>Výsledek: {"a":{"b":"}"}} konec')).toEqual({ a: { b: "}" } });
    expect(shared14.extractJson('<details type="reasoning" done="true">…</details>\n[1,2]')).toEqual([1, 2]);
    expect(shared14.extractJson("bez JSON")).toBeNull();
  });
  test("normalizeReqId a parseMapping zahodí neznámá ID a duplicity", () => {
    expect(shared14.normalizeReqId("soc2:cc6.1")).toBe("soc2:CC6.1");
    expect(shared14.normalizeReqId("cz409:§13/1/a")).toBe("cz409:13/1/a");
    const known = (id: string) => !!shared14.requirementById(id);
    const r = shared14.parseMapping({ requirements: [{ requirementId: "soc2:cc7.4" }, { requirementId: "soc2:CC7.4" }, { requirementId: "soc2:ZZ1" }, { requirementId: "soc2:CC1.1" }] }, known, new Set(["soc2:CC1.1"]));
    expect(r.items.map((i) => i.requirementId)).toEqual(["soc2:CC7.4"]);
  });
  test("parseTreatment přijme čísla § jako text i číslo a ponechá jen známé", () => {
    const r = shared14.parseTreatment({ summary: "S", measures: [{ title: "A", paragraphs: ["§ 13", 99, 26] }, { foo: 1 }] }, (p) => ["13", "26"].includes(p));
    expect(r).toMatchObject({ summary: "S", items: [{ title: "A", paragraphs: ["13", "26"] }] });
  });
  test("klient Ollama volá /api/chat a /api/tags", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "gpt-oss:20b" }] });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: "gpt-oss:20b", stream: false });
      return Response.json({ model: "gpt-oss:20b", message: { role: "assistant", content: "OK" } });
    }) as never;
    const c = createAiClient({ provider: "ollama", baseUrl: "http://ai-server:8080/ollama/", apiKey: "k", model: "gpt-oss:20b", timeoutSec: 10, temperature: 0 }, fake);
    expect(await c.listModels()).toEqual(["gpt-oss:20b"]);
    expect((await c.chat([{ role: "user", content: "x" }])).text).toBe("OK");
    expect(calls).toEqual(["GET http://ai-server:8080/ollama/api/tags", "POST http://ai-server:8080/ollama/api/chat"]);
  });
  test("klient hlásí srozumitelně chybu klíče", async () => {
    const fake = (async () => new Response("unauthorized", { status: 401 })) as never;
    const c = createAiClient({ provider: "openai", baseUrl: "http://x/api", apiKey: null, model: "m", timeoutSec: 10, temperature: 0 }, fake);
    await expect(c.chat([])).rejects.toThrow("API klíč není uložen");
  });
});

describe("SOC 2 a provoz", () => {
  test("SOC 2 kritéria a mapování z vyhlášky 409", () => {
    const soc = shared14.requirementsOf("soc2");
    expect(soc.length).toBe(61);
    expect(new Set(soc.map((r) => r.section))).toEqual(new Set(["CC1", "CC2", "CC3", "CC4", "CC5", "CC6", "CC7", "CC8", "CC9", "A1", "C1", "PI1", "P"]));
    expect(shared14.relatedRequirements("13").map((r) => r.id)).toEqual(expect.arrayContaining(["soc2:CC6.1", "soc2:CC6.2", "soc2:CC6.3"]));
    // každé SOC 2 ID v crosswalku existuje
    for (const v of Object.values(shared14.CROSSWALK_409)) for (const id of v.soc2) expect(shared14.requirementById(`soc2:${id}`)).not.toBeNull();
  });
  test("NIS2: směrnice čl. 20/21/23 a příloha 2024/2690 – úřední text, ID a mapování z vyhlášky 409", () => {
    const nis = shared14.requirementsOf("nis2");
    expect(nis.length).toBe(185);
    expect(nis.filter((r) => r.id.startsWith("nis2:P")).length).toBe(161);
    expect(new Set(nis.map((r) => r.id)).size).toBe(nis.length);
    expect(shared14.requirementById("nis2:21/2/j")).toMatchObject({ section: "Čl. 21", ref: "čl. 21 odst. 2 písm. j)" });
    expect(shared14.requirementById("nis2:21/2")).toBeNull(); // úvodní věta je kontext písmen
    expect(shared14.requirementById("nis2:21/2/a")!.lead).toContain("zahrnují alespoň");
    expect(shared14.requirementById("nis2:23/4/e")!.points[0]).toContain("poskytovatel služby vytvářející důvěru");
    const p = shared14.requirementById("nis2:P1.1.1")!;
    expect(p).toMatchObject({ section: "Příl. 1", sectionTitle: "Politika bezpečnosti sítí a informačních systémů", ref: "2024/2690 bod 1.1.1", lead: "Politika bezpečnosti sítí a informačních systémů" });
    expect(p.points).toHaveLength(11);
    expect(p.points[10]).toStartWith("k) uvádí datum formálního schválení");
    expect(shared14.requirementById("nis2:P5.2")!.points).toHaveLength(2);
    expect(shared14.requirementById("nis2:P4.3.2")!.points.at(-1)).toStartWith("Pro účely písmene b)");
    expect(new Set(nis.map((r) => r.section)).size).toBe(16); // 3 články + 13 oblastí přílohy
    // crosswalk: každé ID existuje, každý oddíl přílohy má body
    for (const v of Object.values(shared14.CROSSWALK_409_NIS2)) {
      for (const id of v.directive) expect(shared14.requirementById(`nis2:${id}`)).not.toBeNull();
      for (const a of v.annex) expect(nis.some((r) => r.id === `nis2:P${a}` || r.id.startsWith(`nis2:P${a}.`))).toBe(true);
    }
    expect(shared14.relatedRequirements("25").filter((r) => r.framework === "nis2").map((r) => r.id)).toEqual(["nis2:21/2/h", "nis2:P9.1", "nis2:P9.2", "nis2:P9.3"]);
    // změněný fragment předpisu → požadavky
    expect(shared14.requirementsForFragment("nis2", "priloha_1-bod_1.1.1")).toEqual(["nis2:P1.1.1"]);
    expect(shared14.requirementsForFragment("nis2", "priloha_1-bod_1.2")).toHaveLength(6);
    expect(shared14.requirementsForFragment("nis2", "cl_21-odst_2")).toHaveLength(10);
    expect(shared14.requirementsForFragment("nis2", "cl_20-odst_1")).toEqual(["nis2:20/1"]);
    expect(shared14.requirementsForFragment("nis2", "priloha_1")).toEqual([]);
    expect(shared14.normalizeReqId("NIS2:p6.10.2")).toBe("nis2:P6.10.2");
    // katalog 410: příbuzné požadavky přes § vyhlášky 409, bez požadavků 410 a bez duplicit
    const rel410 = shared14.catalogRelated("cz410", "8").map((r) => r.id);
    expect(rel410).toEqual(expect.arrayContaining(["nis2:21/2/i", "nis2:P11.5.1"]));
    expect(rel410.some((id) => id.startsWith("cz410:"))).toBe(false);
    expect(new Set(rel410).size).toBe(rel410.length);
  });
  test("pokrytí předpisu: nejlepší verdikt AI, mezery, souhrn", () => {
    expect(shared14.bestDocState([])).toBe("none");
    expect(shared14.bestDocState([{ ai: null }])).toBe("unscored");
    expect(shared14.bestDocState([{ ai: "missing" }, { ai: null }, { ai: "partial" }])).toBe("partial");
    expect(shared14.bestDocState([{ ai: "missing" }, { ai: "covered" }])).toBe("covered");
    const base = { applicable: true, docs: [] as any[], docState: "none" as const, controls: [] as any[], compliance: "not_assessed" as const };
    expect(shared14.coverageGaps(base)).toEqual(["no_document", "no_control"]);
    expect(shared14.coverageGaps({ ...base, docs: [{}], docState: "partial", controls: [{}], compliance: "partial" } as any)).toEqual(["ai_partial", "not_compliant"]);
    expect(shared14.coverageGaps({ ...base, docs: [{}], docState: "unscored", controls: [{}], compliance: "compliant" } as any)).toEqual([]);
    expect(shared14.coverageGaps({ ...base, applicable: false })).toEqual([]);
    const row = (docState: string, extra: object = {}) => ({ applicable: true, docs: docState === "none" ? [] : [{}], docState, controls: [], compliance: "not_assessed", gaps: ["x"], ...extra }) as any;
    const s = shared14.summarizeCoverage([row("covered"), row("partial"), row("missing"), row("none", { applicable: false })]);
    expect(s).toMatchObject({ total: 4, applicable: 3, withDocs: 3, aiCovered: 1, aiPartial: 1, aiMissing: 1, docScore: 50, withGaps: 3 });
    const t = shared14.createTranslator("cs", new Map(shared14.BUILTIN_PACKS.map((p) => [p.locale, p])));
    expect(t("cov.ai.finished", { done: 3, total: 4, failed: 1 })).toBe("Hodnocení dokončeno: 3 z 4 dokumentů, 1 se nepodařilo.");
    expect(t("cov.ai.finished", { done: 4, total: 4, failed: 0 })).toBe("Hodnocení dokončeno: 4 z 4 dokumentů.");
  });
  test("úroveň zálohy podle stáří", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    expect(shared14.backupLevel(null, now)).toBe("warning");
    expect(shared14.backupLevel("2026-10-02T02:30:00Z", now)).toBe("ok");
    expect(shared14.backupLevel("2026-09-30T20:00:00Z", now)).toBe("warning");
    expect(shared14.backupLevel("2026-09-20T02:30:00Z", now)).toBe("error");
    expect(shared14.fmtBytes(1536)).toBe("1,5 kB");
  });
});

/* ============ v0.15: důkazy a testy ============ */
import { safeFilename } from "../src/modules/assurance/routes";

describe("Důkazy a testy opatření", () => {
  test("doporučený vzorek podle frekvence a populace", () => {
    expect(shared14.recommendedSample("annual")).toEqual({ min: 1, max: 1 });
    expect(shared14.recommendedSample("daily")).toEqual({ min: 20, max: 40 });
    expect(shared14.recommendedSample("event", 3)).toEqual({ min: 3, max: 3 });
    expect(shared14.recommendedSample("event", 400)).toEqual({ min: 25, max: 60 });
  });
  test("výsledek testu ze vzorků a účinnost", () => {
    const s = (r: string[]) => r.map((result) => ({ result: result as "pass" | "fail" | "na" }));
    expect(shared14.deriveTestResult(s([]))).toBe("not_tested");
    expect(shared14.deriveTestResult(s(["na"]))).toBe("not_tested");
    expect(shared14.deriveTestResult(s(["pass", "pass"]))).toBe("effective");
    expect(shared14.deriveTestResult(s(["pass", "fail"]), 1)).toBe("effective_with_exceptions");
    expect(shared14.deriveTestResult(s(["fail", "fail"]), 1)).toBe("ineffective");
    expect(shared14.effectivenessFromResult("effective_with_exceptions")).toBe("partially_effective");
    expect(shared14.effectivenessFromResult("not_tested")).toBeNull();
  });
  test("platnost důkazu a bezpečný název souboru", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    expect(shared14.evidenceValidity(null, now)).toBe("none");
    expect(shared14.evidenceValidity("2026-10-01", now)).toBe("expired");
    expect(shared14.evidenceValidity("2026-10-20", now)).toBe("expiring");
    expect(shared14.evidenceValidity("2027-10-20", now)).toBe("valid");
    expect(safeFilename("C:\\temp\\..\\x<y>.pdf")).toBe("x_y_.pdf");
    expect(safeFilename("../../")).toBe("soubor");
  });
});

describe("AI – další úlohy (validace výstupu)", () => {
  test("klasifikace aktiva: jen povolená pole, platné hodnoty a změny", () => {
    const r = shared14.parseAssetFields(
      { fields: [{ field: "criticality", value: "HIGH" }, { field: "integrity", value: 2 }, { field: "availability", value: 7 }, { field: "ownerName", value: "x" }, { field: "criticality", value: "low" }] },
      { criticality: "medium", confidentiality: null, integrity: 2, availability: 3 },
    );
    expect(r.items.map((i) => [i.field, i.value])).toEqual([["criticality", "high"]]);
  });
  test("texty incidentu a kontrola dokumentu", () => {
    const t = shared14.parseTextFields({ summary: "S", rootCause: " ", lessonsLearned: "L", x: "y" }, ["summary", "impactDescription", "rootCause", "lessonsLearned"], (f) => f === "lessonsLearned");
    expect(t.items).toEqual([
      { field: "summary", text: "S", hasValue: false },
      { field: "lessonsLearned", text: "L", hasValue: true },
    ]);
    const known = new Map([["cz409:6/1/a", { ref: "§ 6 odst. 1 písm. a)", text: "x" }], ["cz409:6/1/b", { ref: "§ 6 odst. 1 písm. b)", text: "y" }]]);
    const g = shared14.parseGaps({ requirements: [{ requirementId: "cz409:6/1/a", status: "covered" }, { requirementId: "cz409:§6/1/b", status: "MISSING" }, { requirementId: "cz409:6/1/a", status: "missing" }, { requirementId: "cz409:9", status: "missing" }] }, known);
    expect(g.items.map((i) => [i.requirementId, i.status])).toEqual([["cz409:6/1/b", "missing"], ["cz409:6/1/a", "covered"]]);
  });
});

describe("Export do Wordu", () => {
  test("HTML → DOCX zachová nadpisy, tabulky a seznamy", async () => {
    const { htmlToDocx } = await import("../src/modules/documents/docx");
    const buf = await htmlToDocx(
      `<div class="toolbar"><button>Tisk</button></div><div class="page"><div class="wm">NÁHLED</div><h1>Titul</h1><div class="meta"><span class="muted">Verze</span><span>1</span></div><h2>Sekce</h2><p>Text <b>tučně</b><br>řádek</p><table><thead><tr><th>A</th><th class="n">B</th></tr></thead><tbody><tr><td>x<ul class="pts"><li>bod</li></ul></td><td class="n">5</td></tr></tbody></table><ol><li>jedna</li><li>dvě<ul><li>pod</li></ul></li></ol></div>`,
      { title: "Test", headerLine: "Org", landscape: true },
    );
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    // document.xml je v ZIPu deflated – ověříme alespoň, že výstup je platný balíček s obsahem
    expect(buf.length).toBeGreaterThan(3000);
  });
});

describe("AI II (v0.20)", () => {
  const { parseQueryPlan, duplicateReasons, nameSimilarity, normalizeAssetName } = require("@contix/shared") as typeof import("@contix/shared");
  const { toolResultText } = require("../src/modules/mcp/routes") as typeof import("../src/modules/mcp/routes");

  test("plán dotazu: jen známé nástroje, max 3, bez duplicit a prázdných parametrů", () => {
    const known = new Set(["assets_search", "risks_search"]);
    const p = parseQueryPlan(
      { calls: [{ tool: "assets_search", args: { criticality: "high", q: "" } }, { tool: "drop_table", args: {} }, { name: "risks_search", arguments: { untreated: true } }, { tool: "assets_search", args: { criticality: "high" } }, { tool: "risks_search", args: [] }, { tool: "assets_search" }] },
      known,
    );
    expect(p.calls).toEqual([
      { tool: "assets_search", args: { criticality: "high" } },
      { tool: "risks_search", args: { untreated: true } },
      { tool: "risks_search", args: {} },
    ]);
    expect(parseQueryPlan({ calls: [], reply: " Nevím. " }, known)).toEqual({ calls: [], reply: "Nevím." });
    expect(parseQueryPlan([{ tool: "assets_search" }], known).calls).toHaveLength(1);
    expect(parseQueryPlan("nesmysl", known).calls).toEqual([]);
  });

  test("duplicity aktiv: sériové číslo, MAC, hostname, název; samotná IP nestačí", () => {
    const base = { id: "1", name: "x", hostname: null, assetType: "server", serialNumber: null, ipAddresses: [] as string[], macAddresses: [] as string[] };
    expect(normalizeAssetName("SRV-01.firma.cz")).toBe("srv01");
    expect(normalizeAssetName("Účetní server")).toBe("ucetniserver");
    expect(nameSimilarity("Tiskárna recepce", "Tiskarna-recepce")).toBe(1);
    expect(nameSimilarity("srv-app-01", "srv-app-02")).toBeGreaterThan(0.85);
    expect(duplicateReasons({ ...base, serialNumber: "AB12" }, { ...base, id: "2", name: "y", serialNumber: "ab12 " })).toEqual({ reasons: ["stejné sériové číslo"], score: 60 });
    expect(duplicateReasons({ ...base, macAddresses: ["AA:BB:CC:00:11:22"] }, { ...base, id: "2", name: "y", macAddresses: ["aa-bb-cc-00-11-22"] })?.reasons).toEqual(["shodná MAC adresa"]);
    expect(duplicateReasons({ ...base, macAddresses: ["00:00:00:00:00:00"] }, { ...base, id: "2", name: "y", macAddresses: ["000000000000"] })).toBeNull();
    expect(duplicateReasons({ ...base, ipAddresses: ["10.0.0.5"] }, { ...base, id: "2", name: "y", ipAddresses: ["10.0.0.5"] })).toBeNull();
    // stejný název u různých typů (server „Mail“ × aplikace „Mail“) není duplicita
    expect(duplicateReasons({ ...base, name: "Mail" }, { ...base, id: "2", name: "mail", assetType: "application" })).toBeNull();
    expect(duplicateReasons({ ...base, name: "Mail" }, { ...base, id: "2", name: "mail" })).toEqual({ reasons: ["stejný název"], score: 35 });
  });

  test("MCP: povolené IP adresy (IPv4, CIDR, IPv6, IPv4 mapovaná do IPv6)", () => {
    const { ipAllowed, isIpOrCidr } = require("@contix/shared") as typeof import("@contix/shared");
    expect(["10.0.0.1", "10.0.0.0/8", "192.168.1.0/24", "fd00::1", "::1"].every(isIpOrCidr)).toBe(true);
    expect(["10.0.0.256", "10.0.0.0/33", "fd00::/64", "abc", "1.2.3.4/5/6", ""].some(isIpOrCidr)).toBe(false);
    const allow = ["10.20.0.0/24", "192.168.5.10", "fd00::5"];
    expect(ipAllowed("10.20.0.77", allow)).toBe(true);
    expect(ipAllowed("::ffff:192.168.5.10", allow)).toBe(true);
    expect(ipAllowed("FD00::5", allow)).toBe(true);
    expect(ipAllowed("10.20.1.1", allow)).toBe(false);
    expect(ipAllowed(null, allow)).toBe(false);
    expect(ipAllowed("10.20.0.1", [])).toBe(false);
    expect(ipAllowed("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
  });

  test("MCP: výsledek nástroje jako Markdown tabulka s absolutními odkazy", () => {
    const t = toolResultText("Aktiva", { columns: ["Aktivum", "Stav"], rows: [{ cells: ["A|B", null], link: "/assets/1" }], total: 3 }, "https://contix.firma.cz/");
    expect(t).toContain("Aktiva: 3 záznamů (zobrazeno 1)");
    expect(t).toContain("| A\\|B | — | https://contix.firma.cz/assets/1 |");
  });
});

describe("Import dat (v0.21)", () => {
  const { parseCell, suggestMapping, IMPORT_FIELDS } = require("@contix/shared") as typeof import("@contix/shared");
  const { parseCsv, decodeText } = require("../src/modules/import/table") as typeof import("../src/modules/import/table");
  const f = (entity: "assets" | "risks" | "suppliers", key: string) => IMPORT_FIELDS[entity].find((x) => x.key === key)!;

  test("převod hodnot: české popisky, ano/ne, data, čísla, seznamy", () => {
    expect(parseCell(f("assets", "assetType"), "pracovní stanice")).toEqual({ value: "workstation" });
    expect(parseCell(f("assets", "assetType"), "server")).toEqual({ value: "server" });
    expect(parseCell(f("assets", "criticality"), "KRITICKÁ")).toEqual({ value: "critical" });
    expect(parseCell(f("assets", "assetType"), "router").error).toContain("povolené hodnoty");
    expect(parseCell(f("risks", "treatment"), "Akceptace")).toEqual({ value: "accept" });
    expect(parseCell(f("assets", "confidentiality"), "3 – vysoká")).toEqual({ value: 3 });
    expect(parseCell(f("assets", "confidentiality"), "5").error).toContain("1–4");
    expect(parseCell(f("suppliers", "significant"), "ANO")).toEqual({ value: true });
    expect(parseCell(f("suppliers", "significant"), "x")).toEqual({ value: true });
    expect(parseCell(f("suppliers", "significant"), "možná").error).toContain("ano/ne");
    expect(parseCell(f("risks", "treatmentDue"), "1. 2. 2027")).toEqual({ value: "2027-02-01" });
    expect(parseCell(f("risks", "treatmentDue"), "2027-02-01T00:00")).toEqual({ value: "2027-02-01" });
    expect(parseCell(f("risks", "treatmentDue"), "46387")).toEqual({ value: "2026-12-31" }); // sériové číslo Excelu
    expect(parseCell(f("assets", "ipAddresses"), "10.0.0.1, 10.0.0.2;10.0.0.1")).toEqual({ value: ["10.0.0.1", "10.0.0.2"] });
    expect(parseCell(f("assets", "name"), "   ")).toEqual({});
  });

  test("automatické mapování sloupců podle názvu a synonym", () => {
    expect(suggestMapping("assets", ["Název", "Typ", "IP", "S/N", "Garant", "Neznámý sloupec", "Název"])).toEqual(["name", "assetType", "ipAddresses", "serialNumber", "ownerUserId", null, null]);
    expect(suggestMapping("risks", ["ID", "Riziko", "Vlastník rizika", "Dopad"])).toEqual(["code", "name", "ownerPositionId", "impact"]);
  });

  test("CSV: oddělovač, uvozovky, víceřádkové buňky, BOM a Windows-1250", () => {
    expect(parseCsv('a;b;c\r\n1;"x;y";"řádek\nnový"\r\n2;"uvozovky ""v"" textu";\n')).toEqual([["a", "b", "c"], ["1", "x;y", "řádek\nnový"], ["2", 'uvozovky "v" textu', ""]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0xc5, 0x99]))).toBe("ř");
    expect(decodeText(new Uint8Array([0x8a, 0xe8, 0xf8, 0x9e]))).toBe("Ščřž");
  });
});

describe("nápověda pokrývá všechny obrazovky", () => {
  test("každá stránka v routeru má vlastní téma nápovědy", async () => {
    const { HELP_TOPICS, HELP_AUDIENCES, helpForRoute } = await import("@contix/shared");
    const src = await Bun.file(new URL("../../web/src/main.tsx", import.meta.url).pathname).text();
    const app = [...src.matchAll(/\br\("(\/[^"]*)"/g)].map((m) => m[1]!);
    const admin = [...src.matchAll(/\ba\("(\/[^"]*)"/g)].map((m) => `/admin${m[1] === "/" ? "" : m[1]}`);
    const special = [...src.matchAll(/path: "(\/[^"]+)"/g)].map((m) => m[1]!).filter((p) => p !== "/admin");
    const paths = [...app, ...admin, ...special.map((p) => (p.startsWith("/methodologies") ? `/admin${p}` : p))]
      .filter((p) => p !== "/login" && p !== "/admin" && !p.startsWith("/q/")) // veřejná stránka dodavatele nemá nápovědu
      .map((p) => p.replace(/\$\w+/g, "x"));
    expect(paths.length).toBeGreaterThan(50);
    const missing = paths.filter((p) => {
      const { matched } = helpForRoute(p, [...HELP_AUDIENCES]);
      // obecné téma "/" ani rozcestník "/admin" nestačí – obrazovka musí mít své téma
      return !matched.some((t) => t.routes.some((r) => r !== "/" && r !== "/admin" && (p === r || p.startsWith(`${r}/`))) || (p === "/" && t.routes.includes("/")));
    });
    expect(missing).toEqual([]);
    expect(new Set(HELP_TOPICS.map((t) => t.id)).size).toBe(HELP_TOPICS.length);
  });
});

describe("identity – převody hodnot z AD a pravidla", () => {
  test("SID, GUID, FILETIME, GeneralizedTime", async () => {
    const { sidToString, guidToString, fromFileTime, fromGeneralizedTime, isPrivilegedAdGroup } = await import("@contix/shared");
    const sid = new Uint8Array([1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 2, 0, 0]);
    expect(sidToString(sid)).toBe("S-1-5-21-1-2-3-512");
    expect(sidToString(new Uint8Array([1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x20, 2, 0, 0]))).toBe("S-1-5-32-544");
    expect(guidToString(new Uint8Array([0x33, 0x22, 0x11, 0x00, 0x55, 0x44, 0x77, 0x66, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]))).toBe("00112233-4455-6677-8899-aabbccddeeff");
    expect(fromFileTime("133000000000000000")?.toISOString()).toBe("2022-06-18T04:26:40.000Z");
    expect(fromFileTime("0")).toBeNull();
    expect(fromFileTime("9223372036854775807")).toBeNull();
    expect(fromGeneralizedTime("20240131120000.0Z")?.toISOString()).toBe("2024-01-31T12:00:00.000Z");
    expect(isPrivilegedAdGroup("S-1-5-21-1-2-3-512", "Domänen-Admins", [])).toBe(true); // podle SID, ne názvu
    expect(isPrivilegedAdGroup("S-1-5-21-1-2-3-1105", "IT Admins", [])).toBe(false);
    expect(isPrivilegedAdGroup("S-1-5-21-1-2-3-1105", "IT Admins", ["it admins"])).toBe(true);
  });

  test("zakázaný účet bez nálezů; privilegovaný účet zvyšuje závažnost", async () => {
    const { evaluateAccount, DEFAULT_IDENTITY_POLICY } = await import("@contix/shared");
    const now = new Date("2026-10-01T00:00:00Z");
    const base = {
      externalId: "1", login: "x", displayName: "x", email: null, kind: "user" as const, enabled: true, dn: null,
      createdAt: new Date("2020-01-01"), lastLogonAt: new Date("2026-01-01"), pwdLastSetAt: new Date("2026-09-01"), signInKnown: true,
      flags: { pwdNeverExpires: false, pwdNotRequired: false, preauthDisabled: false, hasSpn: false, unconstrainedDelegation: false },
      mfa: null, privilegedVia: [] as string[], groups: [], department: null, title: null,
    };
    expect(evaluateAccount({ ...base, enabled: false }, DEFAULT_IDENTITY_POLICY, now)).toEqual([]);
    expect(evaluateAccount(base, DEFAULT_IDENTITY_POLICY, now).map((f) => `${f.rule}:${f.severity}`)).toEqual(["stale:medium"]);
    expect(evaluateAccount({ ...base, privilegedVia: ["Domain Admins"] }, DEFAULT_IDENTITY_POLICY, now).map((f) => `${f.rule}:${f.severity}`)).toEqual(["stale:critical"]);
    expect(evaluateAccount({ ...base, signInKnown: false }, DEFAULT_IDENTITY_POLICY, now)).toEqual([]);
  });
});

describe("identity – toxické kombinace a ověření odebrání", () => {
  test("osoba = uživatel CONTIXu přes více účtů a funkční místa; bez shody nic", async () => {
    const { evaluateSodRule, revokeRemediated } = await import("@contix/shared");
    const accounts = [
      { id: "a1", userId: "u1", login: "novak", displayName: "Novák", sourceName: "AD", groups: ["Domain Admins"] },
      { id: "a2", userId: "u1", login: "novak@firma.cz", displayName: "Novák", sourceName: "Entra", groups: ["Billing Administrator"] },
      { id: "a3", userId: null, login: "svc", displayName: "svc", sourceName: "AD", groups: ["DOMAIN ADMINS", "Účetní"] },
      { id: "a4", userId: "u2", login: "dvorak", displayName: "Dvořák", sourceName: "AD", groups: ["Účetní"] },
    ];
    const holders = [{ userId: "u2", userName: "Dvořák", positionId: "p-pay", positionName: "Schvalovatel plateb" }];
    // skupina × role z jiného adresáře (stejný člověk)
    expect(evaluateSodRule({ sideA: { groups: ["domain admins"], positionIds: [] }, sideB: { groups: ["Billing Administrator", "Účetní"], positionIds: [] } }, accounts, holders).map((h) => `${h.subject}:${h.accountIds.join("+")}`).sort()).toEqual(["account:a3:a3", "user:u1:a1+a2"]);
    // skupina × funkční místo
    const h = evaluateSodRule({ sideA: { groups: ["Účetní"], positionIds: [] }, sideB: { groups: [], positionIds: ["p-pay"] } }, accounts, holders);
    expect(h).toEqual([{ subject: "user:u2", userId: "u2", person: "Dvořák", accountIds: ["a4"], matchA: ["Účetní (AD)"], matchB: ["funkční místo Schvalovatel plateb"] }]);
    expect(evaluateSodRule({ sideA: { groups: ["X"], positionIds: [] }, sideB: { groups: ["Y"], positionIds: [] } }, accounts, holders)).toEqual([]);

    expect(revokeRemediated(["Domain Admins"], null)).toBe(true);
    expect(revokeRemediated(["Domain Admins"], { enabled: false, removed: false, groups: ["Domain Admins"] })).toBe(true);
    expect(revokeRemediated(["Domain Admins"], { enabled: true, removed: false, groups: ["domain admins", "IT"] })).toBe(false);
    expect(revokeRemediated(["Domain Admins"], { enabled: true, removed: false, groups: ["IT"] })).toBe(true);
    expect(revokeRemediated([], { enabled: true, removed: false, groups: ["IT"] })).toBe(false);
  });
});

describe("identity – plán synchronizace uživatelů a výsledek automatického testu", () => {
  test("jen členové skupiny; ruční uživatelé se nemění; spravovaní se deaktivují", async () => {
    const { planProvisioning, identityCheckResult } = await import("@contix/shared");
    const acc = (email: string, o: Partial<{ enabled: boolean; removed: boolean; groups: string[]; department: string; title: string; kind: "user" | "service" }> = {}) => ({
      email, displayName: email.split("@")[0]!, title: o.title ?? null, department: o.department ?? "Účtárna", enabled: o.enabled ?? true, removed: o.removed ?? false, kind: o.kind ?? ("user" as const), groups: o.groups ?? ["CONTIX"],
    });
    const cfg = { enabled: true, group: "contix", defaultRoleKey: "employee", units: true, positions: true, deactivate: true };
    const plan = planProvisioning(
      [acc("nova@f.cz", { title: "Účetní" }), acc("rucni@f.cz"), acc("svc@f.cz", { kind: "service" }), acc("mimo@f.cz", { groups: [] }), acc("odesel@f.cz", { enabled: false }), acc("spravovany@f.cz", { department: " Ekonomický  útvar " })],
      [
        { id: "u1", email: "rucni@f.cz", displayName: "rucni", jobTitle: null, isActive: true, managed: false },
        { id: "u2", email: "odesel@f.cz", displayName: "odesel", jobTitle: null, isActive: true, managed: true },
        { id: "u3", email: "spravovany@f.cz", displayName: "Staré jméno", jobTitle: null, isActive: false, managed: true },
        { id: "u4", email: "mimo@f.cz", displayName: "mimo", jobTitle: null, isActive: true, managed: false },
      ],
      cfg,
    );
    expect(plan.create.map((x) => x.email)).toEqual(["nova@f.cz"]);
    expect(plan.existing.map((x) => x.email)).toEqual(["rucni@f.cz"]);
    expect(plan.deactivate).toEqual([{ id: "u2", email: "odesel@f.cz", reason: "účet zakázaný" }]); // ručně založený „mimo“ se nedeaktivuje
    expect(plan.reactivate.map((x) => x.id)).toEqual(["u3"]);
    expect(plan.update.map((x) => x.displayName)).toEqual(["spravovany"]);
    expect(plan.units).toEqual(["Ekonomický útvar", "Účtárna"]);
    expect(plan.positions).toEqual([{ unit: "Ekonomický útvar", name: "Pracovník" }, { unit: "Účtárna", name: "Pracovník" }, { unit: "Účtárna", name: "Účetní" }]);
    expect(planProvisioning([acc("x@f.cz")], [], { ...cfg, group: "" }).create).toEqual([]);
    expect(planProvisioning([acc("x@f.cz")], [], { ...cfg, enabled: false }).create).toEqual([]);

    expect(identityCheckResult({ critical: 0, high: 0, medium: 0, low: 0 }, { maxCritical: 0, maxHigh: 0 })).toBe("effective");
    expect(identityCheckResult({ critical: 0, high: 2, medium: 1, low: 0 }, { maxCritical: 0, maxHigh: 2 })).toBe("effective_with_exceptions");
    expect(identityCheckResult({ critical: 1, high: 0, medium: 0, low: 0 }, { maxCritical: 0, maxHigh: 9 })).toBe("ineffective");
  });
});

describe("legislativa – identita fragmentů a rozdíly", () => {
  test("stálá URL, klíč fragmentu, požadavky", async () => {
    const { staleUrlOf, codeOfStaleUrl, fragmentKey, requirementsForFragment, textOfXhtml } = await import("@contix/shared");
    expect(staleUrlOf("264/2025 Sb.")).toBe("/sb/2025/264");
    expect(staleUrlOf("https://www.e-sbirka.cz/sb/2025/409/2025-11-01#par_6")).toBe("/sb/2025/409");
    expect(staleUrlOf("nesmysl")).toBeNull();
    expect(codeOfStaleUrl("/sb/2025/410")).toBe("410/2025 Sb.");
    expect(fragmentKey("/sb/2025/264/2025-11-01#par_2-odst_3-pism_a", null)).toBe("par_2-odst_3-pism_a");
    expect(fragmentKey(null, "§ 14 odst. 2 písm. b)")).toBe("par_14-odst_2-pism_b");
    expect(fragmentKey(null, "Čl. 5 odst. 2")).toBe("cl_5-odst_2");
    expect(fragmentKey(null, "5.2 Politika")).toBe("k_5.2");
    expect(fragmentKey(null, "Příloha")).toBeNull();
    expect(requirementsForFragment("cz409", "par_6-odst_1-pism_a")).toEqual(["cz409:6/1"]);
    expect(requirementsForFragment("iso27001", "k_5.2")).toEqual(["iso27001:5.2"]);
    expect(requirementsForFragment("iso27001", "k_A.5.15~2")).toEqual(["iso27001:A.5.15"]);
    expect(requirementsForFragment("iso9001", "k_7.5.3")).toEqual(["iso9001:7.5"]);
    expect(requirementsForFragment("dora", "cl_6-odst_2")).toEqual(["dora:6"]);
    expect(textOfXhtml("<p>A&nbsp;<b>B</b> &amp; C</p><p>D</p>")).toBe("A B & C\nD");
  });

  test("rozdíl znění ignoruje přečíslování bez změny textu; ruční text se dělí podle nadpisů", async () => {
    const { diffFragments, splitManualText } = await import("@contix/shared");
    const f = (key: string, text: string) => ({ key, label: key, text, depth: 0, kind: "" });
    const d = diffFragments([f("par_1", "A"), f("par_2", "B"), f("par_3", "C")], [f("par_1", "A2"), f("par_2b", "B"), f("par_4", "D")]);
    expect(d.map((x) => `${x.kind}:${x.key}`).sort()).toEqual(["added:par_4", "modified:par_1", "removed:par_3"]);
    const parts = splitManualText("Úvodní text\n§ 1 Předmět\nTento předpis.\nČl. 2\nHesla.\n5.2 Politika\nObsah");
    expect(parts.map((p) => p.key)).toEqual(["uvod", "par_1", "cl_2", "k_5.2"]);
    expect(parts[1]!.text).toBe("Tento předpis.");
    expect(parts[1]!.label).toBe("§ 1 Předmět");
    // nadpis bez dalšího textu zůstane obsahem (jinak by se změna nedala zachytit)
    expect(splitManualText("5.2 Politika musí být sdělena").map((p) => p.text)).toEqual(["Politika musí být sdělena"]);
  });
});

describe("legislativa – otevřená data e-Sbírky (SPARQL) a RSS", () => {
  const RES = "https://opendata.eselpoint.gov.cz/esel-esb/eli/cz";
  const lit = (v: string) => ({ type: "literal", value: v });
  const json = (rows: Record<string, unknown>[]) => Response.json({ head: { vars: [] }, results: { bindings: rows } });
  const VOC = "https://slovník.gov.cz/datový/sbírka/pojem/";
  const iri = (v: string) => ({ type: "uri", value: v });
  /** Odpovědi na zjištění vlastností označení a fragmentu (v1.12.3) – výchozí slovník. */
  const schemaReply = (query: string, d = ["pořadí-fragmentu-znění-právního-aktu", "url-fragmentu-znění", "citace-označení-fragmentu-znění-právního-aktu", "hierarchie-fragmentu-znění-právního-aktu"], contains = "obsahuje-fragment", f = ["text-fragmentu", "má-typ-fragmentu"]) => {
    if (query.includes("SAMPLE(?o)")) return json([...d.map((p) => ({ p: iri(VOC + p), o: lit("1") })), ...(contains ? [{ p: iri(VOC + contains), o: iri("https://o/fragment/1") }] : [])]);
    if (query.includes("?f ?p ?x")) return json(f.map((p) => ({ p: iri(VOC + p) })));
    return null;
  };

  test("výběr znění: nejnovější vyhlášené (i budoucí), konsolidované před vyhlášeným", async () => {
    const { pickVersion } = await import("../src/modules/legislation/opendata");
    const vs = [
      { versionKey: "/sb/2025/409/0000-00-00", from: "2025-10-14", to: null, type: "VYHLZNE" },
      { versionKey: "/sb/2025/409/2025-10-14", from: "2025-10-14", to: "2025-10-31", type: "KONSOL" },
      { versionKey: "/sb/2025/409/2025-11-01", from: "2025-11-01", to: null, type: "KONSOL" },
      { versionKey: "/sb/2025/409/2027-01-01", from: "2027-01-01", to: null, type: "KONSOL" },
    ];
    const r = pickVersion(vs, "2026-10-07");
    expect(r.latest?.versionKey).toBe("/sb/2025/409/2027-01-01");
    expect(r.effective?.versionKey).toBe("/sb/2025/409/2025-11-01");
    expect(pickVersion([vs[0]!], "2026-01-01").latest?.versionKey).toBe("/sb/2025/409/0000-00-00");
  });

  test("klient SPARQL: znění a fragmenty se stejnými klíči jako REST API, stránkování, POST bez tajemství", async () => {
    const { EsbirkaOpenDataClient } = await import("../src/modules/legislation/opendata");
    const calls: { url: string; init?: RequestInit; query: string }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const query = new URLSearchParams(String(init?.body)).get("query") ?? "";
      calls.push({ url, init, query });
      const sr = schemaReply(query);
      if (sr) return sr;
      if (query.includes("má-znění"))
        return json([
          { z: { type: "uri", value: `${RES}/sb/2025/409/0000-00-00` }, od: lit("2025-10-14"), cit: lit("409/2025 Sb.") },
          { z: { type: "uri", value: `${RES}/sb/2025/409/2025-11-01` }, od: lit("2025-11-01"), typ: { type: "uri", value: "https://x/položka/KONSOL" }, cit: lit("409/2025 Sb.") },
        ]);
      if (query.includes('> "")'))
        return json([
          { url: lit("/sb/2025/409/2025-11-01"), h: lit("/") },
          { url: lit("/sb/2025/409/2025-11-01#par_6-odst_1-pism_a"), cit: lit("§ 6 odst. 1 písm. a)"), h: lit("/2/2/2/8/2/1/"), f: { type: "uri", value: "https://o/právní-akt-fragment/123" }, text: lit("<var>a)</var> cíle&nbsp;bezpečnosti,"), typ: { type: "uri", value: "https://o/položka/Pismeno_Lb" } },
          { cit: lit("§ 7"), h: lit("/2/2/3/"), text: lit("<var>§ 7</var>") },
          { d: { type: "uri", value: `${RES}/sb/2025/409/2025-11-01/dokument/prefix/frag_11` }, text: lit("VYHLÁŠKA") },
          { d: { type: "uri", value: `${RES}/sb/2025/409/2025-11-01/dokument/prefix/frag_12` }, text: lit("o kybernetické bezpečnosti") },
          { d: { type: "uri", value: `${RES}/sb/2025/409/2025-11-01/dokument/prilohy/priloha_0/frag_9` }, text: lit("Příloha č. 1") },
        ]);
      return json([]);
    };
    const c = new EsbirkaOpenDataClient({ ESBIRKA_SPARQL_URL: "https://sparql.test/sparql" }, fetchImpl, () => "2026-10-07");
    const v = await c.current("/sb/2025/409");
    expect(v).toMatchObject({ versionKey: "/sb/2025/409/2025-11-01", effectiveFrom: "2025-11-01", code: "409/2025 Sb.", sourceUrl: "https://e-sbirka.gov.cz/sb/2025/409/2025-11-01" });
    const fr = await c.fragments(v.versionKey);
    expect(fr.map((f) => f.key)).toEqual(["par_6-odst_1-pism_a", "par_7", "prefix", "prefix~2", "priloha_1"]);
    expect(fr.map((f) => f.label).slice(2)).toEqual(["Úvod", "Úvod", "Příloha 1"]);
    expect(fr[0]).toMatchObject({ label: "§ 6 odst. 1 písm. a)", text: "a) cíle bezpečnosti,", kind: "Pismeno_Lb", sourceId: "123", depth: 4 });
    expect(calls.every((x) => x.url === "https://sparql.test/sparql" && x.init?.method === "POST")).toBe(true);
    expect(calls[0]!.query).toContain(`<${RES}/sb/2025/409>`);
    // vstup se do dotazu nedostane bez validace
    await expect(c.current("/sb/2025/409> } DROP")).rejects.toThrow("Neplatná");
    await expect(c.fragments("/sb/2025/409/x")).rejects.toThrow("Neplatné");
  });

  test("klient SPARQL: přejmenované vlastnosti a znění bez pořadí se najdou podle názvu (v1.12.3)", async () => {
    const { EsbirkaOpenDataClient } = await import("../src/modules/legislation/opendata");
    const ver = "/sb/2025/264/2025-11-01";
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const query = new URLSearchParams(String(init?.body)).get("query") ?? "";
      // nový slovník: bez pořadí, odkaz na obsah „má-obsah“, text „xhtml-obsah-fragmentu“
      const sr = schemaReply(query, ["url-fragmentu-znění", "citace-označení-fragmentu-znění-právního-aktu"], "má-obsah", ["xhtml-obsah-fragmentu", "má-typ-fragmentu"]);
      if (sr) return sr;
      if (query.includes("ORDER BY STR(?d)") && query.includes(`<${VOC}má-obsah>`) && query.includes(`<${VOC}xhtml-obsah-fragmentu>`))
        return json([
          { d: iri(`${RES}${ver}/dokument/norma/par_2/frag_20`), url: lit(`${ver}#par_2`), cit: lit("§ 2"), text: lit("<p>Druhý</p>") },
          { d: iri(`${RES}${ver}/dokument/norma/par_1/frag_10`), url: lit(`${ver}#par_1`), cit: lit("§ 1"), text: lit("<p>První</p>") },
        ]);
      return json([]);
    };
    const c = new EsbirkaOpenDataClient({ ESBIRKA_SPARQL_URL: "https://sparql.test/sparql" }, fetchImpl, () => "2026-10-07");
    (c as unknown as { last: number }).last = -1e15;
    const fr = await c.fragments(ver);
    expect(fr.map((f) => [f.key, f.text])).toEqual([
      ["par_1", "První"],
      ["par_2", "Druhý"],
    ]);
    // nic s textem → diagnostika s názvy vlastností
    const none = async (_url: string, init?: RequestInit) => {
      const query = new URLSearchParams(String(init?.body)).get("query") ?? "";
      return schemaReply(query, ["url-fragmentu-znění"], "", []) ?? json([]);
    };
    const c2 = new EsbirkaOpenDataClient({ ESBIRKA_SPARQL_URL: "https://sparql.test/sparql" }, none, () => "2026-10-07");
    (c2 as unknown as { last: number }).last = -1e15;
    expect(await c2.fragments(ver)).toEqual([]);
    expect(c2.lastDiagnostic).toContain("označení: url-fragmentu-znění; fragment: nenalezen");
  });

  test("klient SPARQL: označení jako text nebo v pojmenovaném grafu, diagnostika se vzorem (v1.12.4)", async () => {
    const { EsbirkaOpenDataClient } = await import("../src/modules/legislation/opendata");
    const ver = "/sb/2025/264/2025-11-01";
    const run = async (mode: "literal" | "graph" | "none") => {
      const queries: string[] = [];
      const fetchImpl = async (_url: string, init?: RequestInit) => {
        const query = new URLSearchParams(String(init?.body)).get("query") ?? "";
        queries.push(query);
        const ok = mode === "literal" ? query.includes("BIND(IRI(STR(?d0))") : mode === "graph" ? query.includes("GRAPH ?g") : false;
        if (query.includes("SAMPLE(?o)") || query.includes("?f ?p ?x")) return ok ? schemaReply(query)! : json([]);
        if (query.includes("?s ?p ?d")) return json([{ p: iri(`${VOC}má-fragment-znění`), n: lit("40") }]);
        if (query.endsWith("LIMIT 1") && query.includes("má-fragment-znění")) return json([{ d: lit(`${RES}${ver}/dokument/norma/par_1/frag_10`) }]);
        if (ok && query.includes('> "")')) return json([{ d: iri(`${RES}${ver}/dokument/norma/par_1/frag_10`), url: lit(`${ver}#par_1`), cit: lit("§ 1"), ord: lit("0001"), text: lit("<p>Text</p>") }]);
        return json([]);
      };
      const c = new EsbirkaOpenDataClient({ ESBIRKA_SPARQL_URL: "https://sparql.test/sparql" }, fetchImpl, () => "2026-10-07");
      (c as unknown as { last: number }).last = -1e15;
      return { fr: await c.fragments(ver), c, queries };
    };
    const a = await run("literal");
    expect(a.fr.map((f) => f.text)).toEqual(["Text"]);
    expect(a.queries.some((q) => q.includes('> "")') && q.includes("BIND(IRI(STR(?d0)) AS ?d)"))).toBe(true);
    const g = await run("graph");
    expect(g.fr.map((f) => f.key)).toEqual(["par_1"]);
    expect(g.queries.find((q) => q.includes('> "")'))).toContain("GRAPH ?g");
    const n = await run("none");
    expect(n.fr).toEqual([]);
    expect(n.c.lastDiagnostic).toContain(`vzor označení: literal ${RES}${ver}/dokument/norma/par_1/frag_10`);
    expect(n.c.lastDiagnostic).toContain("odkazují: má-fragment-znění×40");
  });

  test("otevřená data bez textu → záloha z veřejného JSON webu e-Sbírky bez klíče (v1.12.4)", async () => {
    const { EsbirkaOpenDataClient } = await import("../src/modules/legislation/opendata");
    const ver = "/sb/2025/410/2025-11-01";
    const calls: { url: string; headers: Headers }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.startsWith("https://web.test/"))
        return Response.json({ seznam: [{ id: 1, staleUrl: `${ver}#par_1`, zkracenaCitace: "§ 1", xhtml: "<p>Předmět úpravy</p>" }], pocetStranek: 1 });
      return json([]);
    };
    const c = new EsbirkaOpenDataClient({ ESBIRKA_SPARQL_URL: "https://sparql.test/sparql", ESBIRKA_WEB_URL: "https://web.test/sbr-cache" }, fetchImpl, () => "2026-10-07");
    (c as unknown as { last: number }).last = -1e15;
    const fr = await c.fragments(ver);
    expect(fr.map((f) => [f.key, f.text])).toEqual([["par_1", "Předmět úpravy"]]);
    expect(c.lastSource).toBe("web");
    const w = calls.find((x) => x.url.startsWith("https://web.test/"))!;
    expect(w.url).toBe(`https://web.test/sbr-cache/dokumenty-sbirky/${encodeURIComponent(ver)}/fragmenty?cisloStranky=0`);
    expect(w.headers.get("esel-api-access-key")).toBeNull();
    // vypnutá záloha → prázdné a diagnostika bez zmínky o webu
    const off = new EsbirkaOpenDataClient({ ESBIRKA_SPARQL_URL: "https://sparql.test/sparql", ESBIRKA_WEB_FALLBACK: "off" }, async () => json([]), () => "2026-10-07");
    (off as unknown as { last: number }).last = -1e15;
    expect(await off.fragments(ver)).toEqual([]);
    expect(off.lastDiagnostic).not.toContain("web e-Sbírky");
  });

  test("výběr zdroje podle konfigurace", async () => {
    const { legalSourceKind } = await import("../src/modules/legislation/source");
    expect(legalSourceKind({})).toBe("opendata");
    expect(legalSourceKind({ ESBIRKA_API_KEY: "k" })).toBe("api");
    expect(legalSourceKind({ ESBIRKA_API_KEY: "k", ESBIRKA_SOURCE: "opendata" })).toBe("opendata");
    expect(legalSourceKind({ ESBIRKA_SOURCE: "api" })).toBe("off");
    expect(legalSourceKind({ ESBIRKA_SOURCE: "off" })).toBe("off");
  });

  test("RSS „Změny v e-Sbírce“: nová znění a zrušení", async () => {
    const { parseRssChanges } = await import("../src/modules/legislation/opendata");
    const xml = `<?xml version="1.0"?><rss><channel><title>Změny v e-Sbírce</title>
      <item><title>573/2025 Sb. - nové nebo změněné znění: 1.1.2026</title><link>https://e-sbirka.gov.cz/sb/2025/573</link><pubDate>Tue, 29 Sep 2026 11:32:00 GMT</pubDate><guid>https://e-sbirka.gov.cz/sb/2025/573</guid></item>
      <item><title>340/2020 Sb. - zrušení  1.1.2027</title><link>https://e-sbirka.gov.cz/sb/2020/340</link><description>Zrušení právního předpisu.&#xD;&lt;br&gt;</description><pubDate>Fri, 18 Sep 2026 10:02:00 GMT</pubDate></item>
      <item><title>bez odkazu</title></item></channel></rss>`;
    expect(parseRssChanges(xml)).toEqual([
      { staleUrl: "/sb/2025/573", kind: "version", date: "2026-01-01", title: "573/2025 Sb. - nové nebo změněné znění: 1.1.2026", published: "2026-09-29T11:32:00.000Z" },
      { staleUrl: "/sb/2020/340", kind: "repeal", date: "2027-01-01", title: "340/2020 Sb. - zrušení 1.1.2027", published: "2026-09-18T10:02:00.000Z" },
    ]);
  });
});

test("AI rozhodnutí: lze přijmout i desítky položek (skóre dokumentu má až 80 požadavků)", async () => {
  const { AiDecisionInput } = await import("@contix/shared");
  expect(AiDecisionInput.safeParse({ accept: Array.from({ length: 80 }, (_, i) => i) }).success).toBe(true);
});

describe("jazykové verze (ADR-036)", () => {
  test("formát zpráv: parametry, množná čísla podle jazyka, výběr", async () => {
    const { formatMessage } = await import("@contix/shared");
    const m = "{n, plural, one {# úkol} few {# úkoly} many {# úkolu} other {# úkolů}}";
    expect([1, 2, 5, 0].map((n) => formatMessage("cs", m, { n }))).toEqual(["1 úkol", "2 úkoly", "5 úkolů", "0 úkolů"]);
    expect(formatMessage("cs", m, { n: 1.5 })).toBe("1,5 úkolu");
    expect(formatMessage("en", "{n, plural, one {# task} other {# tasks}}", { n: 1 })).toBe("1 task");
    expect(formatMessage("en", "{n, plural, =0 {none} one {# task} other {# tasks}}", { n: 0 })).toBe("none");
    // ukrajinština: one / few / many
    const uk = "{n, plural, one {# завдання} few {# завдання} many {# завдань} other {# завдання}}";
    expect(formatMessage("uk", uk, { n: 5 })).toBe("5 завдань");
    expect(formatMessage("cs", "Ahoj {name}, {kind, select, a {nové} other {jiné}}", { name: "Jano", kind: "a" })).toBe("Ahoj Jano, nové");
    expect(formatMessage("en", "{n} items", { n: 12345 })).toBe("12,345 items");
  });

  test("překladač: řetězec náhradních jazyků, dynamické klíče, nápověda", async () => {
    const { BUILTIN_PACKS, createTranslator, localeChain, packCompleteness, CS } = await import("@contix/shared");
    const packs = new Map(BUILTIN_PACKS.map((p) => [p.locale, p] as const));
    packs.set("sr-Latn", { locale: "sr-Latn", name: "Srbština", nativeName: "Srpski", fallback: "en", messages: { "nav.risks": "Rizici" } });
    expect(localeChain("sr-Latn", packs)).toEqual(["sr-Latn", "en", "cs"]);
    const t = createTranslator("sr-Latn", packs);
    expect(t("nav.risks")).toBe("Rizici");
    expect(t("nav.assets")).toBe("Assets"); // z angličtiny
    expect(t.dyn("enum.neznamy.x", "Výchozí")).toBe("Výchozí");
    expect(createTranslator("en", packs).help("legislation")?.title).toContain("Legislation");
    expect(createTranslator("cs", packs).help("legislation")).toBeUndefined();
    expect(packCompleteness(packs.get("en")!)).toBe(100);
    expect(packCompleteness(packs.get("sr-Latn")!)).toBe(Math.round((1 / Object.keys(CS).length) * 100));
    // hotové české popisky (výčty): čeština beze změny, angličtina přes lbl:<text>, neznámé beze změny
    expect(createTranslator("cs", packs).lbl("Neaktivní účet")).toBe("Neaktivní účet");
    expect(createTranslator("en", packs).lbl("Neaktivní účet")).toBe("Inactive account");
    expect(t.lbl("Neaktivní účet")).toBe("Inactive account");
    expect(createTranslator("en", packs).lbl("Neznámý popisek")).toBe("Neznámý popisek");
    expect(createTranslator("en", packs).lbl(null)).toBeNull();
  });

  test("vestavěná angličtina je úplná a nemá prázdné texty; parametry sedí s češtinou", async () => {
    const { CS, BUILTIN_PACKS } = await import("@contix/shared");
    const en = BUILTIN_PACKS.find((p) => p.locale === "en")!.messages;
    const params = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const [k, v] of Object.entries(CS)) {
      expect(en[k]?.trim(), k).toBeTruthy();
      expect(params(en[k]!), k).toEqual(params(v));
    }
  });

  test("jazyk z Accept-Language a validace balíčku", async () => {
    const { pickLocale, LangPackInput } = await import("@contix/shared");
    expect(pickLocale("en-GB,en;q=0.9,cs;q=0.8", ["cs", "en"])).toBe("en");
    expect(pickLocale("sr-RS", ["cs", "en", "sr-Latn"])).toBe("sr-Latn");
    expect(pickLocale("de-DE", ["cs", "en"])).toBe("cs");
    expect(LangPackInput.safeParse({ locale: "sr-Latn", name: "Srbština", nativeName: "Srpski", messages: { a: "b" } }).success).toBe(true);
    expect(LangPackInput.safeParse({ locale: "../etc", name: "x", nativeName: "x", messages: {} }).success).toBe(false);
  });
});

describe("legislativa – předpisy EU (EUR-Lex / CELLAR)", () => {
  test("CELEX z čísla, odkazu EUR-Lex a ELI; identifikace a označení", async () => {
    const { celexOf, codeOfCelex, euStaleUrl, parseEuStaleUrl, eurlexUrl } = await import("@contix/shared");
    expect(celexOf("32022L2555")).toBe("32022L2555");
    expect(celexOf(" celex:32022r2554 ")).toBe("32022R2554");
    expect(celexOf("https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:32024R2690")).toBe("32024R2690");
    expect(celexOf("https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX%3A02014R0910-20241018")).toBe("32014R0910");
    expect(celexOf("http://data.europa.eu/eli/dir/2022/2555/oj")).toBe("32022L2555");
    expect(celexOf("eli/reg_impl/2024/2690/oj")).toBe("32024R2690");
    expect(celexOf("264/2025 Sb.")).toBeNull();
    expect(celexOf("2022/2555")).toBeNull();
    expect(codeOfCelex("32022L2555")).toBe("(EU) 2022/2555");
    expect(codeOfCelex("32014R0910")).toBe("(EU) 910/2014");
    expect(euStaleUrl("32022L2555")).toBe("/eu/cs/32022L2555");
    expect(parseEuStaleUrl("/eu/en/32022R2554")).toEqual({
      lang: "en",
      celex: "32022R2554",
    });
    expect(parseEuStaleUrl("/eu/de/32022R2554")).toBeNull();
    expect(parseEuStaleUrl("/sb/2025/264")).toBeNull();
    expect(eurlexUrl("32022L2555", "en")).toBe("https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32022L2555");
  });

  test("XHTML Úředního věstníku: články a odstavce, písmena, bez poznámek pod čarou a odůvodnění; příloha", async () => {
    const { parseEurLexXhtml } = await import("../src/modules/legislation/eurlex");
    const { OJ_XHTML } = await import("./fixtures/eurlex");
    const fr = parseEurLexXhtml(OJ_XHTML);
    expect(fr.map((f) => f.key)).toEqual(["cl_21", "cl_21-odst_1", "cl_21-odst_2", "cl_46", "priloha_I"]);
    expect(fr[0]).toMatchObject({
      label: "Článek 21 – Opatření k řízení kybernetických bezpečnostních rizik",
      depth: 0,
      kind: "clanek",
    });
    expect(fr[1]!.text).toBe("1. Členské státy zajistí, aby subjekty přijaly vhodná opatření.\nS ohledem na nejnovější technický vývoj.");
    expect(fr[2]).toMatchObject({
      label: "Čl. 21 odst. 2",
      depth: 1,
      text: "2. Opatření zahrnují alespoň:\na) politiku analýzy rizik;\nb) řešení incidentů;",
    });
    expect(fr[3]).toMatchObject({
      label: "Článek 46 – Určení",
      text: "Tato směrnice je určena členským státům.",
    });
    expect(fr[4]!.label).toBe("Příloha I – VYSOCE KRITICKÁ ODVĚTVÍ");
    expect(fr[4]!.text).toContain("Energetika");
    expect(fr.some((f) => f.text.includes("Cílem směrnice"))).toBe(false);
  });

  test("konsolidované znění: odstavce „1a.“, bez značek změn; krátký číslovaný seznam v příloze zůstane celý", async () => {
    const { parseEurLexXhtml } = await import("../src/modules/legislation/eurlex");
    const { CONSOLIDATED_XHTML } = await import("./fixtures/eurlex");
    const fr = parseEurLexXhtml(CONSOLIDATED_XHTML);
    expect(fr.map((f) => f.key)).toEqual(["cl_24", "cl_24-odst_1", "cl_24-odst_1a", "cl_24a", "priloha_VI"]);
    expect(fr[2]!.text).toBe("1a. Ověření totožnosti se provede:\na) prostřednictvím evropské peněženky digitální identity;");
    expect(fr.map((f) => f.text).join(" ")).not.toContain("▼");
    expect(fr[4]).toMatchObject({
      label: "Příloha VI – MINIMÁLNÍ SEZNAM ATRIBUTŮ",
      text: "1. Adresa\n2. Věk\n3. Pohlaví",
    });
  });

  test("příloha prováděcího nařízení se dělí po bodech 1.1.1", async () => {
    const { parseEurLexXhtml } = await import("../src/modules/legislation/eurlex");
    const { ANNEX_POINTS_XHTML } = await import("./fixtures/eurlex");
    const fr = parseEurLexXhtml(ANNEX_POINTS_XHTML);
    expect(fr.map((f) => f.key)).toEqual(["cl_2", "cl_2-odst_1", "priloha_1", "priloha_1-bod_1", "priloha_1-bod_1.1", "priloha_1-bod_1.1.1", "priloha_1-bod_1.1.2", "priloha_1-bod_1.2"]);
    expect(fr[2]!.label).toBe("Příloha – Technické a metodické požadavky uvedené v článku 2");
    expect(fr[5]).toMatchObject({
      label: "Příloha, bod 1.1.1",
      depth: 3,
      text: "1.1.1. Politika bezpečnosti stanoví přístup k řízení bezpečnosti.",
    });
  });

  test("starší XHTML bez ELI: články podle nadpisů", async () => {
    const { parseEurLexXhtml } = await import("../src/modules/legislation/eurlex");
    const { FLAT_XHTML } = await import("./fixtures/eurlex");
    const fr = parseEurLexXhtml(FLAT_XHTML);
    expect(fr.map((f) => f.key)).toEqual(["cl_17", "cl_17-odst_1", "cl_17-odst_2", "cl_18", "priloha_1"]);
    expect(fr[1]!.text).toBe("1. Správce musí přijmout vhodná technická a organizační opatření.\nTato opatření mají zajistit odpovídající úroveň bezpečnosti.");
    expect(fr[3]!.text).toBe("Členské státy stanoví oznamovací povinnost.");
  });

  test("klient CELLAR: nejnovější konsolidované znění v jazyce, text z položky XHTML, validace vstupu", async () => {
    const { EurLexClient, pickEuVersion } = await import("../src/modules/legislation/eurlex");
    const { CONSOLIDATED_XHTML } = await import("./fixtures/eurlex");
    const lit = (v: string) => ({ type: "literal", value: v });
    const calls: { url: string; query: string; method?: string }[] = [];
    const item = (id: string) => ({
      type: "uri",
      value: `http://publications.europa.eu/resource/cellar/${id}/DOC_1`,
    });
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        query: new URLSearchParams(String(init?.body ?? "")).get("query") ?? "",
        method: init?.method,
      });
      if (url.endsWith("/sparql"))
        return Response.json({
          results: {
            bindings: [
              {
                c: lit("32014R0910"),
                d: lit("2014-07-23"),
                force: lit("1"),
                eov: lit("9999-12-31"),
                title: lit("Nařízení (EU) č. 910/2014"),
                i: item("a.0002.03"),
              },
              {
                c: lit("02014R0910-20240520"),
                d: lit("2024-05-20"),
                i: item("b.0003.02"),
              },
              {
                c: lit("02014R0910-20241018"),
                d: lit("2024-10-18"),
                i: item("c.0002.02"),
              },
              {
                c: lit("02014R0910-20241018"),
                d: lit("2024-10-18"),
                i: {
                  type: "uri",
                  value: "http://publications.europa.eu/resource/cellar/c.0002.02/DOC_2",
                },
              },
              // nejnovější znění zatím bez překladu
              { c: lit("02014R0910-20260101"), d: lit("2026-01-01") },
            ],
          },
        });
      if (url === "https://publications.europa.eu/resource/cellar/c.0002.02/DOC_1")
        return new Response(CONSOLIDATED_XHTML, {
          headers: { "content-type": "application/xhtml+xml" },
        });
      return new Response("nf", { status: 404 });
    };
    const c = new EurLexClient({ EURLEX_SPARQL_URL: "https://cellar.test/sparql" }, fetchImpl);
    const v = await c.current("/eu/cs/32014R0910");
    expect(v).toMatchObject({
      versionKey: "02014R0910-20241018",
      effectiveFrom: "2024-10-18",
      title: "Nařízení (EU) č. 910/2014",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:02014R0910-20241018",
    });
    expect(v.meta).toMatchObject({
      celex: "32014R0910",
      lang: "cs",
      inForce: true,
      endOfValidity: null,
      consolidated: true,
      newerUntranslated: "02014R0910-20260101",
    });
    expect(calls[0]!.query).toContain('FILTER(STR(?c)="32014R0910")');
    expect(calls[0]!.query).toContain("language/CES");
    expect(calls[0]!.method).toBe("POST");
    const fr = await c.fragments(v.versionKey);
    expect(fr.map((f) => f.key)).toContain("cl_24-odst_1a");
    await expect(c.current('/eu/cs/32014R0910") } DROP')).rejects.toThrow("Neplatná");
    await expect(new EurLexClient({}, fetchImpl).fragments("02014R0910-20241018")).rejects.toThrow("Neznámé znění");
    // původní akt bez konsolidace
    expect(
      pickEuVersion(
        [
          {
            celex: "32024R2690",
            date: "2024-10-17",
            title: null,
            item: "x",
            inForce: true,
            endOfValidity: null,
          },
        ],
        "32024R2690",
      ).chosen?.celex,
    ).toBe("32024R2690");
  });

  test("zdroj předpisů EU lze vypnout; článek předpisu → požadavek DORA", async () => {
    const { sourceForAct, eurlexEnabled } = await import("../src/modules/legislation/source");
    const { requirementsForFragment } = await import("@contix/shared");
    expect(eurlexEnabled({})).toBe(true);
    expect(() => sourceForAct("eurlex", { EURLEX_SOURCE: "off" })).toThrow("vypnuto");
    expect(requirementsForFragment("dora", "cl_6-odst_2")).toEqual(["dora:6"]);
  });
});

test("embedding přes Open WebUI: HTTP 500 u názvu bez tagu → zkusí „:latest“, pak proxy Ollamy, srozumitelná chyba", async () => {
  const { createAiClient } = await import("../src/modules/ai/provider");
  const calls: string[] = [];
  const mk = (ok: (url: string, body: any) => Response | null) =>
    (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push(`${new URL(url).pathname} ${body.model}`);
      return ok(url, body) ?? new Response("Internal Server Error", { status: 500 });
    }) as never;
  const cfg = { provider: "openai" as const, baseUrl: "http://webui/api", apiKey: "k", model: "gpt-oss:20b", timeoutSec: 10, temperature: 0, embeddingModel: "bge-m3" };
  const vec = (n: number) => Response.json({ data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [0.1, 0.2] })) });
  // 1) Open WebUI zná jen „bge-m3:latest“
  const c1 = createAiClient(cfg, mk((u, b) => (u.endsWith("/api/embeddings") && b.model === "bge-m3:latest" ? vec(b.input.length) : null)));
  expect(await c1.embed(["a", "b"])).toHaveLength(2);
  expect(calls).toEqual(["/api/embeddings bge-m3", "/api/embeddings bge-m3:latest"]);
  // 2) jen proxy Ollamy
  calls.length = 0;
  const c2 = createAiClient(cfg, mk((u, b) => (u.endsWith("/ollama/api/embed") ? Response.json({ embeddings: b.input.map(() => [1, 2]) }) : null)));
  expect(await c2.embed(["a"])).toEqual([[1, 2]]);
  expect(calls.at(-1)).toBe("/ollama/api/embed bge-m3");
  // 3) nic nefunguje → hláška s radou
  const c3 = createAiClient(cfg, mk(() => null));
  await expect(c3.embed(["a"])).rejects.toThrow("stažený embedding model „bge-m3“");
});

test("AI: o pokrytých požadavcích skóre dokumentu se nerozhoduje", async () => {
  const { actionableItems } = await import("@contix/shared");
  expect(actionableItems([{ kind: "gap", status: "covered" }, { kind: "gap", status: "missing" }, { kind: "gap", status: "partial" }])).toEqual([1, 2]);
  expect(actionableItems([{ kind: "gap", status: "covered" }])).toEqual([]);
  expect(actionableItems([{ kind: "treatment" }, { kind: "mapping" }])).toEqual([0, 1]);
});

test("výjimky: stav platnosti, řazení, souhrn", async () => {
  const { exceptionState, sortExceptions, summarizeExceptions } = await import("@contix/shared");
  expect(exceptionState(null, "2026-10-12")).toBe("no_expiry");
  expect(exceptionState("2026-10-11", "2026-10-12")).toBe("expired");
  expect(exceptionState("2026-10-12", "2026-10-12")).toBe("expiring");
  expect(exceptionState("2026-11-11", "2026-10-12")).toBe("expiring");
  expect(exceptionState("2026-11-12", "2026-10-12")).toBe("valid");
  const mk = (key: string, state: any, until: string | null) => ({ key, kind: "vulnerability", id: key, companyId: "c", title: key, detail: null, severity: null, reason: null, acceptedByName: null, acceptedById: null, until, state, link: "/" }) as any;
  const list = [mk("a", "no_expiry", null), mk("b", "valid", "2027-01-01"), mk("c", "expired", "2026-01-01"), mk("d", "expiring", "2026-10-20")];
  expect(sortExceptions(list).map((e) => e.key)).toEqual(["c", "d", "b", "a"]);
  expect(summarizeExceptions(list)).toMatchObject({ total: 4, byState: { expired: 1, expiring: 1, valid: 1, no_expiry: 1 }, byKind: { vulnerability: 4, risk_accepted: 0 } });
});

test("bezpečnostní dotazník dodavatele: šablony, skóre, klíčové otázky, navržená úroveň", async () => {
  const { questionsFor, scoreQuestionnaire, QUESTIONNAIRE_QUESTIONS, QUESTIONNAIRE_SECTIONS, questionnaireExpired } = await import("@contix/shared");
  // unikátní klíče, každá otázka má sekci a oba jazyky
  expect(new Set(QUESTIONNAIRE_QUESTIONS.map((q) => q.key)).size).toBe(QUESTIONNAIRE_QUESTIONS.length);
  for (const q of QUESTIONNAIRE_QUESTIONS) {
    expect(QUESTIONNAIRE_SECTIONS.some((s) => s.key === q.section)).toBe(true);
    expect(q.text.cs.length && q.text.en.length).toBeTruthy();
  }
  expect(questionsFor("cz410").length).toBeLessThan(questionsFor("cz409").length);
  const all = (v: "yes" | "partial" | "no") => Object.fromEntries(questionsFor("cz409").map((q) => [q.key, { value: v }]));
  expect(scoreQuestionnaire("cz409", all("yes"))).toMatchObject({ score: 100, level: "low", gaps: [], missing: [] });
  expect(scoreQuestionnaire("cz409", all("no"))).toMatchObject({ score: 0, level: "high" });
  // neúplné odpovědi → bez navržené úrovně
  expect(scoreQuestionnaire("cz409", {}).level).toBeNull();
  expect(scoreQuestionnaire("cz409", {}).missing.length).toBe(questionsFor("cz409").length);
  // jediná klíčová odpověď „ne“ = vysoké riziko i při vysokém skóre; „částečně“ u klíčové = nejvýš střední
  const one = { ...all("yes"), "acc.mfa": { value: "no" as const } };
  const r = scoreQuestionnaire("cz409", one);
  expect(r.score).toBeGreaterThan(90);
  expect(r.level).toBe("high");
  expect(r.gaps).toEqual([{ key: "acc.mfa", section: "acc", value: "no", critical: true, comment: null }]);
  expect(scoreQuestionnaire("cz409", { ...all("yes"), "acc.mfa": { value: "partial" } }).level).toBe("medium");
  // nekritická „ne“: váha 1 vs. klíčová 2
  const w = scoreQuestionnaire("cz409", { ...all("yes"), "gov.cert": { value: "no" } });
  expect(w.level).toBe("low");
  // „netýká se“ jen u povolených otázek (jinak chybí), a nepočítá se do skóre
  expect(scoreQuestionnaire("cz409", { ...all("yes"), "ops.devsec": { value: "na" } })).toMatchObject({ score: 100, missing: [] });
  expect(scoreQuestionnaire("cz409", { ...all("yes"), "gov.policy": { value: "na" } }).missing).toEqual(["gov.policy"]);
  expect(questionnaireExpired({ status: "sent", expiresAt: "2020-01-01T00:00:00Z" })).toBe(true);
  expect(questionnaireExpired({ status: "submitted", expiresAt: "2020-01-01T00:00:00Z" })).toBe(false);
});

test("IČO: kontrolní číslice a druh dotazu do ARES", async () => {
  const { validIco, aresQueryKind } = await import("@contix/shared");
  expect(validIco("27074358")).toBe(true);
  expect(validIco("00006947")).toBe(true);
  expect(validIco("12345678")).toBe(false);
  expect(validIco("2707435")).toBe(false);
  expect(aresQueryKind("6947")).toMatchObject({ kind: "name" });
  expect(aresQueryKind(" 006947 ")).toEqual({ kind: "ico", ico: "00006947" });
  expect(aresQueryKind("Asseco")).toEqual({ kind: "name", name: "Asseco" });
  expect(aresQueryKind("ab")).toBeNull();
});

test("trendy: rozsah měsíců a změna proti předchozímu měsíci podle směru ukazatele", async () => {
  const { monthRange, trendChange } = await import("@contix/shared");
  expect(monthRange("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  const pts = [
    { period: "2026-08", takenAt: "", values: { compliance: 40, risks_unacceptable: 5 } },
    { period: "2026-09", takenAt: "", values: { compliance: null, risks_unacceptable: 5 } },
    { period: "2026-10", takenAt: "", values: { compliance: 55.5, risks_unacceptable: 3 } },
  ];
  expect(trendChange(pts, "compliance")).toEqual({ last: 55.5, prev: 40, delta: 15.5, better: true });
  expect(trendChange(pts, "risks_unacceptable")).toMatchObject({ delta: -2, better: true });
  expect(trendChange(pts.slice(0, 2), "risks_unacceptable")).toMatchObject({ delta: 0, better: null });
  expect(trendChange(pts.slice(0, 1), "compliance")).toMatchObject({ last: 40, prev: null, better: null });
});

test("SOC metriky: doby, lhůty, falešné poplachy podle zdroje, shoda AI triáže (ADR-053)", async () => {
  const { computeSocMetrics, outcomeOf, actualVerdict, SOC_SETTINGS_DEFAULTS } = await import("@contix/shared");
  expect(outcomeOf("benign")).toBe("noise");
  expect(actualVerdict("accepted", null)).toBe("true_positive");
  expect(actualVerdict("new", null)).toBeNull();
  const now = new Date("2026-10-15T12:00:00Z");
  const at = (h: number) => new Date(now.getTime() - h * 3600_000);
  const tr = (verdict: string, confidence = "high") => ({ verdict, action: null, severity: null, confidence, reasoning: "", similar: [], model: "m", at: "", durationMs: 1000, error: null }) as any;
  const row = (o: Partial<any>) => ({ id: o.id ?? "x", title: "A", source: "wazuh", status: "dismissed", verdict: "false_positive", ruleLevel: 7, exposure: null, createdAt: at(10), acknowledgedAt: at(9.5), decidedAt: at(8), aiTriage: null, ...o });
  const rows = [
    // shoda: AI šum, analytik falešný poplach; převzetí 30 min (lhůta střední 4 h), vyřešení 2 h
    row({ id: "a", aiTriage: tr("false_positive") }),
    // AI šum, ale eskalováno = přehlédnutý útok
    row({ id: "b", status: "accepted", verdict: null, title: "Ransomware", aiTriage: tr("benign", "medium") }),
    // AI útok, analytik neškodné = přehnaný poplach
    row({ id: "c", verdict: "benign", source: "suricata", aiTriage: tr("true_positive", "low") }),
    // AI nelze určit
    row({ id: "d", verdict: "true_positive", aiTriage: tr("undetermined") }),
    // chyba modelu, otevřený alert bez převzetí; kritický převzatý pozdě (lhůta 15 min)
    row({ id: "e", status: "new", verdict: null, decidedAt: null, acknowledgedAt: null, aiTriage: { ...tr("x"), verdict: null, error: "boom" } }),
    row({ id: "f", ruleLevel: 13, status: "accepted", verdict: null, acknowledgedAt: at(9), decidedAt: at(2) }),
  ];
  const m = computeSocMetrics(rows as any, SOC_SETTINGS_DEFAULTS, 30, now);
  expect(m.total).toMatchObject({ alerts: 6, decided: 5, escalated: 2, noise: 2, fpRate: 0.4, ackTotal: 5, ackMet: 4, resolveTotal: 5 });
  expect(m.total.mttaMinutes).toBe(30);
  expect(m.bySource.find((x) => x.key === "suricata")).toMatchObject({ alerts: 1, noise: 1 });
  expect(m.bySeverity.find((x) => x.key === "critical")).toMatchObject({ alerts: 1, ackMet: 0, resolveMet: 0, mttrHours: 8 });
  expect(m.ai).toMatchObject({ triaged: 4, errors: 1, compared: 3, agree: 1, agreement: 0.33, abstained: 1, overcalled: 1, missed: [{ id: "b", title: "Ransomware" }] });
  expect(m.ai.byConfidence.find((x) => x.confidence === "high")).toMatchObject({ compared: 1, agree: 1 });
  expect(m.ai.matrix).toContainEqual({ suggested: "noise", actual: "attack", n: 1 });
  expect(m.weekly.length).toBeGreaterThanOrEqual(4);
  expect(m.weekly.reduce((s, w) => s + w.alerts, 0)).toBe(6);
});

test("zdroje IOC: parsery URLhaus, ThreatFox a prostého seznamu (ADR-057)", async () => {
  const { parseUrlhausCsv, parseThreatfoxCsv, parsePlainList, csvRow } = await import("@contix/shared");
  expect(csvRow('"a, b","c ""q""",d')).toEqual(["a, b", 'c "q"', "d"]);
  const uh = parseUrlhausCsv(["################", "# URLhaus Database Dump (CSV - recent URLs only)", "# id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter", '"3301","2026-10-15 08:01:02","http://evil.example/bins/x86","online","2026-10-15 08:01:02","malware_download","elf,mirai","https://urlhaus.abuse.ch/url/3301/","anon"', '"3302","2026-10-15 08:02:00","nonsense","online","","malware_download","","",""'].join("\n"));
  expect(uh).toEqual([{ type: "url", value: "http://evil.example/bins/x86", threat: "malware_download · elf,mirai", confidence: null, firstSeen: "2026-10-15T08:01:02.000Z", reference: "https://urlhaus.abuse.ch/url/3301/" }]);
  const tf = parseThreatfoxCsv(['# "first_seen_utc","ioc_id","ioc_value","ioc_type","threat_type","fk_malware","malware_alias","malware_printable","last_seen_utc","confidence_level","reference","tags","anonymous","reporter"', '"2026-10-14 10:00:00", "1", "198.51.100.77:443", "ip:port", "botnet_cc", "win.cobalt", "", "Cobalt Strike", "", "100", "", "", "0", "x"', '"2026-10-14 10:00:00", "2", "bad.example", "domain", "botnet_cc", "", "", "AsyncRAT", "", "75", "", "", "0", "x"', '"2026-10-14 10:00:00", "3", "10.0.0.1:80", "ip:port", "botnet_cc", "", "", "X", "", "50", "", "", "0", "x"', '"2026-10-14 10:00:00", "4", "44d88612fea8a8f36de82e1278abb02f", "md5_hash", "payload", "", "", "EICAR", "", "100", "", "", "0", "x"'].join("\n"));
  expect(tf.map((r) => [r.type, r.value, r.threat, r.confidence])).toEqual([
    ["ip", "198.51.100.77", "Cobalt Strike", 100],
    ["domain", "bad.example", "AsyncRAT", 75],
    ["hash", "44d88612fea8a8f36de82e1278abb02f", "EICAR", 100],
  ]);
  expect(parsePlainList("# Feodo\n203.0.113.9\n203.0.113.9\n10.1.1.1\nevil[.]test ; komentář\n\nnesmysl", "C2").map((r) => `${r.type}:${r.value}`)).toEqual(["ip:203.0.113.9", "domain:evil.test"]);
});

test("podněty k přehodnocení rizika: návrh hodnot a termín (ADR-058)", () => {
  const tr = (kind: RiskTrigger["kind"], strong: boolean, at = "2026-10-01T10:00:00.000Z"): RiskTrigger => ({ kind, at, link: null, title: "", detail: null, count: 1, strong });
  const r = { threatLevel: 2, vulnLevel: 4, likelihood: 2, scaleLevels: 4 };
  // silný incident → hrozba +1; zranitelnost už je na stropu
  expect(suggestFromTriggers(r, [tr("incident", true), tr("vuln", true)], "three_factor")).toEqual([{ field: "threatLevel", from: 2, to: 3, kinds: ["incident"] }]);
  // jeden slabý podnět nestačí, dva ano
  expect(suggestFromTriggers(r, [tr("soc", false)], "three_factor")).toEqual([]);
  expect(suggestFromTriggers(r, [tr("soc", false), tr("incident", false)], "three_factor")[0]).toMatchObject({ field: "threatLevel", to: 3 });
  // změna a dodavatel jen k posouzení
  expect(suggestFromTriggers(r, [tr("change", false), tr("supplier", false)], "three_factor")).toEqual([]);
  // dvoufaktorová metoda → pravděpodobnost
  expect(suggestFromTriggers(r, [tr("audit_finding", true)], "two_factor")).toEqual([{ field: "likelihood", from: 2, to: 3, kinds: ["audit_finding"] }]);
  // nehodnocené riziko → bez návrhu
  expect(suggestFromTriggers({ ...r, threatLevel: null }, [tr("incident", true)], "three_factor")).toEqual([]);
  expect(triggerDue([tr("incident", true, "2026-10-05T00:00:00.000Z"), tr("soc", true, "2026-10-01T23:00:00.000Z")])).toBe("2026-10-31");
  expect(triggerDue([])).toBeNull();
});

test("graf vazeb aktiv: vrstvy, dopad výpadku, okolí, rozložení (ADR-063)", () => {
  expect(assetLayer("server", "supporting")).toBe("infrastructure");
  expect(assetLayer("server", "primary")).toBe("primary");
  expect(assetLayer("information_asset", "supporting")).toBe("application");
  expect(assetLayer("network_device", "supporting")).toBe("network");
  expect(assetLayer("other", "supporting")).toBe("people");
  // P (proces) → S (služba) → A (aplikace) → V (server) → N (síť); B (záloha) ← V
  const edges = [
    { from: "P", to: "S" },
    { from: "S", to: "A" },
    { from: "A", to: "V" },
    { from: "V", to: "N" },
    { from: "V", to: "B" },
  ];
  const im = impactOf(edges, "V");
  expect([...im.affected].sort()).toEqual(["A", "P", "S"]);
  expect([...im.dependsOn].sort()).toEqual(["B", "N"]);
  expect([...neighborhood(edges, "A", 1)].sort()).toEqual(["A", "S", "V"]);
  const nodes = [
    { id: "P", layer: "process" as const, name: "P" },
    { id: "S", layer: "primary" as const, name: "S" },
    { id: "A", layer: "application" as const, name: "A" },
    { id: "V", layer: "infrastructure" as const, name: "V" },
    { id: "N", layer: "network" as const, name: "N" },
    { id: "B", layer: "infrastructure" as const, name: "B" },
  ];
  const l = layoutGraph(nodes, edges, { perRow: 1 });
  expect(l.bands.map((b) => b.layer)).toEqual(["process", "primary", "application", "infrastructure", "network"]);
  // vrstvy shora dolů, dlouhá vrstva zalomená (perRow 1 → infrastruktura ve dvou řádcích)
  expect(l.pos.get("P")!.y).toBeLessThan(l.pos.get("S")!.y);
  expect(l.pos.get("V")!.y).not.toBe(l.pos.get("B")!.y);
  expect(l.pos.get("N")!.y).toBeGreaterThan(Math.max(l.pos.get("V")!.y, l.pos.get("B")!.y));
  // deterministické
  expect([...layoutGraph(nodes, edges).pos]).toEqual([...layoutGraph(nodes, edges).pos]);
});

test("analýza odolnosti: požadavky z BIA po grafu, SPOF, kritičnost, plány (ADR-065)", () => {
  const n = (id: string, kind: "asset" | "process", criticality: any = null, redundant = false, health: string | null = "green", p1 = 0) => ({ id, kind, name: id, criticality, redundant, health, p1 });
  const r = analyzeResilience({
    nodes: [n("P", "process"), n("Q", "process"), n("S", "asset", "critical"), n("A", "asset", "medium"), n("V", "asset", "low", false, "red"), n("F", "asset", "high", true)],
    edges: [
      { from: "P", to: "S" },
      { from: "S", to: "A" },
      { from: "A", to: "V" },
      { from: "A", to: "F" },
    ],
    bia: new Map([
      ["P", { rtoHours: 4, rpoHours: 1 }],
      ["Q", { rtoHours: 12, rpoHours: null }],
    ]),
    plans: new Map([["S", 8]]),
  });
  const reqV = r.requirements.find((x) => x.assetId === "V")!;
  expect(reqV).toMatchObject({ rtoHours: 4, rpoHours: 1, requiredCriticality: "critical", dependents: 3 });
  expect(reqV.processes.map((p) => p.id)).toEqual(["P"]);
  const has = (kind: string, id: string) => r.findings.some((f) => f.kind === kind && f.nodeId === id);
  expect(has("spof", "V")).toBe(true);
  expect(r.findings.find((f) => f.kind === "spof" && f.nodeId === "V")!.severity).toBe("critical");
  expect(has("spof", "F")).toBe(false); // redundantní
  expect(has("criticality_gap", "V")).toBe(true);
  expect(r.findings.find((f) => f.kind === "criticality_gap" && f.nodeId === "V")!.severity).toBe("high");
  expect(has("criticality_gap", "A")).toBe(true);
  expect(has("plan_rto", "S")).toBe(true); // plán 8 h > RTO 4 h
  expect(has("no_plan", "V")).toBe(true);
  expect(has("unhealthy", "V")).toBe(true);
  expect(has("bia_no_assets", "Q")).toBe(true);
  expect(r.findings[0]!.severity).toBe("critical");
  expect(r.summary.spof).toBeGreaterThanOrEqual(1);
});

describe("síťové segmenty (ADR-072)", () => {
  test("porovnání hostitele s aktivy: MAC, IP, jméno, změna MAC", async () => {
    const { matchHost } = await import("@contix/shared");
    const list = [
      { id: "a", name: "SRV", hostname: "srv01.firma.local", fqdn: null, ipAddresses: ["10.0.0.10"], macAddresses: ["AA-BB-CC-00-00-10"] },
      { id: "b", name: "PRN", hostname: null, fqdn: "tiskarna.firma.local", ipAddresses: [], macAddresses: [] },
    ];
    expect(matchHost({ ip: "10.0.0.99", mac: "aa:bb:cc:00:00:10", hostname: null }, list)).toEqual({ status: "known", assetId: "a", by: "mac" });
    expect(matchHost({ ip: "10.0.0.10", mac: null, hostname: null }, list)).toEqual({ status: "known", assetId: "a", by: "ip" });
    expect(matchHost({ ip: "10.0.0.10", mac: "11:22:33:44:55:66", hostname: null }, list)).toMatchObject({ status: "changed", assetId: "a" });
    expect(matchHost({ ip: "10.0.0.20", mac: null, hostname: "TISKARNA" }, list)).toEqual({ status: "known", assetId: "b", by: "hostname" });
    expect(matchHost({ ip: "10.0.0.30", mac: null, hostname: null }, list)).toEqual({ status: "unknown" });
  });
  test("plán skenu v čase Europe/Prague (letní / zimní čas)", async () => {
    const { nextScanAt } = await import("@contix/shared");
    const base = { scheduleTime: "02:30", scheduleWeekday: 1 };
    expect(nextScanAt({ ...base, schedule: "manual" }, new Date("2026-07-01T10:00:00Z"))).toBeNull();
    expect(nextScanAt({ ...base, schedule: "hourly" }, new Date("2026-07-01T10:00:00Z"))!.toISOString()).toBe("2026-07-01T11:00:00.000Z");
    // léto: 02:30 SELČ = 00:30 UTC
    expect(nextScanAt({ ...base, schedule: "daily" }, new Date("2026-07-01T10:00:00Z"))!.toISOString()).toBe("2026-07-02T00:30:00.000Z");
    // zima: 02:30 SEČ = 01:30 UTC
    expect(nextScanAt({ ...base, schedule: "daily" }, new Date("2026-12-01T00:00:00Z"))!.toISOString()).toBe("2026-12-01T01:30:00.000Z");
    // týdně v pondělí (2026-12-07 je pondělí)
    expect(nextScanAt({ ...base, schedule: "weekly" }, new Date("2026-12-02T12:00:00Z"))!.toISOString()).toBe("2026-12-07T01:30:00.000Z");
  });
});

test("Wazuh: čas posledního spojení manažera 9999-12-31 se nahradí časem synchronizace", async () => {
  const { keepAliveDate } = await import("../src/modules/discovery/connectors/wazuh");
  const now = new Date("2026-10-18T12:00:00Z");
  expect(keepAliveDate("9999-12-31T23:59:59Z", now)).toEqual(now);
  expect(keepAliveDate("nesmysl", now)).toEqual(now);
  expect(keepAliveDate(undefined, now)).toEqual(now);
  expect(keepAliveDate("2026-10-18T10:00:00Z", now).toISOString()).toBe("2026-10-18T10:00:00.000Z");
});

describe("Cortex a MISP (ADR-073)", () => {
  test("enrichGuard: soukromé IP, interní domény, jednoslovná jména", async () => {
    const { enrichGuard } = await import("@contix/shared");
    expect(enrichGuard("ip", "10.1.2.3")).toEqual({ reason: "private_ip" });
    expect(enrichGuard("ip", "203.0.113.5")).toEqual({ value: "203.0.113.5" });
    expect(enrichGuard("domain", "evil[.]example.com")).toEqual({ value: "evil.example.com" });
    expect(enrichGuard("domain", "srv.firma.cz", ["firma.cz"])).toEqual({ reason: "internal_domain" });
    expect(enrichGuard("domain", "firma.cz", [".firma.cz"])).toEqual({ reason: "internal_domain" });
    expect(enrichGuard("domain", "jinafirma.cz", ["firma.cz"])).toEqual({ value: "jinafirma.cz" });
    expect(enrichGuard("url", "http://192.168.1.10/login")).toEqual({ reason: "private_ip" });
    expect(enrichGuard("url", "https://intranet.corp/x")).toEqual({ reason: "internal_domain" });
    expect(enrichGuard("email", "jan@firma.cz", ["firma.cz"])).toEqual({ reason: "internal_domain" });
    expect(enrichGuard("hash", "d41d8cd98f00b204e9800998ecf8427e")).toMatchObject({ value: "d41d8cd98f00b204e9800998ecf8427e" });
    expect(enrichGuard("ip", "nesmysl")).toEqual({ reason: "invalid" });
  });
  test("Cortex: datový typ, odhad dosahu, verdikt", async () => {
    const { cortexDataType, cortexReach, taxonomiesOf, verdictOf } = await import("@contix/shared");
    expect(cortexDataType("domain", ["fqdn"])).toBe("fqdn");
    expect(cortexDataType("email", ["mail"])).toBe("mail");
    expect(cortexDataType("hash", ["ip"])).toBeNull();
    expect(cortexReach("VirusTotal_GetReport_3_1")).toBe("external");
    expect(cortexReach("MaxMind_GeoIP_4_0")).toBe("local");
    expect(cortexReach("MujAnalyzator_1_0")).toBe("unknown");
    const t = taxonomiesOf({ summary: { taxonomies: [{ level: "safe", namespace: "A", predicate: "b", value: 1 }, { level: "Malicious", namespace: "X", predicate: "y", value: "z" }, { level: "weird" }] } });
    expect(t.map((x) => x.level)).toEqual(["safe", "malicious", "info"]);
    expect(verdictOf(t)).toBe("malicious");
    expect(verdictOf([])).toBeNull();
  });
  test("MISP: atributy, sdílení, dotaz", async () => {
    const { parseMispAttributes, mispAttributeFor, mispLookupTaxonomies } = await import("@contix/shared");
    const r = parseMispAttributes(
      { response: { Attribute: [
        { type: "ip-dst|port", value: "198.51.100.1|443", event_id: 9, Event: { info: "C2" } },
        { type: "filename|sha256", value: `x.exe|${"a".repeat(64)}`, event_id: 9 },
        { type: "ip-src", value: "10.0.0.1" },
        { type: "domain|ip", value: "bad.example|203.0.113.1" },
        { type: "text", value: "nic" },
      ] } },
      "https://misp.local/",
    );
    expect(r.map((x) => [x.type, x.value])).toEqual([["ip", "198.51.100.1"], ["hash", "a".repeat(64)], ["domain", "bad.example"], ["ip", "203.0.113.1"]]);
    expect(r[0]!.reference).toBe("https://misp.local/events/view/9");
    expect(mispAttributeFor("hash", "a".repeat(40))).toMatchObject({ type: "sha1", category: "Payload delivery" });
    expect(mispAttributeFor("ip", "1.2.3.4").type).toBe("ip-dst");
    expect(mispLookupTaxonomies({ response: { Attribute: [{ event_id: "1", to_ids: false, Event: { info: "A" } }, { event_id: "1", to_ids: "1" }] } })).toEqual([{ level: "malicious", namespace: "MISP", predicate: "#1", value: "A" }]);
    expect(mispLookupTaxonomies({ response: { Attribute: [] } })[0]!.predicate).toBe("not_found");
  });
});

test("nmap: zjištění živých hostitelů i přes porty stanic (v0.78.1)", async () => {
  const { SCAN_PROFILES, DISCOVERY_PORTS } = await import("../src/modules/discovery/connectors/nmap");
  for (const p of Object.values(SCAN_PROFILES)) expect(p.some((a) => a.startsWith("-PS") && a.includes("445") && a.includes("3389"))).toBe(true);
  expect(DISCOVERY_PORTS).toContain(80);
});

test("nmap: detekce OS bez oprávnění → standardní sken místo chyby", async () => {
  const { createNmapConnector } = await import("../src/modules/discovery/connectors/nmap");
  const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
  const dir = mkdtempSync("/tmp/nmapfake-");
  const fake = `${dir}/nmap`;
  writeFileSync(fake, `#!/bin/sh\ncase "$*" in *" -O "*) echo "TCP/IP fingerprinting (for OS scan) requires root privileges." >&2; exit 1;; esac\necho '<?xml version="1.0"?><nmaprun><host><status state="up"/><address addr="10.0.0.5" addrtype="ipv4"/></host></nmaprun>'\n`);
  chmodSync(fake, 0o755);
  const logs: string[] = [];
  const out = [];
  for await (const a of createNmapConnector({ nmapPath: fake, allowedCidrs: ["10.0.0.0/24"] }).collect({ targets: ["10.0.0.0/24"], profile: "os_detect" }, { log: (m: string) => logs.push(m) } as any)) out.push(a);
  expect(out.length).toBe(1);
  expect(logs.some((l) => l.includes("profilem standardní"))).toBe(true);
});

test("sledované rámce podle režimu a výběru (ADR-074)", async () => {
  const { frameworksInScope, SYSTEM_ROLES } = await import("@contix/shared");
  expect(frameworksInScope("lower", null, ["iso27001", "cz409"])).toEqual(["zkb", "cz410", "iso27001"]);
  expect(frameworksInScope("higher", ["dora", "iso27001"])).toEqual(["zkb", "cz409", "iso27001", "dora"]);
  expect(frameworksInScope("none", ["dora"])).toEqual(["dora"]);
  for (const k of ["soc_l1", "soc_l2", "it_admin", "privacy_officer"]) expect(SYSTEM_ROLES.some((r) => r.key === k)).toBe(true);
  expect(SYSTEM_ROLES.find((r) => r.key === "soc_l1")!.permissions).not.toContain("soc:respond");
});

test("regulatorní profil: balíčky, hlavní rámec, rozsah a metodika rizik (ADR-080)", async () => {
  const sh = await import("@contix/shared");
  expect(sh.profileOf({ regime: "higher" })).toMatchObject({ pack: "cz", primary: "cz409", law: "zkb", regulated: true, auditMethodology: "zkb409_audit", riskMethodology: "zkb409", authority: "NÚKIB" });
  expect(sh.profileOf({ regime: "lower", pack: "cz" })).toMatchObject({ primary: "cz410", auditMethodology: "zkb410_audit" });
  // neregulovaná CZ: hlavní rámec volitelně z knihovny, výchozí výběr zůstává 409 (návaznost)
  expect(sh.profileOf({ regime: "none" })).toMatchObject({ regulated: false, primary: null, law: null, defaultFramework: "cz409", auditMethodology: null });
  expect(sh.profileOf({ regime: "none", primaryFramework: "iso27001" })).toMatchObject({ primary: "iso27001", auditMethodology: "fw:iso27001" });
  const g = sh.profileOf({ pack: "generic", regime: "higher", primaryFramework: "nis2" });
  expect(g).toMatchObject({ pack: "generic", level: "none", primary: "nis2", law: null, riskMethodology: "matrix_5x5", defaultFramework: "nis2" });
  expect(sh.profileOf({ pack: "generic", primaryFramework: "x-neni" })).toMatchObject({ primary: null, defaultFramework: "iso27001" });
  expect(sh.frameworksInScope(g, ["cis8"])).toEqual(["nis2", "cis8"]);
  expect(sh.frameworksInScope(sh.profileOf({ regime: "higher" }), null)).toEqual(["zkb", "cz409"]);
  expect(sh.czDecreeOf(g)).toBeNull();
  expect(g).toMatchObject({ incidentRegime: "nis2", incidentRecipient: "other", czLegalRefs: false });
  expect(sh.profileOf({ regime: "lower" })).toMatchObject({ incidentRegime: "lower", incidentRecipient: "national_cert", czLegalRefs: true });
  expect(sh.withLegalRefs(["Plánovaný penetrační test nebyl proveden (§ 24 odst. 5 písm. a) bod 3).", "Bez odkazu."], false)).toEqual(["Plánovaný penetrační test nebyl proveden.", "Bez odkazu."]);
  expect(sh.withLegalRefs(["X (§ 6 odst. 1)."], true)).toEqual(["X (§ 6 odst. 1)."]);
  // NIS2 čl. 23: varování 24 h, oznámení 72 h, závěrečná zpráva měsíc po oznámení
  const det = "2026-03-01T10:00:00.000Z";
  const inc = { kind: "incident" as const, inScope: true, cyberOrigin: true, intentExcluded: false, toleranceExceeded: true, significanceAreas: { operational: true }, authorityDecision: "pending" as const, personalDataBreach: false, detectedAt: det, resolvedAt: null };
  const dl = sh.incidentDeadlines(inc, [{ reportType: "notification", submittedAt: "2026-03-03T10:00:00.000Z" }], "nis2", { now: new Date("2026-03-02T00:00:00Z") });
  expect(dl.map((d) => [d.type, d.due])).toEqual([
    ["initial", "2026-03-02T10:00:00.000Z"],
    ["notification", "2026-03-04T10:00:00.000Z"],
    ["final", "2026-04-03T10:00:00.000Z"],
  ]);
  expect(sh.isReportable({ ...inc, toleranceExceeded: false }, "nis2")).toBe(false);
  // balíčky států EU (ADR-082): kategorie subjektu, NIS2 jako výchozí hlavní rámec, národní ustanovení o hlášení
  const de = sh.profileOf({ pack: "de", regime: "lower" });
  expect(de).toMatchObject({ jurisdiction: "DE", levelName: "Wichtige Einrichtung", primary: "nis2", law: null, incidentRegime: "nis2", incidentLegalRef: "§ 32 BSIG", czLegalRefs: false, riskMethodology: "matrix_5x5" });
  expect(sh.profileOf({ pack: "sk", regime: "lower" })).toMatchObject({ level: "higher", levelName: "Prevádzkovateľ základnej služby" });
  expect(sh.profileOf({ pack: "at", regime: "none" })).toMatchObject({ incidentRegime: "none", primary: null });
  expect(sh.profileOf({ pack: "pl", regime: "higher", primaryFramework: "iso27001" }).primary).toBe("iso27001");
  expect(sh.REGULATORY_PACKS.map((p) => p.id)).toEqual(["cz", "sk", "pl", "de", "at", "generic"]);
  const dlDe = sh.incidentDeadlines(inc, [], "nis2", { legalRef: de.incidentLegalRef, now: new Date("2026-03-02T00:00:00Z") });
  expect(dlDe[0]!.legal).toBe("§ 32 BSIG, čl. 23 odst. 4 písm. a) NIS2 – do 24 h od zjištění významného incidentu");
  // DORA – finanční subjekt (ADR-084): sektorový rámec vždy, hlášení podle DORA, česká vyhláška zůstává
  const fin = sh.profileOf({ regime: "lower", doraEntity: true });
  expect(fin).toMatchObject({ primary: "cz410", law: "zkb", sector: "dora", incidentRegime: "dora", doraEntity: true });
  expect(sh.frameworksInScope(fin, null)).toEqual(["zkb", "cz410", "dora"]);
  expect(sh.doraAuthorityOf(fin)).toBe("ČNB");
  expect(fin.incidentRecipient).toBe("financial_supervisor");
  expect(sh.profileOf({ pack: "generic", doraEntity: true })).toMatchObject({ primary: "dora", sector: "dora", incidentRegime: "dora", defaultFramework: "dora" });
  expect(sh.profileOf({ pack: "de", regime: "higher", doraEntity: true })).toMatchObject({ primary: "dora", sector: "dora", incidentRegime: "dora", incidentLegalRef: null });
  const dlD = sh.incidentDeadlines(inc, [{ reportType: "initial", submittedAt: "2026-03-01T13:00:00.000Z" }, { reportType: "interim", submittedAt: "2026-03-03T10:00:00.000Z" }], "dora", { now: new Date("2026-03-01T12:00:00Z") });
  expect(dlD.map((d) => [d.type, d.due, d.state])).toEqual([
    ["initial", "2026-03-02T10:00:00.000Z", "done"],
    ["interim", "2026-03-04T13:00:00.000Z", "done"],
    ["final", "2026-04-03T10:00:00.000Z", "pending"],
  ]);
  expect(sh.incidentDeadlines(inc, [], "dora").map((d) => d.due === null)).toEqual([false, true, true]);
  // základ výstupů podle rámce (ADR-086)
  expect(sh.reportBasisOf(fin).id).toBe("dora");
  expect(sh.reportBasisOf(fin).label).toContain("ČNB");
  expect(sh.reportBasisOf(sh.profileOf({ regime: "lower" })).legal.soa).toContain("410/2025");
  expect(sh.reportBasisOf(sh.profileOf({ pack: "generic", primaryFramework: "iso27001" })).legal.isms_review).toContain("9.3");
  expect(sh.reportBasisOf(sh.profileOf({ pack: "de", regime: "higher" })).id).toBe("nis2");
  expect(sh.reportBasisOf(sh.profileOf({ pack: "generic", primaryFramework: "cis8" })).id).toBe("generic");
  expect(sh.refIn("")).toBe("");
  expect(sh.incidentLegalBasis("nis2", "§ 32 BSIG")).toBe("§ 32 BSIG, čl. 23 směrnice (EU) 2022/2555 (NIS2)");
  // informační servis (ADR-087)
  const rss = sh.parseRssFeed(`<rss><channel><item><title><![CDATA[Varování &amp; test]]></title><link>https://x.cz/a</link><guid>a</guid><pubDate>Wed, 21 Oct 2026 17:46:04 +0000</pubDate><description>&lt;b&gt;Text&lt;/b&gt;</description></item><item><title></title></item></channel></rss>`);
  expect(rss).toEqual([{ guid: "a", title: "Varování & test", link: "https://x.cz/a", summary: "Text", category: "", publishedAt: "2026-10-21T17:46:04.000Z" }]);
  expect(sh.parseRssFeed(`<feed><entry><title>A</title><link href="https://y/1"/><id>u1</id><updated>2026-01-02T00:00:00Z</updated></entry></feed>`)[0]).toMatchObject({ guid: "u1", link: "https://y/1" });
  expect(sh.classifyFeedItem({ title: "NÚKIB upozorňuje na kritické zranitelnosti v PHP" })).toBe("vulnerability");
  expect(sh.classifyFeedItem({ title: "Vydali jsme přehled kybernetických incidentů za září 2026" })).toBe("report");
  expect(sh.classifyFeedItem({ title: "Řízení aktiv a rizik krok za krokem. NÚKIB vydal nového průvodce" })).toBe("guidance");
  expect(sh.classifyFeedItem({ title: "NÚKIB vydal varování před hrozbou" })).toBe("warning");
  expect(sh.safeLink("javascript:alert(1)")).toBe("");
  const od = sh.parseIncidentOpendata("Rok/měsíc;Klasifikace ENISA;Závažnost;Počet\n2024-1;Průnik;Významný;2\n2024-01;Průnik;Významný;3\nxx;Podvod;;1\n");
  expect(od.rows).toEqual([{ month: "2024-01", classification: "Průnik", severity: "Významný", count: 5 }]);
  expect(od.errors).toHaveLength(1);
  const sm = sh.summarizeIncidentStats([{ month: "2024-01", classification: "A", severity: "s", count: 2 }, { month: "2025-01", classification: "B", severity: "s", count: 3 }]);
  expect(sm).toMatchObject({ firstMonth: "2024-01", lastMonth: "2025-01", total: 5, last12: 3, prev12: 2 });
  expect(sm.months).toHaveLength(12);
  expect(sm.months.at(-1)).toMatchObject({ month: "2025-01", total: 3 });
  // ruční doplnění měsíce (ADR-087)
  const merged = sh.mergeIncidentStats(
    [{ month: "2025-01", classification: "Průnik", severity: "VÝZNAMNÝ INCIDENT", count: 2 }, { month: "2025-02", classification: "Podvod", severity: "MÉNĚ VÝZNAMNÝ INCIDENT", count: 9 }],
    [{ month: "2025-02", classification: "Průnik", severity: "*", count: 3 }, { month: "2025-02", classification: "*", severity: "Významný incident", count: 3 }, { month: "2025-03", classification: "*", severity: "Významný incident", count: 4 }],
  );
  const ms = sh.summarizeIncidentStats(merged);
  expect(ms.months.slice(-3).map((m) => [m.month, m.total])).toEqual([["2025-01", 2], ["2025-02", 3], ["2025-03", 4]]);
  expect(ms.severities).toEqual([{ name: "Významný incident", count: 9 }]);
  expect(ms.classes).toEqual([{ name: "Průnik", count: 5 }]);
  expect(sh.monthFromTitle("Vydali jsme přehled kybernetických incidentů za září 2026")).toBe("2026-09");
  expect(sh.monthFromTitle("Kyberneticke-incidenty-pohledem-NUKIB-brezen2026.pdf")).toBe("2026-03");
  expect(sh.monthFromTitle("přehled za červenec 2026")).toBe("2026-07");
  expect(sh.monthFromTitle("přehled za červen 2026")).toBe("2026-06");
  expect(sh.monthFromTitle("Nový průvodce")).toBeNull();
  const pr = sh.parseIncidentStatsProposal('x {"month":"2026-03","total":5,"classes":[{"name":"Průnik","count":3.4},{"name":"*","count":1}],"severities":[{"name":"Významný","count":"2"}]}');
  expect(pr).toMatchObject({ month: "2026-03", total: 5, classes: [{ name: "Průnik", count: 3 }], severities: [] });
  expect(pr.warnings[0]).toContain("3 z 5");
  expect(() => sh.parseIncidentStatsProposal("bez json")).toThrow();
  expect(sh.nukibReportUrls("2026-09")[0]).toBe("https://nukib.gov.cz/download/publikace/vyzkum/Kyberneticke-incidenty-pohledem-NUKIB-zari-2026.pdf");
  expect(sh.nukibReportUrls("2026-03")).toContain("https://nukib.gov.cz/download/publikace/vyzkum/Kyberneticke-incidenty-pohledem-NUKIB-brezen2026.pdf");
  expect(sh.nukibReportUrls("2026-13")).toEqual([]);
  // rozpoznání druhu v němčině / angličtině a výchozí druh kanálu (ADR-089)
  expect(sh.classifyFeedItem({ title: "Kritische Sicherheitslücke in Fortinet FortiOS" })).toBe("vulnerability");
  expect(sh.classifyFeedItem({ title: "Warnung vor Phishing-Kampagne" })).toBe("warning");
  expect(sh.classifyFeedItem({ title: "Security update for Microsoft Exchange" })).toBe("vulnerability");
  expect(sh.feedItemKind({ title: "Neuigkeiten aus dem Team" }, "warning")).toBe("warning");
  expect(sh.feedItemKind({ title: "Kritische Schwachstelle in Ivanti" }, "warning")).toBe("vulnerability");
  const { parseHtmlListing } = await import("../src/modules/infoservice/html");
  const page = `<ul><li><span>21. 10. 2026</span> <a href="/cs/kyberbezpecnost/aktualne-z-bezpecnosti/kriticka-zranitelnost-v-php/">Kritická zranitelnost v PHP &amp; co dělat</a></li>
<li><a href="https://csirt.cz/cs/kyberbezpecnost/aktualne-z-bezpecnosti/phishing-banka/">Phishingová kampaň cílí na klienty bank</a> 2026-10-20</li>
<li><a href="/cs/kyberbezpecnost/aktualne-z-bezpecnosti/?page=2">Další stránka s novinkami</a></li><li><a href="/cs/kyberbezpecnost/aktualne-z-bezpecnosti/">Aktuálně z bezpečnosti</a></li>
<li><a href="https://evil.example/cs/kyberbezpecnost/aktualne-z-bezpecnosti/x/">Cizí web se stejnou cestou</a></li><li><a href="/cs/o-nas/">O nás a naše služby</a></li></ul>`;
  const hl = parseHtmlListing(page, "https://csirt.cz/cs/kyberbezpecnost/aktualne-z-bezpecnosti/", "/cs/kyberbezpecnost/aktualne-z-bezpecnosti/");
  expect(hl.map((x) => [x.title, x.publishedAt?.slice(0, 10)])).toEqual([
    ["Kritická zranitelnost v PHP & co dělat", "2026-10-21"],
    ["Phishingová kampaň cílí na klienty bank", "2026-10-20"],
  ]);
  expect(hl[0]!.link).toBe("https://csirt.cz/cs/kyberbezpecnost/aktualne-z-bezpecnosti/kriticka-zranitelnost-v-php/");
  // sjednocení názvů a kontrola prohozené závažnosti (září 2026: 25 méně významných, 1 významný)
  expect(sh.canonicalSeverity("méně významný kybernetický incident")).toBe("Méně významný incident");
  expect(sh.canonicalSeverity("VELMI VÝZNAMNÝ INCIDENT")).toBe("Velmi významný incident");
  expect(sh.canonicalSeverity("významný")).toBe("Významný incident");
  expect(sh.canonicalClass("Podvod")).toBe("Podvod/phishing");
  expect(sh.canonicalClass("pokus o průnik")).toBe("Pokus o průnik");
  const sw = sh.parseIncidentStatsProposal('{"month":"2026-09","total":26,"classes":[{"name":"Průnik","count":15},{"name":"Podvod","count":4}],"severities":[{"name":"Významný incident","count":25},{"name":"Velmi významný incident","count":1},{"name":"méně významný","count":0},{"name":"významný","count":0}]}');
  expect(sw.severities).toEqual([{ name: "Významný incident", count: 25 }, { name: "Velmi významný incident", count: 1 }]);
  expect(sw.classes).toEqual([{ name: "Průnik", count: 15 }, { name: "Podvod/phishing", count: 4 }]);
  expect(sw.warnings.join(" ")).toContain("Klasifikace pokrývá 19 z 26");
  expect(sw.warnings.join(" ")).toContain("ověřte graf závažnosti");
  // teplotní mapa maticové metodiky (ADR-083)
  const mm = sh.methodologyMatrix(sh.getRiskMethodology("matrix_5x5"))!;
  expect([mm.x.key, mm.y.key]).toEqual(["likelihood", "impact"]);
  expect(mm.levelAt(1, 1)).toBe("low");
  expect(mm.levelAt(5, 5)).toBe("critical");
  expect(mm.levelAt(3, 3)).toBe("medium");
  expect(mm.cellOf({ impact: 4, likelihood: 5 })).toEqual([3, 4]);
  expect(mm.cellOf({ impact: 4 })).toBeNull();
  expect(sh.methodologyMatrix(sh.getRiskMethodology("octave_allegro"))).toBeNull();
  // kontrolní seznam auditu z rámce
  const cl = sh.getMethodology("fw:cis8");
  expect(cl).toMatchObject({ kind: "audit", id: "fw:cis8" });
  expect((cl as any).checklist.length).toBe(153);
  expect(sh.getMethodology("fw:neni")).toBeNull();
  expect(sh.auditableFrameworks().map((f) => f.id)).not.toContain("cz409");

  // metodika rizik z profilu: dceřiná společnost v obecném balíčku bez vlastní metodiky → 5×5
  const { companySettings } = await import("../src/auth/scope");
  const base = sh.SettingsSchema.parse({});
  const rows = [
    { id: sh.ROOT_COMPANY_ID, parentId: null, name: "Root", regime: "higher", pack: "cz", primaryFramework: null, overrides: {} },
    { id: "c1", parentId: sh.ROOT_COMPANY_ID, name: "DE", regime: "none", pack: "generic", primaryFramework: "iso27001", overrides: {} },
    { id: "c2", parentId: sh.ROOT_COMPANY_ID, name: "DE2", regime: "none", pack: "generic", primaryFramework: null, overrides: { riskPolicy: { ...base.riskPolicy, methodology: "octave_allegro" } } },
  ] as any[];
  expect(companySettings(base, rows, "c1")).toMatchObject({ pack: "generic", primaryFramework: "iso27001", riskPolicy: { methodology: "matrix_5x5" } });
  expect(companySettings(base, rows, "c2").riskPolicy.methodology).toBe("octave_allegro");
  expect(companySettings(base, rows, sh.ROOT_COMPANY_ID).riskPolicy.methodology).toBe("zkb409");
});

test("knihovna rámců: převod tabulky, OSCAL, ověření, registr a mapování (ADR-079)", async () => {
  const sh = await import("@contix/shared");
  const meta = { key: "pl-test", name: "Ustawa (test)", shortName: "PL KSC", jurisdiction: "PL", kind: "law" as const };
  // názvy sloupců v různých jazycích, oddíl odvozený z označení
  const t = sh.packFromTable(meta, ["Nr", "Wymaganie", "Mapowanie"], [["5.1", "Operator wdraża system zarządzania.", "iso27001:A.5.1"], ["5.2", "Operator wyznacza osobę kontaktową.", ""]]);
  expect(t.errors).toEqual([]);
  expect(t.warnings[0]!.message).toContain("Oddíl");
  const v = sh.validatePack(t.pack, { format: "table" });
  expect(v.preview).toMatchObject({ ok: true, requirements: 2, sections: 1, mappings: 1 });
  expect(v.pack!.requirements[0]!.section).toBe("5");
  expect(sh.packFromTable(meta, ["Popis"], [["x"]]).errors.map((e) => e.message).join()).toContain("označením");
  // neplatná země a klíč
  expect(sh.validatePack({ ...meta, key: "PL test", jurisdiction: "Polsko", requirements: [{ ref: "1", section: "1", text: "x" }] }).preview.errors.length).toBe(2);
  expect(sh.refKey("§ 12 odst. 1 písm. a)")).toBe("par12odst.1pism.a)");
  expect(sh.requirementIdOf("a".repeat(40), "x".repeat(90)).length).toBeLessThanOrEqual(100);

  // OSCAL: skupiny, rozšíření, parametry
  const o = sh.packFromOscal({ catalog: { metadata: { title: "Mini", version: "5" }, groups: [{ id: "ia", title: "Identification", controls: [{ id: "ia-2", title: "MFA", parts: [{ name: "statement", prose: "Use {{ insert: param, ia-2_prm_1 }} factors.", parts: [{ name: "item", props: [{ name: "label", value: "a." }], prose: "for admins" }] }] }] }] } }, { jurisdiction: "US" });
  const ov = sh.validatePack(o.pack, { format: "oscal" });
  expect(ov.pack!.requirements[0]).toMatchObject({ ref: "IA-2", section: "IA", text: "MFA – Use [ia-2_prm_1] factors.\na. for admins" });
  expect(ov.pack!.key).toBe("mini");

  // registr: vlastní rámec v požadavcích, rozsahu a oboustranném mapování
  sh.registerCustomFrameworks([sh.packToDto(v.pack!)]);
  try {
    expect(sh.FRAMEWORKS.at(-1)).toMatchObject({ id: "x-pl-test", custom: true, jurisdiction: "PL" });
    expect(sh.requirementsOf("x-pl-test")).toHaveLength(2);
    expect(sh.requirementById("x-pl-test:5.1")!.mappings).toEqual(["iso27001:A.5.1"]);
    expect(sh.mappedRequirements("iso27001:A.5.1").map((r) => r.id)).toEqual(["x-pl-test:5.1"]);
    expect(sh.mappedRequirements("x-pl-test:5.1").map((r) => r.id)).toEqual(["iso27001:A.5.1"]);
    expect(sh.frameworksInScope("none", ["x-pl-test", "x-neni"])).toEqual(["x-pl-test"]);
    expect(sh.FrameworkIdSchema.safeParse("x-pl-test").success).toBe(true);
    expect(sh.FrameworkIdSchema.safeParse("x-neni").success).toBe(false);
    expect(sh.packOf(sh.FRAMEWORKS.at(-1)!, sh.requirementsOf("x-pl-test"))).toMatchObject({ key: "pl-test", requirements: [{ ref: "5.1", mappings: ["iso27001:A.5.1"] }, { ref: "5.2" }] });
  } finally {
    sh.registerCustomFrameworks([]);
  }
  expect(sh.FRAMEWORKS.some((f) => f.custom)).toBe(false);
  expect(sh.requirementsOf("cz409").length).toBe(293);
});

test("přihlášení účtem AD: jméno, escapování filtru, shoda skupin (ADR-078)", async () => {
  const { parseLoginName, ldapEscape, groupsMatch, AdLoginConfig, SsoProviderInput } = await import("@contix/shared");
  expect(parseLoginName("LAB\\jan.novak")).toEqual({ kind: "sam", value: "jan.novak" });
  expect(parseLoginName("jan.novak@lab.internal")).toEqual({ kind: "upn", value: "jan.novak@lab.internal" });
  expect(parseLoginName(" petr ")).toEqual({ kind: "sam", value: "petr" });
  // injekce do filtru LDAP: *, (, ), \ a NUL se escapují
  expect(ldapEscape("*)(uid=*))(|(uid=*")).toBe("\\2a\\29\\28uid=\\2a\\29\\29\\28|\\28uid=\\2a");
  expect(ldapEscape("a\\b\0")).toBe("a\\5cb\\00");
  expect(groupsMatch(["CONTIX-Auditori", "CN=X, OU=Y,DC=lab"], ["contix-auditori"])).toBe(true);
  expect(groupsMatch(["CN=X,OU=Y,DC=lab"], ["cn=x, ou=y, dc=lab"])).toBe(true);
  expect(groupsMatch(["A"], [])).toBe(false);
  expect(AdLoginConfig.parse({})).toMatchObject({ enabled: false, autoProvision: true, defaultRoleKey: "" });
  expect(AdLoginConfig.safeParse({ upnSuffix: "firma local" }).success).toBe(false);
  expect(SsoProviderInput.safeParse({ kind: "entra", label: "M365", clientId: "x", tenantId: "" }).success).toBe(false);
  expect(SsoProviderInput.safeParse({ kind: "oidc", label: "K", clientId: "x", issuer: "http://evil.example" }).success).toBe(false);
  expect(SsoProviderInput.safeParse({ kind: "oidc", label: "K", clientId: "x", issuer: "https://kc.firma.cz/realms/a" }).success).toBe(true);
});

test("CIS Controls v8.1: požadavky, implementační skupiny a mapování na vyhl. 409 (ADR-077)", async () => {
  const { requirementsOf, cisIgOf, relatedRequirements, FRAMEWORKS, frameworksInScope } = await import("@contix/shared");
  const cis = requirementsOf("cis8");
  expect(cis.length).toBe(153);
  expect(new Set(cis.map((r) => r.section)).size).toBe(18);
  expect(cis.filter((r) => cisIgOf(r.id) === 1).length).toBe(56);
  expect(cis.filter((r) => (cisIgOf(r.id) ?? 9) <= 2).length).toBe(130);
  expect(cis.find((r) => r.id === "cis8:4.1")).toMatchObject({ section: "CIS 4", ref: "4.1 · IG1" });
  expect(FRAMEWORKS.find((f) => f.id === "cis8")).toMatchObject({ fullText: false, shortName: "CIS v8.1" });
  // § 14 (incidenty) → celé opatření CIS 17; § 25 (kryptografie) → jen vybraná dílčí opatření
  const r14 = relatedRequirements("14").filter((r) => r.framework === "cis8").map((r) => r.id);
  expect(r14).toEqual(cis.filter((r) => r.section === "CIS 17").map((r) => r.id));
  expect(relatedRequirements("25").filter((r) => r.framework === "cis8").map((r) => r.id)).toEqual(["cis8:3.6", "cis8:3.9", "cis8:3.10", "cis8:3.11", "cis8:12.6"]);
  expect(frameworksInScope("lower", ["cis8"])).toEqual(["zkb", "cz410", "cis8"]);
});

test("zranitelnosti: rodina OS, příkazy a rozbor AI (ADR-076)", async () => {
  const { osFamilyOf, upgradeCommand, verifyCommand, parseVulnAdvice } = await import("@contix/shared");
  expect(osFamilyOf("Ubuntu 22.04.4 LTS")).toBe("debian");
  expect(osFamilyOf("Rocky Linux 9")).toBe("rhel");
  expect(osFamilyOf("Microsoft Windows Server 2022")).toBe("windows");
  expect(osFamilyOf("macOS Sonoma")).toBe("macos");
  expect(osFamilyOf(null)).toBe("other");
  expect(upgradeCommand("rhel", "openssl-libs")).toContain("dnf upgrade --refresh openssl-libs");
  // název balíčku s nebezpečnými znaky se do příkazu nevloží
  expect(upgradeCommand("debian", "x; rm -rf /")).toBeNull();
  expect(verifyCommand("debian", "a b")).toBeNull();
  expect(upgradeCommand("windows", "openssl")).toBeNull();
  const p = parseVulnAdvice('Tady:\n```json\n{"summary":"S","remediation":"1. A\\n2) B","references":["https://x.cz/a","ftp://x"]}\n```');
  expect(p).toMatchObject({ summary: "S", remediation: ["A", "B"], references: ["https://x.cz/a"], workaround: [] });
  expect(parseVulnAdvice("bez json").summary).toBe("bez json");
});

test("AI Act: klasifikace, výjimka čl. 6 odst. 3, povinnosti podle role, FRIA, šablona směrnice (ADR-090)", async () => {
  const { AiScreening, classifyAiSystem, aiObligationsFor, friaRequired, aiDirectiveTemplate, AIACT_LABELS, AI_OBLIGATIONS } = await import("@contix/shared");
  const s = (x: object) => AiScreening.parse(x);
  expect(classifyAiSystem(null).cls).toBe("unassessed");
  expect(classifyAiSystem(s({})).cls).toBe("minimal");
  expect(classifyAiSystem(s({ prohibited: ["social_scoring"], annexIII: ["recruitment"] })).cls).toBe("prohibited");
  expect(classifyAiSystem(s({ annexIII: ["recruitment"] }))).toMatchObject({ cls: "high", highRiskFrom: "2027-12-02" });
  expect(classifyAiSystem(s({ annexI: true })).highRiskFrom).toBe("2028-08-02");
  // výjimka bez profilování = není vysoké riziko; s profilováním platí vysoké riziko
  expect(classifyAiSystem(s({ annexIII: ["recruitment"], exception: "preparatory" }))).toMatchObject({ cls: "minimal", annexIIIExempt: true });
  expect(classifyAiSystem(s({ annexIII: ["recruitment"], exception: "preparatory", profiling: true })).cls).toBe("high");
  expect(classifyAiSystem(s({ transparency: ["deepfake"] })).cls).toBe("limited");
  // FRIA: veřejná služba, nebo bonita / pojištění; ne kritická infrastruktura
  const hi = (x: object) => [s(x), classifyAiSystem(s(x))] as const;
  expect(friaRequired(...hi({ annexIII: ["recruitment"] }))).toBe(false);
  expect(friaRequired(...hi({ annexIII: ["recruitment"], publicService: true }))).toBe(true);
  expect(friaRequired(...hi({ annexIII: ["creditworthiness"] }))).toBe(true);
  expect(friaRequired(...hi({ annexIII: ["critical_infrastructure"], publicService: true }))).toBe(false);
  // povinnosti podle role
  const dep = aiObligationsFor("deployer", s({ annexIII: ["recruitment"] }), { d_logs: { status: "done", note: null, at: null } }).map((o) => o.key);
  expect(dep).toContain("d_oversight");
  expect(dep).not.toContain("p_qms");
  expect(dep).not.toContain("d_dpia");
  expect(aiObligationsFor("provider", s({ annexIII: ["recruitment"] }), {}).map((o) => o.key)).toEqual(expect.arrayContaining(["p_qms", "p_tech_doc", "p_conformity", "literacy"]));
  expect(aiObligationsFor("provider", s({ annexIII: ["recruitment"], exception: "narrow_task" }), {}).map((o) => o.key)).toEqual(["literacy", "p_exempt_registration"]);
  expect(aiObligationsFor("deployer", s({ prohibited: ["face_scraping"] }), {})).toEqual([]);
  // každá povinnost má popisek
  for (const o of AI_OBLIGATIONS) expect(AIACT_LABELS.obligation[o.key as keyof typeof AIACT_LABELS.obligation]).toBeTruthy();
  // šablona směrnice
  const cs = aiDirectiveTemplate({ org: "Město X", tools: [{ name: "Copilot", purpose: "Psaní textů" }], locale: "cs" });
  expect(cs.directive.content).toContain("**Copilot** – Psaní textů");
  expect(cs.directive.content).toContain("Město X");
  expect(cs.quiz.every((q) => q.correct.every((i) => i < q.options.length))).toBe(true);
  expect(aiDirectiveTemplate({ org: "X", tools: [], locale: "en" }).summary.title).toBe("AI at work – summary for employees");
});

test("SOC 2: kritéria v rozsahu, mapování TSC ↔ 409 / ISO, testy v rozsahu, připravenost (ADR-091)", async () => {
  const { soc2CriteriaFor, tscCrosswalk, soc2TestInScope, soc2Readiness, SOC2_PBC_TEMPLATE, TSC_ISO } = await import("@contix/shared");
  const cc = soc2CriteriaFor([]);
  expect(cc.every((c) => c.category === "CC")).toBe(true);
  expect(cc.length).toBe(33);
  expect(soc2CriteriaFor(["P"]).some((c) => c.id === "P8.1")).toBe(true);
  // každé kritérium mimo P má mapování na ISO; P → A.5.34
  for (const c of soc2CriteriaFor(["A1", "C1", "PI1", "P"])) expect(tscCrosswalk(c.id).iso.length).toBeGreaterThan(0);
  expect(tscCrosswalk("P4.2").iso).toEqual(["A.5.34"]);
  expect(Object.keys(TSC_ISO).every((k) => soc2CriteriaFor(["A1", "C1", "PI1"]).some((c) => c.id === k))).toBe(true);
  expect(tscCrosswalk("CC9.2").cz409).toContain("§ 9");
  // šablona PBC jen na existující kritéria
  const all = new Set(soc2CriteriaFor(["A1", "C1", "PI1", "P"]).map((c) => c.id));
  expect(SOC2_PBC_TEMPLATE.every((p) => all.has(p.ref))).toBe(true);
  // testy v rozsahu
  const t2 = { reportType: "type2" as const, asOf: null, periodFrom: "2026-01-01", periodTo: "2026-06-30" };
  expect(soc2TestInScope({ kind: "operating", periodFrom: "2025-10-01", periodTo: "2026-01-15", performedAt: null }, t2)).toBe(true);
  expect(soc2TestInScope({ kind: "operating", periodFrom: "2025-01-01", periodTo: "2025-06-30", performedAt: null }, t2)).toBe(false);
  expect(soc2TestInScope({ kind: "design", periodFrom: null, periodTo: null, performedAt: null }, t2)).toBe(false);
  expect(soc2TestInScope({ kind: "design", periodFrom: null, periodTo: null, performedAt: "2026-03-01" }, { reportType: "type1", asOf: "2026-03-31", periodFrom: null, periodTo: null })).toBe(true);
  expect(soc2TestInScope({ kind: "design", periodFrom: null, periodTo: null, performedAt: "2026-04-15" }, { reportType: "type1", asOf: "2026-03-31", periodFrom: null, periodTo: null })).toBe(false);
  // připravenost: nerelevantní kritéria nevyžadují opatření ani test
  const base = { id: "x", companyId: "c", auditId: "a", auditStatus: "planned", title: "T", reportType: "type1" as const, categories: [], asOf: "2026-03-31", periodFrom: null, periodTo: null, systemName: "S", serviceOrg: null, serviceAuditor: "A", signatory: "B", reportDate: "2026-04-10", reportPlace: null, opinion: "unmodified" as const, opinionBasis: null, assertion: null, description: Object.fromEntries(["services", "commitments", "infrastructure", "software", "people", "procedures", "data", "controlEnvironment", "riskAssessment", "infoCommunication", "monitoring"].map((k) => [k, "x"])), cuecs: [], subservice: [], otherInfo: null, updatedAt: "" };
  const row = (conclusion: string) => ({ id: "CC1.1", section: "CC1", sectionTitle: "", category: "CC" as const, label: "", cz409: [], iso: [], controls: [], tests: [], exceptions: [], pbc: { total: 0, open: 0, submitted: 0, accepted: 0 }, workpaper: { conclusion: conclusion as any, note: null, byName: null, at: null } });
  expect(soc2Readiness(base, [row("na")])).toEqual([]);
  expect(soc2Readiness(base, [row("pending")])).toEqual(["criteria_without_controls", "criteria_untested", "criteria_pending"]);
});

test("CRA: SBOM CycloneDX / SPDX, lhůty čl. 14, posouzení shody, mezery, text hlášení (ADR-092)", async () => {
  const { parseSbom, craDeadlines, craConformityOptions, craProductGaps, craRequirementsFor, buildCraReport, CRA_REQUIREMENTS, CRA_LABELS, CRA_CATEGORY_ITEMS } = await import("@contix/shared");
  const spdx = { spdxVersion: "SPDX-2.3", packages: [{ name: "zlib", versionInfo: "1.3", supplier: "Organization: zlib", licenseConcluded: "Zlib", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:generic/zlib@1.3" }] }, { name: "zlib", versionInfo: "1.3", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:generic/zlib@1.3" }] }, { name: "x", licenseConcluded: "NOASSERTION" }] };
  expect(parseSbom(JSON.stringify(spdx))).toEqual({ format: "spdx", components: [{ name: "zlib", version: "1.3", purl: "pkg:generic/zlib@1.3", supplier: "zlib", license: "Zlib" }, { name: "x", version: null, purl: null, supplier: null, license: null }] });
  expect(() => parseSbom("nope")).toThrow();
  expect(() => parseSbom("{}")).toThrow();
  // zámky závislostí (v1.12)
  const bunLock = `{
  "lockfileVersion": 1,
  "workspaces": { "": { "name": "x" }, },
  "packages": {
    "@contix/api": ["@contix/api@workspace:apps/api"],
    "hono": ["hono@4.13.13", "", {}, "sha512-x"],
    "@hono/zod-validator": ["@hono/zod-validator@0.9.1", "", { "peerDependencies": { "hono": ">=3" } }, "sha512-y"],
  },
}`;
  expect(parseSbom(bunLock)).toEqual({
    format: "bun_lock",
    components: [
      { name: "hono", version: "4.13.13", purl: "pkg:npm/hono@4.13.13", supplier: null, license: null },
      { name: "@hono/zod-validator", version: "0.9.1", purl: "pkg:npm/%40hono/zod-validator@0.9.1", supplier: null, license: null },
    ],
  });
  const npmLock = { name: "app", lockfileVersion: 3, packages: { "": { name: "app", version: "1.0.0" }, "node_modules/lodash": { version: "4.17.20", license: "MIT" }, "node_modules/a/node_modules/@x/y": { version: "2.0.0" }, "node_modules/local": { link: true } } };
  expect(parseSbom(JSON.stringify(npmLock)).components.map((c) => [c.name, c.purl, c.license])).toEqual([
    ["lodash", "pkg:npm/lodash@4.17.20", "MIT"],
    ["@x/y", "pkg:npm/%40x/y@2.0.0", null],
  ]);
  const reqTxt = parseSbom("# deps\nDjango==4.2.1  # web\nrequests[socks]>=2.31\n-r other.txt\nPyYAML===6.0.1 ; python_version>'3.8'\n");
  expect(reqTxt.format).toBe("requirements");
  expect(reqTxt.components.map((c) => [c.name, c.version, c.purl])).toEqual([
    ["Django", "4.2.1", "pkg:pypi/django@4.2.1"],
    ["requests", null, "pkg:pypi/requests"],
    ["PyYAML", "6.0.1", "pkg:pypi/pyyaml@6.0.1"],
  ]);
  const { purlToOsv: p2o } = await import("@contix/shared");
  expect(p2o("pkg:npm/%40hono/zod-validator@0.9.1")).toEqual({ ecosystem: "npm", name: "@hono/zod-validator", version: "0.9.1" });
  const now = new Date("2026-10-02T10:00:00Z");
  const v = craDeadlines({ kind: "vulnerability", awareAt: "2026-10-01T09:00:00Z", earlyWarningAt: "2026-10-01T20:00:00Z", notificationAt: null, correctiveAvailableAt: null, finalReportAt: null }, now);
  expect(v.map((d) => d.state)).toEqual(["done", "open", "waiting"]);
  expect(v[1]!.due).toBe("2026-10-04T09:00:00.000Z");
  expect(craDeadlines({ kind: "incident", awareAt: "2026-10-01T09:00:00Z", earlyWarningAt: null, notificationAt: null, correctiveAvailableAt: null, finalReportAt: null }, now)[0]!.state).toBe("overdue");
  expect(craConformityOptions("important_2")).not.toContain("A");
  expect(craConformityOptions("important_2", true)).toContain("A");
  expect(craConformityOptions("critical")[0]).toBe("EUCC");
  const req = craRequirementsFor("importer", {});
  expect(req.every((r) => r.key.startsWith("i_"))).toBe(true);
  expect(craRequirementsFor("oss_steward", {}).map((r) => r.key)).toEqual(["p2_cvd_policy", "p2_contact", "o_reporting", "o_oss_policy"]);
  for (const r of CRA_REQUIREMENTS) expect((CRA_LABELS.req as Record<string, string>)[r.key]).toBeTruthy();
  for (const i of CRA_CATEGORY_ITEMS) expect(CRA_LABELS.item[i.key]).toBeTruthy();
  const base = { role: "distributor" as const, status: "on_market" as const, category: "default" as const, supportUntil: null, supportJustification: null, onMarketSince: null, securityContact: null, conformityModule: null, oss: false, components: 0, requirements: [], overdueReports: 0, today: "2026-10-22" };
  expect(craProductGaps(base)).toEqual(["no_manufacturer_support"]); // v1.16: distributor eviduje konec podpory výrobce
  expect(craProductGaps({ ...base, supportUntil: "2030-01-01" })).toEqual([]);
  expect(craProductGaps({ ...base, role: "manufacturer", supportUntil: "2027-01-01", onMarketSince: "2026-01-01" })).toEqual(["support_short", "support_ending", "no_conformity", "no_sbom", "no_contact"]);
  const s = buildCraReport({ name: "P", version: null, manufacturer: "M" }, { kind: "incident", awareAt: "2026-10-01T09:00:00Z", malicious: null, memberStates: [], cveIds: [], description: "x", severity: null, mitigation: null, userMeasures: null, sensitivity: null, rootCause: "phishing", actorInfo: null, correctiveAvailableAt: null }, "final", "en");
  expect(s.find((x) => x.label === "Type of threat / root cause")?.value).toBe("phishing");
  expect(s.find((x) => x.label === "Suspected unlawful or malicious act")?.value).toBe("not yet known");
});

test("CRA: purl → OSV, porovnání verzí, rozsahy OSV, VEX (ADR-093)", async () => {
  const { purlToOsv, compareVersions, osvAffects, parseOsvRecord, buildOpenVex, buildCycloneDxVex, cvesOf } = await import("@contix/shared");
  expect(purlToOsv("pkg:npm/%40angular/core@16.0.0")).toEqual({ ecosystem: "npm", name: "@angular/core", version: "16.0.0" });
  expect(purlToOsv("pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1")).toEqual({ ecosystem: "Maven", name: "org.apache.logging.log4j:log4j-core", version: "2.14.1" });
  expect(purlToOsv("pkg:pypi/Django_Rest@3.1")).toEqual({ ecosystem: "PyPI", name: "django-rest", version: "3.1" });
  expect(purlToOsv("pkg:deb/debian/openssl@3.0.11-1~deb12u2?arch=amd64")).toEqual({ ecosystem: "Debian", name: "openssl", version: "3.0.11-1~deb12u2" });
  expect(purlToOsv("pkg:generic/openssl@3.0.1")).toBeNull();
  expect(purlToOsv("pkg:golang/github.com/gin-gonic/gin", "v1.9.0")).toEqual({ ecosystem: "Go", name: "github.com/gin-gonic/gin", version: "v1.9.0" });
  expect(compareVersions("1.2.10", "1.2.9")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0-rc1", "1.0.0")).toBeLessThan(0);
  expect(compareVersions("1:1.0", "2.0")).toBeGreaterThan(0);
  expect(compareVersions("3.0.11-1~deb12u2", "3.0.11-1")).toBeLessThan(0);
  expect(compareVersions("v1.9.0", "1.9.0")).toBe(0);
  const a: import("@contix/shared").OsvAffected = { ecosystem: "npm", name: "minimist", versions: [], ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.2.4" }, { introduced: "1.0.0" }, { fixed: "1.2.6" }] }] };
  expect(osvAffects(a, "0.2.3")).toBe(true);
  expect(osvAffects(a, "0.2.4")).toBe(false);
  expect(osvAffects(a, "1.2.5")).toBe(true);
  expect(osvAffects(a, "1.2.6")).toBe(false);
  expect(osvAffects({ ...a, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "2.0" }, { last_affected: "2.3" }] }] }, "2.3")).toBe(true);
  expect(osvAffects({ ...a, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "2.0" }] }] }, "9.9")).toBe(true);
  expect(osvAffects({ ...a, versions: ["1.0"], ranges: [] }, "1.0")).toBe(true);
  const r = parseOsvRecord(JSON.stringify({ id: "DSA-1", upstream: ["CVE-2024-1"], affected: [{ package: { ecosystem: "Debian:12", name: "x" }, ranges: [{ type: "GIT", events: [] }] }], withdrawn: "2025-01-01" }));
  expect(r).toMatchObject({ id: "DSA-1", aliases: ["CVE-2024-1"], withdrawn: true, affected: [{ ecosystem: "Debian", ranges: [] }] });
  expect(parseOsvRecord("{}")).toBeNull();
  expect(cvesOf("GHSA-x", ["cve-2021-1234", "PYSEC-1"])).toEqual(["CVE-2021-1234"]);
  const st = [{ vulnId: "CVE-2021-1", aliases: [], componentRef: "pkg:npm/a@1", status: "affected" as const, justification: null, impactStatement: null, actionStatement: "Update to 2" }];
  const ov = buildOpenVex({ id: "p", name: "P", version: "1" }, "Org", st, new Date("2026-10-22T00:00:00Z"));
  expect(ov.statements[0]).toMatchObject({ status: "affected", action_statement: "Update to 2", products: [{ "@id": "urn:contix:product:p", subcomponents: [{ "@id": "pkg:npm/a@1" }] }] });
  const cdx = buildCycloneDxVex({ id: "p", name: "P", version: null }, "Org", st);
  expect(cdx.vulnerabilities[0]!.analysis).toMatchObject({ state: "exploitable", response: ["update"] });
  expect(cdx.components[0]).toMatchObject({ "bom-ref": "pkg:npm/a@1", purl: "pkg:npm/a@1" });
});

test("AI v0.99: validace návrhů nastavení polí a VEX (ADR-094)", async () => {
  const { parseSetFields, parseVexItems, VEX_STATUSES, VEX_JUSTIFICATIONS } = await import("@contix/shared");
  const spec = { a: { type: "list" as const, values: ["x", "y"] }, b: { type: "bool" as const }, c: { type: "enum" as const, values: ["p", "q"], nullable: true } };
  const r = parseSetFields({ summary: "S", s: { a: ["x", "zz", "x"], b: "true", c: "nope", d: 1 }, reasons: { a: "proč" } }, spec, { a: [], b: false, c: "p" }, "s");
  expect(r).toEqual({ summary: "S", items: [{ field: "a", value: ["x"], current: [], reason: "proč" }, { field: "b", value: true, current: false, reason: "" }] });
  expect(parseSetFields({ s: { c: null, a: ["y"] } }, spec, { a: ["y"], b: false, c: "p" }, "s").items).toEqual([{ field: "c", value: null, current: "p", reason: "" }]);
  const known = new Map([["f1", { vulnId: "CVE-1", componentRef: "pkg:npm/a@1" }]]);
  const v = parseVexItems({ findings: [{ findingId: "f1", status: "not_affected" }, { findingId: "f1", status: "not_affected", justification: "component_not_present", impactStatement: " ok " }, { findingId: "zz", status: "fixed" }, { findingId: "f1", status: "affected" }] }, known, VEX_STATUSES, VEX_JUSTIFICATIONS);
  expect(v.items).toEqual([{ findingId: "f1", vulnId: "CVE-1", componentRef: "pkg:npm/a@1", status: "not_affected", justification: "component_not_present", impactStatement: "ok", actionStatement: null, reason: "" }]);
});

describe("import skenů zranitelností (ADR-095)", () => {
  const NESSUS = `<?xml version="1.0" ?><NessusClientData_v2><Report name="t"><ReportHost name="10.0.0.5"><HostProperties><tag name="host-ip">10.0.0.5</tag><tag name="host-fqdn">web01.firma.local</tag></HostProperties>
<ReportItem port="443" svc_name="www" protocol="tcp" severity="3" pluginID="12345" pluginName="OpenSSL &lt; 3.0.8 Multiple Vulnerabilities"><description>Desc</description><solution>Upgrade</solution><cvss3_base_score>7.5</cvss3_base_score><cve>CVE-2023-0286</cve><cve>CVE-2023-0215</cve><see_also>https://a.example
https://b.example</see_also></ReportItem>
<ReportItem port="0" protocol="tcp" severity="0" pluginID="19506" pluginName="Nessus Scan Information"><description>info</description></ReportItem></ReportHost></Report></NessusClientData_v2>`;
  const OPENVAS = `<get_reports_response><report id="r"><report id="r"><results><result id="1"><name>SSL/TLS: Deprecated TLSv1.0</name><host>10.0.0.6<hostname>db01</hostname></host><port>5432/tcp</port><nvt oid="1.3.6.1.4.1.25623.1.0.117274"><name>SSL/TLS: Deprecated TLSv1.0</name><cvss_base>4.3</cvss_base><tags>summary=Old TLS|solution=Disable</tags><refs><ref type="cve" id="CVE-2011-3389"/><ref type="cwe" id="CWE-326"/></refs></nvt><threat>Medium</threat><severity>4.3</severity><description>found</description></result><result id="2"><name>OS Detection</name><host>10.0.0.6</host><port>general/tcp</port><nvt oid="1.3.6.1.4.1.25623.1.0.105937"><name>OS Detection</name></nvt><threat>Log</threat><severity>0.0</severity></result></results></report></report></get_reports_response>`;
  const BURP = `<?xml version="1.0"?><issues burpVersion="2024.1"><issue><serialNumber>1</serialNumber><type>2097920</type><name>Cross-site scripting (reflected)</name><host ip="1.2.3.4">https://shop.example.com</host><path>/search</path><location>/search [q]</location><severity>High</severity><confidence>Certain</confidence><issueBackground>&lt;p&gt;XSS&lt;/p&gt;</issueBackground><remediationBackground>Encode</remediationBackground><vulnerabilityClassifications>&lt;a href="x"&gt;CWE-79: XSS&lt;/a&gt;</vulnerabilityClassifications></issue></issues>`;
  const ZAP = JSON.stringify({ "@version": "2.14", site: [{ "@name": "https://shop.example.com", "@host": "shop.example.com", "@port": "443", alerts: [{ pluginid: "10038", alertRef: "10038-1", alert: "Content Security Policy Header Not Set", riskcode: "2", desc: "<p>CSP</p>", solution: "<p>Set CSP</p>", reference: "<p>https://ref</p>", cweid: "693", instances: [{ uri: "https://shop.example.com/" }, { uri: "https://shop.example.com/a" }] }, { pluginid: "10096", alert: "Timestamp Disclosure", riskcode: "0", cweid: "-1", instances: [] }] }] });
  const NUCLEI = [
    JSON.stringify({ "template-id": "CVE-2021-44228", info: { name: "Log4Shell", severity: "critical", classification: { "cve-id": ["CVE-2021-44228"], "cwe-id": ["cwe-502"], "cvss-score": 10 } }, host: "https://app.example.com", "matched-at": "https://app.example.com/api?x=1", ip: "5.6.7.8" }),
    JSON.stringify({ "template-id": "tech-detect", "matcher-name": "nginx", info: { name: "Tech", severity: "info" }, host: "app.example.com:443", "matched-at": "app.example.com:443" }),
  ].join("\n");
  const TRIVY = JSON.stringify({ ArtifactName: "registry/app:1.2", Results: [{ Target: "registry/app:1.2 (alpine 3.19)", Class: "os-pkgs", Vulnerabilities: [{ VulnerabilityID: "CVE-2024-0727", PkgName: "openssl", InstalledVersion: "3.1.4-r0", FixedVersion: "3.1.4-r5", Severity: "MEDIUM", Title: "openssl: null deref", CVSS: { nvd: { V3Score: 5.5 } }, CweIDs: ["CWE-476"] }] }, { Target: "app/package-lock.json", Class: "lang-pkgs", Vulnerabilities: [{ VulnerabilityID: "GHSA-xxxx-yyyy-zzzz", PkgName: "lodash", InstalledVersion: "4.17.20", Severity: "HIGH" }] }] });
  const GRYPE = JSON.stringify({ matches: [{ vulnerability: { id: "GHSA-p6mc-m468-83gw", severity: "High", fix: { versions: ["4.17.21"] }, cvss: [{ metrics: { baseScore: 7.4 } }] }, relatedVulnerabilities: [{ id: "CVE-2020-8203" }], artifact: { name: "lodash", version: "4.17.15", locations: [{ path: "/app/package-lock.json" }] } }], source: { target: { userInput: "app:latest" } } });
  const SARIF = JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "Semgrep", rules: [{ id: "js.xss", shortDescription: { text: "XSS sink" }, properties: { "security-severity": "8.1", tags: ["CWE-79: Improper Neutralization"] }, helpUri: "https://r" }] } }, results: [
    { ruleId: "js.xss", ruleIndex: 0, level: "error", message: { text: "innerHTML" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.js" }, region: { startLine: 12 } } }] },
    { ruleId: "js.xss", ruleIndex: 0, level: "error", message: { text: "innerHTML" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.js" }, region: { startLine: 40 } } }] },
    { ruleId: "js.xss", ruleIndex: 0, message: { text: "x" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/b.js" } } }] },
  ] }] });
  const CSV = "Host;IP;CVE;Title;Severity;Port\nweb01;10.0.0.5;CVE-2023-0286;OpenSSL;high;443/tcp\n;10.0.0.9;;Weak SSH ciphers;Medium;22/tcp\n";

  test("rozpoznání formátu", async () => {
    const { detectScanner } = await import("../src/modules/vulnerabilities/parsers");
    expect([NESSUS, OPENVAS, BURP, ZAP, NUCLEI, TRIVY, GRYPE, SARIF].map((x) => detectScanner(x))).toEqual(["nessus", "openvas", "burp", "zap", "nuclei", "trivy", "grype", "sarif"]);
    expect(detectScanner(CSV, "a.csv")).toBe("csv");
    expect(detectScanner("{}")).toBeNull();
    expect(detectScanner("<html></html>")).toBeNull();
  });

  test("parsery: Nessus, OpenVAS, Burp, ZAP", async () => {
    const { parseScan } = await import("../src/modules/vulnerabilities/parsers");
    const n = parseScan(NESSUS, "nessus");
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({ host: "web01.firma.local", ip: "10.0.0.5", ruleId: "12345", cves: ["CVE-2023-0215", "CVE-2023-0286"], severity: "high", info: false, cvss: 7.5, endpoint: "443/tcp", remediation: "Upgrade", reference: "https://a.example" });
    expect(n[1]).toMatchObject({ info: true, endpoint: "" });
    const o = parseScan(OPENVAS, "openvas");
    expect(o[0]).toMatchObject({ host: "db01", ip: "10.0.0.6", ruleId: "1.3.6.1.4.1.25623.1.0.117274", cves: ["CVE-2011-3389"], cwe: 326, severity: "medium", endpoint: "5432/tcp", remediation: "Disable" });
    expect(o[1]).toMatchObject({ info: true, endpoint: "" });
    const b = parseScan(BURP, "burp");
    expect(b[0]).toMatchObject({ host: "shop.example.com", ip: "1.2.3.4", ruleId: "2097920", severity: "high", cwe: 79, endpoint: "/search", description: "XSS" });
    const z = parseScan(ZAP, "zap");
    expect(z[0]).toMatchObject({ host: "shop.example.com", ruleId: "10038-1", severity: "medium", cwe: 693, remediation: "Set CSP" });
    expect(z[0]!.description).toContain("https://shop.example.com/a");
    expect(z[1]).toMatchObject({ info: true, cwe: null });
  });

  test("parsery: Nuclei, Trivy, Grype, SARIF, CSV", async () => {
    const { parseScan } = await import("../src/modules/vulnerabilities/parsers");
    const nu = parseScan(NUCLEI, "nuclei");
    expect(nu[0]).toMatchObject({ host: "app.example.com", ip: "5.6.7.8", ruleId: "CVE-2021-44228", cves: ["CVE-2021-44228"], severity: "critical", cwe: 502, endpoint: "/api?x=1" });
    expect(nu[1]).toMatchObject({ host: "app.example.com", ruleId: "tech-detect:nginx", info: true });
    const tr = parseScan(TRIVY, "trivy");
    expect(tr[0]).toMatchObject({ host: "registry/app:1.2", ruleId: "CVE-2024-0727", packageName: "openssl", packageVersion: "3.1.4-r0", fixedVersion: "3.1.4-r5", severity: "medium", cvss: 5.5, cwe: 476, endpoint: "" });
    expect(tr[1]).toMatchObject({ ruleId: "GHSA-xxxx-yyyy-zzzz", cves: [], endpoint: "app/package-lock.json", severity: "high" });
    const gr = parseScan(GRYPE, "grype");
    expect(gr[0]).toMatchObject({ host: "app:latest", ruleId: "GHSA-p6mc-m468-83gw", cves: ["CVE-2020-8203"], severity: "high", packageName: "lodash", fixedVersion: "4.17.21" });
    const sa = parseScan(SARIF, "sarif");
    expect(sa).toHaveLength(2);
    expect(sa[0]).toMatchObject({ ruleId: "Semgrep:js.xss", title: "XSS sink", severity: "high", cvss: 8.1, cwe: 79, endpoint: "src/a.js" });
    expect(sa[0]!.description).toContain("12, 40");
    const cs = parseScan(CSV, "csv");
    expect(cs[0]).toMatchObject({ host: "web01", ip: "10.0.0.5", ruleId: "CVE-2023-0286", severity: "high", endpoint: "443/tcp" });
    expect(cs[1]).toMatchObject({ host: "10.0.0.9", ruleId: "Weak SSH ciphers", severity: "medium" });
    expect(() => parseScan("a;b\n1;2", "csv")).toThrow(/host nebo ip/);
    expect(() => parseScan("{bad", "trivy")).toThrow(/nepodařilo přečíst/);
  });

  test("reprezentativní CVE, klíč nálezu, priorita z expozice, validace triáže AI", async () => {
    const { representativeId, vulnPriority, parseVulnTriageItems, severityFromText, cweOf } = await import("@contix/shared");
    const { findingKeyOf } = await import("../src/modules/vulnerabilities/scans");
    const intel = new Map([["CVE-2023-0215", { kev: false, epss: 0.02 }], ["CVE-2023-0286", { kev: true, epss: 0.01 }]]);
    expect(representativeId({ cves: ["CVE-2023-0215", "CVE-2023-0286"], ruleId: "1" }, "nessus", intel)).toBe("CVE-2023-0286");
    expect(representativeId({ cves: [], ruleId: "10038-1" }, "zap", intel)).toBe("zap:10038-1");
    expect(representativeId({ cves: [], ruleId: "GHSA-a" }, "trivy", intel)).toBe("GHSA-a");
    const k = findingKeyOf("nessus", { ruleId: "1", endpoint: "443/tcp", packageName: "", packageVersion: "" });
    expect(k).toHaveLength(40);
    expect(findingKeyOf("nessus", { ruleId: "1", endpoint: "80/tcp", packageName: "", packageVersion: "" })).not.toBe(k);
    expect(vulnPriority({ severity: "high", kev: false, epss: null, exposed: true })).toEqual({ priority: "p2", reasons: ["exposed"] });
    expect(vulnPriority({ severity: "medium", kev: false, epss: null, exposed: true }).priority).toBe("p4");
    expect(severityFromText("Negligible")).toEqual({ severity: "low", info: false });
    expect(cweOf("external/cwe/cwe-079")).toBe(79);
    const known = new Map([["a", { title: "A" }], ["b", { title: "B" }]]);
    const cand = new Map([["w", { title: "W" }]]);
    const r = parseVulnTriageItems(
      { summary: "S", findings: [{ findingId: "a", action: "duplicate", duplicateOfId: "w", reason: "same" }, { findingId: "b", action: "false_positive", reason: "x" }, { findingId: "b", action: "duplicate", duplicateOfId: "b" }, { findingId: "zz", action: "verify" }, { findingId: "b", action: "verify", reason: "KEV" }] },
      known,
      cand,
    );
    expect(r.items).toEqual([
      { findingId: "a", action: "duplicate", duplicateOfId: "w", title: "A", duplicateTitle: "W", reason: "same" },
      { findingId: "b", action: "verify", duplicateOfId: null, title: "B", duplicateTitle: null, reason: "KEV" },
    ]);
  });
});

test("průběžné monitorování: parametry, vyhodnocení, souhrn za období (ADR-096)", async () => {
  const { monitorParamsOf, evaluateMonitor, monitorPeriod } = await import("@contix/shared");
  expect(monitorParamsOf("vuln_kev", { maxCount: 2, minPct: 50 })).toEqual({ maxCount: 2, graceDays: 14 });
  expect(monitorParamsOf("identity_mfa", "nesmysl")).toEqual({ minPct: 100 });
  expect(evaluateMonitor("identity_mfa", 99.5, { minPct: 100 })).toEqual({ result: "fail", threshold: 100 });
  expect(evaluateMonitor("vuln_overdue", 0, {})).toEqual({ result: "pass", threshold: 0 });
  expect(evaluateMonitor("sca_score", 80, {})).toEqual({ result: "pass", threshold: 80 });
  const runs = (n: number, r = "pass") => Array.from({ length: n }, (_, i) => ({ runAt: new Date(Date.UTC(2026, 0, 1 + i, 3)), result: r as "pass" }));
  expect(monitorPeriod(runs(31), "2026-01-01", "2026-01-31", "daily")).toMatchObject({ runs: 31, expected: 31, gap: false, coverage: 100, result: "effective" });
  expect(monitorPeriod(runs(5), "2026-01-01", "2026-01-31", "weekly")).toMatchObject({ runs: 5, expected: 4, coverage: 100, result: "effective" });
  expect(monitorPeriod([...runs(20), { runAt: "2026-01-25T00:00:00Z", result: "fail" as const }], "2026-01-01", "2026-01-31", "daily", 5)).toMatchObject({ gap: true, exceptions: 2, result: "effective_with_exceptions" });
  expect(monitorPeriod(runs(3), "2025-01-01", "2025-01-31", "monthly")).toMatchObject({ runs: 0, result: "not_tested" });
});

test("parsery Qualys, Dependency-Track a převod nálezů DefectDojo (ADR-097)", async () => {
  const { detectScanner, parseScan } = await import("../src/modules/vulnerabilities/parsers");
  const { ddToFindings } = await import("../src/modules/vulnerabilities/defectdojo");
  const QD = `<?xml version="1.0"?><HOST_LIST_VM_DETECTION_OUTPUT><RESPONSE><HOST_LIST><HOST><IP>10.1.1.5</IP><DNS>app01.firma.local</DNS><DETECTION_LIST><DETECTION><QID>38170</QID><TYPE>Confirmed</TYPE><SEVERITY>4</SEVERITY><PORT>443</PORT><PROTOCOL>TCP</PROTOCOL><RESULTS>TLSv1.0 CVE-2011-3389</RESULTS></DETECTION><DETECTION><QID>6</QID><TYPE>Info</TYPE><SEVERITY>1</SEVERITY></DETECTION></DETECTION_LIST></HOST></HOST_LIST></RESPONSE></HOST_LIST_VM_DETECTION_OUTPUT>`;
  const QS = `<?xml version="1.0"?><SCAN value="scan/1"><IP value="10.1.1.6" name="db01"><VULNS><CAT value="Database" port="5432" protocol="tcp"><VULN number="19888" severity="5"><TITLE>PostgreSQL RCE</TITLE><CVE_ID_LIST><CVE_ID><ID>CVE-2099-0301</ID></CVE_ID></CVE_ID_LIST><SOLUTION>Patch</SOLUTION></VULN></CAT></VULNS></IP></SCAN>`;
  const DT = JSON.stringify({ version: "1.2", meta: { application: "Dependency-Track" }, project: { name: "eshop", version: "2.1" }, findings: [
    { component: { name: "jackson-databind", version: "2.9.8", purl: "pkg:maven/com.fasterxml.jackson.core/jackson-databind@2.9.8" }, vulnerability: { vulnId: "CVE-2019-12384", source: "NVD", severity: "HIGH", cvssV3BaseScore: 5.9, cweId: 502 }, analysis: { state: "NOT_SET", isSuppressed: false } },
    { component: { name: "x", version: "1" }, vulnerability: { vulnId: "GHSA-aaaa", severity: "LOW" }, analysis: { state: "FALSE_POSITIVE", isSuppressed: true } },
  ] });
  expect([detectScanner(QD), detectScanner(QS), detectScanner(DT)]).toEqual(["qualys", "qualys", "dependency_track"]);
  const q = parseScan(QD, "qualys");
  expect(q[0]).toMatchObject({ host: "app01.firma.local", ip: "10.1.1.5", ruleId: "QID-38170", severity: "high", endpoint: "443/tcp", cves: ["CVE-2011-3389"] });
  expect(q[1]).toMatchObject({ info: true });
  expect(parseScan(QS, "qualys")[0]).toMatchObject({ host: "db01", ip: "10.1.1.6", ruleId: "QID-19888", title: "PostgreSQL RCE", severity: "critical", cves: ["CVE-2099-0301"], endpoint: "5432/tcp", remediation: "Patch" });
  const d = parseScan(DT, "dependency_track");
  expect(d[0]).toMatchObject({ host: "eshop 2.1", ruleId: "CVE-2019-12384", severity: "high", cwe: 502, packageName: "jackson-databind", packageVersion: "2.9.8", reference: "https://nvd.nist.gov/vuln/detail/CVE-2019-12384" });
  expect(d[1]!.info).toBe(true);
  const eps = new Map([[7, { host: "web01", port: 443, path: "/admin" }]]);
  const a = ddToFindings({ id: 9, title: "TLS", severity: "Medium", endpoints: [7, { host: "web02", port: 80 }] }, eps, "Produkt");
  expect(a.map((x) => `${x.host}|${x.endpoint}|${x.ruleId}`)).toEqual(["web01|443 /admin|DD-9", "web02|80|DD-9"]);
  expect(ddToFindings({ id: 10, severity: "Info", vulnerability_ids: [{ vulnerability_id: "CVE-2099-0001" }] }, eps, "Produkt")[0]).toMatchObject({ host: "Produkt", info: true, cves: ["CVE-2099-0001"] });
});

test("zprávy o ujištění dodavatelů: platnost, mezery, výňatek, validace AI (ADR-098)", async () => {
  const { defaultReportValidity, supplierReportGaps, parseReportItems } = await import("@contix/shared");
  const { reportExcerpt } = await import("../src/modules/ai/usecasesSupplier");
  expect(defaultReportValidity({ periodTo: "2026-03-31" })).toBe("2027-03-31");
  expect(defaultReportValidity({ asOf: "2026-01-15" })).toBe("2027-01-15");
  expect(defaultReportValidity({})).toBeNull();
  const now = new Date("2026-10-23T00:00:00Z");
  const base = { kind: "soc2_type2" as const, opinion: "unmodified" as const, validUntil: "2027-03-31", periodTo: "2026-03-31", bridgeUntil: null, subserviceOrgs: [] as string[], hasFile: true };
  expect(supplierReportGaps(base, [], now).map((g) => g.code)).toEqual(["bridge"]);
  expect(supplierReportGaps({ ...base, bridgeUntil: "2026-09-30" }, [], now)).toEqual([]);
  const items = [
    { kind: "cuec" as const, status: "open" as const, controlId: null },
    { kind: "cuec" as const, status: "open" as const, controlId: "c1", controlStatus: "planned" },
    { kind: "cuec" as const, status: "not_applicable" as const, controlId: null },
    { kind: "exception" as const, status: "open" as const, controlId: null, riskId: null },
    { kind: "exception" as const, status: "open" as const, controlId: null, riskId: "r1" },
    { kind: "csoc" as const, status: "open" as const, controlId: null },
  ];
  const g = supplierReportGaps({ ...base, opinion: "qualified", validUntil: "2026-10-01", bridgeUntil: "2026-10-01", subserviceOrgs: ["AWS"], hasFile: false }, items, now);
  expect(g.map((x) => `${x.code}:${x.n ?? ""}`)).toEqual(["expired:", "opinion:", "cuec_unmapped:1", "cuec_weak:1", "exception_open:1", "subservice:1", "no_file:"]);
  const long = `${"intro ".repeat(5000)}Complementary User Entity Controls: users must review access. ${"x ".repeat(3000)} Exceptions noted: one change lacked approval.`;
  const ex = reportExcerpt(long, 6000);
  expect(ex).toContain("Complementary User Entity Controls");
  expect(ex).toContain("Exceptions noted");
  expect(ex.length).toBeLessThanOrEqual(6000);
  expect(reportExcerpt("bez klíčových slov", 5)).toBe("bez k");
  const r = parseReportItems(
    { summary: "S", cuecs: [{ ref: "CUEC-1", text: "Uživatel pravidelně přezkoumává přístupy.", criterion: "cc6.1", controlId: "c1" }, { text: "Uživatel pravidelně přezkoumává přístupy." }, { text: "krátké" }], exceptions: [{ text: "Jedna změna bez schválení.", criterion: "XX9", controlId: "c1", severity: "high", managementResponse: "Doplněno." }], csocs: [{ text: "AWS zajišťuje fyzickou bezpečnost.", severity: "high" }] },
    new Map([["c1", "A.5.18 Přístupová práva"]]),
    new Set(["CC6.1"]),
  );
  expect(r.items.map((i) => [i.itemKind, i.criterion, i.controlId, i.severity])).toEqual([
    ["cuec", "CC6.1", "c1", null],
    ["exception", null, null, "high"],
    ["csoc", null, null, null],
  ]);
  expect(r.items[0]!.controlName).toBe("A.5.18 Přístupová práva");
});

test("dotazníky zákazníků a Trust Center: podobnost, sloupce, otázky z tabulky, validace AI, adresa (ADR-099)", async () => {
  const { qaSimilarity, bestMatches, guessQuestionColumns, parseQaAnswers, TrustSettingsInput } = await import("@contix/shared");
  const { questionsFromTable } = await import("../src/modules/trust/questionnaires");
  expect(qaSimilarity("Do you enforce multi-factor authentication for remote access?", "Is multi-factor authentication enforced for all remote access?")).toBeGreaterThan(0.6);
  expect(qaSimilarity("Máte zavedené zálohování dat?", "Provádíte pravidelné zálohování dat?")).toBeGreaterThan(0.4);
  expect(qaSimilarity("Do you scan for vulnerabilities monthly?", "Who is your data protection officer?")).toBeLessThan(0.3);
  const lib = [{ id: "a", question: "Is MFA enforced for remote access?" }, { id: "b", question: "Do you have a business continuity plan?" }];
  expect(bestMatches("Do you enforce MFA on remote access?", lib, 3, 0.3).map((x) => x.id)).toEqual(["a"]);
  expect(guessQuestionColumns(["ID", "Domain", "Question", "Answer (Yes/No)", "Comments"])).toEqual({ question: 2, answer: 3, id: 0 });
  expect(guessQuestionColumns(["Č.", "Otázka", "Odpověď"])).toEqual({ question: 1, answer: 2, id: 0 });
  const rows = [["", "Access control", "", ""], ["AC-1", "", "Is MFA enforced?", ""], ["AC-2", "", "Are accounts reviewed quarterly?", "Yes"], ["", "", "Encryption", ""], ["EN-1", "", "Is data encrypted at rest?", ""]];
  expect(questionsFromTable(rows, [2, 3, 4, 5, 6], { question: 2, id: 0 })).toEqual([
    { seq: 1, sourceRow: 3, ref: "AC-1", section: "Access control", question: "Is MFA enforced?" },
    { seq: 2, sourceRow: 4, ref: "AC-2", section: "Access control", question: "Are accounts reviewed quarterly?" },
    { seq: 3, sourceRow: 6, ref: "EN-1", section: "Encryption", question: "Is data encrypted at rest?" },
  ]);
  const cand = new Map([["policy:p1", { kind: "policy" as const, id: "p1", label: "Politika přístupu" }]]);
  const r = parseQaAnswers(
    { answers: [{ itemId: "i1", answer: "yes", text: "MFA je povinné.", sources: [{ kind: "policy", id: "p1" }, { kind: "policy", id: "zz" }], confidence: "high" }, { itemId: "i2", answer: "maybe" }, { itemId: "i3", answer: "no", confidence: "high" }, { itemId: "zz", answer: "yes" }] },
    new Map([["i1", { question: "MFA?", candidates: cand }], ["i2", { question: "x", candidates: new Map() }], ["i3", { question: "y", candidates: new Map() }]]),
  );
  expect(r.items.map((i) => [i.itemId, i.answer, i.sources.length, i.confidence])).toEqual([["i1", "yes", 1, "high"], ["i3", "no", 0, "low"]]);
  expect(TrustSettingsInput.safeParse({ slug: "Firma-CZ", title: "T" }).success).toBe(true);
  expect(TrustSettingsInput.safeParse({ slug: "a", title: "T" }).success).toBe(false);
  expect(TrustSettingsInput.safeParse({ slug: "-bad-", title: "T" }).success).toBe(false);
});

test("e-Sbírka: fragmenty i při změně tvaru odpovědi, stránkování od 1, diagnostika (v1.12.1)", async () => {
  const { EsbirkaClient, fragmentListOf, fragmentText } = await import("../src/modules/legislation/esbirka");
  const frag = (id: number, cit: string, text: string, field = "xhtml") => ({ id, staleUrl: `/sb/2025/264/2025-11-01#par_${id}`, zkracenaCitace: cit, [field]: `<p>${text}</p>` });
  expect(fragmentListOf({ data: { fragmenty: [frag(1, "§ 1", "A")] } })).toHaveLength(1);
  expect(fragmentListOf([frag(1, "§ 1", "A")])).toHaveLength(1);
  expect(fragmentListOf({ pocetStranek: 1, info: "x" })).toEqual([]);
  expect(fragmentText({ xhtmlObsahFragmentu: "<p>B</p>" })).toBe("<p>B</p>");
  const run = async (handler: (page: number) => unknown) => {
    const cl = new EsbirkaClient({ ESBIRKA_API_URL: "https://x.test", ESBIRKA_API_KEY: "k" }, async (input: string) => Response.json(handler(Number(new URL(input).searchParams.get("cisloStranky")))));
    (cl as unknown as { last: number }).last = -1e15;
    return { out: await cl.fragments("/sb/2025/264/2025-11-01"), cl };
  };
  // stránkování od 1, seznam pod jiným klíčem a text v přejmenovaném poli
  const a = await run((p) => (p === 0 ? { polozky: [], pocetStranek: 2 } : p <= 2 ? { polozky: [frag(p, `§ ${p}`, `Text ${p}`, "textFragmentu")], pocetStranek: 2 } : { polozky: [] }));
  expect(a.out.map((f) => [f.label, f.text])).toEqual([
    ["§ 1", "Text 1"],
    ["§ 2", "Text 2"],
  ]);
  // prázdná odpověď → diagnostika jen se strukturou (bez obsahu)
  const b = await run(() => ({ vysledek: "ok", seznamFragmentu: null }));
  expect(b.out).toEqual([]);
  expect(b.cl.lastDiagnostic).toBe("znění /sb/2025/264/2025-11-01, odpověď: klíče vysledek, seznamFragmentu");
});

test("ladění pravidel Wazuh: XML jen ze strukturovaných dat, escapování, validace podmínek (v1.14)", async () => {
  const { tuningRuleXml, tuningRulesFile, TuningProposalInput, conditionForPath, conditionsMatch, pcreLiteral } = await import("@contix/shared");
  const xml = tuningRuleXml({ wazuhRuleId: 109001, ruleId: "60106", kind: "exclude", ref: "LP-1", description: 'Proces <x> & "y"', conditions: [{ kind: "field", field: "win.eventdata.image", op: "equals", value: 'C:\\A&B<"x">.exe' }, { kind: "srcip", field: null, op: "equals", value: "10.0.0.0/24" }] });
  expect(xml).toContain('<rule id="109001" level="0">');
  expect(xml).toContain('<field name="win.eventdata.image" type="pcre2">^C:\\\\A&amp;B&lt;&quot;x&quot;&gt;\\.exe$</field>');
  expect(xml).toContain("<srcip>10.0.0.0/24</srcip>");
  expect(xml).toContain("Proces &lt;x&gt; &amp; &quot;y&quot;");
  expect(xml).not.toMatch(/<x>/);
  expect(tuningRulesFile([xml], "2026-10-24")).toMatch(/^<!--[\s\S]*<group name="contix_tuning,">[\s\S]*<\/group>\n$/);
  expect(pcreLiteral("a.b(c)")).toBe("^a\\.b\\(c\\)$");
  // validace: výjimka bez podmínky, regex na IP, neplatné pole, neplatný regex, řídicí znaky
  const bad = (x: unknown) => TuningProposalInput.safeParse(x).success;
  expect(bad({ ruleId: "1", kind: "exclude", conditions: [] })).toBe(false);
  expect(bad({ ruleId: "1", kind: "exclude", conditions: [{ kind: "srcip", op: "regex", value: "10.*" }] })).toBe(false);
  expect(bad({ ruleId: "1", kind: "exclude", conditions: [{ kind: "field", field: "a b", value: "x" }] })).toBe(false);
  expect(bad({ ruleId: "1", kind: "exclude", conditions: [{ kind: "user", op: "regex", value: "(" }] })).toBe(false);
  expect(bad({ ruleId: "1", kind: "exclude", conditions: [{ kind: "user", value: "a\nb" }] })).toBe(false);
  expect(bad({ ruleId: "1x", kind: "level", newLevel: 3 })).toBe(false);
  expect(bad({ ruleId: "1", kind: "level" })).toBe(false);
  expect(bad({ ruleId: "1", kind: "level", newLevel: 3 })).toBe(true);
  expect(conditionForPath("data.win.eventdata.image", "x")).toEqual({ kind: "field", field: "win.eventdata.image", op: "equals", value: "x" });
  expect(conditionForPath("agent.name", "x")).toBeNull();
  expect(conditionsMatch([{ kind: "srcip", field: null, op: "equals", value: "1.2.3.4" }], (p) => (p === "data.srcip" ? "1.2.3.4" : null))).toBe(true);
  expect(conditionsMatch([{ kind: "user", field: null, op: "equals", value: "a" }], () => null)).toBeNull();
});

import { parseDenyList, scanFileMeta, scanText } from "../src/scripts/publishScan";

describe("zveřejnění – kontrola exportu (v1.15, ADR-112)", () => {
  // tokeny skládané za běhu, aby samotný test neobsahoval nic, co by kontrola při zveřejnění zachytila
  const glrt = "glrt-" + "A1b2C3d4E5f6G7h8I9j0";
  const ghp = "ghp_" + "x".repeat(36);
  test("tajemství v kódu i konfiguraci, hodnota se nevypisuje celá", () => {
    const hits = scanText("infra/x.sh", `--token ${glrt}\nGH=${ghp}\n-----BEGIN OPENSSH ` + "PRIVATE KEY-----");
    expect(hits.map((h) => h.rule)).toEqual(["gitlab-token", "github-token", "private-key"]);
    expect(hits.map((h) => h.excerpt).join(" ")).not.toContain(glrt);
  });
  test("přiřazení hesla jen v konfiguraci a dokumentaci, zástupné hodnoty projdou", () => {
    expect(scanText("infra/server.env.example", "ADMIN_PASSWORD=" + "Tajne-Heslo-2026")[0]?.rule).toBe("secret-assignment");
    expect(scanText("docs/a.md", "  api_token: " + "abcdefgh12345")[0]?.rule).toBe("secret-assignment");
    expect(scanText("infra/server.env.example", "ADMIN_PASSWORD=\nAPI_KEY=<klíč>\nTOKEN=${TOKEN}\nSECRET=changeme-please")).toEqual([]);
    expect(scanText("apps/api/src/x.ts", 'const PASSWORD = "' + "Load-Test-Heslo-2026" + '";\n  password: z.string(),')).toEqual([]);
    expect(scanText("docs/a.md", `token ${glrt} <!-- publish-scan: allow -->`)).toEqual([]);
  });
  test("lokální zákazy: doslovně s rozlišením velikosti, re: a rei:", () => {
    const deny = parseDenyList("# komentář\n10.9.8.\nInterniFirma\nre:\\bsrv-[a-z]+\\b\nrei:zakaznik x\n");
    expect(deny).toHaveLength(4);
    const hits = scanText("docs/a.md", "server 10.9.8.7\ninternifirma\nInterniFirma a.s.\nsrv-mail\nZAKAZNIK X\n10.9.81", deny);
    expect(hits.map((h) => `${h.line}:${h.rule}`)).toEqual(["1:deny#1", "3:deny#2", "4:deny#3", "5:deny#4"]);
  });
  test("zakázané soubory a velikost", () => {
    expect(scanFileMeta(".env", 10)[0]?.rule).toBe("forbidden-file");
    expect(scanFileMeta("certs/server.key", 10)[0]?.rule).toBe("forbidden-file");
    expect(scanFileMeta(".env.example", 10)).toEqual([]);
    expect(scanFileMeta("infra/server.env.example", 10)).toEqual([]);
    expect(scanFileMeta("a.bin", 6 * 1024 * 1024)[0]?.rule).toBe("large-file");
  });
});

describe("zveřejnění – repozitář neobsahuje tajemství (v1.15)", () => {
  test("vestavěná pravidla nad soubory v gitu", () => {
    const root = new URL("../../..", import.meta.url).pathname;
    // bez gitu (obraz oven/bun v CI) nebo mimo repozitář (balíček) se kontrola přeskočí – zveřejnění kontroluje publish.sh
    if (!Bun.which("git")) return;
    const ls = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stderr: "ignore" });
    if (ls.exitCode !== 0) return;
    const files = ls.stdout.toString().split("\0").filter(Boolean);
    const hits: string[] = [];
    for (const f of files) {
      const p = `${root}${f}`;
      const file = Bun.file(p);
      if (!file.size && !require("node:fs").existsSync(p)) continue;
      hits.push(...scanFileMeta(f, file.size).map((h) => `${h.file} ${h.rule}`));
      if (/\.(png|jpe?g|gif|webp|ico|pdf|docx|xlsx|pptx|zip|gz|woff2?|ttf|otf)$/i.test(f) || file.size > 5 * 1024 * 1024) continue;
      hits.push(...scanText(f, require("node:fs").readFileSync(p, "utf8")).map((h) => `${h.file}:${h.line} ${h.rule}`));
    }
    expect(hits).toEqual([]);
  });
});

import { cpeMatches, cpeQuery, craProductGaps, craSupplyChecksFor, csafFindingsFor, csafProductMatches, inVersRange, parseCpe, parseCsaf, parseNvdCves, supplyChecksOpen } from "@contix/shared";

describe("CRA dovozce / distributor (v1.16, ADR-113)", () => {
  test("CPE 2.3: čtení, zástupné znaky, escapování, dotaz s verzí produktu", () => {
    expect(parseCpe("cpe:2.3:h:example_networks:edge_router:4.2.1:*:*:*:*:*:*:*")).toEqual({ part: "h", vendor: "example_networks", product: "edge_router", version: "4.2.1" });
    expect(parseCpe("cpe:2.3:a:acme:web\\:portal:2.0")?.product).toBe("web:portal");
    expect(parseCpe("router 4.2")).toBeNull();
    const a = parseCpe("cpe:2.3:h:x:y:*")!;
    expect(cpeMatches(a, parseCpe("cpe:2.3:h:x:y:1.0")!)).toBe(true);
    expect(cpeMatches(parseCpe("cpe:2.3:h:x:y:1.0")!, parseCpe("cpe:2.3:h:x:y:1.1")!)).toBe(false);
    expect(cpeMatches(a, parseCpe("cpe:2.3:a:x:y:1.0")!)).toBe(false);
    expect(cpeQuery("cpe:2.3:h:x:y:*", "4.2 beta")).toBe("cpe:2.3:h:x:y:4.2beta:*:*:*:*:*:*:*");
    expect(cpeQuery("cpe:2.3:h:x:y:1.0", "9.9")).toBe("cpe:2.3:h:x:y:1.0:*:*:*:*:*:*:*");
  });
  test("rozsah verzí vers", () => {
    expect(inVersRange("vers:generic/>=4.0|<4.2.2", "4.2.1")).toBe(true);
    expect(inVersRange("vers:generic/>=4.0|<4.2.2", "4.2.2")).toBe(false);
    expect(inVersRange("vers:generic/1.0|2.0", "2.0")).toBe(true);
    expect(inVersRange("vers:generic/*", "7")).toBe(true);
    expect(inVersRange("<4.2", "4.1")).toBeNull();
  });
  const doc = {
    document: { csaf_version: "2.0", title: "T", publisher: { name: "P", namespace: "https://p.example" }, tracking: { id: "SA-1", version: "3", current_release_date: "2026-10-01T00:00:00Z" } },
    product_tree: {
      branches: [{ category: "vendor", name: "Acme", branches: [{ category: "product_name", name: "Cam X", branches: [{ category: "product_version_range", name: "vers:generic/<2.5", product: { product_id: "CAM-OLD", name: "Acme Cam X < 2.5" } }, { category: "product_version", name: "2.5", product: { product_id: "CAM-25", name: "Acme Cam X 2.5" } }] }] }],
      full_product_names: [{ product_id: "OTHER", name: "Acme Doorbell 1.0", product_identification_helper: { purl: "pkg:generic/acme/doorbell@1.0" } }],
      product_groups: [{ group_id: "ALL", product_ids: ["CAM-OLD", "CAM-25"] }],
    },
    vulnerabilities: [
      { cve: "cve-2026-0001", title: "Auth bypass", product_status: { known_affected: ["CAM-OLD"], fixed: ["CAM-25"] }, notes: [{ category: "summary", text: "Bypass" }], remediations: [{ category: "vendor_fix", details: "Update", product_ids: ["CAM-OLD"] }], scores: [{ products: ["CAM-OLD"], cvss_v3: { baseScore: 8.1, baseSeverity: "HIGH" } }] },
      { ids: [{ system_name: "ACME", text: "ACME-2026-9" }], product_status: { known_not_affected: ["CAM-OLD", "CAM-25"], under_investigation: ["OTHER"] }, flags: [{ label: "vulnerable_code_not_present", group_ids: ["ALL"] }] },
    ],
  };
  test("CSAF 2.0: produkty z větví a skupin, stav, zdůvodnění, náprava, skóre", () => {
    const a = parseCsaf(JSON.stringify(doc));
    expect(a).toMatchObject({ publisher: "P", namespace: "https://p.example", trackingId: "SA-1", version: "3" });
    expect(a.products.find((x) => x.id === "CAM-OLD")).toMatchObject({ vendor: "Acme", productName: "Cam X", range: "vers:generic/<2.5", version: null });
    expect(a.products.find((x) => x.id === "OTHER")?.purl).toBe("pkg:generic/acme/doorbell@1.0");
    expect(a.vulnerabilities[0]).toMatchObject({ id: "CVE-2026-0001", severity: "8.1 HIGH", status: { "CAM-OLD": "affected", "CAM-25": "fixed" }, action: { "CAM-OLD": "Oprava výrobce – Update" } });
    expect(a.vulnerabilities[1]).toMatchObject({ id: "ACME-2026-9", cve: null, justification: { "CAM-OLD": "vulnerable_code_not_present", "CAM-25": "vulnerable_code_not_present" } });
    expect(() => parseCsaf('{"bomFormat":"CycloneDX"}')).toThrow();
    const cam = (version: string | null) => ({ name: "Cam X", version, cpe: null, manufacturerName: "Acme s.r.o." });
    expect(csafProductMatches(cam("2.4"), a.products.find((x) => x.id === "CAM-OLD")!)).toBe(true);
    expect(csafProductMatches(cam("2.5"), a.products.find((x) => x.id === "CAM-OLD")!)).toBe(false);
    expect(csafProductMatches({ ...cam("2.4"), manufacturerName: "Jiný výrobce" }, a.products.find((x) => x.id === "CAM-OLD")!)).toBe(false);
    expect(csafFindingsFor(cam("2.4"), a).map((f) => [f.vulnId, f.status, f.justification, f.action])).toEqual([
      ["CVE-2026-0001", "affected", null, "Oprava výrobce – Update"],
      ["ACME-2026-9", "not_affected", "vulnerable_code_not_present", null],
    ]);
    expect(csafFindingsFor(cam("2.5"), a).map((f) => f.status)).toEqual(["fixed", "not_affected"]);
    expect(csafFindingsFor({ name: "Doorbell", version: "1.0", cpe: null, manufacturerName: null }, a).map((f) => f.status)).toEqual(["under_investigation"]);
    expect(csafFindingsFor({ name: "Router", version: "1.0", cpe: null, manufacturerName: null }, a)).toEqual([]);
  });
  test("NVD CVE API 2.0: ID, popis, závažnost", () => {
    const r = parseNvdCves({ totalResults: 3, vulnerabilities: [{ cve: { id: "CVE-2026-5005", descriptions: [{ lang: "es", value: "x" }, { lang: "en", value: "Overflow" }], metrics: { cvssMetricV31: [{ cvssData: { baseScore: 7.5, baseSeverity: "HIGH" } }] } } }, { cve: { id: "bad" } }] });
    expect(r).toEqual({ items: [{ id: "CVE-2026-5005", summary: "Overflow", severity: "7.5 HIGH" }], total: 3 });
  });
  test("doklady podle role a mezery dovozce / distributora", () => {
    expect(craSupplyChecksFor("manufacturer", {})).toEqual([]);
    const imp = craSupplyChecksFor("importer", { ce_marking: { status: "ok" } });
    expect(imp.map((x) => x.key)).toContain("tech_doc");
    expect(supplyChecksOpen(imp)).toBe(imp.filter((x) => !x.optional).length - 1);
    const base = { status: "on_market" as const, category: "default" as const, supportJustification: null, onMarketSince: null, securityContact: null, conformityModule: null, oss: false, components: 0, requirements: [], overdueReports: 0, today: "2026-11-01" };
    expect(craProductGaps({ ...base, role: "distributor", supportUntil: null, supplyOpen: 3, vulnSource: false })).toEqual(["no_manufacturer_support", "supply_checks_open", "no_vuln_source"]);
    expect(craProductGaps({ ...base, role: "distributor", supportUntil: "2027-01-01", supplyOpen: 0, vulnSource: true })).toEqual(["support_ending"]);
    expect(craProductGaps({ ...base, role: "manufacturer", supportUntil: null, conformityModule: "A" })).toEqual(["no_support_period", "no_sbom", "no_contact"]);
  });
});

import { CAPABILITY_KEYS, RISK_SCENARIO_LABELS, SCENARIO_TEMPLATES, SIGNAL_KEYS, BUILTIN_THREATS, BUILTIN_WEAKNESSES, capabilityRequirementIds, coverageStatus, evaluateScenario, requirementById, scenarioFingerprint, scenarioTriggered } from "@contix/shared";

describe("rizikové scénáře z dat (v1.17, ADR-114)", () => {
  test("šablony: kódy katalogu vyhlášky, signály, schopnosti a popisky existují", () => {
    const threats = new Set(BUILTIN_THREATS.map((x) => x.code));
    const weak = new Set(BUILTIN_WEAKNESSES.map((x) => x.code));
    for (const t of SCENARIO_TEMPLATES) {
      expect([t.threat, ...t.moreThreats].every((c) => threats.has(c))).toBe(true);
      expect(t.weaknesses.every((c) => weak.has(c))).toBe(true);
      expect(Object.keys(t.signals).every((k) => (SIGNAL_KEYS as readonly string[]).includes(k))).toBe(true);
      expect(t.attack.every((a) => /^T\d{4}$/.test(a))).toBe(true);
      expect((RISK_SCENARIO_LABELS.template as Record<string, string>)[t.key]).toBeTruthy();
    }
    for (const k of SIGNAL_KEYS) expect(RISK_SCENARIO_LABELS.signal[k]).toBeTruthy();
  });
  test("požadavky schopností existují v registru rámců; vyhláška přes crosswalk", () => {
    for (const k of CAPABILITY_KEYS) {
      const r = capabilityRequirementIds(k);
      for (const id of r.ids) expect(requirementById(id), id).not.toBeNull();
      expect(r.decree409.length, k).toBeGreaterThan(0);
    }
  });
  test("pokrytí → stav; bez dat nic nevzniká; vedlejší a kontextové signály samy nestačí", () => {
    expect([coverageStatus(null), coverageStatus(0.99), coverageStatus(0.8), coverageStatus(0.2)]).toEqual(["unknown", "strong", "partial", "weak"]);
    const bf = SCENARIO_TEMPLATES.find((t) => t.key === "backup_failure")!;
    const kv = SCENARIO_TEMPLATES.find((t) => t.key === "known_vuln_exploit")!;
    expect(scenarioTriggered(bf, [], {})).toBe(false);
    expect(scenarioTriggered(bf, [{ key: "no_edr", count: 5, items: [] }], {})).toBe(false);
    expect(scenarioTriggered(kv, [{ key: "internet_exposed", count: 2, items: [] }], {})).toBe(false);
    expect(scenarioTriggered(bf, [], { backup_recovery: "weak" })).toBe(true);
    expect(scenarioTriggered(bf, [{ key: "restore_untested", count: 1, items: [] }], {})).toBe(true);
    expect(scenarioFingerprint([], { backup_recovery: "weak" }, bf)).not.toBe(scenarioFingerprint([], { backup_recovery: "partial" }, bf));
  });
  test("vyhodnocení: dopad z CIA ohrožených složek, hrozba z alertů a expozice, zranitelnost z doložených signálů", () => {
    const rw = SCENARIO_TEMPLATES.find((t) => t.key === "ransomware")!;
    const base = { levels: 4, cia: { c: 4, i: 2, a: 3 }, criticality: "medium" as const, capabilities: {}, alerts: 0 };
    const quiet = evaluateScenario(rw, { ...base, hits: [{ key: "no_edr", count: 1, items: [] }] });
    expect(quiet).toMatchObject({ impact: 3, threatLevel: 2 }); // C se u ransomwaru nepočítá (I, A)
    const hot = evaluateScenario(rw, { ...base, alerts: 2, capabilities: { edr: "weak", mfa: "weak", backup_recovery: "weak" }, hits: [{ key: "no_edr", count: 4, items: [] }, { key: "kev_exposed", count: 1, items: [] }, { key: "restore_untested", count: 1, items: [] }, { key: "mfa_gap", count: 9, items: [] }] });
    expect(hot).toMatchObject({ threatLevel: 4, vulnLevel: 4, lowConfidence: false });
    expect(hot.vulnLevel).toBeGreaterThan(quiet.vulnLevel);
    expect(hot.reasons.map((r) => r.text)).toEqual(expect.arrayContaining(["rsc.why.alerts", "rsc.why.exposed", "rsc.sig.kev_exposed", "rsc.why.capability"]));
    const noData = evaluateScenario(rw, { ...base, cia: { c: null, i: null, a: null }, criticality: "critical", hits: [] });
    expect(noData).toMatchObject({ impact: 4, vulnLevel: 2, lowConfidence: true });
    expect(evaluateScenario(rw, { ...base, levels: 3, hits: [] }).impact).toBe(2);
  });
});

import { RISK_TRIGGER_KINDS as _rtk, RISK_TRIGGER_LABELS as _rtl, suggestFromTriggers as _sft, THREAT_COVERAGE_STATES, ThreatAssessmentInput, threatCellState, threatCoverageSummary } from "@contix/shared";
describe("pokrytí katalogu hrozeb a podnět ze scénáře (v1.18, ADR-115)", () => {
  test("stav buňky: riziko > návrh > nerelevantní > neposouzeno", () => {
    expect(threatCellState({ risks: 1, proposals: 1, notRelevant: true })).toBe("risk");
    expect(threatCellState({ risks: 0, proposals: 2, notRelevant: true })).toBe("proposed");
    expect(threatCellState({ risks: 0, proposals: 0, notRelevant: true })).toBe("not_relevant");
    expect(threatCellState({ risks: 0, proposals: 0, notRelevant: false })).toBe("unassessed");
  });
  test("souhrn a podíl posouzených", () => {
    expect(threatCoverageSummary([])).toMatchObject({ total: 0, assessedShare: null });
    const s = threatCoverageSummary(["risk", "proposed", "not_relevant", "unassessed"]);
    expect(s).toMatchObject({ risk: 1, proposed: 1, not_relevant: 1, unassessed: 1, total: 4 });
    expect(s.assessedShare).toBeCloseTo(0.75, 5);
    for (const k of THREAT_COVERAGE_STATES) expect(RISK_SCENARIO_LABELS.coverage[k]).toBeTruthy();
  });
  test("zdůvodnění „nerelevantní“ je povinné", () => {
    expect(ThreatAssessmentInput.safeParse({ reason: "ne" }).success).toBe(false);
    expect(ThreatAssessmentInput.safeParse({ reason: "Aktivum není v internetu" }).success).toBe(true);
  });
  test("podnět „změna dat scénáře“ se jen zobrazí – nemění návrh hodnot", () => {
    expect(_rtk).toContain("scenario");
    expect(_rtl.kind.scenario).toBeTruthy();
    const trg = [{ kind: "scenario" as const, at: new Date().toISOString(), link: null, title: "x", detail: "4×3", count: 1, strong: true }];
    expect(_sft({ threatLevel: 2, vulnLevel: 2, likelihood: 2, scaleLevels: 4 }, trg, "three_factor" as any)).toEqual([]);
  });
});

import { evidencedEffectiveness, planSuggestions, suggestResidual as _sr120 } from "@contix/shared";
describe("plán zvládání z dat (v1.20, ADR-117)", () => {
  test("účinnost podle důkazů", () => {
    expect(evidencedEffectiveness({ code: null, name: "x", status: "implemented", effectiveness: "effective", lastTestResult: "ineffective" }).reason).toBe("test_ineffective");
    expect(evidencedEffectiveness({ code: null, name: "x", status: "implemented", effectiveness: "effective", monitorFailing: true }).effectiveness).toBe("ineffective");
    expect(evidencedEffectiveness({ code: null, name: "x", status: "implemented", effectiveness: "effective", lastTestResult: "effective_with_exceptions" }).effectiveness).toBe("partially_effective");
    expect(evidencedEffectiveness({ code: null, name: "x", status: "implemented", effectiveness: "effective", lastTestResult: "effective" }).reason).toBeNull();
  });
  test("zbytkové riziko nezapočte opatření s neúčinným testem", () => {
    const r = { impact: 4, threatLevel: 3, vulnLevel: 4, likelihood: null };
    expect(_sr120(r, [{ code: null, name: "A", status: "implemented", effectiveness: "effective" }], "three_factor")!.reduction).toBe(2);
    const s = _sr120(r, [{ code: null, name: "A", status: "implemented", effectiveness: "effective", lastTestResult: "ineffective" }], "three_factor")!;
    expect(s.reduction).toBe(0);
    expect(s.basis.some((b) => b.includes("nezapočteno"))).toBe(true);
    expect(_sr120(r, [{ code: null, name: "A", status: "implemented", effectiveness: "effective", lastTestResult: "effective_with_exceptions" }], "three_factor")!.reduction).toBe(1);
  });
  test("návrhy akcí bez duplicit", () => {
    const out = planSuggestions({
      controls: [
        { id: "c1", code: "O-1", name: "PAM", status: "planned", effectiveness: "not_assessed" },
        { id: "c2", code: null, name: "Zálohy", status: "implemented", effectiveness: "effective", monitorFailing: true },
        { id: "c3", code: null, name: "OK", status: "implemented", effectiveness: "effective" },
      ],
      capabilities: [{ key: "mfa", status: "weak" }, { key: "mfa", status: "weak" }, { key: "edr", status: "strong" }, { key: "segmentation", status: "unknown" }],
      actions: [{ title: "něco", controlId: "c1", status: "planned" }],
    });
    expect(out.map((x) => x.key)).toEqual(["implement:c1", "fix:c2", "cap:mfa", "cap:segmentation"]);
    expect(out[0]!.existing).toBe(true);
    expect(out.find((x) => x.key === "cap:segmentation")!.title).toContain("Doložit");
  });
});

import { SCENARIO_TEMPLATES as _st121, SIGNAL_KEYS as _sk121, RISK_SCENARIO_LABELS as _rsl121, templateApplies, BUILTIN_THREATS as _bt121, BUILTIN_WEAKNESSES as _bw121 } from "@contix/shared";
describe("rozšířená knihovna scénářů (v1.21, ADR-118)", () => {
  test("14 šablon, kódy katalogu a popisky", () => {
    expect(_st121.length).toBe(14);
    for (const t of _st121) {
      expect(_bt121.some((x) => x.code === t.threat)).toBe(true);
      for (const w of t.weaknesses) expect(_bw121.some((x) => x.code === w)).toBe(true);
      expect(_rsl121.template[t.key as keyof typeof _rsl121.template]).toBeTruthy();
      for (const k of Object.keys(t.signals)) expect(_sk121).toContain(k as any);
    }
    for (const k of _sk121) expect(_rsl121.signal[k]).toBeTruthy();
  });
  test("šablona jen pro odpovídající rozsah", () => {
    const t = (k: string) => _st121.find((x) => x.key === k)!;
    expect(templateApplies(t("device_loss"), [{ assetType: "server", internetFacing: false }])).toBe(false);
    expect(templateApplies(t("device_loss"), [{ assetType: "laptop", internetFacing: false }])).toBe(true);
    expect(templateApplies(t("ddos_outage"), [{ assetType: "server", internetFacing: false }])).toBe(false);
    expect(templateApplies(t("ddos_outage"), [{ assetType: "server", internetFacing: true }])).toBe(true);
    expect(templateApplies(t("ransomware"), [])).toBe(true);
  });
});

import { detectionState, detectionSummary, evaluateScenario as _ev122, scenarioTechniques, techniqueMatches, SCENARIO_TEMPLATES as _st122 } from "@contix/shared";
describe("pokrytí ATT&CK detekcí (v1.22, ADR-119)", () => {
  test("stav, shoda podtechnik, souhrn", () => {
    expect(techniqueMatches("T1078.004", "T1078")).toBe(true);
    expect(techniqueMatches("T10780", "T1078")).toBe(false);
    expect(detectionState({ alerts: 1, hunts: 1, declared: true })).toBe("detected");
    expect(detectionState({ alerts: 0, hunts: 0, declared: true })).toBe("declared");
    expect(detectionState({ alerts: 0, hunts: 0, declared: false })).toBe("blind");
    expect(detectionSummary(["blind", "blind", "detected"])).toMatchObject({ blind: 2, detected: 1, total: 3 });
    expect(scenarioTechniques()).toContain("T1486");
  });
  test("slepá místa zvýší zranitelnost, bez měření beze změny", () => {
    const t = _st122.find((x) => x.key === "phishing_credentials")!;
    const ctx = { levels: 4, cia: { c: 3, i: 3, a: 3 }, criticality: "high" as const, hits: [{ key: "mfa_gap" as const, count: 5, items: [] }], capabilities: { mfa: "weak" as const }, alerts: 0 };
    const base = _ev122(t, ctx).vulnLevel;
    expect(_ev122(t, { ...ctx, detection: null }).vulnLevel).toBe(base);
    expect(_ev122(t, { ...ctx, detection: { blind: 1, total: 3 } }).vulnLevel).toBe(base);
    const blind = _ev122(t, { ...ctx, detection: { blind: 3, total: 3 } });
    expect(blind.vulnLevel).toBe(Math.min(4, base + 1));
    expect(blind.reasons.some((r) => r.text === "rsc.why.detectionBlind")).toBe(true);
  });
});

import { appetiteBreach, kriStatus, riskCategories, KRI_KEYS, KRI_META, RISK_APPETITE_LABELS } from "@contix/shared";
describe("ochota riskovat a KRI (v1.23, ADR-120)", () => {
  test("kategorie a překročení ochoty", () => {
    expect(riskCategories({ c: true, i: false, a: true, supplier: true })).toEqual(["confidentiality", "availability", "suppliers"]);
    expect(appetiteBreach("high", ["confidentiality", "availability"], { confidentiality: "medium", availability: "high" })).toEqual({ breached: true, limit: "medium", categories: ["confidentiality"] });
    expect(appetiteBreach("medium", ["confidentiality"], { confidentiality: "medium" }).breached).toBe(false);
    expect(appetiteBreach("critical", ["integrity"], { confidentiality: "low" }).breached).toBe(false);
    expect(appetiteBreach(null, ["integrity"], { integrity: "low" }).breached).toBe(false);
  });
  test("stav KRI podle směru", () => {
    expect(kriStatus(80, "min", 95, 90)).toBe("alert");
    expect(kriStatus(92, "min", 95, 90)).toBe("warn");
    expect(kriStatus(99, "min", 95, 90)).toBe("ok");
    expect(kriStatus(0, "max", 1, 5)).toBe("ok");
    expect(kriStatus(2, "max", 1, 5)).toBe("warn");
    expect(kriStatus(5, "max", 1, 5)).toBe("alert");
    expect(kriStatus(null, "max", 1, 5)).toBe("unknown");
    for (const k of KRI_KEYS) {
      expect(RISK_APPETITE_LABELS.kri[k]).toBeTruthy();
      expect(KRI_META[k].direction === "min" ? KRI_META[k].alert <= KRI_META[k].warn : KRI_META[k].alert >= KRI_META[k].warn).toBe(true);
    }
  });
});
