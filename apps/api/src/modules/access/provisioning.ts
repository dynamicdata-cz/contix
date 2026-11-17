import {
  AdSourceConfig,
  ProvisioningApplyInput,
  ProvisioningSettingsInput,
  groupKey,
  isPrivilegedAdGroup,
  matchAccounts,
  personStatus,
  provisioningGroupError,
  provisioningScript,
  sidToString,
  type ProvisioningOp,
  type ProvisioningGroupOp,
  adGroupNameError,
  allowedOuError,
  bindAccountError,
  parentDn,
  type ProvisioningPlanItem,
  type ProvisioningResult,
  type ProvisioningSettingsDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Attribute, Change, Client } from "ldapts";
import { encrypt } from "../../auth/crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { hasPermIn, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { identityGroups, iamPeople, iamProvisioning, iamProvisioningLog, iamRequests, iamResources, identityAccounts, identitySources } from "../../db/schema";
import { adError } from "../identity/ad";
import { sourceSecret } from "../identity/service";
import { fulfilRequest, fullName, lower, todayIso, type ReqRow } from "./routes";

/* ============================================================
 * Nastavení členství skupin v AD podle schválených žádostí (v1.29, ADR-126).
 * Režimy: off (ručně), script (PowerShell + ověření synchronizací), ldap (zápis odděleným účtem).
 * Pojistky: jen skupiny uvnitř povolené OU, nikdy privilegované (název, SID, adminCount), denní limit,
 * náhled a výslovné potvrzení, záznam každého zápisu; žádost se vyřídí jen po úspěchu.
 * ============================================================ */

/** Zápis do AD – v testech se nahradí. */
export interface AdWriter {
  /** Kontrola skupiny na serveru: existuje, není chráněná (adminCount) ani privilegovaná (SID). */
  checkGroup(groupDn: string): Promise<{ ok: boolean; reason?: string }>;
  addMember(groupDn: string, memberDn: string): Promise<void>;
  removeMember(groupDn: string, memberDn: string): Promise<void>;
  /** Vytvoření globální bezpečnostní skupiny (v1.33). */
  createGroup(groupDn: string, name: string, description: string | null): Promise<void>;
  close(): Promise<void>;
}
export type AdWriterFactory = (conn: { config: AdSourceConfig; bindDn: string; password: string; extraPrivileged: string[] }) => Promise<AdWriter>;

/** Výchozí implementace přes LDAP(S) (ldapts). */
export const ldapWriter: AdWriterFactory = async ({ config, bindDn, password, extraPrivileged }) => {
  const client = new Client({
    url: config.url.replace(/\/$/, ""),
    timeout: 30_000,
    connectTimeout: 10_000,
    ...(config.url.startsWith("ldaps://") ? { tlsOptions: { rejectUnauthorized: config.verifyTls, ...(config.caCert ? { ca: [config.caCert] } : {}) } } : {}),
  });
  try {
    await client.bind(bindDn, password);
  } catch (e) {
    await client.unbind().catch(() => {});
    throw new Error(adError(e));
  }
  const code = (e: unknown) => (e as { code?: number })?.code;
  return {
    async checkGroup(dn) {
      try {
        const { searchEntries } = await client.search(dn, { scope: "base", filter: "(objectClass=group)", attributes: ["cn", "objectSid", "adminCount"] });
        const g = searchEntries[0];
        if (!g) return { ok: false, reason: "Skupina v AD neexistuje" };
        const sidRaw = g.objectSid;
        const sid = Buffer.isBuffer(sidRaw) ? sidToString(new Uint8Array(sidRaw)) : "";
        const cn = String(Array.isArray(g.cn) ? g.cn[0] : g.cn ?? "");
        if (String(g.adminCount ?? "0") === "1") return { ok: false, reason: "Skupina je chráněná (adminCount=1) – CONTIX do ní nezapisuje" };
        if (isPrivilegedAdGroup(sid, cn, extraPrivileged)) return { ok: false, reason: "Privilegovaná skupina – CONTIX do ní nezapisuje" };
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: code(e) === 32 ? "Skupina v AD neexistuje" : adError(e) };
      }
    },
    async addMember(groupDn, memberDn) {
      try {
        await client.modify(groupDn, new Change({ operation: "add", modification: new Attribute({ type: "member", values: [memberDn] }) }));
      } catch (e) {
        if (code(e) === 68 || code(e) === 20) return; // už je členem
        throw new Error(adError(e));
      }
    },
    async removeMember(groupDn, memberDn) {
      try {
        await client.modify(groupDn, new Change({ operation: "delete", modification: new Attribute({ type: "member", values: [memberDn] }) }));
      } catch (e) {
        if (code(e) === 16 || code(e) === 53) return; // není členem
        throw new Error(adError(e));
      }
    },
    async createGroup(groupDn, name, description) {
      try {
        // globální bezpečnostní skupina: GLOBAL_GROUP (0x2) | SECURITY_ENABLED (0x80000000)
        await client.add(groupDn, { objectClass: ["top", "group"], cn: name, sAMAccountName: name, groupType: "-2147483646", ...(description ? { description } : {}) });
      } catch (e) {
        if (code(e) === 68) return; // už existuje
        throw new Error(adError(e));
      }
    },
    async close() {
      await client.unbind().catch(() => {});
    },
  };
};

async function settingsRow(db: Db, companyId: string) {
  const [s] = await db.select().from(iamProvisioning).where(eq(iamProvisioning.companyId, companyId));
  return s ?? null;
}

async function usedToday(db: Db, companyId: string) {
  const start = new Date(`${todayIso()}T00:00:00Z`);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(iamProvisioningLog).where(and(eq(iamProvisioningLog.companyId, companyId), eq(iamProvisioningLog.ok, true), gte(iamProvisioningLog.createdAt, start)));
  return r?.n ?? 0;
}

async function settingsDto(db: Db, companyId: string): Promise<ProvisioningSettingsDto> {
  const s = await settingsRow(db, companyId);
  const [src] = s?.sourceId ? await db.select({ name: identitySources.name }).from(identitySources).where(eq(identitySources.id, s.sourceId)) : [];
  return {
    mode: (s?.mode ?? "off") as ProvisioningSettingsDto["mode"],
    sourceId: s?.sourceId ?? null,
    sourceName: src?.name ?? null,
    bindDn: s?.bindDn ?? "",
    hasPassword: !!s?.secretEnc,
    allowedOu: s?.allowedOu ?? "",
    dailyLimit: s?.dailyLimit ?? 50,
    extraForbidden: s?.extraForbidden ?? [],
    usedToday: await usedToday(db, companyId),
    adSources: await db.select({ id: identitySources.id, name: identitySources.name }).from(identitySources).where(and(eq(identitySources.companyId, companyId), eq(identitySources.kind, "ad"))),
  };
}

/** Schválené žádosti s oprávněním se skupinou AD → plánované operace (účet podle loginu / e-mailu, DN ze synchronizace). */
export async function provisioningPlan(db: Db, companyId: string, requestIds?: string[], creating: Set<string> = new Set()): Promise<(ProvisioningPlanItem & { op: ProvisioningOp | null; req: ReqRow })[]> {
  const s = await settingsRow(db, companyId);
  const conds = [eq(iamRequests.companyId, companyId), eq(iamRequests.status, "approved")];
  if (requestIds) conds.push(inArray(iamRequests.id, requestIds));
  const rows = await db
    .select({ req: iamRequests, p: iamPeople, r: iamResources })
    .from(iamRequests)
    .innerJoin(iamPeople, eq(iamPeople.id, iamRequests.personId))
    .innerJoin(iamResources, eq(iamResources.id, iamRequests.resourceId))
    .where(and(...conds));
  const withGroup = rows.filter((x) => x.r.adGroup);
  if (!withGroup.length) return [];
  const accounts = await db
    .select({ id: identityAccounts.id, login: identityAccounts.login, email: identityAccounts.email, enabled: identityAccounts.enabled, groups: identityAccounts.groups, dn: identityAccounts.dn })
    .from(identityAccounts)
    .where(and(eq(identityAccounts.companyId, companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.kind, "user"), ...(s?.sourceId ? [eq(identityAccounts.sourceId, s.sourceId)] : [])));
  const today = todayIso();
  const match = matchAccounts(
    withGroup.map((x) => ({ id: x.p.id, name: fullName(x.p), login: x.p.login, email: x.p.email, status: personStatus(x.p, today) })),
    accounts,
  );
  return withGroup.map(({ req, p, r }) => {
    const acc = match.get(p.id) as (typeof accounts)[number] | undefined;
    let error = provisioningGroupError(r.adGroup, s?.allowedOu ?? "", s?.extraForbidden ?? []);
    if (!error && r.adCreate && !creating.has(r.id)) error = "Skupina v AD ještě neexistuje – nejdřív ji vytvořte (vyberte ji v části Nové skupiny)";
    if (!error && !acc) error = "Osoba nemá v AD dohledaný účet (login nebo e-mail)";
    if (!error && !acc!.dn) error = "U účtu chybí DN – načtěte zdroj identit AD";
    const op: ProvisioningOp | null = error ? null : { requestId: req.id, action: req.action as "grant" | "revoke", groupDn: r.adGroup!, member: acc!.dn!, personName: fullName(p) };
    return { requestId: req.id, personName: fullName(p), resourceName: r.name, action: req.action as "grant" | "revoke", groupDn: r.adGroup, member: acc?.dn ?? acc?.login ?? null, error, op, req };
  });
}

/** Oprávnění se skupinou, která v AD ještě není (adCreate) – co CONTIX vytvoří a zda smí. */
export async function provisioningGroupPlan(db: Db, companyId: string, resourceIds?: string[]): Promise<ProvisioningGroupOp[]> {
  const s = await settingsRow(db, companyId);
  const conds = [eq(iamResources.companyId, companyId), eq(iamResources.adCreate, true)];
  if (resourceIds) conds.push(inArray(iamResources.id, resourceIds));
  const rows = await db.select().from(iamResources).where(and(...conds));
  return rows.map((r) => {
    const dn = r.adGroup ?? "";
    const name = groupKey(dn) ? (dn.match(/^\s*CN=((?:\\,|[^,])+)/i)?.[1] ?? "").replace(/\\,/g, ",") : "";
    const error = provisioningGroupError(dn, s?.allowedOu ?? "", s?.extraForbidden ?? []) ?? adGroupNameError(name);
    return { resourceId: r.id, name, groupDn: dn, ou: parentDn(dn), description: r.description, error };
  });
}

/**
 * Ověření podle posledního načtení AD: schválené přidělení, kde je účet už členem skupiny (nebo odebrání, kde už není),
 * se označí jako vyřízené. Pro režim „jen skript“ i jako kontrola ručního nastavení. Vrací počet vyřízených.
 */
export async function verifyByDirectory(db: Db, companyId?: string) {
  const companies = companyId ? [companyId] : (await db.select({ c: iamProvisioning.companyId }).from(iamProvisioning).where(inArray(iamProvisioning.mode, ["script", "ldap"]))).map((x) => x.c);
  let n = 0;
  for (const co of companies) {
    // nově vytvořené skupiny, které už synchronizace vidí
    const pending = await db.select({ id: iamResources.id, dn: iamResources.adGroup }).from(iamResources).where(and(eq(iamResources.companyId, co), eq(iamResources.adCreate, true)));
    if (pending.length) {
      const known = new Set((await db.select({ dn: identityGroups.dn }).from(identityGroups).where(and(eq(identityGroups.companyId, co), isNull(identityGroups.removedAt)))).map((g) => g.dn.toLowerCase()));
      for (const r of pending) if (r.dn && known.has(r.dn.toLowerCase())) await db.update(iamResources).set({ adCreate: false, updatedAt: new Date() }).where(eq(iamResources.id, r.id));
    }
    const plan = await provisioningPlan(db, co);
    const ids = plan.filter((x) => x.op).map((x) => x.op!.member);
    if (!ids.length) continue;
    const members = await db.select({ dn: identityAccounts.dn, groups: identityAccounts.groups }).from(identityAccounts).where(and(eq(identityAccounts.companyId, co), inArray(identityAccounts.dn, ids)));
    for (const x of plan) {
      if (!x.op) continue;
      const acc = members.find((m) => m.dn === x.op!.member);
      if (!acc) continue;
      const isMember = acc.groups.some((g) => groupKey(g) === groupKey(x.op!.groupDn));
      if ((x.op.action === "grant" && isMember) || (x.op.action === "revoke" && !isMember)) {
        await fulfilRequest(db, x.req, null, "Ověřeno podle stavu v AD (synchronizace zdroje identit)");
        await audit(db, { email: "synchronizace AD", action: x.op.action === "grant" ? "access.granted" : "access.revoked", entityType: "access_request", entityId: x.requestId, details: { person: x.personName, resource: x.resourceName, adGroup: x.op.groupDn, verified: true } });
        n++;
      }
    }
  }
  return n;
}

export function accessProvisioningRoutes(db: Db, config: Config, deps: { adWriter?: AdWriterFactory } = {}) {
  const writer = deps.adWriter ?? ldapWriter;
  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "access"))
      .get("/provisioning", requirePerm("access:manage"), async (c) => c.json(await settingsDto(db, targetCompany(c, c.req.query("companyId") ?? null, "access:manage"))))
      .put("/provisioning", requirePerm("access:manage"), zValidator("json", ProvisioningSettingsInput), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        if (!hasPermIn(c, "admin:settings", companyId)) throw new HTTPException(403, { message: "Nastavení zápisu do AD smí měnit jen správce systému (admin:settings)" });
        const v = c.req.valid("json");
        if (v.sourceId) {
          const [src] = await db.select({ companyId: identitySources.companyId, kind: identitySources.kind }).from(identitySources).where(eq(identitySources.id, v.sourceId));
          if (!src || src.companyId !== companyId || src.kind !== "ad") throw new HTTPException(400, { message: "Zdroj identit musí být AD téže společnosti" });
        }
        if (v.mode === "ldap" && (!v.sourceId || !v.bindDn || !v.allowedOu)) throw new HTTPException(400, { message: "Pro zápis do AD vyplňte zdroj AD, zapisovací účet a povolenou OU" });
        if (v.mode !== "off") {
          const ouErr = allowedOuError(v.allowedOu);
          if (ouErr) throw new HTTPException(400, { message: ouErr });
        }
        if (v.mode === "ldap") {
          const bErr = bindAccountError(v.bindDn);
          if (bErr) throw new HTTPException(400, { message: bErr });
        }
        const prev = await settingsRow(db, companyId);
        const secretEnc = v.password ? encrypt(v.password, appSecret(config)) : (prev?.secretEnc ?? null);
        if (v.mode === "ldap" && !secretEnc) throw new HTTPException(400, { message: "Zadejte heslo zapisovacího účtu" });
        const vals = { mode: v.mode, sourceId: v.sourceId, bindDn: v.bindDn, secretEnc, allowedOu: v.allowedOu, dailyLimit: v.dailyLimit, extraForbidden: v.extraForbidden, updatedAt: new Date() };
        await db.insert(iamProvisioning).values({ companyId, ...vals }).onConflictDoUpdate({ target: iamProvisioning.companyId, set: vals });
        await audit(db, { c, user: currentUser(c), action: "access.provisioning_settings", entityType: "iam_provisioning", details: { mode: v.mode, bindDn: v.bindDn, allowedOu: v.allowedOu, dailyLimit: v.dailyLimit, passwordChanged: !!v.password } });
        return c.json(await settingsDto(db, companyId));
      })
      /** Nové skupiny k vytvoření v AD (oprávnění s příznakem adCreate). */
      .get("/provisioning/groups", requirePerm("access:manage"), async (c) => c.json(await provisioningGroupPlan(db, targetCompany(c, c.req.query("companyId") ?? null, "access:manage"))))
      /** Náhled: co se v AD změní u schválených žádostí. */
      .get("/provisioning/plan", requirePerm("access:manage"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        return c.json((await provisioningPlan(db, companyId)).map(({ op: _o, req: _r, ...x }) => x));
      })
      /** Skript PowerShell pro vybrané žádosti (režim „jen skript“). */
      .post("/provisioning/script", requirePerm("access:manage"), zValidator("json", ProvisioningApplyInput), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        const s = await settingsRow(db, companyId);
        if (!s || s.mode === "off") throw new HTTPException(409, { message: "Nastavení skupin v AD je vypnuté" });
        const me = currentUser(c);
        const myPersons = new Set((await db.select({ id: iamPeople.id }).from(iamPeople).where(sql`lower(${iamPeople.email}) = ${lower(me.email)}`)).map((p) => p.id));
        const v = c.req.valid("json");
        const creates = (v.resourceIds.length ? await provisioningGroupPlan(db, companyId, v.resourceIds) : []).filter((g) => !g.error);
        const plan = (v.requestIds.length ? await provisioningPlan(db, companyId, v.requestIds, new Set(creates.map((g) => g.resourceId))) : []).filter((x) => x.op && !myPersons.has(x.req.personId));
        const ops = plan.map((x) => x.op!);
        if (!ops.length && !creates.length) throw new HTTPException(400, { message: "Žádná z vybraných žádostí nejde nastavit v AD" });
        await audit(db, { c, user: me, action: "access.provisioning_script", entityType: "iam_provisioning", details: { requests: ops.map((o) => o.requestId), groups: creates.map((g) => g.groupDn) } });
        return new Response(provisioningScript(ops, new Date().toISOString().slice(0, 16).replace("T", " "), creates), {
          headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="contix-ad-${todayIso()}.ps1"`, "cache-control": "private, no-store" },
        });
      })
      /** Zápis do AD (režim ldap) – jen vybrané a potvrzené žádosti, v limitu; úspěch = vyřízení. */
      .post("/provisioning/apply", requirePerm("access:manage"), zValidator("json", ProvisioningApplyInput), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        const s = await settingsRow(db, companyId);
        if (s?.mode !== "ldap") throw new HTTPException(409, { message: "Zápis do AD není zapnutý" });
        const [src] = s.sourceId ? await db.select().from(identitySources).where(eq(identitySources.id, s.sourceId)) : [];
        if (!src) throw new HTTPException(409, { message: "Zdroj identit AD pro zápis není nastaven" });
        const password = sourceSecret({ secretEnc: s.secretEnc }, config);
        if (!password) throw new HTTPException(409, { message: "Heslo zapisovacího účtu chybí nebo nejde dešifrovat – zadejte ho znovu" });
        const me = currentUser(c);
        const v = c.req.valid("json");
        const groupPlan = v.resourceIds.length ? await provisioningGroupPlan(db, companyId, v.resourceIds) : [];
        const creates = groupPlan.filter((g) => !g.error);
        const plan = v.requestIds.length ? await provisioningPlan(db, companyId, v.requestIds, new Set(creates.map((g) => g.resourceId))) : [];
        const results: ProvisioningResult[] = [];
        const left = s.dailyLimit - (await usedToday(db, companyId));
        const ready = plan.filter((x) => x.op);
        for (const g of groupPlan.filter((x) => x.error)) results.push({ requestId: g.resourceId, ok: false, message: g.error! });
        for (const x of plan.filter((p) => !p.op)) results.push({ requestId: x.requestId, ok: false, message: x.error! });
        if (ready.length + creates.length > left) throw new HTTPException(429, { message: `Denní limit zápisů do AD (${s.dailyLimit}) by byl překročen – zbývá ${Math.max(0, left)}` });
        if (!ready.length && !creates.length) return c.json(results);
        // dotčená osoba nesmí nastavovat přístup sama sobě
        const myPersons = new Set((await db.select({ id: iamPeople.id }).from(iamPeople).where(sql`lower(${iamPeople.email}) = ${lower(me.email)}`)).map((p) => p.id));
        const cfg = AdSourceConfig.parse(src.config);
        let w: AdWriter;
        try {
          w = await writer({ config: cfg, bindDn: s.bindDn, password, extraPrivileged: [...cfg.extraPrivilegedGroups, ...s.extraForbidden] });
        } catch (e) {
          throw new HTTPException(502, { message: (e as Error).message });
        }
        try {
          // nejdřív nové skupiny, pak členství
          for (const g of creates) {
            let ok = false;
            let message = "";
            try {
              await w.createGroup(g.groupDn, g.name, g.description);
              ok = true;
              message = "Skupina vytvořena v AD";
              await db.update(iamResources).set({ adCreate: false, updatedAt: new Date() }).where(eq(iamResources.id, g.resourceId));
            } catch (e) {
              message = (e as Error).message;
            }
            await db.insert(iamProvisioningLog).values({ companyId, requestId: null, action: "create", groupDn: g.groupDn, member: "", ok, message, userId: me.id });
            await audit(db, { c, user: me, action: ok ? "access.group_created" : "access.provisioning_failed", entityType: "iam_resource", entityId: g.resourceId, details: { adGroup: g.groupDn, message } });
            results.push({ requestId: g.resourceId, ok, message });
          }
          for (const x of ready) {
            const op = x.op!;
            if (myPersons.has(x.req.personId)) {
              results.push({ requestId: x.requestId, ok: false, message: "Přístup sobě nastavovat nelze" });
              continue;
            }
            let ok = false;
            let message = "";
            const chk = await w.checkGroup(op.groupDn);
            if (!chk.ok) message = chk.reason ?? "Skupinu nelze použít";
            else
              try {
                if (op.action === "grant") await w.addMember(op.groupDn, op.member);
                else await w.removeMember(op.groupDn, op.member);
                ok = true;
                message = op.action === "grant" ? "Přidáno do skupiny v AD" : "Odebráno ze skupiny v AD";
              } catch (e) {
                message = (e as Error).message;
              }
            await db.insert(iamProvisioningLog).values({ companyId, requestId: op.requestId, action: op.action, groupDn: op.groupDn, member: op.member, ok, message, userId: me.id });
            if (ok) {
              await fulfilRequest(db, x.req, me.id, `${message} (CONTIX)`);
              await audit(db, { c, user: me, action: op.action === "grant" ? "access.granted" : "access.revoked", entityType: "access_request", entityId: op.requestId, details: { person: op.personName, resource: x.resourceName, adGroup: op.groupDn, member: op.member, provisioned: true } });
            } else await audit(db, { c, user: me, action: "access.provisioning_failed", entityType: "access_request", entityId: op.requestId, details: { adGroup: op.groupDn, member: op.member, message } });
            results.push({ requestId: op.requestId, ok, message });
          }
        } finally {
          await w.close();
        }
        return c.json(results);
      })
      /** Ověření podle posledního načtení AD (vyřídí žádosti, které už v AD platí). */
      .post("/provisioning/verify", requirePerm("access:manage"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        return c.json({ fulfilled: await verifyByDirectory(db, companyId) });
      })
  );
}
