import { defaultAssetClass, type AssetType } from "@contix/shared";
import { createAdmin, ensureSystemRoles, hashPassword, roleIdByKey, userCount } from "../auth/service";
import { db, sqlClient } from "./client";
import { assetLinks, assets, assetSources, groupMembers, groupRoles, groups, userRoles, users } from "./schema";

/** Ukázková data pro lokální vývoj. */
await ensureSystemRoles(db);

if ((await userCount(db)) === 0) {
  const admin = await createAdmin(db, "admin@contix.local", "Administrátor");
  console.log(`✔ admin@contix.local – dočasné heslo: ${admin!.generatedPassword}`);

  const demoPw = "Contix-Demo-2026!";
  const mk = async (email: string, displayName: string, jobTitle: string, roleKey: string) => {
    const [u] = await db
      .insert(users)
      .values({ email, displayName, jobTitle, passwordHash: await hashPassword(demoPw), mustChangePassword: false })
      .returning();
    await db.insert(userRoles).values({ userId: u!.id, roleId: (await roleIdByKey(db, roleKey))!, source: "manual" });
    return u!;
  };
  const ciso = await mk("ciso@contix.local", "Jana Bezpečná", "CISO", "ciso");
  await mk("auditor@contix.local", "Petr Kontrola", "Interní auditor", "auditor");
  const owner = await mk("vlastnik@contix.local", "Eva Personální", "Vedoucí HR", "asset_owner");
  const [g] = await db.insert(groups).values({ name: "Bezpečnostní výbor", description: "Členové výboru pro KB" }).returning();
  await db.insert(groupMembers).values([{ groupId: g!.id, userId: ciso.id }]);
  await db.insert(groupRoles).values({ groupId: g!.id, roleId: (await roleIdByKey(db, "auditor"))! });
  console.log(`✔ demo uživatelé ciso@ / auditor@ / vlastnik@contix.local – heslo: ${demoPw}`);

  if ((await db.select({ id: assets.id }).from(assets).limit(1)).length === 0) {
    const demo: { name: string; assetType: AssetType; [k: string]: unknown }[] = [
      { name: "Personální agenda", assetType: "information_asset", description: "Osobní spisy, mzdy, docházka", criticality: "high", confidentiality: 4, integrity: 3, availability: 2, ownerUserId: owner.id, tags: ["GDPR"] },
      { name: "Elektronická spisová služba", assetType: "business_service", criticality: "critical", confidentiality: 3, integrity: 4, availability: 4, ownerUserId: ciso.id, tags: ["NIS2"] },
      { name: "SRV-DC01", assetType: "server", hostname: "srv-dc01", ipAddresses: ["10.0.0.10"], osName: "Windows Server 2022", criticality: "critical", environment: "production", ownerName: "IT provoz", tags: ["AD"] },
      { name: "SRV-DB01", assetType: "database", hostname: "srv-db01", ipAddresses: ["10.0.0.20"], osName: "Ubuntu 24.04", criticality: "high", confidentiality: 2, environment: "production", ownerName: "Aplikační podpora" },
      { name: "FW-EDGE-01", assetType: "security_device", ipAddresses: ["10.0.0.1"], manufacturer: "Fortinet", model: "FortiGate 100F", criticality: "critical", environment: "production", ownerName: "Síťový tým" },
      { name: "Dodavatel mzdového SW", assetType: "supplier", criticality: "medium", ownerUserId: owner.id },
    ];
    const ids: Record<string, string> = {};
    for (const a of demo) {
      const [row] = await db
        .insert(assets)
        .values({ ...(a as any), assetClass: defaultAssetClass(a.assetType) })
        .returning({ id: assets.id });
      ids[a.name] = row!.id;
      await db.insert(assetSources).values({ assetId: row!.id, sourceType: "manual", sourceRef: row!.id });
    }
    await db.insert(assetLinks).values([
      { primaryId: ids["Personální agenda"]!, supportingId: ids["SRV-DB01"]!, note: "mzdová databáze" },
      { primaryId: ids["Personální agenda"]!, supportingId: ids["Dodavatel mzdového SW"]! },
      { primaryId: ids["Elektronická spisová služba"]!, supportingId: ids["SRV-DB01"]! },
      { primaryId: ids["Elektronická spisová služba"]!, supportingId: ids["SRV-DC01"]! },
      { primaryId: ids["Elektronická spisová služba"]!, supportingId: ids["FW-EDGE-01"]! },
    ]);
    console.log(`✔ vloženo ${demo.length} ukázkových aktiv s vazbami`);
  }
} else {
  console.log("Databáze už obsahuje uživatele – seed přeskočen (systémové role aktualizovány).");
}
await sqlClient.end();
