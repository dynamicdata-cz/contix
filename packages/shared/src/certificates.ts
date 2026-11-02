import { z } from "zod";

/* ============================================================
 * Inventář certifikátů a kryptografie (ADR-070): čtecí kontrola TLS koncových bodů – platnost certifikátu, důvěryhodnost
 * řetězce, shoda jména, délka klíče, podpisový algoritmus, zastaralé protokoly. Nálezy se počítají při čtení (`certFindings`).
 * ============================================================ */

/** Jméno hostitele nebo IP adresa (bez schématu, cesty a mezer). */
export const HOST_RE = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$|^\d{1,3}(?:\.\d{1,3}){3}$|^[0-9a-fA-F:]{2,39}$/;

export const TlsEndpointInput = z.object({
  host: z.string().trim().toLowerCase().regex(HOST_RE, "Neplatné jméno hostitele"),
  port: z.number().int().min(1).max(65535).default(443),
  /** Jméno pro SNI a kontrolu certifikátu (výchozí = host). */
  serverName: z.string().trim().toLowerCase().regex(HOST_RE).optional().nullable(),
  assetId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean().default(true),
  companyId: z.string().uuid().optional(),
});
export type TlsEndpointInput = z.input<typeof TlsEndpointInput>;

export const TlsPolicy = z.object({
  warnDays: z.number().int().min(1).max(180).default(30),
  minRsaBits: z.number().int().min(1024).max(8192).default(2048),
  minEcBits: z.number().int().min(160).max(521).default(256),
  /** Přijímat TLS 1.0 / 1.1 bez nálezu (výchozí ne). */
  allowLegacyTls: z.boolean().default(false),
  maxValidityDays: z.number().int().min(30).max(3650).default(398),
});
export type TlsPolicy = z.infer<typeof TlsPolicy>;

export interface TlsScanResult {
  ok: boolean;
  error?: string | null;
  protocol?: string | null;
  cipher?: string | null;
  /** Server přijal zastaralý protokol (zjištěno, je-li k dispozici openssl). */
  legacyProtocols?: string[] | null;
  subject?: string | null;
  issuer?: string | null;
  sans?: string[];
  serial?: string | null;
  fingerprint256?: string | null;
  notBefore?: string | null;
  notAfter?: string | null;
  keyType?: string | null;
  keyBits?: number | null;
  sigAlg?: string | null;
  selfSigned?: boolean;
  /** Řetězec ověřen proti důvěryhodným CA systému. */
  trusted?: boolean;
  trustError?: string | null;
  nameMatch?: boolean;
}

export const TLS_FINDINGS = ["unreachable", "expired", "expiring", "not_yet_valid", "untrusted", "self_signed", "name_mismatch", "weak_key", "weak_signature", "legacy_protocol", "long_validity"] as const;
export type TlsFindingKind = (typeof TLS_FINDINGS)[number];
export type TlsSeverity = "critical" | "high" | "medium" | "low";
export const TLS_LABELS: { finding: Record<TlsFindingKind, string>; severity: Record<TlsSeverity, string> } = {
  finding: {
    unreachable: "Nedostupné / chyba spojení",
    expired: "Certifikát vypršel",
    expiring: "Certifikát brzy vyprší",
    not_yet_valid: "Certifikát ještě neplatí",
    untrusted: "Nedůvěryhodný řetězec",
    self_signed: "Certifikát podepsaný sám sebou",
    name_mismatch: "Jméno neodpovídá certifikátu",
    weak_key: "Slabý klíč",
    weak_signature: "Slabý podpisový algoritmus",
    legacy_protocol: "Zastaralý protokol TLS",
    long_validity: "Příliš dlouhá platnost",
  },
  severity: { critical: "Kritická", high: "Vysoká", medium: "Střední", low: "Nízká" },
};

export interface TlsFinding {
  kind: TlsFindingKind;
  severity: TlsSeverity;
  detail?: string;
}

const WEAK_SIG = /md5|sha1(?!\d)|sha-1/i;
const DAY = 86_400_000;

export function daysLeft(r: TlsScanResult, now = new Date()): number | null {
  return r.notAfter ? Math.floor((new Date(r.notAfter).getTime() - now.getTime()) / DAY) : null;
}

export function certFindings(r: TlsScanResult | null | undefined, policy: TlsPolicy, now = new Date()): TlsFinding[] {
  if (!r) return [];
  if (!r.ok) return [{ kind: "unreachable", severity: "medium", detail: r.error ?? undefined }];
  const out: TlsFinding[] = [];
  const left = daysLeft(r, now);
  if (left != null && left < 0) out.push({ kind: "expired", severity: "critical", detail: r.notAfter ?? undefined });
  else if (left != null && left <= policy.warnDays) out.push({ kind: "expiring", severity: left <= 7 ? "high" : "medium", detail: String(left) });
  if (r.notBefore && new Date(r.notBefore) > now) out.push({ kind: "not_yet_valid", severity: "high" });
  if (r.selfSigned) out.push({ kind: "self_signed", severity: "medium" });
  else if (r.trusted === false) out.push({ kind: "untrusted", severity: "high", detail: r.trustError ?? undefined });
  if (r.nameMatch === false) out.push({ kind: "name_mismatch", severity: "high" });
  if (r.keyBits != null) {
    const t = (r.keyType ?? "").toLowerCase();
    const min = t === "rsa" || t === "dsa" ? policy.minRsaBits : t === "ec" ? policy.minEcBits : 0;
    if (min && r.keyBits < min) out.push({ kind: "weak_key", severity: "high", detail: `${r.keyType} ${r.keyBits}` });
  }
  if (r.sigAlg && WEAK_SIG.test(r.sigAlg)) out.push({ kind: "weak_signature", severity: "high", detail: r.sigAlg });
  if (!policy.allowLegacyTls && r.legacyProtocols?.length) out.push({ kind: "legacy_protocol", severity: "medium", detail: r.legacyProtocols.join(", ") });
  if (r.notBefore && r.notAfter && (new Date(r.notAfter).getTime() - new Date(r.notBefore).getTime()) / DAY > policy.maxValidityDays && !r.selfSigned && r.trusted)
    out.push({ kind: "long_validity", severity: "low" });
  return out;
}

const SEV_ORDER: TlsSeverity[] = ["critical", "high", "medium", "low"];
export function worstSeverity(f: TlsFinding[]): TlsSeverity | null {
  for (const s of SEV_ORDER) if (f.some((x) => x.severity === s)) return s;
  return null;
}

export interface TlsEndpointDto {
  id: string;
  companyId: string;
  host: string;
  port: number;
  serverName: string | null;
  assetId: string | null;
  assetName: string | null;
  note: string | null;
  enabled: boolean;
  lastScanAt: string | null;
  result: TlsScanResult | null;
  daysLeft: number | null;
  findings: TlsFinding[];
  severity: TlsSeverity | null;
}

export interface TlsOverview {
  endpoints: TlsEndpointDto[];
  policy: TlsPolicy;
  summary: { total: number; expired: number; expiring: number; withFindings: number; unscanned: number; legacyCheck: boolean };
}

/** Podpisový algoritmus z DER certifikátu (OID ve druhém prvku sekvence Certificate). */
const SIG_OIDS: Record<string, string> = {
  "1.2.840.113549.1.1.4": "md5WithRSAEncryption",
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
  "1.2.840.10045.4.1": "ecdsa-with-SHA1",
  "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
  "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
  "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
  "1.3.101.112": "Ed25519",
  "1.3.101.113": "Ed448",
  "1.2.840.10040.4.3": "dsa-with-sha1",
};
export function signatureAlgorithmOf(der: Uint8Array): string | null {
  try {
    let i = 0;
    const len = () => {
      let l = der[i++]!;
      if (l & 0x80) {
        const n = l & 0x7f;
        l = 0;
        for (let k = 0; k < n; k++) l = (l << 8) | der[i++]!;
      }
      return l;
    };
    if (der[i++] !== 0x30) return null;
    len(); // Certificate
    if (der[i++] !== 0x30) return null;
    const tbsLen = len();
    i += tbsLen; // tbsCertificate (pozor: i += len() by přičetlo k hodnotě i před čtením délky)
    if (der[i++] !== 0x30) return null;
    len(); // AlgorithmIdentifier
    if (der[i++] !== 0x06) return null;
    const l = len();
    const b = der.slice(i, i + l);
    const parts = [Math.floor(b[0]! / 40), b[0]! % 40];
    let v = 0;
    for (let k = 1; k < b.length; k++) {
      v = v * 128 + (b[k]! & 0x7f);
      if (!(b[k]! & 0x80)) {
        parts.push(v);
        v = 0;
      }
    }
    const oid = parts.join(".");
    return SIG_OIDS[oid] ?? oid;
  } catch {
    return null;
  }
}
