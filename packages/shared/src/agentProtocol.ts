import { z } from "zod";

/* ============================================================
 * Agenti a koncentrátory – protokol v1 (ADR-177, docs/01_architecture/agenti-koncentratory.md).
 * Zdroj pravdy schématu zprávy: z něj se generuje JSON Schema pro repozitář contix-agent
 * (`bun apps/api/src/scripts/agent-schema.ts`). Podpis Ed25519 se počítá nad kanonickým JSON
 * podle RFC 8785 (`canonicalJson`) – stejně v agentovi (Go) i v CONTIXu; shodu hlídá sdílený
 * testovací vektor (apps/api/test/fixtures/agent-protocol-v1).
 * ============================================================ */

export const AGENT_PROTOCOL_VERSION = 1;

/** Druhy zpráv agenta: přehled `hello`, úplný stav `snapshot`, rozdíl `change`, důkazy `evidence`, souhrn spojení `flows`. */
export const AGENT_MESSAGE_KINDS = ["hello", "snapshot", "change", "evidence", "flows"] as const;
export type AgentMessageKind = (typeof AGENT_MESSAGE_KINDS)[number];

/** Podpis Ed25519 (64 B) v base64 se zarovnáním. */
const SIG_RE = /^[A-Za-z0-9+/]{86}==$/;

/**
 * Obálka zprávy v1. `strict` – neznámé pole na nejvyšší úrovni = neplatná zpráva (agent nemá jak
 * podstrčit nic mimo protokol). Obsah `payload` popisují schémata jednotlivých druhů (další fáze).
 */
export const AgentEnvelopeV1 = z
  .object({
    v: z.literal(AGENT_PROTOCOL_VERSION),
    agent: z.string().min(1).max(128),
    seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    ts: z.string().datetime({ offset: true }),
    kind: z.enum(AGENT_MESSAGE_KINDS),
    payload: z.record(z.string(), z.unknown()),
    sig: z.string().regex(SIG_RE),
  })
  .strict();
export type AgentEnvelope = z.infer<typeof AgentEnvelopeV1>;

/**
 * Kanonický JSON podle RFC 8785 (JCS): klíče objektů seřazené podle UTF-16 jednotek, čísla a řetězce
 * jako v ECMAScriptu (`JSON.stringify`), bez mezer. Hodnota musí pocházet z JSON (`JSON.parse`) –
 * nekonečna, NaN, undefined, funkce a jiné než prosté objekty se odmítnou.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
    return JSON.stringify(value); // -0 → "0", zkrácený tvar jako Number.prototype.toString
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const obj = value as Record<string, unknown>;
    // výchozí řazení JS porovnává UTF-16 jednotky – přesně podle RFC 8785
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value (${typeof value})`);
}

/* ------------------------------------------------------------
 * Koncentrátory a agenti v CONTIXu (ADR-177, fáze 1): koncentrátor = připojení typu `concentrator`.
 * Registruje se jednorázovým kódem (v DB jen SHA-256, platnost 24 h) a svým veřejným klíčem Ed25519;
 * každý další požadavek koncentrátoru je podepsaný tímto klíčem (`concentratorSigningString`).
 * Agenty registruje koncentrátor; agent je do schválení v karanténě (data se ukládají, nezpracovávají).
 * ------------------------------------------------------------ */

export const CONCENTRATOR_CODE_PREFIX = "ctxr_";
/** Platnost registračního kódu koncentrátoru. */
export const CONCENTRATOR_CODE_TTL_HOURS = 24;
/** Povolený rozdíl hodin koncentrátoru a CONTIXu u podepsaného požadavku. */
export const CONCENTRATOR_CLOCK_SKEW_S = 300;
/** Nejvíc zpráv v jedné dávce. */
export const AGENT_BATCH_MAX = 1000;

/** Hlavičky podepsaného požadavku koncentrátoru (malými písmeny). */
export const CONCENTRATOR_HEADERS = { id: "x-contix-concentrator", date: "x-contix-date", signature: "x-contix-signature" } as const;

/**
 * Řetězec, který koncentrátor podepisuje svým klíčem Ed25519 u každého požadavku do CONTIXu:
 * `CONTIX-CONCENTRATOR-V1\n<METODA>\n<cesta>\n<datum ISO 8601 UTC>\n<SHA-256 těla, hex>`.
 * Stejně v Go (contix-agent) – změna = nová verze prefixu.
 */
export function concentratorSigningString(method: string, path: string, date: string, bodySha256Hex: string): string {
  return ["CONTIX-CONCENTRATOR-V1", method.toUpperCase(), path, date, bodySha256Hex.toLowerCase()].join("\n");
}

const b64Key = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "Veřejný klíč Ed25519 v base64 (32 B)");
const text = (max: number) => z.string().trim().max(max);

export const ConcentratorConnectionInput = z.object({
  name: text(120).min(1),
  enabled: z.boolean().default(true),
  /** Společnost agentů (null = kořenová společnost skupiny). */
  companyId: z.string().uuid().nullable().default(null),
  /** Zóna sítě (kancelář, DMZ, OT, pobočka) – zobrazuje se u aktiv. */
  zone: text(60).min(1),
  /** Nový agent rovnou schválený (jen v důvěryhodné zóně). */
  autoApprove: z.boolean().default(false),
});
export type ConcentratorConnectionInput = z.input<typeof ConcentratorConnectionInput>;

export interface ConcentratorConnectionDto {
  id: string;
  kind: "concentrator";
  name: string;
  enabled: boolean;
  companyId: string | null;
  zone: string;
  autoApprove: boolean;
  /** Koncentrátor se zaregistroval (má klíč). */
  registered: boolean;
  keyFingerprint: string | null;
  hostname: string | null;
  version: string | null;
  /** Platný nepoužitý registrační kód do (null = žádný). */
  codeExpiresAt: string | null;
  lastSeenAt: string | null;
  agents: { pending: number; approved: number; blocked: number };
  /** Poslední hlášení stavu koncentrátoru (`/hello`, každých 15 min); null = ještě nehlásil. */
  status: ConcentratorHello | null;
}

export const AGENT_STATUSES = ["pending", "approved", "blocked"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export interface AgentDto {
  id: string;
  concentratorId: string;
  concentratorName: string;
  zone: string;
  companyId: string;
  hostname: string;
  hostId: string;
  os: string;
  version: string;
  keyFingerprint: string;
  status: AgentStatus;
  /** Nejvyšší souvisle přijaté pořadí zprávy. */
  ackSeq: number;
  lastSeenAt: string | null;
  events: number;
  quarantined: number;
  approvedAt: string | null;
  /** Server v evidenci (Discovery → Servery), kam se stav agenta promítá; null = zatím nezpracováno. */
  inventoryId: string | null;
  /** Spárované aktivum; null = server čeká na založení / spárování správcem. */
  assetId: string | null;
}

export const AgentStatusInput = z.object({ status: z.enum(["approved", "blocked"]) });
export type AgentStatusInput = z.input<typeof AgentStatusInput>;

/* --- požadavky koncentrátoru (veřejné API /api/public/agent/v1) --- */

export const ConcentratorRegisterInput = z.object({
  code: z.string().trim().startsWith(CONCENTRATOR_CODE_PREFIX).max(100),
  publicKey: b64Key,
  hostname: text(255).min(1),
  version: text(40).default(""),
});
export type ConcentratorRegisterInput = z.input<typeof ConcentratorRegisterInput>;

export const AgentRegisterInput = z.object({
  /** machine-id / SMBIOS UUID – stálá identita hostitele. */
  hostId: text(255).min(1),
  hostname: text(255).min(1),
  os: text(200).default(""),
  version: text(40).default(""),
  publicKey: b64Key,
});
export type AgentRegisterInput = z.input<typeof AgentRegisterInput>;

/** Stav koncentrátoru (`POST /hello`): jen provozní údaje, žádná data hostitelů. */
export const ConcentratorHelloInput = z.object({
  version: text(40).default(""),
  hostname: text(255).default(""),
  uptimeSeconds: z.number().int().min(0).default(0),
  agents: z.number().int().min(0).default(0),
  queueFiles: z.number().int().min(0).default(0),
  queueBytes: z.number().int().min(0).default(0),
  lastForwardAt: z.string().datetime({ offset: true }).optional(),
  lastError: text(500).optional(),
  caCertExpires: z.string().datetime({ offset: true }).optional(),
});
export type ConcentratorHello = z.infer<typeof ConcentratorHelloInput> & { receivedAt: string };

export const AgentBatchInput = z.object({ messages: z.array(z.unknown()).min(1).max(AGENT_BATCH_MAX) });

export const AGENT_REJECT_REASONS = ["unknown_agent", "blocked", "shape", "signature", "schema"] as const;
export type AgentRejectReason = (typeof AGENT_REJECT_REASONS)[number];

export interface AgentBatchResult {
  /** Agent → nejvyšší souvisle přijaté `seq` (koncentrátor podle toho maže frontu). */
  acks: Record<string, number>;
  accepted: number;
  duplicates: number;
  rejected: { index: number; agent: string | null; seq: number | null; reason: AgentRejectReason }[];
}
