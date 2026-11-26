import { z } from "zod";

/**
 * Certifikáty a osvědčení osob (v1.105.0, ADR-199): externí certifikace (CCNA, CISSP, ISO 27001 LA), osvědčení
 * ze školení (výrobce, dodavatel, BOZP) a oprávnění. Držitel je uživatel CONTIXu, osoba z personální evidence
 * (zaměstnanec, externista) nebo pracovník dodavatele bez účtu. Soubor (PDF, obrázek) se ukládá k záznamu,
 * platnost hlídají povinnosti a upozornění. Osvědčení uživatele může započítat absolvování kurzu z plánu školení.
 */

export const PERSON_CERT_KINDS = ["certification", "training", "license", "other"] as const;
export type PersonCertKind = (typeof PERSON_CERT_KINDS)[number];

/** Stav platnosti: `expiring` = do 60 dnů. */
export const PERSON_CERT_STATES = ["valid", "expiring", "expired", "no_expiry"] as const;
export type PersonCertState = (typeof PERSON_CERT_STATES)[number];
export const PERSON_CERT_EXPIRING_DAYS = 60;

export const PERSON_CERT_FILE_MAX = 10 * 1024 * 1024;
export const PERSON_CERT_FILE_TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const PersonCertInput = z
  .object({
    /** Držitel: právě jedno z userId / personId / holderName. */
    userId: z.string().uuid().nullable().default(null),
    personId: z.string().uuid().nullable().default(null),
    holderName: z.string().trim().max(200).nullable().default(null),
    /** Dodavatel, u kterého pracovník pracuje (externí osoby). */
    supplierId: z.string().uuid().nullable().default(null),
    name: z.string().trim().min(1).max(300),
    kind: z.enum(PERSON_CERT_KINDS).default("certification"),
    issuer: z.string().trim().max(200).default(""),
    credentialId: z.string().trim().max(200).default(""),
    issuedAt: date.default(null),
    validUntil: date.default(null),
    /** Kurz z plánu školení, který osvědčení pokrývá (u uživatele se zapíše absolvování). */
    courseId: z.string().uuid().nullable().default(null),
    note: z.string().trim().max(2000).default(""),
  })
  .refine((v) => [v.userId, v.personId, v.holderName?.trim() || null].filter(Boolean).length === 1, { message: "Zvolte právě jednoho držitele – uživatele, osobu z evidence, nebo vyplňte jméno externí osoby", path: ["userId"] })
  .refine((v) => !v.issuedAt || !v.validUntil || v.validUntil >= v.issuedAt, { message: "Platnost končí dřív, než byl certifikát vydán", path: ["validUntil"] })
  .refine((v) => !v.courseId || !!v.userId, { message: "Absolvování kurzu lze započítat jen uživateli CONTIXu", path: ["courseId"] });
export type PersonCertInput = z.input<typeof PersonCertInput>;

export interface PersonCertDto {
  id: string;
  companyId: string;
  holder: { type: "user" | "person" | "external"; id: string | null; name: string; detail: string | null };
  supplier: { id: string; name: string } | null;
  name: string;
  kind: PersonCertKind;
  issuer: string;
  credentialId: string;
  issuedAt: string | null;
  validUntil: string | null;
  state: PersonCertState;
  /** Dnů do konce platnosti (záporné = po platnosti). */
  daysLeft: number | null;
  course: { id: string; title: string } | null;
  note: string;
  file: { name: string; mime: string; size: number } | null;
  updatedAt: string;
}

export interface PersonCertListDto {
  items: PersonCertDto[];
  counts: Record<PersonCertState, number>;
}

export interface PersonCertHoldersDto {
  users: { id: string; name: string; email: string }[];
  people: { id: string; name: string; kind: string; detail: string | null }[];
  suppliers: { id: string; name: string }[];
}

export function personCertState(validUntil: string | null, today: string): { state: PersonCertState; daysLeft: number | null } {
  if (!validUntil) return { state: "no_expiry", daysLeft: null };
  const days = Math.round((Date.parse(`${validUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { state: days < 0 ? "expired" : days <= PERSON_CERT_EXPIRING_DAYS ? "expiring" : "valid", daysLeft: days };
}

/* ---------- Požadavek na kvalifikaci dodavatele (v1.112, ADR-204) ---------- */

/** Např. „CCNA“ alespoň u 2 pracovníků. Shoda podle názvu certifikátu (obsahuje, bez ohledu na velikost písmen). */
export const SupplierCertRequirement = z.object({
  name: z.string().trim().min(2).max(200),
  min: z.number().int().min(1).max(50).default(1),
});
export type SupplierCertRequirement = z.infer<typeof SupplierCertRequirement>;
export const SupplierCertRequirementsInput = z.object({
  items: z
    .array(SupplierCertRequirement)
    .max(20)
    .refine((a) => new Set(a.map((x) => x.name.toLowerCase())).size === a.length, "Požadavek je uveden dvakrát"),
});

export interface SupplierQualificationItem {
  name: string;
  min: number;
  /** pracovníci s platným odpovídajícím certifikátem */
  holders: string[];
  ok: boolean;
  /** den, od kterého platných pracovníků bude méně než `min` (null = neomezeně / už teď nesplněno) */
  until: string | null;
}
export interface SupplierQualificationDto {
  items: SupplierQualificationItem[];
  ok: boolean;
}

/** Vyhodnocení požadavků proti certifikátům pracovníků dodavatele. */
export function evaluateQualification(reqs: SupplierCertRequirement[], certs: { name: string; holder: string; validUntil: string | null }[], today: string): SupplierQualificationDto {
  const items = reqs.map((r) => {
    const n = r.name.toLowerCase();
    // nejdelší platnost u každého pracovníka (null = bez omezení)
    const best = new Map<string, string | null>();
    const label = new Map<string, string>();
    for (const c of certs) {
      if (!c.name.toLowerCase().includes(n) || (c.validUntil && c.validUntil < today)) continue;
      const k = c.holder.trim().toLowerCase();
      const cur = best.get(k);
      if (cur === undefined || (cur !== null && (c.validUntil === null || c.validUntil > cur))) best.set(k, c.validUntil);
      if (!label.has(k)) label.set(k, c.holder.trim());
    }
    const holders = [...label.values()].sort((a, b) => a.localeCompare(b, "cs"));
    const ok = best.size >= r.min;
    // seřazeno od nejdelší platnosti; `min`-tý pracovník určuje, dokdy je požadavek splněn
    const ends = [...best.values()].sort((a, b) => (a === null ? -1 : b === null ? 1 : b.localeCompare(a)));
    const until = ok ? (ends[r.min - 1] ?? null) : null;
    return { name: r.name, min: r.min, holders, ok, until };
  });
  return { items, ok: items.every((i) => i.ok) };
}
