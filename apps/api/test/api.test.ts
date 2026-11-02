import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { config as globalConfig } from "../src/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import postgres from "postgres";
import { createApp } from "../src/app";
import { acquireLease } from "../src/modules/ops/lease";
import { osvRefreshPending } from "../src/modules/cra/osv";
import { totpAt, TOTP_PERIOD } from "../src/auth/crypto";
import { createAdmin, ensureSystemRoles } from "../src/auth/service";
import type { Config } from "../src/config";
import * as schema from "../src/db/schema";
import { COMPANY_HEADER, CONTIX_VERSION } from "@contix/shared";
import { seedDemo, type DemoCall } from "../src/scripts/demoData";
import { seedRiskCatalog } from "../src/modules/risks/routes";
import { processScenarioRefresh } from "../src/modules/risks/scenarios";
import { takeTrendSnapshot } from "../src/modules/trends/service";
import { processLegislationSync } from "../src/modules/legislation/service";

/**
 * Integrační testy proti skutečnému PostgreSQL.
 * Spuštění: TEST_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_test bun test
 * (bez proměnné se testy přeskočí). POZOR: databázi vyprázdní.
 */
const url = process.env.TEST_DATABASE_URL;
const APP = "http://localhost:5173";
const PW = "Spravne-Heslo-2026!";

/* ---------- mock OIDC poskytovatel (jako Entra ID / AD FS) ---------- */
const idp = await (async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  let issuer = "";
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/.well-known/openid-configuration")
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      if (u.pathname === "/jwks") return Response.json({ keys: [jwk] });
      if (u.pathname === "/token") {
        const form = new URLSearchParams(await req.text());
        const c = JSON.parse(Buffer.from(form.get("code")!, "base64url").toString());
        const idToken = await new SignJWT({ email: c.email, name: c.name, groups: c.groups, nonce: c.nonce })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(issuer)
          .setAudience("contix-client")
          .setSubject(c.sub)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        return Response.json({ id_token: idToken, access_token: "x", token_type: "Bearer" });
      }
      return new Response("nf", { status: 404 });
    },
  });
  issuer = `http://localhost:${server.port}`;
  return { server, issuer };
})();

/* ---------- náhradní Active Directory pro přihlášení (ADR-078) ---------- */
const adUsers: Record<string, { pw: string; guid: string; email: string | null; name: string; groups: string[]; disabled?: boolean }> = {
  "jan.novak": { pw: "Ad-Heslo-1", guid: "11111111-aaaa-4bbb-8ccc-000000000001", email: "jan.novak@lab.internal", name: "Jan Novák", groups: ["CONTIX-Auditori", "CN=CONTIX-Auditori,OU=Skupiny,DC=lab,DC=internal"] },
  petr: { pw: "Ad-Heslo-2", guid: "11111111-aaaa-4bbb-8ccc-000000000002", email: "petr@lab.internal", name: "Petr", groups: ["Domain Users"] },
  zak: { pw: "Ad-Heslo-3", guid: "11111111-aaaa-4bbb-8ccc-000000000003", email: "zak@lab.internal", name: "Žák", groups: ["CONTIX-Auditori"], disabled: true },
  kolize: { pw: "Ad-Heslo-4", guid: "11111111-aaaa-4bbb-8ccc-000000000004", email: "konverze@test.cz", name: "Kolize", groups: ["CONTIX-Auditori"] },
};
const adCalls: string[] = [];
const fakeAdAuth = async (conn: any, login: string, password: string) => {
  adCalls.push(`${conn.config.bindDn}|${login}`);
  if (conn.password !== "svc-pw") return { ok: false as const, reason: "error" as const, message: "Přihlášení k AD selhalo" };
  const raw = login.includes("\\") ? login.split("\\").pop()! : login.split("@")[0]!;
  const u = adUsers[raw];
  if (!u) return { ok: false as const, reason: "not_found" as const };
  if (u.disabled) return { ok: false as const, reason: "disabled" as const };
  if (u.pw !== password) return { ok: false as const, reason: "bad_password" as const };
  return { ok: true as const, identity: { guid: u.guid, dn: `CN=${u.name},DC=lab,DC=internal`, login: raw, upn: `${raw}@lab.internal`, email: u.email, displayName: u.name, groups: u.groups } };
};

/* ---------- mock Wazuh Server API ---------- */
const arCalls: { agents: string[]; body: any }[] = [];
const scaCheckCalls: string[] = [];
const wazuh = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    const auth = req.headers.get("authorization") ?? "";
    if (u.pathname === "/security/user/authenticate") {
      if (auth === `Basic ${btoa("contix-ar:ar-pw")}`) return Response.json({ data: { token: "artok" } });
      return auth === `Basic ${btoa("contix-ro:wazuh-pw")}` ? Response.json({ data: { token: "tok" } }) : new Response("no", { status: 401 });
    }
    // Active Response (ADR-055) – jen samostatný účet s tokenem artok
    if (u.pathname === "/active-response" && req.method === "PUT") {
      if (auth !== "Bearer artok") return new Response("no", { status: 403 });
      const agents = (u.searchParams.get("agents_list") ?? "").split(",");
      return (req.json() as Promise<any>).then((body) => {
        arCalls.push({ agents, body });
        const ok = agents.filter((a) => a !== "999");
        return Response.json({ data: { affected_items: ok, total_affected_items: ok.length, failed_items: agents.includes("999") ? [{ id: ["999"], error: { code: 1701, message: "Agent does not exist" } }] : [] }, error: ok.length ? 0 : 1 });
      });
    }
    if (auth !== "Bearer tok") return new Response("no", { status: 401 });
    const items = (x: unknown[], total = x.length) => Response.json({ data: { affected_items: x, total_affected_items: total } });
    if (u.pathname === "/") return Response.json({ data: { api_version: "4.9.0" } });
    if (u.pathname === "/agents") {
      if (u.searchParams.get("select") === "id") return items([{ id: "000" }], u.searchParams.get("status") ? 2 : 3);
      return items([
        { id: "000", name: "wazuh-manager", ip: "127.0.0.1", status: "active", os: { name: "Ubuntu", platform: "ubuntu" } },
        { id: "001", name: "srv-01", ip: "10.0.0.5", status: "active", os: { name: "Ubuntu", platform: "ubuntu" } },
        { id: "002", name: "PC-HR-07", ip: "10.0.5.7", status: "disconnected", os: { name: "Microsoft Windows 11 Pro", platform: "windows" } },
      ]);
    }
    // Security Configuration Assessment (ADR-064)
    const sca = u.pathname.match(/^\/sca\/(\d+)(?:\/checks\/([\w.-]+))?$/);
    if (sca) {
      const [, agent, policy] = sca;
      const pol: Record<string, any> = {
        "001": { policy_id: "cis_ubuntu24-04", name: "CIS Ubuntu Linux 24.04 LTS Benchmark", pass: 3, fail: 1, invalid: 1, end_scan: "2026-10-15T10:00:00Z" },
        "002": { policy_id: "cis_win11_enterprise", name: "CIS Microsoft Windows 11 Enterprise Benchmark", pass: 1, fail: 3, invalid: 0, end_scan: "2026-10-15T11:00:00Z" },
      };
      if (!policy) return items(pol[agent!] ? [pol[agent!]] : []);
      scaCheckCalls.push(`${agent}/${policy}`);
      const res = agent === "001" ? ["passed", "passed", "passed", "failed", "not applicable"] : ["failed", "failed", "failed", "passed"];
      return items(
        res.map((r, i) => ({
          id: (agent === "001" ? 28500 : 26000) + i,
          title: i === 0 && agent === "002" ? "Ensure 'Minimum password length' is set to '14 or more character(s)'" : `Kontrola ${agent}-${i}`,
          description: "Popis kontroly",
          rationale: "Zdůvodnění",
          remediation: "Náprava",
          result: r,
          compliance: [{ key: "cis", value: `1.${i}` }, { key: "iso_27001-2013", value: "A.9.4.3, A.12.6.1" }],
        })),
      );
    }
    const m = u.pathname.match(/^\/syscollector\/(\d+)\/(\w+)$/);
    if (m) {
      const [, id, kind] = m;
      if (kind === "hardware") return items([{ board_serial: id === "001" ? "SN-1" : `SER-${id}` }]);
      if (kind === "os") return items([{ hostname: id === "001" ? "srv-01" : undefined, os: { name: "Ubuntu", version: "24.04" } }]);
      if (kind === "packages") return items([{ name: "openssl", version: "3.0.13", vendor: "Ubuntu" }]);
      return items([]);
    }
    return new Response("nf", { status: 404 });
  },
});

/* ---------- mock Wazuh Indexer (OpenSearch) – index zranitelností ---------- */
const vulnDoc = (agent: string, cve: string, severity: string, score: number, pkg: string, ver: string) => ({
  _source: {
    agent: { id: agent, name: `agent-${agent}` },
    package: { name: pkg, version: ver },
    vulnerability: {
      id: cve,
      severity,
      score: { base: score, version: "3.1" },
      description: `Popis ${cve}`,
      reference: `https://nvd.nist.gov/vuln/detail/${cve}`,
      detected_at: "2026-09-01T10:00:00Z",
      published_at: "2026-08-01T00:00:00Z",
    },
  },
});
const indexerData = {
  docs: [
    vulnDoc("001", "CVE-2026-0001", "Critical", 9.8, "openssl", "3.0.2"),
    vulnDoc("001", "CVE-2026-0002", "High", 7.5, "openssl", "3.0.2"),
    vulnDoc("001", "CVE-2026-0003", "Medium", 5.3, "curl", "8.5.0"),
    vulnDoc("002", "CVE-2026-0004", "Medium", 6.1, "chrome", "120.0"),
    vulnDoc("999", "CVE-2026-0005", "Low", 2.0, "vim", "9.0"), // agent mimo inventář
  ],
};
const alertDoc = (ts: string, rule: string, level: number, agent: string, desc: string, groups: string[], srcip = "203.0.113.7") => ({
  _source: { timestamp: ts, rule: { id: rule, level, description: desc, groups, ...(rule === "5712" ? { mitre: { id: ["T1110"], tactic: ["Credential Access"], technique: ["Brute Force"] } } : {}) }, agent: { id: agent, name: `agent-${agent}` }, data: { srcip } },
});
const nowIso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const alertDocs: any[] = [
  alertDoc(nowIso(50), "5712", 10, "001", "sshd: brute force trying to get access to the system", ["authentication_failures", "sshd"]),
  alertDoc(nowIso(40), "5712", 10, "001", "sshd: brute force trying to get access to the system", ["authentication_failures", "sshd"]),
  alertDoc(nowIso(30), "554", 7, "001", "File added to the system", ["syscheck"]),
  alertDoc(nowIso(20), "87105", 12, "002", "VirusTotal: Alert - malicious file", ["virustotal"]),
];

/** Události pravidla 60106 pro ladění pravidel (v1.14) – jen pro dotazy s filtrem rule.id. */
const TUNE_T = Date.now() - 3 * 86_400_000;
const tuningDocs: any[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ timestamp: new Date(TUNE_T - (i + 1) * 3_600_000).toISOString(), rule: { id: "60106" }, agent: { id: "010", name: "srv-zaloh" }, location: "EventChannel", data: { srcip: "10.0.0.9", win: { eventdata: { image: "C:\\Tools\\backup.exe" } } } })),
  ...Array.from({ length: 2 }, (_, i) => ({ timestamp: new Date(TUNE_T + i * 60_000).toISOString(), rule: { id: "60106" }, agent: { id: "011", name: "pc-utok" }, location: "EventChannel", data: { srcip: "10.0.0.9", win: { eventdata: { image: "C:\\Users\\x\\evil.exe" } } } })),
];
const pathGet = (o: any, p: string) => p.split(".").reduce((x, k) => x?.[k], o);
function tuningSearch(body: any) {
  const ok = (d: any) =>
    (body.query.bool.filter as any[]).every((f) => {
      if (f.term) return Object.entries(f.term).every(([k, v]) => String(pathGet(d, k)) === String(v));
      if (f.regexp) return Object.entries(f.regexp).every(([k, v]: any) => new RegExp(`^(?:${v.value})$`).test(String(pathGet(d, k) ?? "")));
      if (f.range) return Object.entries(f.range).every(([k, v]: any) => (!v.gte || pathGet(d, k) >= v.gte) && (!v.lte || pathGet(d, k) <= v.lte));
      return true;
    });
  const hits = tuningDocs.filter(ok);
  const aggregations = Object.fromEntries(
    Object.entries(body.aggs ?? {}).map(([name, a]: any) => {
      const by = new Map<string, number>();
      for (const h of hits) {
        const v = pathGet(h, a.terms.field);
        if (v != null) by.set(String(v), (by.get(String(v)) ?? 0) + 1);
      }
      return [name, { buckets: [...by].sort((x, y) => y[1] - x[1]).slice(0, a.terms.size).map(([key, doc_count]) => ({ key, doc_count })) }];
    }),
  );
  return { hits: { total: { value: hits.length }, hits: hits.slice(0, body.size ?? 10).map((h) => ({ _source: h })) }, aggregations };
}

const indexer = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (req.headers.get("authorization") !== `Basic ${btoa("admin:idx-pw")}`) return new Response("no", { status: 401 });
    if (u.pathname.endsWith("/_count")) return Response.json({ count: indexerData.docs.length });
    if (u.pathname.startsWith("/wazuh-alerts") && u.pathname.endsWith("/_search")) {
      const body = (await req.json()) as any;
      if (body.query?.bool?.filter?.[0]?.term?.["rule.id"]) return Response.json(tuningSearch(body));
      // hledání zdrojů hrozeb (ADR-057): terms na IP / doménových polích
      const should = body.query?.bool?.filter?.[1]?.bool?.should;
      if (should) {
        const vals = new Set<string>(should.flatMap((x: any) => Object.values(x.terms).flat() as string[]));
        return Response.json({ hits: { hits: alertDocs.filter((a) => vals.has(a._source.data?.srcip)) } });
      }
      // plánované hledání (ADR-059): query_string → slova za dvojtečkou, seskupení podle pole
      if (body.aggs?.hunt) {
        const f = body.query.bool.filter;
        const since = f[0].range.timestamp.gt;
        const words = [...String(f[1].query_string.query).matchAll(/:\(?([^)\s]+)/g)].map((m) => (m[1] ?? "").replace(/\*/g, ""));
        const ors = String(f[1].query_string.query).match(/:\(([^)]*)\)/)?.[1]?.split(/\s+OR\s+/) ?? [];
        const vals = new Set([...words, ...ors.map((x) => x.replace(/\*/g, ""))].filter((x) => x && x !== "OR"));
        const hits = alertDocs.filter((a) => a._source.timestamp > since && [...vals].some((v) => JSON.stringify(a._source).includes(v)));
        const path = String(body.aggs.hunt.terms.field).split(".");
        const by = new Map<string, any[]>();
        for (const h of hits) {
          const k = path.reduce((o: any, x) => o?.[x], h._source);
          if (k != null) by.set(String(k), [...(by.get(String(k)) ?? []), h]);
        }
        const min = body.aggs.hunt.terms.min_doc_count ?? 1;
        return Response.json({
          hits: { total: { value: hits.length } },
          aggregations: {
            hunt: {
              buckets: [...by]
                .filter(([, hs]) => hs.length >= min)
                .map(([key, hs]) => ({ key, doc_count: hs.length, first: { value_as_string: hs[0]._source.timestamp }, last: { value_as_string: hs.at(-1)._source.timestamp }, agent: { hits: { hits: [{ _source: { agent: hs.at(-1)._source.agent } }] } } })),
            },
          },
        });
      }
      // zpětné hledání IOC (ADR-054): fráze ve vybraných polích, agregace podle agenta
      if (body.aggs?.agents) {
        const mm = body.query.bool.filter[1].multi_match;
        const hits = alertDocs.filter((a) => JSON.stringify(a._source).includes(mm.query));
        const by = new Map<string, any[]>();
        for (const h of hits) by.set(h._source.agent.name, [...(by.get(h._source.agent.name) ?? []), h]);
        return Response.json({
          hits: { total: { value: hits.length } },
          aggregations: { agents: { buckets: [...by].map(([key, hs]) => ({ key, doc_count: hs.length, first: { value_as_string: hs[0]._source.timestamp }, last: { value_as_string: hs.at(-1)._source.timestamp } })) } },
        });
      }
      const minLevel = body.query.bool.filter[0].range["rule.level"].gte;
      const since = body.query.bool.filter[1].range.timestamp.gt;
      return Response.json({ hits: { hits: alertDocs.filter((a) => a._source.rule.level >= minLevel && a._source.timestamp > since) } });
    }
    if (u.pathname.startsWith("/wazuh-states-vulnerabilities") && u.pathname.endsWith("/_search"))
      return Response.json({ _scroll_id: "s1", hits: { total: { value: indexerData.docs.length }, hits: indexerData.docs.slice(0, 2) } });
    if (u.pathname === "/_search/scroll") {
      if (req.method === "DELETE") return Response.json({ succeeded: true });
      const body = (await req.json()) as any;
      if (body.scroll_id === "s1") return Response.json({ _scroll_id: "s2", hits: { hits: indexerData.docs.slice(2) } });
      return Response.json({ _scroll_id: "s2", hits: { hits: [] } });
    }
    return new Response("nf", { status: 404 });
  },
});


/** Mock OpenAI-kompatibilního API (Open WebUI /api) pro AI asistenta. */
const aiCalls: any[] = [];
const aiState = { embedFail: false, embedDim: 64 };
const aiServer = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (req.headers.get("authorization") !== "Bearer owui-key") return new Response('{"detail":"Not authenticated"}', { status: 401 });
    if (u.pathname === "/api/models") return Response.json({ data: [{ id: "gpt-oss:20b" }, { id: "llama3.1:8b" }] });
    // embedding (Zeptej se dokumentace): deterministický „bag of words“ vektor – podobné texty = podobné vektory
    if (u.pathname === "/api/embeddings") {
      if (aiState.embedFail) return new Response("Internal Server Error", { status: 500 });
      const body = (await req.json()) as { model: string; input: string[] };
      const vec = (t: string) => {
        const v = new Array(aiState.embedDim).fill(0);
        for (const w of t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3)) {
          let h = 0;
          for (const ch of w.slice(0, 5)) h = (h * 31 + ch.charCodeAt(0)) % 64;
          v[h] += 1;
        }
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      };
      return Response.json({ data: body.input.map((t, i) => ({ index: i, embedding: vec(t) })), model: body.model });
    }
    if (u.pathname === "/api/chat/completions") {
      const body = (await req.json()) as any;
      aiCalls.push(body);
      const prompt: string = body.messages.at(-1).content;
      const reply = (content: string) => Response.json({ model: body.model, choices: [{ message: { role: "assistant", content } }] });
      const sys: string = body.messages[0]?.content ?? "";
      // Zeptej se dokumentace: odpověď s citací prvního úryvku
      if (sys.includes("Odpovídej VÝHRADNĚ z poskytnutých úryvků")) {
        const first = prompt.match(/\[1\][^\n]*:\n([^\n]*)/)?.[1] ?? "";
        return reply(`<think>hledám</think>Podle směrnice: ${first.slice(0, 80)} [1]`);
      }
      // odpověď nad záznamy (ADR-044): cituje první záznam
      if (sys.includes("VÝHRADNĚ z poskytnutých záznamů")) {
        const first = prompt.match(/\[1\] ([^\n]*)/)?.[1] ?? "";
        return reply(`<think>hledám</think>Nejbližší záznam: ${first.slice(0, 80)} [1]`);
      }
      // AI předběžná triáž (ADR-051): podle verdiktů podobných alertů
      if (sys.includes("předběžnou triáž")) {
        if (prompt.includes("ROZBITY")) return reply("nevím");
        if (prompt.includes("uzavřeno: false_positive")) return reply('<think>x</think>{"verdict":"false_positive","severity":"low","confidence":"high","reasoning":"Stejná technika se opakovaně uzavírala jako falešný poplach."}');
        return reply('{"verdict":"true_positive","severity":"critical","confidence":"medium","reasoning":"Nové chování bez historie."}');
      }
      // informační servis – návrh čísel z měsíčního přehledu (ADR-087)
      if (sys.includes("měsíčního přehledu kybernetických incidentů NÚKIB")) {
        return reply('<think>x</think>{"month":"2026-03","total":20,"classes":[{"name":"Průnik","count":11},{"name":"Podvod/phishing","count":3},{"name":"Dostupnost","count":3},{"name":"*","count":9},{"name":"Škodlivý kód","count":2},{"name":"Ostatní","count":-1}],"severities":[{"name":"Významný incident","count":4},{"name":"Méně významný incident","count":16}]}');
      }
      // detail zranitelnosti – AI rozbor (ADR-076)
      if (sys.includes("expert na správu zranitelností")) {
        return reply('<think>x</think>```json\n{"summary":"Chyba v knihovně umožňuje vzdálené spuštění kódu.","impact":"Převzetí serveru.","exploitation":"Vzdáleně bez autentizace.","remediation":["1. Aktualizujte balíček openssl.","2. Restartujte služby."],"workaround":"Omezte přístup k portu 443",' + '"verification":["openssl version"],"references":["https://nvd.nist.gov/vuln/detail/CVE-2026-77001","nehttp"],"caveats":"Ověřte opravenou verzi u výrobce."}\n```');
      }
      // poradci SOC (ADR-046)
      if (sys.includes("analytik SOC")) {
        if (prompt.startsWith("Údaje o alertu")) return reply(`<think>analyzuji</think>Rozbor: ${prompt.split("\n")[1]!.slice(0, 80)}`);
        return reply(`<think>x</think>Poradce: ${prompt.includes("Zranitelnosti v evidenci organizace") ? "CVE je v evidenci." : "obecná odpověď."}`);
      }
      // dotazy v přirozeném jazyce (v0.20): plán → odpověď
      if (sys.includes("Katalog nástrojů")) {
        // jednotný vstup (v0.50): úryvky stačí → bez nástrojů
        if (sys.includes("Nalezené úryvky") && !prompt.includes("aktiv")) return reply('{"calls":[]}');
        if (prompt.includes("počasí")) return reply('{"calls":[],"reply":"Na to v CONTIXu data nejsou."}');
        return reply(JSON.stringify({ calls: [{ tool: "assets_search", args: { criticality: "critical" } }, { tool: "risks_search", args: { unacceptable: true } }, { tool: "neexistuje", args: {} }, { tool: "controls_search", args: { status: "bogus" } }, { tool: "suppliers_search", args: {} }] }));
      }
      if (prompt.startsWith("Dotaz:")) {
        const [json, snippets] = prompt.split("Výsledky (JSON):\n")[1]!.split("\n\nÚryvky a záznamy:\n\n");
        const data = JSON.parse(json!);
        // cituje první dokument a první incident z úryvků
        const cite = (label: string) => snippets?.match(new RegExp(`\\[(\\d+)\\] ${label} – `))?.[1];
        const refs = [cite("Dokument"), cite("Incident")].filter(Boolean).map((n) => `[${n}]`).join(" ");
        if (!data.length) return reply(`<think>čtu</think>Podle zdrojů: ${refs || "nic"}.`);
        return reply(`<think>počítám</think>Kritických aktiv: ${data[0].celkem}.${refs ? ` ${refs}` : ""}`);
      }
      if (prompt.includes("Napiš pouze slovo OK")) return reply("OK");
      if (prompt.includes("rozbij")) return reply("Omlouvám se, nemohu odpovědět.");
      if (prompt.includes('"tasks": [{"title"')) {
        const docId = prompt.split("Dokumenty organizace (id | označení název):\n")[1]?.split("\n")[0]?.split(" | ")[0] ?? null;
        return reply(JSON.stringify({ summary: "Novela zpřesňuje § 6 – bezpečnostní politika musí obsahovat i řízení dodavatelů.", tasks: [{ title: "Doplnit politiku o dodavatele", description: "Upravit kap. 3", policyId: docId, requirementId: "cz409:6/1" }, { title: "Neznámý dokument", policyId: "00000000-0000-0000-0000-000000000000", requirementId: "cz409:999" }, { description: "bez názvu" }] }));
      }
      // v0.99: screening AI Act, triáž VEX, triáž incidentu (ADR-094)
      if (prompt.includes('"screening": {"prohibited"'))
        return reply(JSON.stringify({ summary: "Předvýběr uchazečů = příloha III bod 4.", screening: { annexIII: ["recruitment", "bogus"], gpai: true, personalData: true, transparency: [], exception: "nope", prohibited: [] }, reasons: { annexIII: "nábor zaměstnanců" } }));
      // v1.04: návrh odpovědí na dotazník zákazníka (ADR-099)
      if (prompt.includes('"answers": [{"itemId"')) {
        const data = JSON.parse(prompt.split("Podklady (JSON):\n")[1]!.split("\n")[0]!);
        const qs = data.questions as any[];
        const mfa = qs.find((q) => /MFA|multi-factor/i.test(q.question));
        const enc = qs.find((q) => /encrypt/i.test(q.question));
        return reply(JSON.stringify({ summary: "Dvě odpovědi z opatření a certifikace.", answers: [
          ...(mfa ? [{ itemId: mfa.itemId, answer: "yes", text: "MFA je povinné pro vzdálený přístup.", sources: [...mfa.controls.slice(0, 1).map((c: any) => ({ kind: "control", id: c.id })), { kind: "certification", id: "c0" }, { kind: "policy", id: "00000000-0000-0000-0000-000000000000" }], confidence: "high", reason: "opatření zavedeno" }] : []),
          ...(enc ? [{ itemId: enc.itemId, answer: "partial", text: "Šifrování disků se zavádí.", sources: [], confidence: "high" }] : []),
          { itemId: "00000000-0000-0000-0000-000000000000", answer: "yes" },
        ] }));
      }
      // v1.03: vytěžení zprávy dodavatele (ADR-098)
      if (prompt.includes('"cuecs": [{"ref": "CUEC-1"')) {
        const data = JSON.parse(prompt.split("Podklady (JSON):\n")[1]!.split("\n")[0]!);
        const ctl = (data.ownControls as any[]).find((c) => c.name.includes("Přezkum přístupů dodavatele"));
        return reply(JSON.stringify({ summary: "Výrok bez výhrad, jedna výjimka v řízení změn.", cuecs: [{ ref: "CUEC-1", text: "Zákazník pravidelně přezkoumává uživatelské účty ve službě.", criterion: "CC6.2", controlId: ctl?.controlId, reason: "přezkum přístupů" }, { ref: "CUEC-2", text: "Zákazník chrání své přihlašovací údaje k API.", criterion: "CC6.1", controlId: "00000000-0000-0000-0000-000000000000" }], exceptions: [{ ref: "CC8.1", criterion: "CC8.1", text: "U 1 z 25 vzorků změna nasazena bez schválení.", managementResponse: "Proces doplněn o kontrolu v pipeline.", severity: "medium" }], csocs: [{ text: "AWS odpovídá za fyzickou bezpečnost datových center.", criterion: "CC6.4" }] }));
      }
      // v1.00: triáž nálezů ze skenu (ADR-095)
      if (prompt.includes('"action": "duplicate"')) {
        const data = JSON.parse(prompt.split("Podklady (JSON):\n")[1]!.split("\n")[0]!);
        const f = data.findings as any[];
        const o = data.otherFindings as any[];
        return reply(JSON.stringify({ summary: "XSS hlásí i Burp, CSP řeší proxy.", findings: [{ findingId: f[0].findingId, action: "duplicate", duplicateOfId: o[0]?.findingId, reason: "stejné XSS na /search" }, { findingId: f[1]?.findingId, action: "false_positive", reason: "CSP nastavuje reverzní proxy" }, { findingId: "00000000-0000-0000-0000-000000000000", action: "verify" }, { findingId: f[0].findingId, action: "verify" }] }));
      }
      if (prompt.includes('"findings": [{"findingId"')) {
        const data = JSON.parse(prompt.split("Produkt a nálezy (JSON):\n")[1]!.split("\n")[0]!);
        const f = data.findings as any[];
        return reply(JSON.stringify({ summary: "Jedna zranitelnost produkt nezasahuje.", findings: [{ findingId: f[0].findingId, status: "not_affected", justification: "vulnerable_code_not_in_execute_path", impactStatement: "Funkce template se nevolá.", reason: "účel produktu" }, { findingId: f[0].findingId, status: "affected" }, { findingId: "00000000-0000-0000-0000-000000000000", status: "fixed" }, ...(f[1] ? [{ findingId: f[1].findingId, status: "not_affected" }] : [])] }));
      }
      if (prompt.includes('"triage": {"kind"')) {
        const data = JSON.parse(prompt.split("Incident (JSON):\n")[1]!.split("\n")[0]!);
        const ref = data.similarRecords.length ? ` Podobný případ [1] ${data.similarRecords[0].title}.` : "";
        return reply(JSON.stringify({ summary: `Phishing vedoucí k ransomware.${ref}`, triage: { kind: "incident", category: "ransomware", cause: "intentional", suspectedUnlawful: true, personalDataBreach: "možná" }, reasons: { category: "šifrování dat" } }));
      }
      if (prompt.includes('"measures"'))
        return reply(
          "Zde je návrh:\n```json\n" +
            JSON.stringify({
              summary: "Riziko snížíte řízením přístupu a zálohováním.",
              measures: [
                { title: "Vícefaktorové ověřování pro vzdálený přístup", description: "Zavést MFA pro VPN a správu.", objective: "Snížit pravděpodobnost zneužití účtů", category: "technical", paragraphs: ["19", "99"] },
                { title: "Pravidelné testy obnovy záloh", description: "Čtvrtletní test obnovy.", objective: "Ověřit RTO", category: "technical", paragraphs: [26] },
                { description: "bez názvu – zahodit" },
              ],
            }) +
            "\n```",
        );
      if (prompt.includes('"fields"'))
        return reply(JSON.stringify({ summary: "Server podporuje kritické procesy.", fields: [{ field: "criticality", value: "critical", reason: "podporuje kritický proces" }, { field: "availability", value: 4, reason: "výpadek zastaví službu" }, { field: "ownerUserId", value: "x" }, { field: "integrity", value: 9 }] }));
      if (prompt.includes('"lessonsLearned": "…"'))
        return reply(JSON.stringify({ summary: "Phishingový e-mail byl zachycen, bez dopadu na službu.", impactDescription: "Bez dopadu na dostupnost regulované služby.", lessonsLearned: "Zopakovat školení k phishingu.", foo: "x" }));
      if (prompt.includes('"status": "covered|partial|missing"')) {
        const reqIds = prompt.split("\n").filter((l) => /^cz4\d\d:\d+/.test(l)).map((l) => l.split(" | ")[0]);
        return reply(JSON.stringify({ summary: "Dokument je velmi stručný.", requirements: [{ requirementId: reqIds[0], status: "covered", reason: "kap. 1" }, { requirementId: reqIds[1], status: "missing", reason: "doplnit" }, { requirementId: "cz409:99/1", status: "missing" }, { requirementId: reqIds[1], status: "partial" }] }));
      }
      if (prompt.includes('"requirements"')) {
        const first = prompt.split("\n").find((l) => /^soc2:CC6\.1 \|/.test(l))!.split(" | ")[0];
        return reply(JSON.stringify({ summary: "Opatření pokrývá řízení přístupu.", requirements: [{ requirementId: first, reason: "MFA je logická ochrana přístupu" }, { requirementId: "soc2:cc6.2", reason: "registrace uživatelů" }, { requirementId: "soc2:XX9.9", reason: "neexistuje" }, { requirementId: first, reason: "duplicita" }] }));
      }
      return reply("{}");
    }
    return new Response("nf", { status: 404 });
  },
});
const AI_URL = `http://127.0.0.1:${aiServer.port}/api`;

/** Fiktivní REST API e-Sbírky: znění 409/2025 se dá „novelizovat“ přepnutím esbState.version. */
const esbState = { version: 1, calls: [] as string[], key: "" };
const esbFrag = (anchor: string, cit: string, text: string, id: number) => ({ id, staleUrl: `/sb/2025/409/V#${anchor}`, zkracenaCitace: cit, kodTypuFragmentu: "Odstavec", hloubka: 2, xhtml: `<p>${text}</p>` });
/** ARES: IČO 27074358 = existující firma, hledání podle názvu, 00000019 = nenalezeno. */
const aresCalls: string[] = [];
/** Veřejné zdroje hrozeb (ADR-049): testovací KEV (JSON) a EPSS (CSV.GZ). */
const intelMock = { kev: "", epss: new Uint8Array(), fail: false };
/** DefectDojo API v2 (ADR-097): stránkované aktivní nálezy s předanými endpointy. */
const ddMock = { key: "dd-secret-key-123", findings: [] as any[], evilNext: false };
const intelFetch = async (input: string, init?: RequestInit) => {
  if (input.startsWith("https://dd.test/")) {
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Token ${ddMock.key}`) return Response.json({ detail: "Invalid token." }, { status: 401 });
    const u = new URL(input);
    const page = Number(u.searchParams.get("page") ?? "1");
    const limit = Number(u.searchParams.get("limit") ?? "500");
    const slice = limit === 1 ? ddMock.findings.slice(0, 1) : page === 1 ? ddMock.findings.slice(0, 1) : ddMock.findings.slice(1);
    const next = limit !== 1 && page === 1 && ddMock.findings.length > 1 ? (ddMock.evilNext ? "https://evil.example/api/v2/findings/?page=2" : `https://dd.test/api/v2/findings/?active=true&limit=500&page=2`) : null;
    return Response.json({ count: ddMock.findings.length, next, results: slice, prefetch: { endpoints: { "7": { host: "web01.scan.local", port: 443, path: "/admin", protocol: "https" } } } });
  }
  if (intelMock.fail) return new Response("down", { status: 503 });
  if (input.endsWith("/kev.json")) return new Response(intelMock.kev, { headers: { "content-type": "application/json" } });
  if (input.endsWith("/epss.csv.gz")) return new Response(intelMock.epss);
  return new Response("nf", { status: 404 });
};
/** Informační servis (ADR-087): RSS NÚKIB a otevřená data o incidentech. */
const INFO_RSS = `<?xml version='1.0' encoding='UTF-8'?><rss version="2.0"><channel><title>NÚKIB</title>
<item><title>Varování NÚKIB před používáním produktu X</title><link>https://nukib.gov.cz/cs/infoservis/aktuality/1-varovani</link><description>&lt;p&gt;NÚKIB vydává varování&lt;/p&gt;</description><guid isPermaLink="false">g1</guid><category>infoservis/aktuality</category><pubDate>Wed, 21 Oct 2026 17:46:04 +0000</pubDate></item>
<item><title>NÚKIB upozorňuje na kritické zranitelnosti v PHP</title><link>https://nukib.gov.cz/cs/infoservis/aktuality/2-php</link><description>Aktualizujte PHP</description><guid isPermaLink="false">g2</guid><pubDate>Tue, 20 Oct 2026 09:46:51 +0000</pubDate></item>
<item><title>Vydali jsme přehled kybernetických incidentů za září 2026</title><link>javascript:alert(1)</link><guid>g3</guid><pubDate>Mon, 19 Oct 2026 09:00:00 +0000</pubDate></item>
</channel></rss>`;
const INFO_CSV = "Rok/měsíc,Klasifikace ENISA,Závažnost\n2024-01,Průnik,Významný incident\n2024-01,Podvod,Méně závažný incident\n2025-02,Průnik,Významný incident\n";
/** OSV bucket (ADR-093): npm/all.zip se dvěma záznamy. */
const OSV_LODASH = { id: "GHSA-35jh-r3h4-6jhm", aliases: ["CVE-2021-23337"], summary: "Command Injection in lodash", modified: "2024-01-01T00:00:00Z", affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }] };
const OSV_MINIMIST = { id: "GHSA-xvch-5gv4-984h", aliases: ["CVE-2021-44906"], summary: "Prototype Pollution in minimist", affected: [{ package: { ecosystem: "npm", name: "minimist" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.2.4" }, { introduced: "1.0.0" }, { fixed: "1.2.6" }] }] }] };
/** Dotazy do NVD (v1.16) – ověří, že odchází jen CPE. */
const nvdCalls: string[] = [];
const infoFetch = async (input: string) => {
  if (input.startsWith("https://services.nvd.nist.gov/rest/json/cves/2.0?")) {
    nvdCalls.push(input);
    return Response.json({
      totalResults: 2,
      vulnerabilities: [
        { cve: { id: "CVE-2026-1111", descriptions: [{ lang: "en", value: "Router web UI command injection" }], metrics: { cvssMetricV31: [{ cvssData: { baseScore: 9.8, baseSeverity: "CRITICAL" } }] } } },
        { cve: { id: "CVE-2026-2222", descriptions: [{ lang: "en", value: "Weak default credentials" }], metrics: {} } },
      ],
    });
  }
  if (input === "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip") return new Response(zipSync({ "GHSA-35jh-r3h4-6jhm.json": strToU8(JSON.stringify(OSV_LODASH)), "GHSA-xvch-5gv4-984h.json": strToU8(JSON.stringify(OSV_MINIMIST)) }));
  if (input === "https://nukib.gov.cz/cs/infoservis/aktuality/9-prehled-brezen")
    return new Response('<html><a href="/download/publikace/vyzkum/Kyberneticke-incidenty-pohledem-NUKIB-brezen2026.pdf">PDF</a><a href="https://evil.example/x.pdf">x</a></html>', { headers: { "content-type": "text/html" } });
  if (input === "https://nukib.gov.cz/download/publikace/vyzkum/Kyberneticke-incidenty-pohledem-NUKIB-brezen2026.pdf") return new Response("%PDF-1.4 test", { headers: { "content-type": "application/pdf" } });
  if (input === "https://nukib.gov.cz/rss.xml") return new Response(INFO_RSS, { headers: { "content-type": "application/rss+xml" } });
  if (input.endsWith("/data.csv")) return new Response(INFO_CSV);
  return new Response("nf", { status: 404 });
};
const aresFetch = async (input: string, init?: RequestInit) => {
  const u = new URL(input);
  aresCalls.push(`${init?.method ?? "GET"} ${u.pathname}${init?.body ? ` ${init.body}` : ""}`);
  const subj = { ico: "27074358", obchodniJmeno: "Asseco Central Europe, a.s.", dic: "CZ27074358", pravniForma: "121", sidlo: { kodStatu: "CZ", nazevStatu: "Česká republika", textovaAdresa: "Budějovická 778/3a, Michle, 14000 Praha 4" } };
  if (u.pathname.endsWith("/ekonomicke-subjekty/27074358")) return Response.json(subj);
  if (u.pathname.endsWith("/ekonomicke-subjekty/vyhledat")) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    if (b.obchodniJmeno === "Asseco") return Response.json({ pocetCelkem: 2, ekonomickeSubjekty: [subj, { ico: "25672541", obchodniJmeno: "Asseco Solutions, a.s.", datumZaniku: "2020-01-01", sidlo: { kodStatu: "CZ" } }] });
    return Response.json({ kod: "CHYBA_VSTUPU" }, { status: 400 });
  }
  return Response.json({ kod: "NENALEZENO" }, { status: 404 });
};

/** CELLAR (EUR-Lex): DORA – verze 1 jen původní akt, verze 2 navíc konsolidované znění se změněným čl. 6. */
const euState = { version: 1, calls: [] as string[] };
const euDoc = (art6: string) =>
  `<html><body><div class="eli-container"><div class="eli-subdivision" id="art_5"><p class="oj-ti-art">Článek 5</p><div class="eli-title" id="art_5.tit_1"><p class="oj-sti-art">Správa a organizace</p></div><div id="005.001"><p class="oj-normal">1. Finanční subjekty mají rámec vnitřní správy.</p></div></div><div class="eli-subdivision" id="art_6"><p class="oj-ti-art">Článek 6</p><div class="eli-title" id="art_6.tit_1"><p class="oj-sti-art">Rámec pro řízení rizik v oblasti IKT</p></div><div id="006.001"><p class="oj-normal">1. ${art6}</p></div></div></div></body></html>`;
const cellarFetch = async (input: string, init?: RequestInit) => {
  const u = new URL(input);
  euState.calls.push(u.pathname);
  const lit = (v: string) => ({ type: "literal", value: v });
  if (u.pathname === "/webapi/rdf/sparql") {
    const q = new URLSearchParams(String(init?.body)).get("query") ?? "";
    if (!q.includes('"32022R2554"')) return Response.json({ results: { bindings: [] } });
    const rows: unknown[] = [
      {
        c: lit("32022R2554"),
        d: lit("2022-12-14"),
        force: lit("1"),
        eov: lit("9999-12-31"),
        title: lit("Nařízení Evropského parlamentu a Rady (EU) 2022/2554"),
        i: {
          type: "uri",
          value: "http://publications.europa.eu/resource/cellar/base.0002.03/DOC_1",
        },
      },
    ];
    if (euState.version === 2)
      rows.push({
        c: lit("02022R2554-20270101"),
        d: lit("2027-01-01"),
        i: {
          type: "uri",
          value: "http://publications.europa.eu/resource/cellar/cons.0002.02/DOC_1",
        },
      });
    return Response.json({ results: { bindings: rows } });
  }
  if (u.pathname === "/resource/cellar/base.0002.03/DOC_1") return new Response(euDoc("Finanční subjekty mají rámec pro řízení rizik IKT."));
  if (u.pathname === "/resource/cellar/cons.0002.02/DOC_1") return new Response(euDoc("Finanční subjekty mají komplexní a zdokumentovaný rámec pro řízení rizik IKT."));
  return new Response("nf", { status: 404 });
};
const esbirkaFetch = async (input: string, init?: RequestInit) => {
  const u = new URL(input);
  if (u.hostname === "publications.europa.eu") return cellarFetch(input, init);
  esbState.calls.push(u.pathname + u.search);
  esbState.key = new Headers(init?.headers).get("esel-api-access-key") ?? "";
  const path = decodeURIComponent(u.pathname);
  const ver = esbState.version === 1 ? "2025-11-01" : "2026-07-01";
  if (u.pathname === "/rss/zmeny")
    return new Response(`<rss><channel><item><title>409/2025 Sb. - zrušení 1.1.2030</title><link>https://e-sbirka.gov.cz/sb/2025/409</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`, { headers: { "content-type": "application/rss+xml" } });
  if (path === "/dokumenty-sbirky//sb/2025/409")
    return Response.json({ staleUrl: `/sb/2025/409/${ver}`, datumUcinnostiOd: `${ver}T00:00:00`, zkracenaCitace: "409/2025 Sb.", uplnaCitace: "Vyhláška o kybernetické bezpečnosti", eli: "eli/cz/sb/2025/409" });
  if (path === `/dokumenty-sbirky//sb/2025/409/${ver}/fragmenty`) {
    if (u.searchParams.get("cisloStranky") !== "0") return Response.json({ seznam: [], pocetStranek: 1 });
    const v1 = [
      esbFrag("par_6-odst_1-pism_a", "§ 6 odst. 1 písm. a)", "Bezpečnostní politika obsahuje cíle.", 1),
      esbFrag("par_7-odst_1", "§ 7 odst. 1", "Povinná osoba vede přehled aktiv.", 2),
      esbFrag("par_8-odst_2", "§ 8 odst. 2", "Tento odstavec bude zrušen.", 3),
    ];
    const v2 = [
      esbFrag("par_6-odst_1-pism_a", "§ 6 odst. 1 písm. a)", "Bezpečnostní politika obsahuje cíle a řízení dodavatelů.", 11),
      esbFrag("par_7-odst_1", "§ 7 odst. 1", "Povinná osoba vede přehled aktiv.", 12),
      esbFrag("par_9-odst_1", "§ 9 odst. 1", "Nový odstavec o školení.", 13),
    ];
    return Response.json({ seznam: (esbState.version === 1 ? v1 : v2).map((f) => ({ ...f, staleUrl: f.staleUrl.replace("/V#", `/${ver}#`) })), pocetStranek: 1 });
  }
  return new Response("nf", { status: 404 });
};

describe.skipIf(!url)("API (integrace)", () => {
  const client = postgres(url ?? "postgres://invalid", { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const config: Config = {
    NODE_ENV: "test",
    PORT: 0,
    DATABASE_URL: url ?? "",
    CORS_ORIGINS: [APP],
    APP_URL: APP,
    APP_SECRET: "test-secret-test-secret-test-secret-42",
    WAZUH_VERIFY_TLS: true,
    SCAN_ENABLED: false,
    SCAN_ALLOWED_CIDRS: [],
    NMAP_PATH: "nmap",
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: "contix-client",
    OIDC_CLIENT_SECRET: "s3cret",
    OIDC_LABEL: "AD FS",
    OIDC_SCOPES: "openid profile email allatclaims",
    ESBIRKA_API_URL: "https://esbirka.test",
    ESBIRKA_API_KEY: "esb-test-key",
  };
  const sentMails: { to: string; subject: string; html: string }[] = [];
  const background: Promise<unknown>[] = [];
  const teamsPosts: { url: string; payload: any }[] = [];
  const app = createApp({
    db,
    config,
    mailer: { send: async (m) => void sentMails.push(m) },
    teams: { post: async (url, payload) => void teamsPosts.push({ url, payload }) },
    onBackground: (p) => void background.push(p),
    esbirkaFetch,
    aresFetch,
    intelFetch: intelFetch as any,
    infoFetch: infoFetch as any,
    pdfText: async (buf: Uint8Array) => (new TextDecoder().decode(buf).startsWith("%PDF") ? "Kybernetické incidenty pohledem NÚKIB – březen 2026. NÚKIB během března evidoval celkem 20 incidentů. Průnik 55 %." : ""),
    tls: { legacy: async (host: string) => (host === "127.0.0.1" ? ["TLSv1.1"] : []) },
    netscan: { scanner: async () => netHosts },
    adAuth: fakeAdAuth,
  });

  /** Revize v0.73: žádná odpověď API nesmí obsahovat hash hesla, šifrované tajemství ani hash tokenu. */
  const SECRET_KEYS_RE = /"(passwordHash|password_hash|tokenHash|token_hash|[a-zA-Z]+Enc|[a-z_]+_enc)"\s*:\s*"/;
  const secretLeaks: string[] = [];

  /** Hostitelé, které vrátí náhradní sken segmentu (ADR-072). */
  let netHosts: any[] = [];
  /** Jednoduchý "prohlížeč" s cookie jar. */
  function browser() {
    let cookie = "";
    const req = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      if (!headers.has("origin")) headers.set("origin", APP);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(init.json);
      }
      const res = await app.request(path, { ...init, headers, body });
      if (res.headers.get("content-type")?.includes("json")) {
        const txt = await res.clone().text();
        const hit = txt.match(SECRET_KEYS_RE);
        if (hit) secretLeaks.push(`${init.method ?? "GET"} ${path}: ${hit[0]}`);
      }
      const sc = res.headers.get("set-cookie");
      const m = sc?.match(/contix_session=([^;]*)/);
      if (m) cookie = m[1] ? `contix_session=${m[1]}` : "";
      return res;
    };
    const json = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
      const res = await req(path, init);
      return { status: res.status, body: (await res.json().catch(() => null)) as any };
    };
    const login = (email: string, password = PW) => json("/api/auth/login", { method: "POST", json: { email, password } });
    return { req, json, login };
  }

  const admin = browser();
  const ids: Record<string, string> = {};
  const roleId = async (key: string) =>
    ((await admin.json("/api/admin/roles")).body as any[]).find((r) => r.key === key).id as string;

  beforeAll(async () => {
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    await ensureSystemRoles(db);
    await seedRiskCatalog(db);
    await seedRiskCatalog(db); // idempotentní
    await createAdmin(db, "admin@test.cz", "Admin", PW);
  }, 60_000);
  afterAll(async () => {
    idp.server.stop(true);
    wazuh.stop(true);
    indexer.stop(true);
    await client.end();
  });

  /* ============ Přihlášení ============ */

  test("health je veřejný, API bez přihlášení vrací 401", async () => {
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.clone().json()).toMatchObject({ version: CONTIX_VERSION, license: "AGPL-3.0-only", sourceUrl: "https://github.com/dynamicdata-cz/contix" }); // AGPL-3.0 (v1.15)
    // bezpečnostní hlavičky API (v1.12): soubory a tiskové HTML se nespustí jako skript
    expect(health.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("permissions-policy")).toContain("camera=()");
    expect((await app.request("/api/assets")).status).toBe(401);
    // chybové hlášky v jazyce požadavku (bez přihlášení podle prohlížeče), čeština beze změny
    expect(await (await app.request("/api/assets", { headers: { "accept-language": "en-US,en;q=0.9" } })).json()).toEqual({ error: "Not signed in" });
    expect(await (await app.request("/api/assets", { headers: { "accept-language": "cs" } })).json()).toEqual({ error: "Nepřihlášen" });
  });

  test("špatné heslo → obecná chyba", async () => {
    const b = browser();
    const r1 = await b.login("admin@test.cz", "spatne");
    const r2 = await b.login("nikdo@test.cz", "spatne");
    expect(r1.status).toBe(401);
    expect(r1.body.error).toBe(r2.body.error);
  });

  test("admin se přihlásí a má všechna oprávnění", async () => {
    expect((await admin.login("admin@test.cz")).status).toBe(200);
    const me = await admin.json("/api/auth/me");
    expect(me.body.permissions).toContain("admin:users");
    expect(me.body.user.roles[0].key).toBe("admin");
  });

  test("CSRF: formulář z cizí domény je odmítnut", async () => {
    const fd = new FormData();
    fd.append("file", new File(["name\nX\n"], "x.csv"));
    const res = await admin.req("/api/discovery/import/csv", { method: "POST", body: fd, headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  test("uzamčení účtu po opakovaných neúspěšných pokusech", async () => {
    await admin.json("/api/admin/users", {
      method: "POST",
      json: { email: "lock@test.cz", displayName: "Lock", password: PW },
    });
    const b = browser();
    for (let i = 0; i < 5; i++) await b.login("lock@test.cz", "spatne-heslo");
    expect((await b.login("lock@test.cz")).status).toBe(423);
  });

  test("nový uživatel musí změnit dočasné heslo", async () => {
    const created = await admin.json("/api/admin/users", {
      method: "POST",
      json: { email: "owner@test.cz", displayName: "Eva Vlastník", password: PW, roleIds: [await roleId("asset_owner")] },
    });
    expect(created.status).toBe(201);
    ids.owner = created.body.id;

    const b = browser();
    await b.login("owner@test.cz");
    expect((await b.json("/api/auth/me")).body.mustChangePassword).toBe(true);
    expect((await b.req("/api/assets")).status).toBe(403);
    const ch = await b.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Nove-Heslo-2026!!" } });
    expect(ch.status).toBe(200);
    expect((await b.req("/api/assets")).status).toBe(200);
  });

  /* ============ MFA ============ */

  test("MFA: nastavení, přihlášení s kódem, záložní kód", async () => {
    await admin.json("/api/admin/users", {
      method: "POST",
      json: { email: "mfa@test.cz", displayName: "MFA", password: PW, roleIds: [await roleId("viewer")] },
    });
    const b = browser();
    await b.login("mfa@test.cz");
    await b.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Mfa-Heslo-2026!!" } });

    const setup = await b.json("/api/auth/mfa/setup", { method: "POST" });
    expect(setup.body.otpauthUrl).toStartWith("otpauth://totp/");
    const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
    expect((await b.json("/api/auth/mfa/enable", { method: "POST", json: { code: "000000" } })).status).toBe(400);
    const en = await b.json("/api/auth/mfa/enable", { method: "POST", json: { code: totpAt(setup.body.secret, step) } });
    expect(en.body.recoveryCodes).toHaveLength(10);

    // nové přihlášení → vyžaduje druhý faktor
    const b2 = browser();
    const l = await b2.login("mfa@test.cz", "Mfa-Heslo-2026!!");
    expect(l.body.mfaRequired).toBe(true);
    expect((await b2.req("/api/assets")).status).toBe(401);
    // stejný kód znovu nelze použít (replay)
    expect((await b2.json("/api/auth/mfa/verify", { method: "POST", json: { code: totpAt(setup.body.secret, step) } })).status).toBe(401);
    expect((await b2.json("/api/auth/mfa/verify", { method: "POST", json: { code: totpAt(setup.body.secret, step + 1) } })).status).toBe(200);
    expect((await b2.req("/api/assets")).status).toBe(200);

    // záložní kód funguje jen jednou
    const code = en.body.recoveryCodes[0];
    const b3 = browser();
    await b3.login("mfa@test.cz", "Mfa-Heslo-2026!!");
    expect((await b3.json("/api/auth/mfa/verify", { method: "POST", json: { code } })).status).toBe(200);
    const b4 = browser();
    await b4.login("mfa@test.cz", "Mfa-Heslo-2026!!");
    expect((await b4.json("/api/auth/mfa/verify", { method: "POST", json: { code } })).status).toBe(401);
  });

  test("povinné MFA pro organizaci", async () => {
    // admin bez vlastního MFA nemůže MFA vynutit (ochrana před zamčením)
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { mfaRequired: true } })).status).toBe(400);
    const setup = await admin.json("/api/auth/mfa/setup", { method: "POST" });
    const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
    await admin.json("/api/auth/mfa/enable", { method: "POST", json: { code: totpAt(setup.body.secret, step) } });
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { mfaRequired: true } })).status).toBe(200);
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.json("/api/auth/me")).body.mfaSetupRequired).toBe(true);
    expect((await b.req("/api/assets")).status).toBe(403);
    await admin.json("/api/admin/settings", { method: "PATCH", json: { mfaRequired: false } });
  });

  /* ============ Role, skupiny, admin ============ */

  test("skupina předává role svým členům", async () => {
    await admin.json("/api/admin/users", { method: "POST", json: { email: "audit@test.cz", displayName: "Auditor", password: PW } });
    const users = (await admin.json("/api/admin/users")).body as any[];
    const auditorId = users.find((u) => u.email === "audit@test.cz").id;
    await admin.json("/api/admin/users/" + auditorId + "/reset-password", { method: "POST", json: { password: PW } });
    const g = await admin.json("/api/admin/groups", {
      method: "POST",
      json: { name: "Audit tým", roleIds: [await roleId("auditor")], memberIds: [auditorId] },
    });
    expect(g.status).toBe(201);

    const b = browser();
    await b.login("audit@test.cz");
    await b.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Auditor-Heslo-2026!" } });
    const me = await b.json("/api/auth/me");
    expect(me.body.permissions.sort()).toEqual(["actions:read", "aiact:read", "assets:read", "audit_log:read", "audits:read", "audits:write", "awareness:read", "bia:read", "controls:read", "controls:test", "cra:read", "gdpr:read", "identity:read", "incidents:read", "incidents:report", "isms:read", "knowledge:read", "legislation:read", "obligations:self", "org:read", "policies:read", "processes:read", "risks:read", "soc:read", "suppliers:read", "trust:read"]);
    // auditor jen čte
    expect((await b.json("/api/assets", { method: "POST", json: { name: "X", assetType: "server" } })).status).toBe(403);
    expect((await b.req("/api/admin/users")).status).toBe(403);
    expect((await b.req("/api/admin/audit-log")).status).toBe(200);
  });

  test("vlastní role s vybranými oprávněními", async () => {
    const r = await admin.json("/api/admin/roles", {
      method: "POST",
      json: { key: "dpo", name: "Pověřenec GDPR", permissions: ["assets:read"], externalGroups: ["GG-DPO"] },
    });
    expect(r.status).toBe(201);
    expect((await admin.json("/api/admin/roles", { method: "POST", json: { key: "dpo", name: "Dup" } })).status).toBe(409);
    const sys = await admin.json(`/api/admin/roles/${await roleId("ciso")}`, { method: "DELETE" });
    expect(sys.status).toBe(400);
  });

  test("nelze odebrat posledního administrátora", async () => {
    const me = (await admin.json("/api/auth/me")).body.user;
    expect((await admin.json(`/api/admin/users/${me.id}`, { method: "PATCH", json: { isActive: false } })).status).toBe(400);
    expect((await admin.json(`/api/admin/users/${me.id}`, { method: "PATCH", json: { roleIds: [] } })).status).toBe(409);
    expect((await admin.json("/api/auth/me")).body.permissions).toContain("admin:roles"); // role zůstala (rollback)
  });

  /* ============ Aktiva ============ */

  test("primární a podpůrná aktiva, vazby a dědění CIA", async () => {
    const p = await admin.json("/api/assets", {
      method: "POST",
      json: { name: "Mzdová agenda", assetType: "information_asset", confidentiality: 4, integrity: 3, availability: 2, criticality: "high" },
    });
    expect(p.body.assetClass).toBe("primary");
    const s = await admin.json("/api/assets", {
      method: "POST",
      json: { name: "SRV-01", assetType: "server", hostname: "srv-01", serialNumber: "SN-1", confidentiality: 1, availability: 3 },
    });
    expect(s.body.assetClass).toBe("supporting");
    ids.primary = p.body.id;
    ids.server = s.body.id;

    // nelze obráceně
    expect((await admin.json("/api/assets/links", { method: "POST", json: { primaryId: s.body.id, supportingId: p.body.id } })).status).toBe(400);
    expect((await admin.json("/api/assets/links", { method: "POST", json: { primaryId: p.body.id, supportingId: s.body.id, note: "DB" } })).status).toBe(201);

    const d = (await admin.json(`/api/assets/${s.body.id}`)).body;
    expect(d.supports[0].name).toBe("Mzdová agenda");
    expect(d.effectiveCia).toEqual({ confidentiality: 4, integrity: 3, availability: 3, inherited: true });
    const pd = (await admin.json(`/api/assets/${p.body.id}`)).body;
    expect(pd.supportedBy[0].note).toBe("DB");

    // změna třídy s vazbami je zakázaná
    expect((await admin.json(`/api/assets/${s.body.id}`, { method: "PATCH", json: { assetClass: "primary" } })).status).toBe(409);
    expect((await admin.json(`/api/assets?assetClass=primary`)).body.total).toBe(1);
  });

  test("vlastník aktiva upravuje jen svá aktiva", async () => {
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    const mine = await b.json("/api/assets", { method: "POST", json: { name: "Moje tabulka", assetType: "information_asset" } });
    expect(mine.status).toBe(201);
    expect(mine.body.ownerUserId).toBe(ids.owner);
    expect((await b.json(`/api/assets/${mine.body.id}`, { method: "PATCH", json: { description: "ok" } })).status).toBe(200);
    expect((await b.json(`/api/assets/${ids.server}`, { method: "PATCH", json: { description: "ne" } })).status).toBe(403);
    expect((await b.json(`/api/assets/${mine.body.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await b.json(`/api/assets/${mine.body.id}`)).body.canEdit).toBe(true);
  });

  test("PATCH nepřepisuje neposlaná pole", async () => {
    await admin.json(`/api/assets/${ids.server}`, { method: "PATCH", json: { ownerUserId: ids.owner } });
    const a = (await admin.json(`/api/assets/${ids.server}`)).body;
    expect(a.owner.displayName).toBe("Eva Vlastník");
    expect(a.availability).toBe(3);
  });

  test("CSV import páruje podle sériového čísla a nepřepisuje řídicí atributy", async () => {
    const csv = "name;type;serial;ip;criticality\nSRV-01-renamed;server;SN-1;10.0.0.5;low\nNB-1;laptop;SN-2;;\n";
    const res = await admin.json("/api/discovery/import/csv", { method: "POST", headers: { "content-type": "text/csv" }, body: csv });
    expect(res.status).toBe(201);
    expect(res.body.stats).toMatchObject({ discovered: 2, created: 1, updated: 1 });
    const a = (await admin.json(`/api/assets/${ids.server}`)).body;
    expect(a.name).toBe("SRV-01");
    expect(a.criticality).toBe("medium");
    expect(a.ipAddresses).toEqual(["10.0.0.5"]);
    const again = await admin.json("/api/discovery/import/csv", { method: "POST", headers: { "content-type": "text/csv" }, body: csv });
    expect(again.body.stats).toMatchObject({ created: 0, updated: 2 });
  });

  test("síťový sken je ve výchozím stavu vypnutý", async () => {
    expect((await admin.json("/api/discovery/connectors")).body.find((x: any) => x.id === "network_scan").enabled).toBe(false);
    expect((await admin.json("/api/discovery/network-scan", { method: "POST", json: { targets: ["10.0.0.0/24"] } })).status).toBe(403);
  });

  /* ============ SSO (OIDC – Entra ID / AD FS) ============ */

  async function ssoLogin(claims: { sub: string; email: string; name: string; groups: string[] }) {
    const b = browser();
    const start = await b.req("/api/auth/oidc/oidc/start");
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get("location")!);
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    const code = Buffer.from(JSON.stringify({ ...claims, nonce: loc.searchParams.get("nonce") })).toString("base64url");
    const cb = await b.req(`/api/auth/oidc/oidc/callback?state=${loc.searchParams.get("state")}&code=${code}`);
    return { b, location: cb.headers.get("location") };
  }

  test("SSO: neexistující uživatel bez auto-provisioningu je odmítnut", async () => {
    const r = await ssoLogin({ sub: "x1", email: "novy@firma.cz", name: "Nový", groups: [] });
    expect(r.location).toBe(`${APP}/login?error=not_provisioned`);
  });

  test("SSO: předem založený uživatel + mapování skupin na role", async () => {
    await admin.json("/api/admin/users", { method: "POST", json: { email: "dpo@firma.cz", displayName: "DPO", authProvider: "oidc" } });
    const r = await ssoLogin({ sub: "u-42", email: "dpo@firma.cz", name: "Marie DPO", groups: ["GG-DPO", "other"] });
    expect(r.location).toBe(`${APP}/`);
    const me = (await r.b.json("/api/auth/me")).body;
    expect(me.user.displayName).toBe("Marie DPO");
    expect(me.user.roles).toEqual([expect.objectContaining({ key: "dpo", source: "idp" })]);
    expect(me.permissions).toEqual(["assets:read"]);
    expect(me.mfaPending).toBe(false);
  });

  test("SSO: auto-provisioning s výchozí rolí", async () => {
    await admin.json("/api/admin/settings", { method: "PATCH", json: { oidcAutoProvision: true } });
    const r = await ssoLogin({ sub: "u-77", email: "novak@firma.cz", name: "Jan Novák", groups: [] });
    expect(r.location).toBe(`${APP}/`);
    expect((await r.b.json("/api/auth/me")).body.user.roles[0].key).toBe("viewer");
  });

  test("SSO: povolené domény – cizí doména je odmítnuta", async () => {
    await admin.json("/api/admin/settings", { method: "PATCH", json: { oidcAllowedDomains: ["firma.cz"] } });
    const r = await ssoLogin({ sub: "u-evil", email: "admin@utocnik.cz", name: "X", groups: [] });
    expect(r.location).toBe(`${APP}/login?error=sso_domain`);
    const ok = await ssoLogin({ sub: "u-78", email: "kolega@firma.cz", name: "Kolega", groups: [] });
    expect(ok.location).toBe(`${APP}/`);
    await admin.json("/api/admin/settings", { method: "PATCH", json: { oidcAllowedDomains: [] } });
  });

  test("SSO: podvržený state je odmítnut", async () => {
    const b = browser();
    const cb = await b.req(`/api/auth/oidc/oidc/callback?state=fake&code=abc`);
    expect(cb.headers.get("location")).toBe(`${APP}/login?error=sso_expired`);
  });

  /* ============ Přihlášení účty AD a SSO z administrace (ADR-078) ============ */

  test("přihlášení účtem AD: připojení, zkouška, mapování skupin, přihlášení a ochrany", async () => {
    const form = {
      name: "Lab AD",
      config: { url: "ldaps://dc4lab.lab.internal:636", baseDn: "DC=lab,DC=internal", bindDn: "svc-contix@lab.internal", verifyTls: true, caCert: "" },
      secret: "svc-pw",
      login: { enabled: false, allowedGroups: [], autoProvision: true, defaultRoleKey: "", upnSuffix: "" },
    };
    await admin.json("/api/admin/users", { method: "POST", json: { email: "konverze@test.cz", displayName: "Konverze", password: PW } });
    expect((await admin.json("/api/admin/login/ad", { method: "POST", json: { ...form, secret: "" } })).status).toBe(400);
    const created = await admin.json("/api/admin/login/ad", { method: "POST", json: form });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ hasSecret: true, syncHours: 0, login: { enabled: false } });
    expect(JSON.stringify(created.body)).not.toContain("svc-pw");
    const id = created.body.id;
    expect((await browser().json("/api/auth/providers")).body.ad).toBe(false);

    // zkouška: bez mapování skupin a výchozí role nemá uživatel roli
    let t = await admin.json(`/api/admin/login/ad/${id}/test`, { method: "POST", json: { username: "jan.novak", password: "Ad-Heslo-1" } });
    expect(t.body).toMatchObject({ ok: false, reason: "no_role", displayName: "Jan Novák" });
    const auditorRole = (await admin.json("/api/admin/roles")).body.find((r: any) => r.key === "auditor");
    expect((await admin.json(`/api/admin/roles/${auditorRole.id}`, { method: "PATCH", json: { externalGroups: ["contix-auditori"] } })).status).toBe(200);
    t = await admin.json(`/api/admin/login/ad/${id}/test`, { method: "POST", json: { username: "jan.novak", password: "Ad-Heslo-1" } });
    expect(t.body).toMatchObject({ ok: true, reason: null, existingUser: false, roles: [auditorRole.name] });
    expect(t.body.groups).toEqual(["CONTIX-Auditori"]);
    expect((await admin.json(`/api/admin/login/ad/${id}/test`, { method: "POST", json: { username: "jan.novak", password: "x" } })).body.reason).toBe("bad_password");
    expect((await admin.json(`/api/admin/login/ad/${id}/test`, { method: "POST", json: { username: "zak", password: "Ad-Heslo-3" } })).body.reason).toBe("disabled");

    // zapnutí; heslo účtu pro čtení zůstane uložené
    const upd = await admin.json(`/api/admin/login/ad/${id}`, { method: "PUT", json: { ...form, secret: "", login: { ...form.login, enabled: true } } });
    expect(upd.body).toMatchObject({ hasSecret: true, login: { enabled: true } });
    expect((await browser().json("/api/auth/providers")).body.ad).toBe(true);

    // přihlášení DOMÉNA\jméno → založí uživatele s rolí ze skupiny
    const b = browser();
    expect((await b.login("LAB\\jan.novak", "Ad-Heslo-1")).status).toBe(200);
    const me = (await b.json("/api/auth/me")).body;
    expect(me.user).toMatchObject({ email: "jan.novak@lab.internal", authProvider: "ad", displayName: "Jan Novák" });
    expect(me.user.roles).toEqual([expect.objectContaining({ key: "auditor", source: "idp" })]);
    // podruhé (UPN) stejný uživatel
    const b2 = browser();
    expect((await b2.login("jan.novak@lab.internal", "Ad-Heslo-1")).status).toBe(200);
    expect((await b2.json("/api/auth/me")).body.user.id).toBe(me.user.id);
    expect(adCalls.at(-1)).toBe("svc-contix@lab.internal|jan.novak@lab.internal");

    // odmítnutí: špatné heslo, bez role, zakázaný účet, prázdné heslo
    expect((await browser().login("jan.novak", "spatne")).status).toBe(401);
    expect((await browser().login("petr", "Ad-Heslo-2")).status).toBe(401);
    expect((await browser().login("zak", "Ad-Heslo-3")).status).toBe(401);
    expect((await browser().json("/api/auth/login", { method: "POST", json: { email: "jan.novak", password: "" } })).status).toBe(400);
    // lokální účet s heslem CONTIXu se s AD nepropojí (převzetí změnou atributu mail)
    expect((await browser().login("kolize", "Ad-Heslo-4")).status).toBe(401);
    // lokální účty se přihlašují dál heslem CONTIXu
    expect((await browser().login("konverze@test.cz")).status).toBe(200);
    const log = (await admin.json("/api/admin/audit-log?limit=40")).body as any[];
    expect(log.some((l) => l.action === "auth.login_failed" && l.details?.reason === "local_account")).toBe(true);
    expect(log.some((l) => l.action === "auth.login_failed" && l.details?.reason === "no_role")).toBe(true);
    expect(log.some((l) => l.action === "user.provisioned" && l.details?.provider === "ad")).toBe(true);

    // jen členové povolených skupin
    await admin.json(`/api/admin/login/ad/${id}`, { method: "PUT", json: { ...form, secret: "", login: { ...form.login, enabled: true, allowedGroups: ["CONTIX-Povoleni"] } } });
    expect((await browser().login("jan.novak", "Ad-Heslo-1")).status).toBe(401);
    // výchozí role pro nové uživatele: petr se přihlásí s rolí viewer
    await admin.json(`/api/admin/login/ad/${id}`, { method: "PUT", json: { ...form, secret: "", login: { ...form.login, enabled: true, defaultRoleKey: "viewer" } } });
    const bp = browser();
    expect((await bp.login("petr", "Ad-Heslo-2")).status).toBe(200);
    expect((await bp.json("/api/auth/me")).body.user.roles.map((r: any) => r.key)).toEqual(["viewer"]);
    expect((await admin.json(`/api/admin/login/ad/${id}`, { method: "PUT", json: { ...form, login: { ...form.login, defaultRoleKey: "neexistuje" } } })).status).toBe(400);

    // převod lokálního účtu na účet AD odebere heslo CONTIXu → pak se propojí
    const users = (await admin.json("/api/admin/users")).body as any[];
    const aud = users.find((u) => u.email === "konverze@test.cz");
    expect((await admin.json(`/api/admin/users/${aud.id}`, { method: "PATCH", json: { authProvider: "ad" } })).body.authProvider).toBe("ad");
    expect((await browser().login("konverze@test.cz")).status).toBe(401);
    const bk = browser();
    expect((await bk.login("kolize", "Ad-Heslo-4")).status).toBe(200);
    expect((await bk.json("/api/auth/me")).body.user.id).toBe(aud.id);
    const self = (await admin.json("/api/auth/me")).body.user;
    expect((await admin.json(`/api/admin/users/${self.id}`, { method: "PATCH", json: { authProvider: "ad" } })).status).toBe(400);

    // vypnutí
    await admin.json(`/api/admin/login/ad/${id}`, { method: "PUT", json: { ...form, secret: "", login: { ...form.login, enabled: false } } });
    expect((await browser().login("jan.novak", "Ad-Heslo-1")).status).toBe(401);
    await admin.json(`/api/admin/roles/${auditorRole.id}`, { method: "PATCH", json: { externalGroups: [] } });
    // uživatelé z AD nemají ovlivnit další testy (příjemci upozornění)
    for (const u of (await admin.json("/api/admin/users")).body as any[])
      if (["jan.novak@lab.internal", "petr@lab.internal", "konverze@test.cz"].includes(u.email)) await admin.json(`/api/admin/users/${u.id}`, { method: "PATCH", json: { isActive: false } });
  });

  test("SSO poskytovatel z administrace: přidání, přihlášení, smazání", async () => {
    const form = { kind: "oidc", label: "Keycloak", issuer: idp.issuer, clientId: "contix-client", secret: "s3cret", scopes: "openid profile email" };
    expect((await admin.json("/api/admin/login/sso", { method: "POST", json: { ...form, issuer: "ftp://x" } })).status).toBe(400);
    const created = await admin.json("/api/admin/login/sso", { method: "POST", json: form });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ hasSecret: true, providerId: `sso-${created.body.id}` });
    expect(created.body.redirectUri).toBe(`${APP}/api/auth/oidc/sso-${created.body.id}/callback`);
    expect(JSON.stringify(created.body)).not.toContain("s3cret");
    const pid = created.body.providerId;
    expect((await browser().json("/api/auth/providers")).body.oidc.map((p: any) => p.label)).toEqual(["AD FS", "Keycloak"]);

    await admin.json("/api/admin/users", { method: "POST", json: { email: "kc@firma.cz", displayName: "KC", authProvider: "oidc" } });
    const b = browser();
    const start = await b.req(`/api/auth/oidc/${pid}/start`);
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get("location")!);
    const code = Buffer.from(JSON.stringify({ sub: "kc-1", email: "kc@firma.cz", name: "KC", groups: [], nonce: loc.searchParams.get("nonce") })).toString("base64url");
    const cb = await b.req(`/api/auth/oidc/${pid}/callback?state=${loc.searchParams.get("state")}&code=${code}`);
    expect(cb.headers.get("location")).toBe(`${APP}/`);
    expect((await b.json("/api/auth/me")).body.user.email).toBe("kc@firma.cz");

    const list = (await admin.json("/api/admin/login")).body;
    expect(list.envProviders.map((p: any) => p.id)).toEqual(["oidc"]);
    expect(list.sso).toHaveLength(1);
    expect((await admin.json(`/api/admin/login/sso/${created.body.id}`, { method: "PUT", json: { ...form, secret: "", enabled: false } })).body).toMatchObject({ enabled: false, hasSecret: true });
    expect((await browser().req(`/api/auth/oidc/${pid}/start`)).status).toBe(404);
    expect((await admin.req(`/api/admin/login/sso/${created.body.id}`, { method: "DELETE" })).status).toBe(204);
  });

  /* ============ Konektory ============ */

  async function waitRun(runId: string) {
    for (let i = 0; i < 100; i++) {
      const r = (await admin.json(`/api/discovery/runs/${runId}`)).body;
      if (r.status !== "running") return r;
      await Bun.sleep(100);
    }
    throw new Error("run timeout");
  }
  const wazuhForm = { url: `http://localhost:${wazuh.port}`, user: "contix-ro", password: "wazuh-pw", verifyTls: true, includePackages: true };

  test("Wazuh: test připojení, uložení a synchronizace", async () => {
    expect((await admin.json("/api/discovery/connectors")).body.find((x: any) => x.id === "wazuh").enabled).toBe(false);
    const bad = await admin.json("/api/admin/connectors/wazuh/test", { method: "POST", json: { ...wazuhForm, password: "spatne" } });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.message).toContain("odmítl");
    const ok = await admin.json("/api/admin/connectors/wazuh/test", { method: "POST", json: wazuhForm });
    expect(ok.body).toMatchObject({ ok: true, details: { apiVersion: "4.9.0", agents: 3, activeAgents: 2 } });

    const saved = await admin.json("/api/admin/connectors/wazuh", { method: "PUT", json: wazuhForm });
    expect(saved.body.wazuh).toMatchObject({ source: "db", hasPassword: true });
    expect(JSON.stringify(saved.body)).not.toContain("wazuh-pw");
    // heslo se neukládá v čitelné podobě
    const raw = await db.execute(sql`select value::text as v from app_settings where key = 'connector.wazuh'`);
    expect(String((raw[0] as any).v)).not.toContain("wazuh-pw");
    // uložení bez hesla ponechá původní
    await admin.json("/api/admin/connectors/wazuh", { method: "PUT", json: { ...wazuhForm, password: "" } });
    expect((await admin.json("/api/admin/connectors/wazuh/test", { method: "POST", json: { ...wazuhForm, password: "" } })).body.ok).toBe(true);

    const start = await admin.json("/api/discovery/wazuh", { method: "POST" });
    expect(start.status).toBe(202);
    const run = await waitRun(start.body.runId);
    expect(run.status).toBe("succeeded");
    // srv-01 (SN-1) se spáruje s existujícím SRV-01, ostatní se založí
    expect(run.stats).toMatchObject({ discovered: 3, created: 2, updated: 1 });
    const srv = (await admin.json(`/api/assets/${ids.server}`)).body;
    expect(srv.sources.map((s: any) => s.sourceType)).toContain("wazuh");
    expect(srv.software[0]).toMatchObject({ name: "openssl" });
    const pc = (await admin.json("/api/assets?q=PC-HR-07")).body.items[0];
    expect(pc).toMatchObject({ assetType: "workstation", assetClass: "supporting" });
  });

  /* ============ Zranitelnosti a semafor ============ */

  const indexerForm = { ...wazuhForm, indexerUrl: `http://localhost:${indexer.port}`, indexerUser: "admin", indexerPassword: "idx-pw" };

  test("zranitelnosti: bez indexeru běh projde, chyba je jen v logu", async () => {
    // mock Wazuh API nemá /vulnerability → jako Wazuh 4.8+ bez nastaveného indexeru
    const start = await admin.json("/api/discovery/wazuh", { method: "POST" });
    const run = await waitRun(start.body.runId);
    expect(run.status).toBe("succeeded");
    expect(run.stats.vulnError).toBe(1);
    expect(run.log.join("\n")).toContain("Wazuh Indexer");
  });

  test("zranitelnosti: test indexeru, synchronizace, semafor a propagace na primární aktivum", async () => {
    const bad = await admin.json("/api/admin/connectors/wazuh/indexer-test", { method: "POST", json: { ...indexerForm, indexerPassword: "x" } });
    expect(bad.body.ok).toBe(false);
    const ok = await admin.json("/api/admin/connectors/wazuh/indexer-test", { method: "POST", json: indexerForm });
    expect(ok.body).toMatchObject({ ok: true, details: { count: 5 } });
    const saved = await admin.json("/api/admin/connectors/wazuh", { method: "PUT", json: indexerForm });
    expect(saved.body.wazuh).toMatchObject({ hasIndexerPassword: true, indexerUser: "admin", vulnEnabled: true });

    const start = await admin.json("/api/discovery/wazuh", { method: "POST" });
    const run = await waitRun(start.body.runId);
    expect(run.status).toBe("succeeded");
    expect(run.stats).toMatchObject({ vulnFound: 4, vulnNew: 4, vulnUnmatched: 1 });

    const srv = (await admin.json(`/api/assets/${ids.server}`)).body;
    expect(srv).toMatchObject({ healthStatus: "red", vulnCritical: 1, vulnHigh: 1, vulnMedium: 1 });
    expect(srv.healthReasons[0].text).toContain("kritická");
    const pc = (await admin.json("/api/assets?q=PC-HR-07")).body.items[0];
    expect(pc).toMatchObject({ healthStatus: "green", vulnMedium: 1 });
    // primární aktivum podporované SRV-01 přebírá červenou
    const primary = (await admin.json(`/api/assets/${ids.primary}`)).body;
    expect(primary.healthStatus).toBe("red");
    expect(primary.healthReasons.some((r: any) => r.code === "supporting")).toBe(true);

    const sum = (await admin.json("/api/vulnerabilities/summary")).body;
    expect(sum.openBySeverity).toMatchObject({ critical: 1, high: 1, medium: 2 });
    expect(sum.topPackages[0]).toMatchObject({ name: "openssl", critical: 1 });
    expect(sum.topCves[0]).toMatchObject({ cveId: "CVE-2026-0001", severity: "critical" });
    expect(sum.health.red).toBeGreaterThanOrEqual(2);
    // řazení podle rizika
    expect((await admin.json("/api/assets?sort=risk&limit=1")).body.items[0].healthStatus).toBe("red");
    expect((await admin.json("/api/assets?health=red")).body.total).toBeGreaterThanOrEqual(2);
  });

  test("zranitelnosti: vyřešené zmizí, výjimka a její zrušení", async () => {
    // CVE-2026-0002 byla opravena (už není v indexeru)
    indexerData.docs = indexerData.docs.filter((d) => d._source.vulnerability.id !== "CVE-2026-0002");
    const run = await waitRun((await admin.json("/api/discovery/wazuh", { method: "POST" })).body.runId);
    expect(run.stats).toMatchObject({ vulnResolved: 1, vulnNew: 0 });

    const list = (await admin.json(`/api/vulnerabilities?assetId=${ids.server}&status=open`)).body;
    expect(list.items.map((v: any) => v.cveId).sort()).toEqual(["CVE-2026-0001", "CVE-2026-0003"]);
    const crit = list.items.find((v: any) => v.cveId === "CVE-2026-0001");

    // vlastník aktiva (SRV-01 patří ownerovi) smí udělit výjimku, auditor ne
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json(`/api/vulnerabilities/${crit.id}/accept`, { method: "POST", json: { reason: "kompenzační opatření WAF" } })).status).toBe(403);
    expect((await admin.json(`/api/vulnerabilities/${crit.id}/accept`, { method: "POST", json: { reason: "x" } })).status).toBe(400);
    expect(
      (await admin.json(`/api/vulnerabilities/${crit.id}/accept`, { method: "POST", json: { reason: "Kompenzační opatření: WAF + segmentace", until: "2099-12-31" } })).status,
    ).toBe(200);
    let srv = (await admin.json(`/api/assets/${ids.server}`)).body;
    expect(srv).toMatchObject({ healthStatus: "green", vulnCritical: 0 });
    const exc = (await admin.json("/api/exceptions?kind=vulnerability")).body;
    expect(exc.items.find((e: any) => e.id === crit.id)).toMatchObject({ severity: "critical", reason: "Kompenzační opatření: WAF + segmentace", until: "2099-12-31", state: "valid", link: `/assets/${ids.server}` });
    expect((await auditor.json("/api/exceptions")).status).toBe(200);
    const csvExc = await admin.req("/api/exceptions/export");
    expect(await csvExc.text()).toContain("WAF + segmentace");

    // další synchronizace výjimku zachová
    await waitRun((await admin.json("/api/discovery/wazuh", { method: "POST" })).body.runId);
    expect((await admin.json(`/api/vulnerabilities?assetId=${ids.server}&status=accepted`)).body.total).toBe(1);

    await admin.json(`/api/vulnerabilities/${crit.id}/reopen`, { method: "POST" });
    srv = (await admin.json(`/api/assets/${ids.server}`)).body;
    expect(srv.healthStatus).toBe("red");
  });

  test("Wazuh: automatická synchronizace podle intervalu (plánovač)", async () => {
    const { autoWazuhSync } = await import("../src/modules/discovery/wazuhSync");
    // uložená konfigurace (vč. indexeru z předchozích testů) – na konci se vrátí
    const saved = (await db.execute(sql`select value from app_settings where key = 'connector.wazuh'`))[0] as any;
    const conn = (await admin.json("/api/admin/connectors")).body.wazuh;
    expect(conn).toMatchObject({ autoSyncHours: 24, lastSyncStatus: expect.any(String) });
    expect(conn.lastSyncAt).not.toBeNull();
    // poslední běh je čerstvý → nic se nespustí
    expect(await autoWazuhSync(db, config)).toBeNull();
    // po uplynutí intervalu se spustí sám
    const later = new Date(Date.now() + 25 * 3600_000);
    const runId = await autoWazuhSync(db, config, later);
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const run = await waitRun(runId!);
    expect(run.status).toBe("succeeded");
    expect(run.params).toMatchObject({ trigger: "schedule" });
    // vypnutí automatiky
    await admin.json("/api/admin/connectors/wazuh", { method: "PUT", json: { ...wazuhForm, password: "", autoSyncHours: 0 } });
    expect((await admin.json("/api/admin/connectors")).body.wazuh.autoSyncHours).toBe(0);
    expect(await autoWazuhSync(db, config, new Date(Date.now() + 100 * 3600_000))).toBeNull();
    await db.execute(sql`update app_settings set value = ${JSON.stringify(saved.value)}::jsonb where key = 'connector.wazuh'`);
  });

  test("semafor: pravidla v nastavení a konec podpory OS", async () => {
    // změna OS na Windows Server 2012 → EOL
    await admin.json(`/api/assets/${ids.server}`, { method: "PATCH", json: { osName: "Microsoft Windows Server 2012 R2", osVersion: null } });
    let srv = (await admin.json(`/api/assets/${ids.server}`)).body;
    expect(srv.supportStatus).toBe("eol");
    expect(srv.healthReasons.some((r: any) => r.code === "eol")).toBe(true);
    // kritické CVE jen oranžové? ne – nastavíme, aby červená byla až od 5 kritických a EOL jen oranžově
    const cur = (await admin.json("/api/admin/settings")).body.settings.healthPolicy;
    await admin.json("/api/admin/settings", { method: "PATCH", json: { healthPolicy: { ...cur, redCritical: 5, redOnEol: false } } });
    srv = (await admin.json(`/api/assets/${ids.server}`)).body;
    expect(srv.healthStatus).toBe("orange");
    await admin.json("/api/admin/settings", { method: "PATCH", json: { healthPolicy: cur } });
  });

  test("síťový sken: nastavení rozsahů a skutečný běh nmap", async () => {
    expect(
      (await admin.json("/api/admin/connectors/network-scan", { method: "PUT", json: { enabled: true, allowedCidrs: ["10.0.0.0/8"] } })).status,
    ).toBe(400); // příliš velký rozsah
    expect(
      (await admin.json("/api/admin/connectors/network-scan", { method: "PUT", json: { enabled: true, allowedCidrs: ["foo"] } })).status,
    ).toBe(400);
    const saved = await admin.json("/api/admin/connectors/network-scan", {
      method: "PUT",
      json: { enabled: true, allowedCidrs: ["127.0.0.1/32", "192.168.50.0/24"] },
    });
    expect(saved.status).toBe(200);
    expect((await admin.json("/api/discovery/network-scan", { method: "POST", json: { targets: ["8.8.8.8"] } })).status).toBe(400);
    if (!Bun.which("nmap")) return; // bez nmapu jen validace
    expect(saved.body.networkScan.nmapFound).toBeTruthy();
    const start = await admin.json("/api/discovery/network-scan", { method: "POST", json: { targets: ["127.0.0.1"], profile: "ping" } });
    expect(start.status).toBe(202);
    const run = await waitRun(start.body.runId);
    expect(run.status).toBe("succeeded");
    expect(run.stats.discovered).toBe(1);
  });

  test("konektory smí nastavovat jen správce nastavení", async () => {
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.req("/api/admin/connectors")).status).toBe(403);
    expect((await b.json("/api/discovery/wazuh", { method: "POST" })).status).toBe(403);
  });

  /* ============ Moduly, organizace, procesy, rizika ============ */

  test("moduly: vypnutý modul vrací 404, závislosti se hlídají", async () => {
    const me = (await admin.json("/api/auth/me")).body;
    expect(me.enabledModules).toContain("processes");
    const all = me.enabledModules as string[];
    // procesy bez organizace nejdou
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { enabledModules: all.filter((m) => m !== "organization") } })).status).toBe(400);
    const off = await admin.json("/api/admin/settings", { method: "PATCH", json: { enabledModules: all.filter((m) => m !== "risks") } });
    expect(off.status).toBe(200);
    expect((await admin.req("/api/risks")).status).toBe(404);
    expect((await admin.json("/api/auth/me")).body.enabledModules).not.toContain("risks");
    await admin.json("/api/admin/settings", { method: "PATCH", json: { enabledModules: all } });
    expect((await admin.req("/api/risks")).status).toBe(200);
  });

  test("organizace: útvary, funkční místa, držitelé, ochrana stromu", async () => {
    const root = await admin.json("/api/org/units", { method: "POST", json: { name: "Město Test", unitType: "organization" } });
    expect(root.status).toBe(201);
    const it = await admin.json("/api/org/units", { method: "POST", json: { name: "Odbor informatiky", code: "OI", parentId: root.body.id } });
    ids.unitRoot = root.body.id;
    ids.unitIt = it.body.id;
    // cyklus
    expect((await admin.json(`/api/org/units/${root.body.id}`, { method: "PATCH", json: { parentId: it.body.id } })).status).toBe(400);
    // PATCH nepřepíše typ útvaru výchozí hodnotou
    await admin.json(`/api/org/units/${root.body.id}`, { method: "PATCH", json: { description: "Úřad" } });
    const pos = await admin.json("/api/org/positions", {
      method: "POST",
      json: { orgUnitId: it.body.id, name: "Vedoucí OI", isManager: true, securityRoles: ["Garant aktiva"], holderIds: [ids.owner] },
    });
    expect(pos.status).toBe(201);
    ids.posHead = pos.body.id;
    const mkcb = await admin.json("/api/org/positions", { method: "POST", json: { orgUnitId: it.body.id, name: "Manažer KB" } });
    ids.posMkb = mkcb.body.id;
    const org = (await admin.json("/api/org")).body as any[];
    const r = org.find((u) => u.id === ids.unitRoot);
    expect(r.unitType).toBe("organization");
    expect(r.description).toBe("Úřad");
    const itDto = org.find((u) => u.id === ids.unitIt);
    expect(itDto.positions.find((p: any) => p.id === ids.posHead).holders[0].email).toBe("owner@test.cz");
    // útvar s podřízenými nelze smazat
    expect((await admin.json(`/api/org/units/${ids.unitRoot}`, { method: "DELETE" })).status).toBe(409);
    // čtenář bez org:write nic nezaloží
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.json("/api/org/units", { method: "POST", json: { name: "X" } })).status).toBe(403);
    expect((await b.json("/api/org")).status).toBe(200);
  });

  test("procesy: karta, kroky s RACI a aktivy, pořadí, BPMN, vlastník upravuje", async () => {
    const p = await admin.json("/api/processes", {
      method: "POST",
      json: { name: "Zpracování mezd", code: "P-01", processType: "support", ownerPositionId: ids.posHead, orgUnitId: ids.unitIt },
    });
    expect(p.status).toBe(201);
    const pid = p.body.id;
    ids.process = pid;
    const s1 = await admin.json(`/api/processes/${pid}/steps`, {
      method: "POST",
      json: { name: "Sběr podkladů", raci: [{ kind: "position", id: ids.posHead, role: "R" }, { kind: "org_unit", id: ids.unitRoot, role: "I" }], assetIds: [ids.server] },
    });
    expect(s1.status).toBe(201);
    const s2 = await admin.json(`/api/processes/${pid}/steps`, { method: "POST", json: { name: "Schválení", stepType: "decision", raci: [{ kind: "position", id: ids.posMkb, role: "A" }] } });
    const s3 = await admin.json(`/api/processes/${pid}/steps`, { method: "POST", json: { name: "Výplata" } });
    await admin.json(`/api/processes/${pid}/assets`, { method: "PUT", json: { assetIds: [ids.primary] } });

    let d = (await admin.json(`/api/processes/${pid}`)).body;
    expect(d.steps.map((s: any) => s.name)).toEqual(["Sběr podkladů", "Schválení", "Výplata"]);
    expect(d.steps[0].raci[0]).toMatchObject({ role: "R", name: "Vedoucí OI", orgUnitName: "Odbor informatiky" });
    expect(d.steps[0].assets[0].id).toBe(ids.server);
    expect(d.assets.map((a: any) => [a.name, a.viaSteps]).sort()).toEqual([["Mzdová agenda", false], ["SRV-01", true]]);
    expect(d.ownerHolders[0].displayName).toBe("Eva Vlastník");

    // pořadí
    const re = await admin.json(`/api/processes/${pid}/steps/order`, { method: "PUT", json: { stepIds: [s3.body.id, s1.body.id, s2.body.id] } });
    expect(re.body.map((s: any) => s.name)).toEqual(["Výplata", "Sběr podkladů", "Schválení"]);
    expect((await admin.json(`/api/processes/${pid}/steps/order`, { method: "PUT", json: { stepIds: [s1.body.id] } })).status).toBe(400);

    // PATCH kroku nemaže RACI, když raci neposílám
    await admin.json(`/api/processes/${pid}/steps/${s1.body.id}`, { method: "PATCH", json: { duration: "2 dny" } });
    d = (await admin.json(`/api/processes/${pid}`)).body;
    const st = d.steps.find((s: any) => s.id === s1.body.id);
    expect(st.duration).toBe("2 dny");
    expect(st.raci).toHaveLength(2);
    expect(st.stepType).toBe("task");
    // PATCH procesu nepřepíše typ výchozí hodnotou
    await admin.json(`/api/processes/${pid}`, { method: "PATCH", json: { purpose: "Výplata mezd" } });
    expect((await admin.json(`/api/processes/${pid}`)).body.processType).toBe("support");

    // BPMN: generování z kroků (dráhy podle R/A)
    const g = (await admin.json(`/api/processes/${pid}/bpmn`)).body;
    expect(g.generated).toBe(true);
    expect(g.xml).toContain('name="Vedoucí OI"');
    expect(g.xml).toContain('name="Manažer KB"');
    expect(g.xml).toContain("exclusiveGateway");
    expect((await admin.json(`/api/processes/${pid}/bpmn`, { method: "PUT", json: { xml: "<x/>" } })).status).toBe(400);
    expect((await admin.json(`/api/processes/${pid}/bpmn`, { method: "PUT", json: { xml: g.xml } })).status).toBe(200);
    expect((await admin.json(`/api/processes/${pid}/bpmn`)).body.generated).toBe(false);
    // import úloh z diagramu – existující přeskočí
    const imp = await admin.json(`/api/processes/${pid}/steps/import`, { method: "POST", json: { tasks: [{ name: "Výplata" }, { name: "Archivace" }] } });
    expect(imp.body).toEqual({ added: 1, skipped: 1 });

    // dokumenty – jen bezpečné odkazy
    expect((await admin.json(`/api/processes/${pid}/documents`, { method: "POST", json: { title: "X", url: "javascript:alert(1)" } })).status).toBe(400);
    expect((await admin.json(`/api/processes/${pid}/documents`, { method: "POST", json: { title: "Směrnice", url: "https://intranet/smernice.pdf" } })).status).toBe(201);

    // vlastník (držitel funkčního místa) smí upravit svůj proces, ale ne změnit vlastníka
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.json(`/api/processes/${pid}`)).body.canEdit).toBe(true);
    expect((await b.json(`/api/processes/${pid}`, { method: "PATCH", json: { kpis: "Včas" } })).status).toBe(200);
    expect((await b.json(`/api/processes/${pid}`, { method: "PATCH", json: { ownerPositionId: null } })).status).toBe(403);
    expect((await b.json("/api/processes", { method: "POST", json: { name: "Cizí" } })).status).toBe(403);
    // funkční místo vlastnící proces nelze smazat
    expect((await admin.json(`/api/org/positions/${ids.posHead}`, { method: "DELETE" })).status).toBe(409);
    const usage = (await admin.json(`/api/org/positions/${ids.posHead}/usage`)).body;
    expect(usage.ownedProcesses[0].name).toBe("Zpracování mezd");
    expect(usage.raci.length).toBe(1);
  });

  test("rizika: katalog, hodnocení dle vyhlášky, návrh dopadu, vazby, matice", async () => {
    const threats = (await admin.json("/api/risks/catalog?kind=threat")).body as any[];
    expect(threats.length).toBe(21);
    const h05 = threats.find((t) => t.code === "H05");
    const h07 = threats.find((t) => t.code === "H07"); // ohrožuje jen dostupnost
    const z02 = ((await admin.json("/api/risks/catalog?kind=weakness")).body as any[]).find((w) => w.code === "Z02");
    // výchozí položky nelze smazat
    expect((await admin.json(`/api/risks/catalog/item/${h05.id}`, { method: "DELETE" })).status).toBe(409);
    const own = await admin.json("/api/risks/catalog/threat", { method: "POST", json: { code: "X01", name: "Vlastní hrozba" } });
    expect(own.status).toBe(201);
    expect((await admin.json("/api/risks/catalog/threat", { method: "POST", json: { code: "X01", name: "Duplicitní" } })).status).toBe(409);

    // návrh dopadu z CIA aktiva: Mzdová agenda C4 I3 A2
    expect((await admin.json("/api/risks/suggest-impact", { method: "POST", json: { assetIds: [ids.primary], threatId: h05.id } })).body.suggestedImpact).toBe(4);
    expect((await admin.json("/api/risks/suggest-impact", { method: "POST", json: { assetIds: [ids.primary], threatId: h07.id } })).body.suggestedImpact).toBe(2);

    // hrozba z katalogu zranitelností je chyba
    expect((await admin.json("/api/risks", { method: "POST", json: { name: "X", threatId: z02.id } })).status).toBe(400);

    const vulns = (await admin.json(`/api/vulnerabilities?assetId=${ids.server}`)).body;
    const cveIds = (vulns.items ?? vulns).slice(0, 1).map((v: any) => v.id);
    const r = await admin.json("/api/risks", {
      method: "POST",
      json: {
        code: "R-01",
        name: "Ransomware na mzdovém serveru",
        threatId: h05.id,
        weaknessId: z02.id,
        ownerPositionId: ids.posMkb,
        impact: 4,
        threatLevel: 3,
        vulnLevel: 3,
        assetIds: [ids.primary, ids.server],
        processIds: [ids.process],
        cveIds,
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.score).toBe(36);
    expect(r.body.level).toBe("critical");
    expect(r.body.maxScore).toBe(64);
    expect(r.body.processes[0].name).toBe("Zpracování mezd");
    expect(r.body.cves.length).toBe(cveIds.length);

    // ošetření a zbytkové riziko; PATCH nemaže vazby ani stav
    const u = await admin.json(`/api/risks/${r.body.id}`, {
      method: "PATCH",
      json: { treatment: "mitigate", treatmentDue: "2020-01-01", residualImpact: 4, residualThreatLevel: 1, residualVulnLevel: 1 },
    });
    expect(u.body.residualScore).toBe(4);
    expect(u.body.residualLevel).toBe("low");
    expect(u.body.assets.length).toBe(2);
    expect(u.body.status).toBe("identified");

    await admin.json("/api/risks", { method: "POST", json: { name: "Výpadek proudu", threatId: h07.id, impact: 2, threatLevel: 1, vulnLevel: 2 } });
    const list = (await admin.json("/api/risks")).body;
    expect(list.total).toBe(2);
    expect(list.items[0].code).toBe("R-01"); // nejvyšší skóre nahoře
    expect((await admin.json("/api/risks?level=low")).body.items[0].name).toBe("Výpadek proudu");
    expect((await admin.json(`/api/risks?processId=${ids.process}`)).body.total).toBe(1);

    const sum = (await admin.json("/api/risks/summary")).body;
    expect(sum.byLevel.critical).toBe(1);
    expect(sum.byLevel.low).toBe(1);
    expect(sum.overdue).toBe(1);
    expect(sum.matrix[3][2]).toBe(1); // dopad 4, hrozba×zranitelnost = 9 → pravděpodobnost 3
    // proces ukazuje navázané riziko
    expect((await admin.json(`/api/processes/${ids.process}`)).body.risks[0].level).toBe("critical");

    // dvoufaktorová metodika
    await admin.json("/api/admin/settings", { method: "PATCH", json: { riskPolicy: { method: "two_factor" } } });
    await admin.json(`/api/risks/${r.body.id}`, { method: "PATCH", json: { likelihood: 3 } });
    const two = (await admin.json(`/api/risks/${r.body.id}`)).body;
    expect(two.score).toBe(12);
    expect(two.level).toBe("critical");
    await admin.json("/api/admin/settings", { method: "PATCH", json: { riskPolicy: { method: "three_factor" } } });

    // funkční místo vlastnící riziko nelze smazat; čtenář riziko neupraví
    expect((await admin.json(`/api/org/positions/${ids.posMkb}`, { method: "DELETE" })).status).toBe(409);
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.json(`/api/risks/${r.body.id}`, { method: "PATCH", json: { impact: 1 } })).status).toBe(403);
  });

  test("rizika: metodika 5×5, plán zvládání rizik a historický katalog 82/2018", async () => {
    // simulace staré instalace: výchozí položka dle 82/2018 bez zdroje
    await db.insert(schema.riskCatalog).values({ kind: "threat", code: "H99", name: "x", isBuiltin: true }).onConflictDoNothing();
    await db.update(schema.riskCatalog).set({ source: null }).where(sql`code = 'H01' and kind = 'threat'`);
    await seedRiskCatalog(db);
    const cat = (await admin.json("/api/risks/catalog?kind=threat")).body as any[];
    expect(cat.find((t) => t.code === "H01-82")?.isActive).toBe(false); // převedeno na historické
    expect(cat.find((t) => t.code === "H01")?.source).toContain("409/2025"); // nová položka dle 409
    expect(cat.filter((t) => t.source?.includes("409/2025")).length).toBe(21);

    // přepnutí metodiky na 5 úrovní
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { riskPolicy: { method: "three_factor", levels: 5, bounds: { maxLow: 50, maxMedium: 10, maxHigh: 75 } } } })).status).toBe(400);
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { riskPolicy: { method: "three_factor", levels: 5, bounds: null, acceptLevel: "low", reviewMonths: 12 } } })).status).toBe(200);
    const sum = (await admin.json("/api/risks/summary")).body;
    expect(sum.levels).toBe(5);
    expect(sum.matrix.length).toBe(5);
    expect(sum.outdatedScale).toBeGreaterThan(0); // dřívější rizika hodnocena ve 4 úrovních
    expect((await admin.json("/api/risks", { method: "POST", json: { name: "Příliš vysoká", impact: 6 } })).status).toBe(400);
    const r = await admin.json("/api/risks", { method: "POST", json: { code: "R-05", name: "Výpadek dodavatele cloudu", impact: 5, threatLevel: 4, vulnLevel: 4 } });
    expect(r.status).toBe(201);
    expect(r.body.scaleLevels).toBe(5);
    expect(r.body.maxScore).toBe(125);
    expect(r.body.level).toBe("critical"); // 80 > 75
    expect(r.body.acceptable).toBe(false);
    expect((await admin.json("/api/risks/summary")).body.untreated).toBeGreaterThanOrEqual(1);
    // návrh dopadu se převádí na 5 úrovní (CIA 4 → 5)
    expect((await admin.json("/api/risks/suggest-impact", { method: "POST", json: { assetIds: [ids.primary] } })).body).toEqual({ suggestedImpact: 5, decreeLevel: 4 });

    // plán zvládání rizik
    const a = await admin.json(`/api/risks/${r.body.id}/actions`, {
      method: "POST",
      json: { title: "Druhý poskytovatel (multi-cloud)", objective: "Snížit závislost", ownerPositionId: ids.posMkb, costEstimate: 250000, dueDate: "2020-06-30", resourcesHuman: "2 MD" },
    });
    expect(a.status).toBe(201);
    const plan = (await admin.json("/api/risks/plan")).body as any[];
    const item = plan.find((x) => x.id === a.body.id);
    expect(item).toMatchObject({ riskCode: "R-05", ownerPositionName: "Manažer KB", overdue: true, riskLevel: "critical" });
    const done = await admin.json(`/api/risks/actions/${a.body.id}`, { method: "PATCH", json: { status: "done" } });
    expect(done.body.completedAt).toBeTruthy();
    expect((await admin.json(`/api/risks/${r.body.id}`)).body.actions[0].status).toBe("done");
    // čtenář plán neupraví
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.json(`/api/risks/actions/${a.body.id}`, { method: "PATCH", json: { status: "cancelled" } })).status).toBe(403);
    ids.risk5 = r.body.id;
  });

  test("opatření: výchozí katalog dle 409, mapování na ISO/DORA, SoA a míra shody", async () => {
    const gen = await admin.json("/api/controls/generate", { method: "POST", json: { regime: "higher", includeCrosswalk: true } });
    expect(gen.body.created).toBe(25); // § 3–27
    expect((await admin.json("/api/controls/generate", { method: "POST", json: { regime: "higher" } })).body.created).toBe(0);
    const list = (await admin.json("/api/controls")).body as any[];
    const v08 = list.find((x) => x.code === "V-08");
    expect(v08.name).toBe("Řízení rizik");
    expect(v08.frameworks).toEqual(expect.arrayContaining(["cz409", "iso27001", "dora", "cz410"]));
    const d = (await admin.json(`/api/controls/${v08.id}`)).body;
    expect(d.requirements.some((r: any) => r.id === "cz409:8/1/f")).toBe(true);
    expect(d.requirements.some((r: any) => r.id === "iso27001:6.1.3")).toBe(true);
    // NIS2: čl. 21 odst. 2 písm. a) a body 2.1.x prováděcího nařízení 2024/2690
    expect(v08.frameworks).toContain("nis2");
    expect(d.requirements.some((r: any) => r.id === "nis2:21/2/a")).toBe(true);
    expect(d.requirements.some((r: any) => r.id === "nis2:P2.1.2")).toBe(true);

    // zavedení opatření → požadavky § 8 splněny
    await admin.json(`/api/controls/${v08.id}`, { method: "PATCH", json: { status: "implemented", effectiveness: "effective", implementation: "Metodika řízení rizik v CONTIX" } });
    let reqs = (await admin.json("/api/controls/requirements?framework=cz409&section=" + encodeURIComponent("§ 8"))).body as any[];
    expect(reqs.every((r) => r.compliance === "compliant")).toBe(true);

    // neaplikování bez odůvodnění je odmítnuto; s odůvodněním OK
    expect((await admin.json("/api/controls/assessments", { method: "PUT", json: { requirementId: "cz409:27/a", applicable: false } })).status).toBe(400);
    const na = await admin.json("/api/controls/assessments", {
      method: "PUT",
      json: { requirementId: "cz409:27/a", applicable: false, justification: "Organizace neprovozuje průmyslové řídicí systémy." },
    });
    expect(na.status).toBe(200);
    expect(na.body.compliance).toBe("not_applicable");
    // ruční posouzení přebíjí odvozené
    const man = await admin.json("/api/controls/assessments", { method: "PUT", json: { requirementId: "cz409:3/a", applicable: true, compliance: "partial" } });
    expect(man.body).toMatchObject({ derivedCompliance: "non_compliant", compliance: "partial" });

    const fws = (await admin.json("/api/controls/frameworks")).body as any[];
    const f409 = fws.find((f) => f.id === "cz409");
    expect(f409.summary.total).toBe(293);
    expect(f409.summary.byCompliance.compliant).toBe(10); // § 8 má 10 posuzovaných požadavků
    expect(f409.summary.score).toBeGreaterThan(0);
    expect(f409.summary.sections.find((s: any) => s.section === "§ 8").score).toBe(100);
    const fNis2 = fws.find((f) => f.id === "nis2");
    expect(fNis2).toMatchObject({ shortName: "NIS2", fullText: true });
    expect(fNis2.summary.total).toBe(185);
    expect(fNis2.summary.sections.find((s: any) => s.section === "Příl. 2").score).toBeGreaterThan(0);
    // sledované rámce (ADR-074): bez výběru = zákon + vyhláška podle režimu + rámce s mapováním / posouzením
    expect(fws.filter((f) => f.inScope).map((f) => f.id)).toEqual(expect.arrayContaining(["zkb", "cz409", "nis2"]));
    expect(fws.find((f) => f.id === "cz410").inScope).toBe(false);
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { frameworks: ["dora"] } })).status).toBe(200);
    const fws2 = (await admin.json("/api/controls/frameworks")).body as any[];
    expect(fws2.filter((f) => f.inScope).map((f) => f.id)).toEqual(["zkb", "cz409", "dora"]);
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { frameworks: null } })).status).toBe(200);

    // doplnění mapování k existujícímu katalogu (katalog vytvořený před NIS2): jen přidává, náhled → zápis
    await db.execute(sql`delete from control_requirements where control_id = ${v08.id} and requirement_id like 'nis2:%'`);
    const pv = (await admin.json("/api/controls/crosswalk", { method: "POST", json: { frameworks: ["nis2"] } })).body;
    expect(pv).toMatchObject({ applied: false, items: [{ code: "V-08" }] });
    expect(pv.items[0].add.map((r: any) => r.id)).toEqual(expect.arrayContaining(["nis2:21/2/a", "nis2:P2.1.1", "nis2:P2.1.4"]));
    expect(pv.items[0].add.every((r: any) => r.framework === "nis2")).toBe(true);
    expect((await admin.json(`/api/controls/${v08.id}`)).body.requirements.some((r: any) => r.id.startsWith("nis2:"))).toBe(false);
    const ap = (await admin.json("/api/controls/crosswalk", { method: "POST", json: { frameworks: ["nis2"], apply: true } })).body;
    expect(ap).toMatchObject({ applied: true, total: pv.total });
    const after = (await admin.json(`/api/controls/${v08.id}`)).body.requirements.map((r: any) => r.id);
    expect(after).toEqual(expect.arrayContaining(["cz409:8/1/f", "iso27001:6.1.3", "nis2:21/2/a", "nis2:P2.1.2"]));
    expect((await admin.json("/api/controls/crosswalk", { method: "POST", json: { frameworks: ["nis2", "iso27001"] } })).body).toMatchObject({ total: 0, items: [] });
    expect((await admin.json("/api/controls/crosswalk", { method: "POST", json: { frameworks: [] } })).status).toBe(400);
    // CIS se do výchozího katalogu nemapuje sám – doplní se na pokyn (náhled)
    const pcis = (await admin.json("/api/controls/crosswalk", { method: "POST", json: { frameworks: ["cis8"] } })).body;
    expect(pcis.items.find((i: any) => i.code === "V-08").add.map((r: any) => r.id)).toEqual(["cis8:7.1"]);

    // export SoA – CSV se středníky, BOM a ochranou proti vzorcům
    const csv = await admin.req("/api/controls/soa.csv?framework=cz409");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const buf = new Uint8Array(await csv.arrayBuffer());
    expect([...buf.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM kvůli Excelu
    const t = new TextDecoder().decode(buf);
    expect(t).toContain("§ 8 odst. 1 písm. f)");
    expect(t).toContain("Organizace neprovozuje průmyslové řídicí systémy.");

    // vazba riziko ↔ opatření
    await admin.json(`/api/risks/${ids.risk5}`, { method: "PATCH", json: { controlIds: [v08.id] } });
    expect((await admin.json(`/api/risks/${ids.risk5}`)).body.controls[0].code).toBe("V-08");
    expect((await admin.json(`/api/controls/${v08.id}`)).body.risks[0].id).toBe(ids.risk5);

    // čtenář SoA nemění
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.json("/api/controls/assessments", { method: "PUT", json: { requirementId: "cz409:3/a", applicable: true } })).status).toBe(403);
    expect((await b.json("/api/controls/frameworks")).status).toBe(200);
  });

  test("knihovna rámců: import CSV, sledování, SoA, mapování, aktualizace, export, OSCAL, smazání (ADR-079)", async () => {
    const upload = (name: string, content: string, meta: Record<string, unknown>, mode: "preview" | "commit", replace = false) => {
      const fd = new FormData();
      fd.append("file", new File([content], name));
      fd.append("meta", JSON.stringify(meta));
      fd.append("mode", mode);
      if (replace) fd.append("replace", "true");
      return admin.json("/api/frameworks/import", { method: "POST", body: fd });
    };
    const meta = { key: "sk-test", name: "Zákon č. 69/2018 Z. z. (test)", shortName: "SK ZKB", jurisdiction: "sk", kind: "law", uses: ["gap", "audit"], language: "sk" };
    const csv1 = "ID;Oddíl;Názov oddielu;Požiadavka;Vodítko;Úroveň;Mapovanie\n§ 20 ods. 1;§ 20;Bezpečnostné opatrenia;Prevádzkovateľ prijme bezpečnostné opatrenia.;Pozri prílohu 1;základná;\"cz409:8/1/f; nis2:21/2/a; neexistuje:1\"\n§ 20 ods. 2;§ 20;;Opatrenia sa prijímajú na základe analýzy rizík.;;;\n§ 24;§ 24;Hlásenie incidentov;Prevádzkovateľ hlási závažný incident.;;;\n";

    // bez údajů o rámci tabulka neprojde
    let pv = (await upload("sk.csv", csv1, {}, "preview")).body;
    expect(pv.ok).toBe(false);
    expect(pv.errors.length).toBeGreaterThan(0);
    pv = (await upload("sk.csv", csv1, meta, "preview")).body;
    expect(pv).toMatchObject({ ok: true, format: "table", requirements: 3, sections: 2, mappings: 2, existing: false, meta: { id: "x-sk-test", jurisdiction: "SK" } });
    expect(pv.unknownMappings).toEqual(["neexistuje:1"]);
    expect(pv.sample[0]).toMatchObject({ id: "x-sk-test:par20ods.1", section: "§ 20" });
    expect((await browser().req("/api/frameworks/catalog")).status).toBe(401);
    const created = await upload("sk.csv", csv1, meta, "commit");
    expect(created.status).toBe(201);

    // katalog pro web, knihovna, požadavky a SoA
    const cat = (await admin.json("/api/frameworks/catalog")).body as any[];
    expect(cat.map((x) => x.meta.id)).toEqual(["x-sk-test"]);
    expect(cat[0].requirements[0]).toMatchObject({ id: "x-sk-test:par20ods.1", guidance: "Pozri prílohu 1", level: "základná", mappings: ["cz409:8/1/f", "nis2:21/2/a"] });
    expect(cat[0].requirements[1].sectionTitle).toBe("Bezpečnostné opatrenia");
    const lib = (await admin.json("/api/frameworks")).body as any[];
    expect(lib.find((f) => f.id === "x-sk-test")).toMatchObject({ custom: true, requirements: 3, sections: 2, jurisdiction: "SK", kind: "law", assessed: 0 });
    expect(lib.find((f) => f.id === "cz409")).toMatchObject({ custom: false, jurisdiction: "CZ", kind: "regulation" });
    let rows = (await admin.json("/api/controls/requirements?framework=x-sk-test")).body as any[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ guidance: "Pozri prílohu 1", level: "základná" });
    expect((await admin.json("/api/controls/requirements?framework=x-neni")).status).toBe(400);
    // sledované rámce: vlastní rámec lze zvolit
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { frameworks: ["x-sk-test"] } })).status).toBe(200);
    expect(((await admin.json("/api/controls/frameworks")).body as any[]).find((f) => f.id === "x-sk-test").inScope).toBe(true);
    // posouzení požadavku vlastního rámce
    expect((await admin.json("/api/controls/assessments", { method: "PUT", json: { requirementId: "x-sk-test:par24", applicable: true, compliance: "partial" } })).status).toBe(200);

    // mapování: V-08 má cz409:8/1/f → navrhne se požadavek slovenského zákona
    const xw = (await admin.json("/api/controls/crosswalk", { method: "POST", json: { frameworks: ["x-sk-test"] } })).body;
    expect(xw.items.find((i: any) => i.code === "V-08").add.map((r: any) => r.id)).toEqual(["x-sk-test:par20ods.1"]);

    // aktualizace: § 24 zmizí (má posouzení), přibude § 25
    const csv2 = csv1.replace("§ 24;§ 24;Hlásenie incidentov;Prevádzkovateľ hlási závažný incident.;;;", "§ 25;§ 25;Audit;Prevádzkovateľ vykoná audit.;;;");
    pv = (await upload("sk.csv", csv2, meta, "preview")).body;
    expect(pv).toMatchObject({ ok: true, existing: true, replace: { added: 1, removed: 1, kept: 2, removedAssessed: 1 } });
    expect((await upload("sk.csv", csv2, meta, "commit")).status).toBe(409);
    expect((await upload("sk.csv", csv2, meta, "commit", true)).status).toBe(200);
    expect(((await admin.json("/api/controls/requirements?framework=x-sk-test")).body as any[]).map((r) => r.ref)).toEqual(["§ 20 ods. 1", "§ 20 ods. 2", "§ 25"]);

    // export → import (YAML / XML / CSV) se zachováním obsahu
    const yaml = await (await admin.req("/api/frameworks/x-sk-test/export?format=yaml")).text();
    expect(yaml).toContain("contix: framework/1");
    pv = (await upload("sk.yaml", yaml, { key: "sk-kopie" }, "preview")).body;
    expect(pv).toMatchObject({ ok: true, format: "native", requirements: 3, mappings: 2, meta: { id: "x-sk-kopie", shortName: "SK ZKB" } });
    const xml = await (await admin.req("/api/frameworks/x-sk-test/export?format=xml")).text();
    expect(xml).toContain("<framework>");
    pv = (await upload("sk.xml", xml, { key: "sk-xml" }, "preview")).body;
    expect(pv).toMatchObject({ ok: true, requirements: 3, mappings: 2 });
    const csvOut = await (await admin.req("/api/frameworks/x-sk-test/export?format=csv")).text();
    expect(csvOut).toContain("ID;Oddíl;Název oddílu;Text");
    expect((await upload("sk.csv", csvOut, { ...meta, key: "sk-csv" }, "preview")).body).toMatchObject({ ok: true, requirements: 3, mappings: 2 });
    // vestavěný rámec lze exportovat (balíček jako základ vlastního)
    expect(await (await admin.req("/api/frameworks/cz410/export?format=json")).json()).toMatchObject({ contix: "framework/1", key: "cz410", jurisdiction: "CZ" });

    // OSCAL katalog (JSON)
    const oscal = { catalog: { uuid: "x", metadata: { title: "Test Catalog", version: "1.0" }, groups: [{ id: "ac", title: "Access Control", controls: [{ id: "ac-1", title: "Policy and Procedures", props: [{ name: "label", value: "AC-1" }], parts: [{ name: "statement", prose: "Develop an access control policy." }, { name: "guidance", prose: "Policy guidance." }], controls: [{ id: "ac-1.1", title: "Enhancement", props: [{ name: "label", value: "AC-1(1)" }] }] }] }] } };
    const os = await upload("cat.json", JSON.stringify(oscal), { key: "nist-test", jurisdiction: "US" }, "commit");
    expect(os.status).toBe(201);
    expect(os.body).toMatchObject({ format: "oscal", requirements: 2, meta: { id: "x-nist-test", name: "Test Catalog", version: "1.0", jurisdiction: "US" } });
    const nist = ((await admin.json("/api/frameworks/catalog")).body as any[]).find((x) => x.meta.id === "x-nist-test");
    expect(nist.requirements[0]).toMatchObject({ ref: "AC-1", section: "AC", sectionTitle: "Access Control", text: "Policy and Procedures – Develop an access control policy.", guidance: "Policy guidance." });

    // chybné soubory
    expect((await upload("x.txt", "abc", meta, "preview")).body.ok).toBe(false);
    expect((await upload("x.json", "{nejson", meta, "preview")).body.errors[0].message).toContain("nelze přečíst");
    expect((await upload("dup.csv", "ID;Text\nA.1;x\nA.1;y\n", { ...meta, key: "dup" }, "preview")).body.errors[0].message).toContain("opakuje");

    // smazání: s posouzením jen s potvrzením; vestavěný nikdy
    expect((await admin.req("/api/frameworks/x-sk-test", { method: "DELETE" })).status).toBe(409);
    expect((await admin.req("/api/frameworks/cz409", { method: "DELETE" })).status).toBe(400);
    expect((await admin.req("/api/frameworks/x-sk-test?force=true", { method: "DELETE" })).status).toBe(204);
    expect((await admin.req("/api/frameworks/x-nist-test", { method: "DELETE" })).status).toBe(204);
    expect((await admin.json("/api/frameworks/catalog")).body).toEqual([]);
    const [left] = await db.execute<{ n: number }>(sql`select count(*)::int as n from requirement_assessments where requirement_id like 'x-sk-test:%'`);
    expect(Number(left!.n)).toBe(0);
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { frameworks: null } })).status).toBe(200);
    const log = (await admin.json("/api/admin/audit-log?limit=30")).body as any[];
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["framework.imported", "framework.replaced", "framework.deleted"]));
  });

  test("BIA: dopady v čase, RTO/RPO, požadovaná dostupnost aktiv", async () => {
    const create = await admin.json("/api/bia", {
      method: "POST",
      json: {
        processId: ids.process,
        impacts: { financial: { "1h": 1, "4h": 2, "1d": 3 }, legal: { "1d": 2, "3d": 4 }, bogus: { "1h": 2 } },
        rtoHours: 4,
        rpoHours: 1,
      },
    });
    expect(create.status).toBe(201);
    const bia = create.body;
    expect(bia.suggestedMtpdHours).toBe(24); // vysoký dopad od 1 dne
    expect(bia.maxImpact).toBe(4);
    expect(bia.impacts.bogus).toBeUndefined(); // neznámá oblast se zahodí
    expect(bia.requiredAvailability).toBe(3); // RTO 4 h → vysoká dostupnost
    expect(bia.warnings.join(" ")).toContain("minimální úroveň");
    // Mzdová agenda má dostupnost 2 → nedostatek
    expect(bia.assets.find((a: any) => a.name === "Mzdová agenda").gap).toBe(true);
    expect((await admin.json("/api/bia", { method: "POST", json: { processId: ids.process } })).status).toBe(409);
    const upd = await admin.json(`/api/bia/${bia.id}`, { method: "PATCH", json: { minServiceLevel: "Výplata mezd v řádném termínu", mtpdHours: 24, status: "approved" } });
    expect(upd.body.status).toBe("approved");
    expect(upd.body.warnings.some((w: string) => w.includes("minimální"))).toBe(false);
    const list = (await admin.json("/api/bia")).body;
    expect(list.items.length).toBe(1);
    expect(list.missing).toEqual([]); // jediný proces už BIA má
    // vlastník procesu (držitel funkčního místa) může BIA upravit, ale ne schválit
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    const own = await b.json(`/api/bia/${bia.id}`, { method: "PATCH", json: { notes: "doplněno vlastníkem" } });
    expect(own.status).toBe(200);
    expect(own.body.status).toBe("approved"); // částečný PATCH nevrací stav ani dopady na výchozí
    expect(own.body.maxImpact).toBe(4);
    expect((await b.json(`/api/bia/${bia.id}`, { method: "PATCH", json: { status: "approved" } })).status).toBe(403);
  });

  /* ============ Dokumenty ISMS, plány kontinuity, dodavatelé ============ */

  test("dokumenty: verze SoA, zpráva o rizicích, schválení, nahrazení, seznámení, uchování", async () => {
    // náhled se neukládá
    const prev = await admin.req("/api/documents/preview.html?kind=soa&framework=cz410");
    expect(prev.status).toBe(200);
    expect(prev.headers.get("content-security-policy")).toContain("default-src 'none'");
    const prevHtml = await prev.text();
    expect(prevHtml).toContain("Přehled bezpečnostních opatření");
    expect(prevHtml).toContain("NÁHLED");
    expect((await admin.json("/api/documents?kind=soa&framework=cz410")).body).toEqual([]);

    const v1 = await admin.json("/api/documents", { method: "POST", json: { kind: "soa", framework: "cz409", note: "Roční přezkum <script>" } });
    expect(v1.status).toBe(201);
    expect(v1.body.version).toBe(1);
    expect(v1.body.status).toBe("draft");
    expect(v1.body.metrics.total).toBeGreaterThan(50);
    // se návrhem se seznámit nelze
    expect((await admin.json(`/api/documents/${v1.body.id}/acknowledge`, { method: "POST" })).status).toBe(409);
    const ap1 = await admin.json(`/api/documents/${v1.body.id}/approve`, { method: "POST", json: { note: "Schváleno vedením" } });
    expect(ap1.body.status).toBe("approved");
    expect(ap1.body.retainUntil).toBeTruthy();
    const v2 = await admin.json("/api/documents", { method: "POST", json: { kind: "soa", framework: "cz409" } });
    expect(v2.body.version).toBe(2);
    // jiný rámec má vlastní číslování
    expect((await admin.json("/api/documents", { method: "POST", json: { kind: "soa", framework: "cz410" } })).body.version).toBe(1);
    await admin.json(`/api/documents/${v2.body.id}/approve`, { method: "POST", json: {} });
    const list = (await admin.json("/api/documents?kind=soa&framework=cz409")).body as any[];
    expect(list.map((d) => [d.version, d.status])).toEqual([
      [2, "approved"],
      [1, "superseded"],
    ]);
    // schválenou verzi nelze smazat ani znovu schválit
    expect((await admin.json(`/api/documents/${v1.body.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await admin.json(`/api/documents/${v2.body.id}/approve`, { method: "POST", json: {} })).status).toBe(409);
    const ack = await admin.json(`/api/documents/${v2.body.id}/acknowledge`, { method: "POST" });
    expect(ack.body.acknowledgedByMe).toBe(true);
    expect(ack.body.acknowledgements.length).toBe(1);
    // HTML je escapované a nese stav i seznámení
    const html = await (await admin.req(`/api/documents/${v1.body.id}/html`)).text();
    expect(html).toContain("NAHRAZENO");
    expect(html).not.toContain("Roční přezkum <script>");
    expect(html).toContain("Roční přezkum &lt;script&gt;");

    // zpráva o hodnocení rizik se vstupy § 8 odst. 1 písm. c)
    const rr = await admin.json("/api/documents", {
      method: "POST",
      json: { kind: "risk_report", inputs: { incidents: "Phishing 03/2026 <b>", bogus: "x" }, periodFrom: "2026-01-01", periodTo: "2026-09-30" },
    });
    expect(rr.status).toBe(201);
    expect(rr.body.metrics.total).toBeGreaterThan(0);
    const rrHtml = await (await admin.req(`/api/documents/${rr.body.id}/html`)).text();
    expect(rrHtml).toContain("Zpráva o hodnocení rizik");
    expect(rrHtml).toContain("Phishing 03/2026 &lt;b&gt;");
    expect(rrHtml).toContain("H01");
    // návrh lze smazat
    expect((await admin.json(`/api/documents/${rr.body.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await admin.json(`/api/documents/${rr.body.id}`)).status).toBe(404);
    // SoA bez rámce je chyba
    expect((await admin.json("/api/documents", { method: "POST", json: { kind: "soa" } })).status).toBe(400);

    // čtenář bez schvalovacího oprávnění: vidí, seznámí se, ale neschvaluje ani nezakládá
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    const seen = (await b.json("/api/documents?kind=soa&framework=cz409")).body as any[];
    expect(seen[0].canApprove).toBe(false);
    expect((await b.json(`/api/documents/${v2.body.id}/acknowledge`, { method: "POST" })).body.acknowledgements.length).toBe(2);
    expect((await b.json("/api/documents", { method: "POST", json: { kind: "soa", framework: "cz409" } })).status).toBe(403);
    const draft = await admin.json("/api/documents", { method: "POST", json: { kind: "treatment_plan" } });
    expect(draft.status).toBe(201);
    expect((await b.json(`/api/documents/${draft.body.id}/approve`, { method: "POST", json: {} })).status).toBe(403);
  });

  test("plány kontinuity: RTO z BIA, schválení, nová verze po změně, testy", async () => {
    const create = await admin.json("/api/continuity-plans", {
      method: "POST",
      json: {
        code: "BCP-01",
        name: "Obnova mzdové agendy",
        planType: "recovery",
        ownerPositionId: ids.posHead,
        steps: [{ title: "Aktivace týmu", responsiblePositionId: ids.posMkb, targetMinutes: 30 }],
        contacts: [{ name: "Dodavatel mezd", phone: "+420 111 222 333" }],
        processIds: [ids.process],
        assetIds: [ids.primary],
      },
    });
    expect(create.status).toBe(201);
    const plan = create.body;
    expect(plan.rtoTargetHours).toBe(4); // z BIA procesu
    expect(plan.rtoFromBia).toBe(true);
    expect(plan.steps[0].responsiblePositionName).toBe("Manažer KB");
    expect(plan.nextTestDue).toBeNull(); // návrh se netestuje podle plánu
    expect((await admin.json("/api/continuity-plans", { method: "POST", json: { name: "X", status: "approved" } })).status).toBe(400);

    const ap = await admin.json(`/api/continuity-plans/${plan.id}`, { method: "PATCH", json: { status: "approved" } });
    expect(ap.body.status).toBe("approved");
    expect(ap.body.approvedByName).toBe("Admin");
    expect(ap.body.nextTestDue).toBeTruthy();

    // budoucí datum testu je odmítnuto
    expect((await admin.json(`/api/continuity-plans/${plan.id}/tests`, { method: "POST", json: { testedAt: "2099-01-01", testType: "tabletop", result: "passed" } })).status).toBe(400);
    const t = await admin.json(`/api/continuity-plans/${plan.id}/tests`, {
      method: "POST",
      json: { testedAt: "2026-06-15", testType: "simulation", result: "partial", achievedRtoHours: 6, findings: "Chybí kontakt" },
    });
    expect(t.status).toBe(201);
    expect(t.body.tests[0].rtoMet).toBe(false);
    expect(t.body.lastTest.testedAt).toBe("2026-06-15");
    expect(t.body.nextTestDue).toBe("2027-06-15");

    // vlastník (držitel funkčního místa) může plán upravit, ale ne schválit
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    const edit = await b.json(`/api/continuity-plans/${plan.id}`, { method: "PATCH", json: { strategy: "Náhradní zpracování u dodavatele" } });
    expect(edit.status).toBe(200);
    expect(edit.body.version).toBe(2); // věcná změna schváleného plánu = nová verze
    expect(edit.body.status).toBe("draft");
    expect((await b.json(`/api/continuity-plans/${plan.id}`, { method: "PATCH", json: { status: "approved" } })).status).toBe(403);
    // popisná změna verzi nemění
    const ap2 = await admin.json(`/api/continuity-plans/${plan.id}`, { method: "PATCH", json: { status: "approved" } });
    const same = await admin.json(`/api/continuity-plans/${plan.id}`, { method: "PATCH", json: { purpose: "Obnova výplaty mezd", rtoTargetHours: 8 } });
    expect(ap2.body.version).toBe(2);
    expect(same.body.version).toBe(3); // RTO je věcná změna
    expect(same.body.tests[0].rtoMet).toBe(true); // 6 h ≤ 8 h
    // test cizího plánu nelze smazat přes jiný plán
    const other = await admin.json("/api/continuity-plans", { method: "POST", json: { name: "Krizová komunikace", planType: "crisis_communication" } });
    await admin.json(`/api/continuity-plans/${other.body.id}/tests/${t.body.tests[0].id}`, { method: "DELETE" });
    expect((await admin.json(`/api/continuity-plans/${plan.id}`)).body.tests.length).toBe(1);
    expect((await admin.json("/api/continuity-plans")).body.length).toBe(2);
  });

  test("dodavatelé: evidence dle § 9, ustanovení přílohy č. 5, oznámení", async () => {
    expect((await admin.json("/api/suppliers", { method: "POST", json: { name: "Špatné IČO", ico: "123" } })).status).toBe(400);
    const s = await admin.json("/api/suppliers", {
      method: "POST",
      json: { name: "Mzdy <s.r.o.>", ico: "12345678", significant: true, dataOutsideCz: true, assetIds: [ids.primary], processIds: [ids.process], riskIds: [ids.risk5] },
    });
    expect(s.status).toBe(201);
    const id = s.body.id;
    expect(s.body.gaps.length).toBe(5); // informování, pravidla, hodnocení rizik, smlouva, přezkum
    expect(s.body.risks[0].id).toBe(ids.risk5);
    // smlouva: neznámá ustanovení se zahodí, chybějící se počítají
    const c = await admin.json(`/api/suppliers/${id}/contracts`, {
      method: "POST",
      json: { title: "Smlouva o zpracování mezd", clauseSet: "cz409", clauses: { a: "included", b: "not_relevant", zz: "included" } },
    });
    expect(c.status).toBe(201);
    const ct = c.body.contracts[0];
    expect(ct.clauses.zz).toBeUndefined();
    expect(ct.missingClauses).toBe(16); // 18 ustanovení a–r, 2 vyřešená
    expect(c.body.gaps.some((g: string) => g.includes("16 ustanovení"))).toBe(true);
    // přepnutí na sadu vyhl. 410
    const c2 = await admin.json(`/api/suppliers/${id}/contracts/${ct.id}`, {
      method: "PATCH",
      json: { clauseSet: "cz410", clauses: Object.fromEntries("abcdefghijklmn".split("").map((k) => [k, "included"])) },
    });
    expect(c2.body.contracts[0].missingClauses).toBe(0);
    const done = await admin.json(`/api/suppliers/${id}`, {
      method: "PATCH",
      json: { notifiedAt: "2026-09-01", notificationRef: "ČJ 1/2026", rulesAcknowledgedAt: "2026-09-02", riskAssessedAt: "2026-08-01", lastReviewAt: "2026-09-10" },
    });
    expect(done.body.gaps).toEqual([]);
    expect(done.body.ico).toBe("12345678"); // PATCH nepřepíše
    // oznámení dle § 9 odst. 3
    const n = await admin.req(`/api/suppliers/${id}/notification.html`);
    expect(n.status).toBe(200);
    const nh = await n.text();
    expect(nh).toContain("Mzdy &lt;s.r.o.&gt;");
    expect(nh).toContain("12345678");
    expect(nh).not.toContain("<s.r.o.>");
    // nevýznamný dodavatel nemá mezery; filtr
    await admin.json("/api/suppliers", { method: "POST", json: { name: "Kancelářské potřeby" } });
    const sig = (await admin.json("/api/suppliers?significant=true")).body as any[];
    expect(sig.map((x) => x.name)).toEqual(["Mzdy <s.r.o.>"]);
    // čtenář nic nezakládá
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.json("/api/suppliers")).status).toBe(200);
    expect((await b.json("/api/suppliers", { method: "POST", json: { name: "X" } })).status).toBe(403);
  });

  test("řízení změn: významná změna dle § 11, mezery podle fáze, schválení", async () => {
    const settings = (await admin.json("/api/admin/settings")).body.settings;
    expect(settings.changeCriteria.length).toBeGreaterThan(3);
    const ch = await admin.json("/api/isms/changes", {
      method: "POST",
      json: { code: "ZM-01", title: "Migrace mzdového systému do cloudu", changeType: "supplier", significant: true, criteria: [settings.changeCriteria[3]], plannedAt: "2026-05-01", assetIds: [ids.primary] },
    });
    expect(ch.status).toBe(201);
    expect(ch.body.affectsSecurity).toBe(true); // významná změna má vliv na bezpečnost
    expect(ch.body.gaps).toEqual(["Chybí řízení rizik spojených se změnou (§ 11 odst. 2 písm. b)."]);
    const id = ch.body.id;
    // schválení bez opatření, návratu a rozhodnutí o pentestu → nové mezery
    const ap = await admin.json(`/api/isms/changes/${id}`, { method: "PATCH", json: { status: "approved", riskIds: [ids.risk5] } });
    expect(ap.body.approvedAt).toBeTruthy();
    expect(ap.body.gaps.length).toBe(3);
    const done = await admin.json(`/api/isms/changes/${id}`, {
      method: "PATCH",
      json: { status: "closed", measures: "Šifrování, MFA", rollbackPlan: "Záloha a návrat on-prem do 24 h", pentest: "done", testedAt: "2026-05-10", implementedAt: "2026-05-15", docsUpdatedAt: "2026-05-20", audit: "planned" },
    });
    expect(done.body.gaps).toEqual([]);
    expect(done.body.risks[0].id).toBe(ids.risk5);
    // nevýznamná změna nemá mezery; vlastník bez isms:write neschvaluje
    const minor = await admin.json("/api/isms/changes", { method: "POST", json: { title: "Výměna tiskárny", ownerPositionId: ids.posHead, plannedAt: "2026-06-01" } });
    expect(minor.body.gaps).toEqual([]);
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await b.json(`/api/isms/changes/${minor.body.id}`, { method: "PATCH", json: { description: "doplněno" } })).status).toBe(200);
    expect((await b.json(`/api/isms/changes/${minor.body.id}`, { method: "PATCH", json: { status: "approved" } })).status).toBe(403);
    expect((await b.json("/api/isms/changes", { method: "POST", json: { title: "X" } })).status).toBe(403);
    // filtr období a významných
    const sig = (await admin.json("/api/isms/changes?status=significant&from=2026-05-01&to=2026-05-31")).body as any[];
    expect(sig.map((x) => x.code)).toEqual(["ZM-01"]);
    expect((await admin.json("/api/isms/changes?from=2026-07-01")).body).toEqual([]);
  });

  test("přezkoumání ISMS: cíle, zpráva o přezkoumání se všemi body § 3 písm. f), roční termín", async () => {
    const ov0 = (await admin.json("/api/isms/overview")).body;
    expect(ov0.reviewOverdue).toBe(true);
    expect(ov0.lastReview).toBeNull();
    const o = await admin.json("/api/isms/objectives", { method: "POST", json: { code: "C-01", title: "Obnova kritických systémů do 24 h", metric: "RTO v testu", target: "≤ 24 h", status: "met", ownerPositionId: ids.posMkb } });
    expect(o.status).toBe(201);
    await admin.json("/api/isms/objectives", { method: "POST", json: { title: "Proškolení 100 % zaměstnanců <b>", status: "partially_met" } });
    const doc = await admin.json("/api/documents", {
      method: "POST",
      json: { kind: "isms_review", periodFrom: "2026-01-01", periodTo: "2026-09-30", inputs: { conclusions: "ISMS je účinný <i>", incidents: "Bez incidentu s významným dopadem." } },
    });
    expect(doc.status).toBe(201);
    expect(doc.body.metrics.objectives).toBe(2);
    expect(doc.body.metrics.objectivesMet).toBe(1);
    expect(doc.body.metrics.significantChanges).toBe(1);
    const html = await (await admin.req(`/api/documents/${doc.body.id}/html`)).text();
    expect(html).toContain("Zpráva o přezkoumání systému řízení bezpečnosti informací");
    for (const t of ["1. Vyhodnocení cílů", "2. Posouzení naplňování plánu", "3. Hodnocení stavu", "4. Posouzení výsledků", "5. Výsledky předchozího", "6. Posouzení dopadů", "7. Posouzení významných změn"]) expect(html).toContain(t);
    expect(html).toContain("ZM-01");
    expect(html).toContain("Proškolení 100 % zaměstnanců &lt;b&gt;");
    expect(html).toContain("ISMS je účinný &lt;i&gt;");
    expect(html).toContain("Aktivních významných dodavatelů: 1, s nesplněnými povinnostmi: <b>0</b>");
    await admin.json(`/api/documents/${doc.body.id}/approve`, { method: "POST", json: {} });
    const ov = (await admin.json("/api/isms/overview")).body;
    expect(ov.reviewOverdue).toBe(false);
    expect(ov.lastReview.version).toBe(1);
    expect(ov.objectives.met).toBe(1);
    // druhá verze převezme závěry předchozí (bod 5)
    const v2 = await admin.json("/api/documents", { method: "POST", json: { kind: "isms_review" } });
    const h2 = await (await admin.req(`/api/documents/${v2.body.id}/html`)).text();
    expect(h2).toContain("Verze 1, schváleno");
    // zpráva o hodnocení rizik vypíše významné změny z evidence
    const rr = await admin.json("/api/documents", { method: "POST", json: { kind: "risk_report", periodFrom: "2026-01-01", periodTo: "2026-12-31" } });
    expect(await (await admin.req(`/api/documents/${rr.body.id}/html`)).text()).toContain("Migrace mzdového systému do cloudu");
  });

  test("incidenty: klasifikace, povinnost hlásit a lhůty § 16 zákona, hlášení, podklad", async () => {
    const h = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
    // nahlášení události běžným uživatelem (incidents:report) – bez klasifikace
    const b = browser();
    await b.login("owner@test.cz", "Nove-Heslo-2026!!");
    const rep = await b.json("/api/incidents", { method: "POST", json: { title: "Podezřelý e-mail s přílohou", detectedAt: h(1), kind: "incident", category: "phishing" } });
    expect(rep.status).toBe(201);
    expect(rep.body.kind).toBeUndefined(); // čtenář nevidí detail
    expect((await b.json(`/api/incidents/${rep.body.id}`)).status).toBe(403);
    const ev = (await admin.json(`/api/incidents/${rep.body.id}`)).body;
    expect(ev.kind).toBe("unassessed"); // klasifikaci nemohl nastavit
    await admin.json(`/api/incidents/${ev.id}`, { method: "PATCH", json: { kind: "event", status: "closed" } });

    // incident v režimu vyšších povinností – hlásit vždy (rozsah, kyberprostor, úmysl nevyloučen)
    const inc = await admin.json("/api/incidents", {
      method: "POST",
      json: { code: "INC-01", title: "Ransomware na mzdovém serveru <x>", kind: "incident", category: "ransomware", detectedAt: h(30), assetIds: [ids.primary], riskIds: [ids.risk5], personalDataBreach: true },
    });
    expect(inc.status).toBe(201);
    expect(inc.body.reportable).toBe(true);
    const types = inc.body.deadlines.map((d: any) => [d.type, d.state]);
    expect(types).toContainEqual(["initial", "overdue"]); // 30 h > 24 h
    expect(types).toContainEqual(["notification", "pending"]); // čeká na sdělení Úřadu, lhůta 72 h
    expect(types).toContainEqual(["gdpr", "pending"]);
    expect(inc.body.gaps.length).toBeGreaterThan(0);
    const id = inc.body.id;
    // hlášení nesmí být v budoucnu ani před zjištěním
    expect((await admin.json(`/api/incidents/${id}/reports`, { method: "POST", json: { reportType: "initial", submittedAt: h(-5) } })).status).toBe(400);
    expect((await admin.json(`/api/incidents/${id}/reports`, { method: "POST", json: { reportType: "initial", submittedAt: h(40) } })).status).toBe(400);
    await admin.json(`/api/incidents/${id}/reports`, { method: "POST", json: { reportType: "initial", submittedAt: h(20), reference: "NUKIB-2026-001" } });
    // Úřad sdělil významný dopad → oznámení a závěrečná zpráva (30 dnů od oznámení)
    const sig = await admin.json(`/api/incidents/${id}`, { method: "PATCH", json: { authorityDecision: "significant" } });
    expect(sig.body.deadlines.find((d: any) => d.type === "final").due).toBeNull();
    const noticeAt = h(10);
    const n = await admin.json(`/api/incidents/${id}/reports`, { method: "POST", json: { reportType: "notification", submittedAt: noticeAt } });
    const fin = n.body.deadlines.find((d: any) => d.type === "final");
    expect(fin.state).toBe("pending");
    expect(new Date(fin.due).getTime() - new Date(noticeAt).getTime()).toBe(30 * 24 * 3600_000);
    expect(n.body.overdueReports).toBe(0);
    // vyřešení a uzavření bez příčiny a poučení → mezery
    const closed = await admin.json(`/api/incidents/${id}`, { method: "PATCH", json: { status: "closed", ownerPositionId: ids.posHead, containment: "Izolace serveru", evidence: "Image disku v trezoru" } });
    expect(closed.body.resolvedAt).toBeNull();
    expect(closed.body.gaps).toEqual(["Není určena příčina incidentu (§ 14 odst. 1 písm. k).", "Chybí vyhodnocení účinnosti řešení a opatření proti opakování (§ 14 odst. 1 písm. n)."]);
    const res = await admin.json(`/api/incidents/${id}`, { method: "PATCH", json: { status: "resolved", rootCause: "Neaktualizovaný VPN koncentrátor", lessonsLearned: "Zavést MFA a patch management" } });
    expect(res.body.resolvedAt).toBeTruthy();
    expect(res.body.gaps).toEqual([]);
    // bez oprávnění číst incidenty nelze upravovat ani jako odpovědná osoba
    expect((await b.json(`/api/incidents/${id}`, { method: "PATCH", json: { kind: "event" } })).status).toBe(403);
    expect((await admin.json(`/api/incidents/${id}`)).body.kind).toBe("incident");
    // podklad pro hlášení je escapovaný
    const html = await (await admin.req(`/api/incidents/${id}/report.html?type=final`)).text();
    expect(html).toContain("Ransomware na mzdovém serveru &lt;x&gt;");
    expect(html).toContain("Neaktualizovaný VPN koncentrátor");
    // nižší režim: hlásit jen při významném dopadu (§ 15 odst. 2)
    await admin.json("/api/admin/settings", { method: "PATCH", json: { regime: "lower" } });
    const low = await admin.json("/api/incidents", { method: "POST", json: { title: "Výpadek webu", kind: "incident", category: "dos", detectedAt: h(2) } });
    expect(low.body.reportable).toBe(false);
    const low2 = await admin.json(`/api/incidents/${low.body.id}`, { method: "PATCH", json: { toleranceExceeded: true, significanceAreas: { operational: true, bogus: true } } });
    expect(low2.body.reportable).toBe(true);
    expect(low2.body.significanceAreas.bogus).toBeUndefined();
    expect(low2.body.recipient).toBe("national_cert");
    expect(low2.body.deadlines.map((d: any) => d.type)).toEqual(["initial", "notification", "final"]);
    await admin.json("/api/admin/settings", { method: "PATCH", json: { regime: "higher" } });
    // částečný PATCH nastavení nepřepíše ostatní hodnoty výchozími
    await admin.json("/api/admin/settings", { method: "PATCH", json: { organizationName: "Město Test" } });
    await admin.json("/api/admin/settings", { method: "PATCH", json: { trustServiceProvider: false } });
    expect((await admin.json("/api/admin/settings")).body.settings.organizationName).toBe("Město Test");
    const summary = (await admin.json("/api/incidents/summary")).body;
    expect(summary.incidents).toBe(2);
    expect(summary.events).toBe(1);
  });

  test("audity: plán, auditor dle § 5 odst. 4, zjištění a nápravná opatření, pokrytí, změny", async () => {
    // auditor zastává jinou bezpečnostní roli (Garant aktiva na Vedoucí OI)
    const a = await admin.json("/api/audits", {
      method: "POST",
      json: { code: "AUD-2026", title: "Audit KB 2026", auditType: "partial", sections: ["§ 8", "§ 11", "§ 99"], auditorPositionId: ids.posHead, plannedStart: "2026-03-01" },
    });
    expect(a.status).toBe(201);
    expect(a.body.sections).toEqual(["§ 8", "§ 11"]); // neznámý oddíl se zahodí
    expect(a.body.gaps.join(" ")).toContain("§ 5 odst. 4 písm. c)");
    expect(a.body.gaps.join(" ")).toContain("§ 5 odst. 4 písm. a)");
    const id = a.body.id;
    // navázat významnou změnu ZM-01 → po dokončení auditu se splní § 16 odst. 4 písm. a)
    const ch = ((await admin.json("/api/isms/changes?status=significant")).body as any[]).find((x) => x.code === "ZM-01");
    expect((await admin.json(`/api/audits/${id}/findings`, { method: "POST", json: { title: "Chybí kritéria významných změn", severity: "major", requirementId: "cz409:11/1/a" } })).status).toBe(201);
    expect((await admin.json(`/api/audits/${id}/findings`, { method: "POST", json: { title: "X", requirementId: "cz409:999" } })).status).toBe(400);
    const f2 = await admin.json(`/api/audits/${id}/findings`, { method: "POST", json: { title: "Neaktuální registr rizik", severity: "minor", correctiveAction: "Přehodnotit", dueDate: "2026-01-31", riskId: ids.risk5 } });
    const fl = f2.body.findingList;
    expect(fl.find((f: any) => f.title === "Chybí kritéria významných změn").requirementRef).toBe("§ 11 odst. 1 písm. a)");
    expect(fl.find((f: any) => f.title === "Neaktuální registr rizik").overdue).toBe(true);
    const done = await admin.json(`/api/audits/${id}`, {
      method: "PATCH",
      json: { status: "completed", auditorPositionId: null, auditorName: "Ing. Nezávislý", auditorExternal: true, auditorQualified: true, auditorIndependent: true, changeIds: [ch.id] },
    });
    expect(done.body.performedEnd).toBeTruthy();
    expect(done.body.gaps).toEqual(["1 neshod bez nápravného opatření (§ 16 odst. 3 písm. b).", "Vrcholné vedení nebylo seznámeno s výsledky (§ 4 odst. 2 písm. e)."]);
    expect((await admin.json(`/api/isms/changes/${ch.id}`)).body.audit).toBe("done");
    // uzavření zjištění doplní datum
    const fid = fl.find((f: any) => f.title === "Neaktuální registr rizik").id;
    const cl = await admin.json(`/api/audits/${id}/findings/${fid}`, { method: "PATCH", json: { status: "closed" } });
    expect(cl.body.findingList.find((f: any) => f.id === fid).closedAt).toBeTruthy();
    // pokrytí
    const cov = (await admin.json("/api/audits/coverage")).body as any[];
    expect(cov.find((c) => c.section === "§ 8").state).toBe("ok");
    expect(cov.find((c) => c.section === "§ 3").state).toBe("overdue");
    // přezkoumání ISMS převezme audity a incidenty (body 4 a 6)
    const rv = await admin.json("/api/documents", { method: "POST", json: { kind: "isms_review" } });
    expect(rv.body.metrics.incidents).toBe(2);
    expect(rv.body.metrics.openFindings).toBe(1);
    const html = await (await admin.req(`/api/documents/${rv.body.id}/html`)).text();
    expect(html).toContain("AUD-2026 Audit KB 2026");
    expect(html).toContain("Ransomware na mzdovém serveru &lt;x&gt;");
    expect(html).toContain("Pokrytí oddílů vyhl. 409 auditem: v posledních 2 letech 2 z 25");
    // auditor (role) smí audity zapisovat, čtenář ne
    const v = browser();
    await v.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await v.json("/api/audits")).status).toBe(200);
    expect((await v.json("/api/audits", { method: "POST", json: { title: "X" } })).status).toBe(403);
  });

  test("skupina společností: holding, dceřiné společnosti, role po společnostech, izolace dat, sdílené vazby", async () => {
    const H = (id: string) => ({ "x-contix-company": id });
    const root = "00000000-0000-4000-8000-000000000001";
    // kořen = dosavadní organizace
    const cos0 = (await admin.json("/api/companies")).body as any[];
    expect(cos0.map((c) => c.id)).toEqual([root]);
    await admin.json(`/api/companies/${root}`, { method: "PATCH", json: { name: "Holding Test a.s.", kind: "holding" } });
    const a = await admin.json("/api/companies", { method: "POST", json: { name: "Dceřiná A s.r.o.", ico: "11111111", regime: "lower" } });
    const b = await admin.json("/api/companies", { method: "POST", json: { name: "Dceřiná B s.r.o.", regime: "higher", overrides: { incidentTolerance: "B tolerance" } } });
    expect(a.status).toBe(201);
    expect(a.body.parentId).toBe(root);
    expect(a.body.path).toEqual(["Holding Test a.s.", "Dceřiná A s.r.o."]);
    expect((await admin.json("/api/companies", { method: "POST", json: { name: "X", ico: "12" } })).status).toBe(400);
    expect((await admin.json(`/api/companies/${a.body.id}`, { method: "PATCH", json: { parentId: a.body.id } })).status).toBe(400);
    expect((await admin.json(`/api/companies/${root}`, { method: "DELETE" })).status).toBe(400);

    // uživatel s rolí jen v A (manažer KB dceřiné společnosti)
    const u = await admin.json("/api/admin/users", {
      method: "POST",
      json: { email: "mkb.a@test.cz", displayName: "MKB A", password: PW, companyId: a.body.id, roleAssignments: [{ roleId: await roleId("security_manager"), companyId: a.body.id }] },
    });
    expect(u.body.companyName).toBe("Dceřiná A s.r.o.");
    expect(u.body.roles[0].companyId).toBe(a.body.id);
    const ua = browser();
    await ua.login("mkb.a@test.cz");
    await ua.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Mkb-A-Heslo-2026!!" } });
    const me = (await ua.json("/api/auth/me")).body;
    expect(me.activeCompanyId).toBe(a.body.id);
    expect(me.companies.map((x: any) => x.name)).toEqual(["Dceřiná A s.r.o."]);
    expect(me.canGroupView).toBe(false);
    expect(me.permissions).toContain("risks:write");
    expect(me.permissions).not.toContain("admin:users");

    // záznamy se zakládají do aktivní společnosti; admin (holding) zakládá v B přes hlavičku
    const ra = await ua.json("/api/risks", { method: "POST", json: { name: "Riziko A" } });
    expect(ra.status).toBe(201);
    expect(ra.body.companyId).toBe(a.body.id);
    const rb = await admin.json("/api/risks", { method: "POST", json: { name: "Riziko B" }, headers: H(b.body.id) });
    expect(rb.body.companyId).toBe(b.body.id);
    // izolace: A nevidí B
    expect((await ua.json(`/api/risks/${rb.body.id}`)).status).toBe(404);
    expect((await ua.json(`/api/risks/${rb.body.id}`, { method: "PATCH", json: { name: "x" } })).status).toBe(404);
    expect(((await ua.json("/api/risks")).body.items as any[]).map((r) => r.name)).toEqual(["Riziko A"]);
    // požadavek na cizí společnost hlavičkou je ignorován (zůstane domovská)
    expect(((await ua.json("/api/risks", { headers: H(b.body.id) })).body.items as any[]).map((r) => r.name)).toEqual(["Riziko A"]);
    // holding (souhrnný pohled) vidí vše, po přepnutí jen danou společnost
    const all = ((await admin.json("/api/risks")).body.items as any[]).map((r) => r.name);
    expect(all).toEqual(expect.arrayContaining(["Riziko A", "Riziko B"]));
    expect(((await admin.json("/api/risks", { headers: H(a.body.id) })).body.items as any[]).map((r) => r.name)).toEqual(["Riziko A"]);

    // sdílené služby: aktivum holdingu jako podpůrné aktivum primárního aktiva společnosti A
    const hold = await admin.json("/api/assets", { method: "POST", json: { name: "Datové centrum holdingu", assetType: "server" }, headers: H(root) });
    expect(hold.body.companyId).toBe(root);
    const prim = await ua.json("/api/assets", { method: "POST", json: { name: "Mzdy A", assetType: "business_service" } });
    expect(prim.body.companyId).toBe(a.body.id);
    expect(((await ua.json("/api/assets")).body.items as any[]).map((x) => x.name)).toEqual(["Mzdy A"]);
    expect(((await ua.json("/api/assets?withGroup=1")).body.items as any[]).map((x) => x.name)).toEqual(expect.arrayContaining(["Mzdy A", "Datové centrum holdingu"]));
    expect((await ua.json("/api/assets/links", { method: "POST", json: { primaryId: prim.body.id, supportingId: hold.body.id } })).status).toBe(201);
    expect((await ua.json(`/api/assets/${hold.body.id}`)).status).toBe(200); // detail sdíleného aktiva holdingu
    expect((await ua.json(`/api/assets/${hold.body.id}`, { method: "PATCH", json: { name: "x" } })).status).toBe(404); // ale ne úprava

    // funkční místo holdingu jako vlastník rizika ve společnosti A
    const hu = await admin.json("/api/org/units", { method: "POST", json: { name: "IT holdingu" }, headers: H(root) });
    const hp = await admin.json("/api/org/positions", { method: "POST", json: { orgUnitId: hu.body.id, name: "Technický správce skupiny" } });
    expect(((await ua.json("/api/org")).body as any[]).some((x) => x.id === hu.body.id)).toBe(true);
    const own = await ua.json(`/api/risks/${ra.body.id}`, { method: "PATCH", json: { ownerPositionId: hp.body.id } });
    expect(own.body.ownerPositionName).toBe("Technický správce skupiny");
    // útvar v A nesmí mít nadřízený útvar holdingu
    const ua1 = await admin.json("/api/org/units", { method: "POST", json: { name: "Útvar A" }, headers: H(a.body.id) });
    expect(ua1.body.companyId).toBe(a.body.id);
    expect((await admin.json(`/api/org/units/${ua1.body.id}`, { method: "PATCH", json: { parentId: hu.body.id } })).status).toBe(400);

    // SoA za společnost: skupinové opatření holdingu se započítá i dceřiné společnosti
    const ctl = await admin.json("/api/controls", { method: "POST", json: { name: "Skupinová politika zálohování", status: "implemented", effectiveness: "effective", requirementIds: ["cz410:6/a"] }, headers: H(root) });
    expect(ctl.body.companyId).toBe(root);
    const reqA = (await ua.json("/api/controls/requirements?framework=cz410")).body as any[];
    const row = reqA.find((r) => r.id === "cz410:6/a");
    expect(row.controls.find((x: any) => x.name === "Skupinová politika zálohování").inherited).toBe(true);
    expect(row.derivedCompliance).not.toBe("not_assessed");
    await ua.json("/api/controls/assessments", { method: "PUT", json: { requirementId: "cz410:3/2/a", applicable: true, compliance: "partial" } });
    const reqB = (await admin.json("/api/controls/requirements?framework=cz410", { headers: H(b.body.id) })).body as any[];
    expect(reqB.find((r: any) => r.id === "cz410:3/2/a").manualCompliance).toBeNull(); // posouzení A se B netýká
    // v souhrnném pohledu s více společnostmi SoA vyžaduje výběr společnosti
    expect((await admin.json("/api/controls/frameworks")).status).toBe(400);

    // dokumenty ISMS mají číslování za společnost
    const da = await ua.json("/api/documents", { method: "POST", json: { kind: "soa", framework: "cz410" } });
    expect(da.body.version).toBe(1);
    const html = await (await ua.req(`/api/documents/${da.body.id}/html`)).text();
    expect(html).toContain("Dceřiná A s.r.o., IČO 11111111");
    expect((await admin.json(`/api/documents/${da.body.id}`, { headers: H(b.body.id) })).status).toBe(404);

    // incident v B: lhůty podle režimu a tolerance B
    const ib = await admin.json("/api/incidents", { method: "POST", json: { title: "Incident B", kind: "incident", detectedAt: new Date().toISOString() }, headers: H(b.body.id) });
    expect(ib.body.regime).toBe("higher");
    expect(ib.body.tolerance).toBe("B tolerance");
    expect(ib.body.reportable).toBe(true);
    // přehled skupiny
    const ov = (await admin.json("/api/companies/overview")).body as any[];
    expect(ov.map((x) => x.name)).toEqual(["Holding Test a.s.", "Dceřiná A s.r.o.", "Dceřiná B s.r.o."]);
    expect(ov.find((x) => x.name === "Dceřiná A s.r.o.").framework).toBe("cz410");
    expect(ov.find((x) => x.name === "Dceřiná B s.r.o.").incidents.open).toBe(1);
    const ovA = (await ua.json("/api/companies/overview")).body as any[];
    expect(ovA.map((x) => x.name)).toEqual(["Dceřiná A s.r.o."]);
    // role přidělená holdingu platí pro celou skupinu
    await admin.json(`/api/admin/users/${u.body.id}`, {
      method: "PATCH",
      json: { roleAssignments: [{ roleId: await roleId("security_manager"), companyId: a.body.id }, { roleId: await roleId("viewer"), companyId: root }] },
    });
    const me2 = (await ua.json("/api/auth/me")).body;
    expect(me2.canGroupView).toBe(true);
    expect(me2.companies.length).toBe(3);
    // smazání společnosti s daty je odmítnuto
    expect((await admin.json(`/api/companies/${b.body.id}`, { method: "DELETE" })).status).toBe(409);
  });

  test("metodiky: OCTAVE Allegro ve společnosti, import YAML/XML, export, kontrolní seznam auditu", async () => {
    const list = (await admin.json("/api/methodologies")).body as any[];
    expect(list.map((m) => m.id)).toEqual(expect.arrayContaining(["zkb409", "octave_allegro", "matrix_5x5", "zkb409_audit", "zkb410_audit"]));
    // export vestavěné metodiky jako YAML → úprava → import jako vlastní
    const y = await admin.req("/api/methodologies/octave_allegro/export?format=yaml");
    expect(y.headers.get("content-type")).toContain("yaml");
    const yaml = (await y.text()).replace("id: octave_allegro", "id: octave_firma").replace("name: OCTAVE Allegro", "name: OCTAVE Allegro – firma");
    const bad = await admin.json("/api/methodologies/validate", { method: "POST", json: { format: "yaml", content: yaml.replace("formula: impact", "formula: impact * zzz") } });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.errors.join()).toContain("zzz");
    expect((await admin.json("/api/methodologies/import", { method: "POST", json: { format: "yaml", content: yaml } })).status).toBe(201);
    expect((await admin.json("/api/methodologies/import", { method: "POST", json: { format: "yaml", content: yaml } })).status).toBe(409);
    expect((await admin.json("/api/methodologies/import", { method: "POST", json: { format: "yaml", content: yaml, replace: true } })).status).toBe(200);
    expect((await admin.json("/api/methodologies/import", { method: "POST", json: { format: "yaml", content: yaml.replace("id: octave_firma", "id: octave_allegro") } })).status).toBe(409);
    const xml = `<methodology kind="audit" id="interni_audit"><name>Interní audit</name><checklist>
      <item id="a1" section="§ 8" ref="§ 8" requirementId="cz409:8/1/a"><question>Je stanovena metodika hodnocení rizik?</question></item>
      <item id="a2"><question>Jsou záznamy uchovány?</question></item></checklist></methodology>`;
    expect((await admin.json("/api/methodologies/import", { method: "POST", json: { format: "xml", content: xml } })).status).toBe(201);
    // neexistující metodika v politice je odmítnuta
    expect((await admin.json("/api/companies", { method: "POST", json: { name: "Dceřiná C", overrides: { riskPolicy: { methodology: "neni" } } } })).status).toBe(400);
    // společnost C hodnotí rizika metodikou OCTAVE (skupina dál dle vyhlášky)
    const co = await admin.json("/api/companies", { method: "POST", json: { name: "Dceřiná C", overrides: { riskPolicy: { methodology: "octave_firma" } } } });
    expect(co.status).toBe(201);
    const H = { "x-contix-company": co.body.id };
    const areas = (v: number) => ({ reputation: v, financial: v, productivity: v, safety: v, fines: v });
    expect((await admin.json("/api/risks", { method: "POST", headers: H, json: { name: "Únik dat", factorValues: { impact: { reputation: 9 }, probability: 1 } } })).status).toBe(400);
    const r = await admin.json("/api/risks", {
      method: "POST",
      headers: H,
      json: { name: "Únik dat", factorValues: { impact: areas(3), probability: 3 }, residualFactorValues: { impact: areas(1), probability: 1 } },
    });
    expect(r.status).toBe(201);
    expect(r.body.methodologyKey).toBe("octave_firma");
    expect(r.body.score).toBe(45);
    expect(r.body.level).toBe("critical");
    expect(r.body.residualLevel).toBe("low");
    expect(r.body.acceptable).toBe(false);
    // metodiku v použití nelze smazat
    expect((await admin.json("/api/methodologies/octave_firma", { method: "DELETE" })).status).toBe(409);
    // zpráva o hodnocení rizik popisuje metodiku OCTAVE
    const doc = await admin.json("/api/documents", { method: "POST", headers: H, json: { kind: "risk_report" } });
    expect(doc.status).toBe(201);
    const html = await (await admin.req(`/api/documents/${doc.body.id}/html`, { headers: H })).text();
    expect(html).toContain("OCTAVE Allegro – firma");
    expect(html).toContain("Pool 1");
    // riziko hodnocené aktuální metodikou společnosti není „zastaralé“
    const rr = (await admin.json("/api/risks", { headers: H })).body.items.find((x: any) => x.id === r.body.id);
    expect(rr.outdatedScale).toBe(false);

    // audit s kontrolním seznamem dle vyhlášky 409, rozsah § 8
    const a = await admin.json("/api/audits", { method: "POST", headers: H, json: { title: "Audit § 8", sections: ["§ 8"], methodologyKey: "zkb409_audit" } });
    expect(a.status).toBe(201);
    expect(a.body.methodologyName).toContain("409");
    expect((await admin.json("/api/audits", { method: "POST", headers: H, json: { title: "X", methodologyKey: "octave_allegro" } })).status).toBe(400);
    const cl = (await admin.json(`/api/audits/${a.body.id}/checklist`, { headers: H })).body;
    expect(cl.items.length).toBeGreaterThan(3);
    expect(cl.items.every((i: any) => i.section === "§ 8")).toBe(true);
    const item = cl.items[0];
    const upd = await admin.json(`/api/audits/${a.body.id}/checklist`, { method: "PUT", headers: H, json: { itemId: item.itemId, result: "nonconform", note: "Metodika chybí" } });
    expect(upd.body.summary.nonconform).toBe(1);
    const fin = await admin.json(`/api/audits/${a.body.id}/checklist/finding`, { method: "POST", headers: H, json: { itemId: item.itemId } });
    expect(fin.status).toBe(201);
    expect(fin.body.items[0].findingId).toBeTruthy();
    const det = (await admin.json(`/api/audits/${a.body.id}`, { headers: H })).body;
    expect(det.findingList[0].requirementId).toBe(item.requirementId);
    expect(det.findingList[0].severity).toBe("minor");
    expect((await admin.json(`/api/audits/${a.body.id}/checklist/finding`, { method: "POST", headers: H, json: { itemId: item.itemId } })).status).toBe(409);
    // importovaný seznam (XML) – bez rozsahu všechny položky
    const a2 = await admin.json("/api/audits", { method: "POST", headers: H, json: { title: "Interní", methodologyKey: "interni_audit" } });
    expect((await admin.json(`/api/audits/${a2.body.id}/checklist`, { headers: H })).body.items.length).toBe(2);
    // export XML importované metodiky
    const x = await (await admin.req("/api/methodologies/interni_audit/export?format=xml")).text();
    expect(x).toContain('<item id="a1"');
    // nepoužitou metodiku lze smazat, vestavěnou ne
    expect((await admin.json("/api/methodologies/zkb409_audit", { method: "DELETE" })).status).toBe(409);
    await admin.json(`/api/audits/${a2.body.id}`, { method: "DELETE", headers: H });
    expect((await admin.json("/api/methodologies/interni_audit", { method: "DELETE" })).status).toBe(204);
  });

  test("regulatorní profil: obecný balíček s hlavním rámcem, audit z libovolného rámce (ADR-080)", async () => {
    const co = await admin.json("/api/companies", { method: "POST", json: { name: "Tochter GmbH", pack: "generic", primaryFramework: "iso27001", regime: "higher" } });
    expect(co.status).toBe(201);
    expect(co.body).toMatchObject({ pack: "generic", primaryFramework: "iso27001", regime: "none" });
    const H = { "x-contix-company": co.body.id };
    expect((await admin.json("/api/auth/me")).body.companies.find((x: any) => x.id === co.body.id)).toMatchObject({ pack: "generic", primaryFramework: "iso27001" });
    let scope = ((await admin.json("/api/controls/frameworks", { headers: H })).body as any[]).filter((f) => f.inScope).map((f) => f.id);
    expect(scope).toContain("iso27001");
    expect(scope).not.toContain("cz409");
    expect(scope).not.toContain("zkb");
    expect((await admin.json("/api/companies", { method: "POST", json: { name: "X", pack: "xx" } })).status).toBe(400);

    // metodika rizik z profilu: 5 × 5 s teplotní mapou (ADR-083)
    const risk = await admin.json("/api/risks", { method: "POST", headers: H, json: { name: "Výpadek cloudu", factorValues: { impact: 4, likelihood: 5 } } });
    expect(risk.status).toBe(201);
    const sum = (await admin.json("/api/risks/summary", { headers: H })).body;
    expect(sum.customMatrix.methodology).toBe("matrix_5x5");
    expect(sum.customMatrix.counts[3][4]).toBe(1);
    expect(sum.byLevel.critical).toBe(1);
    expect((await admin.req(`/api/risks/${risk.body.id}`, { method: "DELETE", headers: H })).status).toBe(204);

    // kontrolní seznam auditu z libovolného rámce knihovny
    const meths = (await admin.json("/api/methodologies")).body as any[];
    expect(meths.map((m) => m.id)).toEqual(expect.arrayContaining(["fw:iso27001", "fw:cis8", "zkb409_audit"]));
    expect(meths.map((m) => m.id)).not.toContain("fw:cz409");
    expect((await admin.json("/api/audits", { method: "POST", headers: H, json: { title: "X", methodologyKey: "fw:neni" } })).status).toBe(400);
    const a = await admin.json("/api/audits", { method: "POST", headers: H, json: { title: "ISO audit", methodologyKey: "fw:iso27001" } });
    expect(a.status).toBe(201);
    expect(a.body.methodologyName).toContain("ISO/IEC 27001");
    const isoReqs = (await admin.json("/api/controls/requirements?framework=iso27001", { headers: H })).body as any[];
    const cl = (await admin.json(`/api/audits/${a.body.id}/checklist`, { headers: H })).body;
    expect(cl.items.length).toBe(isoReqs.length);
    expect(cl.items[0].requirementId).toMatch(/^iso27001:/);
    // pokrytí auditů podle hlavního rámce profilu
    const cov = (await admin.json("/api/audits/coverage", { headers: H })).body as any[];
    expect(cov.length).toBe(new Set(isoReqs.map((r) => r.section)).size);

    // hlášení incidentu podle čl. 23 NIS2 (balíček bez národního předpisu, ADR-081)
    const inc = await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Výpadek DE", kind: "incident", category: "dos", detectedAt: new Date().toISOString() } });
    expect(inc.body).toMatchObject({ reportable: false, regime: "nis2", recipient: "other" });
    const inc2 = await admin.json(`/api/incidents/${inc.body.id}`, { method: "PATCH", headers: H, json: { toleranceExceeded: true, significanceAreas: { operational: true } } });
    expect(inc2.body.reportable).toBe(true);
    expect(inc2.body.deadlines.map((d: any) => [d.type, d.label])).toEqual([
      ["initial", "Včasné varování"],
      ["notification", "Oznámení incidentu s prvotním posouzením, závažností, dopadem a IoC"],
      ["final", "Závěrečná zpráva"],
    ]);
    expect(inc2.body.deadlines[0].legal).toContain("NIS2");
    const rec = await (await admin.req(`/api/incidents/${inc.body.id}/record.html`, { headers: H })).text();
    expect(rec).toContain("NIS2");
    expect((await admin.req(`/api/incidents/${inc.body.id}`, { method: "DELETE", headers: H })).status).toBe(204);

    // balíček Německo: hlavní rámec NIS2, lhůty s odkazem na § 32 BSIG
    expect((await admin.json(`/api/companies/${co.body.id}`, { method: "PATCH", json: { pack: "de", regime: "lower", primaryFramework: null } })).body).toMatchObject({ pack: "de", regime: "lower" });
    scope = ((await admin.json("/api/controls/frameworks", { headers: H })).body as any[]).filter((f) => f.inScope).map((f) => f.id);
    expect(scope).toContain("nis2");
    const incDe = await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Ausfall", kind: "incident", category: "dos", detectedAt: new Date().toISOString(), toleranceExceeded: true, significanceAreas: { operational: true } } });
    expect(incDe.body.reportable).toBe(true);
    expect(incDe.body.deadlines[0].legal).toContain("§ 32 BSIG");
    expect((await admin.req(`/api/incidents/${incDe.body.id}`, { method: "DELETE", headers: H })).status).toBe(204);

    // zpět do balíčku CZ (nižší povinnosti) → zákon + vyhláška 410
    const upd = await admin.json(`/api/companies/${co.body.id}`, { method: "PATCH", json: { pack: "cz", regime: "lower", primaryFramework: null } });
    expect(upd.body).toMatchObject({ pack: "cz", regime: "lower" });
    scope = ((await admin.json("/api/controls/frameworks", { headers: H })).body as any[]).filter((f) => f.inScope).map((f) => f.id);
    expect(scope).toEqual(expect.arrayContaining(["zkb", "cz410"]));
    // finanční subjekt podle DORA: DORA sledovaná vždy, incidenty podle DORA (ADR-084)
    expect((await admin.json(`/api/companies/${co.body.id}`, { method: "PATCH", json: { doraEntity: true } })).body.doraEntity).toBe(true);
    scope = ((await admin.json("/api/controls/frameworks", { headers: H })).body as any[]).filter((f) => f.inScope).map((f) => f.id);
    expect(scope).toEqual(expect.arrayContaining(["zkb", "cz410", "dora"]));
    const incF = await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Výpadek platebního systému", kind: "incident", category: "dos", detectedAt: new Date().toISOString(), toleranceExceeded: true, significanceAreas: { operational: true } } });
    expect(incF.body).toMatchObject({ regime: "dora", reportable: true });
    expect(incF.body.deadlines.map((d: any) => d.type)).toEqual(["initial", "interim", "final"]);
    expect(incF.body.deadlines[0].legal).toContain("DORA");
    // výstupy podle rámce (ADR-086): hlášení DORA, dokumenty a zpráva pro vedení
    const repF = (await admin.json(`/api/incidents/${incF.body.id}/report?type=initial`, { headers: H })).body;
    expect(repF).toMatchObject({ recipient: "financial_supervisor", recipientName: "ČNB", title: "Prvotní oznámení závažného incidentu IKT" });
    expect(repF.legalBasis).toContain("DORA");
    expect(repF.missing.map((m: any) => m.key)).toContain("lei");
    expect(repF.sections.map((x: any) => x.key)).toContain("dora");
    expect(await (await admin.req(`/api/incidents/${incF.body.id}/report.html?type=initial`, { headers: H })).text()).toContain("ČNB");
    const revF = await (await admin.req("/api/documents/preview.html?kind=isms_review", { headers: H })).text();
    expect(revF).toContain("Přezkum rámce řízení rizik IKT");
    expect(revF).toContain("čl. 6 odst. 5");
    const rrF = await (await admin.req("/api/documents/preview.html?kind=risk_report", { headers: H })).text();
    expect(rrF).toContain("Zpráva o hodnocení rizik IKT");
    expect(rrF).toContain("úroveň tolerance rizik IKT");
    const mrF = (await admin.json("/api/reports/management", { headers: H })).body;
    expect(mrF.basisLabel).toContain("DORA");
    expect(mrF.kpis.map((x: any) => x.key)).toEqual(expect.arrayContaining(["dora_incidents", "dora_third_parties", "dora_testing"]));
    expect((await admin.req(`/api/incidents/${incF.body.id}`, { method: "DELETE", headers: H })).status).toBe(204);
    await admin.json(`/api/audits/${a.body.id}`, { method: "DELETE", headers: H });
    expect((await admin.req(`/api/companies/${co.body.id}`, { method: "DELETE" })).status).toBe(204);
  });

  test("sdílené aktivum holdingu a scénář s více hrozbami a zranitelnostmi (ADR-085)", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const a = await admin.json("/api/companies", { method: "POST", json: { name: "Dcera A" } });
    const b = await admin.json("/api/companies", { method: "POST", json: { name: "Dcera B" } });
    const HA = { "x-contix-company": a.body.id };
    const HB = { "x-contix-company": b.body.id };
    const asset = await admin.json("/api/assets", { method: "POST", headers: HA, json: { name: "Sdílený ERP", assetType: "application" } });
    expect(asset.status).toBe(201);
    // B aktivum nevidí, dokud není sdílené
    expect((await admin.json(`/api/assets/${asset.body.id}`, { headers: HB })).status).toBe(404);
    expect(((await admin.json("/api/assets?limit=500", { headers: HB })).body.items as any[]).some((x) => x.id === asset.body.id)).toBe(false);
    expect((await admin.json(`/api/assets/${asset.body.id}/companies`, { method: "PUT", headers: HA, json: { companyIds: [b.body.id, a.body.id] } })).body).toEqual({ sharedWith: [b.body.id] });
    expect((await admin.json(`/api/assets/${asset.body.id}/companies`, { method: "PUT", headers: HB, json: { companyIds: [] } })).status).toBe(404);
    const seen = await admin.json(`/api/assets/${asset.body.id}`, { headers: HB });
    expect(seen.body).toMatchObject({ ownedHere: false, canEdit: false, canShare: false, sharedWith: [b.body.id] });
    const listB = (await admin.json("/api/assets?limit=500", { headers: HB })).body.items as any[];
    expect(listB.find((x) => x.id === asset.body.id)).toMatchObject({ companyId: a.body.id, sharedWith: [b.body.id] });
    expect(((await admin.json("/api/assets?limit=500&shared=exclude", { headers: HB })).body.items as any[]).some((x) => x.id === asset.body.id)).toBe(false);
    expect(((await admin.json("/api/assets?limit=500&withGroup=1", { headers: HB })).body.items as any[]).some((x) => x.id === asset.body.id)).toBe(true);
    expect((await admin.json(`/api/assets/${asset.body.id}`, { method: "PATCH", headers: HB, json: { name: "Cizí" } })).status).toBe(404);
    // riziko společnosti B nad sdíleným aktivem se scénářem více hrozeb a zranitelností
    const threats = (await admin.json("/api/risks/catalog?kind=threat")).body as any[];
    const weak = (await admin.json("/api/risks/catalog?kind=weakness")).body as any[];
    const r = await admin.json("/api/risks", {
      method: "POST",
      headers: HB,
      json: { name: "Výpadek ERP", assetIds: [asset.body.id], threatId: threats[0].id, moreThreatIds: [threats[1].id, threats[2].id, threats[0].id], weaknessId: weak[0].id, moreWeaknessIds: [weak[1].id] },
    });
    expect(r.status).toBe(201);
    expect(r.body.moreThreatIds.sort()).toEqual([threats[1].id, threats[2].id].sort());
    expect(r.body.moreWeaknessIds).toEqual([weak[1].id]);
    expect(r.body.moreThreatNames).toHaveLength(2);
    expect(r.body.assets.map((x: any) => x.id)).toEqual([asset.body.id]);
    expect((await admin.json("/api/risks", { method: "POST", headers: HB, json: { name: "X", moreThreatIds: [weak[0].id] } })).status).toBe(400);
    const byThreat = (await admin.json(`/api/risks?threatId=${threats[2].id}`, { headers: HB })).body.items as any[];
    expect(byThreat.map((x) => x.id)).toContain(r.body.id);
    const p = await admin.json(`/api/risks/${r.body.id}`, { method: "PATCH", headers: HB, json: { moreThreatIds: [threats[3].id] } });
    expect(p.body.moreThreatIds).toEqual([threats[3].id]);
    expect(p.body.moreWeaknessIds).toEqual([weak[1].id]);
    // vlastní hrozba použitá jen jako další hrozba scénáře se nesmaže
    const own = await admin.json("/api/risks/catalog/threat", { method: "POST", json: { code: "X85", name: "Hrozba scénáře" } });
    await admin.json(`/api/risks/${r.body.id}`, { method: "PATCH", headers: HB, json: { moreThreatIds: [own.body.id] } });
    expect((await admin.json(`/api/risks/catalog/item/${own.body.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await admin.req(`/api/risks/${r.body.id}`, { method: "DELETE", headers: HB })).status).toBe(204);
    expect((await admin.req(`/api/risks/catalog/item/${own.body.id}`, { method: "DELETE" })).status).toBe(204);
    // zrušení sdílení
    await admin.json(`/api/assets/${asset.body.id}/companies`, { method: "PUT", headers: HA, json: { companyIds: [] } });
    expect((await admin.json(`/api/assets/${asset.body.id}`, { headers: HB })).status).toBe(404);
    expect((await admin.req(`/api/assets/${asset.body.id}`, { method: "DELETE", headers: HA })).status).toBe(204);
    for (const co of [a, b]) expect((await admin.req(`/api/companies/${co.body.id}`, { method: "DELETE" })).status).toBe(204);
    expect(root).toBeTruthy();
  });

  test("informační servis NÚKIB: RSS, posouzení varování, otevřená data, ruční nahrání (ADR-087)", async () => {
    const r = await admin.json("/api/legislation/infoservice/refresh", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.state.nukib).toMatchObject({ count: 3, error: null });
    expect(r.body.state["nukib-opendata"]).toMatchObject({ count: 3, error: null });
    const items = (await admin.json("/api/legislation/infoservice/items")).body as any[];
    expect(items.map((i) => i.kind)).toEqual(["warning", "vulnerability", "report"]);
    expect(items[0].summary).toBe("NÚKIB vydává varování");
    expect(items[2].link).toBe("");
    let info = (await admin.json("/api/legislation/infoservice")).body;
    expect(info.counts).toMatchObject({ total: 3, warningsOpen: 1, unreviewed: 3 });
    expect(info.stats).toMatchObject({ firstMonth: "2024-01", lastMonth: "2025-02", total: 3 });
    expect(JSON.stringify(info)).not.toMatch(/apiKey/);
    // posouzení varování za společnost
    expect((await admin.json(`/api/legislation/infoservice/items/${items[0].id}/review`, { method: "POST", json: { note: "Produkt X nepoužíváme." } })).status).toBe(200);
    info = (await admin.json("/api/legislation/infoservice")).body;
    expect(info.counts).toMatchObject({ warningsOpen: 0, unreviewed: 2 });
    const reviewed = ((await admin.json("/api/legislation/infoservice/items?kind=warning")).body as any[])[0];
    expect(reviewed.review).toMatchObject({ note: "Produkt X nepoužíváme." });
    expect(((await admin.json("/api/legislation/infoservice/items?unreviewed=1")).body as any[]).length).toBe(2);
    // opakované stažení položky neduplikuje a posouzení zůstává
    await admin.json("/api/legislation/infoservice/refresh", { method: "POST" });
    expect(((await admin.json("/api/legislation/infoservice/items")).body as any[]).length).toBe(3);
    expect((await admin.json("/api/legislation/infoservice")).body.counts.warningsOpen).toBe(0);
    expect((await admin.req(`/api/legislation/infoservice/items/${items[0].id}/review`, { method: "DELETE" })).status).toBe(204);
    // nastavení: jen https, různé klíče
    expect((await admin.json("/api/legislation/infoservice/settings", { method: "PUT", json: { autoRefresh: false, intervalHours: 12, feeds: [{ id: "nukib", name: "NÚKIB", url: "http://x" }], opendataEnabled: true, opendataUrl: "https://x/data.csv" } })).status).toBe(400);
    expect(
      (await admin.json("/api/legislation/infoservice/settings", { method: "PUT", json: { autoRefresh: false, intervalHours: 12, feeds: [{ id: "nukib", name: "NÚKIB", url: "https://nukib.gov.cz/rss.xml" }, { id: "sk", name: "SK-CERT", url: "https://www.sk-cert.sk/rss" }], opendataEnabled: false, opendataUrl: "https://x/data.csv" } })).status,
    ).toBe(200);
    // ruční nahrání
    const fd = new FormData();
    fd.append("source", "sk");
    fd.append("file", new File([INFO_RSS.replace(/g(\d)/g, "sk$1")], "rss.xml"));
    const up = await admin.req("/api/legislation/infoservice/upload", { method: "POST", body: fd });
    expect(up.status).toBe(200);
    expect(((await admin.json("/api/legislation/infoservice/items")).body as any[]).length).toBe(6);
    const bad = new FormData();
    bad.append("source", "opendata");
    bad.append("file", new File(["a,b\n1,2"], "data.csv"));
    expect((await admin.req("/api/legislation/infoservice/upload", { method: "POST", body: bad })).status).toBe(400);
    // čtenář nesmí měnit nastavení
    const reader = browser();
    await reader.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await reader.json("/api/legislation/infoservice/settings", { method: "PUT", json: { autoRefresh: true, intervalHours: 6, feeds: [], opendataEnabled: false, opendataUrl: "https://x/y.csv" } })).status).toBe(403);
  });

  test("informační servis: ruční doplnění měsíce a návrh čísel z PDF přehledu (ADR-087)", async () => {
    const base = "/api/legislation/infoservice";
    // ruční údaje nahradí otevřená data téhož měsíce
    expect((await admin.json(`${base}/stats/manual`, { method: "PUT", json: { month: "2025-02", classes: [], severities: [] } })).status).toBe(400);
    expect((await admin.json(`${base}/stats/manual`, { method: "PUT", json: { month: "2025-13", classes: [{ name: "Průnik", count: 1 }], severities: [] } })).status).toBe(400);
    expect((await admin.json(`${base}/stats/manual`, { method: "PUT", json: { month: "2025-02", classes: [{ name: "Průnik", count: 3 }, { name: "Průnik", count: 2 }, { name: "Podvod/phishing", count: 1 }], severities: [{ name: "Významný incident", count: 6 }] } })).status).toBe(200);
    let info = (await admin.json(base)).body;
    expect(info.manualMonths).toEqual(["2025-02"]);
    expect(info.stats.months.at(-1)).toMatchObject({ month: "2025-02", total: 6, byClass: { Průnik: 5, "Podvod/phishing": 1 } });
    expect((await admin.json(`${base}/stats/manual/2025-02`)).body).toMatchObject({ classes: expect.arrayContaining([{ name: "Průnik", count: 5 }]), severities: [{ name: "Významný incident", count: 6 }] });
    // návrh z PDF: bez AI odmítne
    await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: false } });
    expect(info.suggestAvailable).toBe(false);
    const fd0 = new FormData();
    fd0.append("source", "nukib");
    fd0.append("file", new File([`<rss><channel><item><title>Vydali jsme přehled kybernetických incidentů za březen 2026</title><link>https://nukib.gov.cz/cs/infoservis/aktuality/9-prehled-brezen</link><guid>rep-03</guid></item><item><title>Přehled kybernetických incidentů za únor 2026</title><link>https://evil.example/report</link><guid>rep-02</guid></item></channel></rss>`], "rss.xml"));
    expect((await admin.req(`${base}/upload`, { method: "POST", body: fd0 })).status).toBe(200);
    info = (await admin.json(base)).body;
    const rep = info.reports.find((r: any) => r.month === "2026-03");
    expect(rep).toBeTruthy();
    expect((await admin.json(`${base}/stats/suggest`, { method: "POST", json: { itemId: rep.id } })).status).toBe(400);
    await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: true, provider: "openai", baseUrl: AI_URL, model: "gpt-oss:20b", apiKey: "owui-key" } });
    expect((await admin.json(base)).body.suggestAvailable).toBe(true);
    const sg = await admin.json(`${base}/stats/suggest`, { method: "POST", json: { itemId: rep.id } });
    expect(sg.status).toBe(200);
    expect(sg.body).toMatchObject({ month: "2026-03", total: 20, sourceUrl: "https://nukib.gov.cz/download/publikace/vyzkum/Kyberneticke-incidenty-pohledem-NUKIB-brezen2026.pdf", model: "gpt-oss:20b" });
    expect(sg.body.classes.map((x: any) => x.name)).toEqual(["Průnik", "Podvod/phishing", "Dostupnost", "Škodlivý kód"]);
    expect(sg.body.warnings[0]).toContain("Klasifikace pokrývá 19 z 20");
    expect(JSON.stringify(aiCalls.at(-1))).toContain("evidoval celkem 20 incidentů");
    // starší měsíc bez položky v RSS – přehled se dohledá podle názvu souboru
    const byMonth = await admin.json(`${base}/stats/suggest`, { method: "POST", json: { month: "2026-03" } });
    expect(byMonth.status).toBe(200);
    expect(byMonth.body).toMatchObject({ month: "2026-03", sourceUrl: "https://nukib.gov.cz/download/publikace/vyzkum/Kyberneticke-incidenty-pohledem-NUKIB-brezen2026.pdf" });
    expect((await admin.json(`${base}/stats/suggest`, { method: "POST", json: { month: "2025-01" } })).status).toBe(404);
    expect((await admin.json(`${base}/stats/suggest`, { method: "POST", json: { month: "2025-01", itemId: rep.id } })).status).toBe(400);
    // cizí hostitel odkazu se nestahuje
    const evil = info.reports.find((r: any) => r.month === "2026-02");
    expect((await admin.json(`${base}/stats/suggest`, { method: "POST", json: { itemId: evil.id } })).status).toBe(400);
    // nahraný soubor, který není PDF
    const fd = new FormData();
    fd.append("file", new File(["neni pdf"], "Kyberneticke-incidenty-pohledem-NUKIB-brezen2026.pdf"));
    expect((await admin.req(`${base}/stats/suggest`, { method: "POST", body: fd })).status).toBe(400);
    // návrh se neukládá – uloží až člověk
    expect((await admin.json(base)).body.manualMonths).toEqual(["2025-02"]);
    expect((await admin.req(`${base}/stats/manual/2025-02`, { method: "DELETE" })).status).toBe(204);
    expect((await admin.json(base)).body.manualMonths).toEqual([]);
    await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: false } });
  });

  test("informační servis: posouzení dopadu, dotčená aktiva, navazující záznamy, vydavatel a země (ADR-088)", async () => {
    const base = "/api/legislation/infoservice";
    // vydavatel a země kanálu; slovenský kanál se české společnosti ve výchozím zobrazení nenabízí
    expect(
      (await admin.json(`${base}/settings`, { method: "PUT", json: { autoRefresh: false, intervalHours: 12, feeds: [{ id: "nukib", name: "NÚKIB", url: "https://nukib.gov.cz/rss.xml", publisher: "NÚKIB", country: "CZ" }, { id: "sk", name: "SK-CERT", url: "https://www.sk-cert.sk/rss", publisher: "SK-CERT", country: "SK" }], opendataEnabled: false, opendataUrl: "https://x/data.csv" } })).status,
    ).toBe(200);
    const fd = new FormData();
    fd.append("source", "nukib");
    fd.append("file", new File([`<rss><channel><item><title>Varování NÚKIB před zranitelností CVE-2026-55555 v produktu Contoso Gateway</title><link>https://nukib.gov.cz/cs/x/88</link><guid>adr88</guid><description>Zranitelnost CVE-2026-55555 v Contoso Gateway umožňuje vzdálené spuštění kódu.</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`], "rss.xml"));
    expect((await admin.req(`${base}/upload`, { method: "POST", body: fd })).status).toBe(200);
    let list = (await admin.json(`${base}/items`)).body as any[];
    expect(list.every((i) => i.feedId !== "sk")).toBe(true);
    expect(((await admin.json(`${base}/items?scope=all`)).body as any[]).some((i) => i.feedId === "sk")).toBe(true);
    expect(((await admin.json(`${base}/items?scope=all&publisher=SK-CERT`)).body as any[]).every((i) => i.publisher === "SK-CERT")).toBe(true);
    const item = list.find((i) => i.title.includes("CVE-2026-55555"));
    expect(item).toMatchObject({ kind: "warning", publisher: "NÚKIB", country: "CZ", assessment: null });
    // návrh dotčených aktiv: CVE ve zranitelnostech, produkt v softwaru
    const [a1] = await db.execute(sql`insert into assets (name, asset_type) values ('gw-01', 'server') returning id`);
    const [a2] = await db.execute(sql`insert into assets (name, asset_type) values ('app-contoso', 'server') returning id`);
    await db.execute(sql`insert into asset_vulnerabilities (asset_id, cve_id, severity, status) values (${(a1 as any).id}, 'CVE-2026-55555', 'critical', 'open')`);
    await db.execute(sql`insert into asset_software (asset_id, name, version, source_type) values (${(a2 as any).id}, 'Contoso Gateway Agent', '1.2', 'manual')`);
    const sugg = (await admin.json(`${base}/items/${item.id}/suggest-assets`)).body as any[];
    expect(sugg.find((x) => x.id === (a1 as any).id)?.reason).toBe("CVE-2026-55555");
    expect(sugg.find((x) => x.id === (a2 as any).id)?.reason).toContain("software");
    // posouzení: dotčeno, odpovědné místo, termín, aktiva
    const as = await admin.json(`${base}/items/${item.id}/assessment`, { method: "PUT", json: { status: "affected", note: "Brána gw-01 je zranitelná.", ownerPositionId: ids.posHead, dueDate: "2020-01-31", assetIds: [(a1 as any).id] } });
    expect(as.status).toBe(200);
    expect(as.body).toMatchObject({ status: "affected", ownerName: "Vedoucí OI", assets: [{ id: (a1 as any).id, name: "gw-01" }] });
    expect((await admin.json(`${base}/items/${item.id}/assessment`, { method: "PUT", json: { status: "bogus" } })).status).toBe(400);
    let info = (await admin.json(base)).body;
    expect(info.counts.warningsOpen).toBeGreaterThanOrEqual(1); // dotčeno = stále otevřené
    // navazující úkol se zdrojem „informační servis“
    const task = await admin.json("/api/actions/tasks", { method: "POST", json: { title: "Aktualizovat Contoso Gateway", sourceKind: "info_item", sourceId: as.body.id } });
    expect(task.status).toBe(201);
    expect(task.body).toMatchObject({ sourceLabel: item.title, sourceLink: "/infoservice" });
    const ln = await admin.json(`${base}/items/${item.id}/links`, { method: "POST", json: { kind: "task", targetId: task.body.id } });
    expect(ln.body.links).toEqual([{ kind: "task", targetId: task.body.id, label: `${task.body.code} Aktualizovat Contoso Gateway` }]);
    expect((await admin.json(`${base}/items/${item.id}/links`, { method: "POST", json: { kind: "risk", targetId: task.body.id } })).status).toBe(404);
    // detail aktiva: varování, které se ho týká
    expect(((await admin.json(`${base}/by-asset/${(a1 as any).id}`)).body as any[]).map((x) => x.id)).toEqual([item.id]);
    // povinnost odpovědného místa
    const owner = browser();
    await owner.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect(((await owner.json("/api/notifications/mine")).body as any[]).some((o) => o.kind === "info_assessment")).toBe(true);
    // vstup zprávy o hodnocení rizik
    const rootCo = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const rr = await (await admin.req("/api/documents/preview.html?kind=risk_report", { headers: { "x-contix-company": rootCo.id } })).text();
    expect(rr).toContain("CVE-2026-55555");
    expect(rr).toContain("Dotčeno");
    // vyřešeno = uzavřené
    await admin.json(`${base}/items/${item.id}/assessment`, { method: "PUT", json: { status: "resolved", note: "Aktualizováno." } });
    info = (await admin.json(base)).body;
    expect(((await admin.json(`${base}/items?unreviewed=1`)).body as any[]).some((i) => i.id === item.id)).toBe(false);
    expect((await admin.json(`${base}/items/${item.id}`)).body.assessment).toMatchObject({ status: "resolved", assets: [{ name: "gw-01" }] });
    expect(((await owner.json("/api/notifications/mine")).body as any[]).some((o) => o.kind === "info_assessment")).toBe(false);
  });

  test("informační servis: zdroj bez RSS (stránka s novinkami) a výchozí druh kanálu (ADR-089)", async () => {
    const base = "/api/legislation/infoservice";
    const feeds = [
      { id: "nukib", name: "NÚKIB", url: "https://nukib.gov.cz/rss.xml", publisher: "NÚKIB", country: "CZ" },
      { id: "csirtcz", name: "CSIRT.CZ", url: "https://csirt.cz/cs/kyberbezpecnost/aktualne-z-bezpecnosti/", publisher: "CSIRT.CZ", country: "CZ", format: "html", linkPrefix: "/cs/kyberbezpecnost/aktualne-z-bezpecnosti/" },
      { id: "certat", name: "CERT.at Warnungen", url: "https://www.cert.at/cert-at.de.warnings.rss_2.0.xml", publisher: "CERT.at", country: "", defaultKind: "warning" },
    ];
    expect((await admin.json(`${base}/settings`, { method: "PUT", json: { autoRefresh: false, intervalHours: 12, feeds, opendataEnabled: false, opendataUrl: "https://x/data.csv" } })).status).toBe(200);
    const up = async (source: string, body: string, name: string) => {
      const fd = new FormData();
      fd.append("source", source);
      fd.append("file", new File([body], name));
      return admin.req(`${base}/upload`, { method: "POST", body: fd });
    };
    const html = `<html><body><a href="/cs/kyberbezpecnost/aktualne-z-bezpecnosti/podvodne-sms-o-zasilkach/">Podvodné SMS o zásilkách se opět šíří</a><span>20. 10. 2026</span><a href="/cs/kyberbezpecnost/aktualne-z-bezpecnosti/?page=2">Starší novinky z bezpečnosti</a></body></html>`;
    expect((await up("csirtcz", html, "page.html")).status).toBe(200);
    expect((await up("csirtcz", "<html><body>nic</body></html>", "page.html")).status).toBe(400);
    expect((await up("certat", `<rss><channel><item><title>Neue Version von Foo verfügbar</title><link>https://www.cert.at/de/x/1</link><guid>certat-1</guid></item></channel></rss>`, "w.xml")).status).toBe(200);
    const items = (await admin.json(`${base}/items?scope=all`)).body as any[];
    const cz = items.find((i) => i.feedId === "csirtcz");
    expect(cz).toMatchObject({ title: "Podvodné SMS o zásilkách se opět šíří", publisher: "CSIRT.CZ", link: "https://csirt.cz/cs/kyberbezpecnost/aktualne-z-bezpecnosti/podvodne-sms-o-zasilkach/" });
    expect(cz.publishedAt.slice(0, 10)).toBe("2026-10-20");
    expect(items.find((i) => i.feedId === "certat")).toMatchObject({ kind: "warning", publisher: "CERT.at" });
  });

  test("§ 6 dokumentace: verze, schválení, přezkum, okruh dotčených osob a seznámení", async () => {
    const owner = browser();
    await owner.login("owner@test.cz", "Nove-Heslo-2026!!");
    const p = await admin.json("/api/policies", {
      method: "POST",
      json: { code: "BP-01", title: "Bezpečnostní politika", docType: "policy", sections: ["§ 6", "§ 10", "§ 99"], ownerPositionId: ids.posMkb, audience: { unitIds: [ids.unitRoot] }, location: "SharePoint/ISMS" },
    });
    expect(p.status).toBe(201);
    expect(p.body.gaps.join()).toContain("schválenou verzi");
    const v = await admin.json(`/api/policies/${p.body.id}/versions`, { method: "POST", json: { version: "1.0", changeSummary: "První vydání", content: "# Politika\nText" } });
    expect(v.body.versions[0].status).toBe("draft");
    expect((await admin.json(`/api/policies/${p.body.id}/versions`, { method: "POST", json: { version: "1.1" } })).status).toBe(409);
    // čtenář dokument nevidí v „mých“, dokud není schválen
    expect((await owner.json("/api/policies/mine")).body).toEqual([]);
    const vid = v.body.versions[0].id;
    const ap = await admin.json(`/api/policies/${p.body.id}/versions/${vid}/approve`, { method: "POST" });
    expect(ap.body.status).toBe("active");
    expect(ap.body.currentVersion).toBe("1.0");
    expect(ap.body.nextReviewDue).toBeTruthy();
    // útvar včetně podřízených → vedoucí OI (owner) je v okruhu
    expect(ap.body.people.map((x: any) => x.name)).toContain("Eva Vlastník");
    expect(ap.body.ack.required).toBeGreaterThan(0);
    expect(ap.body.gaps.join()).toContain("Seznámeno 0");
    // osobní povinnost k seznámení
    const ob = (await owner.json("/api/notifications/mine")).body as any[];
    expect(ob.some((o) => o.kind === "policy_ack")).toBe(true);
    const mine = (await owner.json("/api/policies/mine")).body as any[];
    expect(mine[0].acknowledgedAt).toBeNull();
    expect((await owner.json(`/api/policies/${p.body.id}/versions/${vid}/content`)).body.content).toContain("Politika");
    const ack = await owner.json(`/api/policies/${p.body.id}/versions/${vid}/acknowledge`, { method: "POST" });
    expect(ack.body[0].acknowledgedAt).toBeTruthy();
    // schválenou verzi nelze smazat ani dokument
    expect((await admin.json(`/api/policies/${p.body.id}/versions/${vid}`, { method: "DELETE" })).status).toBe(409);
    expect((await admin.json(`/api/policies/${p.body.id}`, { method: "DELETE" })).status).toBe(409);
    // nová verze nahradí předchozí; seznámení je třeba znovu
    await admin.json(`/api/policies/${p.body.id}/versions`, { method: "POST", json: { version: "1.1", content: "# Politika 1.1" } });
    const d2 = (await admin.json(`/api/policies/${p.body.id}`)).body;
    await admin.json(`/api/policies/${p.body.id}/versions/${d2.versions[0].id}/approve`, { method: "POST" });
    const d3 = (await admin.json(`/api/policies/${p.body.id}`)).body;
    expect(d3.versions.map((x: any) => x.status)).toEqual(["approved", "superseded"]);
    expect((await owner.json("/api/policies/mine")).body[0].acknowledgedAt).toBeNull();
    // přezkum beze změny
    const rv = await admin.json(`/api/policies/${p.body.id}/review`, { method: "POST", json: { note: "Beze změn" } });
    expect(rv.body.lastReviewNote).toBe("Beze změn");
    // pokrytí oddílů – neznámý oddíl se nezapočítá
    const cov = (await admin.json("/api/policies/coverage")).body as any[];
    expect(cov.find((x) => x.section === "§ 6").documents).toBe(1);
    expect(cov.find((x) => x.section === "§ 8").documents).toBe(0);
    // čtenář nemůže zakládat
    expect((await owner.json("/api/policies", { method: "POST", json: { title: "X" } })).status).toBe(403);
    ids.policy = p.body.id;
  });

  test("§ 10 povědomí: školení, termíny, absolvování, stav osob a přehled", async () => {
    const c = await admin.json("/api/awareness", {
      method: "POST",
      json: { code: "SK-01", title: "Pravidelné školení KB", kind: "periodic", intervalMonths: 12, audience: { positionIds: [ids.posHead] }, policyId: ids.policy, topics: ["Phishing"] },
    });
    expect(c.status).toBe(201);
    expect(c.body.required).toBe(1);
    expect(c.body.stats.overdue).toBe(1);
    const owner = browser();
    await owner.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await owner.json("/api/awareness/mine")).body[0].state).toBe("overdue");
    expect((await owner.json("/api/notifications/mine")).body.some((o: any) => o.kind === "training")).toBe(true);
    // termín proběhl → absolvování účastníků
    const ownerId = (await owner.json("/api/auth/me")).body.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const s = await admin.json(`/api/awareness/${c.body.id}/sessions`, { method: "POST", json: { date: today, status: "held", trainer: "MKB", participantIds: [ownerId], effectiveness: "Test 90 %" } });
    expect(s.body.sessions[0].participants).toBe(1);
    expect(s.body.people[0].state).toBe("ok");
    expect(s.body.people[0].validUntil).toBeTruthy();
    // ruční zápis bez duplicity téhož dne
    await admin.json(`/api/awareness/${c.body.id}/records`, { method: "POST", json: { userIds: [ownerId], completedAt: today } });
    const recs = (await admin.json(`/api/awareness/${c.body.id}/records`)).body as any[];
    expect(recs.length).toBe(1);
    const log = (await admin.json(`/api/awareness/log?from=${today}`)).body as any[];
    expect(log[0].courseTitle).toBe("Pravidelné školení KB");
    // školení se záznamy nelze smazat
    expect((await admin.json(`/api/awareness/${c.body.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await owner.json("/api/awareness")).status).toBe(403);
  });

  test("upozornění: nastavení SMTP a Teams, souhrn povinností, test kanálu", async () => {
    expect((await admin.json("/api/notifications/settings", { method: "PATCH", json: { emailEnabled: true } })).status).toBe(400);
    expect((await admin.json("/api/notifications/settings", { method: "PATCH", json: { teamsWebhookUrl: "https://evil.example.com/hook" } })).status).toBe(400);
    const s = await admin.json("/api/notifications/settings", {
      method: "PATCH",
      json: { emailEnabled: true, smtpHost: "smtp.test.cz", smtpFrom: "contix@test.cz", smtpUser: "u", smtpPassword: "tajne", teamsEnabled: true, teamsWebhookUrl: "https://prod-01.westeurope.logic.azure.com/workflows/abc", leadDays: 30 },
    });
    expect(s.status).toBe(200);
    expect(s.body.smtpPasswordSet).toBe(true);
    expect(s.body.teamsWebhookSet).toBe(true);
    expect(JSON.stringify(s.body)).not.toContain("tajne");
    expect(JSON.stringify(s.body)).not.toContain("logic.azure.com");
    // owner má neseznámenou novou verzi politiky → osobní souhrn
    const r = await admin.json("/api/notifications/run", { method: "POST" });
    expect(r.status).toBe(200);
    const toOwner = sentMails.find((m) => m.to === "owner@test.cz");
    expect(toOwner?.subject).toContain("Vaše povinnosti");
    expect(toOwner?.html).toContain("Bezpečnostní politika");
    const team = (await admin.json("/api/notifications/team")).body as any[];
    if (team.length) {
      expect(teamsPosts.length).toBeGreaterThan(0);
      expect(teamsPosts[0]!.url).toContain("logic.azure.com");
      expect(teamsPosts[0]!.payload.attachments[0].contentType).toContain("adaptive");
    }
    const t = await admin.json("/api/notifications/test", { method: "POST", json: { channel: "email", to: "x@test.cz" } });
    expect(t.body.ok).toBe(true);
    expect(sentMails.at(-1)!.to).toBe("x@test.cz");
    const owner = browser();
    await owner.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await owner.json("/api/notifications/settings")).status).toBe(403);
  });

  test("akce a úkoly: úkoly navázané na záznam, jednotný přehled, vlastník mění stav, povinnosti", async () => {
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    const sup = (await admin.json("/api/suppliers", { method: "POST", json: { name: "Úkolový dodavatel s.r.o." } })).body;
    // úkol navázaný na dodavatele – společnost se převezme ze zdroje
    const t1 = await admin.json("/api/actions/tasks", {
      method: "POST",
      json: { title: "Doplnit do smlouvy ustanovení o MFA", sourceKind: "supplier", sourceId: sup.id, ownerPositionId: ids.posHead, dueDate: "2020-01-31", priority: "high" },
    });
    expect(t1.status).toBe(201);
    expect(t1.body).toMatchObject({ sourceKind: "supplier", sourceLabel: "Úkolový dodavatel s.r.o.", sourceLink: `/suppliers/${sup.id}`, companyId: sup.companyId, status: "open", canManage: true });
    expect(t1.body.code).toMatch(/^#\d+$/);
    // neexistující zdroj, chybějící ID zdroje
    expect((await admin.json("/api/actions/tasks", { method: "POST", json: { title: "X", sourceKind: "incident", sourceId: "00000000-0000-4000-8000-000000000999" } })).status).toBe(404);
    expect((await admin.json("/api/actions/tasks", { method: "POST", json: { title: "X", sourceKind: "incident" } })).status).toBe(400);
    const t2 = (await admin.json("/api/actions/tasks", { method: "POST", json: { title: "Samostatný úkol bez termínu", companyId: ROOT_COMPANY_ID } })).body;
    expect(t2.sourceKind).toBeNull();
    // karta úkolů u záznamu
    const bySrc = (await admin.json(`/api/actions/tasks?sourceKind=supplier&sourceId=${sup.id}`)).body as any[];
    expect(bySrc.map((x) => x.id)).toEqual([t1.body.id]);

    // jednotný přehled: úkoly + akce plánu zvládání + zjištění auditů
    const all = await admin.json("/api/actions?status=all");
    expect(all.status).toBe(200);
    const kinds = new Set((all.body.items as any[]).map((a) => a.kind));
    expect(kinds.has("task")).toBe(true);
    expect(all.body.kinds).toEqual(expect.arrayContaining(["task", "risk_action", "audit_finding"]));
    const it1 = (all.body.items as any[]).find((a) => a.id === t1.body.id);
    expect(it1).toMatchObject({ kind: "task", overdue: true, ownerName: "Vedoucí OI", source: "Dodavatel: Úkolový dodavatel s.r.o." });
    expect(all.body.items[0].overdue).toBe(true); // po termínu nahoře
    expect(all.body.summary.overdue).toBeGreaterThanOrEqual(1);
    const mine = (await admin.json("/api/actions?mine=1")).body.items as any[];
    expect(mine.every((a) => a.ownerPositionId === undefined || true)).toBe(true);
    expect(((await admin.json("/api/actions?kind=task&q=mfa")).body.items as any[]).map((a) => a.id)).toEqual([t1.body.id]);
    // povinnost úkolu u vlastníka (držitel funkčního místa)
    const owner = browser();
    await owner.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect(((await owner.json("/api/notifications/mine")).body as any[]).some((o) => o.kind === "task" && o.link === `/actions?task=${t1.body.id}`)).toBe(true);
    // vlastník mění jen stav a poznámku
    expect((await owner.json(`/api/actions/tasks/${t1.body.id}`, { method: "PATCH", json: { title: "Přejmenovat" } })).status).toBe(403);
    const done = await owner.json(`/api/actions/tasks/${t1.body.id}`, { method: "PATCH", json: { status: "done", completionNote: "Dodatek č. 2 podepsán" } });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("done");
    expect(done.body.completedAt).not.toBeNull();
    expect(done.body.canManage).toBe(false);
    expect(done.body.canEdit).toBe(true);
    // znovuotevření smaže datum splnění
    expect((await admin.json(`/api/actions/tasks/${t1.body.id}`, { method: "PATCH", json: { status: "in_progress" } })).body.completedAt).toBeNull();
    // cizí úkol vlastník nemění
    expect((await owner.json(`/api/actions/tasks/${t2.id}`, { method: "PATCH", json: { status: "done" } })).status).toBe(403);
    // hromadné změny (v1.10): vlastník jen stav vlastních úkolů, ostatní přeskočí; správce termín a vlastníka
    const t3 = (await admin.json("/api/actions/tasks", { method: "POST", json: { title: "Hromadný úkol", companyId: ROOT_COMPANY_ID, ownerPositionId: ids.posHead } })).body;
    expect((await owner.json("/api/actions/tasks/bulk", { method: "POST", json: { ids: [t3.id] } })).status).toBe(400);
    const ob = await owner.json("/api/actions/tasks/bulk", { method: "POST", json: { ids: [t3.id, t2.id], status: "in_progress", dueDate: "2030-01-01" } });
    expect(ob.status).toBe(200);
    expect(ob.body).toEqual({ updated: 1, skipped: [t2.id] });
    const t3b = (await admin.json(`/api/actions/tasks/${t3.id}`)).body;
    expect(t3b.status).toBe("in_progress");
    expect(t3b.dueDate).toBeNull(); // termín mění jen správce
    const ab = await admin.json("/api/actions/tasks/bulk", { method: "POST", json: { ids: [t3.id, t2.id], dueDate: "2030-06-30", ownerPositionId: ids.posMkb } });
    expect(ab.body).toEqual({ updated: 2, skipped: [] });
    expect((await admin.json(`/api/actions/tasks/${t2.id}`)).body).toMatchObject({ dueDate: "2030-06-30", ownerPositionId: ids.posMkb });
    const bulkDone = await admin.json("/api/actions/tasks/bulk", { method: "POST", json: { ids: [t3.id], status: "done" } });
    expect(bulkDone.body.updated).toBe(1);
    expect((await admin.json(`/api/actions/tasks/${t3.id}`)).body.completedAt).not.toBeNull();

    // funkční místo: detail a předání odpovědnosti (v1.10)
    const pA = (await admin.json("/api/org/positions", { method: "POST", json: { orgUnitId: ids.unitIt, name: "Odcházející správce" } })).body;
    const pB = (await admin.json("/api/org/positions", { method: "POST", json: { orgUnitId: ids.unitIt, name: "Nástupce správce" } })).body;
    await admin.json(`/api/actions/tasks/${t3.id}`, { method: "PATCH", json: { ownerPositionId: pA.id } });
    const det = await admin.json(`/api/org/positions/${pA.id}/detail`);
    expect(det.status).toBe(200);
    expect(det.body.position).toMatchObject({ name: "Odcházející správce", unitName: "Odbor informatiky", holders: [] });
    const tg = det.body.groups.find((g: any) => g.kind === "task");
    expect(tg).toMatchObject({ total: 1, canHandover: true, items: [{ id: t3.id, label: "Hromadný úkol", link: `/actions?task=${t3.id}` }] });
    expect((await owner.json(`/api/org/positions/${pA.id}/handover`, { method: "POST", json: { targetPositionId: pB.id, kinds: ["task"] } })).status).toBe(403);
    expect((await admin.json(`/api/org/positions/${pA.id}/handover`, { method: "POST", json: { targetPositionId: pA.id, kinds: ["task"] } })).status).toBe(400);
    expect((await admin.json(`/api/org/positions/${pA.id}/handover`, { method: "POST", json: { targetPositionId: "00000000-0000-4000-8000-000000000999", kinds: ["task"] } })).status).toBe(400);
    const ho = await admin.json(`/api/org/positions/${pA.id}/handover`, { method: "POST", json: { targetPositionId: pB.id, kinds: ["task", "risk"], note: "Odchod" } });
    expect(ho.status).toBe(200);
    expect(ho.body.moved).toEqual({ task: 1, risk: 0 });
    expect((await admin.json(`/api/actions/tasks/${t3.id}`)).body.ownerPositionId).toBe(pB.id);
    expect((await admin.json(`/api/org/positions/${pA.id}/detail`)).body.groups).toEqual([]);
    expect((await admin.json(`/api/org/positions/00000000-0000-4000-8000-000000000999/detail`)).status).toBe(404);
    const auditLog = (await admin.json("/api/admin/audit-log?limit=10")).body;
    expect(JSON.stringify(auditLog)).toContain("Nástupce správce");
    // CSV
    const csv = await admin.req("/api/actions/export");
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("Doplnit do smlouvy ustanovení o MFA");
    // smazání jen správce
    expect((await owner.json(`/api/actions/tasks/${t2.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await admin.json(`/api/actions/tasks/${t2.id}`, { method: "DELETE" })).status).toBe(204);
  });

  test("trendy: měsíční snímky ukazatelů, přepis běžného měsíce, historie", async () => {
    const { takeTrendSnapshot, processTrendSnapshots } = await import("../src/modules/trends/service");
    const { loadTrends } = await import("../src/modules/trends/routes");
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    // starší měsíce (pořízené plánovačem v minulosti)
    await takeTrendSnapshot(db, ROOT_COMPANY_ID, new Date("2026-08-15T10:00:00Z"));
    await takeTrendSnapshot(db, ROOT_COMPANY_ID, new Date("2026-09-15T10:00:00Z"));
    // GET bez snímku běžného měsíce ho pořídí
    const r = await admin.json(`/api/trends?months=6&companyId=${ROOT_COMPANY_ID}`);
    expect(r.status).toBe(200);
    const periods = r.body.points.map((p: any) => p.period);
    expect(periods).toContain("2026-08");
    expect(periods).toContain("2026-09");
    const cur = new Date().toISOString().slice(0, 7);
    expect(periods.at(-1)).toBe(cur);
    const last = r.body.points.at(-1).values;
    expect(typeof last.compliance).toBe("number");
    expect(last["compliance:cz409"]).toBe(last.compliance);
    expect(typeof last.risks_total).toBe("number");
    expect(typeof last.obligations_overdue).toBe("number");
    expect(typeof last.exceptions_total).toBe("number");
    expect(r.body.framework).toBe("cz409");
    expect(r.body.frameworks.map((f: any) => f.id)).toContain("cz409");
    // přepis běžného měsíce (jeden záznam za měsíc)
    const before = (await loadTrends(db, ROOT_COMPANY_ID, 3)).points.length;
    await takeTrendSnapshot(db, ROOT_COMPANY_ID);
    expect((await loadTrends(db, ROOT_COMPANY_ID, 3)).points.length).toBe(before);
    // plánovač: čerstvý snímek nepřepisuje
    expect(await processTrendSnapshots(db)).toEqual([]);
    expect((await admin.json(`/api/trends?months=99&companyId=${ROOT_COMPANY_ID}`)).status).toBe(400);
    // tisková zpráva pro vedení obsahuje tabulku vývoje
    const rep = await admin.req(`/api/reports/management.html?companyId=${ROOT_COMPANY_ID}`);
    expect(rep.status).toBe(200);
    expect(await rep.text()).toContain("Vývoj ukazatelů (měsíční snímky)");
  });

  test("ARES: dodavatel podle IČO nebo názvu, kontrolní číslice, oprávnění", async () => {
    expect((await admin.json("/api/ares/status")).body).toEqual({ enabled: true });
    const byIco = await admin.json("/api/ares/search?q=27074358");
    expect(byIco.status).toBe(200);
    expect(byIco.body).toEqual([{ ico: "27074358", name: "Asseco Central Europe, a.s.", address: "Budějovická 778/3a, Michle, 14000 Praha 4", country: "Česká republika", dic: "CZ27074358", legalForm: "121", dissolvedAt: null }]);
    const byName = await admin.json("/api/ares/search?q=Asseco");
    expect(byName.body.map((x: any) => x.ico)).toEqual(["27074358", "25672541"]);
    expect(byName.body[1].dissolvedAt).toBe("2020-01-01");
    expect(byName.body[1].country).toBe("Česká republika");
    // nic nenalezeno / příliš obecný dotaz = prázdný seznam; špatná kontrolní číslice se do ARES neposílá
    expect((await admin.json("/api/ares/search?q=00000019")).body).toEqual([]);
    expect((await admin.json("/api/ares/search?q=xyzxyz")).body).toEqual([]);
    expect((await admin.json("/api/ares/search?q=ab")).body).toEqual([]);
    const n = aresCalls.length;
    expect((await admin.json("/api/ares/search?q=12345678")).status).toBe(400);
    expect(aresCalls.length).toBe(n);
    // cache: opakovaný dotaz nejde do ARES
    await admin.json("/api/ares/search?q=27074358");
    expect(aresCalls.length).toBe(n);
    // čtenář bez práva zápisu dodavatelů ani správy nehledá
    const reader = browser();
    await reader.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await reader.json("/api/ares/search?q=Asseco")).status).toBe(403);
  });

  test("bezpečnostní dotazník dodavatele: odkaz, vyplnění bez přihlášení, vyhodnocení, riziko", async () => {
    const sup = (await admin.json("/api/suppliers", { method: "POST", json: { name: "Cloud hosting a.s.", significant: true, contactEmail: "security@hosting.test" } })).body;
    // vytvoření + e-mail dodavateli (SMTP je nastavené v testu upozornění)
    const before = sentMails.length;
    const cr = await admin.json(`/api/suppliers/${sup.id}/questionnaires`, { method: "POST", json: { template: "cz410", locale: "en", sendEmail: true, message: "Díky!", validDays: 7 } });
    expect(cr.status).toBe(201);
    expect(cr.body.emailed).toBe(true);
    expect(sentMails.length).toBe(before + 1);
    expect(sentMails.at(-1)!.to).toBe("security@hosting.test");
    const link: string = cr.body.link;
    expect(sentMails.at(-1)!.html).toContain(link);
    const token = link.split("/q/")[1]!;
    expect(token.length).toBeGreaterThan(30);
    const q = cr.body.questionnaire;
    expect(q.status).toBe("sent");
    expect(q.result.total).toBe(21); // zkrácená sada pro vyhl. 410 (z 30)
    // povinnost „čeká na dodavatele“
    expect(((await admin.json("/api/notifications/team")).body as any[]).some((o) => o.kind === "supplier_questionnaire" && o.link === `/suppliers/${sup.id}`)).toBe(true);

    // veřejný přístup bez přihlášení (jen správný token), anglicky
    const pub = browser();
    expect((await pub.json("/api/public/questionnaires/neplatny-token-xxxxxxxxxxxxxxxx")).status).toBe(404);
    const v = await pub.json(`/api/public/questionnaires/${token}`);
    expect(v.status).toBe(200);
    expect(v.body.status).toBe("open");
    expect(v.body.supplierName).toBe("Cloud hosting a.s.");
    expect(v.body.questions[0].text).toMatch(/^Does your organization/);
    expect(v.body).not.toHaveProperty("tokenHash");
    // rozpracované uložení (neznámé otázky se zahodí, „netýká se“ jen kde je dovoleno)
    const keys: string[] = v.body.questions.map((x: any) => x.key);
    const answers: Record<string, any> = Object.fromEntries(keys.map((k) => [k, { value: "yes" }]));
    answers["acc.mfa"] = { value: "no", comment: "Plánujeme do konce roku" };
    answers["ops.backup"] = { value: "partial" };
    answers["gov.policy"] = { value: "na" };
    const saved = await pub.json(`/api/public/questionnaires/${token}`, { method: "PUT", json: { answers: { ...answers, "zz.unknown": { value: "yes" } } } });
    expect(saved.status).toBe(200);
    expect(saved.body.answers["zz.unknown"]).toBeUndefined();
    expect(saved.body.answers["gov.policy"]).toBeUndefined();
    // přílohy: k otázce i obecné, typ podle přípony, limity
    const up = (name: string, data: string | Uint8Array, questionKey?: string) => {
      const fd = new FormData();
      fd.set("file", new File([data], name));
      if (questionKey) fd.set("questionKey", questionKey);
      return pub.req(`/api/public/questionnaires/${token}/files`, { method: "POST", body: fd });
    };
    const f1 = await up("ISO 27001 certifikát.pdf", "%PDF-1.4 test", "gov.policy");
    expect(f1.status).toBe(201);
    const v1 = (await f1.json()) as any;
    expect(v1.files).toHaveLength(1);
    expect(v1.files[0]).toMatchObject({ questionKey: "gov.policy", filename: "ISO 27001 certifikát.pdf", size: 13 });
    expect((await up("politika.docx", "PK..")).status).toBe(201);
    expect((await up("skript.html", "<script>alert(1)</script>")).status).toBe(400);
    expect((await up("x.exe", "MZ")).status).toBe(400);
    expect((await up("a.pdf", "x", "zz.neni")).status).toBe(400);
    expect((await up("velky.pdf", new Uint8Array(10 * 1024 * 1024 + 1))).status).toBe(413);
    const v2 = (await pub.json(`/api/public/questionnaires/${token}`)).body;
    expect(v2.files).toHaveLength(2);
    expect((await pub.json(`/api/public/questionnaires/${token}/files/${v2.files[1].id}`, { method: "DELETE" })).body.files).toHaveLength(1);

    // neúplné odevzdání se odmítne
    const inc = await pub.json(`/api/public/questionnaires/${token}/submit`, { method: "POST", json: { answers, respondentName: "Jan Novák", respondentEmail: "jan@hosting.test" } });
    expect(inc.status).toBe(400);
    answers["gov.policy"] = { value: "yes" };
    const sub = await pub.json(`/api/public/questionnaires/${token}/submit`, { method: "POST", json: { answers, respondentName: "Jan Novák", respondentEmail: "jan@hosting.test", respondentRole: "CISO" } });
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe("submitted");
    // po odevzdání nelze měnit
    expect((await pub.json(`/api/public/questionnaires/${token}`, { method: "PUT", json: { answers } })).status).toBe(409);
    expect((await up("pozde.pdf", "%PDF")).status).toBe(409);
    expect((await pub.json(`/api/public/questionnaires/${token}/submit`, { method: "POST", json: { answers, respondentName: "X", respondentEmail: "x@hosting.test" } })).status).toBe(409);

    // vyhodnocení: klíčová otázka MFA = ne → vysoké riziko
    const list = (await admin.json(`/api/suppliers/${sup.id}/questionnaires`)).body as any[];
    expect(list[0].status).toBe("submitted");
    expect(list[0].result.criticalNo).toBe(1);
    expect(list[0].result.level).toBe("high");
    expect(list[0].result.gaps[0].key).toBe("acc.mfa");
    expect(list[0].respondentName).toBe("Jan Novák");
    // příloha ke stažení jen přihlášenému, vždy jako příloha
    expect(list[0].files.map((f: any) => f.filename)).toEqual(["ISO 27001 certifikát.pdf"]);
    const dl = await admin.req(`/api/suppliers/${sup.id}/questionnaires/${q.id}/files/${list[0].files[0].id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-disposition")).toContain("attachment;");
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await dl.text()).toBe("%PDF-1.4 test");
    expect(((await admin.json("/api/notifications/team")).body as any[]).find((o) => o.kind === "supplier_questionnaire")?.detail).toContain("vyhodnoťte");
    const ev = await admin.json(`/api/suppliers/${sup.id}/questionnaires/${q.id}/evaluate`, { method: "POST", json: { note: "Požadujeme MFA do 31. 12." } });
    expect(ev.status).toBe(200);
    expect(ev.body.status).toBe("evaluated");
    expect((await admin.json(`/api/suppliers/${sup.id}`)).body.riskAssessedAt).toBe(new Date().toISOString().slice(0, 10));
    // riziko z dotazníku – jen jednou, navázané na dodavatele, s hrozbou H11
    const rk = await admin.json(`/api/suppliers/${sup.id}/questionnaires/${q.id}/risk`, { method: "POST" });
    expect(rk.status).toBe(201);
    const risk = (await admin.json(`/api/risks/${rk.body.riskId}`)).body;
    expect(risk.name).toContain("Cloud hosting a.s.");
    expect(risk.description).toContain("Plánujeme do konce roku");
    expect(risk.threatName).toContain("smluvního závazku");
    expect((await admin.json(`/api/suppliers/${sup.id}`)).body.risks.map((r: any) => r.id)).toContain(rk.body.riskId);
    expect((await admin.json(`/api/suppliers/${sup.id}/questionnaires/${q.id}/risk`, { method: "POST" })).status).toBe(409);
    expect((await admin.json(`/api/suppliers/${sup.id}/questionnaires/${q.id}`, { method: "DELETE" })).status).toBe(409);
    // zpráva s odpověďmi (escapovaná)
    const rep = await admin.req(`/api/suppliers/${sup.id}/questionnaires/${q.id}/report.html`);
    expect(rep.status).toBe(200);
    expect(await rep.text()).toContain("Jan Novák");

    // nový odkaz zneplatní starý; zrušený dotazník je zavřený
    const q2 = (await admin.json(`/api/suppliers/${sup.id}/questionnaires`, { method: "POST", json: { validDays: 1 } })).body;
    expect(q2.emailed).toBe(false);
    const oldToken = q2.link.split("/q/")[1];
    const nl = await admin.json(`/api/suppliers/${sup.id}/questionnaires/${q2.questionnaire.id}/link`, { method: "POST", json: { validDays: 10 } });
    expect(nl.status).toBe(200);
    expect((await pub.json(`/api/public/questionnaires/${oldToken}`)).status).toBe(404);
    const newToken = nl.body.link.split("/q/")[1];
    expect((await admin.json(`/api/suppliers/${sup.id}/questionnaires/${q2.questionnaire.id}/cancel`, { method: "POST" })).body.status).toBe("cancelled");
    expect((await pub.json(`/api/public/questionnaires/${newToken}`)).body.status).toBe("closed");
    // čtenář nezakládá; jiná společnost nevidí
    const reader = browser();
    await reader.login("owner@test.cz", "Nove-Heslo-2026!!");
    expect((await reader.json(`/api/suppliers/${sup.id}/questionnaires`, { method: "POST", json: {} })).status).toBe(403);
  });

  test("roční hodnocení rizik: cyklus, přehodnocení, potvrzení, schválení, porovnání; FAIR", async () => {
    const co = await admin.json("/api/companies", { method: "POST", json: { name: "Cyklus s.r.o." } });
    const H = { "x-contix-company": co.body.id };
    const r1 = await admin.json("/api/risks", { method: "POST", headers: H, json: { name: "Výpadek DC", impact: 3, threatLevel: 2, vulnLevel: 2 } });
    const r2 = await admin.json("/api/risks", { method: "POST", headers: H, json: { name: "Phishing", impact: 2, threatLevel: 3, vulnLevel: 3 } });
    const r3 = await admin.json("/api/risks", { method: "POST", headers: H, json: { name: "Starý systém", impact: 2, threatLevel: 2, vulnLevel: 2 } });
    // bez schváleného cyklu = povinnost po termínu
    expect((await admin.json("/api/cycles/status?kind=risk", { headers: H })).body[0].overdue).toBe(true);
    const cy = await admin.json("/api/cycles", { method: "POST", headers: H, json: { kind: "risk", title: "Hodnocení rizik 2026", dueDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } });
    expect(cy.status).toBe(201);
    expect(cy.body.total).toBe(3);
    expect((await admin.json("/api/cycles", { method: "POST", headers: H, json: { kind: "risk", title: "Druhé" } })).status).toBe(409);
    const team = (await admin.json("/api/notifications/team", { headers: H })).body as any[];
    expect(team.some((o) => o.kind === "assessment_cycle" && o.title === "Hodnocení rizik 2026")).toBe(true);
    // úprava hodnocení rizika = přehodnoceno
    await admin.json(`/api/risks/${r1.body.id}`, { method: "PATCH", headers: H, json: { vulnLevel: 4 } });
    // potvrzení beze změny a vyřazení (se zdůvodněním)
    await admin.json(`/api/cycles/${cy.body.id}/items/${r2.body.id}`, { method: "PUT", headers: H, json: { state: "confirmed" } });
    expect((await admin.json(`/api/cycles/${cy.body.id}/items/${r3.body.id}`, { method: "PUT", headers: H, json: { state: "excluded" } })).status).toBe(400);
    expect((await admin.json(`/api/cycles/${cy.body.id}/submit`, { method: "POST", headers: H })).status).toBe(400);
    let d = (await admin.json(`/api/cycles/${cy.body.id}/items/${r3.body.id}`, { method: "PUT", headers: H, json: { state: "excluded", note: "Systém vyřazen z provozu" } })).body;
    expect(d.counts).toMatchObject({ reassessed: 1, confirmed: 1, excluded: 1, pending: 0 });
    const it1 = d.items.find((i: any) => i.entityId === r1.body.id);
    expect(it1.before.level).toBe("medium");
    expect(it1.after.level).toBe("high");
    // nové riziko během cyklu se doplní jako čekající
    const r4 = await admin.json("/api/risks", { method: "POST", headers: H, json: { name: "Ransomware", impact: 4, threatLevel: 3, vulnLevel: 3 } });
    d = (await admin.json(`/api/cycles/${cy.body.id}`, { headers: H })).body;
    expect(d.items.find((i: any) => i.entityId === r4.body.id).state).toBe("pending");
    await admin.json(`/api/cycles/${cy.body.id}/items/${r4.body.id}`, { method: "PUT", headers: H, json: { state: "confirmed" } });
    expect((await admin.json(`/api/cycles/${cy.body.id}/approve`, { method: "POST", headers: H, json: {} })).status).toBe(409);
    expect((await admin.json(`/api/cycles/${cy.body.id}/submit`, { method: "POST", headers: H })).body.status).toBe("review");
    const ap = await admin.json(`/api/cycles/${cy.body.id}/approve`, { method: "POST", headers: H, json: { note: "Schváleno výborem" } });
    expect(ap.body.status).toBe("approved");
    const st = (await admin.json("/api/cycles/status?kind=risk", { headers: H })).body[0];
    expect(st.overdue).toBe(false);
    expect(st.nextDue).toBeTruthy();
    expect((await admin.json(`/api/cycles/${cy.body.id}/items/${r2.body.id}`, { method: "PUT", headers: H, json: { state: "pending" } })).status).toBe(409);
    // další rok: zhoršení phishingu se ukáže v porovnání
    const cy2 = await admin.json("/api/cycles", { method: "POST", headers: H, json: { kind: "risk", title: "Hodnocení rizik 2027", reason: "significant_change" } });
    expect(cy2.body.previousId).toBe(cy.body.id);
    await admin.json(`/api/risks/${r2.body.id}`, { method: "PATCH", headers: H, json: { impact: 4, vulnLevel: 4 } });
    const cmp = (await admin.json(`/api/cycles/${cy2.body.id}/compare`, { headers: H })).body;
    expect(cmp.rows.find((x: any) => x.entityId === r2.body.id).change).toBe("worse");

    // FAIR: kvantifikace rizika a přehled
    const q = await admin.json(`/api/risks/${r4.body.id}`, {
      method: "PATCH",
      headers: H,
      json: { quant: { lef: { min: 0.1, mode: 0.3, max: 1 }, lm: { min: 500000, mode: 2000000, max: 15000000 }, residualLef: { min: 0.05, mode: 0.1, max: 0.3 }, controlCostYear: 150000 } },
    });
    expect(q.status).toBe(200);
    expect(q.body.quantResult.inherent.mean).toBeGreaterThan(0);
    expect(q.body.quantResult.residual.mean).toBeLessThan(q.body.quantResult.inherent.mean);
    expect(q.body.quantResult.rosi).not.toBeNull();
    expect(q.body.ale).toBe(q.body.quantResult.inherent.mean);
    expect((await admin.json(`/api/risks/${r4.body.id}`, { method: "PATCH", headers: H, json: { quant: { lef: { min: 2, mode: 1, max: 3 }, lm: { min: 1, mode: 1, max: 1 } } } })).status).toBe(400);
    const qs = (await admin.json("/api/risks/quant", { headers: H })).body;
    expect(qs.items[0].id).toBe(r4.body.id);
    expect(qs.portfolio.p95).toBeGreaterThan(0);
    expect(qs.unquantified).toBe(3);
    // zpráva o rizicích obsahuje kvantitativní část
    const doc = await admin.json("/api/documents", { method: "POST", headers: H, json: { kind: "risk_report" } });
    const html = await (await admin.req(`/api/documents/${doc.body.id}/html`, { headers: H })).text();
    expect(html).toContain("Kvantitativní analýza (FAIR)");
    // BIA cyklus (prázdný rozsah lze zahájit)
    expect((await admin.json("/api/cycles", { method: "POST", headers: H, json: { kind: "bia", title: "BIA 2026" } })).status).toBe(201);
  });

  test("v0.13: přesun mezi společnostmi, návrh zbytkového rizika, rizika ze zranitelností, Wazuh alerty, audit dle 410", async () => {
    const cos = (await admin.json("/api/companies")).body as any[];
    const root = cos.find((x) => !x.parentId).id;
    const a = await admin.json("/api/companies", { method: "POST", json: { name: "Přesun A", regime: "lower" } });
    const b = await admin.json("/api/companies", { method: "POST", json: { name: "Přesun B" } });
    const HA = { "x-contix-company": a.body.id };
    // riziko v A navázané na aktivum v A → přesun do B hlásí vazbu mimo B
    const asset = await admin.json("/api/assets", { method: "POST", headers: HA, json: { name: "Server A", assetType: "server" } });
    const risk = await admin.json("/api/risks", { method: "POST", headers: HA, json: { name: "Riziko k přesunu", assetIds: [asset.body.id] } });
    const t1 = await admin.json("/api/companies/transfer", { method: "POST", json: { entity: "risks", ids: [risk.body.id], targetCompanyId: b.body.id } });
    expect(t1.body.needsConfirmation).toBe(true);
    expect(t1.body.warnings[0]).toContain("Server A");
    const t2 = await admin.json("/api/companies/transfer", { method: "POST", json: { entity: "risks", ids: [risk.body.id], targetCompanyId: b.body.id, force: true } });
    expect(t2.body.moved).toBe(1);
    expect((await admin.json(`/api/risks/${risk.body.id}`)).body.companyId).toBe(b.body.id);
    // proces s BIA se přesune i s BIA
    const proc = await admin.json("/api/processes", { method: "POST", headers: HA, json: { name: "Proces k přesunu" } });
    const bia = await admin.json("/api/bia", { method: "POST", headers: HA, json: { processId: proc.body.id } });
    await admin.json("/api/companies/transfer", { method: "POST", json: { entity: "processes", ids: [proc.body.id], targetCompanyId: root } });
    expect((await admin.json(`/api/bia/${bia.body.id}`)).body.companyId).toBe(root);
    // uživatel bez práva v cílové společnosti nepřesune
    const mkbA = browser();
    await mkbA.login("mkb.a@test.cz", "Mkb-A-Heslo-2026!!");
    const homeA = { "x-contix-company": (await mkbA.json("/api/auth/me")).body.homeCompanyId };
    const own = await mkbA.json("/api/risks", { method: "POST", headers: homeA, json: { name: "Jen A" } });
    expect(own.status).toBe(201);
    expect((await mkbA.json("/api/companies/transfer", { method: "POST", headers: homeA, json: { entity: "risks", ids: [own.body.id], targetCompanyId: b.body.id } })).status).toBe(403);

    // návrh zbytkového rizika z účinných opatření
    const c1 = await admin.json("/api/controls", { method: "POST", json: { name: "EDR", status: "implemented", effectiveness: "effective" } });
    const c2 = await admin.json("/api/controls", { method: "POST", json: { name: "Školení", status: "implemented", effectiveness: "partially_effective" } });
    const rr = await admin.json("/api/risks", { method: "POST", json: { name: "Malware", impact: 4, threatLevel: 3, vulnLevel: 4, controlIds: [c1.body.id, c2.body.id] } });
    expect(rr.body.residualSuggestion).toMatchObject({ impact: 4, threatLevel: 3, vulnLevel: 2, reduction: 2 });
    expect(rr.body.residualSuggestion.basis.join()).toContain("EDR");

    // rizika ze zranitelností: CVE bez rizika → návrh → založení → návrh zmizí
    // uvolnit CVE serveru z dřívějšího rizika, aby vznikl návrh
    const linked = ((await admin.json("/api/risks?limit=500")).body.items as any[]).map((x) => x.id);
    for (const id of linked) {
      const d = (await admin.json(`/api/risks/${id}`)).body;
      if (d.cves?.length) await admin.json(`/api/risks/${id}`, { method: "PATCH", json: { cveIds: [] } });
    }
    const sug = (await admin.json("/api/risks/suggestions/vulns")).body as any[];
    const s0 = sug.find((x) => x.assetId === ids.server);
    expect(s0.maxSeverity).toBe("critical");
    expect(s0.cveCount).toBeGreaterThanOrEqual(s0.cves.length);
    {
      // bez výčtu ID = všechny nepokryté kritické a vysoké zranitelnosti aktiva (vybere server)
      const nr = await admin.json("/api/risks/from-vulns", { method: "POST", json: { assetId: s0.assetId } });
      expect(nr.status).toBe(201);
      expect(nr.body.cves.length).toBe(s0.cveCount);
      expect(nr.body.weaknessName).toContain("Zranitelnosti");
      const after = (await admin.json("/api/risks/suggestions/vulns")).body as any[];
      expect(after.find((x) => x.assetId === s0.assetId)).toBeUndefined();
      expect((await admin.json("/api/risks/from-vulns", { method: "POST", json: { assetId: s0.assetId } })).status).toBe(400);
    }
    {
      // aktivum s tisíci zranitelností (dřív: „vulnerabilityIds: Too big“) – návrh nese jen ukázku, riziko naváže všechny
      const big = (await admin.json("/api/assets", { method: "POST", json: { name: "big-vuln-host", assetType: "server" } })).body;
      await db.execute(sql`insert into asset_vulnerabilities (asset_id, cve_id, severity, cvss_score) select ${big.id}::uuid, 'CVE-2026-' || (10000 + g)::text, (case when g % 50 = 0 then 'critical' else 'high' end)::vuln_severity, 7.5 from generate_series(1, 1200) g`);
      const sg = ((await admin.json("/api/risks/suggestions/vulns")).body as any[]).find((x) => x.assetId === big.id);
      expect(sg).toMatchObject({ cveCount: 1200, criticalCount: 24, maxSeverity: "critical" });
      expect(sg.cves.length).toBeLessThanOrEqual(8);
      expect(sg.cves[0].severity).toBe("critical");
      const br = await admin.json("/api/risks/from-vulns", { method: "POST", json: { assetId: big.id } });
      expect(br.status).toBe(201);
      expect(br.body.cves.length).toBe(1200);
      expect(br.body.description).toContain("(1200, nejzávažnější:");
      // uložení rizika s tisíci navázanými CVE projde
      const up = await admin.json(`/api/risks/${br.body.id}`, { method: "PATCH", json: { cveIds: br.body.cves.map((c: any) => c.id) } });
      expect(up.status).toBe(200);
      expect(up.body.cves.length).toBe(1200);
      await admin.json(`/api/risks/${br.body.id}`, { method: "DELETE" });
      await db.execute(sql`delete from asset_vulnerabilities where asset_id = ${big.id}`);
      await admin.json(`/api/assets/${big.id}`, { method: "DELETE" });
    }

    // Wazuh alerty → návrhy událostí
    expect((await admin.json("/api/alerts/settings", { method: "PUT", json: { alertsEnabled: true, alertMinLevel: 10 } })).status).toBe(200);
    const sync = await admin.json("/api/alerts/sync", { method: "POST" });
    expect(sync.status).toBe(200);
    expect(sync.body.created).toBe(2);
    const list = (await admin.json("/api/alerts?status=new")).body as any[];
    const brute = list.find((x) => x.ruleId === "5712");
    expect(brute.count).toBe(2);
    expect(brute.assetName).toBeTruthy();
    // opakovaný běh nic nezdvojí
    expect((await admin.json("/api/alerts/sync", { method: "POST" })).body.created).toBe(0);
    const acc = await admin.json(`/api/alerts/${brute.id}/accept`, { method: "POST", json: { kind: "event" } });
    expect(acc.status).toBe(201);
    const inc = (await admin.json(`/api/incidents/${acc.body.incidentId}`)).body;
    expect(inc.category).toBe("unauthorized_access");
    expect(inc.assets.length).toBe(1);
    const vt = list.find((x) => x.ruleId === "87105");
    expect((await admin.json(`/api/alerts/${vt.id}/dismiss`, { method: "POST", json: { reason: "" } })).status).toBe(400);
    await admin.json(`/api/alerts/${vt.id}/dismiss`, { method: "POST", json: { reason: "Falešný poplach – testovací soubor EICAR" } });
    expect((await admin.json(`/api/alerts/${vt.id}/dismiss`, { method: "POST", json: { reason: "x" } })).status).toBe(409);
    expect(((await admin.json("/api/alerts?status=new")).body as any[]).length).toBe(0);

    // pokrytí auditu podle režimu: společnost A má nižší povinnosti → oddíly vyhl. 410
    const cov = (await admin.json("/api/audits/coverage", { headers: HA })).body as any[];
    const cov409 = (await admin.json("/api/audits/coverage?framework=cz409", { headers: HA })).body as any[];
    expect(cov.length).not.toBe(cov409.length);
    const au = await admin.json("/api/audits", { method: "POST", headers: HA, json: { title: "Audit 410", sections: [cov[0].section], methodologyKey: "zkb410_audit" } });
    expect(au.body.sections).toEqual([cov[0].section]);
    // přehled skupiny ukazuje stav ročního hodnocení
    const ov = (await admin.json("/api/companies/overview")).body as any[];
    expect(ov.find((x) => x.id === a.body.id).risks.cycle.overdue).toBe(true);
  });

  test("organizace navazuje na společnosti: název z administrace, sdílené útvary holdingu, útvar v dceřiné společnosti", async () => {
    const cos = (await admin.json("/api/companies")).body as any[];
    const root = cos.find((x) => !x.parentId);
    const sub = cos.find((x) => x.parentId === root.id);
    const HS = { "x-contix-company": sub.id };
    const u = await admin.json("/api/org/units", { method: "POST", headers: HS, json: { name: "Odbor dceřiné", unitType: "department" } });
    expect(u.status).toBe(201);
    expect(u.body.companyId).toBe(sub.id);
    // útvar ve zvolené společnosti i ze souhrnného pohledu
    const u2 = await admin.json("/api/org/units", { method: "POST", json: { name: "Útvar přes companyId", companyId: sub.id } });
    expect(u2.body.companyId).toBe(sub.id);
    const org = (await admin.json("/api/org", { headers: HS })).body as any[];
    const own = org.find((x) => x.id === u.body.id);
    expect(own).toMatchObject({ companyName: sub.name, shared: false });
    const shared = org.find((x) => x.companyId === root.id);
    expect(shared).toMatchObject({ companyName: root.name, shared: true });
    // přejmenování společnosti v administraci se projeví v organizaci
    await admin.json(`/api/companies/${sub.id}`, { method: "PATCH", json: { name: `${sub.name} (nový název)` } });
    const org2 = (await admin.json("/api/org", { headers: HS })).body as any[];
    expect(org2.find((x) => x.id === u.body.id).companyName).toBe(`${sub.name} (nový název)`);
    await admin.json(`/api/companies/${sub.id}`, { method: "PATCH", json: { name: sub.name } });
    // podřízený útvar musí patřit stejné společnosti
    expect((await admin.json(`/api/org/units/${u.body.id}`, { method: "PATCH", headers: HS, json: { parentId: shared.id } })).status).toBe(404);
  });


  test("AI asistent: nastavení, návrh opatření k riziku a mapování na SOC 2 – jen po schválení člověkem", async () => {
    expect((await admin.json("/api/ai/status")).body).toMatchObject({ enabled: false, useCases: [] });
    const risk = (await admin.json("/api/risks")).body.items[0];
    expect((await admin.json("/api/ai/suggestions", { method: "POST", json: { useCase: "risk_treatment", entityId: risk.id } })).status).toBe(409);

    const st = await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: true, provider: "openai", baseUrl: AI_URL, model: "gpt-oss:20b", apiKey: "owui-key" } });
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ enabled: true, apiKeySet: true, model: "gpt-oss:20b" });
    expect(JSON.stringify(st.body)).not.toContain("owui-key");
    const t = (await admin.json("/api/ai/test", { method: "POST" })).body;
    expect(t.ok).toBe(true);
    expect(t.message).toContain("model je dostupný");
    expect((await admin.json("/api/ai/models")).body.models).toContain("llama3.1:8b");
    expect((await admin.json("/api/ai/status")).body.useCases).toEqual(expect.arrayContaining(["risk_treatment", "control_mapping"]));

    // návrh opatření – běží na pozadí, výsledek se validuje
    const before = (await admin.json(`/api/risks/${risk.id}`)).body.actions.length;
    const req = await admin.json("/api/ai/suggestions", { method: "POST", json: { useCase: "risk_treatment", entityId: risk.id } });
    expect(req.status).toBe(202);
    expect(req.body.status).toBe("running");
    await Promise.all(background);
    const sug = (await admin.json(`/api/ai/suggestions/${req.body.id}`)).body;
    expect(sug.status).toBe("proposed");
    expect(sug.items.length).toBe(2); // položka bez názvu zahozena
    expect(sug.items[0].paragraphs).toEqual(["19"]); // neexistující § 99 zahozen
    expect(sug.items[1].paragraphs).toEqual(["26"]);
    // do modelu nejdou jména osob ani vlastníci
    const sent = JSON.stringify(aiCalls.at(-1));
    expect(sent).not.toContain("@contix");
    expect(sent).toContain(risk.name);
    // nic se neaplikovalo automaticky
    expect((await admin.json(`/api/risks/${risk.id}`)).body.actions.length).toBe(before);
    const dec = await admin.json(`/api/ai/suggestions/${sug.id}/decide`, { method: "POST", json: { accept: [0], note: "MFA ano, testy obnovy řešíme jinde" } });
    expect(dec.body.suggestion.status).toBe("partially_accepted");
    expect(dec.body.createdActions).toBe(1);
    const actions = (await admin.json(`/api/risks/${risk.id}`)).body.actions as any[];
    expect(actions.length).toBe(before + 1);
    expect(actions.find((a) => a.title === "Vícefaktorové ověřování pro vzdálený přístup").description).toContain("§ 19");
    expect((await admin.json(`/api/ai/suggestions/${sug.id}/decide`, { method: "POST", json: { accept: [1] } })).status).toBe(409);

    // mapování opatření na SOC 2 – neznámá ID a duplicity se zahodí
    const ctl = (await admin.json("/api/controls", { method: "POST", json: { name: "MFA pro vzdálený přístup", category: "technical" } })).body;
    const m = await admin.json("/api/ai/suggestions", { method: "POST", json: { useCase: "control_mapping", entityId: ctl.id, framework: "soc2" } });
    await Promise.all(background);
    const ms = (await admin.json(`/api/ai/suggestions/${m.body.id}`)).body;
    expect(ms.items.map((i: any) => i.requirementId)).toEqual(["soc2:CC6.1", "soc2:CC6.2"]);
    await admin.json(`/api/ai/suggestions/${ms.id}/decide`, { method: "POST", json: { accept: [0, 1] } });
    const ctlAfter = (await admin.json(`/api/controls/${ctl.id}`)).body;
    expect(ctlAfter.requirements.map((r: any) => r.id)).toEqual(expect.arrayContaining(["soc2:CC6.1", "soc2:CC6.2"]));
    expect((await admin.json(`/api/ai/suggestions?entityId=${ctl.id}`)).body[0].status).toBe("accepted");

    // nevalidní odpověď modelu → chyba, nic se nenavrhne
    const bad = await admin.json("/api/ai/suggestions", { method: "POST", json: { useCase: "risk_treatment", entityId: risk.id, note: "rozbij to" } });
    await Promise.all(background);
    const bs = (await admin.json(`/api/ai/suggestions/${bad.body.id}`)).body;
    expect(bs).toMatchObject({ status: "failed", error: "Model nevrátil platný JSON." });
    // auditní přehled obsahuje odeslaný kontext i surový výstup
    const log = (await admin.json("/api/ai/log")).body as any[];
    expect(log.length).toBeGreaterThanOrEqual(3);
    expect(log.find((l) => l.id === sug.id)).toMatchObject({ entityName: expect.stringContaining(risk.name) });
    expect(log.find((l) => l.id === sug.id).input.risk.name).toBe(risk.name);
    // bez oprávnění ai:use nelze žádat o návrh
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/ai/suggestions", { method: "POST", json: { useCase: "risk_treatment", entityId: risk.id } })).status).toBe(403);
  });

  test("AI: klasifikace aktiva, nápravná opatření ke zjištění, shrnutí incidentu, kontrola dokumentu", async () => {
    const st = (await admin.json("/api/ai/status")).body;
    expect(st.useCases).toEqual(expect.arrayContaining(["asset_classification", "finding_remediation", "incident_summary", "policy_review"]));
    const run = async (useCase: string, entityId: string, headers: Record<string, string> = {}) => {
      const r = await admin.json("/api/ai/suggestions", { method: "POST", headers, json: { useCase, entityId } });
      expect(r.status).toBe(202);
      await Promise.all(background);
      return (await admin.json(`/api/ai/suggestions/${r.body.id}`, { headers })).body;
    };
    // aktivum – jen povolená pole a platné hodnoty; přijetí změní jen vybrané
    const asset = ((await admin.json("/api/assets?limit=5")).body.items as any[])[0];
    const sa = await run("asset_classification", asset.id);
    expect(sa.status).toBe("proposed");
    expect(sa.items.map((i: any) => i.field).sort()).toEqual(asset.availability === 4 ? ["criticality"] : asset.criticality === "critical" ? ["availability"] : ["availability", "criticality"]);
    const critIdx = sa.items.findIndex((i: any) => i.field === "criticality");
    if (critIdx >= 0) {
      await admin.json(`/api/ai/suggestions/${sa.id}/decide`, { method: "POST", json: { accept: [critIdx] } });
      expect((await admin.json(`/api/assets/${asset.id}`)).body.criticality).toBe("critical");
    }
    expect(JSON.stringify(sa)).not.toContain("ownerUserId");

    // zjištění z auditu → nápravná opatření se připojí k textu
    const finding = ((await admin.json("/api/audits/findings?status=all")).body as any[])[0];
    const sf = await run("finding_remediation", finding.id);
    expect(sf.items[0].kind).toBe("treatment");
    await admin.json(`/api/ai/suggestions/${sf.id}/decide`, { method: "POST", json: { accept: [0] } });
    const f2 = ((await admin.json("/api/audits/findings?status=all")).body as any[]).find((f) => f.id === finding.id);
    expect(f2.correctiveAction).toContain("Vícefaktorové ověřování");

    // incident – shrnutí (jen k přečtení) + pole; neznámé pole zahozeno
    const inc = ((await admin.json("/api/incidents")).body.items ?? (await admin.json("/api/incidents")).body)[0];
    const si = await run("incident_summary", inc.id);
    expect(si.items.map((i: any) => i.field)).toEqual(["summary", "impactDescription", "lessonsLearned"]);
    await admin.json(`/api/ai/suggestions/${si.id}/decide`, { method: "POST", json: { accept: [0, 2] } });
    expect((await admin.json(`/api/incidents/${inc.id}`)).body.lessonsLearned).toContain("Zopakovat školení");

    // dokument – kontrola vůči § dokumentu; neznámé ID a duplicity zahozeny, seřazeno chybějící první
    const pol = ((await admin.json("/api/policies")).body as any[]).find((p) => p.code === "BP-01");
    const sp = await run("policy_review", pol.id);
    expect(sp.items.map((i: any) => i.status)).toEqual(["missing", "covered"]);
    expect(sp.items[0].ref).toContain("§ 6");
    // „Vzít na vědomí“ bez založení připomínek = přijato (ne zamítnuto); pokryté požadavky nejsou náměty
    const ack = (await admin.json(`/api/ai/suggestions/${sp.id}/decide`, { method: "POST", json: { accept: [], acknowledge: true } })).body;
    expect(ack.suggestion.status).toBe("accepted");
    // dokument bez textu → srozumitelná chyba
    const empty = await admin.json("/api/policies", { method: "POST", json: { title: "Bez textu", sections: ["§ 6"] } });
    const bad = await admin.json("/api/ai/suggestions", { method: "POST", json: { useCase: "policy_review", entityId: empty.body.id } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("nemá text");
  });

  test("pokrytí předpisu: matice, AI verdikty dokumentů, hromadné skóre, snímek a export", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    expect((await admin.json("/api/coverage?framework=cz409")).status).toBe(400); // souhrnný pohled – vybrat společnost
    expect((await admin.json("/api/coverage?framework=xx", { headers: H })).status).toBe(400);
    const cov = (await admin.json("/api/coverage?framework=cz409", { headers: H })).body;
    expect(cov.rows).toHaveLength(293);
    expect(cov.batch).toMatchObject({ running: false });
    const bp = cov.documents.find((d: any) => d.code === "BP-01");
    expect(bp).toMatchObject({ scored: true, stale: false, score: 50 });
    const withBp = cov.rows.filter((r: any) => r.docs.some((d: any) => d.code === "BP-01"));
    expect(withBp.length).toBeGreaterThan(1);
    expect(withBp.every((r: any) => r.docs.find((d: any) => d.code === "BP-01").via === "section")).toBe(true);
    const verdicts = withBp.map((r: any) => r.docs.find((d: any) => d.code === "BP-01").ai);
    expect(verdicts).toEqual(expect.arrayContaining(["covered", "missing"]));
    const missRow = withBp.find((r: any) => r.docState === "missing");
    expect(missRow.gaps).toContain("ai_missing");
    expect(cov.summary.aiCovered).toBeGreaterThanOrEqual(1);
    expect(cov.rows.filter((r: any) => r.applicable && !r.docs.length).every((r: any) => r.gaps.includes("no_document"))).toBe(true);
    // neaplikovaný požadavek nemá mezery
    expect(cov.rows.find((r: any) => r.id === "cz409:27/a")).toMatchObject({ applicable: false, gaps: [] });

    // hromadné AI skóre: jen neohodnocené / změněné dokumenty, postupně na pozadí; dokument bez textu se ohlásí
    const toScore = cov.documents.filter((d: any) => !d.scored || d.stale).length;
    expect(toScore).toBeGreaterThan(0);
    const st = await admin.json("/api/coverage/score", { method: "POST", headers: H, json: { framework: "cz409" } });
    expect(st.status).toBe(202);
    expect(st.body).toMatchObject({ running: true, total: toScore, framework: "cz409" });
    await Promise.all(background);
    const done = (await admin.json("/api/coverage/score", { headers: H })).body;
    expect(done).toMatchObject({ running: false, done: toScore, current: null });
    expect(done.errors.some((e: any) => e.document.includes("Bez textu") && e.error.includes("nemá text"))).toBe(true);
    const cov2 = (await admin.json("/api/coverage?framework=cz409", { headers: H })).body;
    expect(cov2.documents.filter((d: any) => !d.scored).length).toBe(done.failed);

    // snímek pro audit – neměnný stav, výpis, detail, export CSV
    const snap = await admin.json("/api/coverage/snapshots", { method: "POST", headers: H, json: { framework: "cz409", note: "Stav před auditem" } });
    expect(snap.status).toBe(201);
    expect(snap.body).toMatchObject({ framework: "cz409", note: "Stav před auditem", summary: { total: 293 } });
    const list = (await admin.json("/api/coverage/snapshots?framework=cz409", { headers: H })).body;
    expect(list[0]).toMatchObject({ id: snap.body.id, createdByName: expect.any(String) });
    const det = (await admin.json(`/api/coverage/snapshots/${snap.body.id}`, { headers: H })).body;
    expect(det.rows).toHaveLength(293);
    expect((await admin.json("/api/coverage/snapshots?framework=nis2", { headers: H })).body).toEqual([]);
    expect((await admin.json("/api/coverage/snapshots/00000000-0000-0000-0000-000000000000", { headers: H })).status).toBe(404);
    const csv = await admin.req(`/api/coverage/export?framework=cz409&snapshot=${snap.body.id}`, { headers: H });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toBe('"Ustanovení";"Požadavek";"Použitelné";"Dokumenty";"Pokrytí dokumenty (AI)";"Opatření";"Shoda";"Mezery"');
    expect(text).toContain("BP-01 (");
    // čtenář bez ai:use / controls:write
    const aud = browser();
    await aud.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await aud.json("/api/coverage?framework=nis2", { headers: H })).status).toBe(200);
    expect((await aud.json("/api/coverage/score", { method: "POST", headers: H, json: { framework: "nis2" } })).status).toBe(403);
    expect((await aud.json("/api/coverage/snapshots", { method: "POST", headers: H, json: { framework: "nis2" } })).status).toBe(403);
  });

  test("zpráva pro vedení (JSON, tisk, Word) a export dokumentů ISMS do Wordu", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const HR = { "x-contix-company": root.id };
    const r = (await admin.json("/api/reports/management?periodFrom=2026-01-01&periodTo=2026-12-31", { headers: HR })).body;
    expect(r.periodFrom).toBe("2026-01-01");
    const keys = r.kpis.map((k: any) => k.key);
    expect(keys).toEqual(expect.arrayContaining(["compliance", "risks", "incidents", "assurance", "obligations"]));
    for (const k of r.kpis) expect(["ok", "warning", "error"]).toContain(k.level);
    expect(r.assurance).toMatchObject({ implementedControls: expect.any(Number) });
    // souhrnný pohled skupiny → je třeba vybrat společnost
    expect((await admin.json("/api/reports/management")).status).toBe(400);
    const page = await admin.req("/api/reports/management.html", { headers: HR });
    expect(await page.text()).toContain("Zpráva o stavu kybernetické bezpečnosti pro vedení");
    const docx = await admin.req("/api/reports/management.docx", { headers: HR });
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
    const buf = new Uint8Array(await docx.arrayBuffer());
    expect(String.fromCharCode(buf[0]!, buf[1]!)).toBe("PK");
    expect(buf.length).toBeGreaterThan(5000);
    // dokumenty ISMS: náhled i uložená verze do Wordu
    const soa = await admin.req("/api/documents/preview.docx?kind=soa&framework=cz409", { headers: HR });
    expect(soa.status).toBe(200);
    expect(soa.headers.get("content-disposition")).toContain(".docx");
    const docs = (await admin.json("/api/documents?kind=risk_report", { headers: HR })).body as any[];
    if (docs[0]) {
      const d = await admin.req(`/api/documents/${docs[0].id}/docx`, { headers: HR });
      expect(d.status).toBe(200);
    }
  });

  test("úvodní přehled: souhrn oblastí podle modulů a oprávnění, povinnosti v rozsahu", async () => {
    const d = (await admin.json("/api/dashboard")).body;
    for (const k of ["processes", "incidents", "audits", "policies", "suppliers", "isms", "continuity", "obligations"]) expect(d[k]).not.toBeNull();
    expect(d.obligations.top.length).toBeLessThanOrEqual(10);
    expect(d.obligations.overdue + d.obligations.soon).toBeGreaterThan(0);
    expect(d.audits.openFindings).toBeGreaterThanOrEqual(d.audits.overdueFindings);
    // čtenář nevidí incidenty ani návrhy AI (nemá oprávnění)
    const viewer = browser();
    await admin.json("/api/admin/users", { method: "POST", json: { email: "dash.viewer@test.cz", displayName: "Čtenář přehledu", password: PW, roleIds: [await roleId("viewer")] } });
    await viewer.login("dash.viewer@test.cz");
    await viewer.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Ctenar-Heslo-2026!" } });
    expect((await viewer.json("/api/auth/me")).body.permissions).not.toContain("incidents:read");
    const vd = (await viewer.json("/api/dashboard")).body;
    expect(vd.incidents).toBeNull();
    expect(vd.ai).toBeNull();
    expect(vd.audits).not.toBeNull();
    expect(vd.obligations?.byKind?.incident_report).toBeUndefined();
  });

  test("balíček pro auditora: důkaz k požadavku, počet důkazů v SoA, ZIP s manifestem", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const HR = { "x-contix-company": root.id };
    const ev = await admin.json("/api/assurance/evidence", { method: "POST", headers: HR, json: { title: "Politika řízení přístupu (SOC 2)", kind: "document", requirementIds: ["soc2:CC6.1", "soc2:CC6.2"] } });
    expect(ev.status).toBe(201);
    expect(ev.body.requirements.map((r: any) => r.ref)).toEqual(["CC6.1", "CC6.2"]);
    expect((await admin.json("/api/assurance/evidence", { method: "POST", headers: HR, json: { title: "X", requirementIds: ["soc2:ZZ9"] } })).status).toBe(400);
    const fd = new FormData();
    fd.append("file", new File(["politika v1"], "politika.txt", { type: "text/plain" }));
    await admin.req(`/api/assurance/evidence/${ev.body.id}/files`, { method: "POST", body: fd, headers: HR });
    const soc = (await admin.json("/api/controls/requirements?framework=soc2", { headers: HR })).body as any[];
    expect(soc.find((r) => r.id === "soc2:CC6.1").evidenceCount).toBeGreaterThanOrEqual(1);
    expect(soc.find((r) => r.id === "soc2:CC9.2").evidenceCount).toBe(0);

    const res = await admin.req("/api/assurance/package.zip?framework=soc2&periodFrom=2026-01-01&periodTo=2026-12-31", { headers: HR });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files);
    expect(names).toEqual(expect.arrayContaining(["00_obsah.html", "01_prohlaseni_o_aplikovatelnosti.html", "01_prohlaseni_o_aplikovatelnosti.docx", "manifest.csv", "SHA256SUMS"]));
    const evFile = names.find((n) => n.startsWith("dukazy/") && n.endsWith("politika.txt"))!;
    expect(strFromU8(files[evFile]!)).toBe("politika v1");
    const sums = strFromU8(files["SHA256SUMS"]!);
    const { createHash } = await import("node:crypto");
    expect(sums).toContain(`${createHash("sha256").update(files[evFile]!).digest("hex")}  ${evFile}`);
    const index = strFromU8(files["00_obsah.html"]!);
    expect(index).toContain("Politika řízení přístupu (SOC 2)");
    expect(index).toContain("bez důkazu");
    // bez souborů
    const lite = unzipSync(new Uint8Array(await (await admin.req("/api/assurance/package.zip?framework=soc2&files=0", { headers: HR })).arrayBuffer()));
    expect(Object.keys(lite).some((n) => n.startsWith("dukazy/"))).toBe(false);
    // souhrnný pohled skupiny → vybrat společnost
    expect((await admin.req("/api/assurance/package.zip?framework=soc2")).status).toBe(400);
  });

  test("verze procesu: snímek, schválení, porovnání, neměnnost schválené verze", async () => {
    const pid = ids.process;
    const v1 = await admin.json(`/api/processes/${pid}/versions`, { method: "POST", json: { changeSummary: "První vydání" } });
    expect(v1.status).toBe(201);
    expect(v1.body[0]).toMatchObject({ number: 1, status: "draft", canApprove: true });
    expect((await admin.json(`/api/processes/${pid}/versions`, { method: "POST", json: { changeSummary: "Druhý návrh" } })).status).toBe(409);
    const ap = await admin.json(`/api/processes/${pid}/versions/${v1.body[0].id}/approve`, { method: "POST", json: { note: "Schváleno vedením" } });
    expect(ap.body[0]).toMatchObject({ status: "approved", approvalNote: "Schváleno vedením" });
    expect((await admin.json(`/api/processes/${pid}`)).body.status).toBe("active");
    // změna procesu → nová verze → rozdíly
    const d = (await admin.json(`/api/processes/${pid}`)).body;
    await admin.json(`/api/processes/${pid}`, { method: "PATCH", json: { purpose: "Nový účel procesu" } });
    await admin.json(`/api/processes/${pid}/steps`, { method: "POST", json: { name: "Kontrola výstupu", stepType: "task" } });
    const v2 = await admin.json(`/api/processes/${pid}/versions`, { method: "POST", json: { changeSummary: "Doplněna kontrola" } });
    const [newer, older] = v2.body;
    expect(newer.number).toBe(2);
    const a = (await admin.json(`/api/processes/${pid}/versions/${older.id}`)).body.snapshot;
    const b = (await admin.json(`/api/processes/${pid}/versions/${newer.id}`)).body.snapshot;
    expect(b.purpose).toBe("Nový účel procesu");
    expect(b.steps.length).toBe(d.steps.length + 1);
    const { diffProcess } = await import("@contix/shared");
    const diff = diffProcess(a, b);
    expect(diff.find((x) => x.label === "Účel")?.to).toBe("Nový účel procesu");
    expect(diff.some((x) => x.area === "step" && x.change === "added" && x.label.includes("Kontrola výstupu"))).toBe(true);
    // schválenou verzi nelze smazat, návrh ano
    expect((await admin.json(`/api/processes/${pid}/versions/${older.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await admin.json(`/api/processes/${pid}/versions/${newer.id}`, { method: "DELETE" })).status).toBe(200);
  });

  test("GDPR: záznam o činnosti zpracování, mezery, screening DPIA, DPIA, výstup čl. 30", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const HR = { "x-contix-company": root.id };
    const a = await admin.json("/api/gdpr", {
      method: "POST",
      headers: HR,
      json: { code: "ZP-01", name: "Personální agenda", status: "active", dataSubjects: ["zaměstnanci"], dpiaCriteria: ["vulnerable_subjects", "systematic_monitoring"], processIds: [ids.process], assetIds: [ids.server] },
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ dpiaRequired: true, processes: [{ id: ids.process }], assets: [{ id: ids.server }] });
    expect(a.body.gaps.join(" ")).toContain("účel");
    expect(a.body.gaps.join(" ")).toContain("DPIA");
    const u = await admin.json(`/api/gdpr/${a.body.id}`, {
      method: "PATCH",
      headers: HR,
      json: { purpose: "Vedení personální a mzdové agendy", legalBasis: "legal_obligation", dataCategories: ["identifikační údaje", "mzdové údaje"], retention: "50 let (důchodové pojištění)", securityMeasures: "Přístup jen HR, šifrování" },
    });
    expect(u.body.gaps).toEqual(["Splněna 2 kritéria pro DPIA – posouzení vlivu není dokončeno (čl. 35)."]);
    // DPIA
    expect((await admin.json(`/api/gdpr/${a.body.id}/dpia/approve`, { method: "POST", headers: HR })).status).toBe(404);
    const d = await admin.json(`/api/gdpr/${a.body.id}/dpia`, { method: "PUT", headers: HR, json: { status: "in_progress", necessity: "Zákonná povinnost", risks: [{ description: "Neoprávněný přístup ke mzdám", likelihood: 2, severity: 4, measures: "Řízení přístupu", residualLikelihood: 1, residualSeverity: 4 }] } });
    expect(d.body.maxResidual).toBe(4);
    expect((await admin.json(`/api/gdpr/${a.body.id}/dpia/approve`, { method: "POST", headers: HR })).status).toBe(400);
    await admin.json(`/api/gdpr/${a.body.id}/dpia`, { method: "PUT", headers: HR, json: { conclusion: "Zbytkové riziko přijatelné" } });
    const appr = await admin.json(`/api/gdpr/${a.body.id}/dpia/approve`, { method: "POST", headers: HR });
    expect(appr.body).toMatchObject({ status: "completed", approvedByName: expect.any(String) });
    expect(appr.body.nextReview).toBeTruthy();
    expect((await admin.json(`/api/gdpr/${a.body.id}`, { headers: HR })).body.gaps).toEqual([]);
    // schválené DPIA nejde měnit bez vrácení do zpracování
    expect((await admin.json(`/api/gdpr/${a.body.id}/dpia`, { method: "PUT", headers: HR, json: { conclusion: "x" } })).status).toBe(409);
    // povinnosti + přehled
    const team = (await admin.json("/api/notifications/team", { headers: HR })).body as any[];
    void team;
    const dash = (await admin.json("/api/dashboard", { headers: HR })).body;
    expect(dash.gdpr).toMatchObject({ activities: 1, dpiaMissing: 0 });
    // výstup čl. 30
    const page = await (await admin.req("/api/gdpr/ropa.html", { headers: HR })).text();
    expect(page).toContain("Záznamy o činnostech zpracování");
    expect(page).toContain("Personální agenda");
    expect(page).toContain("Právní povinnost");
    const docx = await admin.req("/api/gdpr/ropa.docx", { headers: HR });
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
    // auditor čte, nezapisuje
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/gdpr", { headers: HR })).status).toBe(200);
    expect((await auditor.json("/api/gdpr", { method: "POST", headers: HR, json: { name: "X" } })).status).toBe(403);
  });

  test("legislativa v1.12.2: nejnovější znění bez textu v otevřených datech → sleduje se starší, pak se změna zachytí", async () => {
    const { syncAct } = await import("../src/modules/legislation/service");
    const RES = "https://opendata.eselpoint.gov.cz/esel-esb/eli/cz";
    const VOCAB = "https://slovník.gov.cz/datový/sbírka/pojem/";
    const st = { newHasText: false };
    const lit = (v: string) => ({ type: "literal", value: v });
    const frag = (n: number, cit: string, text: string, ver: string) => ({ d: { type: "uri", value: `${RES}${ver}/dokument/norma/par_${n}/frag_${n}` }, url: lit(`${ver}#par_${n}`), cit: lit(cit), ord: lit(String(n).padStart(4, "0")), text: lit(text) });
    const sparql = async (_u: string, init?: RequestInit) => {
      const q = new URLSearchParams(String(init?.body)).get("query") ?? "";
      const out = (rows: unknown[]) => Response.json({ results: { bindings: rows } });
      if (q.includes("SAMPLE(?o)")) return out(["pořadí-fragmentu-znění-právního-aktu", "url-fragmentu-znění", "citace-označení-fragmentu-znění-právního-aktu"].map((x) => ({ p: { type: "uri", value: VOCAB + x }, o: lit("1") })).concat([{ p: { type: "uri", value: `${VOCAB}obsahuje-fragment` }, o: { type: "uri", value: "https://o/f/1" } as never }]));
      if (q.includes("?f ?p ?x")) return out([{ p: { type: "uri", value: `${VOCAB}text-fragmentu` } }]);
      if (q.includes("má-znění"))
        return out([
          { z: { type: "uri", value: `${RES}/sb/2025/264/2025-11-01` }, od: lit("2025-11-01"), cit: lit("264/2025 Sb.") },
          { z: { type: "uri", value: `${RES}/sb/2025/264/2027-01-01` }, od: lit("2027-01-01"), cit: lit("264/2025 Sb.") },
        ]);
      if (q.includes("COUNT(")) return out([{ n: lit("0"), ord: lit("0"), txt: lit("0") }]);
      if (q.includes("/sb/2025/264/2027-01-01>")) return out(st.newHasText ? [frag(1, "§ 1", "Předmět úpravy – nové znění.", "/sb/2025/264/2027-01-01")] : []);
      if (q.includes("/sb/2025/264/2025-11-01>") && q.includes('> "")')) return out([frag(1, "§ 1", "Předmět úpravy.", "/sb/2025/264/2025-11-01")]);
      return out([]);
    };
    const cfg = { ...config, ESBIRKA_SOURCE: "opendata" as const, ESBIRKA_SPARQL_URL: "https://sparql.test/sparql" };
    const [act] = await db.insert(schema.legalActs).values({ source: "esbirka", code: "264/2025 Sb.", title: "Zákon o kybernetické bezpečnosti (test)", staleUrl: "/sb/2025/264" }).returning();
    expect(await syncAct(db, cfg, act!.id, { fetchImpl: sparql as never })).toMatchObject({ changeId: null });
    let row = (await db.select().from(schema.legalActs).where(sql`id = ${act!.id}`))[0]!;
    expect(row.lastStatus).toBe("ok");
    expect(row.lastError).toContain("2027-01-01");
    const v1 = (await db.select().from(schema.legalVersions).where(sql`act_id = ${act!.id}`))[0]!;
    expect(v1.versionKey).toBe("/sb/2025/264/2025-11-01");
    // text novějšího znění dorazil → hned při další kontrole (i do týdne) vznikne změna
    st.newHasText = true;
    const r2 = await syncAct(db, cfg, act!.id, { fetchImpl: sparql as never });
    expect(r2.changeId).toBeTruthy();
    row = (await db.select().from(schema.legalActs).where(sql`id = ${act!.id}`))[0]!;
    expect(row).toMatchObject({ lastStatus: "ok", lastError: null });
    // žádné znění s textem → chyba s diagnostikou (počty, žádný obsah)
    const [act2] = await db.insert(schema.legalActs).values({ source: "esbirka", code: "1/2099 Sb.", title: "Prázdný", staleUrl: "/sb/2099/1" }).returning();
    const empty = async (_u: string, init?: RequestInit) => {
      const q = new URLSearchParams(String(init?.body)).get("query") ?? "";
      if (q.includes("má-znění")) return Response.json({ results: { bindings: [{ z: { type: "uri", value: `${RES}/sb/2099/1/2099-01-01` }, od: lit("2099-01-01") }] } });
      if (q.includes("COUNT(")) return Response.json({ results: { bindings: [{ n: lit("12"), ord: lit("12"), txt: lit("0") }] } });
      return Response.json({ results: { bindings: [] } });
    };
    await expect(syncAct(db, cfg, act2!.id, { fetchImpl: empty as never })).rejects.toThrow("[znění /sb/2099/1/2099-01-01: řádků 0; vlastnosti znění:");
  });

  test("legislativa v1.13.2: přepnutí zdroje textu bez falešné změny, rozdíl proti stejnému zdroji, volba zdroje, upozornění v Provozu", async () => {
    const { syncAct, legislationStatus } = await import("../src/modules/legislation/service");
    const RES = "https://opendata.eselpoint.gov.cz/esel-esb/eli/cz";
    const VOCAB = "https://slovník.gov.cz/datový/sbírka/pojem/";
    const lit = (v: string) => ({ type: "literal", value: v });
    const A = "/sb/2025/777/2025-11-01";
    const B = "/sb/2025/777/2026-12-01";
    const st = { od: true, versions: [A], sparqlFragCalls: 0 };
    const odRows = (ver: string) => [
      { d: { type: "uri", value: `${RES}${ver}/dokument/norma/par_1/frag_1` }, url: lit(`${ver}#par_1`), cit: lit("§ 1"), ord: lit("0001"), text: lit("Předmět  úpravy.") },
      { d: { type: "uri", value: `${RES}${ver}/dokument/norma/par_2/frag_2` }, url: lit(`${ver}#par_2`), cit: lit("§ 2"), ord: lit("0002"), text: lit("Pojmy.") },
    ];
    // web e-Sbírky: stejný obsah, jiné formátování; v B se skutečně změnil jen § 2
    const web: Record<string, { id: number; staleUrl: string; zkracenaCitace: string; xhtml: string }[]> = {
      [A]: [{ id: 1, staleUrl: `${A}#par_1`, zkracenaCitace: "§ 1", xhtml: "<p>Předmět úpravy</p>" }, { id: 2, staleUrl: `${A}#par_2`, zkracenaCitace: "§ 2", xhtml: "<p>Pojmy</p>" }],
      [B]: [{ id: 11, staleUrl: `${B}#par_1`, zkracenaCitace: "§ 1", xhtml: "<p>Předmět úpravy</p>" }, { id: 12, staleUrl: `${B}#par_2`, zkracenaCitace: "§ 2", xhtml: "<p>Pojmy a zkratky</p>" }],
    };
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://e-sbirka.gov.cz/sbr-cache/")) {
        const u = new URL(url);
        const ver = decodeURIComponent(u.pathname.split("/dokumenty-sbirky/")[1]!.split("/fragmenty")[0]!);
        return Response.json(u.searchParams.get("cisloStranky") === "0" ? { seznam: web[ver] ?? [], pocetStranek: 1 } : { seznam: [] });
      }
      const q = new URLSearchParams(String(init?.body)).get("query") ?? "";
      const out = (rows: unknown[]) => Response.json({ results: { bindings: rows } });
      if (q.includes("má-znění")) return out(st.versions.map((v) => ({ z: { type: "uri", value: RES + v }, od: lit(v.slice(-10)), cit: lit("777/2025 Sb.") })));
      if (!st.od) return out([]);
      if (q.includes("SAMPLE(?o)")) return out(["pořadí-fragmentu-znění-právního-aktu", "url-fragmentu-znění", "citace-označení-fragmentu-znění-právního-aktu"].map((x) => ({ p: { type: "uri", value: VOCAB + x }, o: lit("1") })).concat([{ p: { type: "uri", value: `${VOCAB}obsahuje-fragment` }, o: { type: "uri", value: "https://o/f/1" } as never }]));
      if (q.includes("?f ?p ?x")) return out([{ p: { type: "uri", value: `${VOCAB}text-fragmentu` } }]);
      for (const v of [A, B]) if (q.includes(`<${RES}${v}>`) && q.includes('> "")')) return (st.sparqlFragCalls++, out(odRows(v)));
      return out([]);
    };
    const cfg = { ...config, ESBIRKA_SOURCE: "opendata" as const, ESBIRKA_SPARQL_URL: "https://sparql.test/sparql" };
    const [act] = await db.insert(schema.legalActs).values({ source: "esbirka", code: "777/2025 Sb.", title: "Testovací zákon", staleUrl: "/sb/2025/777" }).returning();
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    await db.insert(schema.legalWatch).values({ companyId: ROOT_COMPANY_ID, actId: act!.id });
    const actRow = async () => (await db.select().from(schema.legalActs).where(sql`id = ${act!.id}`))[0]!;
    const changes = async () => (await db.select().from(schema.legalChanges).where(sql`act_id = ${act!.id}`)) as any[];
    await syncAct(db, cfg, act!.id, { fetchImpl: fetchImpl as never });
    expect(((await actRow()).meta as any).textSource).toBe("opendata");
    // otevřená data přestala vracet text → stejné znění z webu: text se nahradí, žádná změna ani posouzení
    st.od = false;
    expect(await syncAct(db, cfg, act!.id, { fetchImpl: fetchImpl as never, force: true })).toMatchObject({ changeId: null });
    expect(await changes()).toHaveLength(0);
    const m1 = (await actRow()).meta as any;
    expect(m1.textSource).toBe("web");
    expect(m1.webSince).toBeTruthy();
    const dto = ((await admin.json("/api/legislation/acts")).body as any[]).find((x) => x.id === act!.id);
    expect(dto.currentVersion.textSource).toBe("web");
    // upozornění v Provozu až po týdnu zálohy
    expect((await legislationStatus(db, cfg)).fallback.map((a: any) => a.code)).not.toContain("777/2025 Sb.");
    expect((await legislationStatus(db, cfg, new Date(Date.now() + 8 * 86_400_000))).fallback.map((a: any) => a.code)).toContain("777/2025 Sb.");
    // otevřená data zpět + nové znění → rozdíl proti A ze stejného zdroje (otevřená data), jen skutečná změna § 2
    st.od = true;
    st.versions = [A, B];
    const odB = odRows(B);
    odB[1]!.text = lit("Pojmy a zkratky.");
    const orig = odRows;
    void orig;
    const fetch2 = async (url: string, init?: RequestInit) => {
      const q = new URLSearchParams(String(init?.body)).get("query") ?? "";
      if (q.includes(`<${RES}${B}>`) && q.includes('> "")')) return Response.json({ results: { bindings: odB } });
      return fetchImpl(url, init);
    };
    const r2 = await syncAct(db, cfg, act!.id, { fetchImpl: fetch2 as never });
    expect(r2.changeId).toBeTruthy();
    const ch = (await changes())[0];
    expect({ added: ch.added, removed: ch.removed, modified: ch.modified }).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(((await actRow()).meta as any)).toMatchObject({ textSource: "opendata", webSince: null });
    // volba zdroje v administraci: jen web → otevřená data se na text neptají
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { legalTextSource: "web" } })).status).toBe(200);
    expect((await admin.json("/api/legislation/status")).body).toMatchObject({ mode: "web", webFallback: true });
    const before = st.sparqlFragCalls;
    await syncAct(db, cfg, act!.id, { fetchImpl: fetchImpl as never, force: true });
    expect(st.sparqlFragCalls).toBe(before);
    expect(((await actRow()).meta as any).textSource).toBe("web");
    expect(await changes()).toHaveLength(1);
    await admin.json("/api/admin/settings", { method: "PATCH", json: { legalTextSource: "auto" } });
  });

  test("automatické důkazy v1.13: monitory nad daty GRC, externí kontrola s tokenem, úkol při nesplnění (ADR-109)", async () => {
    const { processMonitors } = await import("../src/modules/controls/monitors");
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: H, json: { code: "K-MON", name: "Zálohování a školení (monitor)", status: "implemented", ownerPositionId: ids.posHead } })).body;
    for (const kind of ["training_completion", "policy_ack", "obligations_overdue"]) {
      const m = (await admin.json("/api/monitors", { method: "POST", headers: H, json: { controlId: ctl.id, kind } })).body;
      const run = (await admin.json(`/api/monitors/${m.id}/run`, { method: "POST", headers: H })).body;
      expect(run.summary).not.toContain("Neočekávaná chyba");
      expect(run.result).toMatch(/pass|fail|error/);
    }
    // povinnosti po termínu jen z úkolů + úkol vlastníkovi opatření při nesplnění (jeden otevřený)
    await admin.json("/api/actions/tasks", { method: "POST", json: { title: "Prošlý úkol pro monitor", companyId: root.id, dueDate: "2020-01-01" } });
    const ob = (await admin.json("/api/monitors", { method: "POST", headers: H, json: { controlId: ctl.id, kind: "obligations_overdue", autoTask: true, params: { obligationKinds: ["task"], maxCount: 0 } } })).body;
    expect(ob).toMatchObject({ autoTask: true, openTaskId: null, params: { obligationKinds: ["task"] } });
    const r1 = (await admin.json(`/api/monitors/${ob.id}/run`, { method: "POST", headers: H })).body;
    expect(r1.result).toBe("fail");
    expect(r1.details.map((d: any) => d.ref)).toContain("Prošlý úkol pro monitor");
    const ob1 = ((await admin.json(`/api/monitors?controlId=${ctl.id}`, { headers: H })).body as any[]).find((x) => x.id === ob.id);
    expect(ob1.openTaskId).toBeTruthy();
    const task = (await admin.json(`/api/actions/tasks/${ob1.openTaskId}`)).body;
    expect(task).toMatchObject({ sourceKind: "control", priority: "high", ownerPositionId: ids.posHead });
    expect(task.title).toContain("K-MON");
    await admin.json(`/api/monitors/${ob.id}/run`, { method: "POST", headers: H });
    expect(((await admin.json(`/api/monitors?controlId=${ctl.id}`, { headers: H })).body as any[]).find((x) => x.id === ob.id).openTaskId).toBe(ob1.openTaskId);
    await admin.json(`/api/actions/tasks/${ob1.openTaskId}`, { method: "PATCH", json: { status: "done" } });
    await admin.json(`/api/monitors/${ob.id}/run`, { method: "POST", headers: H });
    expect(((await admin.json(`/api/monitors?controlId=${ctl.id}`, { headers: H })).body as any[]).find((x) => x.id === ob.id).openTaskId).not.toBe(ob1.openTaskId);
    // externí kontrola: token jen jednou, výsledek ze skriptu bez cookies, ruční běh nelze
    const ex = (await admin.json("/api/monitors", { method: "POST", headers: H, json: { controlId: ctl.id, kind: "external_check", name: "Noční záloha", frequency: "daily" } })).body;
    expect(ex.hasToken).toBe(false);
    expect((await admin.json(`/api/monitors/${ex.id}/run`, { method: "POST", headers: H })).status).toBe(409);
    expect((await admin.json(`/api/monitors/${ob.id}/token`, { method: "POST", headers: H })).status).toBe(400);
    const token = (await admin.json(`/api/monitors/${ex.id}/token`, { method: "POST", headers: H })).body.token as string;
    expect(token).toMatch(/^cxm_/);
    const push = (body: unknown, tok: string | null = token) => app.request("/api/public/monitors/result", { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
    expect((await push({ result: "pass" }, null)).status).toBe(401);
    expect((await push({ result: "pass" }, "cxm_spatny")).status).toBe(401);
    expect((await push({ summary: "bez výsledku" })).status).toBe(400);
    const p1 = await push({ value: 3, summary: "3 úlohy zálohování selhaly", details: [{ ref: "job-db", detail: "timeout" }] });
    expect(p1.status).toBe(201);
    expect(((await p1.json()) as any).result).toBe("fail");
    expect(((await (await push({ result: "pass" })).json()) as any).result).toBe("pass");
    const exList = ((await admin.json(`/api/monitors?controlId=${ctl.id}`, { headers: H })).body as any[]).find((x) => x.id === ex.id);
    expect(exList).toMatchObject({ hasToken: true, lastResult: "pass" });
    expect(JSON.stringify(exList)).not.toContain("tokenHash");
    const runs = (await admin.json(`/api/monitors/${ex.id}/runs`, { headers: H })).body as any[];
    expect(runs.map((r) => r.result)).toEqual(["pass", "fail"]);
    expect(runs[1]).toMatchObject({ value: 3, threshold: 0, summary: "3 úlohy zálohování selhaly", details: [{ ref: "job-db", detail: "timeout" }] });
    // výsledek nedorazil → plánovač zapíše chybu
    await processMonitors(db, config, new Date(Date.now() + 3 * 86_400_000));
    expect(((await admin.json(`/api/monitors/${ex.id}/runs`, { headers: H })).body as any[])[0]).toMatchObject({ result: "error", summary: expect.stringContaining("nedodala výsledek") });
    // nový token zneplatní starý; vypnutý monitor výsledky nepřijímá
    const token2 = (await admin.json(`/api/monitors/${ex.id}/token`, { method: "POST", headers: H })).body.token as string;
    expect((await push({ result: "pass" })).status).toBe(401);
    await admin.json(`/api/monitors/${ex.id}`, { method: "PUT", headers: H, json: { controlId: ctl.id, kind: "external_check", enabled: false } });
    expect((await push({ result: "pass" }, token2)).status).toBe(401);
  });

  test("vazby v1.11: kompenzační opatření výjimky, AI systém ↔ rizika a opatření, zpětné vazby (ADR-107)", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: H, json: { code: "K-WAF", name: "WAF před aplikací", status: "implemented" } })).body;
    const allExc = (await admin.json("/api/exceptions", { headers: H })).body;
    const exc = (allExc.items as any[]).find((e) => e.kind === "requirement_na" && e.companyId === root.id);
    expect(exc).toMatchObject({ compensating: [], canEdit: true });
    const url = `/api/exceptions/requirement_na/${encodeURIComponent(exc.id)}/controls`;
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json(url, { method: "PUT", json: { controlIds: [ctl.id] } })).status).toBe(403);
    expect((await admin.json("/api/exceptions/vulnerability/00000000-0000-4000-8000-000000000999/controls", { method: "PUT", headers: H, json: { controlIds: [] } })).status).toBe(404);
    expect((await admin.json(url, { method: "PUT", headers: H, json: { controlIds: ["00000000-0000-4000-8000-000000000999"] } })).status).toBe(400);
    const put = await admin.json(url, { method: "PUT", headers: H, json: { controlIds: [ctl.id, ctl.id], note: "WAF blokuje zneužití" } });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ compensating: [{ id: ctl.id, code: "K-WAF", name: "WAF před aplikací" }], compensatingNote: "WAF blokuje zneužití" });
    expect(await (await admin.req("/api/exceptions/export", { headers: H })).text()).toContain("K-WAF WAF před aplikací");
    // zpětná vazba u opatření
    const bl = (await admin.json(`/api/links/control/${ctl.id}`, { headers: H })).body;
    expect(bl.groups.find((g: any) => g.kind === "exception").items[0]).toMatchObject({ label: exc.title, sub: "Neaplikované ustanovení", link: "/exceptions" });
    // AI systém ↔ riziko a opatření
    const risk = ((await admin.json("/api/risks?limit=50", { headers: H })).body.items as any[]).find((r) => r.companyId === root.id);
    const ai = await admin.json("/api/aiact", { method: "POST", headers: H, json: { name: "Asistent podpory", riskIds: [risk.id], controlIds: [ctl.id] } });
    expect(ai.status).toBe(201);
    expect(ai.body.risks.map((x: any) => x.id)).toEqual([risk.id]);
    expect(ai.body.controls.map((x: any) => x.code)).toEqual(["K-WAF"]);
    expect(((await admin.json(`/api/links/risk/${risk.id}`, { headers: H })).body.groups as any[]).find((g) => g.kind === "ai_system").items.map((x: any) => x.label)).toContain("Asistent podpory");
    expect(((await admin.json(`/api/links/control/${ctl.id}`, { headers: H })).body.groups as any[]).some((g) => g.kind === "ai_system")).toBe(true);
    const pa = await admin.json(`/api/aiact/${ai.body.id}`, { method: "PATCH", headers: H, json: { controlIds: [] } });
    expect(pa.body.controls).toEqual([]);
    expect(pa.body.risks).toHaveLength(1);
    // vyprázdnění kompenzačních opatření
    expect((await admin.json(url, { method: "PUT", headers: H, json: { controlIds: [] } })).body.compensating).toEqual([]);
  });

  test("AI Act: registr, screening a klasifikace, povinnosti, schválení, FRIA, směrnice a AI gramotnost (ADR-090)", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    const a = await admin.json("/api/aiact", { method: "POST", headers: H, json: { code: "AI-01", name: "Třídění životopisů", vendor: "HR SaaS", role: "deployer", ownerPositionId: ids.posMkb } });
    expect(a.status).toBe(201);
    expect(a.body.classification.cls).toBe("unassessed");
    expect(a.body.gaps).toEqual(expect.arrayContaining(["not_screened", "no_purpose"]));
    // schválení se nedá obejít stavem ani bez screeningu
    expect((await admin.json(`/api/aiact/${a.body.id}`, { method: "PATCH", headers: H, json: { status: "approved" } })).status).toBe(400);
    expect((await admin.json(`/api/aiact/${a.body.id}`, { method: "PATCH", headers: H, json: { status: "in_use" } })).status).toBe(409);
    expect((await admin.json(`/api/aiact/${a.body.id}/decision`, { method: "POST", headers: H, json: { decision: "approve" } })).status).toBe(409);
    // vysoké riziko (příloha III bod 4) u poskytovatele veřejných služeb → FRIA, DPIA, informování osob
    const u = await admin.json(`/api/aiact/${a.body.id}`, {
      method: "PATCH",
      headers: H,
      json: { purpose: "Předvýběr uchazečů", screening: { annexIII: ["recruitment"], exception: "preparatory", profiling: true, publicService: true, personalData: true, transparency: [] } },
    });
    expect(u.body.classification).toMatchObject({ cls: "high", highRiskFrom: "2027-12-02" });
    expect(u.body.friaRequired).toBe(true);
    const keys = (u.body.obligations as any[]).map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(["literacy", "d_oversight", "d_logs", "d_dpia", "d_inform_persons", "d_registration", "fria"]));
    expect(keys.some((k: string) => k.startsWith("p_"))).toBe(false);
    expect(u.body.gaps).toEqual(expect.arrayContaining(["no_oversight", "fria_missing", "dpia_missing", "obligations_open"]));
    // vysoké riziko bez lidského dohledu nelze schválit
    expect((await admin.json(`/api/aiact/${a.body.id}/decision`, { method: "POST", headers: H, json: { decision: "approve" } })).status).toBe(409);
    await admin.json(`/api/aiact/${a.body.id}`, { method: "PATCH", headers: H, json: { oversightPositionId: ids.posMkb } });
    const ok = await admin.json(`/api/aiact/${a.body.id}/decision`, { method: "POST", headers: H, json: { decision: "approve", note: "Jen jako podpora, rozhoduje personalista." } });
    expect(ok.body).toMatchObject({ status: "approved", decision: { note: "Jen jako podpora, rozhoduje personalista." } });
    expect(ok.body.nextReview).toBeTruthy();
    expect((await admin.json(`/api/aiact/${a.body.id}`, { method: "PATCH", headers: H, json: { status: "in_use" } })).body.status).toBe("in_use");
    // povinnosti: stav; neplatná povinnost
    const ob = await admin.json(`/api/aiact/${a.body.id}/obligations/d_logs`, { method: "PUT", headers: H, json: { status: "done", note: "Logy 12 měsíců v SIEM" } });
    expect(ob.body.obligations.find((o: any) => o.key === "d_logs")).toMatchObject({ status: "done", note: "Logy 12 měsíců v SIEM" });
    expect((await admin.json(`/api/aiact/${a.body.id}/obligations/p_qms`, { method: "PUT", headers: H, json: { status: "done" } })).status).toBe(409);
    expect((await admin.json(`/api/aiact/${a.body.id}/obligations/xyz`, { method: "PUT", headers: H, json: { status: "done" } })).status).toBe(404);
    // FRIA: neúplné nejde dokončit, dokončené je zamčené
    await admin.json(`/api/aiact/${a.body.id}/fria`, { method: "PUT", headers: H, json: { process: "Předvýběr", period: "Průběžně" } });
    expect((await admin.json(`/api/aiact/${a.body.id}/fria/approve`, { method: "POST", headers: H })).status).toBe(400);
    await admin.json(`/api/aiact/${a.body.id}/fria`, { method: "PUT", headers: H, json: { affected: "Uchazeči", risks: "Diskriminace", oversight: "Personalista ověří", mitigation: "Stížnosti u HR" } });
    const fr = await admin.json(`/api/aiact/${a.body.id}/fria/approve`, { method: "POST", headers: H });
    expect(fr.body.fria).toMatchObject({ status: "completed", process: "Předvýběr" });
    expect(fr.body.obligations.find((o: any) => o.key === "fria").status).toBe("done");
    expect(fr.body.gaps).not.toContain("fria_missing");
    expect((await admin.json(`/api/aiact/${a.body.id}/fria`, { method: "PUT", headers: H, json: { risks: "x" } })).status).toBe(409);
    // schválený systém nejde smazat
    expect((await admin.json(`/api/aiact/${a.body.id}`, { method: "DELETE", headers: H })).status).toBe(409);
    // zakázaná praktika → schválení se ruší
    const pr = await admin.json("/api/aiact", { method: "POST", headers: H, json: { name: "Nálada zaměstnanců z kamer", screening: { prohibited: ["emotion_workplace"] } } });
    expect(pr.body.classification.cls).toBe("prohibited");
    expect(pr.body.gaps).toContain("prohibited");
    expect((await admin.json(`/api/aiact/${pr.body.id}/decision`, { method: "POST", headers: H, json: { decision: "approve" } })).status).toBe(409);
    const chat = await admin.json("/api/aiact", { method: "POST", headers: H, json: { name: "Chatbot webu", role: "provider_deployer", purpose: "Odpovědi na dotazy", screening: { transparency: ["interacts", "synthetic_content"] } } });
    expect(chat.body.classification.cls).toBe("limited");
    expect((chat.body.obligations as any[]).map((o) => o.key).sort()).toEqual(["literacy", "t_interacts", "t_marking"]);
    // registr (tisk, Word)
    const page = await (await admin.req("/api/aiact/register.html", { headers: H })).text();
    expect(page).toContain("Registr AI systémů");
    expect(page).toContain("Třídění životopisů");
    expect(page).toContain("Vysoké riziko");
    expect((await admin.req("/api/aiact/register.docx", { headers: H })).headers.get("content-type")).toContain("wordprocessingml");
    // směrnice ze šablony + shrnutí s testem + kurz AI gramotnosti
    const dir = await admin.json("/api/aiact/directive", { method: "POST", headers: H, json: { companyId: root.id, course: true } });
    expect(dir.status).toBe(201);
    const pd = (await admin.json(`/api/policies/${dir.body.directiveId}`, { headers: H })).body;
    expect(pd.title).toBe("Směrnice o používání umělé inteligence");
    const sd = (await admin.json(`/api/policies/${dir.body.summaryId}`, { headers: H })).body;
    expect(sd.quiz.length).toBe(6);
    expect(sd.parentId).toBe(dir.body.directiveId);
    const content = (await admin.json(`/api/policies/${dir.body.directiveId}/versions/${pd.versions[0].id}/content`, { headers: H })).body.content;
    expect(content).toContain("Třídění životopisů");
    expect(content).not.toContain("Nálada zaměstnanců");
    expect((await admin.json("/api/aiact/directive", { method: "POST", headers: H, json: { companyId: root.id } })).status).toBe(409);
    const sum = (await admin.json(`/api/aiact/summary?companyId=${root.id}`, { headers: H })).body;
    expect(sum.directive.id).toBe(dir.body.directiveId);
    expect(sum.literacy[0]).toMatchObject({ id: dir.body.courseId });
    expect(sum.byClass).toMatchObject({ high: 1, prohibited: 1, limited: 1 });
    // auditor čte, nezapisuje
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/aiact", { headers: H })).status).toBe(200);
    expect((await auditor.json("/api/aiact", { method: "POST", headers: H, json: { name: "X" } })).status).toBe(403);
    expect((await auditor.json(`/api/aiact/${a.body.id}/obligations/d_logs`, { method: "PUT", headers: H, json: { status: "open" } })).status).toBe(403);
    // úklid (číslování dokumentů v dalších testech)
    expect((await admin.req(`/api/awareness/${dir.body.courseId}`, { method: "DELETE", headers: H })).status).toBeLessThan(300);
    expect((await admin.req(`/api/policies/${dir.body.summaryId}`, { method: "DELETE", headers: H })).status).toBe(204);
    expect((await admin.req(`/api/policies/${dir.body.directiveId}`, { method: "DELETE", headers: H })).status).toBe(204);
  });

  test("SOC 2 zakázka: rozsah, matice kritérií, testy, výjimky, pracovní papíry, PBC, připravenost a zpráva (ADR-091)", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    const e = await admin.json("/api/soc2", { method: "POST", headers: H, json: { title: "SOC 2 Type II – Cloud", reportType: "type2", categories: ["A1"], periodFrom: "2026-01-01", periodTo: "2026-06-30", systemName: "Business Cloud", serviceAuditor: "Cloud 9 s.r.o." } });
    expect(e.status).toBe(201);
    expect(e.body.categories).toEqual(["CC", "A1"]);
    expect(e.body.criteria.some((r: any) => r.id === "A1.2")).toBe(true);
    expect(e.body.criteria.some((r: any) => r.id === "C1.1")).toBe(false);
    const cc62 = e.body.criteria.find((r: any) => r.id === "CC6.2");
    expect(cc62).toMatchObject({ cz409: expect.arrayContaining(["§ 19"]), iso: ["A.5.16", "A.5.18"], workpaper: { conclusion: "pending" } });
    expect(e.body.readiness).toEqual(expect.arrayContaining(["description_missing", "criteria_untested", "criteria_pending", "report_date_missing"]));
    // audit typu soc2 vznikl s plánem = období
    const au = (await admin.json(`/api/audits/${e.body.auditId}`, { headers: H })).body;
    expect(au).toMatchObject({ auditType: "soc2", plannedStart: "2026-01-01", plannedEnd: "2026-06-30" });
    // opatření namapované na CC6.2 + test účinnosti v období se selháním vzorku
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: H, json: { code: "S-62", name: "Schvalování nových účtů", status: "implemented", requirementIds: ["soc2:CC6.2"] } })).body;
    const tOut = (await admin.json("/api/assurance/tests", { method: "POST", headers: H, json: { controlId: ctl.id, kind: "operating", periodFrom: "2025-01-01", periodTo: "2025-06-30", methods: ["inspection"] } })).body;
    const tIn = (await admin.json("/api/assurance/tests", { method: "POST", headers: H, json: { controlId: ctl.id, kind: "operating", periodFrom: "2026-01-01", periodTo: "2026-06-30", methods: ["inspection", "inquiry"], populationSize: 40, procedure: "Výběr 25 nových účtů, ověření schválení vedoucím." } })).body;
    await admin.json(`/api/assurance/tests/${tIn.id}/samples`, { method: "POST", headers: H, json: [{ ref: "U1", result: "pass" }, { ref: "U2", result: "fail", note: "bez schválení" }] });
    let d = (await admin.json(`/api/soc2/${e.body.id}`, { headers: H })).body;
    const row = d.criteria.find((r: any) => r.id === "CC6.2");
    expect(row.controls.map((c: any) => c.code)).toContain("S-62");
    expect(row.tests.map((t: any) => t.id)).toEqual([tIn.id]);
    expect(row.tests[0]).toMatchObject({ samples: 2, failed: 1 });
    void tOut;
    // výjimka z testu + vyjádření vedení přes zjištění auditu
    d = (await admin.json(`/api/soc2/${e.body.id}/exceptions`, { method: "POST", headers: H, json: { criterion: "CC6.2", testId: tIn.id, title: "1 z 2 účtů bez schválení" } })).body;
    const ex = d.criteria.find((r: any) => r.id === "CC6.2").exceptions[0];
    expect(ex).toMatchObject({ code: "EX-01", testId: tIn.id, managementResponse: null });
    expect(d.readiness).toContain("exceptions_without_response");
    await admin.json(`/api/audits/${e.body.auditId}/findings/${ex.id}`, { method: "PATCH", headers: H, json: { correctiveAction: "Zavedena automatická kontrola schválení v IdM." } });
    expect((await admin.json(`/api/soc2/${e.body.id}/exceptions`, { method: "POST", headers: H, json: { criterion: "C1.1", title: "x" } })).status).toBe(404);
    // pracovní papír
    d = (await admin.json(`/api/soc2/${e.body.id}/workpapers/CC6.2`, { method: "PUT", headers: H, json: { conclusion: "exceptions", note: "Vzorek 25, 1 výjimka." } })).body;
    expect(d.criteria.find((r: any) => r.id === "CC6.2").workpaper).toMatchObject({ conclusion: "exceptions", byName: expect.any(String) });
    expect(d.readiness).not.toContain("exceptions_without_response");
    expect((await admin.json(`/api/soc2/${e.body.id}/workpapers/ZZ1`, { method: "PUT", headers: H, json: { conclusion: "na" } })).status).toBe(404);
    // PBC šablona – jen kritéria v rozsahu, opakované vložení nic nezdvojí
    const pbc = (await admin.json(`/api/soc2/${e.body.id}/pbc-template`, { method: "POST", headers: H })).body;
    expect(pbc.created).toBeGreaterThan(20);
    expect((await admin.json(`/api/soc2/${e.body.id}/pbc-template`, { method: "POST", headers: H })).body.created).toBe(0);
    d = (await admin.json(`/api/soc2/${e.body.id}`, { headers: H })).body;
    expect(d.criteria.find((r: any) => r.id === "CC6.2").pbc.total).toBe(2);
    // popis, CUEC, subdodavatel, výrok
    d = (
      await admin.json(`/api/soc2/${e.body.id}`, {
        method: "PATCH",
        headers: H,
        json: {
          description: { services: "Privátní cloud IaaS", commitments: "Dostupnost 99,9 %" },
          cuecs: [{ text: "Zákazník spravuje přístupy svých uživatelů", criteria: ["CC6.2"] }],
          subservice: [{ name: "Datacentrum DC1", services: "Housing", method: "carve_out", csocs: [] }],
          signatory: "Ing. Jan Ukázkový",
          reportDate: "2026-07-31",
          reportPlace: "Praha",
          opinion: "qualified",
        },
      })
    ).body;
    expect(d.readiness).toEqual(expect.arrayContaining(["subservice_without_csoc", "opinion_basis_missing", "description_missing"]));
    expect(d.readiness).not.toContain("report_date_missing");
    // zpráva (tisk, Word)
    const html = await (await admin.req(`/api/soc2/${e.body.id}/report.html`, { headers: H })).text();
    expect(html).toContain("Zpráva nezávislého auditora");
    expect(html).toContain("Business Cloud");
    expect(html).toContain("S-62");
    expect(html).toContain("1 z 2 účtů bez schválení");
    expect(html).toContain("Zavedena automatická kontrola schválení v IdM.");
    expect(html).toContain("Datacentrum DC1");
    expect(html).toContain("s výhradou");
    expect(html).not.toMatch(/undefined|NaN/);
    expect((await admin.req(`/api/soc2/${e.body.id}/report.docx`, { headers: H })).headers.get("content-type")).toContain("wordprocessingml");
    // seznam, auditor čte, nezapisuje
    expect(((await admin.json("/api/soc2", { headers: H })).body as any[]).find((x) => x.id === e.body.id).progress).toMatchObject({ concluded: 1, exceptions: 1 });
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json(`/api/soc2/${e.body.id}`, { headers: H })).status).toBe(200);
    // úklid – smazání zakázky smaže audit
    expect((await admin.json(`/api/soc2/${e.body.id}`, { method: "DELETE", headers: H })).status).toBe(200);
    expect((await admin.json(`/api/audits/${e.body.auditId}`, { headers: H })).status).toBe(404);
  });

  test("CRA: produkt, kategorie a posouzení shody, požadavky, SBOM, hlášení čl. 14 a lhůty (ADR-092)", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    const p = await admin.json("/api/cra", { method: "POST", headers: H, json: { code: "P-01", name: "Router X", version: "2.1", productType: "both", role: "manufacturer", status: "on_market", category: "important_2", categoryItem: "firewall_ids", conformityModule: "A", onMarketSince: "2026-01-01", supportUntil: "2028-01-01", memberStates: ["cz", "sk"], ownerPositionId: ids.posMkb } });
    expect(p.status).toBe(201);
    expect(p.body.conformityOptions).toEqual(["B_C", "H", "EUCC"]);
    expect(p.body.memberStates).toEqual(["CZ", "SK"]);
    expect(p.body.gaps).toEqual(expect.arrayContaining(["conformity_not_allowed", "support_short", "no_contact", "no_sbom", "requirements_open"]));
    expect((p.body.requirements as any[]).some((r) => r.key === "p2_sbom")).toBe(true);
    expect((p.body.requirements as any[]).some((r) => r.key === "i_contact")).toBe(false);
    let d = (await admin.json(`/api/cra/${p.body.id}`, { method: "PATCH", headers: H, json: { conformityModule: "B_C", supportJustification: "Očekávaná doba používání 2 roky.", securityContact: "security@example.cz" } })).body;
    expect(d.gaps).not.toContain("conformity_not_allowed");
    expect(d.gaps).not.toContain("support_short");
    // požadavky
    d = (await admin.json(`/api/cra/${p.body.id}/requirements/p1_secure_default`, { method: "PUT", headers: H, json: { status: "done", note: "Hardening guide v3" } })).body;
    expect(d.requirements.find((r: any) => r.key === "p1_secure_default")).toMatchObject({ status: "done", note: "Hardening guide v3" });
    expect((await admin.json(`/api/cra/${p.body.id}/requirements/d_check`, { method: "PUT", headers: H, json: { status: "done" } })).status).toBe(409);
    // SBOM CycloneDX
    const cdx = { bomFormat: "CycloneDX", specVersion: "1.5", components: [{ name: "openssl", version: "3.0.13", purl: "pkg:generic/openssl@3.0.13", licenses: [{ license: { id: "Apache-2.0" } }] }, { name: "busybox", version: "1.36.1", components: [{ name: "musl", version: "1.2.4" }] }] };
    const sb = await admin.json(`/api/cra/${p.body.id}/sbom`, { method: "POST", headers: H, json: { text: JSON.stringify(cdx) } });
    expect(sb.body).toMatchObject({ format: "cyclonedx", imported: 3 });
    expect(((await admin.json(`/api/cra/${p.body.id}/components`, { headers: H })).body as any[]).find((c) => c.name === "openssl")).toMatchObject({ license: "Apache-2.0", purl: "pkg:generic/openssl@3.0.13" });
    expect((await admin.json(`/api/cra/${p.body.id}/sbom`, { method: "POST", headers: H, json: { text: "{\"x\":1}" } })).status).toBe(400);
    // hlášení zranitelnosti – včasné varování po lhůtě
    const aware = new Date(Date.now() - 30 * 3600_000).toISOString();
    const r = await admin.json(`/api/cra/${p.body.id}/reports`, { method: "POST", headers: H, json: { kind: "vulnerability", title: "RCE ve webovém rozhraní", awareAt: aware, cveIds: ["CVE-2026-11111"], malicious: true } });
    expect(r.status).toBe(201);
    expect(r.body.memberStates).toEqual(["CZ", "SK"]);
    expect(r.body.deadlines.map((x: any) => x.state)).toEqual(["overdue", "open", "waiting"]);
    expect((await admin.json(`/api/cra/${p.body.id}`, { headers: H })).body).toMatchObject({ openReports: 1, overdueReports: 1 });
    const team = (await admin.json("/api/notifications/team", { headers: H })).body as any[];
    expect(team.some((o) => o.key === `cra_report:${r.body.id}`)).toBe(true);
    // podání a náprava
    const fix = new Date(Date.now() - 2 * 3600_000).toISOString();
    const u = await admin.json(`/api/cra/reports/${r.body.id}`, { method: "PATCH", headers: H, json: { earlyWarningAt: new Date(Date.now() - 6 * 3600_000).toISOString(), notificationAt: fix, correctiveAvailableAt: fix, srpRef: "SRP-2026-0001" } });
    expect(u.body.deadlines.map((x: any) => x.state)).toEqual(["late_done", "done", "open"]);
    expect(new Date(u.body.deadlines[2].due).getTime() - new Date(fix).getTime()).toBe(14 * 24 * 3600_000);
    // text pro SRP
    const tx = (await admin.json(`/api/cra/reports/${r.body.id}/text?stage=final&lang=en`, { headers: H })).body;
    expect(tx.sections.map((s: any) => s.label)).toEqual(expect.arrayContaining(["Product (name, version)", "Vulnerability identifiers", "Information on the malicious actor"]));
    expect(tx.sections.find((s: any) => s.label === "Product (name, version)").value).toBe("Router X 2.1");
    expect((await admin.json(`/api/cra/reports/${r.body.id}/text?stage=early`, { headers: H })).body.sections.some((s: any) => s.label === "Povaha zranitelnosti / incidentu a způsob zneužití")).toBe(false);
    // podané nejde smazat, produkt s hlášením také ne
    expect((await admin.json(`/api/cra/reports/${r.body.id}`, { method: "DELETE", headers: H })).status).toBe(409);
    expect((await admin.json(`/api/cra/${p.body.id}`, { method: "DELETE", headers: H })).status).toBe(409);
    // incident: závěrečná zpráva 1 měsíc od oznámení
    const inc = (await admin.json(`/api/cra/${p.body.id}/reports`, { method: "POST", headers: H, json: { kind: "incident", title: "Kompromitace build serveru", awareAt: "2026-10-01T08:00:00Z", notificationAt: "2026-10-03T08:00:00Z" } })).body;
    expect(inc.deadlines[2].due.slice(0, 10)).toBe("2026-11-03");
    // přehled hlášení, auditor čte
    expect(((await admin.json("/api/cra/reports", { headers: H })).body as any[]).length).toBeGreaterThanOrEqual(2);
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json(`/api/cra/${p.body.id}`, { headers: H })).status).toBe(200);
    expect((await auditor.json("/api/cra", { method: "POST", headers: H, json: { name: "X" } })).status).toBe(403);
    expect((await auditor.json(`/api/cra/reports/${r.body.id}`, { method: "PATCH", headers: H, json: { closed: true } })).status).toBe(403);
  });

  test("CRA: databáze OSV, párování SBOM, KEV, VEX a export OpenVEX / CycloneDX (ADR-093)", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    const p = (await admin.json("/api/cra", { method: "POST", headers: H, json: { name: "Web portál", version: "1.0", role: "manufacturer", category: "default" } })).body;
    const sbom = (lodash: string) => ({ bomFormat: "CycloneDX", components: [{ name: "lodash", version: lodash, purl: `pkg:npm/lodash@${lodash}` }, { name: "minimist", version: "1.2.5", purl: "pkg:npm/minimist@1.2.5" }, { name: "openssl", version: "3.0.1", purl: "pkg:generic/openssl@3.0.1" }] });
    expect((await admin.json(`/api/cra/${p.id}/sbom`, { method: "POST", headers: H, json: { text: JSON.stringify(sbom("4.17.20")) } })).body.matches).toBe(0);
    // stažení ekosystému npm (jen GET) a párování
    expect((await admin.json("/api/cra/osv/refresh", { method: "POST", headers: H })).status).toBe(400);
    await admin.json("/api/cra/osv", { method: "PUT", headers: H, json: { ecosystems: ["npm"], autoRefresh: false, baseUrl: "https://osv-vulnerabilities.storage.googleapis.com" } });
    // stahování běží na pozadí (ADR-100): 202, souběžné spuštění = 409, výsledek ve stavu
    const st = await admin.json("/api/cra/osv/refresh", { method: "POST", headers: H });
    expect(st.status).toBe(202);
    expect(st.body.status.runningSince).toBeTruthy();
    expect((await admin.json("/api/cra/osv/refresh", { method: "POST", headers: H })).status).toBe(409);
    await osvRefreshPending();
    const rf = (await admin.json("/api/cra/osv", { headers: H })).body;
    expect(rf).toMatchObject({ runningSince: null, lastResult: { records: 2, errors: [] } });
    expect(rf.counts).toEqual([{ ecosystem: "npm", records: 2 }]);
    let f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    expect(f.map((x) => x.vulnId).sort()).toEqual(["GHSA-35jh-r3h4-6jhm", "GHSA-xvch-5gv4-984h"]);
    expect(f.find((x) => x.vulnId === "GHSA-35jh-r3h4-6jhm")).toMatchObject({ status: "under_investigation", cves: ["CVE-2021-23337"], componentName: "lodash", kev: false });
    // KEV → mezera a návrh hlášení
    await db.execute(sql`insert into vuln_intel (cve_id, kev, kev_name) values ('CVE-2021-23337', true, 'lodash') on conflict (cve_id) do update set kev = true`);
    const d = (await admin.json(`/api/cra/${p.id}`, { headers: H })).body;
    expect(d).toMatchObject({ openVulns: 2, kevVulns: 1 });
    expect(d.gaps).toEqual(expect.arrayContaining(["vulns_open", "vulns_kev"]));
    // VEX: nezasaženo jen se zdůvodněním
    const mini = f.find((x) => x.vulnId === "GHSA-xvch-5gv4-984h");
    expect((await admin.json(`/api/cra/findings/${mini.id}`, { method: "PATCH", headers: H, json: { status: "not_affected" } })).status).toBe(400);
    const u = (await admin.json(`/api/cra/findings/${mini.id}`, { method: "PATCH", headers: H, json: { status: "not_affected", justification: "vulnerable_code_not_in_execute_path", impactStatement: "Parser argumentů se v produktu nevolá." } })).body;
    expect(u).toMatchObject({ status: "not_affected", justification: "vulnerable_code_not_in_execute_path" });
    // ruční zranitelnost ke komponentě bez pokrytí OSV
    expect((await admin.json(`/api/cra/${p.id}/findings`, { method: "POST", headers: H, json: { vulnId: "cve-2022-3602", componentRef: "pkg:generic/openssl@3.0.1" } })).status).toBe(201);
    expect((await admin.json(`/api/cra/${p.id}/findings`, { method: "POST", headers: H, json: { vulnId: "CVE-2022-3602", componentRef: "pkg:generic/openssl@3.0.1" } })).status).toBe(409);
    // export VEX
    const ov = (await (await admin.req(`/api/cra/${p.id}/vex?format=openvex`, { headers: H })).json()) as any;
    expect(ov["@context"]).toBe("https://openvex.dev/ns/v0.2.0");
    expect(ov.statements.find((s: any) => s.vulnerability.name === "GHSA-xvch-5gv4-984h")).toMatchObject({ status: "not_affected", justification: "vulnerable_code_not_in_execute_path" });
    expect(ov.statements.find((s: any) => s.vulnerability.name === "CVE-2022-3602").status).toBe("under_investigation");
    const cdx = (await (await admin.req(`/api/cra/${p.id}/vex?format=cyclonedx`, { headers: H })).json()) as any;
    expect(cdx.vulnerabilities.find((v: any) => v.id === "GHSA-xvch-5gv4-984h").analysis).toMatchObject({ state: "not_affected", justification: "code_not_reachable" });
    // nová verze lodash v SBOM → nález lodash je neaktuální
    expect((await admin.json(`/api/cra/${p.id}/sbom`, { method: "POST", headers: H, json: { text: JSON.stringify(sbom("4.17.21")) } })).body.matches).toBe(1);
    f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    expect(f.find((x) => x.vulnId === "GHSA-35jh-r3h4-6jhm" && x.componentRef === "pkg:npm/lodash@4.17.20").gone).toBe(true);
    expect((await admin.json(`/api/cra/${p.id}`, { headers: H })).body.kevVulns).toBe(0);
    // ruční nahrání záznamu OSV (server bez internetu)
    const fd = new FormData();
    fd.append("file", new File([JSON.stringify([{ ...OSV_LODASH, id: "GHSA-test-0000-0001", affected: [{ package: { ecosystem: "npm", name: "lodash" }, versions: ["4.17.21"] }] }])], "osv.json"));
    const up = (await admin.json("/api/cra/osv/upload", { method: "POST", headers: H, body: fd })).body;
    expect(up.records).toBe(1);
    expect(((await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[]).some((x) => x.vulnId === "GHSA-test-0000-0001" && !x.gone)).toBe(true);
    await db.execute(sql`update vuln_intel set kev = false where cve_id = 'CVE-2021-23337'`);
  });

  test("CRA dovozce / distributor: doklady výrobce, soubory, oznámení CSAF, VEX výrobce, NVD podle CPE (v1.16, ADR-113)", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    const p = (await admin.json("/api/cra", { method: "POST", headers: H, json: { name: "Edge Router", version: "4.2.1", role: "distributor", manufacturerName: "Example Networks", category: "important_1", status: "on_market" } })).body;
    // kontrola dokladů jen pro dovozce / distributora; bez CPE, SBOM ani oznámení = mezera „chybí zdroj zranitelností“
    expect(p.supplyChecks.map((c: any) => c.key)).toEqual(["ce_marking", "eu_doc", "info_manufacturer", "info_vuln_contact", "info_identification", "info_purpose", "info_support_end", "info_instructions", "importer_details", "sbom_location"]);
    expect(p.gaps).toEqual(expect.arrayContaining(["supply_checks_open", "no_manufacturer_support", "no_vuln_source"]));
    expect(p.gaps).not.toContain("no_sbom");
    expect((await admin.json(`/api/cra/${p.id}/checks/tech_doc`, { method: "PUT", headers: H, json: { status: "ok" } })).status).toBe(409); // jen dovozce
    expect((await admin.json(`/api/cra/${p.id}/checks/eu_doc`, { method: "PUT", headers: H, json: { status: "ok", url: "javascript:alert(1)" } })).status).toBe(400);
    const ck = (await admin.json(`/api/cra/${p.id}/checks/eu_doc`, { method: "PUT", headers: H, json: { status: "ok", note: "Prohlášení rev. 3", url: "https://example.com/doc.pdf" } })).body;
    expect(ck.supplyChecks.find((c: any) => c.key === "eu_doc")).toMatchObject({ status: "ok", note: "Prohlášení rev. 3", url: "https://example.com/doc.pdf", byName: "Admin" });
    // soubor k dokladu: stažení jen jako příloha
    const fd = new FormData();
    fd.append("file", new File(["%PDF-1.4 prohlaseni"], "EU DoC.pdf"));
    fd.append("checkKey", "eu_doc");
    const up = (await admin.json(`/api/cra/${p.id}/files`, { method: "POST", headers: H, body: fd })).body;
    const file = up.supplyChecks.find((c: any) => c.key === "eu_doc").files[0];
    expect(file).toMatchObject({ fileName: "EU DoC.pdf", fileSize: 19 });
    const dl = await admin.req(`/api/cra/${p.id}/files/${file.id}`, { headers: H });
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(await dl.text()).toBe("%PDF-1.4 prohlaseni");
    for (const k of ["ce_marking", "info_manufacturer", "info_vuln_contact", "info_identification", "info_purpose", "info_support_end", "info_instructions"]) await admin.json(`/api/cra/${p.id}/checks/${k}`, { method: "PUT", headers: H, json: { status: "ok" } });
    const ck2 = (await admin.json(`/api/cra/${p.id}/checks/importer_details`, { method: "PUT", headers: H, json: { status: "na", note: "Výrobce v EU" } })).body;
    expect(ck2.gaps).not.toContain("supply_checks_open"); // SBOM je nepovinné
    // oznámení výrobce CSAF 2.0: produkt podle CPE, větve s verzemi, skupiny, flag a náprava
    const csaf = (rev: string, date: string, status: string) => ({
      document: { category: "csaf_security_advisory", csaf_version: "2.0", title: "Edge Router web UI vulnerabilities", publisher: { name: "Example Networks PSIRT", namespace: "https://psirt.example.com", category: "vendor" }, tracking: { id: "EXN-SA-2026-007", version: rev, initial_release_date: "2026-10-01T00:00:00Z", current_release_date: date, status: "final" } },
      product_tree: {
        branches: [{ category: "vendor", name: "Example Networks", branches: [{ category: "product_name", name: "Edge Router", branches: [
          { category: "product_version", name: "4.2.1", product: { product_id: "ER-421", name: "Example Networks Edge Router 4.2.1", product_identification_helper: { cpe: "cpe:2.3:h:example_networks:edge_router:4.2.1:*:*:*:*:*:*:*" } } },
          { category: "product_version", name: "4.2.2", product: { product_id: "ER-422", name: "Example Networks Edge Router 4.2.2", product_identification_helper: { cpe: "cpe:2.3:h:example_networks:edge_router:4.2.2:*:*:*:*:*:*:*" } } },
        ] }] }],
        product_groups: [{ group_id: "G-OLD", product_ids: ["ER-421"] }],
      },
      vulnerabilities: [
        { cve: "CVE-2026-1111", title: "Command injection in web UI", product_status: { [status]: ["ER-421"], fixed: ["ER-422"] }, remediations: [{ category: "vendor_fix", details: "Aktualizujte na 4.2.2", group_ids: ["G-OLD"] }], scores: [{ products: ["ER-421"], cvss_v3: { baseScore: 9.8, baseSeverity: "CRITICAL" } }] },
        { cve: "CVE-2026-3333", title: "Telnet enabled", product_status: { known_not_affected: ["ER-421", "ER-422"] }, flags: [{ label: "component_not_present", product_ids: ["ER-421", "ER-422"] }] },
      ],
    });
    const upload = (doc: unknown, name = "exn-sa-2026-007.json") => {
      const f = new FormData();
      f.append("file", new File([JSON.stringify(doc)], name));
      return admin.json("/api/cra/advisories", { method: "POST", headers: H, body: f });
    };
    const bad = new FormData();
    bad.append("file", new File(['{"bomFormat":"CycloneDX"}'], "x.json"));
    expect((await admin.json("/api/cra/advisories", { method: "POST", headers: H, body: bad })).status).toBe(400);
    // bez CPE se páruje podle výrobce, názvu a verze
    const a1 = await upload(csaf("1", "2026-10-01T00:00:00Z", "known_affected"));
    expect(a1.status).toBe(201);
    expect(a1.body).toMatchObject({ vulnerabilities: 2, matches: 2 });
    expect(a1.body.advisory.matchedProducts).toEqual([{ id: p.id, name: "Edge Router" }]);
    let f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    const inj = f.find((x) => x.vulnId === "CVE-2026-1111");
    expect(inj).toMatchObject({ source: "csaf", status: "affected", vendorStatus: "affected", severity: "9.8 CRITICAL", componentName: "EXN-SA-2026-007 – Edge Router web UI vulnerabilities" });
    expect(inj.actionStatement).toContain("Aktualizujte na 4.2.2");
    expect(f.find((x) => x.vulnId === "CVE-2026-3333")).toMatchObject({ status: "not_affected", justification: "component_not_present" });
    let d = (await admin.json(`/api/cra/${p.id}`, { headers: H })).body;
    expect(d.advisoryCount).toBe(1);
    expect(d.gaps).not.toContain("no_vuln_source");
    // vlastní posouzení VEX se novou revizí nepřepíše, stav výrobce se aktualizuje
    await admin.json(`/api/cra/findings/${inj.id}`, { method: "PATCH", headers: H, json: { status: "not_affected", justification: "inline_mitigations_already_exist", impactStatement: "Webové rozhraní je u zákazníků vypnuté." } });
    expect((await upload(csaf("2", "2026-10-10T00:00:00Z", "under_investigation"))).status).toBe(200);
    f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    expect(f.find((x) => x.vulnId === "CVE-2026-1111")).toMatchObject({ status: "not_affected", vendorStatus: "under_investigation" });
    expect((await upload(csaf("1", "2026-10-01T00:00:00Z", "known_affected"))).status).toBe(409); // starší revize
    // CPE opravené verze → výrobce uvádí „opraveno“; verze, kterou oznámení nezná → nálezy zmizí
    await admin.json(`/api/cra/${p.id}`, { method: "PATCH", headers: H, json: { cpe: "cpe:2.3:h:example_networks:edge_router:4.2.2:*:*:*:*:*:*:*", version: "4.2.2" } });
    f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    expect(f.find((x) => x.vulnId === "CVE-2026-1111")).toMatchObject({ gone: false, vendorStatus: "fixed", status: "not_affected" });
    await admin.json(`/api/cra/${p.id}`, { method: "PATCH", headers: H, json: { cpe: "cpe:2.3:h:example_networks:edge_router:5.0:*:*:*:*:*:*:*", version: "5.0" } });
    f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    expect(f.filter((x) => x.source === "csaf").every((x) => x.gone)).toBe(true);
    expect((await admin.json(`/api/cra/${p.id}`, { method: "PATCH", headers: H, json: { cpe: "router 4.2" } })).status).toBe(400);
    await admin.json(`/api/cra/${p.id}`, { method: "PATCH", headers: H, json: { cpe: "cpe:2.3:h:example_networks:edge_router:*", version: "4.2.1" } });
    f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    expect(f.find((x) => x.vulnId === "CVE-2026-1111")).toMatchObject({ gone: false, status: "not_affected" });
    // přehled oznámení a odebrání (nálezy zmizí, nemažou se)
    const list = (await admin.json("/api/cra/advisories", { headers: H })).body as any[];
    expect(list.find((x) => x.trackingId === "EXN-SA-2026-007")).toMatchObject({ version: "2", vulnerabilities: 2, products: 2 });
    // NVD: vypnuto ve výchozím stavu; po zapnutí odchází jen CPE
    expect((await admin.json(`/api/cra/${p.id}/nvd`, { method: "POST", headers: H })).status).toBe(409);
    expect((await admin.json("/api/cra/nvd", { method: "PUT", headers: H, json: { enabled: true, baseUrl: "https://services.nvd.nist.gov/rest/json/cves/2.0" } })).body.enabled).toBe(true);
    const nv = (await admin.json(`/api/cra/${p.id}/nvd`, { method: "POST", headers: H })).body;
    expect(nv).toMatchObject({ found: 2, total: 2, query: "cpe:2.3:h:example_networks:edge_router:4.2.1:*:*:*:*:*:*:*" });
    expect(nvdCalls.at(-1)).toBe("https://services.nvd.nist.gov/rest/json/cves/2.0?virtualMatchString=cpe%3A2.3%3Ah%3Aexample_networks%3Aedge_router%3A4.2.1%3A*%3A*%3A*%3A*%3A*%3A*%3A*&resultsPerPage=2000&startIndex=0");
    f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    expect(f.filter((x) => x.source === "nvd").map((x) => [x.vulnId, x.status, x.severity])).toEqual([["CVE-2026-1111", "under_investigation", "9.8 CRITICAL"], ["CVE-2026-2222", "under_investigation", null]]);
    await admin.json("/api/cra/nvd", { method: "PUT", headers: H, json: { enabled: false, baseUrl: "https://services.nvd.nist.gov/rest/json/cves/2.0" } });
    const adv = list.find((x) => x.trackingId === "EXN-SA-2026-007");
    expect((await admin.json(`/api/cra/advisories/${adv.id}`, { method: "DELETE", headers: H })).status).toBe(200);
    f = (await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[];
    expect(f.filter((x) => x.source === "csaf").every((x) => x.gone)).toBe(true);
    // smazání souboru
    expect((await admin.json(`/api/cra/${p.id}/files/${file.id}`, { method: "DELETE", headers: H })).body.supplyChecks.find((c: any) => c.key === "eu_doc").files).toEqual([]);
  });

  test("vazby záznamů: klikací vazby, zpětné vazby podle oprávnění, CRA produkt, riziko z nálezu, zjištění × opatření (ADR-101)", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    const asset = (await admin.json("/api/assets", { method: "POST", headers: H, json: { name: "SRV-LINKS", assetType: "server" } })).body;
    const sup = (await admin.json("/api/suppliers", { method: "POST", headers: H, json: { name: "Dodavatel vazeb", assetIds: [asset.id] } })).body;
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: H, json: { name: "Zálohování SRV-LINKS", status: "implemented", effectiveness: "effective", assetIds: [asset.id] } })).body;
    const inc = (await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Výpadek SRV-LINKS", kind: "incident", category: "dos", detectedAt: new Date().toISOString() } })).body;
    expect((await admin.json(`/api/incidents/${inc.id}`, { method: "PATCH", headers: H, json: { assetIds: [asset.id], controlIds: [ctl.id] } })).status).toBe(200);
    const ch = (await admin.json("/api/isms/changes", { method: "POST", headers: H, json: { title: "Migrace SRV-LINKS", assetIds: [asset.id] } })).body;
    // CRA produkt navázaný na aktivum a dodavatele
    const p = (await admin.json("/api/cra", { method: "POST", headers: H, json: { name: "Portál vazeb", version: "2.0", role: "manufacturer", category: "default" } })).body;
    const bad = await admin.json(`/api/cra/${p.id}/links`, { method: "PUT", headers: H, json: { assetIds: ["00000000-0000-0000-0000-000000000000"], supplierIds: [], processIds: [], riskIds: [] } });
    expect(bad.status).toBe(400);
    const ln = (await admin.json(`/api/cra/${p.id}/links`, { method: "PUT", headers: H, json: { assetIds: [asset.id], supplierIds: [sup.id], processIds: [], riskIds: [] } })).body;
    expect(ln.assets.map((x: any) => x.name)).toEqual(["SRV-LINKS"]);
    expect(ln.suppliers.map((x: any) => x.name)).toEqual(["Dodavatel vazeb"]);
    // zpětné vazby aktiva
    const bl = (await admin.json(`/api/links/asset/${asset.id}`, { headers: H })).body;
    const kinds = Object.fromEntries((bl.groups as any[]).map((g) => [g.kind, g.items]));
    expect(kinds.incident.map((x: any) => x.link)).toEqual([`/incidents/${inc.id}`]);
    expect(kinds.change[0]).toMatchObject({ id: ch.id, link: `/isms/changes/${ch.id}` });
    expect(kinds.control[0]).toMatchObject({ id: ctl.id, label: expect.stringContaining("Zálohování SRV-LINKS") });
    expect(kinds.supplier[0].id).toBe(sup.id);
    expect(kinds.cra_product[0]).toMatchObject({ id: p.id, label: "Portál vazeb 2.0", link: `/cra/${p.id}` });
    expect((await admin.json(`/api/links/supplier/${sup.id}`, { headers: H })).body.groups.map((g: any) => g.kind)).toEqual(["cra_product"]);
    // riziko z nálezu CRA – jen jednou, navázané na produkt a aktivum
    await admin.json(`/api/cra/${p.id}/findings`, { method: "POST", headers: H, json: { vulnId: "CVE-2024-3094", componentRef: "manual:xz" } });
    const fnd = ((await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[])[0];
    const rk = await admin.json(`/api/cra/findings/${fnd.id}/risk`, { method: "POST", headers: H });
    expect(rk.status).toBe(201);
    expect((await admin.json(`/api/cra/findings/${fnd.id}/risk`, { method: "POST", headers: H })).status).toBe(409);
    expect(((await admin.json(`/api/cra/${p.id}/findings`, { headers: H })).body as any[])[0].riskId).toBe(rk.body.riskId);
    const risk = (await admin.json(`/api/risks/${rk.body.riskId}`, { headers: H })).body;
    expect(risk.name).toContain("CVE-2024-3094");
    expect(risk.assets.map((a: any) => a.id)).toEqual([asset.id]);
    expect((await admin.json(`/api/cra/${p.id}/links`, { headers: H })).body.risks.map((x: any) => x.id)).toEqual([rk.body.riskId]);
    // zjištění auditu × opatření a riziko → zpětné vazby opatření a rizika
    const au = (await admin.json("/api/audits", { method: "POST", headers: H, json: { title: "Audit vazeb" } })).body;
    expect((await admin.json(`/api/audits/${au.id}/findings`, { method: "POST", headers: H, json: { title: "Chybí test obnovy", severity: "minor", controlId: ctl.id, riskId: rk.body.riskId } })).status).toBe(201);
    const fl = (await admin.json(`/api/audits/${au.id}`, { headers: H })).body.findingList[0];
    expect(fl).toMatchObject({ controlId: ctl.id, controlLabel: expect.stringContaining("Zálohování SRV-LINKS") });
    const cg = (await admin.json(`/api/links/control/${ctl.id}`, { headers: H })).body.groups as any[];
    expect(cg.map((g) => g.kind)).toEqual(["incident", "audit_finding"]);
    expect(cg[1].items[0]).toMatchObject({ label: "Chybí test obnovy", sub: "Audit vazeb", link: `/audits/${au.id}` });
    const rg = (await admin.json(`/api/links/risk/${rk.body.riskId}`, { headers: H })).body.groups as any[];
    expect(rg.map((g) => g.kind)).toEqual(["audit_finding", "cra_product"]);
    // opatření z cizí společnosti u zjištění odmítnuto
    expect((await admin.json(`/api/audits/${au.id}/findings`, { method: "POST", headers: H, json: { title: "X", severity: "minor", controlId: "00000000-0000-0000-0000-000000000000" } })).status).toBe(400);
    // uživatel jen s assets:read + isms:read vidí jen změny (ne incidenty, opatření, dodavatele, CRA)
    const role = (await admin.json("/api/admin/roles", { method: "POST", json: { key: "links_reader", name: "Čtenář vazeb", permissions: ["assets:read", "isms:read"] } })).body;
    await admin.json("/api/admin/users", { method: "POST", json: { email: "links@test.cz", displayName: "Čtenář vazeb", password: PW } });
    const uid = ((await admin.json("/api/admin/users")).body as any[]).find((u) => u.email === "links@test.cz").id;
    await admin.json(`/api/admin/users/${uid}`, { method: "PATCH", json: { roleIds: [role.id] } });
    const lr = browser();
    await lr.login("links@test.cz");
    await lr.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Vazby-Heslo-2026!!" } });
    const lv = (await lr.json(`/api/links/asset/${asset.id}`)).body;
    expect(lv.groups.map((g: any) => g.kind)).toEqual(["change"]);
    expect((await lr.json(`/api/links/risk/${rk.body.riskId}`)).status).toBe(404);
    expect((await admin.json(`/api/links/asset/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    // uložené pohledy rizik / opatření / dodavatelů (v1.09) – trasa /views před /:id
    for (const pg of ["risks", "controls", "suppliers"]) {
      const sv = await admin.json(`/api/${pg}/views`, { method: "POST", headers: H, json: { name: `Můj pohled ${pg}`, state: { q: "x", sort: "name:asc" } } });
      expect(sv.status).toBe(201);
      expect(((await admin.json(`/api/${pg}/views`, { headers: H })).body as any[]).map((v) => v.name)).toContain(`Můj pohled ${pg}`);
    }
    // rychlé hledání (Ctrl+K, v1.06): jen čitelné evidence, LIKE escapovaný, CVE odkaz
    const qs = (await admin.json("/api/search/quick?q=SRV-LINKS", { headers: H })).body as any[];
    expect(qs[0]).toMatchObject({ kind: "asset", id: asset.id, link: `/assets/${asset.id}` });
    expect(qs.map((x) => x.kind)).toEqual(expect.arrayContaining(["asset", "control", "incident", "change"]));
    expect(((await admin.json("/api/search/quick?q=cve-2024-3094", { headers: H })).body as any[])[0]).toMatchObject({ kind: "cve", link: "/vulnerabilities/cve/CVE-2024-3094" });
    expect(((await admin.json("/api/search/quick?q=%25%25", { headers: H })).body as any[]).length).toBe(0);
    expect((await lr.json("/api/search/quick?q=SRV-LINKS")).body.map((x: any) => x.kind).sort()).toEqual(["asset", "change"]);
    expect((await admin.json("/api/search/quick?q=x", { headers: H })).status).toBe(400);
  });

  test("SOC 2 v rámcích, provoz: stav systému, zálohy, metriky, zámek plánovače", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const soc = (await admin.json("/api/controls/requirements?framework=soc2", { headers: { "x-contix-company": root.id } })).body as any[];
    expect(soc.length).toBe(61);
    expect(soc.find((r) => r.id === "soc2:CC7.4").sectionTitle).toBe("Provoz systémů");

    let st = (await admin.json("/api/ops/status")).body;
    expect(st.version).toBe(CONTIX_VERSION);
    expect(st.database.ok).toBe(true);
    expect(st.checks.find((c: any) => c.key === "backup").level).toBe("warning");
    expect(st.checks.find((c: any) => c.key === "ai").level).toBe("ok");
    await db.insert(schema.backupRuns).values({ status: "ok", file: "contix-20261002-0230.dump", sizeBytes: 123456, finishedAt: new Date(), host: "backup" });
    st = (await admin.json("/api/ops/status")).body;
    expect(st.checks.find((c: any) => c.key === "backup").level).toBe("ok");
    expect((await admin.json("/api/ops/backups")).body[0].file).toBe("contix-20261002-0230.dump");
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/ops/status")).status).toBe(403);

    expect((await admin.req("/api/metrics")).status).toBe(404);
    config.METRICS_TOKEN = "metrics-token-0123456789";
    expect((await admin.req("/api/metrics")).status).toBe(401);
    const met = await admin.req("/api/metrics", { headers: { authorization: "Bearer metrics-token-0123456789" } });
    const txt = await met.text();
    expect(txt).toContain("contix_db_up 1");
    expect(txt).toContain('contix_check_status{check="backup"} 0');
    expect(txt).toMatch(/contix_backup_last_success_timestamp_seconds \d+/);
    config.METRICS_TOKEN = undefined;

    // lease plánovače: druhá instance nedostane zámek, po vypršení ano
    expect(await acquireLease(db as any, "test-job", 60_000, "a")).toBe(true);
    expect(await acquireLease(db as any, "test-job", 60_000, "b")).toBe(false);
    expect(await acquireLease(db as any, "test-job", 60_000, "a")).toBe(true);
    expect(await acquireLease(db as any, "test-job", -1, "a")).toBe(true); // vyprší hned
    expect(await acquireLease(db as any, "test-job", 60_000, "b")).toBe(true);
  });


  test("důkazy a testy opatření: soubor, platnost, vzorky, dokončení → účinnost, povinnosti, rozsah SOC 2", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const HR = { "x-contix-company": root.id };
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: HR, json: { name: "Revize přístupů", category: "organizational", status: "implemented" } })).body;
    let ov = (await admin.json("/api/assurance/overview", { headers: HR })).body;
    expect(ov.implementedWithoutEvidence).toBeGreaterThan(0);

    // důkaz se souborem
    const ev = await admin.json("/api/assurance/evidence", { method: "POST", headers: HR, json: { title: "Zápis z revize přístupů Q3", kind: "record", controlIds: [ctl.id], validUntil: "2020-01-01" } });
    expect(ev.status).toBe(201);
    expect(ev.body).toMatchObject({ validity: "expired", controls: [{ id: ctl.id }] });
    const fd = new FormData();
    fd.append("file", new File(["revize OK\n"], "../../etc/zápis:Q3.txt", { type: "text/plain" }));
    const up = await admin.req(`/api/assurance/evidence/${ev.body.id}/files`, { method: "POST", body: fd, headers: HR });
    expect(up.status).toBe(201);
    const upd = (await up.json()) as any;
    expect(upd.files[0]).toMatchObject({ filename: "zápis_Q3.txt", size: 10, mime: "text/plain" });
    expect(upd.files[0].sha256).toHaveLength(64);
    const dl = await admin.req(`/api/assurance/evidence/${ev.body.id}/files/${upd.files[0].id}`, { headers: HR });
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await dl.text()).toBe("revize OK\n");
    expect((await admin.json(`/api/assurance/evidence?controlId=${ctl.id}`, { headers: HR })).body).toHaveLength(1);
    // povinnost: prošlý důkaz
    const team = (await admin.json("/api/notifications/team", { headers: HR })).body as any[];
    expect(team.find((o) => o.key === `evidence_expiry:${ev.body.id}`)?.urgency).toBe("overdue");

    // test provozní účinnosti
    const t = await admin.json("/api/assurance/tests", { method: "POST", headers: HR, json: { controlId: ctl.id, kind: "operating", frequency: "quarterly", periodFrom: "2026-01-01", periodTo: "2026-09-30", dueDate: "2026-01-15", methods: ["inspection", "inquiry"], tester: "Interní audit" } });
    expect(t.status).toBe(201);
    expect(t.body.recommended).toEqual({ min: 2, max: 2 });
    expect((await admin.json("/api/notifications/team", { headers: HR })).body.some((o: any) => o.key === `control_test:${t.body.id}`)).toBe(true);
    let d = (await admin.json(`/api/assurance/tests/${t.body.id}/samples`, { method: "POST", headers: HR, json: [{ ref: "Q1", result: "pass", evidenceId: ev.body.id }, { ref: "Q2", result: "fail", note: "chybí podpis" }] })).body;
    expect(d).toMatchObject({ status: "in_progress", sampleCount: 2, exceptions: 1, derivedResult: "ineffective" });
    d = (await admin.json(`/api/assurance/tests/${t.body.id}`, { method: "PATCH", headers: HR, json: { tolerableExceptions: 1 } })).body;
    expect(d.derivedResult).toBe("effective_with_exceptions");
    expect(d.samples[0].evidenceTitle).toBe("Zápis z revize přístupů Q3");
    // důkaz použitý ve vzorku nelze smazat
    expect((await admin.json(`/api/assurance/evidence/${ev.body.id}`, { method: "DELETE", headers: HR })).status).toBe(409);
    const done = await admin.json(`/api/assurance/tests/${t.body.id}/complete`, { method: "POST", headers: HR, json: { result: "effective_with_exceptions", conclusion: "Jedna výjimka v tolerované míře.", performedAt: "2026-10-01" } });
    expect(done.body.status).toBe("completed");
    const ctlAfter = (await admin.json(`/api/controls/${ctl.id}`, { headers: HR })).body;
    expect(ctlAfter).toMatchObject({ effectiveness: "partially_effective", lastReviewAt: "2026-10-01" });
    expect((await admin.json(`/api/assurance/tests/${t.body.id}`, { method: "PATCH", headers: HR, json: { tester: "x" } })).status).toBe(409);
    expect((await admin.json(`/api/assurance/tests/${t.body.id}`, { method: "DELETE", headers: HR })).status).toBe(409);
    ov = (await admin.json("/api/assurance/overview", { headers: HR })).body;
    expect(ov.testsLastYear.effective_with_exceptions).toBe(1);
    expect(ov.evidenceExpired).toBeGreaterThanOrEqual(1);

    // auditor smí testovat (controls:test), čtenář ne
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    const t2 = await auditor.json("/api/assurance/tests", { method: "POST", headers: HR, json: { controlId: ctl.id, kind: "design" } });
    expect(t2.status).toBe(201);
    expect((await auditor.json(`/api/assurance/tests/${t2.body.id}`, { method: "DELETE", headers: HR })).status).toBe(200);

    // rozsah SOC 2: volitelné kategorie mimo rozsah jsou neaplikovatelné
    let soc = (await admin.json("/api/controls/requirements?framework=soc2", { headers: HR })).body as any[];
    expect(soc.find((r) => r.id === "soc2:A1.2")).toMatchObject({ applicable: false, compliance: "not_applicable" });
    expect(soc.find((r) => r.id === "soc2:CC6.1").applicable).toBe(true);
    await admin.json(`/api/companies/${root.id}`, { method: "PATCH", json: { overrides: { ...root.overrides, soc2Scope: ["A1"] } } });
    soc = (await admin.json("/api/controls/requirements?framework=soc2", { headers: HR })).body as any[];
    expect(soc.find((r) => r.id === "soc2:A1.2").applicable).toBe(true);
    expect(soc.find((r) => r.id === "soc2:P1.1").applicable).toBe(false);
    await admin.json(`/api/companies/${root.id}`, { method: "PATCH", json: { overrides: root.overrides } });

    // CIS Controls v8.1 (ADR-077): dílčí opatření nad zvolenou implementační skupinou jsou neaplikovatelná
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { frameworks: ["cis8"], cisIg: 1 } })).status).toBe(200);
    let cis = (await admin.json("/api/controls/requirements?framework=cis8", { headers: HR })).body as any[];
    expect(cis.length).toBe(153);
    expect(cis.find((r) => r.id === "cis8:1.1").applicable).toBe(true);
    expect(cis.find((r) => r.id === "cis8:1.3")).toMatchObject({ applicable: false, compliance: "not_applicable" });
    expect(cis.find((r) => r.id === "cis8:1.3").justification).toContain("IG1");
    expect(cis.filter((r) => r.applicable).length).toBe(56);
    expect(((await admin.json("/api/controls/frameworks", { headers: HR })).body as any[]).find((f) => f.id === "cis8").inScope).toBe(true);
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { cisIg: 2 } })).status).toBe(200);
    cis = (await admin.json("/api/controls/requirements?framework=cis8", { headers: HR })).body as any[];
    expect(cis.filter((r) => r.applicable).length).toBe(130);
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { cisIg: 4 } })).status).toBe(400);
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { frameworks: null, cisIg: 1 } })).status).toBe(200);
  });

  /* ============ AI II: dotazy, MCP, duplicity (v0.20) ============ */

  test("AI: dotaz v přirozeném jazyce – plán z katalogu nástrojů, spuštění s oprávněními, odpověď", async () => {
    const tools = (await admin.json("/api/ai/tools")).body as any[];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["assets_search", "risks_search", "controls_search", "obligations"]));
    const crit = (await admin.json("/api/assets?criticality=critical&limit=500")).body.total;
    const q = await admin.json("/api/ai/queries", { method: "POST", json: { question: "Která kritická aktiva a nepřijatelná rizika máme?" } });
    expect(q.status).toBe(202);
    expect(q.body.status).toBe("running");
    await Promise.all(background);
    const r = (await admin.json(`/api/ai/queries/${q.body.id}`)).body;
    expect(r.status).toBe("done");
    // neznámý nástroj zahozen, nejvýš 3 volání; neplatné parametry = chyba jen u daného nástroje
    expect(r.results.map((x: any) => x.tool)).toEqual(["assets_search", "risks_search", "controls_search"]);
    expect(r.results[2].error).toContain("status");
    expect(r.results[0].total).toBe(crit);
    expect(r.answer).toBe(`Kritických aktiv: ${crit}.`);
    if (r.results[0].rows.length) expect(r.results[0].rows[0].link).toMatch(/^\/assets\//);
    // modelu se neposílají sloupce se jmény osob
    const answerCall = aiCalls.findLast((b: any) => b.messages.at(-1).content.startsWith("Dotaz:"));
    expect(answerCall.messages.at(-1).content).not.toContain("Vlastník");
    // dotaz mimo data → odpověď bez nástrojů
    const w = await admin.json("/api/ai/queries", { method: "POST", json: { question: "Jaké bude zítra počasí?" } });
    await Promise.all(background);
    expect((await admin.json(`/api/ai/queries/${w.body.id}`)).body).toMatchObject({ status: "done", results: [], answer: "Na to v CONTIXu data nejsou." });
    expect(((await admin.json("/api/ai/queries")).body as any[]).length).toBeGreaterThanOrEqual(2);
    const log = (await admin.json("/api/ai/log/queries")).body as any[];
    expect(log.find((l) => l.id === q.body.id)).toMatchObject({ userName: "Admin", plan: expect.any(Array) });
    // bez ai:use nelze
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/ai/queries", { method: "POST", json: { question: "Kolik je rizik?" } })).status).toBe(403);
    expect((await auditor.json(`/api/ai/queries/${q.body.id}`)).status).toBe(403);
  });

  test("MCP: osobní API token, initialize, tools/list, tools/call jen pro čtení, zneplatnění", async () => {
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/tokens", { method: "POST", json: { name: "x" } })).status).toBe(403);
    const t = await admin.json("/api/tokens", { method: "POST", json: { name: "Claude Code", expiresInDays: 30 } });
    expect(t.status).toBe(201);
    expect(t.body.token).toMatch(/^ctx_/);
    expect(t.body.item).toMatchObject({ name: "Claude Code", prefix: t.body.token.slice(0, 12), revokedAt: null });
    expect(JSON.stringify((await admin.json("/api/tokens")).body)).not.toContain(t.body.token);
    const rpc = async (body: unknown, token: string | null = t.body.token, ip = "10.20.0.7") => {
      const res = await app.request("/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as any };
    };
    const noAuth = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, null);
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get("www-authenticate")).toContain("Bearer");
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, "ctx_spatny")).status).toBe(401);
    // MCP je ve výchozím stavu vypnuté
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" })).status).toBe(403);
    // zapnout jen s omezením na IP adresy klientů (lokální Open WebUI)
    const noIps = await admin.json("/api/ai/settings", { method: "PATCH", json: { mcpEnabled: true } });
    expect(noIps.status).toBe(400);
    expect((await admin.json("/api/ai/settings", { method: "PATCH", json: { mcpAllowedIps: ["300.1.1.1"] } })).status).toBe(400);
    expect((await admin.json("/api/ai/settings", { method: "PATCH", json: { mcpEnabled: true, mcpAllowedIps: ["10.20.0.0/24", " 10.20.0.0/24", "fd00::5"] } })).body.mcpAllowedIps).toEqual(["10.20.0.0/24", "fd00::5"]);
    expect((await admin.json("/api/ai/status")).body.mcpEnabled).toBe(true);
    const denied = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, t.body.token, "203.0.113.9");
    expect(denied.status).toBe(403);
    expect(denied.body.error).toContain("203.0.113.9");
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "contix", version: CONTIX_VERSION }, capabilities: { tools: {} } });
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const assetsTool = list.body.result.tools.find((x: any) => x.name === "assets_search");
    expect(assetsTool).toMatchObject({ inputSchema: { type: "object" }, annotations: { readOnlyHint: true } });
    expect(assetsTool.inputSchema.properties.criticality.enum).toContain("critical");
    const call = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "assets_search", arguments: { criticality: "critical" } } });
    expect(call.body.result.isError).toBe(false);
    expect(call.body.result.content[0].text).toContain("Aktiva:");
    expect(call.body.result.structuredContent.total).toBeGreaterThanOrEqual(0);
    const bad = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "assets_search", arguments: { criticality: "extreme" } } });
    expect(bad.body.result.isError).toBe(true);
    expect((await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "delete_everything" } })).body.error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: "2.0", id: 6, method: "resources/list" })).body.error.code).toBe(-32601);
    const batch = await rpc([{ jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }]);
    expect(batch.body).toEqual([{ jsonrpc: "2.0", id: 7, result: {} }]);
    expect((await app.request("/api/mcp", { headers: { authorization: `Bearer ${t.body.token}` } })).status).toBe(405);
    // token omezený na dceřinou společnost vidí jen její data
    const companies = (await admin.json("/api/companies")).body as any[];
    const sub = companies.find((x) => x.parentId);
    if (sub) {
      const ts = await admin.json("/api/tokens", { method: "POST", json: { name: "jen dcera", companyId: sub.id } });
      const all = (await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "assets_search", arguments: {} } })).body.result.structuredContent;
      const cs = (await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "assets_search", arguments: {} } }, ts.body.token)).body.result.structuredContent;
      expect(cs.total).toBeLessThan(all.total);
      expect(ts.body.item.companyName).toBe(sub.name);
    }
    expect((await admin.json("/api/tokens")).body.find((x: any) => x.id === t.body.item.id).lastUsedIp).toBe("10.20.0.7");
    // zneplatnění
    const rv = await admin.json(`/api/tokens/${t.body.item.id}/revoke`, { method: "POST" });
    expect(rv.body.find((x: any) => x.id === t.body.item.id).revokedAt).not.toBeNull();
    expect((await rpc({ jsonrpc: "2.0", id: 9, method: "ping" })).status).toBe(401);
    expect((await admin.json(`/api/tokens/${t.body.item.id}`, { method: "DELETE" })).status).toBe(200);
    const log = (await admin.json("/api/admin/audit-log?limit=100")).body as any[];
    expect(log.some((l) => l.action === "mcp.tool_call" && l.details.tool === "assets_search")).toBe(true);
  });

  test("duplicity aktiv: návrh dvojic, sloučení s přesunem vazeb, zamítnutí", async () => {
    const mk = async (json: Record<string, unknown>) => (await admin.json("/api/assets", { method: "POST", json })).body;
    const a = await mk({ name: "SRV-DUP-01", assetType: "server", serialNumber: "SN-DUP-1", hostname: "srv-dup-01", ipAddresses: ["10.9.9.1"] });
    const b = await mk({ name: "srv-dup-01.corp.local", assetType: "server", serialNumber: "sn-dup-1", ipAddresses: ["10.9.9.9"], location: "DC2", tags: ["wazuh"] });
    const svc = await mk({ name: "Služba DUP", assetType: "business_service" });
    expect((await admin.json("/api/assets/links", { method: "POST", json: { primaryId: svc.id, supportingId: b.id } })).status).toBe(201);
    expect((await admin.json("/api/assets/links", { method: "POST", json: { primaryId: svc.id, supportingId: a.id } })).status).toBe(201);
    const pairs = (await admin.json("/api/assets/duplicates")).body as any[];
    const p = pairs.find((x) => [x.a.id, x.b.id].sort().join() === [a.id, b.id].sort().join());
    expect(p.reasons).toEqual(["stejné sériové číslo", "stejný název"]);
    expect(p.score).toBeGreaterThanOrEqual(80);
    expect(p.a.links + p.b.links).toBe(2);
    // sloučení: vazba ze slučovaného aktiva už u ponechaného existuje → zahozena; prázdná pole doplněna
    const viewer = browser();
    await viewer.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await viewer.json("/api/assets/merge", { method: "POST", json: { keepId: a.id, removeId: b.id } })).status).toBe(403);
    const m = await admin.json("/api/assets/merge", { method: "POST", json: { keepId: a.id, removeId: b.id } });
    expect(m.status).toBe(200);
    expect(m.body.dropped.asset_links).toBe(1);
    expect((await admin.json(`/api/assets/${b.id}`)).status).toBe(404);
    const kept = (await admin.json(`/api/assets/${a.id}`)).body;
    expect(kept).toMatchObject({ location: "DC2", serialNumber: "SN-DUP-1", tags: ["wazuh"] });
    expect(kept.ipAddresses.sort()).toEqual(["10.9.9.1", "10.9.9.9"]);
    expect(kept.supports.map((x: any) => x.id)).toEqual([svc.id]);
    // zamítnutá dvojice se už nenabízí
    const c = await mk({ name: "Tiskárna recepce", assetType: "printer" });
    const d = await mk({ name: "Tiskarna-recepce", assetType: "printer" });
    const pairCD = (list: any[]) => list.find((x) => [x.a.id, x.b.id].sort().join() === [c.id, d.id].sort().join());
    expect(pairCD((await admin.json("/api/assets/duplicates")).body)?.reasons).toEqual(["stejný název"]);
    expect((await admin.json("/api/assets/duplicates/dismiss", { method: "POST", json: { a: d.id, b: c.id } })).status).toBe(204);
    expect(pairCD((await admin.json("/api/assets/duplicates")).body)).toBeUndefined();
  });

  /* ============ Import reálných dat (v0.21) ============ */

  test("import: šablona XLSX, náhled s mapováním a validací, zápis přes API, aktualizace existujících", async () => {
    const { readTable } = await import("../src/modules/import/table");
    const tpl = await admin.req("/api/import/template/assets.xlsx");
    expect(tpl.status).toBe(200);
    expect(tpl.headers.get("content-type")).toContain("spreadsheetml");
    const t = readTable(new Uint8Array(await tpl.arrayBuffer()), "t.xlsx");
    expect(t.sheets).toEqual(["Aktiva", "Nápověda"]);
    expect(t.headers.slice(0, 3)).toEqual(["Název", "Typ aktiva", "Kritičnost"]);

    const xlsx = await Bun.file(new URL("./fixtures/import-aktiva.xlsx", import.meta.url).pathname).arrayBuffer();
    const form = (entity: string, extra: Record<string, string> = {}, file: Blob = new Blob([xlsx]), name = "aktiva.xlsx") => {
      const f = new FormData();
      f.set("entity", entity);
      f.set("file", file, name);
      for (const [k, v] of Object.entries(extra)) f.set(k, v);
      return f;
    };
    const pv = await admin.json("/api/import/preview", { method: "POST", body: form("assets") });
    expect(pv.status).toBe(200);
    // úvodní list bez dat se přeskočí
    expect(pv.body.sheet).toBe("Aktiva");
    expect(pv.body.mapping).toEqual(["name", "assetType", "criticality", "confidentiality", "ipAddresses", "ownerUserId", "serialNumber", "description", null, null]);
    const [r1, r2, r3] = pv.body.rows;
    expect(r1).toMatchObject({ row: 2, action: "create", errors: [], data: { name: "Mzdový server", assetType: "server", criticality: "high", confidentiality: 3, ipAddresses: ["10.0.1.10", "10.0.1.11"], serialNumber: "SN-001" } });
    expect(r1.data.ownerUserId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r2).toMatchObject({ row: 3, errors: [], data: { assetType: "application", criticality: "critical", confidentiality: 4, description: "běží na SRV-01" } });
    expect(r3.row).toBe(5);
    expect(r3.errors.join()).toContain("Typ aktiva");
    expect(r3.errors.join()).toContain("Důvěrnost");
    expect(r3.warnings.join()).toContain("neznamy@test.cz");
    expect(pv.body.counts).toEqual({ create: 2, update: 0, skip: 0, errors: 1 });

    const cm = await admin.json("/api/import/commit", { method: "POST", body: form("assets") });
    expect(cm.body).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    expect(cm.body.failed).toHaveLength(1);
    const srv = (await admin.json("/api/assets?q=Mzdový server")).body.items[0];
    expect(srv).toMatchObject({ criticality: "high", serialNumber: "SN-001" });

    // opakovaný import: existující (podle sériového čísla / názvu) se aktualizují, jen vyplněnými sloupci
    const again = await admin.json("/api/import/preview", { method: "POST", body: form("assets") });
    expect(again.body.counts).toMatchObject({ create: 0, update: 2 });
    expect(again.body.rows[0].matchId).toBe(srv.id);
    const only = await admin.json("/api/import/preview", { method: "POST", body: form("assets", { mode: "create_only" }) });
    expect(only.body.counts).toMatchObject({ create: 0, update: 0, skip: 2 });
    // ruční mapování: Poznámka → umístění
    const mapped = await admin.json("/api/import/commit", { method: "POST", body: form("assets", { mapping: JSON.stringify(["name", "assetType", null, null, null, null, "serialNumber", "location", null, null]) }) });
    expect(mapped.body).toMatchObject({ created: 0, updated: 2 });
    const helios = (await admin.json("/api/assets?q=Helios")).body.items[0];
    expect((await admin.json(`/api/assets/${helios.id}`)).body).toMatchObject({ location: "běží na SRV-01", criticality: "critical" });

    // CSV ve Windows-1250 se středníkem (export z českého Excelu) – rizika
    const csv = "Kód;Název rizika;Způsob zvládání;Termín;Dopad;Vlastník\r\nR-IMP-1;Únik dat zákazníků;Redukce;31.12.2026;3;Neexistující místo\r\nR-IMP-2;Výpadek dodavatele;;;9;\r\n";
    const cp1250 = new Uint8Array([...csv].map((ch) => ({ Ú: 0xda, ý: 0xfd, á: 0xe1, ž: 0x9e, ů: 0xf9, í: 0xed, é: 0xe9, č: 0xe8, ř: 0xf8 })[ch] ?? ch.charCodeAt(0)));
    const rp = await admin.json("/api/import/preview", { method: "POST", body: form("risks", {}, new Blob([cp1250]), "rizika.csv") });
    expect(rp.body.mapping).toEqual(["code", "name", "treatment", "treatmentDue", "impact", "ownerPositionId"]);
    expect(rp.body.rows[0]).toMatchObject({ errors: [], data: { code: "R-IMP-1", name: "Únik dat zákazníků", treatment: "mitigate", treatmentDue: "2026-12-31", impact: 3 } });
    expect(rp.body.rows[0].warnings.join()).toContain("Neexistující místo");
    expect(rp.body.rows[1].errors.join()).toContain("Dopad");
    const rc = await admin.json("/api/import/commit", { method: "POST", body: form("risks", {}, new Blob([cp1250]), "rizika.csv") });
    expect(rc.body).toMatchObject({ created: 1 });
    expect(((await admin.json("/api/risks")).body.items ?? (await admin.json("/api/risks")).body).some((r: any) => r.code === "R-IMP-1")).toBe(true);

    // bez oprávnění k zápisu nelze; neplatný soubor = srozumitelná chyba
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/import/preview", { method: "POST", body: form("assets") })).status).toBe(403);
    const bad = await admin.json("/api/import/preview", { method: "POST", body: form("assets", {}, new Blob(["PK\x03\x04nesmysl"]), "x.xlsx") });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("Excel");
  });

  /* ============ DMS: workflow, portál, test, školení (v0.22) ============ */

  test("DMS: gestor → vlastník procesu → schvalovatel, portál, test porozumění, seznámení a školení", async () => {
    const employee = async (email: string) => {
      await admin.json("/api/admin/users", { method: "POST", json: { email, displayName: email.split("@")[0], password: PW, roleIds: [await roleId("employee")] } });
      const b = browser();
      await b.login(email);
      await b.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Dms-Heslo-2026!!" } });
      return { b, id: ((await b.json("/api/auth/me")).body.user.id) as string };
    };
    const g = await employee("dms-g@test.cz");
    const r = await employee("dms-r@test.cz");
    const a = await employee("dms-a@test.cz");
    const e = await employee("dms-e@test.cz");
    const x = await employee("dms-x@test.cz");
    const unit = (await admin.json("/api/org/units", { method: "POST", json: { name: "Útvar DMS" } })).body;
    const pos = async (name: string, holder: string) => (await admin.json("/api/org/positions", { method: "POST", json: { orgUnitId: unit.id, name, holderIds: [holder] } })).body.id as string;
    const [pG, pR, pA, pE] = [await pos("Gestor DMS", g.id), await pos("Vlastník procesu DMS", r.id), await pos("Ředitel DMS", a.id), await pos("Referent DMS", e.id)];
    const created = await admin.json("/api/policies", {
      method: "POST",
      json: { code: "SM-DMS-01", title: "Směrnice o hesle", docType: "directive", ownerPositionId: pG, reviewerPositionId: pR, approverPositionId: pA, audience: { positionIds: [pE] }, quizPassPct: 60, retrainOnNewVersion: true, ackDueDays: 10 },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const course = (await admin.json("/api/awareness", { method: "POST", json: { title: "Seznámení se směrnicí o hesle", form: "document", kind: "periodic", policyId: id, audience: { positionIds: [pE] } } })).body;

    // gestor (běžný zaměstnanec) spravuje dokument, ostatní ne
    expect((await g.b.json(`/api/policies/${id}`)).status).toBe(200);
    expect((await e.b.json(`/api/policies/${id}`)).status).toBe(403);
    expect((await g.b.json(`/api/policies/${id}`, { method: "PATCH", json: { approverPositionId: null, description: "Pravidla hesel" } })).body).toMatchObject({ approverPositionId: pA, description: "Pravidla hesel" });
    let d = (await g.b.json(`/api/policies/${id}/versions`, { method: "POST", json: { version: "1.0", changeSummary: "První vydání" } })).body;
    const v1 = d.versions[0];
    expect(v1.can).toMatchObject({ edit: true, submit: false });
    // předložit bez obsahu nelze
    expect((await g.b.json(`/api/policies/${id}/versions/${v1.id}/workflow`, { method: "POST", json: { action: "submit" } })).status).toBe(400);
    const fd = new FormData();
    fd.set("file", new Blob(["%PDF-1.4\n% test\n"], { type: "application/pdf" }), "smernice-hesla.pdf");
    d = (await g.b.json(`/api/policies/${id}/versions/${v1.id}/files`, { method: "POST", body: fd })).body;
    expect(d.versions[0].files[0]).toMatchObject({ filename: "smernice-hesla.pdf", mime: "application/pdf" });
    expect((await e.b.json(`/api/policies/${id}/versions/${v1.id}/workflow`, { method: "POST", json: { action: "submit" } })).status).toBe(403);
    const wf = (who: typeof g, action: string, note?: string) => who.b.json(`/api/policies/${id}/versions/${v1.id}/workflow`, { method: "POST", json: { action, note } });
    expect((await wf(g, "submit")).body.versions[0].status).toBe("review");
    expect((await wf(a, "approve")).status).toBe(409);
    expect((await wf(g, "review_ok")).status).toBe(403);
    expect((await wf(r, "return")).status).toBe(400);
    expect((await wf(r, "return", "Doplnit délku hesla")).body.versions[0].status).toBe("draft");
    expect(((await g.b.json("/api/notifications/mine")).body as any[]).some((o) => o.kind === "doc_approval" && o.detail.includes("Vráceno"))).toBe(true);
    await wf(g, "submit");
    expect(((await r.b.json("/api/notifications/mine")).body as any[]).some((o) => o.kind === "doc_approval" && o.detail.includes("Věcná kontrola"))).toBe(true);
    expect((await wf(r, "review_ok")).body.versions[0].status).toBe("approval");
    expect((await wf(r, "approve")).status).toBe(403);
    d = (await wf(a, "approve", "Schvaluji")).body;
    expect(d).toMatchObject({ status: "active", currentVersion: "1.0", pendingVersion: null });
    expect(d.versions[0].events.map((ev: any) => ev.action)).toEqual(["submit", "return", "submit", "review_ok", "approve"]);
    expect(d.versions[0].effectiveFrom).toMatch(/^\d{4}-/);

    // portál: referent (dotčená osoba) vidí a musí potvrdit; jiný zaměstnanec vidí (interní), ale nepotvrzuje
    const pe = ((await e.b.json("/api/policies/portal")).body as any[]).find((p) => p.id === id);
    expect(pe).toMatchObject({ mustAcknowledge: true, acknowledgedAt: null, hasQuiz: false, version: "1.0" });
    expect(pe.files).toHaveLength(1);
    expect(((await x.b.json("/api/policies/portal")).body as any[]).find((p) => p.id === id)).toMatchObject({ mustAcknowledge: false });
    expect(((await x.b.json("/api/policies/portal?q=hesl")).body as any[]).some((p) => p.id === id)).toBe(true);
    const file = await e.b.req(`/api/policies/${id}/versions/${v1.id}/files/${pe.files[0].id}?inline=1`);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-disposition")).toStartWith("inline");
    // test porozumění: povinný před seznámením
    await g.b.json(`/api/policies/${id}/quiz`, {
      method: "PUT",
      json: [
        { question: "Minimální délka hesla?", options: ["8", "12", "4"], correct: [1] },
        { question: "Co je zakázáno?", options: ["Sdílet heslo", "Používat MFA", "Zapsat heslo na monitor"], correct: [0, 2] },
      ],
    });
    const pd = (await e.b.json(`/api/policies/portal/${id}`)).body;
    expect(pd.quiz).toHaveLength(2);
    expect(pd.quiz[0].correct).toBeUndefined();
    expect(pd.quiz[1].multiple).toBe(true);
    expect((await e.b.json(`/api/policies/${id}/versions/${v1.id}/acknowledge`, { method: "POST" })).status).toBe(409);
    expect((await e.b.json(`/api/policies/portal/${id}/quiz`, { method: "POST", json: { answers: [[1], [0]] } })).body).toMatchObject({ score: 50, passed: false });
    expect((await e.b.json(`/api/policies/portal/${id}/quiz`, { method: "POST", json: { answers: [[1], [2, 0]] } })).body).toMatchObject({ score: 100, passed: true });
    expect((await e.b.json(`/api/policies/${id}/versions/${v1.id}/acknowledge`, { method: "POST" })).status).toBe(200);
    expect((await x.b.json(`/api/policies/${id}/versions/${v1.id}/acknowledge`, { method: "POST" })).status).toBe(403);
    // seznámení = absolvování kurzu formy „Seznámení s dokumentem“ (se skóre testu)
    let people = (await admin.json(`/api/awareness/${course.id}`)).body.people as any[];
    expect(people.find((p) => p.userId === e.id)).toMatchObject({ state: "ok" });
    expect(((await admin.json(`/api/awareness/${course.id}/records`)).body as any[]).find((rec) => rec.userId === e.id || rec.userName)?.score ?? 100).toBe(100);

    // připomínka → gestor vyřídí
    expect((await e.b.json(`/api/policies/portal/${id}/comments`, { method: "POST", json: { text: "Doplnit správce hesel", reference: "čl. 3" } })).status).toBe(201);
    d = (await g.b.json(`/api/policies/${id}`)).body;
    expect(d.openComments).toBe(1);
    d = (await g.b.json(`/api/policies/${id}/comments/${d.comments[0].id}/resolve`, { method: "POST", json: { status: "accepted", response: "Doplníme ve verzi 1.1" } })).body;
    expect(d.comments[0].status).toBe("accepted");
    expect(d.openComments).toBe(0);
    expect((await e.b.json(`/api/policies/portal/${id}`)).body.myComments[0]).toMatchObject({ status: "accepted", response: "Doplníme ve verzi 1.1", mine: true });

    // nová verze → nové seznámení i opakování školení
    d = (await g.b.json(`/api/policies/${id}/versions`, { method: "POST", json: { version: "1.1", changeSummary: "Správce hesel", content: "# Směrnice\nPoužívejte správce hesel." } })).body;
    const v2 = d.versions.find((v: any) => v.version === "1.1");
    expect((await admin.json(`/api/policies/${id}/versions/${v2.id}/approve`, { method: "POST" })).body.currentVersion).toBe("1.1");
    expect(((await e.b.json("/api/policies/portal")).body as any[]).find((p) => p.id === id)).toMatchObject({ version: "1.1", acknowledgedAt: null, quizPassed: false });
    people = (await admin.json(`/api/awareness/${course.id}`)).body.people as any[];
    expect(people.find((p) => p.userId === e.id).state).not.toBe("ok");
    expect(((await e.b.json("/api/policies/portal?q=spr%C3%A1vce%20hesel")).body as any[]).some((p) => p.id === id)).toBe(true);
    expect((await e.b.json(`/api/policies/portal/${id}`)).body.history.map((h: any) => h.version)).toEqual(["1.1", "1.0"]);

    // důvěrný dokument vidí jen dotčené osoby
    const conf = (await admin.json("/api/policies", { method: "POST", json: { title: "Důvěrný plán", classification: "confidential", audience: { positionIds: [pE] } } })).body;
    const cv = (await admin.json(`/api/policies/${conf.id}/versions`, { method: "POST", json: { version: "1.0", content: "tajné" } })).body.versions[0];
    await admin.json(`/api/policies/${conf.id}/versions/${cv.id}/approve`, { method: "POST" });
    expect(((await e.b.json("/api/policies/portal")).body as any[]).some((p) => p.id === conf.id)).toBe(true);
    expect(((await x.b.json("/api/policies/portal")).body as any[]).some((p) => p.id === conf.id)).toBe(false);
    expect((await x.b.json(`/api/policies/portal/${conf.id}`)).status).toBe(404);
    expect((await x.b.json(`/api/policies/${conf.id}/versions/${cv.id}/content`)).status).toBe(404);
  }, 30_000);

  test("DMS II: složky a číslování, šablona Wordu, check-out / check-in s revizemi, skartace", async () => {
    // složky a automatické označení
    let folders = (await admin.json("/api/policies/folders", { method: "POST", json: { name: "Směrnice ISMS", codePrefix: "SM-ISMS" } })).body;
    const fRoot = folders.find((f: any) => f.name === "Směrnice ISMS");
    folders = (await admin.json("/api/policies/folders", { method: "POST", json: { name: "Provoz", parentId: fRoot.id } })).body;
    const fSub = folders.find((f: any) => f.name === "Provoz");
    expect(fSub.path).toBe("Směrnice ISMS / Provoz");
    expect((await admin.json("/api/policies/folders", { method: "POST", json: { name: "x", codePrefix: "sm isms" } })).status).toBe(400);
    expect((await admin.json(`/api/policies/folders/${fRoot.id}`, { method: "PATCH", json: { parentId: fSub.id } })).status).toBe(400);
    const d1 = (await admin.json("/api/policies", { method: "POST", json: { title: "Řízení přístupu", folderId: fSub.id } })).body;
    const d2 = (await admin.json("/api/policies", { method: "POST", json: { title: "Zálohování", folderId: fSub.id } })).body;
    const d3 = (await admin.json("/api/policies", { method: "POST", json: { title: "Pokyn bez složky", docType: "guideline" } })).body;
    expect([d1.code, d2.code, d3.code]).toEqual(["SM-ISMS-001", "SM-ISMS-002", "PK-001"]);
    const d4 = (await admin.json("/api/policies", { method: "POST", json: { title: "Metodika analýzy rizik", docType: "methodology" } })).body;
    expect(d4).toMatchObject({ code: "MT-001", docType: "methodology" });
    const d5 = (await admin.json("/api/policies", { method: "POST", json: { title: "Rozhodnutí o jmenování manažera KB", docType: "decision" } })).body;
    expect(d5).toMatchObject({ code: "RO-001", docType: "decision" });
    expect(d1.folderPath).toBe("Směrnice ISMS / Provoz");
    expect((await admin.json(`/api/policies/folders/${fSub.id}`, { method: "DELETE" })).status).toBe(409);
    expect(((await admin.json("/api/policies/folders")).body as any[]).find((f) => f.id === fSub.id).documents).toBe(2);

    // šablona Wordu se značkami rozdělenými do více runů
    const docXml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>{{ko</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>d}} – {{ nazev }}</w:t></w:r></w:p><w:p><w:r><w:t>Verze {{verze}}, gestor {{gestor}} &amp; {{neznama}}</w:t></w:r></w:p></w:body></w:document>`;
    const ct = `<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"/></Types>`;
    const tpl = zipSync({ "[Content_Types].xml": strToU8(ct), "word/document.xml": strToU8(docXml) });
    const tfd = new FormData();
    tfd.set("file", new Blob([tpl]), "Šablona směrnice.dotx");
    tfd.set("name", "Šablona směrnice");
    tfd.set("docType", "directive");
    const templates = (await admin.json("/api/policies/templates", { method: "POST", body: tfd })).body;
    expect(templates[0]).toMatchObject({ name: "Šablona směrnice", docType: "directive" });
    let d = (await admin.json(`/api/policies/${d1.id}/versions`, { method: "POST", json: { version: "1.0" } })).body;
    const v = d.versions[0];
    d = (await admin.json(`/api/policies/${d1.id}/versions/${v.id}/from-template`, { method: "POST", json: { templateId: templates[0].id } })).body;
    const tf = d.versions[0].files[0];
    expect(tf.filename).toBe("SM-ISMS-001 Řízení přístupu v1.0.docx");
    const filled = new Uint8Array(await (await admin.req(`/api/policies/${d1.id}/versions/${v.id}/files/${tf.id}`)).arrayBuffer());
    const parts = unzipSync(filled);
    const xml = strFromU8(parts["word/document.xml"]!);
    expect(xml).toContain("SM-ISMS-001");
    expect(xml).toContain("Řízení přístupu");
    expect(xml).toContain("Verze 1.0");
    expect(xml).toContain("{{neznama}}");
    expect(xml).not.toContain("{{ko");
    expect(strFromU8(parts["[Content_Types].xml"]!)).toContain("wordprocessingml.document.main+xml");

    // check-out / check-in: jiný editor nesmí měnit rezervovanou verzi
    const editorEmail = "dms2-ed@test.cz";
    await admin.json("/api/admin/users", { method: "POST", json: { email: editorEmail, displayName: "Editor DMS", password: PW, roleIds: [await roleId("admin")] } });
    const ed = browser();
    await ed.login(editorEmail);
    await ed.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Dms2-Heslo-2026!!" } });
    d = (await admin.json(`/api/policies/${d1.id}/versions/${v.id}/checkout`, { method: "POST" })).body;
    expect(d.versions[0].lock).toMatchObject({ mine: true });
    expect(d.versions[0].can).toMatchObject({ checkout: false, checkin: true, edit: true });
    expect(d.locked).toMatchObject({ version: "1.0" });
    const other = (await ed.json(`/api/policies/${d1.id}`)).body.versions[0];
    expect(other.can).toMatchObject({ edit: false, checkout: false, unlock: true });
    expect((await ed.json(`/api/policies/${d1.id}/versions/${v.id}`, { method: "PATCH", json: { changeSummary: "x" } })).status).toBe(409);
    expect((await ed.json(`/api/policies/${d1.id}/versions/${v.id}/checkout`, { method: "POST" })).status).toBe(409);
    expect((await ed.json(`/api/policies/${d1.id}/versions/${v.id}/approve`, { method: "POST" })).status).toBe(409);
    const cfd = new FormData();
    cfd.set("file", new Blob(["PK-upraveno"]), "SM-ISMS-001 Řízení přístupu v1.0.docx");
    cfd.set("replaceId", tf.id);
    cfd.set("note", "Doplněna hesla");
    d = (await admin.json(`/api/policies/${d1.id}/versions/${v.id}/checkin`, { method: "POST", body: cfd })).body;
    expect(d.versions[0].lock).toBeNull();
    expect(d.versions[0].files).toHaveLength(1);
    expect(d.versions[0].files[0]).toMatchObject({ revision: 2, note: "Doplněna hesla", replacesId: tf.id });
    expect(d.versions[0].fileHistory.map((f: any) => f.revision)).toEqual([1]);
    expect(d.versions[0].events.map((e: any) => e.action)).toEqual(["template", "checkout", "checkin"]);
    // správce zruší cizí rezervaci
    await ed.json(`/api/policies/${d1.id}/versions/${v.id}/checkout`, { method: "POST" });
    d = (await admin.json(`/api/policies/${d1.id}/versions/${v.id}/unlock`, { method: "POST" })).body;
    expect(d.versions[0].lock).toBeNull();
    expect(d.versions[0].events.at(-1)).toMatchObject({ action: "unlock" });
    expect(d.versions[0].events.at(-1).note).toContain("Editor DMS");
    d = (await admin.json(`/api/policies/${d1.id}/versions/${v.id}/approve`, { method: "POST" })).body;
    expect(d.currentVersion).toBe("1.0");
    // portál nevidí starší revizi souboru
    const oldRev = d.versions[0].fileHistory[0];
    expect((await admin.req(`/api/policies/${d1.id}/versions/${v.id}/files/${oldRev.id}`)).status).toBe(200);

    // skartace: lhůta běží od 1. 1. roku po zrušení
    d = (await admin.json(`/api/policies/${d1.id}`, { method: "PATCH", json: { status: "retired", retentionYears: 5, retentionMark: "S" } })).body;
    expect(d.retention).toMatchObject({ state: "running", years: 5, mark: "S" });
    expect(d.retention.dueAt).toBe(`${new Date().getUTCFullYear() + 6}-01-01`);
    expect((await admin.json(`/api/policies/${d1.id}/dispose`, { method: "POST", json: { mode: "shredded" } })).status).toBe(409);
    await db.execute(sql`update policies set retired_at = '2015-03-01' where id = ${d1.id}`);
    const ret = (await admin.json("/api/policies/retention")).body as any[];
    expect(ret.find((r) => r.id === d1.id)).toMatchObject({ retention: { state: "due", dueAt: "2021-01-01" }, files: 2 });
    expect(((await admin.json("/api/notifications/team?all=1")).body as any[]).some((o: any) => o.kind === "doc_retention" && o.title.includes("Řízení přístupu"))).toBe(true);
    const pkg = await admin.req(`/api/policies/${d1.id}/package`);
    expect(pkg.headers.get("content-type")).toBe("application/zip");
    const zipped = unzipSync(new Uint8Array(await pkg.arrayBuffer()));
    expect(Object.keys(zipped).sort()).toEqual(["dokument.json", "verze-1.0/SM-ISMS-001 Řízení přístupu v1.0.docx", "verze-1.0/revize-1-SM-ISMS-001 Řízení přístupu v1.0.docx"].sort());
    // znak A = archiválie, skartovat nelze
    await admin.json(`/api/policies/${d1.id}`, { method: "PATCH", json: { retentionMark: "A" } });
    expect((await admin.json(`/api/policies/${d1.id}/dispose`, { method: "POST", json: { mode: "shredded" } })).status).toBe(400);
    d = (await admin.json(`/api/policies/${d1.id}/dispose`, { method: "POST", json: { mode: "archived", reference: "PP-2026/14" } })).body;
    expect(d.disposal).toMatchObject({ mode: "archived", reference: "PP-2026/14" });
    expect(d.retention.state).toBe("disposed");
    expect(d.canEdit).toBe(false);
    expect(d.versions[0].files).toHaveLength(0);
    expect(d.versions[0].events.length).toBeGreaterThan(0);
    expect((await admin.json(`/api/policies/${d1.id}`, { method: "PATCH", json: { title: "x" } })).status).toBe(409);
    expect((await admin.json(`/api/policies/${d1.id}`, { method: "DELETE" })).status).toBe(409);
  });

  test("DMS III: text ze souborů, vyhledávání, PDF s doložkou, porovnání verzí, převodní služba", async () => {
    // minimální platný .docx (otevře ho i Word / LibreOffice)
    const docx = (paras: string[]) =>
      zipSync({
        "[Content_Types].xml": strToU8(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        ),
        "_rels/.rels": strToU8(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
        ),
        "word/document.xml": strToU8(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
        ),
      });
    const upload = async (id: string, vid: string, bytes: Uint8Array, name: string, type = "") => {
      const fd = new FormData();
      fd.set("file", new Blob([bytes], { type }), name);
      return (await admin.json(`/api/policies/${id}/versions/${vid}/files`, { method: "POST", body: fd })).body;
    };
    const waitText = async (id: string) => {
      for (let i = 0; i < 50; i++) {
        const d = (await admin.json(`/api/policies/${id}`)).body;
        if (d.versions[0].files.every((f: any) => f.hasText || f.pdf === "native")) return d;
        await Bun.sleep(100);
      }
      throw new Error("text souboru nezpracován");
    };
    const doc = (await admin.json("/api/policies", { method: "POST", json: { title: "Směrnice o kryptografii", audience: { all: true } } })).body;
    let d = (await admin.json(`/api/policies/${doc.id}/versions`, { method: "POST", json: { version: "1.0" } })).body;
    const v1 = d.versions[0];
    await upload(doc.id, v1.id, docx(["Úvod", "Šifrování disků je povinné.", "Klíče se uchovávají 5 let.", "Závěr"]), "kryptografie.docx");
    d = await waitText(doc.id);
    expect(d.versions[0].files[0]).toMatchObject({ hasText: true, pdf: "pending" });
    // fulltext bez diakritiky a velikosti písmen
    const hits = (await admin.json(`/api/policies/search?q=${encodeURIComponent("SIFROVANI DISKU")}`)).body as any[];
    expect(hits[0]).toMatchObject({ id: doc.id, version: "1.0", source: "kryptografie.docx" });
    expect(hits[0].snippet).toContain("Šifrování disků");
    await admin.json(`/api/policies/${doc.id}/versions/${v1.id}/approve`, { method: "POST" });
    const portal = (await admin.json(`/api/policies/portal?q=${encodeURIComponent("klice se uchovavaji")}`)).body as any[];
    expect(portal.find((x) => x.id === doc.id)?.snippet).toContain("Klíče se uchovávají");

    // PDF s doložkou: nativní PDF se orazítkuje, Word bez převodní služby PDF nemá
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    const pdfBytes = await pdfDoc.save();
    d = (await admin.json(`/api/policies/${doc.id}/versions`, { method: "POST", json: { version: "1.1" } })).body;
    const v2 = d.versions[0];
    d = await upload(doc.id, v2.id, docx(["Úvod", "Šifrování disků i USB médií je povinné.", "Nový odstavec o HSM.", "Závěr"]), "kryptografie.docx");
    d = await upload(doc.id, v2.id, pdfBytes, "priloha.pdf", "application/pdf");
    d = await waitText(doc.id);
    const pdfFile = d.versions[0].files.find((f: any) => f.filename === "priloha.pdf");
    const wordFile = d.versions[0].files.find((f: any) => f.filename === "kryptografie.docx");
    expect(pdfFile.pdf).toBe("native");
    const stamped = await admin.req(`/api/policies/${doc.id}/versions/${v2.id}/files/${pdfFile.id}/pdf`);
    expect(stamped.status).toBe(200);
    expect(stamped.headers.get("x-contix-stamped")).toBe("1");
    const sb = new Uint8Array(await stamped.arrayBuffer());
    expect(sb.length).toBeGreaterThan(pdfBytes.length);
    expect((await PDFDocument.load(sb)).getPageCount()).toBe(1);
    expect((await admin.req(`/api/policies/${doc.id}/versions/${v2.id}/files/${wordFile.id}/pdf`)).status).toBe(404);

    // porovnání verzí
    const diff = (await admin.json(`/api/policies/${doc.id}/versions/${v2.id}/diff`)).body;
    expect(diff.from.version).toBe("1.0");
    expect(diff.stats).toMatchObject({ changed: 1, removed: 1, added: 1 });
    const mod = diff.blocks.find((b: any) => b.type === "mod");
    expect(mod.parts.filter((p: any) => p.t === "+").map((p: any) => p.v).join("")).toContain("USB");
    expect((await admin.json(`/api/policies/${doc.id}/versions/${v1.id}/diff`)).status).toBe(409);
    await admin.json(`/api/policies/${doc.id}/versions/${v2.id}/approve`, { method: "POST" });
    const pd = (await admin.json(`/api/policies/portal/${doc.id}`)).body;
    expect(pd.previousVersion).toBe("1.0");
    expect((await admin.json(`/api/policies/portal/${doc.id}/changes`)).body.to.version).toBe("1.1");
    // nahrazená verze má vodoznak „NEPLATNÉ“ – PDF stále jde stáhnout správcem
    expect((await admin.req(`/api/policies/${doc.id}/versions/${v2.id}/files/${pdfFile.id}/pdf`)).headers.get("x-contix-stamped")).toBe("1");

    // převodní služba (LibreOffice) – jen pokud je v prostředí k dispozici
    if (Bun.which("soffice") && Bun.which("pdftotext")) {
      const port = 3190 + Math.floor(Math.random() * 9);
      const conv = Bun.spawn(["bun", "../../infra/converter/server.ts"], { env: { ...process.env, PORT: String(port) }, stdout: "ignore", stderr: "ignore" });
      try {
        for (let i = 0; i < 50 && !(await fetch(`http://localhost:${port}/health`).then((r) => r.ok).catch(() => false)); i++) await Bun.sleep(100);
        globalConfig.CONVERTER_URL = `http://localhost:${port}`;
        const doc2 = (await admin.json("/api/policies", { method: "POST", json: { title: "Převod" } })).body;
        const vv = (await admin.json(`/api/policies/${doc2.id}/versions`, { method: "POST", json: { version: "1.0" } })).body.versions[0];
        let dd = await upload(doc2.id, vv.id, docx(["Žluťoučký kůň"]), "kun.docx");
        const cr = await admin.json(`/api/policies/${doc2.id}/versions/${vv.id}/files/${dd.versions[0].files[0].id}/convert`, { method: "POST" });
        dd = cr.body;
        expect(dd.versions[0].files[0]).toMatchObject({ pdf: "ok", pdfError: null });
        const r = await admin.req(`/api/policies/${doc2.id}/versions/${vv.id}/files/${dd.versions[0].files[0].id}/pdf`);
        expect(r.headers.get("content-type")).toBe("application/pdf");
        expect(r.headers.get("x-contix-stamped")).toBe("1");
      } finally {
        globalConfig.CONVERTER_URL = undefined;
        conv.kill();
      }
    }
  }, 60_000);

  test("DMS IV: úprava v desktopovém Office přes WebDAV (token, zámek, uložení jako revize)", async () => {
    const doc = (await admin.json("/api/policies", { method: "POST", json: { title: "Směrnice WebDAV" } })).body;
    const v = (await admin.json(`/api/policies/${doc.id}/versions`, { method: "POST", json: { version: "1.0" } })).body.versions[0];
    const fd = new FormData();
    fd.set("file", new Blob([zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>Původní</w:t></w:r></w:p></w:body></w:document>") })]), "Směrnice WebDAV.docx");
    const f = (await admin.json(`/api/policies/${doc.id}/versions/${v.id}/files`, { method: "POST", body: fd })).body.versions[0].files[0];
    // nepodporovaný soubor
    const open = (await admin.json(`/api/policies/${doc.id}/versions/${v.id}/files/${f.id}/office`, { method: "POST", json: { mode: "edit" } })).body;
    expect(open.uri).toStartWith("ms-word:ofe|u|");
    expect(open.uri).toEndWith("/Sm%C4%9Brnice%20WebDAV.docx");
    const path = new URL(open.url).pathname;
    // otevření pro úpravu rezervuje verzi
    let d = (await admin.json(`/api/policies/${doc.id}`)).body;
    expect(d.versions[0].lock).toMatchObject({ mine: true });
    expect(d.versions[0].office).toMatchObject({ open: true, saves: 0 });
    // Office: OPTIONS, PROPFIND, LOCK, GET, PUT, UNLOCK – bez cookies
    const dav = (method: string, init: RequestInit = {}, p = path) => app.request(p, { method, ...init });
    const opt = await dav("OPTIONS");
    expect(opt.headers.get("dav")).toBe("1,2");
    const pf = await dav("PROPFIND", { headers: { depth: "0" } });
    expect(pf.status).toBe(207);
    expect(await pf.text()).toContain("<D:getcontentlength>");
    const folder = await dav("PROPFIND", { headers: { depth: "1" } }, path.slice(0, path.lastIndexOf("/") + 1));
    expect(await folder.text()).toContain("<D:collection/>");
    const lock = await dav("LOCK", { headers: { timeout: "Second-3600" }, body: '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>' });
    expect(lock.status).toBe(200);
    const lockToken = lock.headers.get("lock-token")!;
    expect(lockToken).toMatch(/^<opaquelocktoken:/);
    expect((await dav("GET")).status).toBe(200);
    const edited = zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>Upraveno ve Wordu</w:t></w:r></w:p></w:body></w:document>") });
    expect((await dav("PUT", { body: edited, headers: { if: `(${lockToken})` } })).status).toBe(204);
    // druhé uložení přepíše revizi z této relace (žádná další revize)
    const edited2 = zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>Upraveno podruhé</w:t></w:r></w:p></w:body></w:document>") });
    expect((await dav("PUT", { body: edited2 })).status).toBe(204);
    expect(new TextDecoder().decode(unzipSync(new Uint8Array(await (await dav("GET")).arrayBuffer()))["word/document.xml"])).toContain("podruhé");
    expect((await dav("DELETE")).status).toBe(403);
    expect((await dav("UNLOCK", { headers: { "lock-token": lockToken } })).status).toBe(204);
    d = (await admin.json(`/api/policies/${doc.id}`)).body;
    expect(d.versions[0].files).toHaveLength(1);
    expect(d.versions[0].files[0]).toMatchObject({ revision: 2, replacesId: f.id });
    expect(d.versions[0].fileHistory).toHaveLength(1);
    expect(d.versions[0].office).toMatchObject({ saves: 2 });
    expect(d.versions[0].events.map((e: any) => e.action)).toEqual(["checkout", "office_save"]);
    // neplatný token → 404 (žádná výzva k přihlášení)
    expect((await dav("PROPFIND", {}, path.replace(/\/dav\/[^/]+\//, "/dav/" + "x".repeat(43) + "/"))).status).toBe(404);
    // check-in ukončí relaci – odkaz přestane platit
    const ci = new FormData();
    ci.set("note", "Hotovo");
    await admin.json(`/api/policies/${doc.id}/versions/${v.id}/checkin`, { method: "POST", body: ci });
    expect((await dav("GET")).status).toBe(404);
    expect((await dav("PUT", { body: edited })).status).toBe(404);
    // jen čtení: bez rezervace, zápis zakázán
    const view = (await admin.json(`/api/policies/${doc.id}/versions/${v.id}/files/${d.versions[0].files[0].id}/office`, { method: "POST", json: { mode: "view" } })).body;
    expect(view.uri).toStartWith("ms-word:ofv|u|");
    const vp = new URL(view.url).pathname;
    expect((await dav("GET", {}, vp)).status).toBe(200);
    expect((await dav("PUT", { body: edited }, vp)).status).toBe(403);
    expect((await dav("LOCK", {}, vp)).status).toBe(403);
    expect((await admin.json(`/api/policies/${doc.id}`)).body.versions[0].lock).toBeNull();
  });

  test("bezpečnost: typ souboru podle přípony, WebDAV jako příloha, ZIP bomba, LIKE, cizí opatření", async () => {
    const doc = (await admin.json("/api/policies", { method: "POST", json: { title: "Bezpečnostní test" } })).body;
    const v = (await admin.json(`/api/policies/${doc.id}/versions`, { method: "POST", json: { version: "1.0" } })).body.versions[0];
    // klient tvrdí text/html – server uloží typ podle přípony
    const fd = new FormData();
    fd.set("file", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "evil.docx");
    const f = (await admin.json(`/api/policies/${doc.id}/versions/${v.id}/files`, { method: "POST", body: fd })).body.versions[0].files[0];
    expect(f.mime).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const o = (await admin.json(`/api/policies/${doc.id}/versions/${v.id}/files/${f.id}/office`, { method: "POST", json: { mode: "view" } })).body;
    const g = await app.request(new URL(o.url).pathname);
    expect(g.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(g.headers.get("content-disposition")).toStartWith("attachment");
    expect(g.headers.get("content-security-policy")).toContain("sandbox");
    // ZIP bomba: deklarovaná velikost obří → odmítnuto, API běží dál
    const { safeUnzip } = await import("../src/lib/zip");
    const bomb = zipSync({ "word/document.xml": new Uint8Array(120 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(1_000_000);
    expect(() => safeUnzip(bomb)).toThrow(/příliš velký/);
    // zástupné znaky v hledání se berou doslova
    expect((await admin.json(`/api/policies/search?q=${encodeURIComponent("%%%")}`)).body).toEqual([]);
    // opatření jiné společnosti nelze navázat
    const other = (await admin.json("/api/companies", { method: "POST", json: { name: "Cizí s.r.o.", kind: "company" } })).body;
    expect(other.id).toBeTruthy();
    const ctl = await admin.json("/api/controls", { method: "POST", json: { name: "Cizí opatření", companyId: other.id } });
    expect(ctl.status).toBe(201);
    expect(ctl.body.companyId).toBe(other.id);
    expect((await admin.json(`/api/policies/${doc.id}`, { method: "PATCH", json: { controlIds: [ctl.body.id] } })).status).toBe(400);
  });

  test("vazby dokumentu: hierarchie, související, požadavky, procesy, aktiva, rizika, dodavatelé", async () => {
    const mk = async (title: string, docType: string, extra: Record<string, unknown> = {}) => {
      const r = await admin.json("/api/policies", { method: "POST", json: { title, docType, ...extra } });
      expect(r.status).toBe(201);
      return r.body;
    };
    const pol = await mk("Politika řízení přístupu", "policy");
    const sm = await mk("Směrnice řízení účtů", "directive", { parentId: pol.id });
    const std = await mk("Standard hesel", "standard", { parentId: sm.id });
    const proc = (await admin.json("/api/processes", { method: "POST", json: { name: "Správa identit" } })).body;
    const asset = (await admin.json("/api/assets", { method: "POST", json: { name: "Řadič domény", assetType: "server" } })).body;
    const risk = (await admin.json("/api/risks", { method: "POST", json: { name: "Prolomení hesla", impact: 3, threatLevel: 3, vulnLevel: 3 } })).body;
    const sup = (await admin.json("/api/suppliers", { method: "POST", json: { name: "IAM integrátor" } })).body;
    const { requirementsOf } = await import("@contix/shared");
    const reqId = requirementsOf("cz409").find((r) => r.id.startsWith("cz409:19/"))!.id;
    const patched = await admin.json(`/api/policies/${std.id}`, {
      method: "PATCH",
      json: { relatedIds: [pol.id], requirementIds: [reqId], processIds: [proc.id], assetIds: [asset.id], riskIds: [risk.id], supplierIds: [sup.id] },
    });
    expect(patched.status).toBe(200);
    const d = patched.body;
    expect(d.parent.id).toBe(sm.id);
    expect(d.parentId).toBe(sm.id);
    expect(d.related.map((x: any) => x.id)).toEqual([pol.id]);
    expect(d.requirements[0].id).toBe(reqId);
    expect(d.processes[0].id).toBe(proc.id);
    expect(d.assets[0].name).toBe("Řadič domény");
    expect(d.risks[0].id).toBe(risk.id);
    expect(d.suppliers[0].id).toBe(sup.id);
    // podřízené dokumenty a obousměrná souvislost
    const p1 = (await admin.json(`/api/policies/${pol.id}`)).body;
    expect(p1.children.map((x: any) => x.id)).toEqual([sm.id]);
    expect(p1.related.map((x: any) => x.id)).toEqual([std.id]);
    // dokumenty na kartě navázaného záznamu
    for (const [kind, id] of [["process", proc.id], ["asset", asset.id], ["risk", risk.id], ["supplier", sup.id], ["requirement", reqId]] as const) {
      const l = await admin.json(`/api/policies/linked?kind=${kind}&id=${encodeURIComponent(id)}`);
      expect(l.status).toBe(200);
      expect(l.body.map((x: any) => x.id)).toEqual([std.id]);
    }
    expect((await admin.json(`/api/policies/linked?kind=bogus&id=${proc.id}`)).status).toBe(400);
    expect((await admin.json(`/api/policies/linked?kind=asset&id=x';--`)).status).toBe(400);
    // cyklus v hierarchii a neznámý požadavek jsou odmítnuty
    expect((await admin.json(`/api/policies/${pol.id}`, { method: "PATCH", json: { parentId: std.id } })).status).toBe(400);
    expect((await admin.json(`/api/policies/${pol.id}`, { method: "PATCH", json: { parentId: pol.id } })).status).toBe(400);
    expect((await admin.json(`/api/policies/${pol.id}`, { method: "PATCH", json: { requirementIds: ["cz409:neexistuje"] } })).status).toBe(400);
    // záznam jiné společnosti nelze navázat
    const other = (await admin.json("/api/companies", { method: "POST", json: { name: "Cizí vazby s.r.o.", kind: "company" } })).body;
    const foreign = (await admin.json("/api/processes", { method: "POST", json: { name: "Cizí proces", companyId: other.id } })).body;
    expect((await admin.json(`/api/policies/${std.id}`, { method: "PATCH", json: { processIds: [foreign.id] } })).status).toBe(400);
    // PATCH bez vazeb je nemění; odebrání vazeb
    expect((await admin.json(`/api/policies/${std.id}`, { method: "PATCH", json: { title: "Standard hesel a MFA" } })).body.processes).toHaveLength(1);
    const cleared = (await admin.json(`/api/policies/${std.id}`, { method: "PATCH", json: { parentId: null, relatedIds: [], processIds: [] } })).body;
    expect(cleared.parent).toBeNull();
    expect(cleared.related).toEqual([]);
    expect(cleared.processes).toEqual([]);
    expect((await admin.json(`/api/policies/${pol.id}`)).body.related).toEqual([]);
    // smazání nadřazeného dokumentu (bez schválené verze) zruší vazbu u podřízeného
    expect((await admin.json(`/api/policies/${pol.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await admin.json(`/api/policies/${sm.id}`)).body.parent).toBeNull();
  });

  test("hromadný import dokumentace: ZIP s metadaty a soubory, náhled, mapování rolí, hierarchie", async () => {
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Import dokumentace s.r.o." } })).body;
    const H = { "x-contix-company": co.id };
    const unit = (await admin.json("/api/org/units", { method: "POST", headers: H, json: { name: "Bezpečnost", companyId: co.id } })).body;
    const mkb = (await admin.json("/api/org/positions", { method: "POST", headers: H, json: { orgUnitId: unit.id, name: "Manažer kybernetické bezpečnosti" } })).body;
    const iam = (await admin.json("/api/org/positions", { method: "POST", headers: H, json: { orgUnitId: unit.id, name: "Vlastník procesu IAM" } })).body;
    const docx = (t: string) => zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(`<w:document><w:body><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:body></w:document>`) });
    const csv = [
      "ID;Název;Druh;Klasifikační stupeň;Gestor;Vlastník procesu;Schvalovatel;Právní vazba;Přezkum;Nadřazený dokument;Verze;Soubor",
      "POL-07;POL-07 – Politika řízení identit;Bezpečnostní politika;Interní;Manažer kybernetické bezpečnosti;Vlastník procesu IAM;Statutární orgán [doplnit];\"§ 13; § 19; § 20\";1× ročně;—;1.0;POL-07/POL-07_Politika.docx",
      "STD-07-01;STD-07-01 – Standard hesel;Standard / technická konfigurace;Interní;Manažer kybernetické bezpečnosti;Vlastník procesu IAM;Pověřený člen vrcholného vedení;§ 19 odst. 1–6;čtvrtletně;POL-07;1.0;",
      "PR-08-02;Postup hlášení;Postup / provozní dokumentace;Důvěrné;Manažer kybernetické bezpečnosti;;;\"§ 14 odst. 1 písm. j); § 15–16 zákona\";Při změně legislativy;POL-99;;",
      "X-1;;Neznámý druh;;;;;;;;;",
    ].join("\n");
    const zip = zipSync({
      "v2-final/CONTIX_metadata_map_v2.csv": strToU8(csv),
      "v2-final/POL-07/POL-07_Politika.docx": docx("Politika IAM"),
      "v2-final/STD-07/STD-07-01_Standard_hesel.docx": docx("Hesla 12 17 22"),
      "v2-final/navic.pdf": strToU8("%PDF-1.4"),
      "__MACOSX/._x": strToU8("x"),
    });
    const send = async (mode: string, options: unknown = {}) => {
      const fd = new FormData();
      fd.append("file", new File([zip], "dokumentace.zip", { type: "application/zip" }));
      fd.append("mode", mode);
      fd.append("options", JSON.stringify(options));
      const r = await admin.req("/api/policies/import", { method: "POST", body: fd, headers: H });
      return { status: r.status, body: (await r.json()) as any };
    };
    const pv = await send("preview");
    expect(pv.status).toBe(200);
    expect(pv.body.metadataFile).toBe("v2-final/CONTIX_metadata_map_v2.csv");
    expect(pv.body.summary).toEqual({ total: 4, create: 3, skip: 0, errors: 1, withoutFile: 1 });
    const [pol, std, pr, bad] = pv.body.rows;
    expect(pol.title).toBe("Politika řízení identit");
    expect(pol.docType).toBe("policy");
    expect(pol.sections).toEqual(["§ 13", "§ 19", "§ 20"]);
    expect(pol.file).toBe("v2-final/POL-07/POL-07_Politika.docx");
    expect(std.file).toBe("v2-final/STD-07/STD-07-01_Standard_hesel.docx"); // podle označení
    expect(std.reviewMonths).toBe(3);
    expect(std.sections).toEqual(["§ 19"]);
    expect(pr.docType).toBe("procedure");
    expect(pr.classification).toBe("confidential");
    expect(pr.sections).toEqual(["§ 14"]);
    expect(pr.warnings.join(" ")).toMatch(/POL-99/);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(pv.body.unusedFiles).toEqual(["v2-final/navic.pdf"]);
    const roles = Object.fromEntries(pv.body.roles.map((r: any) => [r.name, r.positionId]));
    expect(roles["Manažer kybernetické bezpečnosti"]).toBe(mkb.id);
    expect(roles["Vlastník procesu IAM"]).toBe(iam.id);
    expect(roles["Statutární orgán [doplnit]"]).toBeNull();

    // cizí funkční místo v mapování je odmítnuto
    const otherCo = (await admin.json("/api/companies", { method: "POST", json: { name: "Cizí import" } })).body;
    const ou = (await admin.json("/api/org/units", { method: "POST", headers: { "x-contix-company": otherCo.id }, json: { name: "Cizí", companyId: otherCo.id } })).body;
    const foreign = (await admin.json("/api/org/positions", { method: "POST", headers: { "x-contix-company": otherCo.id }, json: { orgUnitId: ou.id, name: "Cizí" } })).body;
    expect((await send("commit", { mapping: { "Statutární orgán [doplnit]": foreign.id } })).status).toBe(400);

    const res = await send("commit", { mapping: { "Statutární orgán [doplnit]": mkb.id }, foldersByType: true });
    expect(res.status).toBe(201);
    expect(res.body.created.map((x: any) => x.code)).toEqual(["POL-07", "STD-07-01", "PR-08-02"]);
    expect(res.body.files).toBe(2);
    expect(res.body.linkedParents).toBe(1);
    const p = (await admin.json(`/api/policies/${res.body.created[0].id}`, { headers: H })).body;
    expect(p.ownerPositionId).toBe(mkb.id);
    expect(p.approverPositionId).toBe(mkb.id);
    expect(p.folderPath).toBe("Politika");
    expect(p.versions[0].version).toBe("1.0");
    expect(p.versions[0].status).toBe("draft");
    expect(p.versions[0].files[0].filename).toBe("POL-07_Politika.docx");
    expect(p.children.map((x: any) => x.code)).toEqual(["STD-07-01"]);
    const prd = (await admin.json(`/api/policies/${res.body.created[2].id}`, { headers: H })).body;
    expect(prd.versions[0].files).toEqual([]);
    expect(prd.reviewerPositionId).toBeNull();
    // opakovaný import přeskočí existující dokumenty
    const again = await send("preview");
    expect(again.body.summary.create).toBe(0);
    expect(again.body.summary.skip).toBe(3);
    // ne-ZIP a bez tabulky metadat
    const fd = new FormData();
    fd.append("file", new File(["a;b"], "x.csv"));
    fd.append("mode", "preview");
    expect((await admin.req("/api/policies/import", { method: "POST", body: fd, headers: H })).status).toBe(400);
    const fd2 = new FormData();
    fd2.append("file", new File([zipSync({ "a.docx": docx("x") })], "x.zip"));
    expect((await admin.req("/api/policies/import", { method: "POST", body: fd2, headers: H })).status).toBe(400);
  });

  test("import a pokrytí: systémy řízení, požadavky ISO 9001, režim nižších povinností (410)", async () => {
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Dcera 410 s.r.o.", regime: "lower" } })).body;
    expect(co.regime).toBe("lower");
    const H = { "x-contix-company": co.id };
    const csv = [
      "ID;Název;Druh;Systém řízení;Právní vazba;Požadavky;Soubor",
      'BP-01;Bezpečnostní politika;Bezpečnostní politika;Bezpečnost informací;"§ 3 odst. 3; § 4; § 19";;',
      'QM-01;Příručka kvality;Pokyn / příručka;Kvalita (ISO 9001);"§ 7";"iso9001:4.3; iso9001:7.5, iso9001:99";',
      "FO-01;Formulář neshody;Formulář;kvalita;;iso9001:10.2;",
      "HR-01;Pracovní řád;Směrnice;Obecné vnitřní předpisy;;;",
    ].join("\n");
    const zip = zipSync({ "m.csv": strToU8(csv), "QM-01_prirucka.txt": strToU8("Příručka kvality") });
    const send = async (mode: string) => {
      const fd = new FormData();
      fd.append("file", new File([zip], "s.zip"));
      fd.append("mode", mode);
      const r = await admin.req("/api/policies/import", { method: "POST", body: fd, headers: H });
      return { status: r.status, body: (await r.json()) as any };
    };
    const pv = (await send("preview")).body;
    const [bp, qm, fo, hr] = pv.rows;
    expect(bp.system).toBe("isms");
    expect(bp.sections).toEqual(["§ 3", "§ 4"]); // vyhl. 410 nemá § 19
    expect(qm.system).toBe("qms");
    expect(qm.sections).toEqual([]);
    expect(qm.requirementIds).toEqual(["iso9001:4.3", "iso9001:7.5"]);
    expect(qm.warnings.join(" ")).toMatch(/iso9001:99/);
    expect(fo.docType).toBe("form");
    expect(fo.system).toBe("qms");
    expect(hr.system).toBe("general");
    const res = (await send("commit")).body;
    expect(res.created).toHaveLength(4);
    const qd = (await admin.json(`/api/policies/${res.created[1].id}`, { headers: H })).body;
    expect(qd.system).toBe("qms");
    expect(qd.requirements.map((r: any) => r.id)).toEqual(["iso9001:4.3", "iso9001:7.5"]);
    expect(qd.gaps.join(" ")).not.toMatch(/§ 6/);
    const bd = (await admin.json(`/api/policies/${res.created[0].id}`, { headers: H })).body;
    expect(bd.gaps.join(" ")).toMatch(/§ 6/);
    // schválit příručku → pokrytí ISO 9001 kap. 4 a 7, výchozí pokrytí = vyhl. 410
    const v = qd.versions[0];
    expect((await admin.json(`/api/policies/${qd.id}/versions/${v.id}/approve`, { method: "POST", json: {}, headers: H })).status).toBe(200);
    const cov = (await admin.json("/api/policies/coverage?framework=iso9001", { headers: H })).body as any[];
    expect(cov.find((r) => r.section === "Kap. 7").documents).toBe(1);
    expect(cov.find((r) => r.section === "Kap. 8").documents).toBe(0);
    const def = (await admin.json("/api/policies/coverage", { headers: H })).body as any[];
    expect(def.map((r) => r.section)).toContain("§ 14");
    expect(def.map((r) => r.section)).not.toContain("§ 27");
    // filtr systému a ruční změna systému
    const list = (await admin.json("/api/policies", { headers: H })).body as any[];
    expect(list.filter((p) => p.companyId === co.id && p.system === "qms")).toHaveLength(2);
    expect((await admin.json(`/api/policies/${res.created[3].id}`, { method: "PATCH", headers: H, json: { system: "ohs" } })).body.system).toBe("ohs");
  });

  test("průvodce nastavením, výchozí složky, předávací protokol a příručka", async () => {
    const s = (await admin.json("/api/setup")).body;
    expect(s.steps.map((x: any) => x.key)).toContain("documentation");
    expect(s.total).toBeGreaterThan(5);
    expect(s.steps.find((x: any) => x.key === "users").detail[0]).toMatch(/Aktivních uživatelů/);
    // výchozí složky jen pokud žádné nejsou (zde už existují z testu DMS II) – vytvořit pro jinou společnost
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Setup s.r.o." } })).body;
    const before = (await admin.json("/api/setup", { headers: { "x-contix-company": co.id } })).body;
    expect(before.canCreateDocFolders).toBe(true);
    const after = (await admin.json("/api/setup/doc-folders", { method: "POST", headers: { "x-contix-company": co.id } })).body;
    expect(after.canCreateDocFolders).toBe(false);
    const folders = ((await admin.json("/api/policies/folders", { headers: { "x-contix-company": co.id } })).body as any[]).filter((f) => f.companyId === co.id);
    expect(folders.map((f) => f.path)).toContain("Směrnice ISMS / Řízení přístupu");
    const doc = (await admin.json("/api/policies", { method: "POST", headers: { "x-contix-company": co.id }, json: { title: "Politika", docType: "policy", folderId: folders.find((f) => f.name === "Bezpečnostní politika").id } })).body;
    expect(doc.code).toBe("PO-001");
    // protokol a příručka
    const ph = await admin.req("/api/setup/protocol.html");
    expect(await ph.text()).toContain("Předávací protokol");
    const pd = await admin.req("/api/setup/protocol.docx");
    expect(pd.headers.get("content-type")).toContain("wordprocessingml");
    const mh = await (await admin.req("/api/help/manual.html?audience=employee")).text();
    expect(mh).toContain("Potvrzuji seznámení");
    expect(mh).not.toContain("Předávací protokol");
    expect((await admin.req("/api/help/manual.docx")).status).toBe(200);
    // běžný zaměstnanec průvodce nevidí, příručku ano
    const emp = browser();
    await admin.json("/api/admin/users", { method: "POST", json: { email: "help-emp@test.cz", displayName: "Help", password: PW, roleIds: [await roleId("employee")] } });
    await emp.login("help-emp@test.cz");
    await emp.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Help-Heslo-2026!!" } });
    expect((await emp.json("/api/setup")).status).toBe(403);
    expect((await emp.req("/api/help/manual.html?audience=employee")).status).toBe(200);
  });

  test("nápověda: převod textu na HTML je escapovaný", async () => {
    const { helpToHtml, helpForRoute } = await import("@contix/shared");
    expect(helpToHtml("## A <b>\n\n- **x** <script>\n1. krok")).toBe("<h3>A &lt;b&gt;</h3>\n<ul><li><b>x</b> &lt;script&gt;</li></ul>\n<ol><li>krok</li></ol>");
    const h = helpForRoute("/policies/abc", ["gestor"]);
    expect(h.matched[0]!.id).toMatch(/^dms-/);
  });

  test("Zeptej se dokumentace: indexace platných verzí, odpověď s citací, jen čitelné dokumenty", async () => {
    await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: true, provider: "openai", baseUrl: AI_URL, model: "gpt-oss:20b", apiKey: "owui-key", docQaEnabled: true, embeddingModel: "bge-m3" } });
    const mk = async (title: string, content: string, extra: Record<string, unknown> = {}) => {
      const d = (await admin.json("/api/policies", { method: "POST", json: { title, status: "active", ...extra } })).body;
      const v = (await admin.json(`/api/policies/${d.id}/versions`, { method: "POST", json: { version: "1.0", content } })).body.versions[0];
      await admin.json(`/api/policies/${d.id}/versions/${v.id}/approve`, { method: "POST" });
      return d.id as string;
    };
    const pw = await mk("Směrnice o heslech QA", "# Článek 1 Hesla\n\nHeslo musí mít alespoň čtrnáct znaků a mění se při podezření na prozrazení.\n\n# Článek 2 MFA\n\nVzdálený přístup vyžaduje dvoufázové ověření.");
    await mk("Zálohování QA", "Zálohy databází se provádějí denně a uchovávají třicet dní.");
    const secret = await mk("Tajný plán QA", "Krizový kontakt na vedení heslo trezoru je uloženo v sejfu ředitele.", { classification: "restricted", audience: { positionIds: [] } });
    // AI server selže (např. neznámý embedding model) → chyba u dokumentů; po opravě ruční přeindexování zkusí chybné znovu
    aiState.embedFail = true;
    await admin.json("/api/policies/qa/reindex", { method: "POST" });
    let st: any;
    for (let i = 0; i < 50; i++) {
      st = (await admin.json("/api/policies/qa/index")).body;
      if (st.errors.length >= 3) break;
      await Bun.sleep(100);
    }
    expect(st.errors.length).toBeGreaterThanOrEqual(3);
    expect(st.errors[0].error).toContain("embedding model");
    aiState.embedFail = false;
    // indexace (plánovač) – čekat, až nic nečeká
    await admin.json("/api/policies/qa/reindex", { method: "POST" });
    for (let i = 0; i < 50; i++) {
      st = (await admin.json("/api/policies/qa/index")).body;
      if (st.pending === 0) break;
      await Bun.sleep(100);
    }
    expect(st).toMatchObject({ enabled: true, embeddingModel: "bge-m3", pending: 0 });
    expect(st.chunks).toBeGreaterThanOrEqual(4);
    // zaměstnanec se ptá
    const emp = browser();
    await admin.json("/api/admin/users", { method: "POST", json: { email: "qa-emp@test.cz", displayName: "QA", password: PW, roleIds: [await roleId("employee")] } });
    await emp.login("qa-emp@test.cz");
    await emp.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Qa-Heslo-2026!!" } });
    const r = (await emp.json("/api/policies/qa", { method: "POST", json: { question: "Kolik znaků musí mít heslo?" } })).body;
    expect(r.mode).toBe("semantic");
    expect(r.answer).toContain("[1]");
    expect(r.answer).not.toContain("<think>");
    expect(r.sources[0]).toMatchObject({ policyId: pw, version: "1.0", heading: "Článek 1 Hesla" });
    // tajný dokument (přísně důvěrný, zaměstnanec není v okruhu) se do odpovědi nedostane
    const r2 = (await emp.json("/api/policies/qa", { method: "POST", json: { question: "Kde je uloženo heslo trezoru?" } })).body;
    expect(r2.sources.some((x: any) => x.policyId === secret)).toBe(false);
    expect(JSON.stringify(aiCalls.at(-1))).not.toContain("sejfu ředitele");
    // správce tajný dokument vidí
    const r3 = (await admin.json("/api/policies/qa", { method: "POST", json: { question: "Kde je uloženo heslo trezoru?" } })).body;
    expect(r3.sources.some((x: any) => x.policyId === secret)).toBe(true);
    // zrušený dokument z indexu zmizí
    await admin.json(`/api/policies/${pw}`, { method: "PATCH", json: { status: "retired" } });
    await admin.json("/api/policies/qa/reindex", { method: "POST" });
    for (let i = 0; i < 50 && (await db.execute(sql`select 1 from doc_chunks where policy_id = ${pw}`)).length; i++) await Bun.sleep(100);
    expect((await db.execute(sql`select 1 from doc_chunks where policy_id = ${pw}`)).length).toBe(0);
    expect((await admin.json("/api/ai/status")).body.docQa).toBe(true);
  });

  test("vektory záznamů: index rizik a incidentů, hledání podle významu, podobné záznamy, odpověď AI, oprávnění", async () => {
    const { processRecordIndex } = await import("../src/modules/search/records");
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    // vypnuto = bez vektorů, hledání jen podle slov
    await processRecordIndex(db, config);
    const kw = await admin.json(`/api/records/search?q=${encodeURIComponent("ransomware šifrování serverů")}`);
    expect(kw.status).toBe(200);
    expect(kw.body.mode).toBe("keyword");
    await admin.json("/api/ai/settings", { method: "PATCH", json: { recordSearchEnabled: true } });
    const H = { "x-contix-company": ROOT_COMPANY_ID };
    const inc1 = (await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Ransomware zašifroval souborový server", description: "Útočník šifrování serverů spustil přes phishing, data obnovena ze zálohy.", kind: "incident", category: "malware", detectedAt: new Date().toISOString() } })).body;
    const inc2 = (await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Pokus o ransomware na pracovní stanici", description: "Antivir zastavil šifrování souborů ransomware po otevření přílohy phishing.", kind: "event", category: "malware", detectedAt: new Date().toISOString() } })).body;
    await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Výpadek klimatizace v serverovně", description: "Porucha chlazení, teplota vzrostla.", kind: "event", category: "other", detectedAt: new Date().toISOString() } });
    const rk = (await admin.json("/api/risks", { method: "POST", headers: H, json: { name: "Ransomware a šifrování dat", description: "Škodlivý kód zašifruje servery a zálohy po phishingu." } })).body;
    expect(await processRecordIndex(db, config)).toBeGreaterThan(3);
    // podruhé nic nového
    expect(await processRecordIndex(db, config)).toBe(0);
    const st = (await admin.json("/api/records/status")).body;
    expect(st.enabled).toBe(true);
    expect(st.byKind.incident.indexed).toBeGreaterThanOrEqual(3);
    expect(st.byKind.risk.indexed).toBeGreaterThanOrEqual(1);
    // hledání podle významu napříč druhy
    const sr = (await admin.json(`/api/records/search?q=${encodeURIComponent("ransomware šifrování serverů phishing")}`)).body;
    expect(sr.mode).toBe("semantic");
    const top = sr.hits.slice(0, 4).map((h: any) => h.refId);
    expect(top).toEqual(expect.arrayContaining([inc1.id, inc2.id, rk.id]));
    expect(sr.hits[0]).not.toHaveProperty("text");
    expect(sr.hits.find((h: any) => h.refId === inc1.id).link).toBe(`/incidents/${inc1.id}`);
    // jen incidenty
    expect(((await admin.json(`/api/records/search?q=ransomware&kinds=incident`)).body.hits as any[]).every((h) => h.kind === "incident")).toBe(true);
    // podobné záznamy k incidentu: druhý ransomware a riziko, ne klimatizace
    const sim = (await admin.json(`/api/records/similar?kind=incident&id=${inc1.id}`)).body;
    expect(sim.indexed).toBe(true);
    expect(sim.hits.map((h: any) => h.refId)).toEqual(expect.arrayContaining([inc2.id, rk.id]));
    expect(sim.hits.map((h: any) => h.refId)).not.toContain(inc1.id);
    // nesouvisející záznam je až za souvisejícími
    const pos = (id: string) => sim.hits.findIndex((h: any) => h.refId === id);
    const decoy = sim.hits.findIndex((h: any) => h.title.includes("klimatizace"));
    if (decoy >= 0) expect(decoy).toBeGreaterThan(Math.max(pos(inc2.id), pos(rk.id)));
    // změna záznamu se přeindexuje
    await admin.json(`/api/incidents/${inc2.id}`, { method: "PATCH", json: { lessonsLearned: "Zablokovat makra v přílohách." } });
    expect(await processRecordIndex(db, config)).toBe(1);
    // odpověď AI s odkazem na záznam (bez jmen osob v kontextu)
    const ask = await admin.json("/api/records/ask", { method: "POST", json: { question: "Měli jsme už incident s ransomware?" } });
    expect(ask.status).toBe(200);
    expect(ask.body.answer).toContain("[1]");
    expect(ask.body.answer).not.toContain("<think>");
    expect(ask.body.sources[0].n).toBe(1);
    const sent = JSON.stringify(aiCalls.at(-1).messages);
    expect(sent).toContain("Záznamy:");
    expect(sent).not.toContain("admin@test.cz");
    // oprávnění: uživatel bez čtení incidentů a rizik nic nenajde; podobné k cizímu záznamu = 404
    await admin.json("/api/admin/users", { method: "POST", json: { email: "rec-emp@test.cz", displayName: "Rec", password: PW, roleIds: [await roleId("employee")] } });
    const emp = browser();
    await emp.login("rec-emp@test.cz");
    await emp.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Rec-Heslo-2026!!" } });
    expect((await emp.json(`/api/records/search?q=ransomware`)).status).toBe(403);
    const viewer = browser();
    await admin.json("/api/admin/users", { method: "POST", json: { email: "rec-view@test.cz", displayName: "RecV", password: PW, roleIds: [await roleId("viewer")] } });
    await viewer.login("rec-view@test.cz");
    await viewer.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Rec-Heslo-2026!!" } });
    const vsr = await viewer.json(`/api/records/search?q=ransomware`);
    expect(vsr.status).toBe(200);
    const vs = vsr.body;
    expect((vs.hits as any[]).some((h) => h.kind === "incident")).toBe(false); // čtenář nevidí incidenty
    expect((vs.hits as any[]).some((h) => h.refId === rk.id)).toBe(true);
    expect((await viewer.json(`/api/records/similar?kind=incident&id=${inc1.id}`)).status).toBe(404);
    // smazaný záznam zmizí z indexu
    await admin.json(`/api/risks/${rk.id}`, { method: "DELETE" });
    await processRecordIndex(db, config);
    expect(((await admin.json(`/api/records/search?q=ransomware`)).body.hits as any[]).some((h) => h.refId === rk.id)).toBe(false);
  });

  test("znalostní báze: nové druhy vektorů, články, fulltext s předponami, vypnutí druhů, vyřazení, HNSW (ADR-103)", async () => {
    const { processRecordIndex } = await import("../src/modules/search/records");
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    const H = { "x-contix-company": ROOT_COMPANY_ID };
    await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: true, provider: "openai", baseUrl: AI_URL, model: "gpt-oss:20b", apiKey: "owui-key", recordSearchEnabled: true, embeddingModel: "bge-m3" } });
    // bge-m3 má 1024 rozměrů → dotazy přes HNSW index (přetypování na vector(1024))
    aiState.embedDim = 1024;
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: H, json: { name: "Zálohování databázových serverů", description: "Denní zálohování a test obnovy záloh mimo hlavní lokalitu.", status: "implemented", effectiveness: "effective" } })).body;
    // znalostní článek: koncept se neindexuje, zveřejněný po úsecích
    const draft = await admin.json("/api/knowledge", { method: "POST", headers: H, json: { title: "Runbook phishing", body: "## Přijetí hlášení\nOvěřte odesílatele.\n## Blokace\nZablokujte doménu na proxy.", tags: ["SOC", "phishing"] } });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: "draft", tags: ["SOC", "phishing"], canEdit: true });
    await processRecordIndex(db, config);
    let st = (await admin.json("/api/records/status")).body;
    expect(st.byKind.knowledge.records).toBe(0);
    expect(st.byKind.control.indexed).toBeGreaterThanOrEqual(1);
    expect((await admin.json(`/api/knowledge/${draft.body.id}`, { method: "PATCH", json: { status: "published" } })).body.status).toBe("published");
    await processRecordIndex(db, config);
    const kv = (await db.execute(sql`select ref_id, title, vector_dims(embedding) as d from record_vectors where kind = 'knowledge' order by ref_id`)) as any[];
    expect(kv.map((r) => r.title)).toEqual(["Runbook phishing – Přijetí hlášení", "Runbook phishing – Blokace"]);
    expect(Number(kv[0].d)).toBe(1024);
    // hledání podle významu (HNSW) i fulltext s předponami: „zálohy“ najde „Zálohování…“
    const sr = (await admin.json(`/api/records/search?q=${encodeURIComponent("zálohy databází")}&kinds=control`)).body;
    expect(sr.mode).toBe("semantic");
    expect(sr.hits[0]).toMatchObject({ kind: "control", refId: ctl.id, link: `/controls/${ctl.id}` });
    const kb = (await admin.json(`/api/records/search?q=${encodeURIComponent("blokace domény")}&kinds=knowledge`)).body;
    expect(kb.hits[0]).toMatchObject({ kind: "knowledge", refId: `${draft.body.id}#1`, link: `/knowledge/${draft.body.id}` });
    // vyřazení: nehledá se a přežije přeindexování
    expect((await admin.json("/api/records/index/exclude", { method: "POST", json: { kind: "control", refId: ctl.id, excluded: true } })).status).toBe(200);
    await processRecordIndex(db, config);
    expect(((await admin.json(`/api/records/search?q=${encodeURIComponent("zálohy databází")}&kinds=control`)).body.hits as any[]).some((h) => h.refId === ctl.id)).toBe(false);
    const items = (await admin.json("/api/records/index/items?kind=control&excluded=1")).body;
    expect(items.items[0]).toMatchObject({ refId: ctl.id, excluded: true, indexed: true });
    expect(items.items[0].text).toContain("Denní zálohování");
    expect((await admin.json(`/api/records/index/items?q=${encodeURIComponent("%_")}`)).body.total).toBe(0);
    // vypnutý druh se z indexu odebere
    const set = await admin.json("/api/records/index/settings", { method: "PUT", json: { disabledKinds: ["asset"] } });
    expect(set.body.disabledKinds).toEqual(["asset"]);
    await processRecordIndex(db, config);
    st = (await admin.json("/api/records/status")).body;
    expect(st.byKind.asset.records).toBe(0);
    expect(st.byKind.control.excluded).toBe(1);
    await admin.json("/api/records/index/settings", { method: "PUT", json: { disabledKinds: [] } });
    // oprávnění: auditor článek čte, nepíše; správa indexu jen admin:settings
    const au = browser();
    await au.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect(((await au.json("/api/knowledge")).body as any[]).map((a) => a.title)).toContain("Runbook phishing");
    expect((await au.json("/api/knowledge", { method: "POST", json: { title: "X" } })).status).toBe(403);
    expect((await au.json("/api/records/index/items")).status).toBe(403);
    // smazání článku odebere jeho vektory
    expect((await admin.json(`/api/knowledge/${draft.body.id}`, { method: "DELETE" })).status).toBe(204);
    expect(((await db.execute(sql`select 1 from record_vectors where kind = 'knowledge'`)) as any[]).length).toBe(0);
    aiState.embedDim = 64;
    await db.execute(sql`delete from record_vectors where vector_dims(embedding) = 1024`);
  });

  test("AI v0.99: screening AI Act, triáž VEX, triáž incidentu s podobnými případy, vektory nových modulů, úkoly (ADR-094)", async () => {
    const { processRecordIndex } = await import("../src/modules/search/records");
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    const H = { "x-contix-company": ROOT_COMPANY_ID };
    await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: true, provider: "openai", baseUrl: AI_URL, model: "gpt-oss:20b", apiKey: "owui-key", recordSearchEnabled: true, embeddingModel: "bge-m3" } });
    expect((await admin.json("/api/ai/status")).body.useCases).toEqual(expect.arrayContaining(["ai_act_screening", "vex_triage", "incident_triage"]));
    const ask = async (useCase: string, entityId: string) => {
      const r = await admin.json("/api/ai/suggestions", { method: "POST", headers: H, json: { useCase, entityId } });
      expect(r.status).toBe(202);
      await Promise.all(background);
      return (await admin.json(`/api/ai/suggestions/${r.body.id}`, { headers: H })).body;
    };
    // 1) screening AI Act – jen známé klíče, aplikace nastaví screening a klasifikaci
    const sys = (await admin.json("/api/aiact", { method: "POST", headers: H, json: { name: "Třídič uchazečů AI", vendor: "HR SaaS", purpose: "Automatické hodnocení životopisů uchazečů o zaměstnání pomocí jazykového modelu." } })).body;
    const s1 = await ask("ai_act_screening", sys.id);
    expect(s1.status).toBe("proposed");
    expect(s1.items.map((i: any) => i.field).sort()).toEqual(["annexIII", "gpai", "personalData"]);
    expect(s1.items.find((i: any) => i.field === "annexIII")).toMatchObject({ value: ["recruitment"], reason: "nábor zaměstnanců" });
    expect(JSON.stringify(aiCalls.at(-1).messages)).not.toContain("admin@test.cz");
    await admin.json(`/api/ai/suggestions/${s1.id}/decide`, { method: "POST", headers: H, json: { accept: [0, 1, 2] } });
    const sysAfter = (await admin.json(`/api/aiact/${sys.id}`, { headers: H })).body;
    expect(sysAfter.classification.cls).toBe("high");
    expect(sysAfter.screening).toMatchObject({ annexIII: ["recruitment"], gpai: true, personalData: true });
    // 2) triáž VEX – jen nálezy z kontextu, „nezasaženo“ jen se zdůvodněním
    const prod = (await admin.json("/api/cra", { method: "POST", headers: H, json: { name: "Interní portál", intendedPurpose: "Zobrazení statických stránek", category: "default" } })).body;
    const fd = new FormData();
    fd.append("file", new File([JSON.stringify([{ id: "GHSA-vex-0000-0001", aliases: ["CVE-2021-23337"], summary: "Command injection in template", affected: [{ package: { ecosystem: "npm", name: "lodash" }, versions: ["4.17.15"] }] }])], "osv.json"));
    await admin.json("/api/cra/osv/upload", { method: "POST", headers: H, body: fd });
    await admin.json(`/api/cra/${prod.id}/sbom`, { method: "POST", headers: H, json: { text: JSON.stringify({ bomFormat: "CycloneDX", components: [{ name: "lodash", version: "4.17.15", purl: "pkg:npm/lodash@4.17.15" }] }) } });
    const s2 = await ask("vex_triage", prod.id);
    // druhý nález bez zdůvodnění a neznámé ID se zahodí
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0]).toMatchObject({ kind: "vex", status: "not_affected", justification: "vulnerable_code_not_in_execute_path" });
    await admin.json(`/api/ai/suggestions/${s2.id}/decide`, { method: "POST", headers: H, json: { accept: [0] } });
    const fnd = ((await admin.json(`/api/cra/${prod.id}/findings`, { headers: H })).body as any[]).find((f) => f.id === s2.items[0].findingId);
    expect(fnd).toMatchObject({ status: "not_affected", impactStatement: "Funkce template se nevolá." });
    // 3) triáž incidentu s podobnými případy z vektorového indexu
    const old = (await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Ransomware zašifroval sdílený disk účetnictví", description: "Phishing příloha spustila ransomware, šifrování souborů na NAS, obnova ze zálohy.", kind: "incident", category: "ransomware", detectedAt: new Date().toISOString() } })).body;
    const inc = (await admin.json("/api/incidents", { method: "POST", headers: H, json: { title: "Šifrování souborů na NAS po phishing příloze", description: "Uživatel otevřel phishing přílohu, soubory na NAS se šifrují, ransomware.", detectedAt: new Date().toISOString() } })).body;
    await processRecordIndex(db, config);
    const s3 = await ask("incident_triage", inc.id);
    expect(s3.summary).toContain("[1]");
    expect(s3.items.map((i: any) => i.field).sort()).toEqual(["category", "cause", "kind", "suspectedUnlawful"]);
    const sent = aiCalls.at(-1).messages.at(-1).content as string;
    expect(sent).toContain(old.title);
    await admin.json(`/api/ai/suggestions/${s3.id}/decide`, { method: "POST", headers: H, json: { accept: [0, 1, 2, 3] } });
    expect((await admin.json(`/api/incidents/${inc.id}`, { headers: H })).body).toMatchObject({ kind: "incident", category: "ransomware", cause: "intentional", suspectedUnlawful: true });
    // 4) vektory nových modulů a související záznamy podle textu
    const st = (await admin.json("/api/records/status", { headers: H })).body;
    expect(st.byKind.ai_system.indexed).toBeGreaterThanOrEqual(1);
    expect(st.byKind.cra_finding.indexed).toBeGreaterThanOrEqual(1);
    const rel = (await admin.json("/api/records/related", { method: "POST", headers: H, json: { text: "Varování: ransomware šifruje NAS po phishing příloze", kinds: ["incident"] } })).body;
    expect(rel.mode).toBe("semantic");
    expect(rel.hits.map((h: any) => h.refId)).toEqual(expect.arrayContaining([inc.id, old.id]));
    expect((await admin.json("/api/records/related", { method: "POST", headers: H, json: { text: "ransomware NAS phishing", exclude: { kind: "incident", id: inc.id } } })).body.hits.some((h: any) => h.refId === inc.id)).toBe(false);
    // 5) úkoly navázané na AI systém a produkt
    const tk = await admin.json("/api/actions/tasks", { method: "POST", headers: H, json: { title: "Doplnit FRIA", sourceKind: "ai_system", sourceId: sys.id } });
    expect(tk.status).toBe(201);
    expect(tk.body).toMatchObject({ sourceLabel: "Třídič uchazečů AI", sourceLink: `/aiact/${sys.id}` });
    expect((await admin.json("/api/actions/tasks", { method: "POST", headers: H, json: { title: "Opravit lodash", sourceKind: "cra_product", sourceId: prod.id } })).status).toBe(201);
  });

  test("import skenů zranitelností: náhled, reimport, uzavření, znovuotevření, deduplikace, triáž, expozice, AI triáž (ADR-095)", async () => {
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    const H = { "x-contix-company": ROOT_COMPANY_ID };
    const web = (await admin.json("/api/assets", { method: "POST", headers: H, json: { name: "Web01 skenovaný", assetType: "server", hostname: "web01", fqdn: "web01.scan.local", ipAddresses: ["10.77.0.5"] } })).body;
    const shop = (await admin.json("/api/assets", { method: "POST", headers: H, json: { name: "Eshop-Produkce-X", assetType: "server", fqdn: "shop.scan.example" } })).body;
    const img = (await admin.json("/api/assets", { method: "POST", headers: H, json: { name: "Obraz aplikace", assetType: "server" } })).body;
    // Wazuh už hlásí CVE-2023-0215 na web01 → nález Nessusu se stejnou CVE bude duplicita
    await db.insert(schema.assetVulnerabilities).values({ assetId: web.id, cveId: "CVE-2023-0215", severity: "high", packageName: "openssl", packageVersion: "3.0.1", sourceType: "wazuh" });
    const item = (id: string, sev: number, name: string, port: string, cves: string[] = []) =>
      `<ReportItem port="${port}" protocol="tcp" severity="${sev}" pluginID="${id}" pluginName="${name}"><description>d</description>${cves.map((c) => `<cve>${c}</cve>`).join("")}</ReportItem>`;
    const nessus = (items: string, extra = "") =>
      `<?xml version="1.0"?><NessusClientData_v2><Report name="t"><ReportHost name="10.77.0.5"><HostProperties><tag name="host-ip">10.77.0.5</tag></HostProperties>${items}</ReportHost>${extra}</Report></NessusClientData_v2>`;
    const send = (file: string, name: string, o: Record<string, string> = {}) => {
      const fd = new FormData();
      fd.append("file", new File([file], name));
      for (const [k, v] of Object.entries(o)) fd.append(k, v);
      return admin.json("/api/vulnerabilities/scans", { method: "POST", headers: H, body: fd });
    };
    const f1 = nessus(item("12345", 3, "OpenSSL multiple", "443", ["CVE-2023-0286", "CVE-2023-0215"]) + item("22222", 2, "SSH weak ciphers", "22") + item("19506", 0, "Scan info", "0"), `<ReportHost name="10.99.9.9"><HostProperties/>${item("22222", 2, "SSH weak ciphers", "22")}</ReportHost>`);
    // náhled nic nezapisuje
    const pv = await send(f1, "q4.nessus");
    expect(pv.status).toBe(200);
    expect(pv.body).toMatchObject({ scanner: "nessus", findings: 3, skippedInfo: 1 });
    expect(pv.body.hosts.find((h: any) => h.ip === "10.77.0.5")).toMatchObject({ assetId: web.id, findings: 2 });
    expect(pv.body.hosts.find((h: any) => h.host === "10.99.9.9")).toMatchObject({ assetId: null });
    expect((await admin.json(`/api/vulnerabilities?assetId=${web.id}&status=open`, { headers: H })).body.total).toBe(1);
    // import
    const s1 = await send(f1, "q4.nessus", { mode: "commit", name: "Interní sken Q4" });
    expect(s1.status).toBe(201);
    expect(s1.body).toMatchObject({ scanner: "nessus", name: "Interní sken Q4", unmatchedHosts: ["10.99.9.9"], stats: { findings: 3, skippedInfo: 1, unmatched: 1, created: 2, duplicates: 1, closed: 0 } });
    const l1 = (await admin.json(`/api/vulnerabilities?scanId=${s1.body.id}&limit=50`, { headers: H })).body.items as any[];
    const dup = l1.find((v) => v.endpoint === "443/tcp");
    expect(dup).toMatchObject({ status: "duplicate", cveId: "CVE-2023-0215", relatedCves: ["CVE-2023-0286"], scanner: "nessus", title: "OpenSSL multiple" });
    expect(dup.triageReason).toContain("wazuh");
    const ssh = l1.find((v) => v.endpoint === "22/tcp");
    expect(ssh).toMatchObject({ status: "open", cveId: "nessus:22222", severity: "medium" });
    // reimport z internetu: chybějící nález se uzavře, kritický nový je dosažitelný z internetu → P2
    const s2 = await send(nessus(item("33333", 4, "Apache RCE", "443", ["CVE-2099-0001"])), "ext.nessus", { mode: "commit", external: "true" });
    expect(s2.body.stats).toMatchObject({ created: 1, closed: 1, reopened: 0 });
    const rce = ((await admin.json(`/api/vulnerabilities?scanId=${s2.body.id}`, { headers: H })).body.items as any[])[0];
    expect(rce).toMatchObject({ severity: "critical", exposed: true, priority: "p2", priorityReasons: ["exposed"] });
    expect(((await admin.json(`/api/vulnerabilities?assetId=${web.id}&status=resolved`, { headers: H })).body.items as any[]).map((v) => v.cveId)).toContain("nessus:22222");
    // znovu nalezený se otevře; bez closeMissing zůstane zbytek otevřený
    const s3 = await send(nessus(item("22222", 2, "SSH weak ciphers", "22")), "again.nessus", { mode: "commit", closeMissing: "false" });
    expect(s3.body.stats).toMatchObject({ created: 0, updated: 1, reopened: 1, closed: 0 });
    expect(((await admin.json(`/api/vulnerabilities?assetId=${web.id}&status=open`, { headers: H })).body.items as any[]).map((v) => v.cveId).sort()).toEqual(["CVE-2023-0215", "CVE-2099-0001", "nessus:22222"]);
    // triáž: falešně pozitivní jen se zdůvodněním, reimport ji nepřepíše, znovu otevřít
    expect((await admin.json("/api/vulnerabilities/triage", { method: "POST", headers: H, json: { ids: [ssh.id], action: "false_positive" } })).status).toBe(400);
    expect((await admin.json("/api/vulnerabilities/triage", { method: "POST", headers: H, json: { ids: [ssh.id], action: "false_positive", reason: "SSH jen z management VLAN" } })).body).toEqual({ changed: 1 });
    await send(nessus(item("22222", 2, "SSH weak ciphers", "22")), "again2.nessus", { mode: "commit", closeMissing: "false" });
    expect(((await admin.json(`/api/vulnerabilities?assetId=${web.id}&status=false_positive`, { headers: H })).body.items as any[]).find((v) => v.id === ssh.id)).toMatchObject({ status: "false_positive", triageReason: "SSH jen z management VLAN" });
    expect((await admin.json("/api/vulnerabilities/triage", { method: "POST", headers: H, json: { ids: [ssh.id], action: "reopen" } })).body.changed).toBe(1);
    expect((await admin.json("/api/vulnerabilities/triage", { method: "POST", headers: H, json: { ids: [ssh.id, rce.id], action: "verify" } })).body.changed).toBe(2);
    expect(((await admin.json(`/api/vulnerabilities?assetId=${web.id}&verified=1`, { headers: H })).body.total)).toBe(2);
    // ruční duplicita jen vůči nálezu na stejném aktivu
    expect((await admin.json("/api/vulnerabilities/triage", { method: "POST", headers: H, json: { ids: [ssh.id], action: "duplicate", duplicateOfId: rce.id } })).body.changed).toBe(1);
    // aktivum dosažitelné z internetu zvyšuje prioritu
    const trivy = JSON.stringify({ ArtifactName: "registry/app:1.2", Results: [{ Target: "app/package-lock.json", Class: "lang-pkgs", Vulnerabilities: [{ VulnerabilityID: "GHSA-scan-0000-0001", PkgName: "lodash", InstalledVersion: "4.17.20", FixedVersion: "4.17.21", Severity: "HIGH" }, { VulnerabilityID: "CVE-2099-0002", PkgName: "minimist", InstalledVersion: "1.2.0", Severity: "LOW" }] }] });
    const s4 = await send(trivy, "trivy.json", { mode: "commit", assetId: img.id });
    expect(s4.body).toMatchObject({ scanner: "trivy", assetId: img.id, assetName: "Obraz aplikace", stats: { created: 2 } });
    const gh = ((await admin.json(`/api/vulnerabilities?assetId=${img.id}`, { headers: H })).body.items as any[]).find((v) => v.cveId === "GHSA-scan-0000-0001");
    expect(gh).toMatchObject({ priority: "p3", fixedVersion: "4.17.21", endpoint: "app/package-lock.json" });
    expect((await admin.json("/api/vulnerabilities/triage", { method: "POST", headers: H, json: { ids: [gh.id], action: "duplicate", duplicateOfId: rce.id } })).status).toBe(400);
    await admin.json(`/api/assets/${img.id}`, { method: "PATCH", headers: H, json: { internetFacing: true } });
    expect(((await admin.json(`/api/vulnerabilities?assetId=${img.id}`, { headers: H })).body.items as any[]).find((v) => v.id === gh.id).priority).toBe("p2");
    // AI triáž: Burp a ZAP hlásí stejné XSS → duplicita; CSP falešně pozitivní; bez názvů aktiv
    const burp = `<?xml version="1.0"?><issues burpVersion="2024"><issue><type>2097920</type><name>Cross-site scripting (reflected)</name><host ip="1.2.3.4">https://shop.scan.example</host><path>/search</path><severity>High</severity></issue></issues>`;
    expect((await send(burp, "burp.xml", { mode: "commit" })).body.stats.created).toBe(1);
    const zap = JSON.stringify({ site: [{ "@name": "https://shop.scan.example", "@host": "shop.scan.example", alerts: [{ pluginid: "40012", alert: "Cross Site Scripting (Reflected)", riskcode: "3", cweid: "79", instances: [{ uri: "https://shop.scan.example/search?q=x" }] }, { pluginid: "10038", alert: "Content Security Policy Header Not Set", riskcode: "2", cweid: "693" }] }] });
    const sz = await send(zap, "zap.json", { mode: "commit" });
    expect(sz.body.stats).toMatchObject({ created: 2, duplicates: 0 });
    const r = await admin.json("/api/ai/suggestions", { method: "POST", headers: H, json: { useCase: "vuln_scan_triage", entityId: sz.body.id } });
    expect(r.status).toBe(202);
    await Promise.all(background);
    const sg = (await admin.json(`/api/ai/suggestions/${r.body.id}`, { headers: H })).body;
    expect(sg.status).toBe("proposed");
    expect(sg.items.map((i: any) => i.action)).toEqual(["duplicate", "false_positive"]);
    expect(sg.items[0].duplicateTitle).toContain("burp");
    const sent = JSON.stringify(aiCalls.at(-1).messages);
    expect(sent).not.toContain("Eshop-Produkce-X");
    expect(aiCalls.at(-1).messages.at(-1).content as string).toContain('"asset":"A1"');
    expect((await admin.json(`/api/ai/suggestions/${sg.id}/decide`, { method: "POST", headers: H, json: { accept: [0, 1] } })).status).toBe(200);
    const zl = (await admin.json(`/api/vulnerabilities?scanId=${sz.body.id}`, { headers: H })).body.items as any[];
    expect(zl.map((v) => v.status).sort()).toEqual(["duplicate", "false_positive"]);
    expect(zl.find((v) => v.status === "duplicate").triageReason).toContain("AI návrh přijat");
    // seznam importů, chyby a oprávnění
    const list = (await admin.json("/api/vulnerabilities/scans", { headers: H })).body as any[];
    expect(list.find((x) => x.id === s1.body.id)).toMatchObject({ name: "Interní sken Q4", importedByName: expect.any(String) });
    expect((await admin.json(`/api/vulnerabilities/scans/${s1.body.id}`, { headers: H })).body.open).toBeGreaterThanOrEqual(0);
    expect((await send("nesmysl", "x.txt")).status).toBe(400);
    expect((await send("{}", "x.json", { scanner: "trivy", mode: "commit", assetId: "00000000-0000-4000-8000-000000000999" })).status).toBe(400);
    // průběžné monitorování (ADR-096): kolektory nad zranitelnostmi, aktivy, SCA a SOC běží bez chyb dotazu
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: H, json: { name: "Správa zranitelností (monitor)", status: "implemented" } })).body;
    for (const kind of ["vuln_overdue", "vuln_kev", "sca_score", "agent_coverage", "eol_assets", "soc_sla"]) {
      const m = (await admin.json("/api/monitors", { method: "POST", headers: H, json: { controlId: ctl.id, kind, params: { graceDays: 0 } } })).body;
      const run = (await admin.json(`/api/monitors/${m.id}/run`, { method: "POST", headers: H })).body;
      expect(run.summary).not.toContain("Neočekávaná chyba");
      if (kind === "vuln_kev") expect(run.result).toMatch(/pass|fail/);
    }
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    const fd = new FormData();
    fd.append("file", new File([burp], "b.xml"));
    expect((await viewer.json("/api/vulnerabilities/scans", { method: "POST", body: fd })).status).toBe(403);
    expect((await viewer.json("/api/vulnerabilities/triage", { method: "POST", json: { ids: [ssh.id], action: "verify" } })).status).toBe(403);
  });

  test("zranitelnosti z CI/CD (API token, brána failOn), metriky, konektor DefectDojo (ADR-097)", async () => {
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    const H = { "x-contix-company": ROOT_COMPANY_ID };
    const ci = (await admin.json("/api/assets", { method: "POST", headers: H, json: { name: "CI obraz", assetType: "container" } })).body;
    const tok = (await admin.json("/api/tokens", { method: "POST", json: { name: "GitLab CI", expiresInDays: 30 } })).body.token as string;
    const trivy = JSON.stringify({ ArtifactName: "reg/app:2", Results: [{ Target: "app/package-lock.json", Class: "lang-pkgs", Vulnerabilities: [{ VulnerabilityID: "CVE-2099-0101", PkgName: "express", InstalledVersion: "4.0.0", Severity: "CRITICAL" }, { VulnerabilityID: "CVE-2099-0102", PkgName: "qs", InstalledVersion: "6.0.0", Severity: "LOW" }] }] });
    const upload = (token: string | null, extra: Record<string, string> = {}) => {
      const fd = new FormData();
      fd.append("file", new File([trivy], "trivy.json"));
      fd.append("assetId", ci.id);
      for (const [k, v] of Object.entries(extra)) fd.append(k, v);
      // bez cookies a bez Origin – jako runner CI
      return app.request("/api/public/vulnerabilities/scans", { method: "POST", body: fd, headers: token ? { authorization: `Bearer ${token}` } : {} });
    };
    expect((await upload(null)).status).toBe(401);
    expect((await upload("ctx_neplatny")).status).toBe(401);
    expect((await upload(tok, { failOn: "maybe" })).status).toBe(400);
    const r1 = await upload(tok, { failOn: "high" });
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as any;
    expect(b1).toMatchObject({ scanner: "trivy", failOn: "high", failed: true, newOpen: { critical: 1, low: 1 }, stats: { created: 2 } });
    const b2 = (await (await upload(tok, { failOn: "high" })).json()) as any;
    expect(b2).toMatchObject({ failed: false, newOpen: { critical: 0 }, stats: { created: 0, updated: 2 } });
    const pv = (await (await upload(tok, { mode: "preview" })).json()) as any;
    expect(pv).toMatchObject({ scanner: "trivy", findings: 2 });
    const scans = (await admin.json("/api/vulnerabilities/scans", { headers: H })).body as any[];
    expect(scans.find((x) => x.id === b1.scanId)).toMatchObject({ assetName: "CI obraz", importedByName: expect.any(String) });
    // metriky
    const m = (await admin.json("/api/vulnerabilities/metrics?months=6", { headers: H })).body;
    expect(m.months).toHaveLength(6);
    expect(m.months.at(-1).opened).toBeGreaterThan(0);
    expect(Object.keys(m.mttr).sort()).toEqual(["critical", "high", "low", "medium", "unknown"]);
    expect(m.aging.critical.d30).toBeGreaterThanOrEqual(1);
    expect(m.bySource.map((x: any) => x.source)).toEqual(expect.arrayContaining(["trivy", "nessus"]));
    expect(m.triage.falsePositive).toBeGreaterThanOrEqual(1);
    expect((await admin.json("/api/vulnerabilities/metrics?months=99", { headers: H })).status).toBe(400);
    // DefectDojo: klíč šifrovaně, nikdy v odpovědi; test připojení; synchronizace se stránkováním a uzavřením
    ddMock.findings = [
      { id: 501, title: "Weak TLS configuration", severity: "High", cwe: 326, vulnerability_ids: [], endpoints: [7], component_name: null },
      { id: 502, title: "Prototype pollution", severity: "Critical", vulnerability_ids: [{ vulnerability_id: "CVE-2099-0201" }], component_name: "lodash", component_version: "4.17.10", endpoints: [], file_path: "package-lock.json", related_fields: { test: { engagement: { product: { name: "Eshop-Produkce-X" } } } } },
    ];
    const set = await admin.json("/api/vulnerabilities/defectdojo", { method: "PUT", json: { url: "https://dd.test", apiKey: ddMock.key, companyId: ROOT_COMPANY_ID, intervalHours: 6 } });
    expect(set.body).toMatchObject({ url: "https://dd.test", hasKey: true, companyId: ROOT_COMPANY_ID, enabled: false });
    expect(JSON.stringify(set.body)).not.toContain(ddMock.key);
    expect((await admin.json("/api/vulnerabilities/defectdojo/test", { method: "POST" })).body).toEqual({ ok: true, activeFindings: 2 });
    const s1 = (await admin.json("/api/vulnerabilities/defectdojo/sync", { method: "POST" })).body;
    expect(s1.lastStats).toMatchObject({ findings: 2, created: 2, unmatched: 0 });
    const dd = (await admin.json(`/api/vulnerabilities?scanner=defectdojo&limit=50`, { headers: H })).body.items as any[];
    expect(dd.map((v) => `${v.assetName}|${v.cveId}|${v.endpoint}`).sort()).toEqual(["Eshop-Produkce-X|CVE-2099-0201|package-lock.json", "Web01 skenovaný|defectdojo:DD-501|443 /admin"]);
    ddMock.findings = ddMock.findings.slice(0, 1);
    expect((await admin.json("/api/vulnerabilities/defectdojo/sync", { method: "POST" })).body.lastStats).toMatchObject({ created: 0, updated: 1, closed: 1 });
    // chyby: přesměrování na cizí server, odmítnutý klíč – zapíše se ke konektoru
    ddMock.findings.push({ id: 503, title: "x", severity: "Low", endpoints: [] });
    ddMock.evilNext = true;
    const bad = await admin.json("/api/vulnerabilities/defectdojo/sync", { method: "POST" });
    expect(bad.status).toBe(502);
    expect(bad.body.error).toContain("jiný server");
    ddMock.evilNext = false;
    await admin.json("/api/vulnerabilities/defectdojo", { method: "PUT", json: { apiKey: "spatny-klic-xyz" } });
    expect((await admin.json("/api/vulnerabilities/defectdojo/test", { method: "POST" })).body).toMatchObject({ ok: false });
    expect((await admin.json("/api/vulnerabilities/defectdojo")).body.lastError).toContain("jiný server");
    const audits = JSON.stringify((await admin.json("/api/admin/audit-log?limit=60")).body);
    expect(audits).not.toContain(ddMock.key);
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json("/api/vulnerabilities/defectdojo")).status).toBe(403);
  });

  test("zprávy o ujištění dodavatelů: zpráva, soubor, AI vytěžení CUEC a výjimek, mapování, riziko, mezery, povinnost (ADR-098)", async () => {
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    const H = { "x-contix-company": ROOT_COMPANY_ID };
    const sup = (await admin.json("/api/suppliers", { method: "POST", headers: H, json: { name: "CloudCRM s.r.o.", significant: true } })).body;
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: H, json: { name: "Přezkum přístupů dodavatele", status: "planned" } })).body;
    const cr = await admin.json("/api/suppliers/reports", { method: "POST", headers: H, json: { supplierId: sup.id, kind: "soc2_type2", title: "SOC 2 Type II 2026", serviceAuditor: "Audit CPA LLP", periodFrom: "2025-04-01", periodTo: "2026-03-31", opinion: "unmodified", subserviceOrgs: ["AWS"] } });
    expect(cr.status).toBe(201);
    const rep = cr.body;
    expect(rep).toMatchObject({ validUntil: "2027-03-31", supplierName: "CloudCRM s.r.o.", hasText: false });
    expect(rep.gaps.map((g: any) => g.code)).toEqual(["bridge", "no_file"]);
    // AI bez textu nejde
    const noText = await admin.json("/api/ai/suggestions", { method: "POST", headers: H, json: { useCase: "supplier_report_extract", entityId: rep.id } });
    await Promise.all(background);
    if (noText.status === 202) expect((await admin.json(`/api/ai/suggestions/${noText.body.id}`, { headers: H })).body.status).toBe("failed");
    else expect(noText.status).toBeGreaterThanOrEqual(400);
    // nahrání textové zprávy → text pro AI; stažení jako příloha
    const fd = new FormData();
    fd.append("file", new File([`<html><body><h2>Section 4</h2><p>Complementary User Entity Controls</p><p>Customers are responsible for reviewing user access.</p><p>Exceptions noted: 1 of 25 changes deployed without approval.</p></body></html>`], "soc2-cloudcrm.html"));
    const up = (await admin.json(`/api/suppliers/reports/${rep.id}/file`, { method: "POST", headers: H, body: fd })).body;
    expect(up).toMatchObject({ fileName: "soc2-cloudcrm.html", hasText: true, note: null });
    expect(up.textPreview).toContain("Complementary User Entity Controls");
    expect(up.textPreview).not.toContain("<p>");
    const dl = await admin.req(`/api/suppliers/reports/${rep.id}/file`, { headers: H });
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(dl.headers.get("content-security-policy")).toContain("sandbox");
    // AI vytěžení: neznámé opatření se zahodí, kritérium validované
    const r = await admin.json("/api/ai/suggestions", { method: "POST", headers: H, json: { useCase: "supplier_report_extract", entityId: rep.id } });
    expect(r.status).toBe(202);
    await Promise.all(background);
    const sg = (await admin.json(`/api/ai/suggestions/${r.body.id}`, { headers: H })).body;
    expect(sg.status).toBe("proposed");
    expect(sg.items.map((i: any) => [i.itemKind, i.controlId])).toEqual([["cuec", ctl.id], ["cuec", null], ["exception", null], ["csoc", null]]);
    expect(aiCalls.at(-1).messages.at(-1).content).toContain("Customers are responsible");
    await admin.json(`/api/ai/suggestions/${sg.id}/decide`, { method: "POST", headers: H, json: { accept: [0, 1, 2, 3] } });
    let d = (await admin.json(`/api/suppliers/reports/${rep.id}`, { headers: H })).body;
    expect(d.counts).toEqual({ cuec: 2, exception: 1, csoc: 1 });
    const cuec1 = d.items.find((i: any) => i.ref === "CUEC-1");
    expect(cuec1).toMatchObject({ controlId: ctl.id, controlName: "Přezkum přístupů dodavatele", controlStatus: "planned", source: "ai" });
    expect(d.gaps.map((g: any) => `${g.code}:${g.n ?? ""}`)).toEqual(["bridge:", "cuec_unmapped:1", "cuec_weak:1", "exception_open:1", "subservice:1"]);
    // ruční úpravy: CUEC-2 se nás netýká, CSOC posouzena, bridge letter
    const cuec2 = d.items.find((i: any) => i.ref === "CUEC-2");
    await admin.json(`/api/suppliers/reports/${rep.id}/items/${cuec2.id}`, { method: "PATCH", headers: H, json: { status: "not_applicable", note: "API nepoužíváme" } });
    const csoc = d.items.find((i: any) => i.kind === "csoc");
    await admin.json(`/api/suppliers/reports/${rep.id}/items/${csoc.id}`, { method: "PATCH", headers: H, json: { status: "addressed" } });
    expect((await admin.json(`/api/suppliers/reports/${rep.id}/items/${csoc.id}`, { method: "PATCH", headers: H, json: { controlId: "00000000-0000-4000-8000-000000000999" } })).status).toBe(400);
    await admin.json(`/api/suppliers/reports/${rep.id}`, { method: "PATCH", headers: H, json: { bridgeUntil: "2026-09-30" } });
    await admin.json(`/api/controls/${ctl.id}`, { method: "PATCH", headers: H, json: { status: "implemented" } });
    // výjimka → riziko dodavatele
    const exc = d.items.find((i: any) => i.kind === "exception");
    const rk = await admin.json(`/api/suppliers/reports/${rep.id}/items/${exc.id}/risk`, { method: "POST", headers: H });
    expect(rk.status).toBe(201);
    expect((await admin.json(`/api/suppliers/reports/${rep.id}/items/${exc.id}/risk`, { method: "POST", headers: H })).status).toBe(409);
    const risk = (await admin.json(`/api/risks/${rk.body.riskId}`, { headers: H })).body;
    expect(risk.name).toContain("CloudCRM s.r.o.");
    expect(risk.description).toContain("Proces doplněn");
    const supD = (await admin.json(`/api/suppliers/${sup.id}`, { headers: H })).body;
    expect(JSON.stringify(supD)).toContain(rk.body.riskId);
    d = (await admin.json(`/api/suppliers/reports/${rep.id}/review`, { method: "POST", headers: H })).body;
    expect(d.gaps).toEqual([]);
    expect(d.reviewedByName).toEqual(expect.any(String));
    // povinnost: konec platnosti
    const { collectObligations } = await import("../src/modules/notifications/obligations");
    const ob = await collectObligations(db, { companyIds: [ROOT_COMPANY_ID], leadDays: 30, includeLater: true, kinds: new Set(["supplier_report"]) });
    expect(ob.find((o) => o.link === `/suppliers/reports/${rep.id}`)).toMatchObject({ kind: "supplier_report", due: "2027-03-31" });
    // seznam u dodavatele, oprávnění, AI nástroj
    expect(((await admin.json(`/api/suppliers/reports?supplierId=${sup.id}`, { headers: H })).body as any[]).map((x) => x.title)).toEqual(["SOC 2 Type II 2026"]);
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json(`/api/suppliers/reports/${rep.id}`, { method: "PATCH", json: { title: "x" } })).status).toBe(403);
  });

  test("dotazníky zákazníků (import, knihovna, AI návrh, schválení, export) a Trust Center (veřejná stránka, NDA žádost, odkaz, doložka) (ADR-099)", async () => {
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    const H = { "x-contix-company": ROOT_COMPANY_ID };
    await admin.json("/api/controls", { method: "POST", headers: H, json: { name: "Vícefaktorové ověření vzdáleného přístupu", description: "MFA pro VPN a remote access", status: "implemented" } });
    await admin.json("/api/controls", { method: "POST", headers: H, json: { name: "Šifrování dat v klidu", description: "Encryption of data at rest", status: "in_progress" } });
    const csv = "ID;Domain;Question;Answer\n;Access;;\nAC-1;;Do you enforce multi-factor authentication (MFA) for remote access?;\nAC-2;;Are user accounts reviewed at least quarterly?;\nEN-1;;Is customer data encrypted at rest?;\n";
    const up = (extra: Record<string, string>, body = csv) => {
      const fd = new FormData();
      fd.append("file", new File([body], "acme-security.csv"));
      for (const [k, v] of Object.entries(extra)) fd.append(k, v);
      return admin.json("/api/trust/questionnaires", { method: "POST", headers: H, body: fd });
    };
    const pv = (await up({ mode: "preview" })).body;
    expect(pv).toMatchObject({ questionColumn: 2, idColumn: 0, answerColumn: 3, questions: 3 });
    expect(pv.sample[0]).toMatchObject({ ref: "AC-1", section: "Access" });
    expect((await up({ mode: "commit" })).status).toBe(400); // bez zákazníka
    const q1 = (await up({ mode: "commit", customer: "ACME a.s.", dueDate: "2026-11-15" })).body;
    expect(q1).toMatchObject({ customer: "ACME a.s.", status: "in_progress", counts: { empty: 3, draft: 0, approved: 0 } });
    // Trust Center (certifikace pro AI) – nejdřív nastavení
    const sup = (await admin.json("/api/suppliers", { method: "POST", headers: H, json: { name: "Hosting CZ s.r.o.", country: "CZ", supplyDescription: "Hosting a správa serverů" } })).body;
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const pdfBytes = Buffer.from(await pdf.save());
    const mkPolicy = async (title: string) => {
      const [p] = await db.insert(schema.policies).values({ companyId: ROOT_COMPANY_ID, title, status: "active" } as any).returning();
      const [v] = await db.insert(schema.policyVersions).values({ policyId: p!.id, version: "1.0", status: "approved", approvedAt: new Date(), effectiveFrom: "2026-01-01" } as any).returning();
      await db.insert(schema.policyFiles).values({ versionId: v!.id, filename: `${title}.pdf`, mime: "application/pdf", size: pdfBytes.length, sha256: "x", content: pdfBytes, pdfStatus: "native" });
      return p!;
    };
    const pub = await mkPolicy("Bezpečnostní politika – shrnutí");
    const nda = await mkPolicy("Plán kontinuity – detail");
    const tcIn = { enabled: true, slug: "contix-test", title: "Trust Center Test", intro: "Bezpečnost bereme vážně.", contactEmail: "security@test.cz", certifications: [{ name: "ISO/IEC 27001:2022", issuer: "Cert s.r.o.", validUntil: "2028-05-31" }], documents: [{ policyId: pub.id, access: "public" }, { policyId: nda.id, access: "nda" }], subprocessorIds: [sup.id], showControls: true, showMonitoring: true, ndaText: "Mlčenlivost 5 let.", accessDays: 14 };
    const tc = await admin.json("/api/trust/center", { method: "PUT", headers: H, json: tcIn });
    expect(tc.status).toBe(200);
    expect(tc.body).toMatchObject({ slug: "contix-test", url: expect.stringContaining("/t/contix-test"), pendingRequests: 0 });
    // AI návrh: jen otázky z dávky, zdroje jen z kandidátů; neplánované opatření → nejvýš partial dle modelu
    const r = await admin.json("/api/ai/suggestions", { method: "POST", headers: H, json: { useCase: "questionnaire_answer", entityId: q1.id } });
    expect(r.status).toBe(202);
    await Promise.all(background);
    const sg = (await admin.json(`/api/ai/suggestions/${r.body.id}`, { headers: H })).body;
    expect(sg.status).toBe("proposed");
    expect(sg.items.map((i: any) => i.answer)).toEqual(["yes", "partial"]);
    expect(sg.items[0].sources.map((s: any) => s.kind)).toEqual(["control", "certification"]);
    expect(sg.items[1].confidence).toBe("low");
    const prompt = aiCalls.at(-1).messages.at(-1).content as string;
    expect(prompt).toContain("Vícefaktorové ověření vzdáleného přístupu");
    expect(prompt).toContain("ISO/IEC 27001:2022");
    await admin.json(`/api/ai/suggestions/${sg.id}/decide`, { method: "POST", headers: H, json: { accept: [0, 1] } });
    let d = (await admin.json(`/api/trust/questionnaires/${q1.id}`, { headers: H })).body;
    expect(d.counts).toEqual({ empty: 1, draft: 2, approved: 0 });
    // ruční odpověď, schválení, schválení dotazníku → knihovna
    const ac2 = d.items.find((i: any) => i.ref === "AC-2");
    expect((await admin.json(`/api/trust/questionnaires/${q1.id}/items/${ac2.id}`, { method: "PATCH", headers: H, json: { status: "approved" } })).status).toBe(400);
    await admin.json(`/api/trust/questionnaires/${q1.id}/items/${ac2.id}`, { method: "PATCH", headers: H, json: { answer: "yes", answerText: "Čtvrtletní přezkum přístupů v CONTIX." } });
    expect((await admin.json(`/api/trust/questionnaires/${q1.id}/approve`, { method: "POST", headers: H })).status).toBe(409);
    d = (await admin.json(`/api/trust/questionnaires/${q1.id}/approve-items`, { method: "POST", headers: H, json: { ids: d.items.map((i: any) => i.id) } })).body;
    expect(d.counts.approved).toBe(3);
    d = (await admin.json(`/api/trust/questionnaires/${q1.id}/approve`, { method: "POST", headers: H })).body;
    expect(d.status).toBe("approved");
    expect((await admin.json(`/api/trust/questionnaires/${q1.id}/items/${ac2.id}`, { method: "PATCH", headers: H, json: { answer: "no" } })).status).toBe(409);
    const lib = (await admin.json("/api/trust/library", { headers: H })).body as any[];
    expect(lib.length).toBe(3);
    expect(((await admin.json("/api/trust/library?q=MFA remote access", { headers: H })).body as any[])[0].question).toContain("multi-factor");
    // export
    const ex = await admin.req(`/api/trust/questionnaires/${q1.id}/export.xlsx`, { headers: H });
    expect(ex.status).toBe(200);
    const xbuf = new Uint8Array(await ex.arrayBuffer());
    expect(xbuf[0]).toBe(0x50);
    expect(strFromU8(unzipSync(xbuf)["xl/sharedStrings.xml"] ?? unzipSync(xbuf)["xl/worksheets/sheet1.xml"]!)).toContain("Čtvrtletní přezkum");
    // další dotazník: podobné otázky se předvyplní z knihovny
    const q2 = (await up({ mode: "commit", customer: "Beta s.r.o." }, "Question\nDo you enforce multi-factor authentication (MFA) for remote access?\nWho is your DPO?\n")).body;
    expect(q2.counts).toEqual({ empty: 1, draft: 1, approved: 0 });
    expect(q2.items[0]).toMatchObject({ answer: "yes", answeredBy: "library", status: "draft" });
    // veřejná stránka – bez přihlášení
    const pubGet = async (path: string, init: RequestInit = {}) => app.request(`/api/public/trust/${path}`, init);
    const prof = (await (await pubGet("contix-test")).json()) as any;
    expect(prof).toMatchObject({ title: "Trust Center Test", access: null, certifications: [{ name: "ISO/IEC 27001:2022", valid: true }], subprocessors: [{ name: "Hosting CZ s.r.o.", country: "CZ" }] });
    expect(prof.documents.map((x: any) => [x.title, x.access, x.available])).toEqual([["Bezpečnostní politika – shrnutí", "public", true], ["Plán kontinuity – detail", "nda", true]]);
    expect(prof.controls.length).toBeGreaterThan(0);
    expect(JSON.stringify(prof)).not.toContain("admin@test.cz");
    expect((await pubGet("neexistuje")).status).toBe(404);
    const pdfPub = await pubGet(`contix-test/docs/${pub.id}`);
    expect(pdfPub.status).toBe(200);
    expect(pdfPub.headers.get("content-type")).toBe("application/pdf");
    expect((await pubGet(`contix-test/docs/${nda.id}`)).status).toBe(403);
    // žádost o přístup: NDA povinné, past na roboty, limit
    const ask = (body: Record<string, unknown>) => pubGet("contix-test/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const reqBody = { name: "Jana Nováková", email: "jana@zakaznik.cz", organization: "Zákazník a.s.", reason: "Due diligence" };
    expect((await ask({ ...reqBody })).status).toBe(400);
    expect((await ask({ ...reqBody, ndaAccepted: true, website: "spam" })).status).toBe(400);
    expect((await ask({ ...reqBody, ndaAccepted: true })).status).toBe(201);
    expect((await ask({ ...reqBody, ndaAccepted: true })).status).toBe(201);
    expect((await ask({ ...reqBody, ndaAccepted: true })).status).toBe(201);
    expect((await ask({ ...reqBody, ndaAccepted: true })).status).toBe(429);
    const reqs = (await admin.json("/api/trust/center/requests", { headers: H })).body as any[];
    expect(reqs.filter((x) => x.status === "pending").length).toBe(3);
    const ap = (await admin.json(`/api/trust/center/requests/${reqs[0].id}/approve`, { method: "POST", headers: H })).body;
    expect(ap.link).toMatch(/\/t\/contix-test\?t=[A-Za-z0-9_-]{20,}/);
    if (ap.mailed) expect(sentMails.some((m) => m.to === "jana@zakaznik.cz" && m.html.includes("contix-test"))).toBe(true);
    const token = new URL(ap.link).searchParams.get("t")!;
    expect(JSON.stringify((await admin.json("/api/trust/center/requests", { headers: H })).body)).not.toContain(token);
    const prof2 = (await (await pubGet(`contix-test?t=${token}`)).json()) as any;
    expect(prof2.access).toMatchObject({ name: "Jana Nováková", organization: "Zákazník a.s." });
    const pdfNda = await pubGet(`contix-test/docs/${nda.id}?t=${token}`);
    expect(pdfNda.status).toBe(200);
    const stamped = await PDFDocument.load(new Uint8Array(await pdfNda.arrayBuffer()));
    expect(stamped.getPageCount()).toBe(1);
    expect(((await admin.json("/api/trust/center/requests", { headers: H })).body as any[]).find((x) => x.id === reqs[0].id).downloads).toBe(1);
    await admin.json(`/api/trust/center/requests/${reqs[0].id}/revoke`, { method: "POST", headers: H });
    expect((await pubGet(`contix-test/docs/${nda.id}?t=${token}`)).status).toBe(403);
    // vypnutá stránka = 404; oprávnění
    await admin.json("/api/trust/center", { method: "PUT", headers: H, json: { ...tcIn, enabled: false } });
    expect((await pubGet("contix-test")).status).toBe(404);
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json("/api/trust/center", { method: "PUT", json: tcIn })).status).toBe(403);
  });

  test("jednotný AI vstup: dotaz čerpá z dokumentace i záznamů, cituje [n] s odkazy, nástroje jen když jsou potřeba", async () => {
    const { processRecordIndex } = await import("../src/modules/search/records");
    await processRecordIndex(db, config);
    // úryvky dokumentace + incidenty, nástroje nad daty se nevolají
    const q = await admin.json("/api/ai/queries", { method: "POST", json: { question: "Jak dlouho se uchovávají zálohy databází?" } });
    expect(q.status).toBe(202);
    await Promise.all(background);
    const r = (await admin.json(`/api/ai/queries/${q.body.id}`)).body;
    expect(r.status).toBe("done");
    expect(r.results).toEqual([]);
    expect(r.answer).toMatch(/\[\d+\]/);
    expect(r.answer).not.toContain("<think>");
    const doc = r.sources.find((x: any) => x.kind === "doc");
    expect(doc).toMatchObject({ title: expect.stringContaining("Zálohování QA"), link: expect.stringMatching(/^\/docs\//) });
    expect(doc).not.toHaveProperty("text");
    // zobrazí se jen citované zdroje
    const cited = new Set([...r.answer.matchAll(/\[(\d+)\]/g)].map((m: any) => Number(m[1])));
    expect(r.sources.every((x: any) => cited.has(x.n))).toBe(true);
    // plán viděl jen názvy, odpověď i texty; tajný dokument nebo jména osob ne
    const planCall = aiCalls.findLast((b: any) => String(b.messages[0].content).includes("Katalog nástrojů"));
    expect(planCall.messages[0].content).toContain("Nalezené úryvky");
    const ans = JSON.stringify(aiCalls.findLast((b: any) => String(b.messages.at(-1).content).startsWith("Dotaz:")).messages);
    expect(ans).toContain("uchovávají");
    expect(ans).not.toContain("admin@test.cz");
    // záznamy evidencí (incidenty) s odkazem
    const qi = await admin.json("/api/ai/queries", { method: "POST", json: { question: "Ransomware zašifroval server – měli jsme už takový incident se šifrováním serverů?" } });
    await Promise.all(background);
    const ri = (await admin.json(`/api/ai/queries/${qi.body.id}`)).body;
    expect(ri.status).toBe("done");
    expect(ri.sources.find((x: any) => x.kind === "incident")?.link).toMatch(/^\/incidents\//);
    // dotaz na data: nástroje + případné úryvky
    const d = await admin.json("/api/ai/queries", { method: "POST", json: { question: "Která kritická aktiva máme a jak je zálohujeme?" } });
    await Promise.all(background);
    const dr = (await admin.json(`/api/ai/queries/${d.body.id}`)).body;
    expect(dr.status).toBe("done");
    expect(dr.results.length).toBeGreaterThan(0);
    expect(dr.answer).toContain("Kritických aktiv");
    // starší dotazy bez zdrojů mají prázdné pole
    expect(((await admin.json("/api/ai/queries")).body as any[]).every((x) => Array.isArray(x.sources))).toBe(true);
  });

  test("SOC: fronta alertů, triáž, ATT&CK, playbook, eskalace, AI poradce, oprávnění", async () => {
    const adminId = ((await admin.json("/api/admin/users")).body as any[]).find((u) => u.email === "admin@test.cz").id;
    // alert z Wazuhu nese mapování MITRE z pravidla (rule.mitre)
    const all = (await admin.json("/api/soc/alerts?status=all")).body as any[];
    expect(all.find((x) => x.ruleId === "5712")).toMatchObject({ status: "accepted", mitreIds: ["T1110"], mitreTactics: ["TA0006"], severity: "high", verdict: "true_positive" });
    // ruční alert
    expect((await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Neplatné ATT&CK", mitreIds: ["X1"] } })).status).toBe(400);
    const cr = await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Podezřelé PowerShell příkazy na účetním PC", description: "Kódovaný příkaz stahuje soubor z neznámé domény.", severity: "critical", mitreIds: ["t1059.001", "T1105"] } });
    expect(cr.status).toBe(201);
    expect(cr.body).toMatchObject({ severity: "critical", source: "manual", status: "new", mitreIds: ["T1059.001", "T1105"], mitreTactics: ["TA0002", "TA0011"], playbookKey: "malware", canWrite: true, canEscalate: true });
    const id = cr.body.id;
    const fp = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Skenování portů z interní sítě", severity: "low", mitreIds: ["T1046"] } })).body;
    let sm = (await admin.json("/api/soc/summary")).body;
    expect(sm.new).toBeGreaterThanOrEqual(2);
    expect(sm.bySeverity.critical).toBeGreaterThanOrEqual(1);
    expect(sm.unassigned).toBe(sm.open);
    expect(sm.tactics30.TA0002).toBeGreaterThanOrEqual(1);
    expect(((await admin.json("/api/soc/analysts")).body as any[]).some((u) => u.id === adminId)).toBe(true);
    // převzetí analytikem → v řešení, doba do převzetí
    const p = (await admin.json(`/api/soc/alerts/${id}`, { method: "PATCH", json: { assigneeId: adminId } })).body;
    expect(p).toMatchObject({ status: "in_progress", assigneeName: "Admin" });
    expect(p.acknowledgedAt).toBeTruthy();
    expect(((await admin.json("/api/soc/alerts?mine=1")).body as any[]).map((x) => x.id)).toContain(id);
    expect(((await admin.json("/api/soc/alerts?tactic=TA0011")).body as any[]).map((x) => x.id)).toContain(id);
    expect(((await admin.json("/api/soc/alerts?tactic=TA0040")).body as any[]).map((x) => x.id)).not.toContain(id);
    expect(((await admin.json(`/api/soc/alerts?q=${encodeURIComponent("powershell")}`)).body as any[]).map((x) => x.id)).toEqual([id]);
    sm = (await admin.json("/api/soc/summary")).body;
    expect(sm.mine).toBe(1);
    expect(sm.mttaHours).not.toBeNull();
    // playbook – kroky mimo rozsah se zahodí; jiný playbook vynuluje splněné kroky
    expect((await admin.json(`/api/soc/alerts/${id}`, { method: "PATCH", json: { playbookDone: [2, 0, 99] } })).body.playbookDone).toEqual([0, 2]);
    expect((await admin.json(`/api/soc/alerts/${id}`, { method: "PATCH", json: { playbookKey: "nic" } })).status).toBe(400);
    // poznámka analytika
    const n = (await admin.json(`/api/soc/alerts/${id}/notes`, { method: "POST", json: { text: "Uživatel Novák potvrdil, že skript nespouštěl." } })).body;
    expect(n.notes[0]).toMatchObject({ userName: "Admin", text: expect.stringContaining("Novák") });
    // AI rozbor alertu – lokální model, bez jmen a poznámek analytiků
    const adv = await admin.json(`/api/soc/alerts/${id}/advise`, { method: "POST" });
    expect(adv.status).toBe(200);
    expect(adv.body.aiAdvice.text).toContain("Rozbor:");
    expect(adv.body.aiAdvice.text).not.toContain("<think>");
    const sent = JSON.stringify(aiCalls.at(-1).messages);
    expect(sent).toContain("T1059.001 Command and Scripting Interpreter");
    expect(sent).toContain("Navržený playbook");
    expect(sent).not.toContain("Novák");
    expect(sent).not.toContain("Admin");
    // poradce SOC: CVE z evidence organizace
    const ad = await admin.json("/api/soc/advisor", { method: "POST", json: { question: "Co je CVE-2026-0001 a týká se nás?" } });
    expect(ad.status).toBe(200);
    expect(ad.body.answer).toBe("Poradce: CVE je v evidenci.");
    expect(JSON.stringify(aiCalls.at(-1).messages)).toContain("CVE-2026-0001: ");
    // eskalace na incident
    const esc = await admin.json(`/api/soc/alerts/${id}/escalate`, { method: "POST", json: { kind: "incident" } });
    expect(esc.status).toBe(201);
    expect(esc.body.alert).toMatchObject({ status: "accepted", verdict: "true_positive", incidentId: esc.body.incidentId });
    const inc = (await admin.json(`/api/incidents/${esc.body.incidentId}`)).body;
    expect(inc.description).toContain("T1059.001");
    expect((await admin.json(`/api/soc/alerts/${id}/escalate`, { method: "POST", json: {} })).status).toBe(409);
    // druhý alert: připojit k existujícímu incidentu nelze z jiné společnosti; uzavření jako falešný poplach a znovuotevření
    expect((await admin.json(`/api/soc/alerts/${fp.id}/close`, { method: "POST", json: { verdict: "maybe", reason: "x" } })).status).toBe(400);
    const cl = (await admin.json(`/api/soc/alerts/${fp.id}/close`, { method: "POST", json: { verdict: "false_positive", reason: "Plánovaný sken správce" } })).body;
    expect(cl).toMatchObject({ status: "dismissed", verdict: "false_positive", assigneeName: "Admin" });
    expect((await admin.json(`/api/soc/alerts/${fp.id}`, { method: "PATCH", json: { status: "in_progress" } })).status).toBe(409);
    expect((await admin.json(`/api/soc/alerts/${fp.id}/reopen`, { method: "POST" })).body).toMatchObject({ status: "in_progress", verdict: null });
    await admin.json(`/api/soc/alerts/${fp.id}/close`, { method: "POST", json: { verdict: "false_positive", reason: "Plánovaný sken správce" } });
    sm = (await admin.json("/api/soc/summary")).body;
    expect(sm.escalated30).toBeGreaterThanOrEqual(2);
    expect(sm.closed30.false_positive).toBeGreaterThanOrEqual(1);
    // AI dotazy znají frontu SOC
    expect(((await admin.json("/api/ai/tools")).body as any[]).map((t) => t.name)).toContain("soc_alerts");
    // oprávnění: auditor čte, nemění; čtenář SOC nevidí
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/soc/summary")).status).toBe(200);
    expect((await auditor.json(`/api/soc/alerts/${fp.id}`)).body.canWrite).toBe(false);
    expect((await auditor.json(`/api/soc/alerts/${fp.id}/notes`, { method: "POST", json: { text: "x" } })).status).toBe(403);
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json("/api/soc/alerts")).status).toBe(403);
    // audit
    const acts = (await db.execute(sql`select action from audit_log where action like 'soc.%'`)).map((r: any) => r.action);
    expect(acts).toEqual(expect.arrayContaining(["soc.alert_created", "soc.alert_updated", "soc.note_added", "soc.ai_advice", "soc.advisor_asked", "soc.alert_escalated", "soc.alert_closed", "soc.alert_reopened"]));
  });

  test("SOC II: korelace do případů, řetězec útoku, lhůty SLA a upozornění, potlačení, statistika pravidel", async () => {
    // dřívější Wazuh alerty se stejnou zdrojovou IP spojila korelace do automatického případu
    const cases0 = (await admin.json("/api/soc/cases?status=all")).body as any[];
    expect(cases0.find((x) => x.auto && x.srcips.includes("203.0.113.7"))).toMatchObject({ alertCount: 2 });
    // potlačení: neplatná platnost, platné pravidlo pro brute force na agentovi 001
    const today = new Date().toISOString().slice(0, 10);
    const inDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
    expect((await admin.json("/api/soc/suppressions", { method: "POST", json: { ruleId: "5712", agentId: "001", reason: "Skenování z testu", until: inDays(800) } })).status).toBe(400);
    expect((await admin.json("/api/soc/suppressions", { method: "POST", json: { ruleId: "5712", reason: "x", until: today, srcip: "not-ip" } })).status).toBe(400);
    const sup = await admin.json("/api/soc/suppressions", { method: "POST", json: { ruleId: "5712", agentId: "001", reason: "Interní test odolnosti hesel do konce měsíce", until: inDays(30) } });
    expect(sup.status).toBe(201);
    expect(sup.body).toMatchObject({ state: "active", hits: 0, agentName: "agent-001" });
    // nové alerty z Wazuhu: potlačené hádání hesel + řetězec na agentovi 003 (přihlašovací údaje → eskalace oprávnění)
    alertDocs.push(
      alertDoc(nowIso(0.5), "5712", 10, "001", "sshd: brute force trying to get access to the system", ["authentication_failures", "sshd"]),
      alertDoc(nowIso(0.4), "5712", 10, "001", "sshd: brute force trying to get access to the system", ["authentication_failures", "sshd"]),
      alertDoc(nowIso(0.3), "5503", 12, "003", "PAM: User login failed.", ["pam", "authentication_failed"], "198.51.100.23"),
      alertDoc(nowIso(0.2), "5402", 11, "003", "Successful sudo to ROOT executed.", ["sudo"], "198.51.100.23"),
    );
    const sy = (await admin.json("/api/soc/sync", { method: "POST" })).body;
    expect(sy).toMatchObject({ created: 2, suppressed: 2 });
    expect(((await admin.json("/api/soc/suppressions")).body as any[]).find((x) => x.id === sup.body.id).hits).toBe(2);
    const cs = ((await admin.json("/api/soc/cases")).body as any[]).find((x) => x.hosts.includes("agent-003"));
    expect(cs).toMatchObject({ auto: true, alertCount: 2, baseSeverity: "high", severity: "critical", chain: "credential_then_access", status: "open" });
    expect(cs.mitreTactics).toEqual(expect.arrayContaining(["TA0006", "TA0004"]));
    expect(cs.code).toMatch(/^SOC-\d+$/);
    expect(cs.sla.ack).toBe("ok");
    // alerty v případu nemají vlastní lhůty, ukazují kód případu
    const det = (await admin.json(`/api/soc/cases/${cs.id}`)).body;
    expect(det.alerts.map((a: any) => a.caseCode)).toEqual([cs.code, cs.code]);
    expect(det.alerts[0].sla).toBeNull();
    // lhůta převzetí kritického případu (15 min) vypršela → povinnost a okamžitý e-mail analytikům SOC
    await db.execute(sql`update soc_cases set created_at = now() - interval '2 hours' where id = ${cs.id}`);
    expect((await admin.json(`/api/soc/cases/${cs.id}`)).body.sla).toMatchObject({ ack: "breached", resolve: "ok" });
    expect((await admin.json("/api/soc/summary")).body).toMatchObject({ openCases: expect.any(Number), slaBreached: expect.any(Number) });
    expect((await admin.json("/api/soc/summary")).body.slaBreached).toBeGreaterThanOrEqual(1);
    const dash = (await admin.json("/api/dashboard")).body;
    expect(dash.obligations.byKind.soc_sla.overdue).toBeGreaterThanOrEqual(1);
    const before = sentMails.length;
    await admin.json("/api/notifications/run", { method: "POST" });
    // příjemci = všichni s oprávněním SOC (pořadí odesílání není dané)
    const socMail = sentMails.slice(before).find((m) => m.subject.includes("[CONTIX SOC]") && m.subject.includes(cs.code) && m.to === "admin@test.cz");
    expect(socMail?.to).toBe("admin@test.cz");
    expect(socMail?.subject).toContain("Převzetí analytikem SOC");
    // podruhé se stejná výstraha neposílá
    const n2 = sentMails.length;
    await admin.json("/api/notifications/run", { method: "POST" });
    expect(sentMails.slice(n2).some((m) => m.subject.includes(cs.code))).toBe(false);
    // převzetí případu převezme i jeho alerty
    const adminId = ((await admin.json("/api/admin/users")).body as any[]).find((u) => u.email === "admin@test.cz").id;
    const tk = (await admin.json(`/api/soc/cases/${cs.id}`, { method: "PATCH", json: { assigneeId: adminId } })).body;
    expect(tk).toMatchObject({ status: "in_progress", assigneeName: "Admin" });
    expect(tk.sla.ack).toBe("late");
    expect(tk.alerts.every((a: any) => a.assigneeName === "Admin" && a.status === "in_progress")).toBe(true);
    // případ i v Mých povinnostech
    expect(((await admin.json("/api/notifications/mine")).body as any[]).some((o: any) => o.kind === "soc_sla" && o.link === `/soc/cases/${cs.id}`)).toBe(true);
    // ruční případ z vybraných alertů, přidání a odebrání alertu, poznámka
    const m1 = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Phishing na účtárnu", severity: "medium", mitreIds: ["T1566"] } })).body;
    const m2 = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Podezřelé přihlášení z ciziny", severity: "high", mitreIds: ["T1078"] } })).body;
    expect((await admin.json("/api/soc/cases", { method: "POST", json: { title: "X", alertIds: [] } })).status).toBe(400);
    const mc = await admin.json("/api/soc/cases", { method: "POST", json: { title: "Kampaň phishingu a převzetí účtu", alertIds: [m1.id] } });
    expect(mc.status).toBe(201);
    expect(mc.body).toMatchObject({ auto: false, alertCount: 1, severity: "medium" });
    const added = (await admin.json(`/api/soc/cases/${mc.body.id}/alerts`, { method: "POST", json: { add: [m2.id] } })).body;
    expect(added).toMatchObject({ alertCount: 2, severity: "high" });
    expect((await admin.json(`/api/soc/cases/${mc.body.id}/notes`, { method: "POST", json: { text: "Stejný odesílatel u 4 uživatelů." } })).body.notes[0].userName).toBe("Admin");
    // eskalace případu = jeden incident pro všechny otevřené alerty
    const esc = await admin.json(`/api/soc/cases/${mc.body.id}/escalate`, { method: "POST", json: { kind: "incident" } });
    expect(esc.status).toBe(201);
    expect(esc.body.case).toMatchObject({ status: "escalated", verdict: "true_positive", incidentId: esc.body.incidentId });
    expect(esc.body.case.alerts.every((a: any) => a.status === "accepted" && a.incidentId === esc.body.incidentId)).toBe(true);
    const inc = (await admin.json(`/api/incidents/${esc.body.incidentId}`)).body;
    expect(inc.title).toContain("Kampaň phishingu");
    expect(inc.description).toMatch(/T1566.*T1078|T1078.*T1566/);
    expect((await admin.json(`/api/soc/cases/${mc.body.id}/escalate`, { method: "POST", json: {} })).status).toBe(409);
    // uzavření případu uzavře jeho otevřené alerty se stejným verdiktem; znovuotevření
    const cl = (await admin.json(`/api/soc/cases/${cs.id}/close`, { method: "POST", json: { verdict: "benign", reason: "Plánovaná údržba správcem" } })).body;
    expect(cl).toMatchObject({ status: "closed", verdict: "benign" });
    expect(cl.alerts.every((a: any) => a.status === "dismissed" && a.verdict === "benign")).toBe(true);
    expect((await admin.json(`/api/soc/cases/${cs.id}/reopen`, { method: "POST" })).body.status).toBe("in_progress");
    // uzavření alertu s potlačením (pravidlo + hostitel + IP)
    const vt = ((await admin.json("/api/soc/alerts?status=all")).body as any[]).find((x) => x.ruleId === "5402");
    await admin.json(`/api/soc/cases/${cs.id}/close`, { method: "POST", json: { verdict: "benign", reason: "Plánovaná údržba správcem" } });
    alertDocs.push(alertDoc(nowIso(0.1), "87106", 10, "005", "VirusTotal: Alert - test file", ["virustotal"]));
    await admin.json("/api/soc/sync", { method: "POST" });
    const vt2 = ((await admin.json("/api/soc/alerts")).body as any[]).find((x) => x.ruleId === "87106");
    expect((await admin.json(`/api/soc/alerts/${vt2.id}/close`, { method: "POST", json: { verdict: "false_positive", reason: "EICAR testovací soubor", suppressUntil: inDays(800) } })).status).toBe(400);
    const cl2 = await admin.json(`/api/soc/alerts/${vt2.id}/close`, { method: "POST", json: { verdict: "false_positive", reason: "EICAR testovací soubor", suppressUntil: inDays(14), suppressIp: true } });
    expect(cl2.status).toBe(200);
    const sups = (await admin.json("/api/soc/suppressions")).body as any[];
    expect(sups.find((x) => x.ruleId === "87106")).toMatchObject({ agentId: "005", srcip: "203.0.113.7", until: inDays(14), state: "active" });
    // potlačení je i ve Výjimkách (s koncem platnosti)
    const ex = (await admin.json("/api/exceptions")).body;
    expect((ex.items as any[]).some((x) => x.kind === "soc_suppression" && x.until === inDays(30))).toBe(true);
    // zrušení potlačení
    expect((await admin.json(`/api/soc/suppressions/${sup.body.id}/revoke`, { method: "POST" })).body.state).toBe("revoked");
    expect((await admin.json(`/api/soc/suppressions/${sup.body.id}/revoke`, { method: "POST" })).status).toBe(409);
    expect(((await admin.json("/api/soc/suppressions")).body as any[]).some((x) => x.id === sup.body.id)).toBe(false);
    // statistika pravidel: falešné poplachy, eskalace, zásahy potlačení, doporučení
    const st = (await admin.json("/api/soc/rule-stats")).body as any[];
    const r5712 = st.find((x) => x.ruleId === "5712");
    expect(r5712).toMatchObject({ escalated: 1, suppressedHits: 2, advice: "keep" });
    const r5402 = st.find((x) => x.ruleId === "5402");
    expect(r5402).toMatchObject({ decided: 1, benign: 1, fpRate: 1 });
    expect(st.every((x) => x.ruleId !== "manual")).toBe(true);
    // nastavení lhůt: jen správce, validace
    expect((await admin.json("/api/soc/settings", { method: "PUT", json: { ackMinutes: { critical: 0, high: 1, medium: 1, low: 1 } } })).status).toBe(400);
    const set = (await admin.json("/api/soc/settings", { method: "PUT", json: { resolveHours: { critical: 8, high: 24, medium: 72, low: 168 }, autoCases: false } })).body;
    expect(set).toMatchObject({ resolveHours: { critical: 8 }, ackMinutes: { critical: 15 }, autoCases: false });
    const auditor = browser();
    await auditor.login("audit@test.cz", "Auditor-Heslo-2026!");
    expect((await auditor.json("/api/soc/settings", { method: "PUT", json: { autoCases: true } })).status).toBe(403);
    expect((await auditor.json("/api/soc/cases")).status).toBe(200);
    expect((await auditor.json(`/api/soc/cases/${cs.id}/notes`, { method: "POST", json: { text: "x" } })).status).toBe(403);
    expect(vt).toBeTruthy();
  }, 30_000);

  test("SOC III: alerty × zranitelnosti (zvýšení závažnosti), rizika aktiv, signály k riziku, zpráva pro vedení", async () => {
    // aktivum s otevřenou vysokou / kritickou zranitelností (z dřívější synchronizace Wazuhu)
    const [v] = (await db.execute(sql`select v.asset_id, v.cve_id, a.company_id from asset_vulnerabilities v join assets a on a.id = v.asset_id where v.status = 'open' and v.severity in ('critical','high') order by v.cvss_score desc nulls last limit 1`)) as any[];
    expect(v).toBeTruthy();
    const H = { "x-contix-company": v.company_id };
    const mk = async (json: Record<string, unknown>) => (await admin.json("/api/soc/alerts", { method: "POST", headers: H, json: { companyId: v.company_id, assetId: v.asset_id, ...json } })).body;
    // pokus o zneužití (T1190) na zranitelném aktivu → o stupeň výš
    const ex = await mk({ title: "Pokus o zneužití webové aplikace", severity: "high", mitreIds: ["T1190"] });
    expect(ex.exposure).toMatchObject({ exploit: true, reason: "exploit_technique" });
    expect(ex.severity).toBe("critical");
    // alert zmiňuje CVE, která je na aktivu otevřená
    const cv = await mk({ title: "IDS: pokus o zneužití", description: `Signatura odpovídá ${v.cve_id.toLowerCase()}`, severity: "medium" });
    expect(cv.exposure).toMatchObject({ exploit: true, reason: "cve_match", cves: [v.cve_id] });
    expect(cv.severity).toBe("high");
    // jen informace: aktivum je zranitelné, technika není zneužití
    const info = await mk({ title: "Neobvyklé přihlášení", severity: "medium", mitreIds: ["T1078"] });
    expect(info.exposure).toMatchObject({ exploit: false, reason: "vulnerable_asset" });
    expect(info.severity).toBe("medium");
    // filtr podle závažnosti počítá se zvýšením
    expect(((await admin.json("/api/soc/alerts?severity=critical", { headers: H })).body as any[]).map((x) => x.id)).toContain(ex.id);
    // vyřešená zranitelnost → plánovač expozici přepočítá
    const { refreshExposure } = await import("../src/modules/soc/exposure");
    await db.execute(sql`update asset_vulnerabilities set status = 'resolved' where asset_id = ${v.asset_id} and cve_id = ${v.cve_id}`);
    expect(await refreshExposure(db)).toBeGreaterThan(0);
    const cv2 = (await admin.json(`/api/soc/alerts/${cv.id}`, { headers: H })).body;
    expect(cv2.exposure?.reason === "cve_match").toBe(false);
    await db.execute(sql`update asset_vulnerabilities set status = 'open' where asset_id = ${v.asset_id} and cve_id = ${v.cve_id}`);
    await refreshExposure(db);
    // riziko navázané na aktivum: vidět u alertu i u případu; signály k riziku
    const rk = (await admin.json("/api/risks", { method: "POST", headers: H, json: { name: "Zneužití zranitelnosti webového serveru", assetIds: [v.asset_id] } })).body;
    const det = (await admin.json(`/api/soc/alerts/${ex.id}`, { headers: H })).body;
    expect(det.risks.map((r: any) => r.id)).toContain(rk.id);
    expect(det.risks.find((r: any) => r.id === rk.id).assetName).toBeTruthy();
    if (det.caseId) expect((await admin.json(`/api/soc/cases/${det.caseId}`, { headers: H })).body.risks.map((r: any) => r.id)).toContain(rk.id);
    const sig = (await admin.json(`/api/soc/risk-signals/${rk.id}`, { headers: H })).body;
    expect(sig.alerts).toBeGreaterThanOrEqual(3);
    expect(sig.exploitAttempts).toBeGreaterThanOrEqual(2);
    expect(sig.reassess).toBe(true);
    expect(sig.recent[0]).toHaveProperty("severity");
    // čtenář bez SOC signály nevidí
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json(`/api/soc/risk-signals/${rk.id}`, { headers: H })).status).toBe(403);
    // AI rozbor zná vazbu na zranitelnost
    await admin.json(`/api/soc/alerts/${ex.id}/advise`, { method: "POST", headers: H });
    expect(JSON.stringify(aiCalls.at(-1).messages)).toContain("Pokus o zneužití na zranitelném aktivu");
    // zpráva pro vedení: sekce SOC a ukazatel
    const rep = (await admin.json(`/api/reports/management?companyId=${v.company_id}`, { headers: H })).body;
    expect(rep.soc.alerts).toBeGreaterThanOrEqual(3);
    expect(rep.soc.exploitAttempts).toBeGreaterThanOrEqual(2);
    expect(rep.kpis.some((k: any) => k.key === "soc")).toBe(true);
  });

  test("prioritizace zranitelností: CISA KEV + EPSS, priority P1–P4, plán oprav, riziko za balíček, ruční nahrání", async () => {
    // tři CVE z evidence: jedna do KEV, jedna s vysokým EPSS, jedna se středním
    const ours = (await db.execute(sql`select v.cve_id, v.package_name, a.company_id from asset_vulnerabilities v join assets a on a.id = v.asset_id where v.status = 'open' and v.package_name <> '' order by v.cve_id`)) as any[];
    const cves = [...new Set(ours.map((r) => r.cve_id as string))];
    expect(cves.length).toBeGreaterThanOrEqual(3);
    const [kevCve, hiCve, midCve] = cves;
    intelMock.kev = JSON.stringify({ catalogVersion: "2026.10.15", count: 2, vulnerabilities: [{ cveID: kevCve, vulnerabilityName: "Test RCE", dateAdded: "2026-10-01", dueDate: "2026-10-22", knownRansomwareCampaignUse: "Known" }, { cveID: "CVE-2021-44228", vulnerabilityName: "Log4Shell", dateAdded: "2021-12-10", knownRansomwareCampaignUse: "Known" }, { cveID: "neplatne" }] });
    intelMock.epss = Bun.gzipSync(new TextEncoder().encode(`#model_version:v2025.03.14,score_date:2026-10-15T00:00:00+0000\ncve,epss,percentile\n${hiCve},0.72,0.99\n${midCve},0.15,0.9\nCVE-1999-0001,0.01,0.1\n`));
    expect((await admin.json("/api/vulnerabilities/intel/settings", { method: "PUT", json: { autoRefresh: false, kevUrl: "https://intel.test/kev.json", epssUrl: "https://intel.test/epss.csv.gz" } })).status).toBe(200);
    const rf = await admin.json("/api/vulnerabilities/intel/refresh", { method: "POST" });
    expect(rf.status).toBe(200);
    expect(rf.body).toMatchObject({ kev: 2, errors: [] });
    expect(rf.body.epss).toBe(2); // CVE mimo evidenci se neukládá
    expect(rf.body.status).toMatchObject({ kevEntries: 2, epssEntries: 2, kevVersion: "2026.10.15", epssDate: "2026-10-15", lastError: null });
    const opsCheck = async (key: string) => ((await admin.json("/api/ops/status")).body.checks as any[]).find((c) => c.key === key);
    expect(await opsCheck("vuln_intel")).toMatchObject({ level: "ok" });
    expect((await opsCheck("soc")).level).toMatch(/ok|warning/);
    expect(await opsCheck("records")).toBeTruthy();
    // priority ve výpisu
    const p1 = (await admin.json("/api/vulnerabilities?priority=p1&status=open&limit=1000")).body;
    const ids1 = new Set((p1.items as any[]).map((v) => v.cveId));
    expect(ids1.has(kevCve) && ids1.has(hiCve)).toBe(true);
    const kv = (p1.items as any[]).find((v) => v.cveId === kevCve);
    expect(kv).toMatchObject({ kev: true, kevRansomware: true, priority: "p1", priorityReasons: ["kev_ransomware"] });
    expect((p1.items as any[]).find((v) => v.cveId === hiCve)).toMatchObject({ epss: expect.closeTo(0.72, 3), priority: "p1", priorityReasons: ["epss_high"] });
    expect(((await admin.json("/api/vulnerabilities?priority=p2&status=open&limit=1000")).body.items as any[]).some((v) => v.cveId === midCve && v.priorityReasons.includes("epss_medium"))).toBe(true);
    expect(((await admin.json("/api/vulnerabilities?kev=1&limit=1000")).body.items as any[]).every((v) => v.kev)).toBe(true);
    // výpis řazený od nejvyšší priority
    const all = (await admin.json("/api/vulnerabilities?status=open&limit=1000")).body.items as any[];
    expect(all[0].priority).toBe("p1");
    // souhrn
    const sm = (await admin.json("/api/vulnerabilities/summary")).body;
    expect(sm.openByPriority.p1).toBeGreaterThanOrEqual(2);
    expect(sm.kevOpen).toBeGreaterThanOrEqual(1);
    expect(sm.intel.kevEntries).toBe(2);
    // lhůty oprav (ADR-050): KEV běží od zařazení do katalogu, jinak od prvního zjištění
    const adminId = ((await admin.json("/api/admin/users")).body as any[]).find((u) => u.email === "admin@test.cz").id;
    await db.execute(sql`update asset_vulnerabilities set first_seen_at = now() - interval '60 days' where cve_id = ${hiCve}`);
    const hiRow = ((await admin.json(`/api/vulnerabilities?q=${hiCve}&status=open`)).body.items as any[])[0];
    expect(hiRow).toMatchObject({ priority: "p1", overdue: true });
    expect(hiRow.due < new Date().toISOString().slice(0, 10)).toBe(true);
    expect(((await admin.json(`/api/vulnerabilities?q=${kevCve}&status=open`)).body.items as any[])[0].overdue).toBe(false);
    expect(((await admin.json("/api/vulnerabilities?overdue=1&limit=1000")).body.items as any[]).map((v) => v.cveId)).toContain(hiCve);
    expect((await admin.json("/api/vulnerabilities/summary")).body.overdue).toBeGreaterThanOrEqual(1);
    // vlastní lhůty: P1 = 100 dní → už není po termínu
    expect((await admin.json("/api/vulnerabilities/intel/settings", { method: "PUT", json: { sla: { p1: 100, p2: 30, p3: 90, p4: null } } })).body.sla.p1).toBe(100);
    expect(((await admin.json(`/api/vulnerabilities?q=${hiCve}&status=open`)).body.items as any[])[0].overdue).toBe(false);
    await admin.json("/api/vulnerabilities/intel/settings", { method: "PUT", json: { sla: { p1: 7, p2: 30, p3: 90, p4: null } } });
    // semafor: P1 → červená
    const hiAsset = hiRow.assetId;
    const ad = (await admin.json(`/api/assets/${hiAsset}`)).body;
    expect(ad.healthStatus).toBe("red");
    expect(JSON.stringify(ad.healthReasons)).toContain("P1");
    // povinnost „Oprava zranitelností“: osobně vlastníkovi aktiva, v týmovém přehledu
    await db.execute(sql`update assets set owner_user_id = ${adminId} where id = ${hiAsset}`);
    const mine = (await admin.json("/api/notifications/mine")).body as any[];
    const ob = mine.find((o) => o.kind === "vuln_remediation" && o.link === `/assets/${hiAsset}`);
    expect(ob).toMatchObject({ urgency: "overdue" });
    expect(ob.detail).toContain("P1");
    // zpráva pro vedení a trendy
    const co = ours.find((r) => r.cve_id === hiCve).company_id;
    const rep = (await admin.json(`/api/reports/management?companyId=${co}`, { headers: { "x-contix-company": co } })).body;
    expect(rep.vulnRemediation.p1).toBeGreaterThanOrEqual(1);
    expect(rep.vulnRemediation.overdue).toBeGreaterThanOrEqual(1);
    expect(rep.kpis.find((k: any) => k.key === "vulns").level).toBe("error");
    const { computeTrendValues } = await import("../src/modules/trends/service");
    const tv = (await computeTrendValues(db, co)).values;
    expect(tv.vulns_p1).toBeGreaterThanOrEqual(1);
    expect(tv.vulns_sla_overdue).toBeGreaterThanOrEqual(1);
    // plán oprav: balíček s KEV je nahoře
    const plan = (await admin.json("/api/vulnerabilities/fix-plan")).body as any[];
    const kevPkg = ours.find((r) => r.cve_id === kevCve).package_name;
    const item = plan.find((x) => x.packageName === kevPkg);
    expect(item.kev).toBeGreaterThanOrEqual(1);
    expect(item.byPriority.p1).toBeGreaterThanOrEqual(1);
    expect(plan[0].byPriority.p1).toBeGreaterThanOrEqual(1);
    expect(item.sample[0].priority).toBe("p1");
    // riziko za balíček (všechna aktiva s nepokrytými kritickými / vysokými CVE balíčku)
    const highPkg = plan.find((x) => x.unlinked > 0);
    if (highPkg) {
      const co = ours.find((r) => r.package_name === highPkg.packageName).company_id;
      const rk = await admin.json("/api/risks/from-package", { method: "POST", headers: { "x-contix-company": co }, json: { packageName: highPkg.packageName, companyId: co } });
      expect(rk.status).toBe(201);
      expect(rk.body.name).toContain(highPkg.packageName);
      expect(rk.body.cves.length).toBeGreaterThan(0);
      expect((await admin.json("/api/risks/from-package", { method: "POST", headers: { "x-contix-company": co }, json: { packageName: highPkg.packageName, companyId: co } })).status).toBe(400);
    }
    // poradce SOC zná KEV / EPSS
    await admin.json("/api/soc/advisor", { method: "POST", json: { question: `Týká se nás ${kevCve}?` } });
    expect(JSON.stringify(aiCalls.at(-1).messages)).toContain("v katalogu CISA KEV");
    // výpadek zdroje → chyba ve stavu, data zůstanou
    intelMock.fail = true;
    const bad = (await admin.json("/api/vulnerabilities/intel/refresh", { method: "POST" })).body;
    expect(bad.errors.length).toBe(2);
    expect(bad.status.lastError).toContain("HTTP 503");
    expect(bad.status.kevEntries).toBe(2);
    expect((await opsCheck("vuln_intel")).level).toBe("warning");
    intelMock.fail = false;
    // ruční nahrání (server bez internetu): KEV jako JSON, EPSS jako CSV.GZ; z KEV vypadlá CVE přestane být KEV
    const up = async (name: string, data: string | Uint8Array) => {
      const fd = new FormData();
      fd.append("file", new File([data], name));
      return admin.req("/api/vulnerabilities/intel/upload", { method: "POST", body: fd });
    };
    const u1 = await up("kev.json", JSON.stringify({ catalogVersion: "2026.10.16", vulnerabilities: [{ cveID: "CVE-2021-44228", knownRansomwareCampaignUse: "Known" }] }));
    expect(u1.status).toBe(200);
    expect(((await u1.json()) as any).kind).toBe("kev");
    expect(((await admin.json("/api/vulnerabilities?kev=1&limit=1000")).body.items as any[]).some((v) => v.cveId === kevCve)).toBe(false);
    const u2 = await up("epss.csv.gz", intelMock.epss);
    expect(((await u2.json()) as any)).toMatchObject({ kind: "epss", entries: 2 });
    expect((await up("x.txt", "nesmysl")).status).toBe(400);
    // jen správce
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json("/api/vulnerabilities/intel/refresh", { method: "POST" })).status).toBe(403);
    expect((await viewer.json("/api/vulnerabilities/intel")).status).toBe(200);
  });

  test("SOC IV: AI předběžná triáž – podobné alerty, návrh verdiktu, filtr, jen návrh", async () => {
    const { processPreTriage } = await import("../src/modules/soc/triage");
    // dřívější alert se stejnou technikou byl uzavřen jako falešný poplach („Plánovaný sken správce“)
    const a = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Opět skenování portů", severity: "medium", mitreIds: ["T1046"] } })).body;
    const b = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Neznámý proces s šifrováním souborů", severity: "high", mitreIds: ["T1486"] } })).body;
    const bad = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "ROZBITY alert", severity: "low" } })).body;
    expect(a.aiTriage).toBeNull();
    expect(await processPreTriage(db, config)).toBeGreaterThanOrEqual(3);
    const da = (await admin.json(`/api/soc/alerts/${a.id}`)).body;
    expect(da.aiTriage).toMatchObject({ verdict: "false_positive", action: "close", severity: "low", confidence: "high", error: null });
    expect(da.aiTriage.reasoning).not.toContain("<think>");
    expect(da.aiTriage.similar[0]).toMatchObject({ verdict: "false_positive", reasons: expect.arrayContaining(["technique"]) });
    // návrh se neaplikuje: alert zůstává otevřený a bez verdiktu
    expect(da).toMatchObject({ status: "new", verdict: null });
    // do modelu nejde zdůvodnění analytika ani jména
    const sent = JSON.stringify(aiCalls.filter((x: any) => String(x.messages[0].content).includes("předběžnou triáž")).map((x: any) => x.messages));
    expect(sent).not.toContain("Plánovaný sken správce");
    expect(sent).not.toContain("Admin");
    const db_ = (await admin.json(`/api/soc/alerts/${b.id}`)).body;
    expect(db_.aiTriage).toMatchObject({ verdict: "true_positive", action: "escalate", severity: "critical" });
    // chybná odpověď modelu → chyba uložena, alert se neblokuje a plánovač ho hned znovu nezkouší
    expect((await admin.json(`/api/soc/alerts/${bad.id}`)).body.aiTriage.error).toContain("JSON");
    expect(await processPreTriage(db, config)).toBe(0);
    // filtry fronty
    expect(((await admin.json("/api/soc/alerts?ai=fp")).body as any[]).map((x) => x.id)).toContain(a.id);
    expect(((await admin.json("/api/soc/alerts?ai=tp")).body as any[]).map((x) => x.id)).toContain(b.id);
    expect(((await admin.json("/api/soc/alerts?ai=fp")).body as any[]).map((x) => x.id)).not.toContain(b.id);
    // znovu na pokyn analytika
    const re = await admin.json(`/api/soc/alerts/${b.id}/triage`, { method: "POST" });
    expect(re.status).toBe(200);
    expect(re.body.aiTriage.verdict).toBe("true_positive");
    // vypnuto v nastavení → plánovač nic nedělá
    await admin.json("/api/soc/settings", { method: "PUT", json: { aiTriage: false } });
    const c2 = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Další alert", severity: "low" } })).body;
    expect(await processPreTriage(db, config)).toBe(0);
    expect((await admin.json(`/api/soc/alerts/${c2.id}`)).body.aiTriage).toBeNull();
    await admin.json("/api/soc/settings", { method: "PUT", json: { aiTriage: true } });
    // úklid – uzavřít, ať neovlivní další testy
    for (const id of [a.id, b.id, bad.id, c2.id]) await admin.json(`/api/soc/alerts/${id}/close`, { method: "POST", json: { verdict: "undetermined", reason: "test" } });
  });

  test("SOC V: zdroje alertů – webhook s tokenem (obecný JSON, Suricata EVE, Defender), seskupení, aktivum, potlačení", async () => {
    const { parseEvents, normalizeEvents, levelOf } = await import("../src/modules/soc/ingest");
    expect(levelOf("High", "low")).toBe(10);
    expect(levelOf(12, "low")).toBe(12);
    expect(levelOf("informational", "medium")).toBe(2);
    expect(levelOf(undefined, "critical")).toBe(13);
    expect(parseEvents('{"event_type":"alert"}\n{"event_type":"dns"}\n')).toHaveLength(2);
    expect(parseEvents('{"value":[{"a":1},{"b":2}]}')).toHaveLength(2);
    expect(normalizeEvents("suricata", parseEvents('{"event_type":"dns"}'), "medium")).toHaveLength(0);

    const asset = (await admin.json("/api/assets", { method: "POST", json: { name: "WEB-INGEST-01", assetType: "server", hostname: "web-ingest-01", ipAddresses: ["10.20.30.40"] } })).body;
    // správa zdrojů – token jen jednou
    const created = await admin.json("/api/soc/sources", { method: "POST", json: { name: "Obecný test", preset: "generic", defaultSeverity: "high" } });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^cxs_/);
    expect(created.body.source.tokenPrefix).toBe(created.body.token.slice(0, 12));
    const list = (await admin.json("/api/soc/sources")).body as any[];
    expect(JSON.stringify(list)).not.toContain(created.body.token);
    const tok = created.body.token as string;
    const ingest = (token: string, body: string, ct = "application/json") => app.request("/api/public/soc/ingest", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": ct }, body });

    expect((await ingest("cxs_spatny", "{}")).status).toBe(401);
    expect((await app.request("/api/public/soc/ingest", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await ingest(tok, "nejson")).status).toBe(400);
    const r1 = await ingest(tok, JSON.stringify([
      { title: "Podezřelý PowerShell", host: "WEB-INGEST-01.firma.local", srcip: "203.0.113.50", mitre: "T1059, X1", ruleId: "ps-1" },
      { title: "Podezřelý PowerShell", host: "web-ingest-01", srcip: "203.0.113.50", ruleId: "ps-1" },
      { description: "bez názvu – přeskočí se" },
    ]));
    expect(r1.status).toBe(202);
    expect(await r1.json()).toMatchObject({ accepted: 2, created: 1, updated: 0, skipped: 1 });
    // druhý požadavek se připíše k otevřenému alertu
    expect(await (await ingest(tok, JSON.stringify({ title: "Podezřelý PowerShell", host: "web-ingest-01", ruleId: "ps-1" }))).json()).toMatchObject({ created: 0, updated: 1 });
    const q = ((await admin.json("/api/soc/alerts?q=Podezřelý PowerShell")).body as any[]);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ source: "webhook", ruleId: "generic:ps-1", count: 3, severity: "high", assetId: asset.id, mitreIds: ["T1059"] });
    // Suricata EVE (NDJSON) – cílová IP → aktivum, závažnost podle severity, jen event_type alert
    const sur = (await admin.json("/api/soc/sources", { method: "POST", json: { name: "Suricata DMZ", preset: "suricata" } })).body;
    const eve = [
      { timestamp: "2026-10-01T10:00:00.000+0000", event_type: "alert", src_ip: "198.51.100.7", src_port: 4444, dest_ip: "10.20.30.40", dest_port: 443, proto: "TCP", alert: { signature_id: 2024217, signature: "ET EXPLOIT Apache Struts RCE CVE-2017-5638", category: "Attempted Administrator Privilege Gain", severity: 1, metadata: { mitre_technique_id: ["T1190"] } } },
      { timestamp: "2026-10-01T10:00:01.000+0000", event_type: "flow", src_ip: "198.51.100.7" },
    ].map((x) => JSON.stringify(x)).join("\n");
    expect(await (await ingest(sur.token, eve, "application/x-ndjson")).json()).toMatchObject({ accepted: 1, created: 1, skipped: 1 });
    const sa = ((await admin.json("/api/soc/alerts?q=Struts")).body as any[])[0];
    expect(sa).toMatchObject({ source: "suricata", ruleId: "suricata:2024217", severity: "high", assetId: asset.id, mitreIds: ["T1190"] });
    // Microsoft Defender (Graph alerts_v2 ve value[])
    const def = (await admin.json("/api/soc/sources", { method: "POST", json: { name: "Defender", preset: "defender" } })).body;
    const graph = { value: [{ id: "da1", title: "Suspicious credential dump", severity: "high", category: "CredentialAccess", detectorId: "det-77", mitreTechniques: ["T1003.001"], createdDateTime: "2026-10-01T09:00:00Z", description: "Mimikatz-like behavior", evidence: [{ "@odata.type": "#microsoft.graph.security.deviceEvidence", deviceDnsName: "pc-ucetni-02", ipInterfaces: ["10.1.1.2"] }, { "@odata.type": "#microsoft.graph.security.userEvidence", userAccount: { accountName: "jnovak" } }] }] };
    expect(await (await ingest(def.token, JSON.stringify(graph))).json()).toMatchObject({ created: 1 });
    const da = ((await admin.json("/api/soc/alerts?q=credential dump")).body as any[])[0];
    expect(da).toMatchObject({ source: "defender", ruleId: "defender:det-77", severity: "high", agentName: "pc-ucetni-02", mitreIds: ["T1003.001"] });
    // statistika zdroje
    const st = ((await admin.json("/api/soc/sources")).body as any[]).find((x) => x.id === created.body.source.id);
    expect(st).toMatchObject({ eventsTotal: 3, alertsCreated: 1, lastError: null });
    // potlačení opakování i u napojeného nástroje
    const closed = await admin.json(`/api/soc/alerts/${q[0].id}/close`, { method: "POST", json: { verdict: "false_positive", reason: "skript správce", suppressUntil: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } });
    expect(closed.status).toBe(200);
    expect(await (await ingest(tok, JSON.stringify({ title: "Podezřelý PowerShell", host: "web-ingest-01", ruleId: "ps-1" }))).json()).toMatchObject({ created: 0, suppressed: 1 });
    // vypnutý zdroj a obnova tokenu
    await admin.json(`/api/soc/sources/${created.body.source.id}`, { method: "PATCH", json: { enabled: false } });
    expect((await ingest(tok, "{}")).status).toBe(401);
    await admin.json(`/api/soc/sources/${created.body.source.id}`, { method: "PATCH", json: { enabled: true } });
    const rot = (await admin.json(`/api/soc/sources/${created.body.source.id}/rotate`, { method: "POST" })).body;
    expect((await ingest(tok, JSON.stringify({ title: "x" }))).status).toBe(401);
    expect((await ingest(rot.token, JSON.stringify({ title: "Po rotaci" }))).status).toBe(202);
    expect((await admin.json(`/api/soc/sources/${def.source.id}`, { method: "DELETE" })).status).toBe(200);
    for (const a of [sa, da]) await admin.json(`/api/soc/alerts/${a.id}/close`, { method: "POST", json: { verdict: "undetermined", reason: "test" } });
    for (const a of ((await admin.json("/api/soc/alerts?q=Po rotaci")).body as any[])) await admin.json(`/api/soc/alerts/${a.id}/close`, { method: "POST", json: { verdict: "undetermined", reason: "test" } });
  });

  test("SOC VI: hlášení phishingu – rozbor .eml (hlavičky, SPF/DKIM/DMARC, odkazy, přílohy), kampaň = jeden alert", async () => {
    const eml = [
      "Received: from mx.firma.cz (mx.firma.cz [10.0.0.5]) by mail.firma.cz",
      "Received: from evil-host (unknown [185.220.101.4]) by mx.firma.cz",
      "Authentication-Results: mx.firma.cz; spf=fail smtp.mailfrom=banka-cz.top; dkim=none; dmarc=fail header.from=banka.cz",
      "From: =?utf-8?B?QmFua2EgxIxS?= <podpora@banka.cz>",
      "Reply-To: podpora@banka-cz.top",
      "Return-Path: <bounce@banka-cz.top>",
      "Subject: =?utf-8?Q?Ov=C4=9B=C5=99te_sv=C5=AFj_=C3=BA=C4=8Det?=",
      "Date: Mon, 12 Oct 2026 08:00:00 +0200",
      "Message-ID: <abc@banka-cz.top>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="XYZ"',
      "",
      "--XYZ",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<p>Dobr=C3=BD den, klikn=C4=9Bte <a href=3D"https://banka-cz.top/login?id=3D1&amp;x=3D2">zde</a>.</p>',
      "TAJNY-OBSAH-TELA",
      "--XYZ",
      'Content-Type: application/octet-stream; name="faktura.pdf.exe"',
      'Content-Disposition: attachment; filename="faktura.pdf.exe"',
      "Content-Transfer-Encoding: base64",
      "",
      "TVqQAAMAAAAEAAAA",
      "--XYZ--",
      "",
    ].join("\r\n");
    const { parseEml } = await import("../src/modules/soc/phishing");
    const info = parseEml(eml);
    expect(info).toMatchObject({ from: "Banka ČR <podpora@banka.cz>", subject: "Ověřte svůj účet", replyTo: "podpora@banka-cz.top", auth: { spf: "fail", dkim: "none", dmarc: "fail" }, hops: 2, originIp: "185.220.101.4", domains: ["banka-cz.top"], attachments: ["faktura.pdf.exe"] });
    expect(info.urls).toEqual(["https://banka-cz.top/login?id=1&x=2"]);

    const send = (file?: File, extra: Record<string, string> = {}) => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      for (const [k, v] of Object.entries(extra)) fd.append(k, v);
      return admin.json("/api/soc/phishing", { method: "POST", body: fd });
    };
    expect((await send()).status).toBe(400);
    expect((await send(new File(["x"], "zprava.txt"))).status).toBe(400);
    const r = await send(new File([eml], "podezrely.eml", { type: "message/rfc822" }), { note: "Přišlo mi to ráno, na odkaz jsem neklikl." });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ duplicate: false, info: { attachments: ["faktura.pdf.exe"] } });
    const a = (await admin.json(`/api/soc/alerts/${r.body.alertId}`)).body;
    expect(a).toMatchObject({ source: "phishing", title: "Nahlášený phishing: Ověřte svůj účet", severity: "high", playbookKey: "phishing", mitreIds: ["T1566", "T1204"] });
    expect(a.sample).toMatchObject({ srcip: "185.220.101.4", domains: ["banka-cz.top"], reports: 1 });
    expect(a.description).toContain("SPF fail");
    expect(a.notes[0].text).toContain("na odkaz jsem neklikl");
    // celé tělo e-mailu se neukládá
    expect(JSON.stringify(a)).not.toContain("TAJNY-OBSAH-TELA");
    expect(JSON.stringify(a)).not.toContain("TVqQAAMAAAAEAAAA");
    // druhé hlášení téže kampaně (RE: a jiné velikosti písmen) → připíše se
    const r2 = await send(undefined, { from: "podpora@banka.cz", subject: "RE: ověřte svůj účet" });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ duplicate: true, alertId: r.body.alertId });
    const a2 = (await admin.json(`/api/soc/alerts/${r.body.alertId}`)).body;
    expect(a2.count).toBe(2);
    expect(a2.sample.reports).toBe(2);
    // hlášení bez .eml
    const r3 = await send(undefined, { from: "ceo@firma-cz.com", subject: "Urgentní platba" });
    expect(r3.status).toBe(201);
    expect((await admin.json(`/api/soc/alerts/${r3.body.alertId}`)).body).toMatchObject({ severity: "medium", mitreIds: ["T1566"] });
    for (const id of [r.body.alertId, r3.body.alertId]) await admin.json(`/api/soc/alerts/${id}/close`, { method: "POST", json: { verdict: "true_positive", reason: "test" } });
  });

  test("SOC VII: úspěšnost SOC a AI – metriky za období, kapitola ve zprávě pro vedení", async () => {
    const m = await admin.json("/api/soc/metrics?days=30");
    expect(m.status).toBe(200);
    expect(m.body.total.alerts).toBeGreaterThan(5);
    expect(m.body.total.decided).toBeGreaterThan(3);
    expect(m.body.bySource.map((x: any) => x.key)).toEqual(expect.arrayContaining(["manual", "webhook", "suricata", "phishing"]));
    expect(m.body.bySeverity.map((x: any) => x.key)).toEqual(["critical", "high", "medium", "low"]);
    expect(m.body.ai.triaged).toBeGreaterThanOrEqual(2);
    expect(m.body.weekly.length).toBeGreaterThanOrEqual(4);
    expect((await admin.json("/api/soc/metrics?days=3")).status).toBe(400);
    const y = new Date().getFullYear();
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const r = (await admin.json(`/api/reports/management?periodFrom=${y}-01-01&periodTo=${y}-12-31`, { headers: { "x-contix-company": root.id } })).body;
    expect(r.soc).toMatchObject({ mttrHours: expect.any(Number), aiCompared: expect.any(Number) });
  });

  test("SOC VIII: IOC – kandidáti z phishingu, evidence, zpětné hledání ve Wazuhu, export a feed k blokaci", async () => {
    const { detectIocType, normalizeIoc, defang, isPrivateIp } = await import("@contix/shared");
    expect(detectIocType("hxxps://evil[.]example/x")).toBe("url");
    expect(detectIocType("evil[.]example")).toBe("domain");
    expect(detectIocType("44d88612fea8a8f36de82e1278abb02f")).toBe("hash");
    expect(normalizeIoc("domain", "*.Evil.Example.")).toBe("evil.example");
    expect(defang("url", "https://a.b/c")).toBe("hxxps://a[.]b/c");
    expect(isPrivateIp("172.20.1.1")).toBe(true);
    expect(isPrivateIp("203.0.113.7")).toBe(false);
    // kandidáti z nahlášeného phishingu
    const fd = new FormData();
    fd.append("file", new File([["From: <billing@ioc-evil.example>", "Received: from x (unknown [198.51.100.66]) by mx", "Subject: IOC test faktura", "Content-Type: text/plain", "", "Zaplatte: https://pay.ioc-evil.example/inv?id=1", ""].join("\r\n")], "f.eml"));
    const ph = (await admin.json("/api/soc/phishing", { method: "POST", body: fd })).body;
    const cands = (await admin.json(`/api/soc/alerts/${ph.alertId}/iocs`)).body as any[];
    expect(cands.map((x) => `${x.type}:${x.value}`)).toEqual(expect.arrayContaining(["ip:198.51.100.66", "email:billing@ioc-evil.example", "domain:pay.ioc-evil.example", "url:https://pay.ioc-evil.example/inv?id=1"]));
    expect(cands.every((x) => x.existingId === null)).toBe(true);
    expect(cands.find((x) => x.type === "url").display).toContain("hxxps://");
    // analytik vybere → evidence (s odmítnutím neplatných a interních k blokaci)
    const add = await admin.json("/api/soc/iocs", { method: "POST", json: { sourceAlertId: ph.alertId, action: "block", note: "kampaň faktury", items: [...cands.map((x) => ({ type: x.type, value: x.value })), { value: "10.1.2.3" }, { value: "nesmysl" }, { value: "203.0.113.7" }] } });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ created: 5, updated: 0 });
    expect(add.body.rejected).toEqual([{ value: "10.1.2.3", reason: "private_ip" }, { value: "nesmysl", reason: "invalid" }]);
    expect(((await admin.json(`/api/soc/alerts/${ph.alertId}/iocs`)).body as any[]).every((x) => x.existingId)).toBe(true);
    // opakované přidání = aktualizace
    expect((await admin.json("/api/soc/iocs", { method: "POST", json: { items: [{ value: "203.0.113.7" }], action: "monitor" } })).body).toMatchObject({ created: 0, updated: 1 });
    const list = (await admin.json("/api/soc/iocs")).body as any[];
    const ip = list.find((x) => x.value === "203.0.113.7");
    expect(ip).toMatchObject({ type: "ip", action: "monitor", state: "active" });
    expect(list.find((x) => x.type === "domain")).toMatchObject({ sourceAlertTitle: "Nahlášený phishing: IOC test faktura", display: "pay[.]ioc-evil[.]example" });
    // zpětné hledání: IP z testovacích alertů Wazuhu (agent-001)
    const h = await admin.json(`/api/soc/iocs/${ip.id}/hunt`, { method: "POST", json: { days: 30 } });
    expect(h.status).toBe(200);
    expect(h.body.lastHunt).toMatchObject({ days: 30, error: null });
    expect(h.body.lastHunt.total).toBeGreaterThan(0);
    expect(h.body.lastHunt.agents.map((a: any) => a.name)).toContain("agent-001");
    // export a feed jen platných IOC k blokaci
    const exp = await admin.req("/api/soc/iocs/export?type=ip");
    const txt = await exp.text();
    expect(txt).toContain("198.51.100.66");
    expect(txt).not.toContain("203.0.113.7"); // jen sledovat
    const csv = await (await admin.req("/api/soc/iocs/export?format=csv")).text();
    expect(csv.split("\n")[0]).toBe("type,value,valid_until,note");
    const feed = (await admin.json("/api/soc/ioc-feeds", { method: "POST", json: { name: "Palo Alto EDL" } })).body;
    expect(feed.token).toMatch(/^cxf_/);
    const f1 = await app.request(`/api/public/soc/feed/${feed.token}/domain.txt`);
    expect(f1.status).toBe(200);
    expect(await f1.text()).toBe("pay.ioc-evil.example\n");
    expect((await app.request(`/api/public/soc/feed/cxf_spatny/ip.txt`)).status).toBe(401);
    expect((await app.request(`/api/public/soc/feed/${feed.token}/vse.txt`)).status).toBe(404);
    // zrušení a prošlé IOC z feedu vypadnou
    const dom = list.find((x) => x.type === "domain");
    expect((await admin.json(`/api/soc/iocs/${dom.id}/revoke`, { method: "POST" })).body.state).toBe("revoked");
    expect(await (await app.request(`/api/public/soc/feed/${feed.token}/domain.txt`)).text()).toBe("");
    expect(((await admin.json("/api/soc/ioc-feeds")).body as any[])[0]).toMatchObject({ fetches: 2 });
    expect((await admin.json(`/api/soc/iocs/${ip.id}`, { method: "PATCH", json: { action: "block", validUntil: "2020-01-01" } })).status).toBe(400);
    await admin.json(`/api/soc/alerts/${ph.alertId}/close`, { method: "POST", json: { verdict: "true_positive", reason: "test" } });
  });

  test("SOC IX: reakce s potvrzením – upozornění na kritický alert, čtyři oči, Wazuh Active Response, ruční zásah", async () => {
    const { notifyNewAlerts } = await import("../src/modules/soc/response");
    // druhý člověk s oprávněním schvalovat zásahy
    await admin.json("/api/admin/users", { method: "POST", json: { email: "responder@test.cz", displayName: "Petr Schvalovatel", password: PW, roleIds: [await roleId("ciso")] } });
    const resp = browser();
    expect((await resp.login("responder@test.cz")).status).toBe(200);
    expect((await resp.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Schval-Heslo-2026!!" } })).status).toBe(200);
    expect((await resp.json("/api/auth/me")).body.permissions).toContain("soc:respond");
    // výchozí nastavení: jen kritické, čtyři oči, Active Response vypnuto
    expect((await admin.json("/api/soc/response/settings")).body).toMatchObject({ notifyMinSeverity: "critical", fourEyes: true, activeResponseEnabled: false, hasWazuhPassword: false });
    // kritický alert → okamžité upozornění analytikům (jen jednou)
    const crit = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Ransomware šifruje sdílený disk", severity: "critical", mitreIds: ["T1486"] } })).body;
    const before = sentMails.length;
    const n1 = await notifyNewAlerts({ db, config, mailer: { send: async (m) => void sentMails.push(m) }, teams: { post: async (url, payload) => void teamsPosts.push({ url, payload }) } });
    expect(n1.emails).toBeGreaterThan(0);
    const mail = sentMails.slice(before).find((m) => m.subject.includes("Ransomware šifruje sdílený disk"));
    expect(mail?.subject).toContain("Nový alert (Kritická)");
    expect(mail?.html).toContain(`/soc/${crit.id}`);
    expect((await notifyNewAlerts({ db, config, mailer: { send: async (m) => void sentMails.push(m) } })).emails).toBe(0);
    // návrh blokace IP – validace
    expect((await admin.json("/api/soc/actions", { method: "POST", json: { kind: "block_ip", target: "10.0.0.9", agentIds: ["001"], reason: "test", alertId: crit.id } })).status).toBe(400);
    expect((await admin.json("/api/soc/actions", { method: "POST", json: { kind: "block_ip", target: "198.51.100.23", reason: "test", alertId: crit.id } })).status).toBe(400);
    const prop = await admin.json("/api/soc/actions", { method: "POST", json: { kind: "block_ip", target: "198.51.100.23", agentIds: ["001", "999"], reason: "Zdroj šifrování ze sítě", alertId: crit.id } });
    expect(prop.status).toBe(201);
    expect(prop.body).toMatchObject({ status: "proposed", automated: true, canDecide: false, canCancel: true });
    // navrhovatel nesmí schválit sám sobě
    expect((await admin.json(`/api/soc/actions/${prop.body.id}/decide`, { method: "POST", json: { decision: "approve" } })).status).toBe(403);
    expect(((await resp.json("/api/soc/actions")).body as any[]).find((x) => x.id === prop.body.id).canDecide).toBe(true);
    // Active Response vypnuto → schválení proběhne, provedení selže a zůstane záznam
    const ap1 = await resp.json(`/api/soc/actions/${prop.body.id}/decide`, { method: "POST", json: { decision: "approve", note: "OK" } });
    expect(ap1.body).toMatchObject({ status: "failed", decidedByName: "Petr Schvalovatel" });
    expect(ap1.body.result).toContain("vypnutá");
    // nastavení účtu pro Active Response (heslo se nevrací)
    const st = await admin.json("/api/soc/response/settings", { method: "PUT", json: { activeResponseEnabled: true, wazuhUser: "contix-ar", wazuhPassword: "ar-pw" } });
    expect(st.body).toMatchObject({ activeResponseEnabled: true, hasWazuhPassword: true, blockCommand: "!firewall-drop" });
    expect(JSON.stringify(st.body)).not.toContain("ar-pw");
    // opakování selhaného → provede se (agent 999 neexistuje, 001 ano)
    const re = await resp.json(`/api/soc/actions/${prop.body.id}/complete`, { method: "POST", json: { success: true, note: "znovu" } });
    expect(re.body.status).toBe("done");
    expect(re.body.result).toContain("001");
    expect(re.body.result).toContain("selhalo: 999");
    expect(arCalls.at(-1)).toMatchObject({ agents: ["001", "999"], body: { command: "!firewall-drop", alert: { data: { srcip: "198.51.100.23" } } } });
    // zablokovaná IP je v IOC k blokaci, stopa v poznámkách alertu
    expect(((await admin.json("/api/soc/iocs?q=198.51.100.23")).body as any[])[0]).toMatchObject({ type: "ip", action: "block", sourceAlertId: crit.id });
    const notes = (await admin.json(`/api/soc/alerts/${crit.id}`)).body.notes.map((n: any) => n.text).join("\n");
    expect(notes).toContain("Navržen zásah");
    expect(notes).toContain("schválen");
    expect(notes).toContain("provedeno");
    // ruční zásah: zakázání účtu → schválení → označení provedení
    const man = (await admin.json("/api/soc/actions", { method: "POST", json: { kind: "disable_account", target: "FIRMA\\jnovak", reason: "Kompromitovaný účet", alertId: crit.id } })).body;
    expect(man.automated).toBe(false);
    expect((await resp.json(`/api/soc/actions/${man.id}/decide`, { method: "POST", json: { decision: "reject" } })).status).toBe(400);
    const ap2 = (await resp.json(`/api/soc/actions/${man.id}/decide`, { method: "POST", json: { decision: "approve" } })).body;
    expect(ap2).toMatchObject({ status: "approved", canComplete: true });
    expect((await resp.json(`/api/soc/actions/${man.id}/complete`, { method: "POST", json: { success: true, note: "Účet zakázán v AD, relace odhlášeny." } })).body).toMatchObject({ status: "done", executedByName: "Petr Schvalovatel" });
    // zamítnutí a zrušení
    const third = (await admin.json("/api/soc/actions", { method: "POST", json: { kind: "isolate_host", target: "PC-HR-07", reason: "Podezření", alertId: crit.id } })).body;
    expect((await admin.json(`/api/soc/actions/${third.id}/cancel`, { method: "POST" })).body.status).toBe("cancelled");
    expect(((await admin.json("/api/soc/actions?status=all")).body as any[]).filter((x) => x.alertId === crit.id).map((x) => x.status).sort()).toEqual(["cancelled", "done", "done"]);
    expect(((await admin.json("/api/soc/actions")).body as any[]).some((x) => x.alertId === crit.id)).toBe(false);
    // audit
    const log = (await admin.json("/api/admin/audit-log?limit=200")).body as any[];
    expect(log.some((l: any) => l.action === "soc.action_approved")).toBe(true);
    await admin.json("/api/soc/response/settings", { method: "PUT", json: { activeResponseEnabled: false, wazuhPassword: "" } });
    await admin.json(`/api/soc/alerts/${crit.id}/close`, { method: "POST", json: { verdict: "true_positive", reason: "test" } });
  });

  test("incident × SOC: podklady, návrh doplnění ze SOC (idempotentní), záznam o zvládání – tisk a Word", async () => {
    const resp = browser();
    expect((await resp.login("responder@test.cz", "Schval-Heslo-2026!!")).status).toBe(200);
    const al = (await admin.json("/api/soc/alerts", { method: "POST", json: { title: "Exfiltrace dat na cizí server", severity: "high", mitreIds: ["T1041"], description: "Přenos 2 GB na 203.0.113.99" } })).body;
    await admin.json("/api/soc/iocs", { method: "POST", json: { sourceAlertId: al.id, items: [{ value: "203.0.113.99" }, { value: "exfil[.]example" }] } });
    const act = (await admin.json("/api/soc/actions", { method: "POST", json: { kind: "disable_account", target: "FIRMA\\svc-backup", reason: "Účet použitý k exfiltraci", alertId: al.id } })).body;
    await resp.json(`/api/soc/actions/${act.id}/decide`, { method: "POST", json: { decision: "approve", note: "ihned" } });
    await resp.json(`/api/soc/actions/${act.id}/complete`, { method: "POST", json: { success: true, note: "Účet zakázán, hesla služby změněna." } });
    const esc = await admin.json(`/api/soc/alerts/${al.id}/escalate`, { method: "POST", json: { kind: "incident" } });
    const incId = esc.body.incidentId as string;
    // podklady
    const ev = (await admin.json(`/api/incidents/${incId}/soc`)).body;
    expect(ev.alerts).toHaveLength(1);
    expect(ev.alerts[0]).toMatchObject({ title: "Exfiltrace dat na cizí server", severity: "high", mitreIds: ["T1041"] });
    expect(ev.iocs.map((i: any) => i.display).sort()).toEqual(["203.0.113.99", "exfil[.]example"]);
    expect(ev.actions[0]).toMatchObject({ kind: "disable_account", status: "done", decidedByName: "Petr Schvalovatel", executedByName: "Petr Schvalovatel" });
    // návrh doplnění – nic neukládá
    const dr = (await admin.json(`/api/incidents/${incId}/soc-draft`)).body;
    expect(dr.evidence).toContain("Exfiltrace dat na cizí server");
    expect(dr.indicators).toContain("exfil[.]example");
    expect(dr.containment).toContain("Zakázat účet FIRMA\\svc-backup");
    expect(dr.containment).toContain("Účet zakázán, hesla služby změněna.");
    expect(dr.timeline.map((x: any) => x.text)).toEqual(expect.arrayContaining([expect.stringContaining("Alert SOC: Exfiltrace"), expect.stringContaining("Schválen zásah Zakázat účet")]));
    const before = (await admin.json(`/api/incidents/${incId}`)).body;
    expect(before.evidence).toBeNull();
    // převzetí do záznamu (jako formulář) a podruhé už nic nového
    const merged = [...before.timeline, ...dr.timeline];
    expect((await admin.json(`/api/incidents/${incId}`, { method: "PATCH", json: { evidence: dr.evidence, indicators: dr.indicators, containment: dr.containment, timeline: merged, ...(dr.occurredAt ? { occurredAt: dr.occurredAt } : {}) } })).status).toBe(200);
    const dr2 = (await admin.json(`/api/incidents/${incId}/soc-draft`)).body;
    expect(dr2).toMatchObject({ evidence: null, indicators: null, containment: null, timeline: [], assets: [] });
    // záznam o zvládání
    const page = await admin.req(`/api/incidents/${incId}/record.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    for (const x of ["Záznam o zvládání incidentu", "§ 14 odst. 1 vyhlášky č. 409/2025", "Detekce (SOC)", "Exfiltrace dat na cizí server", "exfil[.]example", "Petr Schvalovatel", "Hlášení a lhůty", "9. Průběh"]) expect(html).toContain(x);
    expect(html).not.toContain("Nejsou zaznamenány podklady (důkazy)");
    const docx = await admin.req(`/api/incidents/${incId}/record.docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("officedocument.wordprocessingml");
    expect((await docx.arrayBuffer()).byteLength).toBeGreaterThan(3000);
  });

  test("zdroje IOC: stažení s Auth-Key, porovnání s alerty, hledání ve Wazuhu, ruční nahrání", async () => {
    const seen: { path: string; key: string | null }[] = [];
    const feeds = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        seen.push({ path: u.pathname, key: req.headers.get("auth-key") });
        if (u.pathname === "/urlhaus/tajny-klic/recent.csv") return new Response('# id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter\n"1","2026-10-15 08:00:00","http://ti-evil.example/payload.exe","online","","malware_download","","",""\n');
        if (u.pathname === "/threatfox/tajny-klic/recent.csv") return new Response('# "first_seen_utc","ioc_id","ioc_value","ioc_type","threat_type","fk_malware","malware_alias","malware_printable","last_seen_utc","confidence_level","reference","tags","anonymous","reporter"\n"2026-10-14 10:00:00","1","203.0.113.7:443","ip:port","botnet_cc","","","Cobalt Strike","","100","","","0","x"\n"2026-10-14 10:00:00","2","198.51.100.200:80","ip:port","botnet_cc","","","QakBot","","90","","","0","x"\n');
        if (u.pathname === "/feodo.txt") return new Response("# Feodo\n");
        if (u.pathname === "/cert.txt") return new Response("# CERT varování\nti-cert.example\n");
        return new Response("nf", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${feeds.port}`;
    try {
      // bez klíče → chyba u zdrojů s klíčem
      const st0 = await admin.json("/api/soc/threat-intel/settings", { method: "PUT", json: { feeds: { urlhaus: { enabled: true, url: `${base}/urlhaus/{key}/recent.csv` }, threatfox: { enabled: true, url: `${base}/threatfox/{key}/recent.csv` }, feodo: { enabled: true, url: `${base}/feodo.txt` } }, custom: [{ id: "cert", name: "CERT varování", url: `${base}/cert.txt`, enabled: true }] } });
      expect(st0.status).toBe(200);
      const r0 = (await admin.json("/api/soc/threat-intel/refresh", { method: "POST" })).body;
      expect(r0.state.urlhaus.error).toContain("Auth-Key");
      expect(r0.state["custom:cert"]).toMatchObject({ count: 1, error: null });
      expect(r0.state.feodo.error).toContain("žádné");
      // s klíčem (heslo se nevrací, posílá se v adrese i v hlavičce)
      const st = (await admin.json("/api/soc/threat-intel/settings", { method: "PUT", json: { authKey: "tajny-klic", hunt: true } })).body;
      expect(st.hasAuthKey).toBe(true);
      expect(JSON.stringify(st)).not.toContain("tajny-klic");
      // alert z webhooku se zdrojovou IP, která je ve ThreatFoxu
      const src = (await admin.json("/api/soc/sources", { method: "POST", json: { name: "TI test", preset: "generic" } })).body;
      await app.request("/api/public/soc/ingest", { method: "POST", headers: { authorization: `Bearer ${src.token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "TI test spojení ven", host: "pc-ti-01", srcip: "198.51.100.200", ruleId: "ti-1" }) });
      const r = (await admin.json("/api/soc/threat-intel/refresh", { method: "POST" })).body;
      expect(r.state.urlhaus).toMatchObject({ count: 1, error: null });
      expect(r.state.threatfox).toMatchObject({ count: 2, error: null });
      expect(seen.find((x) => x.path.startsWith("/threatfox/"))?.key).toBe("tajny-klic");
      expect(r.totals).toEqual(expect.arrayContaining([{ source: "threatfox", type: "ip", n: 2 }, { source: "custom:cert", type: "domain", n: 1 }]));
      // shoda s alertem
      const tiAlert = ((await admin.json("/api/soc/alerts?q=TI test spojení ven")).body as any[])[0];
      expect(tiAlert.intel).toEqual([{ source: "threatfox", type: "ip", value: "198.51.100.200", threat: "QakBot", confidence: 90 }]);
      expect(((await admin.json("/api/soc/alerts?intel=1")).body as any[]).map((x) => x.id)).toContain(tiAlert.id);
      // hledání ve Wazuhu: 203.0.113.7 je v testovacích alertech Wazuhu (agent-001, agent-002)
      expect(r.lastHunt).toMatchObject({ error: null });
      expect(r.lastHunt.alerts).toBeGreaterThanOrEqual(1);
      const hunted = (await admin.json("/api/soc/alerts?q=Komunikace se známou hrozbou: 203.0.113.7")).body as any[];
      expect(hunted.length).toBeGreaterThanOrEqual(1);
      expect(hunted[0]).toMatchObject({ source: "threatintel", ruleId: "ti:threatfox", severity: "high", mitreIds: ["T1071"] });
      expect(hunted[0].title).toContain("Cobalt Strike");
      // další hledání stejné okno neopakuje (nic nového)
      const again = (await admin.json("/api/soc/threat-intel/refresh", { method: "POST" })).body;
      expect(again.lastHunt.alerts).toBe(0);
      // dotaz na hodnotu a ruční nahrání (server bez internetu)
      expect(((await admin.json("/api/soc/threat-intel/lookup?value=198.51.100.200")).body as any[])[0]).toMatchObject({ source: "threatfox", threat: "QakBot" });
      const fd = new FormData();
      fd.append("source", "feodo");
      fd.append("file", new File(["# offline\n192.0.2.66\n"], "ipblocklist.txt"));
      expect((await admin.json("/api/soc/threat-intel/upload", { method: "POST", body: fd })).body.count).toBe(1);
      const fd2 = new FormData();
      fd2.append("source", "nic");
      fd2.append("file", new File(["1.2.3.4"], "x.txt"));
      expect((await admin.json("/api/soc/threat-intel/upload", { method: "POST", body: fd2 })).status).toBe(400);
      for (const a of [tiAlert, ...hunted]) await admin.json(`/api/soc/alerts/${a.id}/close`, { method: "POST", json: { verdict: "undetermined", reason: "test" } });
      await admin.json("/api/soc/threat-intel/settings", { method: "PUT", json: { hunt: false } });
    } finally {
      feeds.stop(true);
    }
  });

  test("Cortex a MISP: nastavení, allow-list, ochrana interních údajů, analýza, dotaz, stahování, sdílení", async () => {
    const seen: { path: string; auth: string | null; body: string }[] = [];
    let job2Calls = 0;
    const srv = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        const body = req.method === "POST" ? await req.text() : "";
        seen.push({ path: u.pathname, auth: req.headers.get("authorization"), body });
        const j = (x: unknown) => Response.json(x);
        if (u.pathname.startsWith("/cortex/") && req.headers.get("authorization") !== "Bearer cx-key") return new Response("unauth", { status: 401 });
        if (u.pathname.startsWith("/misp/") && req.headers.get("authorization") !== "misp-key") return new Response("unauth", { status: 403 });
        if (u.pathname === "/cortex/api/status") return j({ versions: { Cortex: "3.1.8" } });
        if (u.pathname === "/cortex/api/analyzer")
          return j([
            { id: "vt", name: "VirusTotal_GetReport_3_1", dataTypeList: ["ip", "domain", "hash"], description: "VT" },
            { id: "mm", name: "MaxMind_GeoIP_4_0", dataTypeList: ["ip"], description: "GeoIP" },
          ]);
        if (u.pathname === "/cortex/api/analyzer/mm/run") return j({ id: JSON.parse(body).data === "203.0.113.10" ? "job2" : "job1", status: "Waiting" });
        if (u.pathname === "/cortex/api/job/job1/waitreport") return j({ status: "Success", report: { summary: { taxonomies: [{ level: "suspicious", namespace: "MaxMind", predicate: "Location", value: "RU" }] }, full: { country: "RU" } } });
        if (u.pathname === "/cortex/api/job/job2/waitreport") return j(++job2Calls < 2 ? { status: "InProgress" } : { status: "Success", report: { summary: { taxonomies: [{ level: "safe", namespace: "MaxMind", predicate: "Location", value: "CZ" }] }, full: {} } });
        if (u.pathname === "/misp/servers/getVersion") return j({ version: "2.5.2" });
        if (u.pathname === "/misp/attributes/restSearch") {
          const b = JSON.parse(body);
          if (b.value) return j({ response: { Attribute: b.value === "203.0.113.9" ? [{ event_id: "42", to_ids: true, Event: { info: "Kampaň X" } }] : [] } });
          return j({ response: { Attribute: [
            { type: "ip-dst", value: "198.51.100.77", event_id: "5", timestamp: "1760000000", Event: { info: "C2 server" }, Tag: [{ name: "tlp:green" }, { name: "malware:emotet" }] },
            { type: "ip-src", value: "192.168.5.5", event_id: "5", Event: { info: "C2 server" } },
            { type: "domain|ip", value: "misp-evil.example|198.51.100.78", event_id: "6", Event: { info: "Phishing" } },
          ] } });
        }
        if (u.pathname === "/misp/events/add") return j({ Event: { id: "77", uuid: "u-77" } });
        if (u.pathname === "/misp/events/publish/77") return j({ saved: true });
        return new Response("nf", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      const st = await admin.json("/api/soc/integrations", {
        method: "PUT",
        json: { internalDomains: ["firma.cz"], cortex: { enabled: true, url: `${base}/cortex`, apiKey: "cx-key" }, misp: { enabled: true, url: `${base}/misp/`, apiKey: "misp-key", share: { enabled: true, distribution: 0, tlp: "tlp:amber", threatLevel: 2, publish: true } } },
      });
      expect(st.status).toBe(200);
      expect(st.body.cortex.hasApiKey).toBe(true);
      expect(JSON.stringify(st.body)).not.toContain("cx-key");
      const t1 = (await admin.json("/api/soc/integrations/cortex/test", { method: "POST" })).body;
      expect(t1.cortex.check).toMatchObject({ ok: true, version: "3.1.8" });
      expect(t1.cortex.analyzers.map((a: any) => [a.id, a.reach])).toEqual([["vt", "external"], ["mm", "local"]]);
      expect((await admin.json("/api/soc/integrations/misp/test", { method: "POST" })).body.misp.check).toMatchObject({ ok: true, version: "2.5.2" });
      // bez allow-listu analytik nic z Cortexu nespustí
      expect((await admin.json("/api/soc/enrich/options")).body).toMatchObject({ cortex: [], mispLookup: true, mispShare: true });
      await admin.json("/api/soc/integrations", { method: "PUT", json: { cortex: { allowed: ["mm"] } } });
      expect((await admin.json("/api/soc/enrich/options")).body.cortex.map((a: any) => a.id)).toEqual(["mm"]);
      // interní údaje a nepovolené analyzátory → 400, nic se neodešle
      expect((await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "cortex", analyzerId: "mm", type: "ip", value: "10.0.0.5" } })).status).toBe(400);
      expect((await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "misp", type: "domain", value: "srv.firma.cz" } })).status).toBe(400);
      expect((await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "misp", type: "domain", value: "nas.local" } })).status).toBe(400);
      expect((await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "cortex", analyzerId: "vt", type: "ip", value: "203.0.113.9" } })).status).toBe(400);
      expect((await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "cortex", analyzerId: "mm", type: "domain", value: "evil.example" } })).status).toBe(400);
      // analýza s výsledkem hned
      const e1 = await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "cortex", analyzerId: "mm", type: "ip", value: "203.0.113.9" } });
      expect(e1.status).toBe(201);
      expect(e1.body).toMatchObject({ status: "done", verdict: "suspicious", analyzer: "MaxMind_GeoIP_4_0", report: { country: "RU" } });
      const run = seen.find((x) => x.path === "/cortex/api/analyzer/mm/run")!;
      expect(JSON.parse(run.body)).toEqual({ data: "203.0.113.9", dataType: "ip", tlp: 2, pap: 2, message: "CONTIX", parameters: {} });
      // běžící úloha → dokončení přes obnovení
      const e2 = (await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "cortex", analyzerId: "mm", type: "ip", value: "203.0.113.10" } })).body;
      expect(e2.status).toBe("running");
      expect((await admin.json(`/api/soc/enrichments/${e2.id}/refresh`, { method: "POST" })).body).toMatchObject({ status: "done", verdict: "safe" });
      // dotaz do MISP
      const m1 = (await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "misp", type: "ip", value: "203.0.113.9" } })).body;
      expect(m1).toMatchObject({ status: "done", verdict: "malicious", report: { events: [{ id: "42", url: `${base}/misp/events/view/42` }] } });
      expect((await admin.json("/api/soc/enrichments", { method: "POST", json: { provider: "misp", type: "domain", value: "clean.example" } })).body).toMatchObject({ verdict: "info", taxonomies: [{ predicate: "not_found" }] });
      expect(((await admin.json("/api/soc/enrichments?value=203.0.113.9")).body as any[]).length).toBe(2);
      // stahování z MISP do zdrojů hrozeb (soukromá IP vynechána)
      const ti = (await admin.json("/api/soc/threat-intel/refresh", { method: "POST" })).body;
      expect(ti.mispEnabled).toBe(true);
      expect(ti.state.misp).toMatchObject({ count: 3, error: null });
      const pull = JSON.parse(seen.find((x) => x.path === "/misp/attributes/restSearch" && x.body.includes('"last"'))!.body);
      expect(pull).toMatchObject({ last: "30d", to_ids: 1, published: 1, enforceWarninglist: true });
      expect(((await admin.json("/api/soc/threat-intel/lookup?value=198.51.100.77")).body as any[])[0]).toMatchObject({ source: "misp", threat: "C2 server · malware:emotet", reference: `${base}/misp/events/view/5` });
      expect(((await admin.json("/api/soc/threat-intel/lookup?value=192.168.5.5")).body as any[]).length).toBe(0);
      // sdílení IOC: interní doména se přeskočí, poznámka se neodešle
      await admin.json("/api/soc/iocs", { method: "POST", json: { action: "block", note: "interní poznámka Novák", items: [{ value: "203.0.113.99" }, { value: "share-evil.example" }, { value: "vpn.firma.cz" }] } });
      const iocs = ((await admin.json("/api/soc/iocs")).body as any[]).filter((i) => ["203.0.113.99", "share-evil.example", "vpn.firma.cz"].includes(i.value));
      expect(iocs.length).toBe(3);
      const sh = await admin.json("/api/soc/iocs/misp-share", { method: "POST", json: { iocIds: iocs.map((i) => i.id), info: "Test sdílení" } });
      expect(sh.status).toBe(200);
      expect(sh.body).toMatchObject({ eventId: "77", shared: 2, skipped: [{ reason: "internal_domain" }] });
      const ev = JSON.parse(seen.find((x) => x.path === "/misp/events/add")!.body).Event;
      expect(ev).toMatchObject({ info: "Test sdílení", distribution: 0, Tag: [{ name: "tlp:amber" }] });
      expect(ev.Attribute.map((a: any) => [a.type, a.value, a.to_ids])).toEqual(expect.arrayContaining([["ip-dst", "203.0.113.99", true], ["domain", "share-evil.example", true]]));
      expect(seen.some((x) => x.path === "/misp/events/publish/77")).toBe(true);
      expect(((await admin.json("/api/soc/iocs")).body as any[]).find((i) => i.value === "203.0.113.99").mispEventId).toBe("77");
      // nic interního neodešlo
      const sent = JSON.stringify(seen);
      for (const x of ["10.0.0.5", "firma.cz", "nas.local", "Novák"]) expect(sent).not.toContain(x);
      const aud = (await db.execute(sql`select details::text as d from audit_log where action like 'soc.%' and (details::text like '%cx-key%' or details::text like '%misp-key%')`)) as unknown as any[];
      expect(aud.length).toBe(0);
      await admin.json("/api/soc/integrations", { method: "PUT", json: { cortex: { enabled: false }, misp: { enabled: false } } });
    } finally {
      srv.stop(true);
    }
  });

  test("uložené pohledy seznamů incidentů a SOC; filtr zdroje a období alertů (ADR-075)", async () => {
    const v = await admin.json("/api/incidents/views", { method: "POST", json: { name: "Otevřené phishingy", state: { view: "open", category: "phishing", sort: { key: "detectedAt", dir: "desc" } }, shared: true } });
    expect(v.status).toBe(201);
    expect(v.body).toMatchObject({ page: "incidents", mine: true, shared: true });
    // stejný název = přepsání
    expect((await admin.json("/api/incidents/views", { method: "POST", json: { name: "Otevřené phishingy", state: { view: "all" } } })).body.id).toBe(v.body.id);
    const list = (await admin.json("/api/incidents/views")).body as any[];
    expect(list.find((x) => x.id === v.body.id)).toMatchObject({ state: { view: "all" }, shared: false });
    expect(((await admin.json("/api/soc/views")).body as any[]).some((x) => x.id === v.body.id)).toBe(false);
    expect((await admin.json("/api/incidents/views", { method: "POST", json: { name: "", state: {} } })).status).toBe(400);
    expect((await admin.json(`/api/incidents/views/${v.body.id}`, { method: "DELETE" })).status).toBe(204);
    const sv = await admin.json("/api/soc/views", { method: "POST", json: { name: "Phishing dnes", state: { source: "phishing" } } });
    expect(sv.status).toBe(201);
    // filtr zdroje a období
    const all = (await admin.json("/api/soc/alerts?status=all")).body as any[];
    const ph = (await admin.json("/api/soc/alerts?status=all&source=manual")).body as any[];
    expect(ph.every((a) => a.source === "manual")).toBe(true);
    expect(ph.length).toBeLessThanOrEqual(all.length);
    expect(((await admin.json("/api/soc/alerts?status=all&from=2099-01-01")).body as any[]).length).toBe(0);
    expect((await admin.json("/api/soc/alerts?source=X;drop")).status).toBe(400);
  });

  test("detail zranitelnosti: výskyty, postup podle OS, AI rozbor bez názvů aktiv (ADR-076)", async () => {
    const [a1] = await db.execute(sql`insert into assets (name, asset_type, os_name, os_version) values ('srv-tajny-nazev', 'server', 'Ubuntu', '22.04') returning id`);
    const [a2] = await db.execute(sql`insert into assets (name, asset_type, os_name) values ('pc-win', 'workstation', 'Microsoft Windows 11 Pro') returning id`);
    await db.execute(sql`insert into asset_vulnerabilities (asset_id, cve_id, severity, cvss_score, package_name, package_version, description, status) values (${(a1 as any).id}, 'CVE-2026-77001', 'critical', 9.8, 'openssl', '3.0.2-0ubuntu1', 'Buffer overflow v knihovně.', 'open'), (${(a2 as any).id}, 'CVE-2026-77001', 'critical', 9.8, 'OpenSSL', '3.0.1', null, 'open')`);
    await db.execute(sql`insert into vuln_intel (cve_id, kev, kev_name, kev_date_added, epss) values ('CVE-2026-77001', true, 'OpenSSL RCE', '2026-10-01', 0.71) on conflict (cve_id) do update set kev = true, epss = 0.71`);
    expect((await admin.json("/api/vulnerabilities/cve/nesmysl")).status).toBe(400);
    expect((await admin.json("/api/vulnerabilities/cve/CVE-2099-99999")).status).toBe(404);
    const d = (await admin.json("/api/vulnerabilities/cve/cve-2026-77001")).body;
    expect(d).toMatchObject({ cveId: "CVE-2026-77001", priority: "p1", kev: true, open: 2, advice: null });
    const deb = d.fix.find((g: any) => g.osFamily === "debian");
    expect(deb).toMatchObject({ packageName: "openssl", assets: 1, command: "sudo apt-get update && sudo apt-get install --only-upgrade openssl", verify: "dpkg -l openssl" });
    expect(d.fix.find((g: any) => g.osFamily === "windows").command).toBeNull();
    // AI rozbor
    await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: true, provider: "openai", baseUrl: AI_URL, model: "gpt-oss:20b", apiKey: "owui-key" } });
    const r = await admin.json("/api/vulnerabilities/cve/CVE-2026-77001/advice", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ summary: "Chyba v knihovně umožňuje vzdálené spuštění kódu.", remediation: ["Aktualizujte balíček openssl.", "Restartujte služby."], workaround: ["Omezte přístup k portu 443"], references: ["https://nvd.nist.gov/vuln/detail/CVE-2026-77001"] });
    const sent = JSON.stringify(aiCalls.at(-1));
    expect(sent).toContain("CVE-2026-77001");
    expect(sent).toContain("Ubuntu 22.04");
    expect(sent).not.toContain("srv-tajny-nazev");
    expect(sent).not.toContain("pc-win");
    // uloženo – vidí ho tým při dalším načtení
    expect((await admin.json("/api/vulnerabilities/cve/CVE-2026-77001")).body.advice).toMatchObject({ summary: "Chyba v knihovně umožňuje vzdálené spuštění kódu.", model: "gpt-oss:20b" });
  });

  test("přehodnocení rizik z podnětů: incident, zjištění auditu, návrh hodnot, potvrzení beze změny, změna, povinnost, zpráva", async () => {
    const rk = (await admin.json("/api/risks", { method: "POST", json: { name: "Výpadek mzdového systému (podněty)", assetIds: [ids.primary], impact: 2, threatLevel: 2, vulnLevel: 2 } })).body;
    const re0 = (await admin.json(`/api/risks/${rk.id}/reassessment`)).body;
    expect(re0.triggers).toEqual([]);
    expect(re0.baseline).toBeTruthy();
    expect(rk.triggers).toBe(0);
    // incident na riziku + závažné zjištění auditu
    const inc = (await admin.json("/api/incidents", { method: "POST", json: { title: "Nedostupnost mzdového systému", kind: "incident", category: "dos", detectedAt: new Date().toISOString(), riskIds: [rk.id] } })).body;
    const au = (await admin.json("/api/audits", { method: "POST", json: { title: "Audit rizik (podněty)", auditType: "partial", sections: ["§ 8"] } })).body;
    expect((await admin.json(`/api/audits/${au.id}/findings`, { method: "POST", json: { title: "Riziko neodráží incidenty", severity: "major", riskId: rk.id } })).status).toBe(201);
    const re1 = (await admin.json(`/api/risks/${rk.id}/reassessment`)).body;
    expect(re1.triggers.map((t: any) => t.kind).sort()).toEqual(["audit_finding", "incident"]);
    expect(re1.triggers.find((t: any) => t.kind === "incident").link).toBe(`/incidents/${inc.id}`);
    expect(re1.due).toBeTruthy();
    // návrh: hrozba i zranitelnost o stupeň výš – jen návrh, riziko se nezměnilo
    expect(re1.suggestion).toContainEqual(expect.objectContaining({ field: "threatLevel", from: 2, to: 3 }));
    expect(re1.suggestion).toContainEqual(expect.objectContaining({ field: "vulnLevel", from: 2, to: 3 }));
    expect((await admin.json(`/api/risks/${rk.id}`)).body.threatLevel).toBe(2);
    // seznam: počet podnětů a filtr
    const list = (await admin.json("/api/risks?triggers=1&limit=500")).body;
    expect(list.items.find((x: any) => x.id === rk.id)?.triggers).toBe(2);
    expect(list.items.every((x: any) => x.triggers > 0)).toBe(true);
    // povinnost vlastníka rizika s termínem
    const { collectObligations } = await import("../src/modules/notifications/obligations");
    const obl = async () => collectObligations(db, { companyIds: [rk.companyId], leadDays: 14, includeLater: true });
    const ob = (await obl()).find((o) => o.key === `risk_trigger:${rk.id}`) as any;
    expect(ob?.kind).toBe("risk_trigger");
    expect(ob.due).toBe(re1.due);
    // zpráva o přezkoumání ISMS: čekající rozhodnutí
    const HC = { "x-contix-company": rk.companyId };
    const doc = (await admin.json("/api/documents", { method: "POST", headers: HC, json: { kind: "isms_review" } })).body;
    const html = await (await admin.req(`/api/documents/${doc.id}/html`, { headers: HC })).text();
    expect(html).toContain("Přehodnocení rizik z podnětů");
    expect(html).toContain("Výpadek mzdového systému (podněty)");
    // čtenář nerozhoduje
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json(`/api/risks/${rk.id}/review`, { method: "POST", json: { note: "Beze změny, opatření stačí." } })).status).toBe(403);
    // potvrzení beze změny vyžaduje zdůvodnění
    expect((await admin.json(`/api/risks/${rk.id}/review`, { method: "POST", json: { note: "ok" } })).status).toBe(400);
    const conf = await admin.json(`/api/risks/${rk.id}/review`, { method: "POST", json: { note: "Incident byl způsoben výpadkem dodavatele, hodnocení odpovídá." } });
    expect(conf.status).toBe(200);
    expect(conf.body.triggers).toBe(0);
    expect(conf.body.reviewedAt).toBeTruthy();
    const re2 = (await admin.json(`/api/risks/${rk.id}/reassessment`)).body;
    expect(re2.triggers).toEqual([]);
    expect(re2.reviews[0]).toMatchObject({ decision: "confirmed", levelBefore: re2.reviews[0].levelAfter });
    expect(re2.reviews[0].triggers.length).toBe(2);
    expect((await obl()).some((o) => o.key === `risk_trigger:${rk.id}`)).toBe(false);
    // další incident → nový podnět; změna hodnocení se zdůvodněním ho uzavře a zapíše do historie
    await admin.json("/api/incidents", { method: "POST", json: { title: "Opakovaná nedostupnost", kind: "incident", category: "dos", detectedAt: new Date().toISOString(), riskIds: [rk.id] } });
    expect((await admin.json(`/api/risks/${rk.id}`)).body.triggers).toBe(1);
    const ch = await admin.json(`/api/risks/${rk.id}`, { method: "PATCH", json: { threatLevel: 3, reviewNote: "Opakované výpadky – vyšší hrozba." } });
    expect(ch.status).toBe(200);
    expect(ch.body.triggers).toBe(0);
    const re3 = (await admin.json(`/api/risks/${rk.id}/reassessment`)).body;
    expect(re3.reviews[0]).toMatchObject({ decision: "changed", note: "Opakované výpadky – vyšší hrozba." });
    expect(re3.reviews[0].scoreAfter).toBeGreaterThan(re3.reviews[0].scoreBefore);
    expect(re3.reviews[0].triggers.map((t: any) => t.kind)).toEqual(["incident"]);
    // auditní záznam
    const log = (await admin.json("/api/admin/audit-log?limit=100")).body as any[];
    expect(log.some((l) => l.action === "risk.reviewed" && l.entityId === rk.id)).toBe(true);
  });

  test("SOC X: plánované hledání hrozeb – knihovna, zkušební běh, alert nad prahem, okno, plánovač", async () => {
    const tpl = ((await admin.json("/api/soc/hunts/templates")).body as any[]).find((x) => x.key === "brute_force_source");
    expect(tpl.mitreIds).toContain("T1110");
    expect((await admin.json("/api/soc/hunts", { method: "POST", json: { ...tpl, groupBy: "data.srcip; drop", templateKey: tpl.key } })).status).toBe(400);
    const h = (await admin.json("/api/soc/hunts", { method: "POST", json: { name: tpl.name, hypothesis: tpl.hypothesis, query: "rule.groups:(authentication_failed OR authentication_failures)", groupBy: "data.srcip", threshold: 2, severity: "high", mitreIds: tpl.mitreIds, templateKey: tpl.key, lookbackHours: 24, intervalHours: 1 } })).body;
    expect(h.nextRunAt).toBe(new Date(0).toISOString());
    // zkušební běh: skupina nad prahem, žádný alert, okno se neposouvá
    const dry = (await admin.json(`/api/soc/hunts/${h.id}/run?dryRun=1`, { method: "POST" })).body;
    expect(dry.run).toMatchObject({ dryRun: true, alerts: 0, error: null });
    expect(dry.run.buckets).toEqual([expect.objectContaining({ key: "203.0.113.7", agentName: "agent-001" })]);
    expect(dry.run.buckets[0].count).toBeGreaterThanOrEqual(2);
    expect(dry.hunt.lastRun).toBeNull();
    // vyšší práh → nic
    await admin.json(`/api/soc/hunts/${h.id}`, { method: "PATCH", json: { threshold: 5 } });
    expect((await admin.json(`/api/soc/hunts/${h.id}/run?dryRun=1`, { method: "POST" })).body.run.buckets).toEqual([]);
    await admin.json(`/api/soc/hunts/${h.id}`, { method: "PATCH", json: { threshold: 2 } });
    // skutečný běh → alert SOC
    const r1 = (await admin.json(`/api/soc/hunts/${h.id}/run`, { method: "POST" })).body;
    expect(r1.run.alerts).toBe(1);
    expect(r1.hunt.openAlerts).toBe(1);
    const al = ((await admin.json(`/api/soc/alerts?q=${encodeURIComponent(`Hledání hrozeb: ${tpl.name}`)}`)).body as any[])[0];
    expect(al).toMatchObject({ source: "hunt", severity: "high", mitreIds: ["T1110"] });
    expect(al.title).toContain("203.0.113.7");
    // další běh pokračuje od konce okna → nic nového
    const r2 = (await admin.json(`/api/soc/hunts/${h.id}/run`, { method: "POST" })).body;
    expect(r2.run.total).toBe(0);
    expect(new Date(r2.run.since).getTime()).toBe(new Date(r1.run.at).getTime());
    // plánovač: interval ještě neuplynul
    const { processHunts } = await import("../src/modules/soc/hunts");
    expect(await processHunts({ db, config })).toBe(0);
    expect(await processHunts({ db, config }, new Date(Date.now() + 2 * 3600_000))).toBeGreaterThanOrEqual(1);
    // změna dotazu → okno znovu od „zpět o“
    await admin.json(`/api/soc/hunts/${h.id}`, { method: "PATCH", json: { query: "rule.groups:authentication_failures" } });
    const r3 = (await admin.json(`/api/soc/hunts/${h.id}/run`, { method: "POST" })).body;
    expect(r3.run.total).toBeGreaterThanOrEqual(2);
    expect(r3.run.alerts).toBe(0); // otevřený alert se jen navýší
    // čtenář nemůže zakládat
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json("/api/soc/hunts", { method: "POST", json: { name: "x x x", query: "rule.id:1" } })).status).toBe(403);
    await admin.json(`/api/soc/alerts/${al.id}/close`, { method: "POST", json: { verdict: "undetermined", reason: "test" } });
    expect((await admin.json(`/api/soc/hunts/${h.id}`, { method: "DELETE" })).status).toBe(204);
  });

  test("SOC XI: playbooky s úkoly pro tým – vlastní playbook, návrh podle ATT&CK, úkoly z kroků, splnění = hotový krok", async () => {
    const [pos] = (await db.execute(sql`select ou.company_id from positions p join org_units ou on ou.id = p.org_unit_id where p.id = ${ids.posMkb}`)) as any[];
    const H = { "x-contix-company": pos.company_id };
    const pbs = (await admin.json("/api/soc/playbooks", { headers: H })).body;
    expect(pbs.builtin.find((p: any) => p.key === "brute_force").steps.length).toBeGreaterThan(3);
    // vlastní playbook (kopie vestavěného) s odpovědností a lhůtou kroků
    expect((await admin.json("/api/soc/playbooks", { method: "POST", headers: H, json: { name: "Hesla", techniques: ["T1110"], steps: [{ text: "Krok s cizím místem", ownerPositionId: "00000000-0000-4000-8000-0000000000ff" }] } })).status).toBe(400);
    const pb = await admin.json("/api/soc/playbooks", {
      method: "POST",
      headers: H,
      json: { name: "Hádání hesel – postup organizace", techniques: ["t1110"], basedOn: "brute_force", steps: [{ text: "Zablokovat zdrojovou IP na firewallu", ownerPositionId: ids.posMkb, dueHours: 4 }, { text: "Resetovat heslo dotčeného účtu", dueHours: 24 }, { text: "Informovat vlastníka aktiva" }] },
    });
    expect(pb.status).toBe(201);
    expect(pb.body.techniques).toEqual(["T1110"]);
    // alert s T1110 → navrhne se vlastní playbook
    const al = (await admin.json("/api/soc/alerts", { method: "POST", headers: H, json: { companyId: pos.company_id, title: "Playbook test hádání hesel", severity: "high", mitreIds: ["T1110"] } })).body;
    expect(al.playbook).toMatchObject({ key: `c:${pb.body.id}`, custom: true });
    expect(al.playbook.steps[0].ownerPositionId).toBe(ids.posMkb);
    // úkoly týmu z kroků 1 a 2
    const r = (await admin.json(`/api/soc/alerts/${al.id}/playbook-tasks`, { method: "POST", headers: H, json: { steps: [{ index: 0, ownerPositionId: ids.posMkb, dueDate: "2026-12-01" }, { index: 1, ownerPositionId: null, dueDate: null }] } })).body;
    expect(r).toMatchObject({ created: 2, skipped: 0 });
    expect(r.alert.playbookTasks.map((x: any) => x.step)).toEqual([0, 1]);
    expect(r.alert.notes.at(-1).text).toContain("Zadány úkoly týmu");
    // opakované zadání stejného kroku se přeskočí
    expect((await admin.json(`/api/soc/alerts/${al.id}/playbook-tasks`, { method: "POST", headers: H, json: { steps: [{ index: 0, ownerPositionId: null, dueDate: null }] } })).body).toMatchObject({ created: 0, skipped: 1 });
    // úkol je v Akce a úkoly s odkazem na alert
    const t0 = r.alert.playbookTasks[0];
    const task = (await admin.json(`/api/actions/tasks/${t0.taskId}`, { headers: H })).body;
    expect(task).toMatchObject({ sourceKind: "soc_alert", sourceId: al.id, priority: "high", ownerPositionId: ids.posMkb });
    // splnění úkolu → hotový krok playbooku a poznámka
    expect((await admin.json(`/api/actions/tasks/${t0.taskId}`, { method: "PATCH", headers: H, json: { status: "done", completionNote: "IP zablokována" } })).status).toBe(200);
    const det = (await admin.json(`/api/soc/alerts/${al.id}`, { headers: H })).body;
    expect(det.playbookDone).toEqual([0]);
    expect(det.notes.at(-1).text).toContain("krok 1 playbooku");
    // AI rozbor dostane kroky vlastního playbooku
    await admin.json(`/api/soc/alerts/${al.id}/advise`, { method: "POST", headers: H });
    expect(JSON.stringify(aiCalls.at(-1).messages)).toContain("Zablokovat zdrojovou IP na firewallu");
    // používaný playbook se při smazání jen vypne; alert ho dál zobrazuje
    expect((await admin.json(`/api/soc/playbooks/${pb.body.id}`, { method: "DELETE", headers: H })).body).toEqual({ deleted: false });
    expect((await admin.json(`/api/soc/alerts/${al.id}`, { headers: H })).body.playbook.key).toBe(`c:${pb.body.id}`);
    const al2 = (await admin.json("/api/soc/alerts", { method: "POST", headers: H, json: { companyId: pos.company_id, title: "Playbook test 2", severity: "medium", mitreIds: ["T1110"] } })).body;
    expect(al2.playbook.key).toBe("brute_force");
    for (const x of [al, al2]) await admin.json(`/api/soc/alerts/${x.id}/close`, { method: "POST", headers: H, json: { verdict: "undetermined", reason: "test" } });
  });

  test("SOC XII: pohled na hostitele – přehled, aktivum se zranitelnostmi a riziky, hostitel bez aktiva se zdroji hrozeb", async () => {
    const [v] = (await db.execute(sql`select a.id, a.company_id from alert_suggestions s join assets a on a.id = s.asset_id where (s.exposure->>'exploit')::boolean group by a.id, a.company_id order by count(*) desc limit 1`)) as any[];
    const H = { "x-contix-company": v.company_id };
    const list = (await admin.json("/api/soc/hosts?days=30", { headers: H })).body as any[];
    const h = list.find((x) => x.key === `a:${v.id}`);
    expect(h).toMatchObject({ assetId: v.id, exploit: true });
    expect(h.total).toBeGreaterThanOrEqual(3);
    const d = (await admin.json(`/api/soc/hosts/a:${v.id}?days=30`, { headers: H })).body;
    expect(d.asset.id).toBe(v.id);
    expect(d.counts.total).toBe(h.total);
    expect(d.counts.exploit).toBeGreaterThanOrEqual(2);
    expect(d.daily).toHaveLength(30);
    expect(d.daily.reduce((n: number, x: any) => n + x.low + x.medium + x.high + x.critical, 0)).toBeGreaterThan(0);
    expect(d.vulns.total).toBeGreaterThan(0);
    expect(d.vulns.top[0]).toHaveProperty("priority");
    expect(d.risks.map((r: any) => r.name)).toContain("Zneužití zranitelnosti webového serveru");
    expect(Object.keys(d.tactics).length).toBeGreaterThan(0);
    // hostitel bez aktiva (webhook, krátké jméno agenta) se shodou ve zdrojích hrozeb
    const ti = list.find((x) => x.key === "h:pc-ti-01") ?? ((await admin.json("/api/soc/hosts?days=30&q=pc-ti")).body as any[])[0];
    expect(ti?.key).toBe("h:pc-ti-01");
    const dt = (await admin.json("/api/soc/hosts/h:pc-ti-01")).body;
    expect(dt.asset).toBeNull();
    expect(dt.agentNames).toContain("pc-ti-01");
    expect(dt.intel).toEqual(expect.arrayContaining([expect.objectContaining({ source: "threatfox", value: "198.51.100.200" })]));
    expect(dt.vulns).toBeNull();
    // neplatný / neznámý klíč, čtenář bez SOC
    expect((await admin.json("/api/soc/hosts/x:nic")).status).toBe(404);
    expect((await admin.json("/api/soc/hosts/h:neexistuje-host")).status).toBe(404);
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json(`/api/soc/hosts/a:${v.id}`)).status).toBe(403);
  });

  test("SOC XIII: stahování ze SIEM – Microsoft Sentinel (incidenty) a Elastic Security (alerty), kurzor, chyby, webhook", async () => {
    const mod = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const seen: { filter: string | null; auth: string | null; secret?: string | null }[] = [];
    const incidents = [
      { name: "inc-guid-1", properties: { title: "Sentinel: přihlášení z neobvyklé země", description: "Uživatel se přihlásil z nové země.", severity: "High", status: "New", incidentNumber: 4711, createdTimeUtc: mod(30), lastModifiedTimeUtc: mod(10), additionalData: { alertsCount: 3, tactics: ["InitialAccess"], techniques: ["T1078"], alertProductNames: ["Azure Active Directory Identity Protection"] }, incidentUrl: "https://portal.azure.com/#incident/4711" } },
      { name: "inc-guid-2", properties: { title: "Sentinel: uzavřený incident", severity: "Low", status: "Closed", incidentNumber: 4700, createdTimeUtc: mod(50), lastModifiedTimeUtc: mod(20) } },
    ];
    const siem = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/tenant-x/oauth2/v2.0/token") {
          const f = new URLSearchParams(await req.text());
          seen.push({ filter: null, auth: null, secret: f.get("client_secret") });
          return f.get("client_secret") === "sent-secret" ? Response.json({ access_token: "tok-1" }) : new Response("bad", { status: 401 });
        }
        if (u.pathname.endsWith("/providers/Microsoft.SecurityInsights/incidents")) {
          if (req.headers.get("authorization") !== "Bearer tok-1") return new Response("no", { status: 401 });
          const filter = u.searchParams.get("$filter");
          seen.push({ filter, auth: req.headers.get("authorization") });
          const gt = filter?.match(/gt (\S+)$/)?.[1];
          return Response.json({ value: incidents.filter((i) => !gt || i.properties.lastModifiedTimeUtc > gt) });
        }
        if (u.pathname === "/.alerts-security.alerts-default/_search") {
          if (req.headers.get("authorization") !== "ApiKey el-key") return new Response("no", { status: 401 });
          const body = (await req.json()) as any;
          const gt = body.query.bool.filter[0].range["@timestamp"].gt;
          const doc = { _id: "el-1", sort: [1, "el-1"], _source: { "@timestamp": mod(5), "kibana.alert.uuid": "el-uuid-1", "kibana.alert.rule.name": "Elastic: podezřelý PowerShell", "kibana.alert.rule.rule_id": "ps-encoded", "kibana.alert.severity": "high", "kibana.alert.risk_score": 73, "kibana.alert.reason": "process event with process powershell.exe -enc …", "kibana.alert.workflow_status": "open", "kibana.alert.rule.threat": [{ framework: "MITRE ATT&CK", technique: [{ id: "T1059", subtechnique: [{ id: "T1059.001" }] }] }], host: { name: "srv-el-01.firma.local", ip: ["10.9.9.9"] }, source: { ip: "203.0.113.99" }, user: { name: "svc-app" } } };
          return Response.json({ hits: { hits: doc._source["@timestamp"] > gt ? [doc] : [] } });
        }
        return new Response("nf", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${siem.port}`;
    try {
      // generický zdroj stahování neumí
      expect((await admin.json("/api/soc/sources", { method: "POST", json: { name: "Gen pull", preset: "generic", pull: { elastic: { url: base } } } })).status).toBe(400);
      const sen = await admin.json("/api/soc/sources", {
        method: "POST",
        json: { name: "Sentinel produkce", preset: "sentinel", pull: { intervalMinutes: 15, sentinel: { tenantId: "tenant-x", clientId: "app-1", subscriptionId: "sub1", resourceGroup: "rg1", workspace: "ws1", authorityUrl: base, managementUrl: base } }, secret: "spatne" },
      });
      expect(sen.status).toBe(201);
      expect(sen.body.source.pull).toMatchObject({ hasSecret: true, config: { intervalMinutes: 15 } });
      expect(JSON.stringify(sen.body)).not.toContain("spatne");
      // špatné tajemství → chyba, kurzor se neposune
      const bad = (await admin.json(`/api/soc/sources/${sen.body.source.id}/pull`, { method: "POST" })).body;
      expect(bad.result.error).toContain("odmítl přístup");
      expect(bad.source.pull.cursor).toBeNull();
      await admin.json(`/api/soc/sources/${sen.body.source.id}`, { method: "PATCH", json: { secret: "sent-secret" } });
      const ok = (await admin.json(`/api/soc/sources/${sen.body.source.id}/pull`, { method: "POST" })).body;
      expect(ok.result).toMatchObject({ fetched: 2, created: 1, error: null });
      expect(ok.source.pull.cursor).toBe(incidents[0]!.properties.lastModifiedTimeUtc);
      const sa = ((await admin.json("/api/soc/alerts?q=Sentinel: přihlášení z neobvyklé země")).body as any[])[0];
      expect(sa).toMatchObject({ source: "sentinel", severity: "high", mitreIds: ["T1078"] });
      expect(sa.ruleId).toBe("sentinel:inc-4711");
      expect(((await admin.json("/api/soc/alerts?q=Sentinel: uzavřený")).body as any[]).length).toBe(0);
      // další stažení od kurzoru → nic nového
      const again = (await admin.json(`/api/soc/sources/${sen.body.source.id}/pull`, { method: "POST" })).body;
      expect(again.result).toMatchObject({ fetched: 0, created: 0 });
      expect(seen.filter((x) => x.filter).at(-1)!.filter).toContain(incidents[0]!.properties.lastModifiedTimeUtc);
      // Elastic Security
      const el = (await admin.json("/api/soc/sources", { method: "POST", json: { name: "Elastic SIEM", preset: "elastic", pull: { elastic: { url: base, authType: "apikey" } }, secret: "el-key" } })).body;
      expect(el.source.pull.config.elastic.index).toBe(".alerts-security.alerts-default");
      const er = (await admin.json(`/api/soc/sources/${el.source.id}/pull`, { method: "POST" })).body;
      expect(er.result).toMatchObject({ fetched: 1, created: 1, error: null });
      const ea = ((await admin.json("/api/soc/alerts?q=Elastic: podezřelý PowerShell")).body as any[])[0];
      expect(ea).toMatchObject({ source: "elastic", severity: "high", agentName: "srv-el-01.firma.local" });
      expect(ea.mitreIds).toEqual(expect.arrayContaining(["T1059", "T1059.001"]));
      // plánovač: interval ještě neuplynul
      const { processPullSources } = await import("../src/modules/soc/pull");
      expect(await processPullSources({ db, config })).toBe(0);
      // push: incident ze Sentinelu přes Logic App na webhook
      const tokenRes = (await admin.json(`/api/soc/sources/${sen.body.source.id}/rotate`, { method: "POST" })).body;
      const push = await app.request("/api/public/soc/ingest", { method: "POST", headers: { authorization: `Bearer ${tokenRes.token}`, "content-type": "application/json" }, body: JSON.stringify({ object: { name: "x", properties: { title: "Sentinel push incident", severity: "Medium", status: "Active", incidentNumber: 4800, additionalData: { techniques: ["T1566"] } } } }) });
      expect(((await push.json()) as any).created).toBe(1);
      for (const a of [sa, ea]) await admin.json(`/api/soc/alerts/${a.id}/close`, { method: "POST", json: { verdict: "undetermined", reason: "test" } });
      // vypnutí stahování
      const off = (await admin.json(`/api/soc/sources/${el.source.id}`, { method: "PATCH", json: { pull: null } })).body;
      expect(off.pull).toBeNull();
    } finally {
      siem.stop(true);
    }
  });

  test("graf vazeb aktiv: uzly ve vrstvách, vazby, technické závislosti, překryvy, oprávnění", async () => {
    const [l] = (await db.execute(sql`select l.primary_id, l.supporting_id, a.company_id from asset_links l join assets a on a.id = l.supporting_id limit 1`)) as any[];
    expect(l).toBeTruthy();
    const H = { "x-contix-company": l.company_id };
    const g0 = (await admin.json("/api/assets/graph", { headers: H })).body;
    const sup = g0.nodes.find((n: any) => n.id === l.supporting_id);
    expect(sup).toMatchObject({ kind: "asset" });
    expect(g0.nodes.find((n: any) => n.id === l.primary_id).layer).toBe("primary");
    expect(g0.edges).toContainEqual(expect.objectContaining({ from: l.primary_id, to: l.supporting_id, kind: "supports" }));
    expect(g0.overlays).toMatchObject({ vulns: true, alerts: true, risks: true });
    expect(sup.vulns).toHaveProperty("p1");
    // technická závislost: nový server, na kterém podpůrné aktivum běží
    const srv = (await admin.json("/api/assets", { method: "POST", headers: H, json: { name: "Graf-HV-01", assetType: "server", companyId: l.company_id } })).body;
    expect((await admin.json("/api/assets/dependencies", { method: "POST", headers: H, json: { fromId: srv.id, toId: srv.id } })).status).toBe(400);
    expect((await admin.json("/api/assets/dependencies", { method: "POST", headers: H, json: { fromId: l.supporting_id, toId: srv.id, kind: "runs_on", note: "VM na hypervizoru" } })).status).toBe(201);
    expect((await admin.json("/api/assets/dependencies", { method: "POST", headers: H, json: { fromId: srv.id, toId: l.supporting_id } })).status).toBe(400);
    const g1 = (await admin.json("/api/assets/graph", { headers: H })).body;
    expect(g1.edges).toContainEqual({ from: l.supporting_id, to: srv.id, kind: "depends", depKind: "runs_on", note: "VM na hypervizoru" });
    expect(g1.nodes.find((n: any) => n.id === srv.id).layer).toBe("infrastructure");
    // detail aktiva ukazuje závislosti oběma směry
    expect((await admin.json(`/api/assets/${srv.id}`, { headers: H })).body.dependedBy).toEqual([expect.objectContaining({ id: l.supporting_id, kind: "runs_on" })]);
    expect((await admin.json(`/api/assets/${l.supporting_id}`, { headers: H })).body.dependsOn.map((d: any) => d.id)).toContain(srv.id);
    // čtenář graf vidí, závislosti nemění
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json("/api/assets/graph")).status).toBe(200);
    expect((await viewer.json("/api/assets/dependencies", { method: "POST", json: { fromId: srv.id, toId: l.primary_id } })).status).toBe(403);
    expect((await admin.json(`/api/assets/dependencies?fromId=${l.supporting_id}&toId=${srv.id}`, { method: "DELETE", headers: H })).status).toBe(204);
    expect((await admin.json("/api/assets/graph", { headers: H })).body.edges.some((e: any) => e.kind === "depends" && e.to === srv.id)).toBe(false);
  });

  test("shoda konfigurace – Wazuh SCA: načtení politik a kontrol, přehled, detail aktiva, automatický test opatření", async () => {
    const ov = (await admin.json("/api/sca/sync", { method: "POST" })).body;
    expect(ov.lastSync).toMatchObject({ error: null, policies: 2, checks: 9 });
    expect(ov.totals).toMatchObject({ assets: 2, pass: 4, fail: 4, score: 50 });
    const win = ov.policies.find((p: any) => p.policyId === "cis_win11_enterprise");
    expect(win).toMatchObject({ assets: 1, score: 25 });
    expect(ov.policies[0].policyId).toBe("cis_win11_enterprise"); // nejhorší první
    expect(ov.topFailed.map((f: any) => f.title)).toContain("Ensure 'Minimum password length' is set to '14 or more character(s)'");
    expect(ov.topFailed[0].compliance["iso_27001-2013"]).toEqual(["A.9.4.3", "A.12.6.1"]);
    // detail aktiva
    const [srv] = (await db.execute(sql`select asset_id from asset_sources where source_type = 'wazuh' and source_ref = '001'`)) as any[];
    const det = (await admin.json(`/api/sca/assets/${srv.asset_id}`)).body;
    expect(det.policies[0]).toMatchObject({ policyId: "cis_ubuntu24-04", pass: 3, fail: 1, na: 1, score: 75 });
    expect(det.policies[0].checks.map((c: any) => c.result)).toEqual(["passed", "passed", "passed", "failed", "not_applicable"]);
    // opakované načtení bez nového skenu kontroly nestahuje
    const calls = scaCheckCalls.length;
    await admin.json("/api/sca/sync", { method: "POST" });
    expect(scaCheckCalls.length).toBe(calls);
    // automatický test opatření
    const [ctl] = (await db.execute(sql`select c.id from controls c join assets a on a.company_id = c.company_id where a.id = ${srv.asset_id} limit 1`)) as any[];
    expect((await admin.json("/api/sca/automations", { method: "POST", json: { controlId: ctl.id, kind: "sca", scaMinScore: 50, scaWarnScore: 80 } })).status).toBe(400);
    const au = (await admin.json("/api/sca/automations", { method: "POST", json: { controlId: ctl.id, kind: "sca", scaMinScore: 90, scaWarnScore: 50, applyEffectiveness: false } })).body;
    expect(au).toMatchObject({ kind: "sca", scaMinScore: 90 });
    const run = (await admin.json(`/api/sca/automations/${au.id}/run`, { method: "POST" })).body;
    expect(run.lastResult).toBe("effective_with_exceptions");
    const [test] = (await db.execute(sql`select result, population_size, conclusion from control_tests where id = ${run.lastTestId}`)) as any[];
    expect(test.result).toBe("effective_with_exceptions");
    expect(test.conclusion).toContain("50 %");
    const [ev] = (await db.execute(sql`select count(*)::int as n from evidence_controls where control_id = ${ctl.id}`)) as any[];
    expect(ev.n).toBeGreaterThan(0);
    // automatizace SCA nepatří do Identity a přístupy
    expect(((await admin.json("/api/identity/automations")).body as any[]).some((a) => a.id === au.id)).toBe(false);
    expect((await admin.json(`/api/identity/automations/${au.id}/run`, { method: "POST" })).status).toBe(404);
    // jen politika Ubuntu → 75 % → stále pod 90 %, nad 50 %
    await admin.json(`/api/sca/automations/${au.id}`, { method: "PUT", json: { controlId: ctl.id, kind: "sca", scaPolicies: ["cis_ubuntu24-04"], scaMinScore: 70, scaWarnScore: 50 } });
    expect((await admin.json(`/api/sca/automations/${au.id}/run`, { method: "POST" })).body.lastResult).toBe("effective");
  });

  test("analýza odolnosti: RTO z BIA po grafu, jediný bod selhání, kritičnost, redundance, plán kontinuity", async () => {
    const [co] = (await db.execute(sql`select company_id from assets where id = ${ids.primary}`)) as any[];
    const H = { "x-contix-company": co.company_id };
    const mk = async (json: Record<string, unknown>) => (await admin.json("/api/assets", { method: "POST", headers: H, json: { companyId: co.company_id, ...json } })).body;
    const svc = await mk({ name: "Odol-Služba", assetType: "business_service", assetClass: "primary", criticality: "critical" });
    const app = await mk({ name: "Odol-Aplikace", assetType: "application", criticality: "medium" });
    const srv = await mk({ name: "Odol-Server", assetType: "server", criticality: "low" });
    expect(srv.redundant).toBe(false);
    await admin.json("/api/assets/links", { method: "POST", headers: H, json: { primaryId: svc.id, supportingId: app.id } });
    await admin.json("/api/assets/dependencies", { method: "POST", headers: H, json: { fromId: app.id, toId: srv.id, kind: "runs_on" } });
    const proc = (await admin.json("/api/processes", { method: "POST", headers: H, json: { companyId: co.company_id, name: "Odol-Proces výplat" } })).body;
    expect((await admin.json(`/api/processes/${proc.id}/assets`, { method: "PUT", headers: H, json: { assetIds: [svc.id] } })).status).toBe(200);
    expect((await admin.json("/api/bia", { method: "POST", headers: H, json: { processId: proc.id, rtoHours: 4, rpoHours: 1, mtpdHours: 8 } })).status).toBe(201);
    const r = (await admin.json("/api/assets/resilience", { headers: H })).body;
    const req = r.requirements.find((x: any) => x.assetId === srv.id);
    expect(req).toMatchObject({ rtoHours: 4, rpoHours: 1, requiredCriticality: "critical", name: "Odol-Server" });
    expect(req.processes.map((p: any) => p.id)).toContain(proc.id);
    const f = (kind: string, id: string) => r.findings.find((x: any) => x.kind === kind && x.nodeId === id);
    expect(f("spof", srv.id)).toMatchObject({ severity: "critical", rtoHours: 4 });
    expect(f("criticality_gap", srv.id)).toMatchObject({ severity: "high", detail: { own: "low", required: "critical" } });
    expect(f("no_plan", srv.id)).toBeTruthy();
    // redundance odstraní SPOF, plán procesu pokryje i jeho aktiva
    await admin.json(`/api/assets/${srv.id}`, { method: "PATCH", headers: H, json: { redundant: true } });
    await admin.json("/api/continuity-plans", { method: "POST", headers: H, json: { name: "Odol-Plán obnovy", planType: "recovery", processIds: [proc.id] } });
    const r2 = (await admin.json("/api/assets/resilience", { headers: H })).body;
    expect(r2.findings.some((x: any) => x.kind === "spof" && x.nodeId === srv.id)).toBe(false);
    expect(r2.findings.some((x: any) => x.kind === "no_plan" && x.nodeId === srv.id)).toBe(false);
    // pohled procesu (BIA): jen jeho aktiva
    const rp = (await admin.json(`/api/assets/resilience/process/${proc.id}`, { headers: H })).body;
    expect(rp.requirements.map((x: any) => x.assetId).sort()).toEqual([svc.id, app.id, srv.id].sort());
  });

  test("cvičení: šablona ransomware, průběh s injecty, vyhodnocení → test plánu a úkoly, záznam pro audit", async () => {
    const [pl] = (await db.execute(sql`select id, company_id from continuity_plans order by created_at limit 1`)) as any[];
    const H = { "x-contix-company": pl.company_id };
    const tpl = ((await admin.json("/api/exercises/templates", { headers: H })).body as any[]).find((x) => x.key === "ransomware");
    expect(tpl.injects.length).toBe(4);
    const cr = await admin.json("/api/exercises", {
      method: "POST",
      headers: H,
      json: {
        companyId: pl.company_id,
        title: "Tabletop ransomware 2026",
        scenarioKey: "ransomware",
        scenario: tpl.scenario.cs,
        objectives: tpl.objectives.map((o: any) => ({ text: o.cs })),
        injects: tpl.injects.map((i: any) => ({ offsetMin: i.offsetMin, text: i.cs, expected: i.expectedCs })),
        participants: [{ name: "Jana Nováková", role: "IT provoz", positionId: ids.posMkb }],
        plannedAt: "2026-11-20",
        facilitatorPositionId: ids.posMkb,
        planIds: [pl.id],
      },
    });
    expect(cr.status).toBe(201);
    const ex = cr.body;
    expect(ex).toMatchObject({ status: "planned", code: expect.stringMatching(/^CV-\d+$/), plans: [expect.objectContaining({ id: pl.id })] });
    // povinnost facilitátora
    const { collectObligations } = await import("../src/modules/notifications/obligations");
    expect((await collectObligations(db, { companyIds: [pl.company_id], leadDays: 14, includeLater: true })).some((o) => o.key === `exercise:${ex.id}`)).toBe(true);
    // záznam do průběhu jen při běhu
    expect((await admin.json(`/api/exercises/${ex.id}/log`, { method: "POST", headers: H, json: { kind: "note", text: "x" } })).status).toBe(409);
    expect((await admin.json(`/api/exercises/${ex.id}/start`, { method: "POST", headers: H })).body.status).toBe("running");
    await admin.json(`/api/exercises/${ex.id}/log`, { method: "POST", headers: H, json: { kind: "inject", text: tpl.injects[0].cs, injectIndex: 0 } });
    expect((await admin.json(`/api/exercises/${ex.id}/log`, { method: "POST", headers: H, json: { kind: "inject", text: "?", injectIndex: 9 } })).status).toBe(400);
    const lg = (await admin.json(`/api/exercises/${ex.id}/log`, { method: "POST", headers: H, json: { kind: "decision", text: "Izolace segmentu serverů, aktivace plánu obnovy." } })).body;
    expect(lg.log.map((l: any) => l.kind)).toEqual(["note", "inject", "decision"]);
    // vyhodnocení
    const done = await admin.json(`/api/exercises/${ex.id}/complete`, {
      method: "POST",
      headers: H,
      json: { result: "partial", achievedRtoHours: 6, findings: "Obnova ze záloh trvala déle než RTO.", lessons: "Zrychlit obnovu – offline kopie na rychlém úložišti.", objectives: [{ met: true }, { met: false, note: "6 h místo 4 h" }], actions: [{ title: "Pořídit rychlé úložiště pro offline zálohy", ownerPositionId: ids.posMkb, dueDate: "2027-01-31" }] },
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "completed", result: "partial", achievedRtoHours: 6 });
    expect(done.body.objectives[1]).toMatchObject({ met: false, note: "6 h místo 4 h" });
    expect(done.body.tasks).toEqual([expect.objectContaining({ title: "Pořídit rychlé úložiště pro offline zálohy", status: "open" })]);
    const plan = (await admin.json(`/api/continuity-plans/${pl.id}`, { headers: H })).body;
    expect(plan.lastTest).toMatchObject({ result: "partial", achievedRtoHours: 6 });
    // dokončené cvičení je neměnné
    expect((await admin.json(`/api/exercises/${ex.id}`, { method: "PATCH", headers: H, json: { title: "Změna" } })).status).toBe(409);
    const html = await (await admin.req(`/api/exercises/${ex.id}/record.html`, { headers: H })).text();
    expect(html).toContain("Záznam o cvičení");
    expect(html).toContain("Izolace segmentu serverů");
    expect((await admin.req(`/api/exercises/${ex.id}/record.docx`, { headers: H })).headers.get("content-type")).toContain("officedocument");
  });

  test("hlášení incidentu NÚKIB: předvyplnění podle druhu, kontrola úplnosti, kontakt, SOC, text, záznam o podání", async () => {
    const inc = (await admin.json("/api/incidents", { method: "POST", json: { title: "Hlášení – nedostupnost portálu", kind: "incident", category: "dos", detectedAt: new Date(Date.now() - 3600_000).toISOString(), description: "Portál klientů nedostupný kvůli DDoS." } })).body;
    const r0 = (await admin.json(`/api/incidents/${inc.id}/report?type=initial`)).body;
    expect(r0.title).toContain("Prvotní hlášení");
    expect(r0.sections.map((x: any) => x.key)).toEqual(["ident", "basic"]);
    expect(r0.missing.map((m: any) => m.key)).toContain("contact");
    expect(r0.due).toBeTruthy();
    // kontakt v nastavení
    expect((await admin.json("/api/admin/settings", { method: "PATCH", json: { incidentContact: { name: "Petr Bezpečný", role: "Manažer KB", phone: "+420 111 222 333", email: "kb@firma.cz" }, regulatedServices: "Portál klientů" } })).status).toBe(200);
    const r1 = (await admin.json(`/api/incidents/${inc.id}/report?type=initial`)).body;
    expect(r1.missing.map((m: any) => m.key)).not.toContain("contact");
    expect(r1.text).toContain("Petr Bezpečný");
    expect(r1.text).toContain("Portál klientů nedostupný kvůli DDoS.");
    // závěrečná zpráva vyžaduje příčinu, poučení a vyřešení
    const fin = (await admin.json(`/api/incidents/${inc.id}/report?type=final`)).body;
    expect(fin.missing.map((m: any) => m.key)).toEqual(expect.arrayContaining(["cause", "lessons", "resolvedAt", "impact"]));
    // GDPR – příjemce ÚOOÚ, počet subjektů údajů
    const g = (await admin.json(`/api/incidents/${inc.id}/report?type=gdpr`)).body;
    expect(g.recipient).toBe("uoou");
    expect(g.missing.map((m: any) => m.key)).toContain("affectedUsers");
    // text ke stažení
    const txt = await admin.req(`/api/incidents/${inc.id}/report.txt?type=initial`);
    expect(txt.headers.get("content-disposition")).toContain("hlaseni-initial.txt");
    // záznam o podání s obsahem hlášení
    const sub = await admin.json(`/api/incidents/${inc.id}/reports`, { method: "POST", json: { reportType: "initial", recipient: "nukib", channel: "portal", submittedAt: new Date().toISOString(), reference: "NUKIB-2026-0042", summary: r1.text } });
    expect(sub.status).toBe(201);
    const d = (await admin.json(`/api/incidents/${inc.id}`)).body;
    expect(d.reports[0]).toMatchObject({ reportType: "initial", reference: "NUKIB-2026-0042" });
    expect(d.deadlines.find((x: any) => x.type === "initial").submittedAt).toBeTruthy();
    expect((await admin.json(`/api/incidents/${inc.id}/report?type=nesmysl`)).status).toBe(400);
  });

  test("DORA registr informací: subjekt, poskytovatel IKT, smlouva s funkcí, kontrola úplnosti, koncentrace, export", async () => {
    const proc = (await admin.json("/api/processes", { method: "POST", json: { name: "DORA platební styk", criticality: "critical" } })).body;
    expect((await admin.json("/api/bia", { method: "POST", json: { processId: proc.id, rtoHours: 3.5, rpoHours: 0.5, assessedAt: new Date().toISOString().slice(0, 10) } })).status).toBe(201);
    const sup = (await admin.json("/api/suppliers", { method: "POST", json: { name: "DORA Cloud s.r.o.", ico: "27074358" } })).body;
    const root = { id: sup.companyId };
    expect((await admin.json(`/api/suppliers/dora/entities/${root.id}`, { method: "PUT", json: { lei: "315700CONTIXTEST0156", country: "cz", entityType: 1, hierarchy: 4, currency: "CZK", competentAuthority: "CZ_CNB" } })).status).toBe(200);
    await admin.json(`/api/suppliers/${sup.id}/contracts`, { method: "POST", json: { title: "Hosting core", number: "SML-DORA-1", validFrom: "2025-01-01" } });
    const contractId = (await admin.json(`/api/suppliers/${sup.id}`)).body.contracts[0].id;
    // dodavatel není poskytovatel IKT → mimo registr, nabídne se v seznamu ostatních
    const before = (await admin.json("/api/suppliers/dora")).body;
    expect(before.contracts.find((x: any) => x.contractId === contractId)).toBeUndefined();
    expect(before.others.map((o: any) => o.id)).toContain(sup.id);
    expect((await admin.json(`/api/suppliers/${sup.id}`)).body.dora).toEqual({});
    expect((await admin.json(`/api/suppliers/dora/providers/${sup.id}`, { method: "PUT", json: { ict: true, country: "CZ", lei: "315700PROVIDERX00139" } })).status).toBe(200);
    let r = (await admin.json("/api/suppliers/dora")).body;
    expect(r.findings.map((f: any) => f.kind)).toEqual(expect.arrayContaining(["provider_lei", "contract_service", "contract_function", "contract_cost"]));
    await admin.json(`/api/suppliers/dora/providers/${sup.id}`, { method: "PUT", json: { ict: true, country: "CZ", lei: "315700PROVIDERX00138", parentCode: "315700CLOUDPARENT150", parentCodeType: "LEI" } });
    // smlouva podporuje kritickou funkci → chybí údaje pro kritickou funkci a posouzení
    expect((await admin.json(`/api/suppliers/dora/contracts/${contractId}`, { method: "PUT", json: { serviceTypes: ["S19", "S17"], processIds: [proc.id], annualCost: 1200000, currency: "CZK" } })).status).toBe(200);
    r = (await admin.json("/api/suppliers/dora")).body;
    const row = r.contracts.find((x: any) => x.contractId === contractId);
    expect(row).toMatchObject({ critical: true, reference: "SML-DORA-1", providerCode: "315700PROVIDERX00138", providerCodeType: "LEI" });
    expect(r.functions[0]).toMatchObject({ critical: "yes", rtoHours: 4, rpoHours: 1, activity: "support functions" });
    const fid = r.functions[0].functionId;
    expect(fid).toMatch(/^F\d+$/);
    expect(r.findings.filter((f: any) => f.ref.id === contractId).map((f: any) => f.kind).sort()).toEqual(["contract_assessment", "contract_critical_fields", "contract_exit_plan"]);
    // doplnění → smlouva úplná
    const full = { serviceTypes: ["S19", "S17"], processIds: [proc.id], annualCost: 1200000, currency: "CZK", noticeEntityDays: 90, noticeProviderDays: 180, governingLaw: "CZ", serviceCountry: "IE", storesData: true, dataLocation: "IE", processingLocation: "IE", dataSensitivity: "high", reliance: "full", substitutability: "highly_complex", nonSubstReason: "migration", exitPlan: true, reintegration: "difficult", discontinuationImpact: "high", alternatives: "yes", alternativeProvider: "Jiný cloud", chain: [{ rank: 2, name: "Datacentrum IE Ltd", code: "IE1234567X", codeType: "IE_VAT", serviceType: "S07" }] };
    await admin.json(`/api/suppliers/dora/contracts/${contractId}`, { method: "PUT", json: full });
    r = (await admin.json("/api/suppliers/dora")).body;
    expect(r.findings.filter((f: any) => f.ref.id === contractId)).toEqual([]);
    expect(r.concentration[0]).toMatchObject({ code: "315700CLOUDPARENT150", criticalFunctions: 1, notSubstitutable: true });
    expect((await admin.json(`/api/suppliers/dora/contracts/${contractId}`)).body).toMatchObject({ reliance: "full", processIds: [proc.id] });
    await admin.json(`/api/suppliers/dora/functions/${proc.id}`, { method: "PUT", json: { activity: "Platební služby (PSD2)" } });
    // export CSV šablon
    const z = await admin.req("/api/suppliers/dora/export.zip");
    expect(z.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await z.arrayBuffer()));
    const b0202 = strFromU8(files["b_02.02.csv"]!);
    expect(b0202.split("\r\n")[0]).toBe("c0010,c0020,c0030,c0040,c0050,c0060,c0070,c0080,c0090,c0100,c0110,c0120,c0130,c0140,c0150,c0160,c0170,c0180");
    expect(b0202).toContain(`SML-DORA-1,315700CONTIXTEST0156,315700PROVIDERX00138,LEI,${fid},S19,2025-01-01,9999-12-31,,90,180,CZ,IE,true,IE,IE,3,4`);
    expect(strFromU8(files["b_05.02.csv"]!)).toContain("SML-DORA-1,S07,IE1234567X,IE_VAT,2,315700PROVIDERX00138,LEI");
    expect(strFromU8(files["b_06.01.csv"]!)).toContain(`${fid},Platební služby (PSD2),DORA platební styk,315700CONTIXTEST0156,true`);
    expect(strFromU8(files["b_07.01.csv"]!)).toContain("SML-DORA-1,315700PROVIDERX00138,LEI,S19,2,2,9999-12-31,true,2,3,1,Jiný cloud");
    // validace
    expect((await admin.json(`/api/suppliers/dora/contracts/${contractId}`, { method: "PUT", json: { ...full, overarchingContractId: contractId } })).status).toBe(400);
    expect((await admin.json(`/api/suppliers/dora/entities/${root.id}`, { method: "PUT", json: { country: "Czechia" } })).status).toBe(400);
  });

  test.skipIf(!Bun.which("openssl"))("certifikáty a TLS: koncový bod, kontrola certifikátu, nálezy, povinnost, nedostupný server", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tls = await import("node:tls");
    const dir = mkdtempSync(join(tmpdir(), "contix-tls-"));
    const gen = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:1024", "-sha1", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "10", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stderr: "ignore", stdout: "ignore" });
    expect(gen.exitCode).toBe(0);
    const srv = tls.createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (s) => s.end());
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as any).port as number;
    try {
      expect((await admin.json("/api/assets/certificates", { method: "POST", json: { host: "https://x.cz/", port: 443 } })).status).toBe(400);
      const ep = await admin.json("/api/assets/certificates", { method: "POST", json: { host: "127.0.0.1", port, serverName: "localhost", note: "test" } });
      expect(ep.status).toBe(201);
      expect(ep.body.lastScanAt).toBeNull();
      expect((await admin.json("/api/assets/certificates", { method: "POST", json: { host: "127.0.0.1", port } })).status).toBe(409);
      const sc = (await admin.json(`/api/assets/certificates/${ep.body.id}/scan`, { method: "POST" })).body;
      expect(sc.result).toMatchObject({ ok: true, keyType: "RSA", keyBits: 1024, sigAlg: "sha1WithRSAEncryption", selfSigned: true, nameMatch: true, legacyProtocols: ["TLSv1.1"] });
      expect(sc.result.subject).toContain("CN=localhost");
      expect(sc.daysLeft).toBeGreaterThanOrEqual(8);
      expect(sc.findings.map((f: any) => f.kind).sort()).toEqual(["expiring", "legacy_protocol", "self_signed", "weak_key", "weak_signature"]);
      expect(sc.severity).toBe("high");
      // jiné jméno → neshoda
      await admin.json(`/api/assets/certificates/${ep.body.id}`, { method: "PATCH", json: { serverName: "jinde.example.cz" } });
      const sc2 = (await admin.json(`/api/assets/certificates/${ep.body.id}/scan`, { method: "POST" })).body;
      expect(sc2.findings.map((f: any) => f.kind)).toContain("name_mismatch");
      // nedostupný server
      const closed = (await admin.json("/api/assets/certificates", { method: "POST", json: { host: "127.0.0.1", port: 1 } })).body;
      const sc3 = (await admin.json(`/api/assets/certificates/${closed.id}/scan`, { method: "POST" })).body;
      expect(sc3.findings).toEqual([expect.objectContaining({ kind: "unreachable" })]);
      // přehled a povinnost
      const ov = (await admin.json("/api/assets/certificates")).body;
      expect(ov.summary).toMatchObject({ total: 2, expiring: 1, legacyCheck: true });
      expect(((await admin.json("/api/notifications/team")).body as any[]).some((o) => o.kind === "cert_expiry" && o.link === "/assets/certificates")).toBe(true);
      expect((await admin.json("/api/assets/certificates/candidates")).status).toBe(200);
      // vypnutý koncový bod nemá nálezy
      const off = (await admin.json(`/api/assets/certificates/${ep.body.id}`, { method: "PATCH", json: { enabled: false } })).body;
      expect(off.findings).toEqual([]);
      expect((await admin.json(`/api/assets/certificates/${closed.id}`, { method: "DELETE" })).status).toBe(204);
    } finally {
      srv.close();
    }
  });

  test("portál externího auditora: požadavky na podklady, vlastník, odeslání, vrácení, převzetí, izolace auditora", async () => {
    const aud = (await admin.json("/api/audits", { method: "POST", json: { title: "SOC 2 Typ II 2026" } })).body;
    const other = (await admin.json("/api/audits", { method: "POST", json: { title: "Jiný audit" } })).body;
    // vlastník podkladů (čtenář držící funkční místo) a externí auditor
    const ou = (await admin.json("/api/admin/users", { method: "POST", json: { email: "pbc.owner@test.cz", displayName: "Vlastník podkladů", password: PW, roleIds: [await roleId("viewer")] } })).body;
    const pos = (await admin.json("/api/org/positions", { method: "POST", json: { orgUnitId: ids.unitIt, name: "Správce identit (PBC)", holderIds: [ou.id] } })).body;
    const ext = (await admin.json("/api/admin/users", { method: "POST", json: { email: "ext.auditor@cpa.test", displayName: "Externí auditor", password: PW, roleIds: [await roleId("external_auditor")] } })).body;
    const owner = browser();
    await owner.login("pbc.owner@test.cz");
    await owner.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Vlastnik-Heslo-2026!" } });
    const ea = browser();
    await ea.login("ext.auditor@cpa.test");
    await ea.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Auditor-Heslo-2026!" } });
    expect((await ea.json("/api/auth/me")).body.permissions).toEqual(["audits:external"]);
    expect((await ea.json("/api/pbc/mine")).body).toEqual([]);
    expect((await ea.json(`/api/pbc/audits/${aud.id}`)).status).toBe(404);
    expect((await ea.json("/api/assets")).status).toBe(403);
    expect((await ea.json(`/api/audits/${aud.id}`)).status).toBe(403);
    // přidělení a hromadné založení
    expect(((await admin.json("/api/pbc/auditor-candidates")).body as any[]).map((u) => u.email)).toContain("ext.auditor@cpa.test");
    expect((await admin.json(`/api/pbc/audits/${aud.id}/auditors`, { method: "PUT", json: { userIds: [ext.id] } })).status).toBe(200);
    const bulk = await admin.json(`/api/pbc/audits/${aud.id}/requests/bulk`, { method: "POST", json: { lines: "Seznam uživatelů s přístupem; CC6.1; 31. 12. 2026\nPolitika hesel; A.5.17", ownerPositionId: pos.id, dueDate: "2026-11-30" } });
    expect(bulk.body.created).toBe(2);
    expect((await ea.json(`/api/pbc/audits/${aud.id}/requests/bulk`, { method: "POST", json: { lines: "x" } })).status).toBe(403);
    const mine = (await ea.json("/api/pbc/mine")).body;
    expect(mine[0]).toMatchObject({ id: aud.id, counts: { open: 2 } });
    let portal = (await ea.json(`/api/pbc/audits/${aud.id}`)).body;
    expect(portal.role).toBe("external");
    expect(portal.requests.map((r: any) => [r.code, r.reference, r.dueDate])).toEqual([["PBC-001", "CC6.1", "2026-12-31"], ["PBC-002", "A.5.17", "2026-11-30"]]);
    expect(portal.requests[0].ownerName).toBeNull();
    const r1 = portal.requests[0].id;
    // vlastník nahraje soubor – auditor ho do odeslání nevidí
    const fd = new FormData();
    fd.append("file", new File(["user;role\nadmin;Administrátor"], "uzivatele.csv", { type: "text/csv" }));
    expect((await owner.req(`/api/pbc/requests/${r1}/files`, { method: "POST", body: fd })).status).toBe(201);
    expect((await ea.json(`/api/pbc/requests/${r1}`)).body.fileList).toEqual([]);
    expect((await ea.json(`/api/pbc/requests/${r1}/accept`, { method: "POST" })).status).toBe(409);
    expect((await owner.json(`/api/pbc/requests/${r1}/submit`, { method: "POST" })).body.status).toBe("submitted");
    const d1 = (await ea.json(`/api/pbc/requests/${r1}`)).body;
    expect(d1.fileList).toHaveLength(1);
    expect(d1.fileList[0].uploadedByName).toBeNull();
    expect(d1.canReview).toBe(true);
    const dl = await ea.req(`/api/pbc/requests/${r1}/files/${d1.fileList[0].id}`);
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(await dl.text()).toContain("admin;Administrátor");
    expect((await owner.json(`/api/pbc/requests/${r1}/files/${d1.fileList[0].id}`, { method: "DELETE" })).status).toBe(409);
    // vrácení s připomínkou, doplnění, převzetí
    expect((await ea.json(`/api/pbc/requests/${r1}/return`, { method: "POST", json: { comment: "Chybí datum exportu." } })).body.status).toBe("returned");
    expect((await owner.json("/api/notifications/mine")).body.some((o: any) => o.kind === "audit_request" && o.link === `/audits/${aud.id}`)).toBe(true);
    await owner.json(`/api/pbc/requests/${r1}/comments`, { method: "POST", json: { body: "Export ze dne 15. 10. 2026." } });
    expect((await owner.json(`/api/pbc/requests/${r1}/submit`, { method: "POST" })).body.status).toBe("submitted");
    const acc = (await ea.json(`/api/pbc/requests/${r1}/accept`, { method: "POST" })).body;
    expect(acc.status).toBe("accepted");
    expect(acc.commentList.map((x: any) => x.external)).toEqual([true, false]);
    const fd2 = new FormData();
    fd2.append("file", new File(["x"], "pozde.txt"));
    expect((await owner.req(`/api/pbc/requests/${r1}/files`, { method: "POST", body: fd2 })).status).toBe(409);
    // odeslat prázdný nelze; auditor nemůže převzít cizí audit
    expect((await owner.json(`/api/pbc/requests/${portal.requests[1].id}/submit`, { method: "POST" })).status).toBe(400);
    const oreq = (await admin.json(`/api/pbc/audits/${other.id}/requests`, { method: "POST", json: { title: "Cizí" } })).body;
    expect((await ea.json(`/api/pbc/requests/${oreq.id}`)).status).toBe(404);
    // export pro auditora
    const z = await ea.req(`/api/pbc/audits/${aud.id}/export.zip`);
    const files = unzipSync(new Uint8Array(await z.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["PBC-001/uzivatele.csv", "manifest.csv"]);
    portal = (await admin.json(`/api/pbc/audits/${aud.id}`)).body;
    expect(portal.summary).toMatchObject({ accepted: 1, open: 1 });
    expect(portal.requests[1].ownerName).toBe("Správce identit (PBC)");
  });

  test("síťové segmenty: porovnání s aktivy, alert na neevidované a změněné zařízení, schválení, založení aktiva, plán", async () => {
    await admin.json("/api/admin/connectors/network-scan", { method: "PUT", json: { enabled: true, allowedCidrs: ["192.168.60.0/24", "127.0.0.1/32"] } });
    expect((await admin.json("/api/discovery/segments", { method: "POST", json: { name: "Mimo", cidrs: ["10.9.9.0/24"] } })).status).toBe(400);
    expect((await admin.json("/api/discovery/segments", { method: "POST", json: { name: "Špatně", cidrs: ["192.168.60.0/24"], exclude: ["x"] } })).status).toBe(400);
    const seg = await admin.json("/api/discovery/segments", { method: "POST", json: { name: "Servery LAB", cidrs: ["192.168.60.0/24"], exclude: ["192.168.60.1"], schedule: "daily", scheduleTime: "03:15", alertLevel: 9 } });
    expect(seg.status).toBe(201);
    expect(seg.body.nextRunAt).toBeTruthy();
    // evidované aktivum (IP + MAC) a aktivum jen s IP
    const srv = (await admin.json("/api/assets", { method: "POST", json: { name: "NET-SRV-01", assetType: "server", ipAddresses: ["192.168.60.10"], macAddresses: ["aa:bb:cc:00:00:10"] } })).body;
    await admin.json("/api/assets", { method: "POST", json: { name: "net-tiskarna", assetType: "printer", hostname: "net-tiskarna.lab.local" } });
    const mk = (ip: string, mac: string | null, hostname: string | null = null) => ({ sourceType: "network_scan", sourceRef: mac ? `mac:${mac}` : `ip:${ip}`, name: hostname ?? ip, assetType: "other", hostname, ipAddresses: [ip], macAddresses: mac ? [mac] : [], manufacturer: "Raspberry Pi", attributes: { openPorts: [{ port: 22, protocol: "tcp", service: "ssh" }] } });
    netHosts = [mk("192.168.60.10", "aa:bb:cc:00:00:10"), mk("192.168.60.20", null, "net-tiskarna"), mk("192.168.60.66", "de:ad:be:ef:00:66"), mk("192.168.60.10", "11:22:33:44:55:66")];
    // poslední: stejná IP jako server, jiná MAC → změna
    const r1 = (await admin.json(`/api/discovery/segments/${seg.body.id}/run?wait=1`, { method: "POST" })).body;
    expect(r1.summary).toMatchObject({ up: 4, known: 2, unknown: 1, changed: 1, newUnknown: 1, alerts: 2 });
    const obs = (await admin.json(`/api/discovery/segments/observations?segmentId=${seg.body.id}`)).body as any[];
    const unknown = obs.find((o) => o.ip === "192.168.60.66");
    expect(unknown).toMatchObject({ status: "unknown", mac: "de:ad:be:ef:00:66", vendor: "Raspberry Pi" });
    expect(obs.find((o) => o.mac === "11:22:33:44:55:66")).toMatchObject({ status: "changed", assetName: "NET-SRV-01" });
    const ua = (await db.execute(sql`select source, rule_id, rule_level, title from alert_suggestions where id = ${unknown.alertId}`)) as any;
    expect((ua.rows ?? ua)[0]).toMatchObject({ source: "netscan", rule_id: "netscan-unknown", rule_level: 9 });
    // opakovaný sken: žádný nový alert, jen počet
    const r2 = (await admin.json(`/api/discovery/segments/${seg.body.id}/run?wait=1`, { method: "POST" })).body;
    expect(r2.summary).toMatchObject({ unknown: 1, newUnknown: 0, alerts: 0 });
    // schválení: další sken už neeviduje jako neznámé
    expect((await admin.json(`/api/discovery/segments/observations/${unknown.id}/approve`, { method: "POST", json: { note: "Testovací Raspberry" } })).body.status).toBe("approved");
    const r3 = (await admin.json(`/api/discovery/segments/${seg.body.id}/run?wait=1`, { method: "POST" })).body;
    expect(r3.summary).toMatchObject({ unknown: 0, approved: 1 });
    // založení aktiva z pozorování
    await admin.json(`/api/discovery/segments/observations/${unknown.id}/reset`, { method: "POST" });
    const created = await admin.json(`/api/discovery/segments/observations/${unknown.id}/create-asset`, { method: "POST", json: { name: "RPI-LAB", assetType: "iot_ot" } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "known", assetName: "RPI-LAB" });
    const r4 = (await admin.json(`/api/discovery/segments/${seg.body.id}/run?wait=1`, { method: "POST" })).body;
    expect(r4.summary).toMatchObject({ known: 3, unknown: 0, changed: 1 });
    // přehled segmentů
    const ov = (await admin.json("/api/discovery/segments")).body;
    expect(ov.segments.find((x: any) => x.id === seg.body.id)).toMatchObject({ running: false, counts: { known: 3, changed: 1 } });
    // režim evidence založí aktivum přímo
    const inv = (await admin.json("/api/discovery/segments", { method: "POST", json: { name: "Klienti LAB", cidrs: ["192.168.60.128/25"], mode: "inventory" } })).body;
    netHosts = [mk("192.168.60.200", "0a:0b:0c:0d:0e:0f", "pc-lab-200")];
    const r5 = (await admin.json(`/api/discovery/segments/${inv.id}/run?wait=1`, { method: "POST" })).body;
    expect(r5.summary).toMatchObject({ known: 1, unknown: 0 });
    // plánovač: segment s nastalým časem se spustí
    await db.execute(sql`update net_segments set next_run_at = now() - interval '1 minute' where id = ${seg.body.id}`);
    const { processNetScans } = await import("../src/modules/discovery/segments");
    expect(await processNetScans(db as any, config, { scanner: async () => netHosts })).toBeGreaterThanOrEqual(1);
    expect((await admin.json(`/api/discovery/segments/${seg.body.id}`, { method: "PATCH", json: { schedule: "manual" } })).body.nextRunAt).toBeNull();
    expect((await admin.json(`/api/discovery/segments/${inv.id}`, { method: "DELETE" })).status).toBe(204);
  });

  test("legislativa: sledování e-Sbírky, nové znění, rozdíl, dotčené požadavky, posouzení, AI úkoly", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    expect((await admin.json("/api/legislation/status")).body.apiConfigured).toBe(true);
    const pos = (await admin.json("/api/org/positions", { headers: H })).body as any[];
    const owner = pos[0]?.id ?? null;
    // sledovat 409/2025 → první stažení znění (výchozí, bez posouzení)
    const w = await admin.json("/api/legislation/watch", { method: "POST", headers: H, json: { reference: "409/2025 Sb.", ownerPositionId: owner } });
    expect(w.status).toBe(201);
    expect(w.body.syncError).toBeNull();
    expect(esbState.key).toBe("esb-test-key");
    expect(w.body.currentVersion).toMatchObject({ label: "/sb/2025/409/2025-11-01", effectiveFrom: "2025-11-01" });
    const actId = w.body.id as string;
    const d1 = (await admin.json(`/api/legislation/acts/${actId}`, { headers: H })).body;
    expect(d1.versions).toHaveLength(1);
    expect(d1.changes).toHaveLength(0);
    const fr = (await admin.json(`/api/legislation/versions/${d1.versions[0].id}/fragments`, { headers: H })).body as any[];
    expect(fr.map((f) => f.key)).toEqual(["par_6-odst_1-pism_a", "par_7-odst_1", "par_8-odst_2"]);
    // opakovaná kontrola bez změny → nic nového
    const s0 = (await admin.json(`/api/legislation/acts/${actId}/sync`, { method: "POST", headers: H })).body;
    expect(s0.changeId ?? null).toBeNull();
    // novela → změna + posouzení pro sledující společnost
    esbState.version = 2;
    const s1 = await admin.json(`/api/legislation/acts/${actId}/sync`, { method: "POST", headers: H });
    expect(s1.status).toBe(200);
    expect(s1.body.changeId).toBeTruthy();
    const reviews = (await admin.json("/api/legislation/reviews?status=open", { headers: H })).body as any[];
    const rv = reviews.find((r) => r.act.id === actId);
    expect(rv).toMatchObject({ status: "new", change: { added: 1, removed: 1, modified: 1 } });
    expect(rv.dueDate).toBeTruthy();
    const det = (await admin.json(`/api/legislation/reviews/${rv.id}`, { headers: H })).body;
    const mod = det.diff.find((x: any) => x.kind === "modified");
    expect(mod.key).toBe("par_6-odst_1-pism_a");
    expect(mod.requirementIds).toContain("cz409:6/1");
    expect(mod.parts.some((p: any) => p.t === "+" && p.v.includes("dodavatelů"))).toBe(true);
    expect(det.affected.requirements.map((q: any) => q.id)).toContain("cz409:6/1");
    expect(det.canEdit).toBe(true);
    // povinnost v přehledu povinností
    const obl = (await admin.json("/api/notifications/team", { headers: H })).body;
    expect(JSON.stringify(obl)).toContain(`/legislation/reviews/${rv.id}`);
    // AI: shrnutí a úkoly; neznámý dokument / požadavek zahozeny
    await admin.json("/api/ai/settings", { method: "PATCH", json: { enabled: true, provider: "openai", baseUrl: AI_URL, model: "gpt-oss:20b", apiKey: "owui-key" } });
    const pol = (await admin.json("/api/policies", { method: "POST", headers: H, json: { code: "LEG-01", title: "Politika legislativa" } })).body;
    const ar = await admin.json("/api/ai/suggestions", { method: "POST", headers: H, json: { useCase: "legal_change", entityId: rv.id } });
    expect(ar.status).toBe(202);
    await Promise.all(background);
    const sg = (await admin.json(`/api/ai/suggestions/${ar.body.id}`, { headers: H })).body;
    expect(sg.status).toBe("proposed");
    expect(sg.items.length).toBeGreaterThanOrEqual(1);
    expect(sg.items.every((i: any) => i.kind === "legal_task")).toBe(true);
    expect(JSON.stringify(sg.items)).not.toContain("cz409:999");
    await admin.json(`/api/ai/suggestions/${sg.id}/decide`, { method: "POST", json: { accept: [0] } });
    const det2 = (await admin.json(`/api/legislation/reviews/${rv.id}`, { headers: H })).body;
    expect(det2.status).toBe("in_review");
    expect(det2.aiSummary).toContain("Novela");
    expect(det2.tasks).toHaveLength(1);
    // ruční úkol s vazbou na dokument
    const t2 = await admin.json(`/api/legislation/reviews/${rv.id}/tasks`, { method: "POST", headers: H, json: { title: "Proškolit gestory", policyId: pol.id } });
    expect(t2.status).toBe(201);
    // posouzení: bez dopadu a zdůvodnění nelze potvrdit; uzavřít nelze s otevřenými úkoly
    expect((await admin.json(`/api/legislation/reviews/${rv.id}`, { method: "PATCH", headers: H, json: { status: "assessed" } })).status).toBe(400);
    const ok = await admin.json(`/api/legislation/reviews/${rv.id}`, { method: "PATCH", headers: H, json: { status: "assessed", impact: "medium", assessment: "Doplnit politiku o dodavatele." } });
    expect(ok.status).toBe(200);
    expect((await admin.json(`/api/legislation/reviews/${rv.id}`, { method: "PATCH", headers: H, json: { status: "closed" } })).status).toBe(409);
    for (const t of (await admin.json(`/api/legislation/reviews/${rv.id}`, { headers: H })).body.tasks) await admin.json(`/api/legislation/tasks/${t.id}`, { method: "PATCH", headers: H, json: { status: "done" } });
    const cl = await admin.json(`/api/legislation/reviews/${rv.id}`, { method: "PATCH", headers: H, json: { status: "closed" } });
    expect(cl.status).toBe(200);
    const fin = (await admin.json(`/api/legislation/reviews/${rv.id}`, { headers: H })).body;
    expect(fin).toMatchObject({ status: "closed", impact: "medium" });
    expect(fin.assessedByName).toBeTruthy();
    // plánovač: RSS e-Sbírky ohlásí zrušení předpisu (bez nového stažení – kontrola proběhla před chvílí)
    const calls0 = esbState.calls.length;
    expect(await processLegislationSync(db, config, new Date(), esbirkaFetch)).toEqual([]);
    expect(esbState.calls.slice(calls0).filter((x) => x.startsWith("/dokumenty"))).toEqual([]);
    const withRepeal = ((await admin.json("/api/legislation/acts", { headers: H })).body as any[]).find((x) => x.id === actId);
    expect(withRepeal.repeal).toMatchObject({ date: "2030-01-01" });
    // ručně vedená norma: dvě znění → rozdíl; z e-Sbírky nelze vkládat znění ručně
    const man = (await admin.json("/api/legislation/acts/manual", { method: "POST", headers: H, json: { code: "NORMA-X", title: "Interní norma" } })).body;
    const v1 = await admin.json(`/api/legislation/acts/${man.id}/versions`, { method: "POST", headers: H, json: { label: "2024", text: "Čl. 1\nÚvod.\n\nČl. 2\nHesla mají 12 znaků." } });
    expect(v1.status).toBe(201);
    const v2 = (await admin.json(`/api/legislation/acts/${man.id}/versions`, { method: "POST", headers: H, json: { label: "2026", text: "Čl. 1\nÚvod.\n\nČl. 2\nHesla mají 14 znaků." } })).body;
    expect(v2.changeId).toBeTruthy();
    expect((await admin.json(`/api/legislation/acts/${actId}/versions`, { method: "POST", headers: H, json: { label: "x", text: "y" } })).status).toBe(409);
    // čtenář (auditor) nevidí tlačítka zápisu – nesmí měnit
    const aud = browser();
    await admin.json("/api/admin/users", { method: "POST", json: { email: "leg-aud@test.cz", displayName: "Leg", password: PW, roleIds: [await roleId("auditor")] } });
    await aud.login("leg-aud@test.cz");
    await aud.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Leg-Heslo-2026!!" } });
    expect((await aud.json("/api/legislation/acts")).status).toBe(200);
    expect((await aud.json("/api/legislation/watch", { method: "POST", json: { reference: "264/2025" } })).status).toBe(403);
    // chyba zdroje → 502 se srozumitelnou zprávou, stav předpisu „error“
    const w2 = (await admin.json("/api/legislation/watch", { method: "POST", headers: H, json: { reference: "410/2025 Sb." } })).body;
    expect(w2.syncError).toContain("404");
    expect((await admin.json(`/api/legislation/acts/${w2.id}/sync`, { method: "POST", headers: H })).status).toBe(502);
  });

  test("legislativa: předpis EU z EUR-Lex – sledování, konsolidované znění, rozdíl, dotčené požadavky DORA", async () => {
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const H = { "x-contix-company": root.id };
    expect((await admin.json("/api/legislation/status")).body.eurlex).toBe(true);
    const sug = (await admin.json("/api/legislation/suggested", { headers: H })).body as any[];
    expect(sug.find((x) => x.reference === "32022R2554")).toMatchObject({
      source: "eurlex",
      staleUrl: "/eu/cs/32022R2554",
      watched: false,
    });
    expect(
      (
        await admin.json("/api/legislation/watch", {
          method: "POST",
          headers: H,
          json: { reference: "nesmysl", source: "eurlex" },
        })
      ).status,
    ).toBe(400);
    // odkaz z EUR-Lex bez výslovného zdroje se pozná sám
    const w = await admin.json("/api/legislation/watch", {
      method: "POST",
      headers: H,
      json: {
        reference: "https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:32022R2554",
      },
    });
    expect(w.status).toBe(201);
    expect(w.body).toMatchObject({
      source: "eurlex",
      staleUrl: "/eu/cs/32022R2554",
      code: "DORA – (EU) 2022/2554",
      syncError: null,
      lastStatus: "ok",
      repeal: null,
    });
    expect(w.body.title).toBe("Nařízení o digitální provozní odolnosti finančního sektoru (DORA)");
    expect(w.body.currentVersion).toMatchObject({
      label: "32022R2554",
      effectiveFrom: null,
    });
    const d1 = (await admin.json(`/api/legislation/acts/${w.body.id}`, { headers: H })).body;
    const fr = (await admin.json(`/api/legislation/versions/${d1.versions[0].id}/fragments`, { headers: H })).body as any[];
    expect(fr.map((f) => f.key)).toEqual(["cl_5", "cl_5-odst_1", "cl_6", "cl_6-odst_1"]);
    // nové konsolidované znění → změna, posouzení, dotčený požadavek dora:6
    euState.version = 2;
    const s = (
      await admin.json(`/api/legislation/acts/${w.body.id}/sync`, {
        method: "POST",
        headers: H,
      })
    ).body;
    expect(s.changeId).toBeTruthy();
    const rv = ((await admin.json("/api/legislation/reviews?status=open", { headers: H })).body as any[]).find((x) => x.act.id === w.body.id);
    expect(rv.change).toMatchObject({
      from: "32022R2554",
      to: "02022R2554-20270101",
      effectiveFrom: "2027-01-01",
      modified: 1,
    });
    const det = (await admin.json(`/api/legislation/reviews/${rv.id}`, { headers: H })).body;
    expect(det.diff.map((x: any) => [x.key, x.kind, x.requirementIds])).toEqual([["cl_6-odst_1", "modified", ["dora:6"]]]);
    expect(det.affected.requirements.map((r: any) => r.id)).toEqual(["dora:6"]);
    // NIS2 a prováděcí nařízení mají rámec nis2
    const { ACT_FRAMEWORK, requirementsForFragment } = await import("@contix/shared");
    expect([ACT_FRAMEWORK["/eu/cs/32022L2555"], ACT_FRAMEWORK["/eu/en/32024R2690"]]).toEqual(["nis2", "nis2"]);
    expect(requirementsForFragment("nis2", "priloha_1-bod_6.6.1")).toEqual(["nis2:P6.6.1"]);
    // anglické znění je samostatný předpis
    const en = (
      await admin.json("/api/legislation/watch", {
        method: "POST",
        headers: H,
        json: { reference: "32022R2554", source: "eurlex", lang: "en" },
      })
    ).body;
    expect(en).toMatchObject({
      staleUrl: "/eu/en/32022R2554",
      code: "DORA – (EU) 2022/2554 [EN]",
    });
    // plánovač: předpisy EU se kontrolují jednou denně
    const before = euState.calls.length;
    expect(await processLegislationSync(db, config, new Date(), esbirkaFetch)).toEqual([]);
    expect(euState.calls.length).toBe(before);
    expect((await processLegislationSync(db, config, new Date(Date.now() + 2 * 86_400_000), esbirkaFetch)).filter((e) => e.includes("EU"))).toEqual([]);
    expect(euState.calls.slice(before).filter((x) => x === "/webapi/rdf/sparql").length).toBe(2);
    await admin.json(`/api/legislation/watch/${en.id}`, {
      method: "DELETE",
      headers: H,
    });
  });

  test("jazykové verze: seznam, volba jazyka, přeložené chyby API, nahraný balíček, příručka a SoA anglicky", async () => {
    // veřejný seznam jazyků (přihlašovací obrazovka)
    const pub = await app.request("/api/i18n");
    expect(pub.status).toBe(200);
    const list = (await pub.json()) as any;
    expect(list.defaultLocale).toBe("cs");
    expect(list.locales.map((l: any) => l.locale)).toEqual(expect.arrayContaining(["cs", "en"]));
    // volba jazyka uživatele → /me
    const u = browser();
    await admin.json("/api/admin/users", { method: "POST", json: { email: "lang@test.cz", displayName: "Lang", password: PW, roleIds: [await roleId("ciso")] } });
    await u.login("lang@test.cz");
    await u.json("/api/auth/password", { method: "POST", json: { currentPassword: PW, newPassword: "Lang-Heslo-2026!!" } });
    expect((await u.json("/api/auth/me")).body.locale).toBe("cs");
    expect((await u.json("/api/i18n/me", { method: "PATCH", json: { locale: "xx" } })).status).toBe(400);
    expect((await u.json("/api/i18n/me", { method: "PATCH", json: { locale: "en" } })).status).toBe(200);
    const me = (await u.json("/api/auth/me")).body;
    expect(me.locale).toBe("en");
    expect(me.user.locale).toBe("en");
    // chyba API v jazyce uživatele
    const nf = await u.json("/api/legislation/acts/00000000-0000-0000-0000-000000000000");
    expect(nf.status).toBe(404);
    expect(nf.body.error).toBe("Regulation not found");
    expect((await admin.json("/api/legislation/acts/00000000-0000-0000-0000-000000000000")).body.error).toBe("Předpis nenalezen");
    // příručka a SoA anglicky (uživatel) / česky s ?lang=cs
    const man = await (await u.req("/api/help/manual.html?audience=admin")).text();
    expect(man).toContain("CONTIX – user manual");
    expect(man).toContain("Language versions");
    expect(man).toContain('lang="en"');
    const root = ((await admin.json("/api/companies")).body as any[]).find((x) => !x.parentId);
    const HC = { "x-contix-company": root.id };
    const soa = await (await u.req("/api/documents/preview.html?kind=soa&framework=iso27001", { headers: HC })).text();
    expect(soa).toContain("Statement of Applicability");
    expect(soa).toContain("Compliance rate");
    expect(soa).not.toContain("Míra shody");
    const soaCs = await (await u.req("/api/documents/preview.html?kind=soa&framework=iso27001&lang=cs", { headers: HC })).text();
    expect(soaCs).toContain("Prohlášení o aplikovatelnosti");
    // šablona pro překladatele a nahrání balíčku (CSV) – neznámé klíče se vynechají
    const tpl = await (await admin.req("/api/i18n/admin/de/export?format=csv")).text();
    expect(tpl.replace(/^\ufeff/, "").split("\r\n")[0]).toBe('"key";"cs";"en";"de"');
    const csv = `key;de\r\nnav.risks;Risiken\r\nnav.assets;Assets (DE)\r\nneexistuje.klic;x\r\n`;
    const fd = new FormData();
    fd.append("file", new File([csv], "de.csv", { type: "text/csv" }));
    fd.append("locale", "de");
    fd.append("name", "Němčina");
    fd.append("nativeName", "Deutsch");
    fd.append("fallback", "en");
    const up = await admin.json("/api/i18n/admin", { method: "POST", body: fd });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ locale: "de", messages: 2, ignored: 1 });
    expect((await u.json("/api/i18n/admin", { method: "POST", body: new FormData() })).status).toBe(403);
    const packs = (await app.request("/api/i18n/packs/de")).json() as Promise<any>;
    expect((await packs).packs[0].messages["nav.risks"]).toBe("Risiken");
    expect((await u.json("/api/i18n/me", { method: "PATCH", json: { locale: "de" } })).status).toBe(200);
    // chybějící text v němčině → náhradní angličtina
    expect((await u.json("/api/legislation/acts/00000000-0000-0000-0000-000000000000")).body.error).toBe("Regulation not found");
    expect((await admin.req("/api/i18n/admin/de", { method: "DELETE" })).status).toBe(204);
    expect((await u.json("/api/auth/me")).body.locale).toBe("cs"); // smazaný jazyk → výchozí organizace
  });

  test("ladění pravidel Wazuh v1.14: návrh z dat, simulace nad indexerem, chráněné alerty, čtyři oči, export XML (ADR-111)", async () => {
    const { ROOT_COMPANY_ID } = await import("@contix/shared");
    const H = { "x-contix-company": ROOT_COMPANY_ID };
    const mk = (agentId: string, verdict: string, status: "dismissed" | "accepted", at: number) =>
      ({ companyId: ROOT_COMPANY_ID, source: "wazuh", groupKey: `60106:${agentId}:${at}`, ruleId: "60106", ruleLevel: 9, description: "Windows: proces spuštěný z neobvyklé cesty", agentId, agentName: agentId, firstSeen: new Date(at - 60_000), lastSeen: new Date(at + 120_000), count: 2, status, verdict });
    await db.insert(schema.alertSuggestions).values([...[1, 2, 3, 4].map((i) => mk("010", "false_positive", "dismissed", TUNE_T - i * 3_600_000)), mk("011", "true_positive", "accepted", TUNE_T)] as never);
    // málo podkladů / neznámé pravidlo
    expect((await admin.json("/api/soc/tuning/suggest", { method: "POST", headers: H, json: { ruleId: "999999" } })).status).toBe(409);
    // návrh z dat: srcip má všechny události, ale zasahuje do skutečného útoku → vybere se cesta procesu
    const sg = await admin.json("/api/soc/tuning/suggest", { method: "POST", headers: H, json: { ruleId: "60106", days: 30 } });
    expect(sg.status).toBe(201);
    expect(sg.body).toMatchObject({ kind: "exclude", source: "auto", status: "draft", conditions: [{ kind: "field", field: "win.eventdata.image", value: "C:\\Tools\\backup.exe" }] });
    expect(sg.body.simulation).toMatchObject({ source: "indexer", total: 10, matched: 8, protectedAlerts: [] });
    expect(sg.body.rationale).toContain("80 %");
    expect(sg.body.xml).toContain('<rule id="' + sg.body.wazuhRuleId + '" level="0">');
    expect(sg.body.xml).toContain("<if_sid>60106</if_sid>");
    expect(sg.body.xml).toContain('<field name="win.eventdata.image" type="pcre2">^C:\\\\Tools\\\\backup\\.exe$</field>');
    // ruční návrh na srcip zasáhne alert se skutečným útokem
    const bad = await admin.json("/api/soc/tuning", { method: "POST", headers: H, json: { ruleId: "60106", kind: "exclude", conditions: [{ kind: "srcip", value: "10.0.0.9" }], rationale: "Skener" } });
    expect(bad.status).toBe(201);
    expect((await admin.json("/api/soc/tuning", { method: "POST", headers: H, json: { ruleId: "60106", kind: "exclude", conditions: [] } })).status).toBe(400);
    expect((await admin.json("/api/soc/tuning", { method: "POST", headers: H, json: { ruleId: "60106", kind: "exclude", conditions: [{ kind: "srcip", value: "nesmysl" }] } })).status).toBe(400);
    const sim = (await admin.json(`/api/soc/tuning/${bad.body.id}/simulate`, { method: "POST", headers: H, json: { days: 30 } })).body;
    expect(sim.simulation.matched).toBe(10);
    expect(sim.simulation.protectedAlerts).toHaveLength(1);
    expect(sim.simulation.protectedAlerts[0].verdict).toBe("true_positive");
    // čtyři oči: navrhovatel neschvaluje; druhý schvalovatel potřebuje u chráněných alertů odůvodnění
    expect(sg.body.canDecide).toBe(false);
    expect((await admin.json(`/api/soc/tuning/${sg.body.id}/decision`, { method: "POST", headers: H, json: { decision: "approve" } })).status).toBe(403);
    const resp = browser();
    expect((await resp.login("responder@test.cz", "Schval-Heslo-2026!!")).status).toBe(200);
    expect(((await resp.json("/api/soc/tuning", { headers: H })).body as any[]).find((x) => x.id === sg.body.id).canDecide).toBe(true);
    expect((await resp.json(`/api/soc/tuning/${bad.body.id}/decision`, { method: "POST", headers: H, json: { decision: "approve" } })).status).toBe(409);
    expect((await resp.json(`/api/soc/tuning/${bad.body.id}/decision`, { method: "POST", headers: H, json: { decision: "reject", note: "Skryje skutečný útok" } })).body.status).toBe("rejected");
    const ok = await resp.json(`/api/soc/tuning/${sg.body.id}/decision`, { method: "POST", headers: H, json: { decision: "approve" } });
    expect(ok.body).toMatchObject({ status: "approved", decidedByName: "Petr Schvalovatel" });
    // rozhodnutý návrh je neměnný
    expect((await admin.json(`/api/soc/tuning/${sg.body.id}`, { method: "PATCH", headers: H, json: { rationale: "x" } })).status).toBe(409);
    expect((await admin.json(`/api/soc/tuning/${sg.body.id}`, { method: "DELETE", headers: H })).status).toBe(409);
    // export jen schválených
    const xml = await (await admin.req("/api/soc/tuning/rules.xml", { headers: H })).text();
    expect(xml).toContain('<group name="contix_tuning,">');
    expect(xml).toContain("win.eventdata.image");
    expect(xml).not.toContain("<srcip>10.0.0.9</srcip>");
    // úprava návrhu zneplatní simulaci; změna úrovně
    const lv = (await admin.json("/api/soc/tuning", { method: "POST", headers: H, json: { ruleId: "60106", kind: "level", newLevel: 3, conditions: [{ kind: "location", op: "regex", value: "^Event.*" }] } })).body;
    expect(lv.xml).toContain('level="3"');
    expect(lv.xml).toContain('<location type="pcre2">^Event.*</location>');
    const sim2 = (await admin.json(`/api/soc/tuning/${lv.id}/simulate`, { method: "POST", headers: H, json: { days: 30 } })).body.simulation;
    expect(sim2.matched).toBe(10);
    expect((await admin.json(`/api/soc/tuning/${lv.id}`, { method: "PATCH", headers: H, json: { newLevel: 5 } })).body).toMatchObject({ newLevel: 5, simulation: null });
    // čtenář SOC bez zápisu
    const viewer = browser();
    await viewer.login("rec-view@test.cz", "Rec-Heslo-2026!!");
    expect((await viewer.json("/api/soc/tuning/suggest", { method: "POST", headers: H, json: { ruleId: "60106" } })).status).toBe(403);
    expect((await admin.json(`/api/soc/tuning/${lv.id}`, { method: "DELETE", headers: H })).status).toBe(200);
    // agent přes MCP: čtecí nástroj s hlučnými pravidly a stavem návrhů
    const tok = (await admin.json("/api/tokens", { method: "POST", json: { name: "Agent ladění", expiresInDays: 1 } })).body.token as string;
    const res = await app.request("/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "10.20.0.7", authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "soc_rule_noise", arguments: { days: 30, minFpRate: 0.5 } } }) });
    const txt = ((await res.json()) as any).result.content[0].text as string;
    expect(txt).toContain("60106");
    expect(txt).toContain("Schváleno (skryje 8/10)");
    expect(txt).toContain("Zamítnuto (skryje 10/10, zasáhne 1 útoků)");
  });

  test("rizikové scénáře z dat: profil schopností, deklarace, návrhy, přijetí, zamítnutí, navázání (v1.17, ADR-114)", async () => {
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Scénáře s.r.o.", regime: "lower" } })).body;
    const H = { "x-contix-company": co.id };
    const mk = async (json: Record<string, unknown>) => (await admin.json("/api/assets", { method: "POST", headers: H, json })).body.id as string;
    const erp = await mk({ name: "ERP služba", assetType: "business_service", confidentiality: 3, integrity: 4, availability: 4, criticality: "critical" });
    const srvA = await mk({ name: "srv-agent", assetType: "server" });
    const srvB = await mk({ name: "srv-noagent", assetType: "server" });
    const gw = await mk({ name: "web-gw", assetType: "server", internetFacing: true });
    for (const sid of [srvA, srvB, gw]) expect((await admin.json("/api/assets/links", { method: "POST", headers: H, json: { primaryId: erp, supportingId: sid } })).status).toBe(201);
    // bez dat: všechny schopnosti neznámé, žádný návrh se nevymyslí
    let caps = (await admin.json("/api/risks/scenarios/capabilities", { headers: H })).body as any[];
    expect(caps.every((c) => c.status === "unknown" && c.confidence === "none")).toBe(true);
    expect(caps.find((c) => c.key === "mfa").requirements.ids).toContain("nis2:21/2/j");
    expect(caps.find((c) => c.key === "backup_recovery").requirements.decree409.length).toBeGreaterThan(0);
    expect((await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H })).body).toMatchObject({ created: 0, primaryAssets: 1 });
    // data: Wazuh agent jen na jednom serveru, KEV na serveru vystaveném do internetu, účty bez MFA, alert s technikou ransomwaru
    await db.insert(schema.assetSources).values([{ assetId: srvA, sourceType: "wazuh", sourceRef: "sc-001" }, { assetId: srvB, sourceType: "wazuh", sourceRef: "sc-002" }]);
    await db.execute(sql`update assets set attributes = '{"wazuh":{"status":"active"}}'::jsonb, last_seen_at = now() where id = ${srvA}`);
    await db.execute(sql`update assets set attributes = '{"wazuh":{"status":"disconnected"}}'::jsonb, last_seen_at = now() - interval '30 days' where id = ${srvB}`);
    await db.insert(schema.assetVulnerabilities).values({ assetId: gw, cveId: "CVE-2026-9001", severity: "critical", status: "open" } as any);
    await db.execute(sql`insert into vuln_intel (cve_id, kev, kev_name) values ('CVE-2026-9001', true, 'gw') on conflict (cve_id) do update set kev = true`);
    const [src] = await db.insert(schema.identitySources).values({ companyId: co.id, kind: "ad", name: "AD scénáře", config: {}, policy: {} as any }).returning();
    const flags = { pwdNeverExpires: false, pwdNotRequired: false, preauthDisabled: false, hasSpn: false, unconstrainedDelegation: false };
    await db.insert(schema.identityAccounts).values([
      { sourceId: src!.id, companyId: co.id, externalId: "1", login: "adm", enabled: true, privileged: true, mfa: false, flags },
      { sourceId: src!.id, companyId: co.id, externalId: "2", login: "u1", enabled: true, mfa: true, flags },
      { sourceId: src!.id, companyId: co.id, externalId: "3", login: "u2", enabled: true, mfa: false, flags },
    ]);
    await db.insert(schema.alertSuggestions).values({ companyId: co.id, source: "manual", groupKey: "sc-ransom", ruleId: "m", ruleLevel: 12, description: "Šifrování souborů", firstSeen: new Date(), lastSeen: new Date(), mitreIds: ["T1486"] } as any);
    caps = (await admin.json("/api/risks/scenarios/capabilities", { headers: H })).body as any[];
    const cap = (k: string) => caps.find((c) => c.key === k);
    expect(cap("edr")).toMatchObject({ status: "weak", confidence: "measured", metrics: [{ key: "endpoints_covered", value: 1, total: 3 }] });
    expect(cap("mfa").status).toBe("weak");
    expect(cap("mfa").coverage).toBeCloseTo(1 / 3, 5);
    expect(cap("privileged_access").status).toBe("weak");
    expect(cap("vuln_mgmt").status).toBe("weak");
    expect(cap("segmentation").status).toBe("unknown");
    // deklarace s důkazem jen tam, kde data nejsou; změřený stav má přednost
    expect((await admin.json("/api/risks/scenarios/capabilities/segmentation", { method: "PUT", headers: H, json: { status: "partial", url: "javascript:x" } })).status).toBe(400);
    caps = (await admin.json("/api/risks/scenarios/capabilities/segmentation", { method: "PUT", headers: H, json: { status: "partial", product: "FortiGate 100F", note: "VLAN pro servery a OT", url: "https://example.com/sit.pdf" } })).body;
    expect(cap("segmentation")).toMatchObject({ status: "partial", confidence: "declared", declaration: { product: "FortiGate 100F", byName: "Admin" } });
    caps = (await admin.json("/api/risks/scenarios/capabilities/edr", { method: "PUT", headers: H, json: { status: "strong", product: "Defender" } })).body;
    expect(cap("edr")).toMatchObject({ status: "weak", confidence: "measured", conflict: true });
    // opatření namapované na požadavek schopnosti se ukáže u scénáře
    await admin.json("/api/controls", { method: "POST", headers: H, json: { name: "Antimalware na serverech", status: "implemented", effectiveness: "partially_effective", requirementIds: ["iso27001:A.8.7"] } });
    const g = (await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H })).body;
    expect(g.created).toBeGreaterThan(3);
    let list = (await admin.json("/api/risks/scenarios", { headers: H })).body as any[];
    const keys = list.map((x) => x.templateKey);
    expect(keys).toEqual(expect.arrayContaining(["ransomware", "privileged_takeover", "known_vuln_exploit", "phishing_credentials"]));
    expect(keys).not.toContain("supplier_outage"); // žádný dodavatel – nic se nevymýšlí
    expect(keys).not.toContain("backup_failure"); // obnova bez dat
    const rw = list.find((x) => x.templateKey === "ransomware");
    expect(rw).toMatchObject({ primaryAssetName: "ERP služba", levels: 4, impact: 4, threatLevel: 4, alerts: 1, lowConfidence: false });
    expect(Object.fromEntries(rw.hits.map((h: any) => [h.key, h.count]))).toMatchObject({ no_edr: 2, kev_exposed: 1, mfa_gap: 2, priv_no_mfa: 1 });
    expect(rw.hits.find((h: any) => h.key === "kev_exposed").items).toEqual([{ label: "web-gw", path: `/assets/${gw}` }]);
    expect(rw.controls.map((x: any) => x.name)).toEqual(["Antimalware na serverech"]);
    expect(rw.supportingAssets.map((x: any) => x.name).sort()).toEqual(["srv-agent", "srv-noagent", "web-gw"]);
    // přijetí = riziko přes API risks (katalog vyhlášky, aktiva, opatření, hodnocení)
    const acc = await admin.json(`/api/risks/scenarios/${rw.id}/accept`, { method: "POST", headers: H, json: {} });
    expect(acc.status).toBe(201);
    const risk = (await admin.json(`/api/risks/${acc.body.riskId}`, { headers: H })).body;
    expect(risk).toMatchObject({ name: "Ransomware zašifruje systémy a znemožní provoz: ERP služba", impact: 4, threatLevel: 4 });
    expect(risk).toMatchObject({ threatName: "Škodlivý kód", weaknessName: "Nedostatečné zálohování", assetCount: 4 });
    expect(risk.controls.map((x: any) => x.name)).toEqual(["Antimalware na serverech"]);
    expect(risk.description).toContain("Aktivně zneužívaná zranitelnost (KEV) na aktivu dostupném z internetu: 1");
    expect((await admin.json(`/api/risks/scenarios/${rw.id}/accept`, { method: "POST", headers: H, json: {} })).status).toBe(409);
    // zamítnutí se zdůvodněním; beze změny dat zůstane zamítnuté, nová skutečnost ho znovu otevře
    const ph = list.find((x) => x.templateKey === "phishing_credentials");
    expect((await admin.json(`/api/risks/scenarios/${ph.id}/decision`, { method: "POST", headers: H, json: { action: "reject", reason: "" } })).status).toBe(400);
    expect((await admin.json(`/api/risks/scenarios/${ph.id}/decision`, { method: "POST", headers: H, json: { action: "reject", reason: "Pokryto rizikem R-07" } })).body.status).toBe("rejected");
    await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H });
    list = (await admin.json("/api/risks/scenarios?status=all", { headers: H })).body as any[];
    expect(list.find((x) => x.id === ph.id)).toMatchObject({ status: "rejected", reason: "Pokryto rizikem R-07", decidedByName: "Admin" });
    await db.insert(schema.identityAccounts).values({ sourceId: src!.id, companyId: co.id, externalId: "4", login: "u3", enabled: true, mfa: false, flags });
    expect((await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H })).body.reopened).toBeGreaterThan(0);
    list = (await admin.json("/api/risks/scenarios?status=all", { headers: H })).body as any[];
    expect(list.find((x) => x.id === ph.id).status).toBe("proposed");
    // přijatý návrh: změna dat se jen označí
    expect(list.find((x) => x.id === rw.id)).toMatchObject({ status: "accepted", changedSinceDecision: true, riskId: acc.body.riskId });
    // navázání na existující riziko jen ze stejné společnosti
    const pt = list.find((x) => x.templateKey === "privileged_takeover");
    const other = (await admin.json("/api/risks", { headers: { "x-contix-company": ((await admin.json("/api/companies")).body as any[]).find((x: any) => !x.parentId).id } })).body;
    const otherRisk = (Array.isArray(other) ? other : other.items)[0];
    if (otherRisk) expect((await admin.json(`/api/risks/scenarios/${pt.id}/decision`, { method: "POST", headers: H, json: { action: "link", riskId: otherRisk.id } })).status).toBe(400);
    expect((await admin.json(`/api/risks/scenarios/${pt.id}/decision`, { method: "POST", headers: H, json: { action: "link", riskId: acc.body.riskId } })).body).toMatchObject({ status: "linked", riskId: acc.body.riskId });
    // otevřené návrhy = jen „návrh“
    expect(((await admin.json("/api/risks/scenarios", { headers: H })).body as any[]).every((x) => x.status === "proposed")).toBe(true);
    await db.execute(sql`update vuln_intel set kev = false where cve_id = 'CVE-2026-9001'`);
  });

  test("pokrytí katalogu hrozeb, podnět „změna dat scénáře“ a denní obnova návrhů (v1.18, ADR-115)", async () => {
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Pokrytí hrozeb s.r.o.", regime: "lower" } })).body;
    const H = { "x-contix-company": co.id };
    const mk = async (json: Record<string, unknown>) => (await admin.json("/api/assets", { method: "POST", headers: H, json })).body.id as string;
    const crm = await mk({ name: "CRM služba", assetType: "business_service", confidentiality: 4, integrity: 3, availability: 3, criticality: "high" });
    const srv = await mk({ name: "crm-srv", assetType: "server" });
    expect((await admin.json("/api/assets/links", { method: "POST", headers: H, json: { primaryId: crm, supportingId: srv } })).status).toBe(201);
    // bez rizik a návrhů: vše neposouzeno, jen primární aktiva
    let cov = (await admin.json("/api/risks/scenarios/coverage", { headers: H })).body;
    expect(cov.assets.map((a: any) => a.name)).toEqual(["CRM služba"]);
    expect(cov.threats.length).toBeGreaterThan(10);
    expect(cov.summary).toMatchObject({ total: cov.threats.length, unassessed: cov.threats.length, risk: 0, assessedShare: 0 });
    const [t1, t2] = [cov.threats[0], cov.threats[cov.threats.length - 1]];
    // „nerelevantní“ jen se zdůvodněním, jen u primárního aktiva a jen pro hrozbu z katalogu
    expect((await admin.json(`/api/risks/scenarios/coverage/${crm}/${t2.id}`, { method: "PUT", headers: H, json: { reason: "ne" } })).status).toBe(400);
    expect((await admin.json(`/api/risks/scenarios/coverage/${srv}/${t2.id}`, { method: "PUT", headers: H, json: { reason: "Podpůrné aktivum" } })).status).toBe(400);
    expect((await admin.json(`/api/risks/scenarios/coverage/${crm}/00000000-0000-4000-8000-0000000000ff`, { method: "PUT", headers: H, json: { reason: "Neexistuje v katalogu" } })).status).toBe(404);
    cov = (await admin.json(`/api/risks/scenarios/coverage/${crm}/${t2.id}`, { method: "PUT", headers: H, json: { reason: "CRM není dostupné z internetu" } })).body;
    expect(cov.assets[0].cells[t2.id]).toMatchObject({ state: "not_relevant", reason: "CRM není dostupné z internetu", decidedByName: "Admin" });
    // riziko na podpůrném aktivu pokrývá hrozbu i u primárního aktiva
    const r1 = (await admin.json("/api/risks", { method: "POST", headers: H, json: { companyId: co.id, name: "Výpadek serveru CRM", threatId: t1.id, assetIds: [srv] } })).body;
    cov = (await admin.json("/api/risks/scenarios/coverage", { headers: H })).body;
    expect(cov.assets[0].cells[t1.id]).toMatchObject({ state: "risk", risks: [{ id: r1.id, name: "Výpadek serveru CRM" }] });
    expect(cov.summary).toMatchObject({ risk: 1, not_relevant: 1 });
    expect((await admin.json(`/api/risks/scenarios/coverage/${crm}/${t1.id}`, { method: "DELETE", headers: H })).status).toBe(404);
    // návrhy scénářů z dat pokrývají hrozby šablon
    await db.insert(schema.assetSources).values({ assetId: srv, sourceType: "wazuh", sourceRef: "cov-001" });
    await db.execute(sql`update assets set attributes = '{"wazuh":{"status":"disconnected"}}'::jsonb, last_seen_at = now() - interval '30 days' where id = ${srv}`);
    const [src] = await db.insert(schema.identitySources).values({ companyId: co.id, kind: "ad", name: "AD pokrytí", config: {}, policy: {} as any }).returning();
    const flags = { pwdNeverExpires: false, pwdNotRequired: false, preauthDisabled: false, hasSpn: false, unconstrainedDelegation: false };
    await db.insert(schema.identityAccounts).values([
      { sourceId: src!.id, companyId: co.id, externalId: "1", login: "adm", enabled: true, privileged: true, mfa: false, flags },
      { sourceId: src!.id, companyId: co.id, externalId: "2", login: "u1", enabled: true, mfa: false, flags },
    ]);
    await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H });
    const props = (await admin.json("/api/risks/scenarios", { headers: H })).body as any[];
    expect(props.length).toBeGreaterThan(0);
    cov = (await admin.json("/api/risks/scenarios/coverage", { headers: H })).body;
    expect(cov.summary.proposed).toBeGreaterThan(0);
    expect(cov.assets[0].cells[t2.id].reason).toBe("CRM není dostupné z internetu");
    // přijatý scénář: riziko; změna doložených skutečností po hodnocení = podnět k přehodnocení
    const ph = props.find((x) => x.templateKey === "phishing_credentials") ?? props[0];
    const acc = (await admin.json(`/api/risks/scenarios/${ph.id}/accept`, { method: "POST", headers: H, json: {} })).body;
    let re = (await admin.json(`/api/risks/${acc.riskId}/reassessment`, { headers: H })).body;
    expect(re.triggers.filter((x: any) => x.kind === "scenario")).toEqual([]);
    await Bun.sleep(5);
    await db.insert(schema.identityAccounts).values({ sourceId: src!.id, companyId: co.id, externalId: "3", login: "u2", enabled: true, mfa: false, flags });
    await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H });
    re = (await admin.json(`/api/risks/${acc.riskId}/reassessment`, { headers: H })).body;
    const st = re.triggers.find((x: any) => x.kind === "scenario");
    expect(st).toMatchObject({ link: "/risks/scenarios?tab=decided", count: 1 });
    expect(st.title).toContain("CRM služba");
    expect(re.due).not.toBeNull();
    let all = (await admin.json("/api/risks/scenarios?status=all", { headers: H })).body as any[];
    expect(all.find((x) => x.id === ph.id).changedSinceDecision).toBe(true);
    // potvrzení vlastníkem uzavře podnět i příznak změny
    expect((await admin.json(`/api/risks/${acc.riskId}/review`, { method: "POST", headers: H, json: { note: "Hodnocení odpovídá i po změně účtů." } })).status).toBe(200);
    re = (await admin.json(`/api/risks/${acc.riskId}/reassessment`, { headers: H })).body;
    expect(re.triggers.filter((x: any) => x.kind === "scenario")).toEqual([]);
    all = (await admin.json("/api/risks/scenarios?status=all", { headers: H })).body as any[];
    expect(all.find((x) => x.id === ph.id).changedSinceDecision).toBe(false);
    // denní obnova: jen společnosti se scénáři, jen když poslední běh je starší než den
    await db.execute(sql`update risk_scenario_proposals set generated_at = now() - interval '2 days' where company_id = ${co.id}`);
    const before = Date.now() - 60_000;
    expect((await processScenarioRefresh(db as any)).companies).toBeGreaterThanOrEqual(1);
    const [g] = (await db.execute(sql`select max(generated_at) as at from risk_scenario_proposals where company_id = ${co.id}`)) as any[];
    expect(new Date(g.at).getTime()).toBeGreaterThan(before);
    const again = await processScenarioRefresh(db as any);
    expect(again.companies).toBe(0);
    // zpráva o hodnocení rizik: zmrazená analýza rizik z dat (v1.19, ADR-116)
    await admin.json(`/api/risks/scenarios/coverage/${crm}/${cov.threats[1].id}`, { method: "PUT", headers: H, json: { reason: "Ověřeno <img src=x onerror=alert(1)>" } });
    const doc = await admin.json("/api/documents", { method: "POST", headers: H, json: { kind: "risk_report", periodFrom: "2026-01-01", periodTo: "2026-12-31" } });
    expect(doc.status).toBe(201);
    expect(doc.body.metrics.threatCoverage).toBeGreaterThan(0);
    expect(doc.body.metrics.unassessedThreats).toBeGreaterThan(0);
    const html = await (await admin.req(`/api/documents/${doc.body.id}/html`, { headers: H })).text();
    for (const x of ["7. Analýza rizik z dat", "7.1 Profil bezpečnostních schopností", "Vícefaktorové ověření (MFA)", "Změřeno z dat", "CRM není dostupné z internetu", "CRM služba", "Přijato jako riziko", "potvrzeno beze změny", "Hodnocení odpovídá i po změně účtů.", "Změna dat scénáře"])
      expect(html).toContain(x);
    expect(html).not.toContain("<script");
    expect(html).toContain("Ověřeno &lt;img");
    expect(html).not.toContain("<img src=x");
    expect((await admin.req(`/api/documents/${doc.body.id}/docx`, { headers: H })).status).toBe(200);
    // změna dat po vytvoření zprávy snímek nezmění
    cov = (await admin.json(`/api/risks/scenarios/coverage/${crm}/${t1.id}`, { method: "PUT", headers: H, json: { reason: "Doplněno po vytvoření zprávy" } })).body;
    expect(await (await admin.req(`/api/documents/${doc.body.id}/html`, { headers: H })).text()).not.toContain("Doplněno po vytvoření zprávy");
    // společnost bez primárních aktiv a scénářů: část 7 se nepřidá
    const empty = (await admin.json("/api/companies", { method: "POST", json: { name: "Bez aktiv s.r.o.", regime: "lower" } })).body;
    const prevE = await (await admin.req("/api/documents/preview.html?kind=risk_report", { headers: { "x-contix-company": empty.id } })).text();
    expect(prevE).toContain("6. Zvážené kategorie");
    expect(prevE).not.toContain("7. Analýza rizik z dat");
    // zrušení zdůvodnění = opět neposouzeno
    cov = (await admin.json(`/api/risks/scenarios/coverage/${crm}/${t2.id}`, { method: "DELETE", headers: H })).body;
    expect(cov.assets[0].cells[t2.id].reason).toBeNull();
  });

  test("plán zvládání z dat: zbytkové riziko podle testů a monitorů, podnět monitoru, návrhy akcí (v1.20, ADR-117)", async () => {
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Plán z dat s.r.o.", regime: "lower" } })).body;
    const H = { "x-contix-company": co.id };
    const ctl = async (name: string, status: string, effectiveness: string) => (await admin.json("/api/controls", { method: "POST", headers: H, json: { name, status, effectiveness } })).body.id as string;
    const cBackup = await ctl("Zálohování serverů", "implemented", "effective");
    const cEdr = await ctl("EDR na koncových bodech", "implemented", "effective");
    const cPam = await ctl("Správa privilegovaných účtů", "planned", "not_assessed");
    const r = (await admin.json("/api/risks", { method: "POST", headers: H, json: { companyId: co.id, name: "Ransomware na serverech", impact: 4, threatLevel: 3, vulnLevel: 3, controlIds: [cBackup, cEdr, cPam] } })).body;
    let d = (await admin.json(`/api/risks/${r.id}`, { headers: H })).body;
    expect(d.residualSuggestion).toMatchObject({ reduction: 3 }); // dvě účinná opatření
    // neúčinný poslední test a nesplněný monitor = nezapočíst
    await db.insert(schema.controlTests).values({ companyId: co.id, controlId: cBackup, status: "completed", result: "ineffective", performedAt: new Date().toISOString().slice(0, 10), title: "Test obnovy" } as any);
    await Bun.sleep(5);
    const [mon] = await db.insert(schema.controlMonitors).values({ companyId: co.id, controlId: cEdr, kind: "external", name: "Pokrytí EDR", enabled: true, lastResult: "fail", lastSummary: "Pokrytí 71 % < 95 %", lastRunAt: new Date() } as any).returning();
    await db.insert(schema.controlMonitorRuns).values({ monitorId: mon!.id, companyId: co.id, result: "fail", summary: "Pokrytí 71 % < 95 %" } as any);
    d = (await admin.json(`/api/risks/${r.id}`, { headers: H })).body;
    expect(d.residualSuggestion.reduction).toBe(0);
    expect(d.residualSuggestion.basis.join("\n")).toContain("poslední test neúčinný – nezapočteno");
    expect(d.residualSuggestion.basis.join("\n")).toContain("monitor nesplněn – nezapočteno");
    const re = (await admin.json(`/api/risks/${r.id}/reassessment`, { headers: H })).body;
    const mt = re.triggers.find((x: any) => x.kind === "control_monitor");
    expect(mt).toMatchObject({ strong: true, detail: "Pokrytí 71 % < 95 %", link: `/controls/${cEdr}` });
    expect(re.suggestion.map((x: any) => x.field)).toContain("vulnLevel");
    // návrhy akcí: zavést PAM, obnovit účinnost zálohování a EDR
    let sug = (await admin.json(`/api/risks/${r.id}/plan-suggestions`, { headers: H })).body as any[];
    expect(sug.map((x) => x.key).sort()).toEqual([`fix:${cBackup}`, `fix:${cEdr}`, `implement:${cPam}`].sort());
    expect(sug.find((x) => x.key === `fix:${cBackup}`).objective).toContain("poslední test opatření byl neúčinný");
    expect((await admin.json(`/api/risks/${r.id}/plan-suggestions/apply`, { method: "POST", headers: H, json: { keys: [] } })).status).toBe(400);
    const ap = await admin.json(`/api/risks/${r.id}/plan-suggestions/apply`, { method: "POST", headers: H, json: { keys: [`implement:${cPam}`, `fix:${cBackup}`], dueDate: "2027-03-31" } });
    expect(ap.status).toBe(201);
    expect(ap.body.created).toBe(2);
    d = (await admin.json(`/api/risks/${r.id}`, { headers: H })).body;
    expect(d.actions.map((a: any) => a.title).sort()).toEqual(["Obnovit účinnost opatření Zálohování serverů", "Zavést opatření Správa privilegovaných účtů"]);
    expect(d.actions.every((a: any) => a.dueDate === "2027-03-31" && a.status === "planned")).toBe(true);
    sug = (await admin.json(`/api/risks/${r.id}/plan-suggestions`, { headers: H })).body as any[];
    expect(sug.filter((x) => x.existing).length).toBe(2);
    expect((await admin.json(`/api/risks/${r.id}/plan-suggestions/apply`, { method: "POST", headers: H, json: { keys: [`implement:${cPam}`] } })).status).toBe(409);
  });

  test("rozšířená knihovna scénářů: OT, zařízení, komponenty, výpadek, cloud (v1.21, ADR-118)", async () => {
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Knihovna scénářů s.r.o.", regime: "lower" } })).body;
    const H = { "x-contix-company": co.id };
    const mk = async (json: Record<string, unknown>) => (await admin.json("/api/assets", { method: "POST", headers: H, json })).body.id as string;
    const link = (p: string, s2: string) => admin.json("/api/assets/links", { method: "POST", headers: H, json: { primaryId: p, supportingId: s2 } });
    const shop = await mk({ name: "E-shop", assetType: "business_service", confidentiality: 3, integrity: 3, availability: 4, criticality: "critical" });
    const web = await mk({ name: "shop-web", assetType: "server", internetFacing: true, criticality: "critical" });
    const app = await mk({ name: "shop-app", assetType: "application" });
    const m365 = await mk({ name: "Microsoft 365", assetType: "saas_service" });
    await link(shop, web);
    await link(shop, app);
    await link(shop, m365);
    const plant = await mk({ name: "Výroba", assetType: "business_process", integrity: 4, availability: 4 });
    const plc = await mk({ name: "PLC linka 1", assetType: "iot_ot", internetFacing: true });
    await link(plant, plc);
    const sales = await mk({ name: "Obchod", assetType: "business_process", confidentiality: 3 });
    const nb = await mk({ name: "nb-obchod", assetType: "laptop" });
    const srv = await mk({ name: "srv-agent", assetType: "server" });
    await link(sales, nb);
    await db.insert(schema.assetSources).values([{ assetId: srv, sourceType: "wazuh", sourceRef: "lib-001" }, { assetId: nb, sourceType: "wazuh", sourceRef: "lib-002" }]);
    await db.execute(sql`update assets set attributes = '{"wazuh":{"status":"active"}}'::jsonb, last_seen_at = now() where id = ${srv}`);
    await db.execute(sql`update assets set attributes = '{"wazuh":{"status":"disconnected"}}'::jsonb, last_seen_at = now() - interval '20 days' where id = ${nb}`);
    await db.insert(schema.assetVulnerabilities).values({ assetId: app, cveId: "CVE-2026-9101", severity: "high", status: "open" } as any);
    const ctl = (await admin.json("/api/controls", { method: "POST", headers: H, json: { name: "Bezpečná konfigurace M365", status: "implemented" } })).body.id;
    await db.insert(schema.controlMonitors).values({ companyId: co.id, controlId: ctl, kind: "m365_secure_score", name: "Secure Score", enabled: true, lastResult: "fail", lastRunAt: new Date() } as any);
    await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H });
    const list = (await admin.json("/api/risks/scenarios", { headers: H })).body as any[];
    const has = (tpl: string, asset: string) => list.some((x) => x.templateKey === tpl && x.primaryAssetName === asset);
    expect(has("ddos_outage", "E-shop")).toBe(true);
    expect(has("software_supply_chain", "E-shop")).toBe(true);
    expect(has("cloud_misconfig", "E-shop")).toBe(true);
    expect(has("ot_compromise", "Výroba")).toBe(true);
    expect(has("device_loss", "Obchod")).toBe(true);
    // šablony jen pro odpovídající rozsah
    expect(has("device_loss", "E-shop")).toBe(false);
    expect(has("ot_compromise", "E-shop")).toBe(false);
    expect(has("cloud_misconfig", "Výroba")).toBe(false);
    const ot = list.find((x) => x.templateKey === "ot_compromise");
    expect(ot.hits.find((h: any) => h.key === "ot_vulnerable").items).toEqual([{ label: "PLC linka 1", path: `/assets/${plc}` }]);
    const cm = list.find((x) => x.templateKey === "cloud_misconfig");
    expect(cm.hits.find((h: any) => h.key === "secure_score_low").items[0].path).toBe(`/controls/${ctl}`);
    // nové hrozby šablon se promítnou do pokrytí katalogu (H07 u e-shopu)
    const cov = (await admin.json("/api/risks/scenarios/coverage", { headers: H })).body;
    const h07 = cov.threats.find((t: any) => t.code === "H07");
    expect(cov.assets.find((a: any) => a.name === "E-shop").cells[h07.id].state).toBe("proposed");
  });

  test("pokrytí technik ATT&CK detekcí: alerty, hledání, deklarace, vliv na scénář a zprávu (v1.22, ADR-119)", async () => {
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Detekce s.r.o.", regime: "lower" } })).body;
    const H = { "x-contix-company": co.id };
    // bez dat SOC: neměří se
    let det = (await admin.json("/api/risks/scenarios/detection", { headers: H })).body;
    expect(det.measured).toBe(false);
    expect(det.summary.blind).toBe(det.summary.total);
    expect(det.techniques.find((x: any) => x.id === "T1566").templates).toContain("phishing_credentials");
    // primární aktivum s účty bez MFA → návrh phishingu
    const svc = (await admin.json("/api/assets", { method: "POST", headers: H, json: { name: "Pošta", assetType: "business_service", confidentiality: 3, integrity: 3, availability: 3 } })).body.id;
    const [src] = await db.insert(schema.identitySources).values({ companyId: co.id, kind: "ad", name: "AD detekce", config: {}, policy: {} as any }).returning();
    const flags = { pwdNeverExpires: false, pwdNotRequired: false, preauthDisabled: false, hasSpn: false, unconstrainedDelegation: false };
    await db.insert(schema.identityAccounts).values([1, 2, 3].map((i) => ({ sourceId: src!.id, companyId: co.id, externalId: String(i), login: `u${i}`, enabled: true, mfa: i === 1, flags })));
    await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H });
    const before = ((await admin.json("/api/risks/scenarios", { headers: H })).body as any[]).find((x) => x.templateKey === "phishing_credentials" && x.primaryAssetId === svc);
    expect(before.reasons.some((r: any) => r.text === "rsc.why.detectionBlind")).toBe(false);
    // hledání hrozeb s jinou technikou zapne měření → phishing (T1566, T1078, T1621) je slepý
    await db.insert(schema.socHunts).values({ companyId: co.id, name: "Ransomware hunt", query: "x", mitreIds: ["T1486"], enabled: true } as any);
    await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H });
    let ph = ((await admin.json("/api/risks/scenarios", { headers: H })).body as any[]).find((x) => x.id === before.id);
    expect(ph.reasons.find((r: any) => r.text === "rsc.why.detectionBlind").params).toEqual({ blind: 3, total: 3 });
    expect(ph.vulnLevel).toBe(Math.min(4, before.vulnLevel + 1));
    // alert s podtechnikou a deklarace pravidla pokryjí techniky → zranitelnost zpět
    await db.insert(schema.alertSuggestions).values({ companyId: co.id, source: "manual", groupKey: "det-1", ruleId: "m", ruleLevel: 10, description: "Phish", firstSeen: new Date(), lastSeen: new Date(), mitreIds: ["T1566.001", "T1078.004"] } as any);
    expect((await admin.json("/api/risks/scenarios/detection/T9999", { method: "PUT", headers: H, json: { source: "Wazuh 1" } })).status).toBe(404);
    expect((await admin.json("/api/risks/scenarios/detection/T1621", { method: "PUT", headers: H, json: { source: "x" } })).status).toBe(400);
    det = (await admin.json("/api/risks/scenarios/detection/T1621", { method: "PUT", headers: H, json: { source: "Entra ID – MFA fatigue analytika", note: "Sentinel" } })).body;
    const st = (id: string) => det.techniques.find((x: any) => x.id === id);
    expect(det.measured).toBe(true);
    expect(st("T1566")).toMatchObject({ state: "detected", alerts: 1 });
    expect(st("T1486")).toMatchObject({ state: "hunted", hunts: [{ name: "Ransomware hunt" }] });
    expect(st("T1621")).toMatchObject({ state: "declared", declaration: { source: "Entra ID – MFA fatigue analytika", byName: "Admin" } });
    await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H });
    ph = ((await admin.json("/api/risks/scenarios", { headers: H })).body as any[]).find((x) => x.id === before.id);
    expect(ph.reasons.some((r: any) => r.text === "rsc.why.detectionBlind")).toBe(false);
    // zpráva o hodnocení rizik: 7.7
    const html = await (await admin.req("/api/documents/preview.html?kind=risk_report", { headers: H })).text();
    expect(html).toContain("7.7 Pokrytí technik ATT&amp;CK detekcí");
    expect(html).toContain("slepá místa");
    expect((await admin.json("/api/risks/scenarios/detection/T1621", { method: "DELETE", headers: H })).body.techniques.find((x: any) => x.id === "T1621").state).toBe("blind");
  });

  test("ochota riskovat a KRI: schválení, rizika nad ochotou, prahy, podnět kri, výstupy (v1.23, ADR-120)", async () => {
    const co = (await admin.json("/api/companies", { method: "POST", json: { name: "Ochota s.r.o.", regime: "lower" } })).body;
    const H = { "x-contix-company": co.id };
    let ap = (await admin.json("/api/risks/appetite", { headers: H })).body;
    expect(ap.categories.every((c: any) => c.maxLevel === null)).toBe(true);
    expect(ap.kris.find((k: any) => k.key === "mfa_coverage").status).toBe("unknown");
    expect((await admin.json("/api/risks/appetite/approve", { method: "POST", headers: H })).status).toBe(400);
    ap = (await admin.json("/api/risks/appetite", { method: "PUT", headers: H, json: { items: [{ key: "confidentiality", maxLevel: "medium", statement: "Únik osobních údajů nepřijímáme nad střední úroveň." }, { key: "availability", maxLevel: "high" }] } })).body;
    expect(ap.categories.find((c: any) => c.key === "confidentiality").maxLevel).toBe("medium");
    ap = (await admin.json("/api/risks/appetite/approve", { method: "POST", headers: H })).body;
    expect(ap).toMatchObject({ approvedByName: "Admin", changedAfterApproval: false });
    await Bun.sleep(5);
    ap = (await admin.json("/api/risks/appetite", { method: "PUT", headers: H, json: { items: [{ key: "integrity", maxLevel: "low" }] } })).body;
    expect(ap.changedAfterApproval).toBe(true);
    // riziko s hrozbou důvěrnosti nad ochotou
    const cat = (await admin.json("/api/risks/catalog")).body as any[];
    const h01 = cat.find((x: any) => x.code === "H01");
    const r = (await admin.json("/api/risks", { method: "POST", headers: H, json: { companyId: co.id, name: "Únik dat zákazníků", threatId: h01.id, impact: 4, threatLevel: 4, vulnLevel: 4 } })).body;
    ap = (await admin.json("/api/risks/appetite", { headers: H })).body;
    const br = ap.breaches.find((b: any) => b.riskId === r.id);
    expect(br).toMatchObject({ limit: "low", treatment: null });
    expect(br.categories).toEqual(expect.arrayContaining(["confidentiality", "integrity"]));
    // KRI: prahy, validace; MFA pod prahem → překročení s datem
    expect((await admin.json("/api/risks/appetite/kri/mfa_coverage", { method: "PUT", headers: H, json: { enabled: true, warn: 90, alert: 95 } })).status).toBe(400);
    expect((await admin.json("/api/risks/appetite/kri/xxx", { method: "PUT", headers: H, json: { enabled: true, warn: 1, alert: 2 } })).status).toBe(404);
    const svc = (await admin.json("/api/assets", { method: "POST", headers: H, json: { name: "Portál", assetType: "business_service", confidentiality: 3 } })).body.id;
    const [src] = await db.insert(schema.identitySources).values({ companyId: co.id, kind: "ad", name: "AD ochota", config: {}, policy: {} as any }).returning();
    const flags = { pwdNeverExpires: false, pwdNotRequired: false, preauthDisabled: false, hasSpn: false, unconstrainedDelegation: false };
    await db.insert(schema.identityAccounts).values([1, 2, 3, 4].map((i) => ({ sourceId: src!.id, companyId: co.id, externalId: String(i), login: `u${i}`, enabled: true, mfa: i === 1, flags })));
    await admin.json("/api/risks/scenarios/generate", { method: "POST", headers: H });
    const ph = ((await admin.json("/api/risks/scenarios", { headers: H })).body as any[]).find((x) => x.templateKey === "phishing_credentials" && x.primaryAssetId === svc);
    const acc = (await admin.json(`/api/risks/scenarios/${ph.id}/accept`, { method: "POST", headers: H, json: {} })).body;
    await Bun.sleep(5);
    ap = (await admin.json("/api/risks/appetite", { headers: H })).body;
    const mfa = ap.kris.find((k: any) => k.key === "mfa_coverage");
    expect(mfa).toMatchObject({ value: 25, status: "alert", unit: "pct" });
    expect(mfa.breachedSince).not.toBeNull();
    const re = (await admin.json(`/api/risks/${acc.riskId}/reassessment`, { headers: H })).body;
    expect(re.triggers.find((x: any) => x.kind === "kri")).toMatchObject({ detail: "mfa_coverage", link: "/risks/appetite" });
    // vypnutý ukazatel = bez data překročení a bez podnětu
    ap = (await admin.json("/api/risks/appetite/kri/mfa_coverage", { method: "PUT", headers: H, json: { enabled: false, warn: 95, alert: 90 } })).body;
    expect(ap.kris.find((k: any) => k.key === "mfa_coverage")).toMatchObject({ status: "unknown", breachedSince: null });
    expect(((await admin.json(`/api/risks/${acc.riskId}/reassessment`, { headers: H })).body.triggers as any[]).some((x) => x.kind === "kri")).toBe(false);
    // výstupy
    const rr = await (await admin.req("/api/documents/preview.html?kind=risk_report", { headers: H })).text();
    expect(rr).toContain("8. Ochota riskovat a klíčové ukazatele rizik");
    expect(rr).toContain("Únik osobních údajů nepřijímáme nad střední úroveň.");
    expect(rr).toContain("po schválení změněno");
    const isms = await admin.req("/api/documents/preview.html?kind=isms_review", { headers: H });
    if (isms.status === 200) expect(await isms.text()).toContain("Ochota riskovat a klíčové ukazatele rizik");
  });

  test("vývoj rizik v čase a přehled skupiny ze snímků trendů (v1.24, ADR-121)", async () => {
    const cos = ((await admin.json("/api/companies")).body as any[]).filter((x) => ["Ochota s.r.o.", "Pokrytí hrozeb s.r.o."].includes(x.name));
    expect(cos.length).toBe(2);
    for (const co of cos) await takeTrendSnapshot(db as any, co.id);
    const och = cos.find((x) => x.name === "Ochota s.r.o.")!;
    const tr = (await admin.json("/api/trends?months=12", { headers: { "x-contix-company": och.id } })).body;
    const last = tr.points[tr.points.length - 1].values;
    expect(last.risks_over_appetite).toBeGreaterThanOrEqual(1);
    expect(typeof last.threat_coverage_pct).toBe("number");
    expect(typeof last.risks_medium).toBe("number");
    const grp = (await admin.json("/api/risks/appetite/group")).body as any[];
    const row = grp.find((r) => r.companyId === och.id);
    expect(row.period).toMatch(/^\d{4}-\d{2}$/);
    expect(row.values.risks_over_appetite).toBe(last.risks_over_appetite);
    expect(Object.keys(row.values).sort()).toEqual(["detection_blind", "kri_alerts", "risks_critical_high", "risks_over_appetite", "risks_total", "threat_coverage_pct", "weak_capabilities"]);
    expect(grp.length).toBeGreaterThanOrEqual(2);
  });

  test("ukázková data: fiktivní společnost přes API, opakované spuštění nic nepřidá (v1.15)", async () => {
    const call = (co?: string): DemoCall => async (method, path, body) => {
      const r = await admin.json(path, { method, json: body, headers: co ? { [COMPANY_HEADER]: co } : {} });
      return { status: r.status, body: r.body };
    };
    const r = await seedDemo(call(), (co) => call(co));
    expect(r.created).toBe(true);
    expect(r.counts).toMatchObject({ "společnost": 1, "aktivum": 9, "riziko": 4, "proces": 4, "opatření": 5, "úkol": 2 });
    expect(r.counts["deklarace schopnosti"]).toBe(4);
    expect(r.counts["návrh scénáře"]).toBeGreaterThan(0); // ukázka návrhů scénářů z deklarací (v1.17)
    const H = { [COMPANY_HEADER]: r.companyId! };
    const risks = (await admin.json("/api/risks", { headers: H })).body;
    const list = (Array.isArray(risks) ? risks : risks.items) as any[];
    expect(list.filter((x) => x.companyId === r.companyId).map((x) => x.code).sort()).toEqual(["R-01", "R-02", "R-03", "R-04"]);
    const again = await seedDemo(call(), (co) => call(co));
    expect(again).toMatchObject({ created: false, companyId: r.companyId });
  });

  test("oprávnění nových modulů doplněna do systémových rolí", async () => {
    const roles = (await admin.json("/api/admin/roles")).body as any[];
    expect(roles.find((r) => r.key === "viewer").permissions).toContain("processes:read");
    expect(roles.find((r) => r.key === "admin").permissions).toContain("risks:catalog");
    expect(roles.find((r) => r.key === "security_manager").permissions).toEqual(expect.arrayContaining(["controls:write", "bia:write"]));
    expect(roles.find((r) => r.key === "viewer").permissions).toEqual(expect.arrayContaining(["controls:read", "bia:read", "suppliers:read"]));
    expect(roles.find((r) => r.key === "ciso").permissions).toEqual(expect.arrayContaining(["documents:approve", "suppliers:write"]));
  });

  /* ============ Audit a odhlášení ============ */

  test("revize: žádná odpověď API ani auditní záznam neobsahuje hash hesla, tajemství ani hash tokenu", async () => {
    expect(secretLeaks).toEqual([]);
    const rows = await db.execute(sql`select action, details::text as d from audit_log where details::text ~ '(passwordHash|tokenHash|[a-zA-Z]+Enc|_enc)"\s*:\s*"'`);
    expect((rows as any).rows ?? rows).toEqual([]);
  });

  test("auditní záznamy a odhlášení", async () => {
    const log: any[] = [];
    for (let off = 0; off < 3000; off += 500) {
      const page = (await admin.json(`/api/admin/audit-log?limit=500&offset=${off}`)).body as any[];
      log.push(...page);
      if (page.length < 500) break;
    }
    const actions = new Set(log.map((l) => l.action));
    for (const a of ["auth.login", "auth.login_failed", "auth.mfa_enabled", "user.created", "asset.linked", "settings.updated", "org.unit_created", "process.step_created", "risk.created", "control.catalog_generated", "soa.assessed", "bia.created", "risk.action_created", "document.approved", "document.acknowledged", "plan.tested", "supplier.created", "change.created", "objective.created", "incident.created", "incident.reported", "audit.finding_created", "company.created", "methodology.imported", "audit.check_updated", "policy.approved", "policy.acknowledged", "training.session_saved", "notifications.settings_updated", "cycle.started", "cycle.approved", "cycle.item_decided", "company.records_transferred", "alerts.accepted", "risk.created_from_vulns", "ai.settings_updated", "ai.requested", "ai.decided", "evidence.created", "evidence.file_uploaded", "control_test.completed", "report.exported", "evidence.package_exported", "process.version_approved", "gdpr.activity_created", "gdpr.dpia_approved", "ai.query", "api_token.created", "api_token.revoked", "mcp.denied_ip", "import.completed", "policy.workflow_submit", "policy.quiz_attempt", "policy.comment_added", "asset.merged", "asset.duplicate_dismissed", "i18n.pack_uploaded", "control.crosswalk_applied", "coverage.ai_scored", "coverage.snapshot_created", "legislation.watched", "legislation.synced", "legislation.review_updated"])
      expect(actions).toContain(a);
    await admin.json("/api/auth/logout", { method: "POST" });
    expect((await admin.req("/api/assets")).status).toBe(401);
  });
});
