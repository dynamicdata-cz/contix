import { and, eq, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { policyEditSessions, policyEvents, policyFiles, policyVersions, users } from "../../db/schema";
import { audit } from "../../auth/service";
import { processFile } from "./convert";
import { mimeFor } from "./mime";
import { officeAppOf } from "@contix/shared";

/* ============================================================
 * Úpravy v desktopovém Office (ADR-026): Word / Excel / PowerPoint otevře soubor přes WebDAV
 * z odkazu ms-word:ofe|u|https://…/dav/<token>/<soubor>. Token v cestě je jediné oprávnění
 * (Office neposílá cookies prohlížeče) – náhodný, vázaný na uživatele, soubor a rezervaci verze,
 * s omezenou platností; ukládá se jen jeho SHA-256. Uložení (Ctrl+S) = nová revize souboru.
 * ============================================================ */

const FILE_MAX = 25 * 1024 * 1024;
const EDIT_TTL_H = 10;
const VIEW_TTL_H = 2;
const MAX_TTL_H = 24;
const LOCK_MAX_S = 3600;

type Session = typeof policyEditSessions.$inferSelect;
type FileRow = typeof policyFiles.$inferSelect;

const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

export async function createOfficeSession(db: Db, s: { policyId: string; versionId: string; fileId: string; userId: string; mode: "edit" | "view" }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (s.mode === "edit" ? EDIT_TTL_H : VIEW_TTL_H) * 3600_000);
  // jedna otevřená úprava souboru na uživatele – starší odkazy přestanou platit
  if (s.mode === "edit")
    await db
      .update(policyEditSessions)
      .set({ closedAt: new Date() })
      .where(and(eq(policyEditSessions.fileId, s.fileId), eq(policyEditSessions.userId, s.userId), eq(policyEditSessions.mode, "edit"), isNull(policyEditSessions.closedAt)));
  await db.insert(policyEditSessions).values({ ...s, tokenHash: sha(token), expiresAt });
  return { token, expiresAt };
}

/** Ukončí relace Office k verzi (check-in, zrušení rezervace, předložení, schválení). */
export async function closeOfficeSessions(db: Db, versionId: string) {
  await db.update(policyEditSessions).set({ closedAt: new Date() }).where(and(eq(policyEditSessions.versionId, versionId), isNull(policyEditSessions.closedAt)));
}

/** Aktuální revize souboru: otevřený soubor, nebo jeho nejnovější náhrada (nahraná třeba přes prohlížeč). */
async function headOf(db: Db, versionId: string, fileId: string): Promise<FileRow | null> {
  const files = await db.select().from(policyFiles).where(eq(policyFiles.versionId, versionId));
  let cur = files.find((f) => f.id === fileId);
  for (let i = 0; cur && cur.supersededAt && i < 1000; i++) cur = files.find((f) => f.replacesId === cur!.id);
  return cur && !cur.supersededAt ? cur : null;
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function lockXml(token: string, owner: string, expiresAt: Date) {
  const sec = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 1000));
  return `<D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth><D:owner>${xmlEsc(owner)}</D:owner><D:timeout>Second-${sec}</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery>`;
}

function fileProps(href: string, f: FileRow, s: Session, owner: string) {
  const locked = s.lockToken && s.lockExpiresAt && s.lockExpiresAt > new Date();
  return `<D:response><D:href>${href}</D:href><D:propstat><D:prop>
<D:displayname>${xmlEsc(f.filename)}</D:displayname>
<D:getcontentlength>${f.size}</D:getcontentlength>
<D:getcontenttype>${xmlEsc(mimeFor(f.filename))}</D:getcontenttype>
<D:getlastmodified>${f.uploadedAt.toUTCString()}</D:getlastmodified>
<D:creationdate>${f.uploadedAt.toISOString()}</D:creationdate>
<D:getetag>"${f.sha256.slice(0, 32)}"</D:getetag>
<D:resourcetype/>
<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>
${locked ? lockXml(s.lockToken!, owner, s.lockExpiresAt!) : "<D:lockdiscovery/>"}
</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

const folderProps = (href: string) =>
  `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:displayname>CONTIX</D:displayname><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;

const multistatus = (body: string) =>
  new Response(`<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">${body}</D:multistatus>`, { status: 207, headers: { "content-type": 'application/xml; charset="utf-8"' } });

const DAV_HEADERS = { DAV: "1,2", "MS-Author-Via": "DAV", Allow: "OPTIONS, GET, HEAD, PUT, PROPFIND, PROPPATCH, LOCK, UNLOCK" };

export function davRoutes(db: Db, _config: Config) {
  /** Platná relace podle tokenu z cesty; posune platnost při aktivitě (max. 24 h od otevření). */
  async function sessionOf(token: string): Promise<Session | null> {
    if (!/^[\w-]{40,60}$/.test(token)) return null;
    const [s] = await db.select().from(policyEditSessions).where(eq(policyEditSessions.tokenHash, sha(token)));
    const now = new Date();
    if (!s || s.closedAt || s.expiresAt <= now) return null;
    const [v] = await db.select({ status: policyVersions.status, lockedById: policyVersions.lockedById }).from(policyVersions).where(eq(policyVersions.id, s.versionId));
    if (!v) return null;
    // úprava platí jen pro návrh rezervovaný tímto uživatelem
    if (s.mode === "edit" && (v.status !== "draft" || v.lockedById !== s.userId)) {
      await db.update(policyEditSessions).set({ closedAt: now }).where(eq(policyEditSessions.id, s.id));
      return null;
    }
    const ttl = (s.mode === "edit" ? EDIT_TTL_H : VIEW_TTL_H) * 3600_000;
    const expiresAt = new Date(Math.min(now.getTime() + ttl, s.createdAt.getTime() + MAX_TTL_H * 3600_000));
    await db.update(policyEditSessions).set({ lastActivityAt: now, expiresAt: expiresAt > s.expiresAt ? expiresAt : s.expiresAt }).where(eq(policyEditSessions.id, s.id));
    return s;
  }

  async function userOf(id: string) {
    const [u] = await db.select({ id: users.id, email: users.email, displayName: users.displayName }).from(users).where(eq(users.id, id));
    return u ?? null;
  }

  /** Uložení z Office: první uložení v relaci = nová revize, další uložení ji přepíší (stále jde o rozpracovaný návrh). */
  async function save(c: Context, s: Session, buf: Uint8Array) {
    const u = await userOf(s.userId);
    const digest = sha(buf);
    const prev = s.revisionFileId ? (await db.select().from(policyFiles).where(eq(policyFiles.id, s.revisionFileId)))[0] : null;
    let fileId: string;
    if (prev && !prev.supersededAt) {
      if (prev.sha256 === digest) return; // beze změny
      await db
        .update(policyFiles)
        .set({ content: Buffer.from(buf), size: buf.length, sha256: digest, uploadedAt: new Date(), pdfStatus: "pending", pdf: null, pdfError: null, pdfAt: null, text: null, searchText: null })
        .where(eq(policyFiles.id, prev.id));
      fileId = prev.id;
    } else {
      const base = await headOf(db, s.versionId, s.fileId);
      if (base?.sha256 === digest) return; // Office ukládá i nezměněný soubor
      if (base) await db.update(policyFiles).set({ supersededAt: new Date() }).where(eq(policyFiles.id, base.id));
      const [row] = await db
        .insert(policyFiles)
        .values({
          versionId: s.versionId,
          filename: base?.filename ?? "dokument.docx",
          mime: base?.mime ?? "application/octet-stream",
          size: buf.length,
          sha256: digest,
          content: Buffer.from(buf),
          uploadedById: s.userId,
          revision: (base?.revision ?? 0) + 1,
          replacesId: base?.id ?? null,
          note: "Uloženo z desktopového Office",
        })
        .returning({ id: policyFiles.id, filename: policyFiles.filename, revision: policyFiles.revision });
      fileId = row!.id;
      await db.insert(policyEvents).values({ versionId: s.versionId, action: "office_save", fromStatus: "draft", toStatus: "draft", userId: s.userId, note: `${row!.filename} (rev. ${row!.revision})` });
    }
    await db.update(policyEditSessions).set({ revisionFileId: fileId, saves: s.saves + 1, lastSavedAt: new Date() }).where(eq(policyEditSessions.id, s.id));
    await db.update(policyVersions).set({ updatedAt: new Date() }).where(eq(policyVersions.id, s.versionId));
    void processFile(db, fileId).catch(() => {});
    await audit(db, { c, user: u, action: "policy.office_saved", entityType: "policy", entityId: s.policyId, details: { fileId, size: buf.length } });
  }

  const notFound = () => new Response(null, { status: 404 });

  const handler = async (c: Context) => {
    const method = c.req.method.toUpperCase();
    const token = c.req.param("token")!;
    const name = c.req.param("name");
    if (method === "OPTIONS") return new Response(null, { status: 200, headers: { ...DAV_HEADERS, "content-length": "0" } });
    const s = await sessionOf(token);
    if (!s) return notFound();
    const f = await headOf(db, s.versionId, s.revisionFileId ?? s.fileId);
    if (!f || !officeAppOf(f.filename)) return notFound();
    // cesta musí končit názvem souboru (Office podle přípony volí aplikaci); jinak jde o „složku“ s tokenem
    const dec = (x: string) => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    };
    const isFile = !!name && (name === f.filename || dec(name) === f.filename);
    if (name && !isFile) return notFound();
    const folderHref = `/dav/${token}/`;
    const fileHref = `${folderHref}${encodeURIComponent(f.filename)}`;
    const owner = (await userOf(s.userId))?.displayName ?? "CONTIX";

    switch (method) {
      case "HEAD":
      case "GET":
        if (!isFile) return notFound();
        if (method === "GET") await audit(db, { c, user: await userOf(s.userId), action: s.mode === "edit" ? "policy.office_opened" : "policy.office_viewed", entityType: "policy", entityId: s.policyId, details: { fileId: f.id } });
        return new Response(method === "HEAD" ? null : new Uint8Array(f.content), {
          headers: {
            // typ podle přípony + příloha + sandbox: odkaz otevřený v prohlížeči nesmí nic vykonat (jen Office si soubor stáhne)
            "content-type": mimeFor(f.filename),
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
            "content-security-policy": "sandbox; default-src 'none'",
            "x-content-type-options": "nosniff",
            "content-length": String(f.size),
            etag: `"${f.sha256.slice(0, 32)}"`,
            "last-modified": f.uploadedAt.toUTCString(),
            "cache-control": "private, no-store",
            ...DAV_HEADERS,
          },
        });
      case "PROPFIND": {
        const depth = c.req.header("depth") ?? "infinity";
        if (isFile) return multistatus(fileProps(fileHref, f, s, owner));
        return multistatus(folderProps(folderHref) + (depth === "0" ? "" : fileProps(fileHref, f, s, owner)));
      }
      case "PROPPATCH":
        // Office / Windows nastavují vlastní vlastnosti (Win32 atributy) – přijmeme je bez uložení
        return multistatus(`<D:response><D:href>${isFile ? fileHref : folderHref}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`);
      case "LOCK": {
        if (s.mode !== "edit" || !isFile) return new Response(null, { status: 403 });
        const now = new Date();
        const want = Number(c.req.header("timeout")?.match(/Second-(\d+)/i)?.[1] ?? LOCK_MAX_S);
        const expiresAt = new Date(now.getTime() + Math.min(Math.max(want, 60), LOCK_MAX_S) * 1000);
        const held = s.lockToken && s.lockExpiresAt && s.lockExpiresAt > now;
        const ifHeader = c.req.header("if") ?? "";
        let lockToken = s.lockToken;
        if (held && !ifHeader.includes(s.lockToken!)) {
          // nový LOCK při platném zámku: stejný uživatel znovu otevřel soubor – převezme zámek (jinak by Office ukázal „zamčeno“)
          lockToken = `opaquelocktoken:${randomUUID()}`;
        } else if (!held) lockToken = `opaquelocktoken:${randomUUID()}`;
        await db.update(policyEditSessions).set({ lockToken, lockExpiresAt: expiresAt }).where(eq(policyEditSessions.id, s.id));
        return new Response(`<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:">${lockXml(lockToken!, owner, expiresAt)}</D:prop>`, {
          status: 200,
          headers: { "content-type": 'application/xml; charset="utf-8"', "lock-token": `<${lockToken}>` },
        });
      }
      case "UNLOCK":
        if (s.mode === "edit") await db.update(policyEditSessions).set({ lockToken: null, lockExpiresAt: null }).where(eq(policyEditSessions.id, s.id));
        return new Response(null, { status: 204 });
      case "PUT": {
        if (s.mode !== "edit" || !isFile) return new Response(null, { status: 403 });
        if (Number(c.req.header("content-length") ?? 0) > FILE_MAX) return new Response(null, { status: 413 });
        const buf = new Uint8Array(await c.req.arrayBuffer());
        if (buf.length > FILE_MAX) return new Response(null, { status: 413 });
        if (!buf.length) return new Response(null, { status: 204 }); // Office někdy ověřuje zápis prázdným PUT
        await save(c, s, buf);
        return new Response(null, { status: 204, headers: DAV_HEADERS });
      }
      default:
        // MKCOL, DELETE, MOVE, COPY – v CONTIXu se soubory nemažou ani nepřesouvají z Office
        return new Response(null, { status: 403 });
    }
  };
  // „/dav/<token>/“ je složka, „/dav/<token>/<soubor>“ soubor (Office prochází obojí)
  return new Hono().all("/:token", handler).all("/:token/", handler).all("/:token/:name", handler);
}
