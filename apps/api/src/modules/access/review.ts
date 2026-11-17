import {
  CertDecisionInput,
  CertificationInput,
  ImportSettingsInput,
  certProgress,
  isPeopleHeader,
  personStatus,
  type CertItemDto,
  type CertificationDto,
  type ImportSettingsDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { iamCertificationItems, iamCertifications, iamGrants, iamImportSettings, iamPeople, iamRequests, iamResources, users } from "../../db/schema";
import { readTable } from "../import/table";
import { createRequest, fullName, importPeople, lower, todayIso, userByEmail } from "./routes";

/* ============================================================
 * Žádosti o přístup II (v1.27, ADR-124): automatický import osob ze souboru (export PERM…) a recertifikace
 * přidělených oprávnění – posuzovatel (vlastník oprávnění / nadřízený) potvrdí nebo odebere; odebrání = žádost origin review.
 * ============================================================ */

type Ctx = Context<AppEnv>;
const importDir = (config: Config) => config.ACCESS_IMPORT_DIR?.trim() || "/import";
const MAX_FILE = 10 * 1024 * 1024;

/* ---------------- automatický import ---------------- */

/** Načte soubor z adresáře importu a naimportuje osoby; bez `force` jen při změně obsahu (SHA-256). */
export async function runAutoImport(db: Db, config: Config, companyId: string, force: boolean, user: { id: string; email: string } | null = null) {
  const [s] = await db.select().from(iamImportSettings).where(eq(iamImportSettings.companyId, companyId));
  if (!s?.fileName) throw new HTTPException(400, { message: "Není nastaven soubor pro import" });
  const name = basename(s.fileName);
  if (name !== s.fileName) throw new HTTPException(400, { message: "Jen název souboru bez cesty" });
  const path = join(importDir(config), name);
  try {
    if (!existsSync(path)) throw new Error(`Soubor ${name} v adresáři importu není`);
    if (statSync(path).size > MAX_FILE) throw new Error("Soubor je příliš velký (max. 10 MB)");
    const buf = readFileSync(path);
    const sha = createHash("sha256").update(buf).digest("hex");
    if (!force && sha === s.lastSha256) return { skipped: true as const };
    const t = readTable(new Uint8Array(buf), name, null, isPeopleHeader);
    const r = await importPeople(db, companyId, t.headers, t.rows, t.lines, true, { missingAsLeft: s.missingAsLeft });
    await db.update(iamImportSettings).set({ lastRunAt: new Date(), lastSha256: sha, lastResult: r.counts, lastError: null }).where(eq(iamImportSettings.companyId, companyId));
    await audit(db, { user, email: user ? undefined : "plánovač", action: "access.people_auto_imported", entityType: "iam_person", details: { file: name, ...r.counts } });
    return { skipped: false as const, counts: r.counts };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await db.update(iamImportSettings).set({ lastRunAt: new Date(), lastError: msg }).where(eq(iamImportSettings.companyId, companyId));
    throw new HTTPException(422, { message: msg });
  }
}

/** Plánovač: zapnuté automatické importy (při změně souboru). */
export async function processPeopleAutoImport(db: Db, config: Config) {
  for (const s of await db.select().from(iamImportSettings).where(eq(iamImportSettings.enabled, true)))
    await runAutoImport(db, config, s.companyId, false).catch((e) => console.error("Import osob:", (e as Error).message));
}

async function importSettingsDto(db: Db, config: Config, companyId: string): Promise<ImportSettingsDto> {
  const [s] = await db.select().from(iamImportSettings).where(eq(iamImportSettings.companyId, companyId));
  const dir = importDir(config);
  let dirAvailable = false;
  try {
    dirAvailable = statSync(dir).isDirectory();
  } catch {
    /* adresář není připojen */
  }
  return {
    enabled: s?.enabled ?? false,
    fileName: s?.fileName ?? "",
    missingAsLeft: s?.missingAsLeft ?? false,
    dir,
    dirAvailable,
    fileFound: !!s?.fileName && dirAvailable && existsSync(join(dir, basename(s.fileName))),
    lastRunAt: s?.lastRunAt?.toISOString() ?? null,
    lastResult: s?.lastResult ?? null,
    lastError: s?.lastError ?? null,
  };
}

/* ---------------- recertifikace ---------------- */

/** Položky recertifikace čekající na uživatele (Moje práce). */
export async function pendingCertificationsFor(db: Db, userId: string) {
  const rows = await db
    .select({ c: iamCertifications, id: iamCertificationItems.id })
    .from(iamCertificationItems)
    .innerJoin(iamCertifications, eq(iamCertifications.id, iamCertificationItems.certificationId))
    .where(and(eq(iamCertificationItems.reviewerId, userId), isNull(iamCertificationItems.decision), eq(iamCertifications.status, "open")));
  const by = new Map<string, { cert: typeof iamCertifications.$inferSelect; n: number }>();
  for (const r of rows) by.set(r.c.id, { cert: r.c, n: (by.get(r.c.id)?.n ?? 0) + 1 });
  return [...by.values()];
}

export function accessReviewRoutes(db: Db, config: Config) {
  const loadCert = async (c: Ctx, id: string) => {
    const [x] = await db.select().from(iamCertifications).where(eq(iamCertifications.id, id));
    assertScope(c, x?.companyId, "Recertifikace nenalezena");
    return x!;
  };

  async function items(c: Ctx, certIds: string[]) {
    if (!certIds.length) return [];
    return db
      .select({ i: iamCertificationItems, g: iamGrants, p: iamPeople, r: iamResources, certId: iamCertificationItems.certificationId })
      .from(iamCertificationItems)
      .innerJoin(iamGrants, eq(iamGrants.id, iamCertificationItems.grantId))
      .innerJoin(iamPeople, eq(iamPeople.id, iamGrants.personId))
      .innerJoin(iamResources, eq(iamResources.id, iamGrants.resourceId))
      .where(inArray(iamCertificationItems.certificationId, certIds))
      .orderBy(asc(iamResources.name), asc(iamPeople.lastName));
  }
  type ItemRow = Awaited<ReturnType<typeof items>>[number];

  const canDecide = (c: Ctx, cert: typeof iamCertifications.$inferSelect, x: ItemRow) => {
    const me = currentUser(c);
    if (cert.status !== "open" || x.i.revokeRequestId) return false;
    if (x.p.email && lower(x.p.email) === lower(me.email)) return false;
    return x.i.reviewerId ? x.i.reviewerId === me.id : hasPermIn(c, "access:manage", cert.companyId);
  };

  async function certDtos(c: Ctx, certs: (typeof iamCertifications.$inferSelect)[]): Promise<CertificationDto[]> {
    const all = await items(c, certs.map((x) => x.id));
    const resNames = new Map((await db.select({ id: iamResources.id, n: iamResources.name }).from(iamResources).where(inArray(iamResources.id, certs.map((x) => x.resourceId).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])))).map((r) => [r.id, r.n]));
    const today = todayIso();
    return certs.map((cert) => {
      const its = all.filter((x) => x.certId === cert.id);
      const pr = certProgress(its.map((x) => x.i));
      return {
        id: cert.id,
        companyId: cert.companyId,
        name: cert.name,
        reviewer: cert.reviewer as CertificationDto["reviewer"],
        resourceId: cert.resourceId,
        resourceName: cert.resourceId ? (resNames.get(cert.resourceId) ?? null) : null,
        privilegedOnly: cert.privilegedOnly,
        dueDate: cert.dueDate,
        status: cert.status as CertificationDto["status"],
        total: pr.total,
        decided: pr.decided,
        revoked: pr.revoked,
        mine: its.filter((x) => !x.i.decision && canDecide(c, cert, x)).length,
        overdue: cert.status === "open" && cert.dueDate < today,
        createdAt: cert.createdAt.toISOString(),
        closedAt: cert.closedAt?.toISOString() ?? null,
      };
    });
  }

  async function itemDtos(c: Ctx, cert: typeof iamCertifications.$inferSelect): Promise<CertItemDto[]> {
    const rows = await items(c, [cert.id]);
    const manage = hasPermIn(c, "access:manage", cert.companyId);
    const me = currentUser(c);
    const visible = rows.filter((x) => manage || x.i.reviewerId === me.id);
    const uids = [...new Set(visible.flatMap((x) => [x.i.reviewerId, x.i.decidedById]).filter((x): x is string => !!x))];
    const names = new Map((uids.length ? await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, uids)) : []).map((u) => [u.id, u.n]));
    const today = todayIso();
    return visible.map((x) => ({
      id: x.i.id,
      grantId: x.g.id,
      personName: fullName(x.p),
      personStatus: personStatus(x.p, today),
      department: x.p.department,
      resourceName: x.r.name,
      privileged: x.r.privileged,
      since: x.g.since,
      validUntil: x.g.validUntil,
      reviewerName: x.i.reviewerId ? (names.get(x.i.reviewerId) ?? null) : null,
      decision: x.i.decision as CertItemDto["decision"],
      comment: x.i.comment,
      decidedByName: x.i.decidedById ? (names.get(x.i.decidedById) ?? null) : null,
      decidedAt: x.i.decidedAt?.toISOString() ?? null,
      canDecide: canDecide(c, cert, x),
    }));
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "access"))
      /* ---- automatický import ---- */
      .get("/import-settings", requirePerm("access:manage"), async (c) => c.json(await importSettingsDto(db, config, targetCompany(c, c.req.query("companyId") ?? null, "access:manage"))))
      .put("/import-settings", requirePerm("access:manage"), zValidator("json", ImportSettingsInput), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        const v = c.req.valid("json");
        if (v.enabled && !v.fileName) throw new HTTPException(400, { message: "Není nastaven soubor pro import" });
        await db
          .insert(iamImportSettings)
          .values({ companyId, ...v })
          .onConflictDoUpdate({ target: iamImportSettings.companyId, set: { ...v, lastSha256: null, updatedAt: new Date() } });
        await audit(db, { c, user: currentUser(c), action: "access.import_settings", entityType: "iam_person", details: v });
        return c.json(await importSettingsDto(db, config, companyId));
      })
      .post("/import-settings/run", requirePerm("access:manage"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        // chyba se uloží k nastavení (lastError) – vrací se stav, ne chyba
        await runAutoImport(db, config, companyId, true, currentUser(c)).catch((e) => {
          if (!(e instanceof HTTPException) || e.status !== 422) throw e;
        });
        return c.json(await importSettingsDto(db, config, companyId));
      })

      /* ---- recertifikace ---- */
      .get("/certifications", requirePerm("access:request", "access:manage"), async (c) => {
        const me = currentUser(c);
        const certs = await db.select().from(iamCertifications).where(inScope(c, iamCertifications.companyId)).orderBy(desc(iamCertifications.createdAt));
        const mineIds = new Set(
          certs.length
            ? (await db.select({ id: iamCertificationItems.certificationId }).from(iamCertificationItems).where(and(inArray(iamCertificationItems.certificationId, certs.map((x) => x.id)), eq(iamCertificationItems.reviewerId, me.id)))).map((x) => x.id)
            : [],
        );
        return c.json(await certDtos(c, certs.filter((x) => hasPermIn(c, "access:manage", x.companyId) || mineIds.has(x.id))));
      })
      .post("/certifications", requirePerm("access:manage"), zValidator("json", CertificationInput), async (c) => {
        const v = c.req.valid("json");
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        if (v.dueDate < todayIso()) throw new HTTPException(400, { message: "Termín nesmí být v minulosti" });
        const conds: SQL[] = [eq(iamGrants.companyId, companyId), isNull(iamGrants.revokedAt)];
        if (v.resourceId) conds.push(eq(iamGrants.resourceId, v.resourceId));
        if (v.privilegedOnly) conds.push(eq(iamResources.privileged, true));
        const grants = await db.select({ g: iamGrants, p: iamPeople, r: iamResources }).from(iamGrants).innerJoin(iamPeople, eq(iamPeople.id, iamGrants.personId)).innerJoin(iamResources, eq(iamResources.id, iamGrants.resourceId)).where(and(...conds));
        if (!grants.length) throw new HTTPException(400, { message: "Žádná přidělená oprávnění k přezkumu" });
        const me = currentUser(c);
        const managerEmail = new Map((await db.select({ id: iamPeople.id, e: iamPeople.email }).from(iamPeople).where(eq(iamPeople.companyId, companyId))).map((p) => [p.id, p.e]));
        const reviewerOf = async (x: (typeof grants)[number]) => {
          let id: string | null = null;
          if (v.reviewer === "owner") id = x.r.ownerId;
          else if (x.p.managerId) id = await userByEmail(db, managerEmail.get(x.p.managerId) ?? null);
          // osoba nikdy nepřezkoumává vlastní přístup
          if (id && id === (await userByEmail(db, x.p.email))) id = null;
          return id;
        };
        const values: { grantId: string; reviewerId: string | null }[] = [];
        for (const x of grants) values.push({ grantId: x.g.id, reviewerId: await reviewerOf(x) });
        const cert = await db.transaction(async (tx) => {
          const [cert] = await tx.insert(iamCertifications).values({ ...v, companyId, createdById: me.id }).returning();
          await tx.insert(iamCertificationItems).values(values.map((x) => ({ ...x, certificationId: cert!.id })));
          return cert!;
        });
        await audit(db, { c, user: me, action: "access.certification_started", entityType: "iam_certification", entityId: cert.id, details: { name: v.name, items: values.length, reviewer: v.reviewer, dueDate: v.dueDate } });
        return c.json((await certDtos(c, [cert]))[0], 201);
      })
      .get("/certifications/:id", requirePerm("access:request", "access:manage"), async (c) => {
        const cert = await loadCert(c, c.req.param("id"));
        const its = await itemDtos(c, cert);
        if (!hasPermIn(c, "access:manage", cert.companyId) && !its.length) throw new HTTPException(404, { message: "Recertifikace nenalezena" });
        return c.json({ ...(await certDtos(c, [cert]))[0], items: its });
      })
      .post("/certifications/:id/items/:itemId", requirePerm("access:request", "access:manage"), zValidator("json", CertDecisionInput), async (c) => {
        const cert = await loadCert(c, c.req.param("id"));
        const [x] = (await items(c, [cert.id])).filter((r) => r.i.id === c.req.param("itemId"));
        if (!x) throw new HTTPException(404, { message: "Položka nenalezena" });
        if (!canDecide(c, cert, x)) throw new HTTPException(403, { message: "O této položce nerozhodujete" });
        const v = c.req.valid("json");
        if (v.decision === "revoke" && !v.comment) throw new HTTPException(400, { message: "Uveďte důvod odebrání" });
        const me = currentUser(c);
        let revokeRequestId: string | null = null;
        if (v.decision === "revoke") {
          const [open] = await db
            .select({ id: iamRequests.id })
            .from(iamRequests)
            .where(and(eq(iamRequests.personId, x.p.id), eq(iamRequests.resourceId, x.r.id), eq(iamRequests.action, "revoke"), inArray(iamRequests.status, ["pending", "approved"])));
          revokeRequestId =
            open?.id ??
            (await createRequest(db, { companyId: cert.companyId, person: x.p, resource: x.r, action: "revoke", origin: "review", justification: `Recertifikace „${cert.name}“: ${v.comment}`, validUntil: null, requestedById: me.id })).id;
        }
        await db.update(iamCertificationItems).set({ decision: v.decision, comment: v.comment, decidedById: me.id, decidedAt: new Date(), revokeRequestId }).where(eq(iamCertificationItems.id, x.i.id));
        await audit(db, { c, user: me, action: `access.certified_${v.decision}`, entityType: "iam_certification", entityId: cert.id, details: { person: fullName(x.p), resource: x.r.name, comment: v.comment } });
        return c.json({ ...(await certDtos(c, [cert]))[0], items: await itemDtos(c, cert) });
      })
      .post("/certifications/:id/close", requirePerm("access:manage"), async (c) => {
        const cert = await loadCert(c, c.req.param("id"));
        if (!hasPermIn(c, "access:manage", cert.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        if (cert.status !== "open") throw new HTTPException(409, { message: "Recertifikace je už uzavřená" });
        await db.update(iamCertifications).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(iamCertifications.id, cert.id));
        const [dto] = await certDtos(c, [{ ...cert, status: "closed" }]);
        await audit(db, { c, user: currentUser(c), action: "access.certification_closed", entityType: "iam_certification", entityId: cert.id, details: { total: dto!.total, decided: dto!.decided, revoked: dto!.revoked } });
        return c.json((await certDtos(c, [await loadCert(c, cert.id)]))[0]);
      })
      /** Protokol pro auditora (CSV, středník, UTF-8 s BOM). */
      .get("/certifications/:id/export.csv", requirePerm("access:manage"), async (c) => {
        const cert = await loadCert(c, c.req.param("id"));
        if (!hasPermIn(c, "access:manage", cert.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const its = await itemDtos(c, cert);
        const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
        const head = ["Osoba", "Útvar", "Oprávnění", "Privilegované", "Přiděleno od", "Platnost do", "Posuzovatel", "Rozhodnutí", "Komentář", "Rozhodl", "Kdy"];
        const lines = its.map((i) => [i.personName, i.department, i.resourceName, i.privileged ? "ano" : "ne", i.since, i.validUntil, i.reviewerName ?? "správce přístupů", i.decision === "keep" ? "ponechat" : i.decision === "revoke" ? "odebrat" : "nerozhodnuto", i.comment, i.decidedByName, i.decidedAt?.slice(0, 16).replace("T", " ")].map(q).join(";"));
        const body = `﻿${head.map(q).join(";")}\r\n${lines.join("\r\n")}\r\n`;
        return new Response(body, {
          headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="recertifikace-${cert.dueDate}.csv"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" },
        });
      })
  );
}
