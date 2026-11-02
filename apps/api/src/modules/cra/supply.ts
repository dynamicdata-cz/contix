import { cpeQuery, cpeRef, csafFindingsFor, csafRef, NVD_DEFAULTS, parseNvdCves, type CsafAdvisory, type NvdSettings, type VexJustification, type VexStatus } from "@contix/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { appSettings, craAdvisories, craFindings, craProducts } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";

/* ============================================================
 * CRA – dovozce / distributor (v1.16, ADR-113): zranitelnosti produktů bez SBOM.
 * Oznámení výrobce CSAF jen z nahraného souboru → `matchAdvisories` (nálezy source = csaf, odkaz `csafRef`).
 * NVD jen na pokyn uživatele a jen když je výslovně zapnuto (`cra.nvd`) – odchází pouze řetězec CPE.
 * Stav výrobce `vendor_status`; vlastní hodnocení (`status`) se při novém oznámení nepřepíše, pokud se od výrobce liší.
 * ============================================================ */

type ProductRow = typeof craProducts.$inferSelect;

/** Zápis nálezu z externího zdroje: nový = stav výrobce, existující = aktualizace a stav jen pokud ho člověk nezměnil. */
async function upsertFinding(
  db: Db,
  p: ProductRow,
  ref: string,
  source: "csaf" | "nvd",
  x: { vulnId: string; aliases: string[]; summary: string | null; severity: string | null; status: VexStatus; justification: VexJustification | null; action: string | null },
) {
  const [cur] = await db.select().from(craFindings).where(and(eq(craFindings.productId, p.id), eq(craFindings.componentRef, ref), eq(craFindings.vulnId, x.vulnId)));
  const now = new Date();
  if (!cur) {
    await db.insert(craFindings).values({
      companyId: p.companyId,
      productId: p.id,
      componentRef: ref,
      vulnId: x.vulnId,
      aliases: x.aliases,
      summary: x.summary,
      severity: x.severity,
      source,
      status: x.status,
      vendorStatus: source === "csaf" ? x.status : null,
      justification: x.justification,
      actionStatement: x.action,
    });
    return;
  }
  const follows = source === "csaf" && (cur.vendorStatus == null ? cur.status === "under_investigation" : cur.status === cur.vendorStatus);
  await db
    .update(craFindings)
    .set({
      aliases: x.aliases,
      summary: x.summary,
      severity: x.severity,
      gone: false,
      ...(source === "csaf" ? { vendorStatus: x.status } : {}),
      ...(follows ? { status: x.status, justification: x.justification, ...(x.action && !cur.actionStatement ? { actionStatement: x.action } : {}) } : {}),
      updatedAt: now,
    })
    .where(eq(craFindings.id, cur.id));
}

/** Napárování oznámení CSAF na produkty (po nahrání oznámení nebo změně produktu). */
export async function matchAdvisories(db: Db, opts: { companyIds?: string[]; productIds?: string[] }) {
  const products = await db
    .select()
    .from(craProducts)
    .where(opts.productIds ? inArray(craProducts.id, opts.productIds.length ? opts.productIds : ["00000000-0000-0000-0000-000000000000"]) : opts.companyIds ? inArray(craProducts.companyId, opts.companyIds) : undefined);
  if (!products.length) return { products: 0, matches: 0 };
  const companyIds = [...new Set(products.map((p) => p.companyId))];
  const advs = await db.select().from(craAdvisories).where(inArray(craAdvisories.companyId, companyIds));
  let matches = 0;
  for (const p of products) {
    const keep = new Set<string>();
    for (const a of advs.filter((x) => x.companyId === p.companyId)) {
      const data = a.data as unknown as CsafAdvisory;
      const ref = csafRef(a);
      for (const f of csafFindingsFor(p, data)) {
        await upsertFinding(db, p, ref, "csaf", f);
        keep.add(`${ref}|${f.vulnId}`);
        matches++;
      }
    }
    const existing = await db.select({ id: craFindings.id, ref: craFindings.componentRef, vulnId: craFindings.vulnId }).from(craFindings).where(and(eq(craFindings.productId, p.id), eq(craFindings.source, "csaf"), eq(craFindings.gone, false)));
    const gone = existing.filter((e) => !keep.has(`${e.ref}|${e.vulnId}`)).map((e) => e.id);
    if (gone.length) await db.update(craFindings).set({ gone: true, updatedAt: new Date() }).where(inArray(craFindings.id, gone));
  }
  return { products: products.length, matches };
}

/** Po smazání oznámení: jeho nálezy zmizí (nemažou se – historie VEX zůstane). */
export async function retireAdvisory(db: Db, a: { companyId: string; namespace: string; trackingId: string }) {
  const ref = csafRef(a);
  const ids = (await db.select({ id: craProducts.id }).from(craProducts).where(eq(craProducts.companyId, a.companyId))).map((x) => x.id);
  if (ids.length) await db.update(craFindings).set({ gone: true, updatedAt: new Date() }).where(and(inArray(craFindings.productId, ids), eq(craFindings.componentRef, ref)));
}

/* ---------------- NVD ---------------- */

const NVD_KEY = "cra.nvd";
export async function getNvdSettings(db: Db): Promise<NvdSettings> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, NVD_KEY));
  return { ...NVD_DEFAULTS, ...((r?.value as Partial<NvdSettings>) ?? {}) };
}
export async function storeNvdSettings(db: Db, v: NvdSettings) {
  await db.insert(appSettings).values({ key: NVD_KEY, value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
  return v;
}

const NVD_PAGE = 2000;
const NVD_MAX_PAGES = 5;

/** Dohledání CVE podle CPE produktu v NVD (jen GET; do NVD odchází jen řetězec CPE). */
export async function nvdLookup(db: Db, p: ProductRow, fetchImpl: FetchLike = fetch as FetchLike) {
  const s = await getNvdSettings(db);
  if (!s.enabled) throw new Error("disabled");
  const q = p.cpe ? cpeQuery(p.cpe, p.version) : null;
  if (!q) throw new Error("no_cpe");
  const found: { id: string; summary: string | null; severity: string | null }[] = [];
  let total = 0;
  for (let page = 0; page < NVD_MAX_PAGES; page++) {
    const url = `${s.baseUrl}?virtualMatchString=${encodeURIComponent(q)}&resultsPerPage=${NVD_PAGE}&startIndex=${page * NVD_PAGE}`;
    const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } } as never);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = parseNvdCves(await res.json());
    total = r.total;
    found.push(...r.items);
    if (found.length >= total || !r.items.length) break;
  }
  const ref = cpeRef(q);
  for (const x of found) await upsertFinding(db, p, ref, "nvd", { vulnId: x.id, aliases: [], summary: x.summary, severity: x.severity, status: "under_investigation", justification: null, action: null });
  // CVE, které NVD pro CPE už nevrací (opravené přiřazení), se označí jako zmizelé
  const ids = new Set(found.map((x) => x.id));
  const existing = await db.select({ id: craFindings.id, vulnId: craFindings.vulnId, ref: craFindings.componentRef }).from(craFindings).where(and(eq(craFindings.productId, p.id), eq(craFindings.source, "nvd"), eq(craFindings.gone, false)));
  const gone = existing.filter((e) => e.ref !== ref || !ids.has(e.vulnId)).map((e) => e.id);
  if (gone.length) await db.update(craFindings).set({ gone: true, updatedAt: new Date() }).where(inArray(craFindings.id, gone));
  return { query: q, found: found.length, total, truncated: total > found.length };
}
