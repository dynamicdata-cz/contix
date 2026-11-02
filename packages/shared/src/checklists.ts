import { FRAMEWORKS, frameworkExists, frameworkRegistryVersion, requirementsOf, type FrameworkId } from "./frameworks";
import { registerMethodologies, setMethodologyResolver, type AuditMethodologyDef } from "./methodology";

/* ============================================================
 * Vestavěné kontrolní seznamy auditu – generované z katalogu požadavků
 * (každý posuzovaný požadavek vyhlášky = jedna položka s vazbou requirementId).
 * ============================================================ */

function fromFramework(id: string, fw: FrameworkId, name: string, source: string): AuditMethodologyDef {
  return {
    kind: "audit",
    id,
    name,
    version: "2025",
    description: "Kontrolní seznam generovaný z požadavků rámce; každá položka je navázána na požadavek katalogu, takže neshoda se promítne do zjištění.",
    source,
    checklist: requirementsOf(fw).map((r) => ({
      id: r.id,
      section: r.section,
      ref: r.ref,
      requirementId: r.id,
      question: r.lead ? `${r.lead} – ${r.text}` : r.text,
      ...(r.points.length ? { guidance: r.points.join("\n") } : {}),
    })),
  };
}

export const ZKB409_AUDIT = fromFramework("zkb409_audit", "cz409", "Audit KB – vyhláška č. 409/2025 Sb. (vyšší povinnosti)", "vyhl. č. 409/2025 Sb.");
export const ZKB410_AUDIT = fromFramework("zkb410_audit", "cz410", "Audit KB – vyhláška č. 410/2025 Sb. (nižší povinnosti)", "vyhl. č. 410/2025 Sb.");
export const BUILTIN_AUDIT_METHODOLOGIES: AuditMethodologyDef[] = [ZKB409_AUDIT, ZKB410_AUDIT];
registerMethodologies(BUILTIN_AUDIT_METHODOLOGIES);

/** Položky kontrolního seznamu omezené na rozsah auditu (oddíly „§ 8“…); bez rozsahu = všechny. */
export function checklistFor(def: AuditMethodologyDef, sections: string[]) {
  if (!sections.length) return def.checklist;
  const set = new Set(sections);
  return def.checklist.filter((i) => !i.section || set.has(i.section));
}

/* ---------------- kontrolní seznam z libovolného rámce knihovny (ADR-080) ---------------- */

export const FRAMEWORK_CHECKLIST_PREFIX = "fw:";
let cache: { version: number; defs: Map<string, AuditMethodologyDef> } = { version: -1, defs: new Map() };

/** Kontrolní seznam auditu „fw:<rámec>“ – rámce s použitím „audit“ (vestavěné vyhlášky mají vlastní seznamy). */
export function frameworkChecklist(id: string): AuditMethodologyDef | null {
  if (!id.startsWith(FRAMEWORK_CHECKLIST_PREFIX)) return null;
  const fw = id.slice(FRAMEWORK_CHECKLIST_PREFIX.length);
  if (!frameworkExists(fw)) return null;
  if (cache.version !== frameworkRegistryVersion) cache = { version: frameworkRegistryVersion, defs: new Map() };
  const hit = cache.defs.get(id);
  if (hit) return hit;
  const meta = FRAMEWORKS.find((f) => f.id === fw)!;
  const def = fromFramework(id, fw as FrameworkId, `Audit – ${meta.name}`, meta.source || meta.name);
  def.version = meta.version || "1";
  cache.defs.set(id, def);
  return def;
}
setMethodologyResolver(frameworkChecklist);

/** Rámce, ze kterých lze vytvořit kontrolní seznam (použití „audit“, bez vyhlášek s vlastním seznamem). */
export const auditableFrameworks = () => FRAMEWORKS.filter((f) => f.uses.includes("audit") && f.id !== "cz409" && f.id !== "cz410");
