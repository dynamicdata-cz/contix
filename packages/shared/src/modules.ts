/**
 * Katalog modulů CONTIX. Modul lze v Administraci vypnout – zmizí z menu a jeho API vrací 404.
 * Závislosti: modul nelze zapnout bez modulů, na kterých závisí (a nelze vypnout modul, na kterém jiný zapnutý závisí).
 */
export const MODULES = [
  { key: "assets", name: "Aktiva", description: "Inventář primárních a podpůrných aktiv", dependsOn: [] },
  { key: "discovery", name: "Discovery & import", description: "Wazuh, síťový sken, CSV import", dependsOn: ["assets"] },
  { key: "vulnerabilities", name: "Zranitelnosti", description: "CVE z Wazuhu, konec podpory OS, semafor aktiv", dependsOn: ["assets"] },
  { key: "organization", name: "Organizace", description: "Útvary, funkční místa a jejich obsazení", dependsOn: [] },
  { key: "processes", name: "Procesy", description: "Evidence a modelování procesů, kroky, RACI, BPMN", dependsOn: ["organization"] },
  { key: "risks", name: "Rizika", description: "Katalog hrozeb a zranitelností, registr a hodnocení rizik, plán zvládání rizik", dependsOn: ["assets"] },
  { key: "controls", name: "Opatření a shoda", description: "Katalog opatření, mapování na ZKB/vyhl. 409 a 410/ISO 27001/DORA, prohlášení o aplikovatelnosti", dependsOn: [] },
  { key: "continuity", name: "Kontinuita (BIA, plány)", description: "Analýza dopadů, MTPD/RTO/RPO, plány kontinuity a obnovy a jejich testy (§ 15 vyhl. 409)", dependsOn: ["processes"] },
  { key: "suppliers", name: "Dodavatelé", description: "Evidence (významných) dodavatelů, smlouvy dle přílohy č. 5 vyhl. 409 / přílohy č. 2 vyhl. 410", dependsOn: [] },
  { key: "isms", name: "Řízení ISMS", description: "Evidence a řízení významných změn (§ 11 vyhl. 409), vyhodnocení účinnosti a přezkoumání ISMS (§ 3 písm. f–h)", dependsOn: [] },
  { key: "incidents", name: "Incidenty", description: "Kybernetické bezpečnostní události a incidenty, lhůty hlášení dle § 15–16 zákona, zvládání dle § 14 vyhl. 409", dependsOn: [] },
  { key: "policies", name: "Politiky a dokumentace", description: "Bezpečnostní politika a dokumentace, verze, schvalování, přezkum a seznámení (§ 6 vyhl. 409)", dependsOn: ["organization"] },
  { key: "awareness", name: "Povědomí a školení", description: "Plán rozvoje bezpečnostního povědomí, školení a přehledy absolvování (§ 10 vyhl. 409)", dependsOn: ["organization"] },
  { key: "gdpr", name: "Ochrana osobních údajů", description: "Záznamy o činnostech zpracování (čl. 30 GDPR) navázané na procesy a aktiva, posouzení vlivu (DPIA)", dependsOn: [] },
  { key: "aiact", name: "Umělá inteligence (AI Act)", description: "Registr AI systémů, zakázané praktiky, klasifikace rizika, povinnosti zavádějícího subjektu a poskytovatele, FRIA a AI gramotnost", dependsOn: [] },
  { key: "cra", name: "Kybernetická odolnost produktů (CRA)", description: "Produkty s digitálními prvky: kategorie, posouzení shody, požadavky přílohy I, podpůrné období, SBOM a hlášení zranitelností a incidentů podle čl. 14", dependsOn: [] },
  { key: "identity", name: "Identity a přístupy", description: "Kontroly účtů v Active Directory a Entra ID: neaktivní a privilegované účty, rizikové příznaky, MFA", dependsOn: [] },
  { key: "legislation", name: "Legislativa", description: "Sledované předpisy z e-Sbírky a ručně vedené normy: nová znění, rozdíly, posouzení dopadu a úkoly", dependsOn: [] },
  { key: "soc", name: "SOC", description: "Fronta bezpečnostních alertů (Wazuh + ruční), triáž, MITRE ATT&CK, playbooky a AI poradci", dependsOn: ["incidents"] },
  { key: "soc2", name: "Zprávy SOC 2", description: "Zakázka auditora SOC 2: rozsah TSC, popis systému, CUEC a subdodavatelé, matice kritérium → opatření → testy → výjimky, pracovní papíry, PBC a zpráva Type I / II ve Wordu", dependsOn: ["audits", "controls"] },
  { key: "trust", name: "Dotazníky zákazníků a Trust Center", description: "Bezpečnostní dotazníky od zákazníků s AI návrhy odpovědí z dokumentace a opatření, knihovna schválených odpovědí, veřejná stránka důvěry s dokumenty po NDA", dependsOn: ["controls"] },
  { key: "knowledge", name: "Znalostní báze", description: "Vlastní znalostní články (postupy, FAQ, runbooky SOC) – hledání podle významu a podklad pro odpovědi AI", dependsOn: [] },
  { key: "audits", name: "Audity", description: "Plán a evidence auditů kybernetické bezpečnosti, zjištění a nápravná opatření (§ 16 vyhl. 409)", dependsOn: [] },
] as const;

/** Moduly přidané v jednotlivých verzích – u existujících instalací se jednorázově zapnou. */
export const MODULE_UPGRADES: { version: string; modules: string[] }[] = [
  { version: "0.6", modules: ["controls", "continuity"] },
  { version: "0.7", modules: ["suppliers"] },
  { version: "0.8", modules: ["isms"] },
  { version: "0.9", modules: ["incidents", "audits"] },
  { version: "0.11", modules: ["policies", "awareness"] },
  { version: "0.19", modules: ["gdpr"] },
  { version: "0.28", modules: ["identity"] },
  { version: "0.34", modules: ["legislation"] },
  { version: "0.51", modules: ["soc"] },
  { version: "0.95", modules: ["aiact"] },
  { version: "0.96", modules: ["soc2"] },
  { version: "0.97", modules: ["cra"] },
  { version: "1.04", modules: ["trust"] },
  { version: "1.07", modules: ["knowledge"] },
];

export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

/** Ověří, že sada zapnutých modulů splňuje závislosti; vrací chybovou zprávu nebo null. */
export function validateModules(enabled: string[]): string | null {
  for (const m of MODULES) {
    if (!enabled.includes(m.key)) continue;
    for (const d of m.dependsOn) {
      if (!enabled.includes(d)) {
        const dep = MODULES.find((x) => x.key === d)!;
        return `Modul „${m.name}“ vyžaduje zapnutý modul „${dep.name}“.`;
      }
    }
  }
  return null;
}
