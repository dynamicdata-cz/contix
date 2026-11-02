/**
 * Ukázková data – fiktivní společnost pro vyzkoušení CONTIXu (v1.15, ADR-112).
 * Vše se zakládá přes API (stejné validace, oprávnění a audit jako z UI), do samostatné společnosti skupiny,
 * aby šla ukázka kdykoli odlišit od skutečných dat. Žádné skutečné osoby, firmy ani adresy.
 */

export const DEMO_COMPANY_NAME = "Vzorová strojírna a.s. (ukázka)";

export type DemoCall = (method: "GET" | "POST" | "PUT", path: string, body?: unknown) => Promise<{ status: number; body: any }>;

export interface DemoResult {
  created: boolean;
  companyId: string | null;
  counts: Record<string, number>;
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/**
 * `call` musí volat API jako přihlášený administrátor; `withCompany` vrací stejné volání s hlavičkou společnosti.
 * Opakované spuštění nic nezaloží (ukázková společnost už existuje).
 */
export async function seedDemo(call: DemoCall, withCompany: (companyId: string) => DemoCall, log: (m: string) => void = () => {}): Promise<DemoResult> {
  const counts: Record<string, number> = {};
  const ok = async (r: Promise<{ status: number; body: any }>, what: string) => {
    const res = await r;
    if (res.status >= 300) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`);
    counts[what] = (counts[what] ?? 0) + 1;
    return res.body;
  };

  const companies = await call("GET", "/api/companies");
  if (companies.status !== 200) throw new Error(`Seznam společností: HTTP ${companies.status} – je účet administrátor s dokončeným přihlášením?`);
  const existing = (companies.body as any[]).find((x) => x.name === DEMO_COMPANY_NAME);
  if (existing) return { created: false, companyId: existing.id, counts };

  const company = await ok(call("POST", "/api/companies", { name: DEMO_COMPANY_NAME, regime: "lower" }), "společnost");
  const api = withCompany(company.id);
  log(`Společnost ${DEMO_COMPANY_NAME}`);

  // organizace a funkční místa (odpovědnost vede na místa, ne na osoby)
  const root = await ok(api("POST", "/api/org/units", { name: "Vzorová strojírna a.s.", unitType: "organization" }), "útvar");
  const unit = async (name: string, code: string) => (await ok(api("POST", "/api/org/units", { name, code, parentId: root.id }), "útvar")).id as string;
  const uIt = await unit("Útvar informatiky", "IT");
  const uVyr = await unit("Výroba", "VYR");
  const uHr = await unit("Personální oddělení", "HR");
  const uEko = await unit("Ekonomický úsek", "EKO");
  const pos = async (orgUnitId: string, name: string) => (await ok(api("POST", "/api/org/positions", { orgUnitId, name }), "funkční místo")).id as string;
  const pMkb = await pos(uIt, "Manažer kybernetické bezpečnosti");
  const pIt = await pos(uIt, "Vedoucí informatiky");
  const pVyr = await pos(uVyr, "Vedoucí výroby");
  const pHr = await pos(uHr, "Vedoucí personálního oddělení");
  const pEko = await pos(uEko, "Ekonomický ředitel");

  // aktiva: primární (služby, informace) a podpůrná (technika, dodavatelé); adresy z dokumentačního rozsahu
  const asset = async (a: Record<string, unknown>) => (await ok(api("POST", "/api/assets", a), "aktivum")).id as string;
  const aMes = await asset({ name: "Řízení výroby (MES)", assetType: "business_service", criticality: "critical", confidentiality: 2, integrity: 4, availability: 4, description: "Plánování a evidence výroby na zakázku" });
  const aErp = await asset({ name: "Účetnictví a fakturace", assetType: "business_service", criticality: "high", confidentiality: 3, integrity: 4, availability: 3 });
  const aHr = await asset({ name: "Personální a mzdová agenda", assetType: "information_asset", criticality: "high", confidentiality: 4, integrity: 3, availability: 2, tags: ["GDPR"] });
  const sMes = await asset({ name: "SRV-MES01", assetType: "server", hostname: "srv-mes01", ipAddresses: ["192.0.2.10"], osName: "Windows Server 2022", criticality: "critical", environment: "production" });
  const sErp = await asset({ name: "SRV-ERP01", assetType: "server", hostname: "srv-erp01", ipAddresses: ["192.0.2.20"], osName: "Ubuntu 24.04", criticality: "high", environment: "production" });
  const sDb = await asset({ name: "DB-ERP01", assetType: "database", hostname: "db-erp01", ipAddresses: ["192.0.2.21"], criticality: "high", environment: "production" });
  const sFw = await asset({ name: "FW-01", assetType: "security_device", ipAddresses: ["192.0.2.1"], criticality: "critical", environment: "production" });
  const sNas = await asset({ name: "NAS-ZAL01", assetType: "storage", hostname: "nas-zal01", ipAddresses: ["192.0.2.30"], criticality: "high", environment: "production", description: "Úložiště záloh (offline kopie týdně)" });
  const sPlc = await asset({ name: "Linka L1 – řídicí systém", assetType: "iot_ot", criticality: "critical", environment: "production" });
  const link = (primaryId: string, supportingId: string, note?: string) => ok(api("POST", "/api/assets/links", { primaryId, supportingId, note }), "vazba aktiv");
  await link(aMes, sMes);
  await link(aMes, sPlc, "řízení linky");
  await link(aMes, sFw);
  await link(aErp, sErp);
  await link(aErp, sDb, "databáze ERP");
  await link(aHr, sDb, "mzdová data");
  await link(aErp, sNas, "zálohy");

  // procesy
  const proc = async (p: Record<string, unknown>) => (await ok(api("POST", "/api/processes", p), "proces")).id as string;
  const prVyr = await proc({ code: "P-01", name: "Výroba na zakázku", processType: "core", criticality: "critical", ownerPositionId: pVyr, orgUnitId: uVyr, purpose: "Od přijetí objednávky po expedici výrobku" });
  const prMzdy = await proc({ code: "P-02", name: "Mzdové účetnictví", processType: "support", criticality: "high", ownerPositionId: pHr, orgUnitId: uHr });
  await proc({ code: "P-03", name: "Fakturace a pohledávky", processType: "support", criticality: "high", ownerPositionId: pEko, orgUnitId: uEko });
  await proc({ code: "P-04", name: "Správa IT a zálohování", processType: "support", criticality: "high", ownerPositionId: pIt, orgUnitId: uIt });

  // opatření
  const ctl = async (c: Record<string, unknown>) => (await ok(api("POST", "/api/controls", c), "opatření")).id as string;
  const cZal = await ctl({ name: "Zálohování 3-2-1 s pravidelným testem obnovy", status: "implemented", effectiveness: "effective", ownerPositionId: pIt, assetIds: [sNas, sDb] });
  const cMfa = await ctl({ name: "Vícefaktorové ověření pro vzdálený přístup a cloud", status: "implemented", effectiveness: "partially_effective", ownerPositionId: pIt });
  const cOt = await ctl({ name: "Oddělení výrobní sítě (OT) od kancelářské sítě", status: "planned", effectiveness: "not_assessed", ownerPositionId: pIt, assetIds: [sPlc, sFw] });
  const cSkol = await ctl({ name: "Školení bezpečnostního povědomí a cvičný phishing", status: "in_progress", effectiveness: "not_assessed", ownerPositionId: pMkb });
  const cPatch = await ctl({ name: "Správa záplat serverů do 30 dnů", status: "implemented", effectiveness: "partially_effective", ownerPositionId: pIt, assetIds: [sMes, sErp] });

  // rizika podle katalogu hrozeb a zranitelností vyhlášky (kódy H.. / Z..)
  const catalog = (await ok(api("GET", "/api/risks/catalog"), "katalog")) as { id: string; code: string; kind: string }[];
  const cat = (code: string) => catalog.find((x) => x.code === code)?.id ?? null;
  const risk = (r: Record<string, unknown>) => ok(api("POST", "/api/risks", r), "riziko");
  await risk({ code: "R-01", name: "Ransomware zastaví výrobu", threatId: cat("H05"), weaknessId: cat("Z02"), ownerPositionId: pMkb, impact: 3, threatLevel: 3, vulnLevel: 2, treatment: "mitigate", treatmentPlan: "Dokončit oddělení OT sítě, offline zálohy MES", treatmentDue: day(90), assetIds: [aMes, sMes, sPlc], processIds: [prVyr], controlIds: [cZal, cOt, cPatch] });
  await risk({ code: "R-02", name: "Převzetí účtu přes phishing", threatId: cat("H03"), weaknessId: cat("Z04"), ownerPositionId: pMkb, impact: 2, threatLevel: 3, vulnLevel: 2, treatment: "mitigate", treatmentDue: day(60), controlIds: [cMfa, cSkol] });
  await risk({ code: "R-03", name: "Výpadek napájení serverovny", threatId: cat("H07"), weaknessId: cat("Z01"), ownerPositionId: pIt, impact: 2, threatLevel: 1, vulnLevel: 2, treatment: "accept", assetIds: [sMes, sErp] });
  await risk({ code: "R-04", name: "Zneužití oprávnění k mzdovým datům", threatId: cat("H01"), weaknessId: cat("Z06"), ownerPositionId: pHr, impact: 3, threatLevel: 1, vulnLevel: 2, treatment: "mitigate", assetIds: [aHr, sDb], processIds: [prMzdy] });

  // dodavatelé, kontinuita, dokumentace, incident, cíle, úkoly
  await ok(api("POST", "/api/suppliers", { name: "Ukázkový dodavatel ERP s.r.o.", supplyDescription: "Provoz a podpora systému ERP", significant: true, significanceReason: "Podpora systému fakturace a mezd" }), "dodavatel");
  await ok(api("POST", "/api/suppliers", { name: "Vzorový cloud pro zálohy s.r.o.", supplyDescription: "Kopie záloh mimo areál" }), "dodavatel");
  await ok(api("POST", "/api/continuity-plans", { name: "Plán obnovy řízení výroby", planType: "recovery", processIds: [prVyr] }), "plán kontinuity");
  await ok(api("POST", "/api/continuity-plans", { name: "Krizová komunikace", planType: "crisis_communication" }), "plán kontinuity");
  await ok(api("POST", "/api/policies", { title: "Bezpečnostní politika" }), "dokument");
  await ok(api("POST", "/api/policies", { title: "Pravidla pro uživatele a hesla" }), "dokument");
  await ok(api("POST", "/api/incidents", { title: "Podvodný e-mail s fakturou (ukázka)", kind: "incident", category: "phishing", detectedAt: ago(10) }), "incident");
  await ok(api("POST", "/api/isms/objectives", { code: "C-01", title: "Obnova řízení výroby do 8 hodin", metric: "RTO v testu obnovy", target: "≤ 8 h", status: "partially_met", ownerPositionId: pMkb }), "cíl");
  await ok(api("POST", "/api/actions/tasks", { title: "Otestovat obnovu MES ze zálohy", ownerPositionId: pIt, dueDate: day(30), priority: "high" }), "úkol");
  await ok(api("POST", "/api/actions/tasks", { title: "Doplnit smlouvu s dodavatelem ERP o bezpečnostní požadavky", ownerPositionId: pEko, dueDate: day(45) }), "úkol");

  // profil schopností (deklarace tam, kde ukázka nemá data) a návrhy rizikových scénářů z dat (v1.17)
  await ok(api("PUT", "/api/risks/scenarios/capabilities/mfa", { status: "weak", product: "Microsoft Entra ID", note: "MFA jen pro vzdálený přístup, ne pro e-mail a ERP" }), "deklarace schopnosti");
  await ok(api("PUT", "/api/risks/scenarios/capabilities/edr", { status: "partial", product: "Microsoft Defender", note: "Servery ano, výrobní stanice ne" }), "deklarace schopnosti");
  await ok(api("PUT", "/api/risks/scenarios/capabilities/segmentation", { status: "weak", product: "FortiGate 100F", note: "Výrobní síť (OT) zatím není oddělená" }), "deklarace schopnosti");
  await ok(api("PUT", "/api/risks/scenarios/capabilities/backup_recovery", { status: "partial", note: "Zálohy denně, obnova MES netestovaná" }), "deklarace schopnosti");
  const gen = await ok(api("POST", "/api/risks/scenarios/generate"), "vyhodnocení scénářů");
  counts["návrh scénáře"] = gen.created ?? 0;

  log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", "));
  return { created: true, companyId: company.id, counts };
}
