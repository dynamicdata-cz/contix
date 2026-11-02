import { SEVERITY_LEVEL, SOC_OPEN_STATUSES, tacticsFor, type PhishingEmlInfo, type PhishingReportResult } from "@contix/shared";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { alertSuggestions } from "../../db/schema";
import { correlateAlerts } from "./service";

/* ============================================================
 * Hlášení phishingu zaměstnancem (ADR-052). Z .eml se vytáhnou jen hlavičky, výsledky ověření odesílatele,
 * odkazy a názvy příloh – celý e-mail ani obsah příloh se neukládá. Stejný odesílatel + předmět = jeden alert.
 * ============================================================ */

const MAX_URLS = 50;

/** Dekódování MIME encoded-words (=?utf-8?B?…?= / =?…?Q?…?=). */
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_, cs: string, enc: string, txt: string) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Buffer.from(txt, "base64") : Buffer.from(txt.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return new TextDecoder(cs.toLowerCase() as "utf-8", { fatal: false }).decode(bytes);
    } catch {
      return txt;
    }
  });
}

function splitHeaders(raw: string): { headers: [string, string][]; body: string } {
  const m = raw.match(/\r?\n\r?\n/);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index! + m[0].length) : "";
  const headers: [string, string][] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1]![1] += ` ${line.trim()}`;
    else {
      const i = line.indexOf(":");
      if (i > 0) headers.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
    }
  }
  return { headers, body };
}
const h1 = (hs: [string, string][], name: string) => hs.find(([k]) => k === name)?.[1] ?? null;
const param = (v: string | null, name: string) => v?.match(new RegExp(`${name}\\*?=\\s*"?([^";]+)"?`, "i"))?.[1]?.trim() ?? null;

function decodeBody(body: string, enc: string | null, charset: string | null): string {
  const e = (enc ?? "").toLowerCase();
  let bytes: Buffer;
  if (e === "base64") bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
  else if (e === "quoted-printable") bytes = Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
  else return body;
  try {
    return new TextDecoder((charset ?? "utf-8").toLowerCase() as "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** Projde MIME části: texty (pro odkazy) a názvy příloh. */
function walk(raw: string, out: { texts: string[]; attachments: string[] }, depth = 0) {
  if (depth > 6) return;
  const { headers, body } = splitHeaders(raw);
  const ct = h1(headers, "content-type") ?? "text/plain";
  const disp = h1(headers, "content-disposition");
  const filename = param(disp, "filename") ?? param(ct, "name");
  if (/^multipart\//i.test(ct)) {
    const b = param(ct, "boundary");
    if (!b) return;
    const parts = body.split(new RegExp(`--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*`));
    for (const p of parts.slice(1)) if (p.trim()) walk(p, out, depth + 1);
    return;
  }
  if (filename || /attachment/i.test(disp ?? "")) {
    out.attachments.push(decodeWords(filename ?? "příloha").slice(0, 200));
    return;
  }
  if (/^text\/|message\/rfc822/i.test(ct)) out.texts.push(decodeBody(body, h1(headers, "content-transfer-encoding"), param(ct, "charset")));
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)));

/** Rozbor .eml – jen metadata a odkazy. */
export function parseEml(raw: string): PhishingEmlInfo {
  const { headers } = splitHeaders(raw);
  const out = { texts: [] as string[], attachments: [] as string[] };
  walk(raw, out);
  const authRes = headers.filter(([k]) => k === "authentication-results" || k === "arc-authentication-results").map(([, v]) => v).join(" ");
  const res = (k: string) => authRes.match(new RegExp(`\\b${k}=([a-z]+)`, "i"))?.[1]?.toLowerCase() ?? null;
  const received = headers.filter(([k]) => k === "received").map(([, v]) => v);
  const oldest = received.at(-1) ?? "";
  const urls = [...new Set(out.texts.flatMap((t) => (decodeEntities(t).match(/https?:\/\/[^\s"'<>()\]\[{}]+/gi) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ""))))].slice(0, MAX_URLS);
  const domains = [
    ...new Set(
      urls.flatMap((u) => {
        try {
          return [new URL(u).hostname.toLowerCase()];
        } catch {
          return [];
        }
      }),
    ),
  ];
  const dh = (n: string) => {
    const v = h1(headers, n);
    return v ? decodeWords(v).slice(0, 300) : null;
  };
  return {
    from: dh("from"),
    replyTo: dh("reply-to"),
    returnPath: dh("return-path"),
    subject: dh("subject"),
    date: dh("date"),
    messageId: dh("message-id"),
    auth: { spf: res("spf") ?? (h1(headers, "received-spf")?.split(/\s/)[0]?.toLowerCase() ?? null), dkim: res("dkim"), dmarc: res("dmarc") },
    hops: received.length,
    originIp: oldest.match(/\[(\d{1,3}(?:\.\d{1,3}){3})\]/)?.[1] ?? oldest.match(/\((?:[^)]*?)(\d{1,3}(?:\.\d{1,3}){3})\)/)?.[1] ?? null,
    urls,
    domains,
    attachments: [...new Set(out.attachments)].slice(0, 30),
  };
}

/** E-mailová adresa z hlavičky From („Jméno <a@b.cz>“ → a@b.cz). */
export const addrOf = (from: string | null) => (from?.match(/<([^>]+)>/)?.[1] ?? from ?? "").trim().toLowerCase();

/** Založí alert SOC z hlášení phishingu, nebo připíše další hlášení ke stejné kampani (odesílatel + předmět). */
export async function reportPhishing(
  db: Db,
  input: { companyId: string; userId: string; note: string; info: PhishingEmlInfo | null; from?: string | null; subject?: string | null },
  now = new Date(),
): Promise<PhishingReportResult> {
  const info = input.info;
  const from = info?.from ?? input.from ?? null;
  const subject = (info?.subject ?? input.subject ?? "").trim() || "(bez předmětu)";
  const normSubject = subject.toLowerCase().replace(/^((re|fw|fwd|odp|vs)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();
  const key = `phishing:${createHash("sha256").update(`${input.companyId}|${addrOf(from)}|${normSubject}`).digest("hex").slice(0, 40)}`;
  const note = input.note.trim() ? [{ at: now.toISOString(), userId: input.userId, text: `Hlášení zaměstnance: ${input.note.trim().slice(0, 2000)}` }] : [];
  const [open] = await db
    .select()
    .from(alertSuggestions)
    .where(and(eq(alertSuggestions.groupKey, key), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES])))
    .limit(1);
  if (open) {
    const sample = (open.sample ?? {}) as Record<string, unknown>;
    await db
      .update(alertSuggestions)
      .set({ count: open.count + 1, lastSeen: now, notes: [...open.notes, ...note], sample: { ...sample, reports: Number(sample.reports ?? 1) + 1 }, updatedAt: now })
      .where(eq(alertSuggestions.id, open.id));
    return { alertId: open.id, duplicate: true, info };
  }
  const authFail = info && [info.auth.spf, info.auth.dkim, info.auth.dmarc].some((x) => x === "fail" || x === "softfail");
  const desc = [
    `Odesílatel: ${from ?? "neuveden"}`,
    info?.replyTo && addrOf(info.replyTo) !== addrOf(from) ? `Odpověď na jinou adresu: ${info.replyTo}` : null,
    info?.returnPath && addrOf(info.returnPath) !== addrOf(from) ? `Return-Path: ${info.returnPath}` : null,
    `Předmět: ${subject}`,
    info ? `Ověření odesílatele: SPF ${info.auth.spf ?? "?"}, DKIM ${info.auth.dkim ?? "?"}, DMARC ${info.auth.dmarc ?? "?"}` : null,
    info?.domains.length ? `Domény odkazů: ${info.domains.slice(0, 15).join(", ")}` : null,
    info?.attachments.length ? `Přílohy: ${info.attachments.slice(0, 10).join(", ")}` : null,
    info ? null : "E-mail nebyl přiložen (.eml) – jen údaje od zaměstnance.",
  ]
    .filter(Boolean)
    .join("\n");
  const mitreIds = info?.attachments.length ? ["T1566", "T1204"] : ["T1566"];
  const [row] = await db
    .insert(alertSuggestions)
    .values({
      companyId: input.companyId,
      source: "phishing",
      groupKey: key,
      ruleId: "phishing",
      ruleLevel: authFail || info?.attachments.length ? SEVERITY_LEVEL.high : SEVERITY_LEVEL.medium,
      title: `Nahlášený phishing: ${subject}`.slice(0, 300),
      description: desc.slice(0, 4000),
      firstSeen: now,
      lastSeen: now,
      count: 1,
      mitreIds,
      mitreTactics: tacticsFor(mitreIds),
      playbookKey: "phishing",
      notes: note,
      createdById: input.userId,
      sample: {
        from,
        subject,
        reports: 1,
        ...(info ? { replyTo: info.replyTo, returnPath: info.returnPath, date: info.date, messageId: info.messageId, auth: info.auth, hops: info.hops, urls: info.urls, domains: info.domains, attachments: info.attachments } : {}),
        ...(info?.originIp ? { srcip: info.originIp } : {}),
      },
    })
    .returning({ id: alertSuggestions.id });
  await correlateAlerts(db, now);
  return { alertId: row!.id, duplicate: false, info };
}
