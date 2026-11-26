/**
 * Požadavek na kvalifikaci pracovníků dodavatele (v1.112, ADR-204): např. „CCNA alespoň u 2 pracovníků“.
 * Vyhodnocuje se proti Certifikátům pracovníků u dodavatele (ruční zápis i dotazník dodavatele).
 */
import { evaluateQualification, type SupplierQualificationDto } from "@contix/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { personCertificates, suppliers } from "../../db/schema";

export async function qualificationOf(db: Db, supplierIds: string[], today = new Date().toISOString().slice(0, 10)): Promise<Map<string, SupplierQualificationDto>> {
  const out = new Map<string, SupplierQualificationDto>();
  if (!supplierIds.length) return out;
  const sups = await db.select({ id: suppliers.id, reqs: suppliers.certRequirements }).from(suppliers).where(inArray(suppliers.id, supplierIds));
  const withReqs = sups.filter((s) => (s.reqs ?? []).length > 0);
  const certs = withReqs.length
    ? await db
        .select({ supplierId: personCertificates.supplierId, name: personCertificates.name, holder: sql<string>`coalesce(${personCertificates.holderName}, '')`, validUntil: personCertificates.validUntil })
        .from(personCertificates)
        .where(inArray(personCertificates.supplierId, withReqs.map((s) => s.id)))
    : [];
  for (const s of sups)
    out.set(
      s.id,
      evaluateQualification(
        s.reqs ?? [],
        certs.filter((c) => c.supplierId === s.id).map((c) => ({ name: c.name, holder: c.holder || "?", validUntil: c.validUntil })),
        today,
      ),
    );
  return out;
}

/** Aktivní dodavatelé s požadavky v daných společnostech (pro povinnosti). */
export async function suppliersWithRequirements(db: Db, companyIds: string[]) {
  if (!companyIds.length) return [];
  return db
    .select({ id: suppliers.id, name: suppliers.name, companyId: suppliers.companyId })
    .from(suppliers)
    .where(and(inArray(suppliers.companyId, companyIds), eq(suppliers.status, "active"), sql`jsonb_array_length(${suppliers.certRequirements}) > 0`));
}
