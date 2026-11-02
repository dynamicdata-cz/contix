import { z } from "zod";
import { TEST_TYPES, type TestResult, type TestType } from "./bcm";
import { patchOf } from "./zutil";

/* ============================================================
 * Cvičení a tabletop scénáře (v0.71, ADR-066): plán cvičení (scénář, cíle, vstupy – „injecty“, účastníci,
 * navázané plány), průběh s časovou osou, vyhodnocení a nápravná opatření jako úkoly; po dokončení se zapíše
 * test do navázaných plánů kontinuity a vznikne záznam pro audit (tisk / Word).
 * ============================================================ */

export const EXERCISE_STATUSES = ["planned", "running", "completed", "cancelled"] as const;
export type ExerciseStatus = (typeof EXERCISE_STATUSES)[number];
export const EXERCISE_LOG_KINDS = ["inject", "decision", "note", "issue"] as const;
export type ExerciseLogKind = (typeof EXERCISE_LOG_KINDS)[number];

const text = (max = 5000) => z.string().trim().max(max);

export const ExerciseObjective = z.object({ text: text(500).min(3), met: z.boolean().nullable().default(null), note: text(1000).default("") });
export const ExerciseInject = z.object({ offsetMin: z.number().int().min(0).max(60 * 24 * 7), text: text(2000).min(3), expected: text(2000).default("") });
export const ExerciseParticipant = z.object({ positionId: z.string().uuid().nullable().default(null), name: text(200).default(""), role: text(200).default("") });

export const ExerciseInput = z.object({
  title: text(300).min(3),
  exerciseType: z.enum(TEST_TYPES).default("tabletop"),
  scenarioKey: z.string().trim().max(40).nullable().optional(),
  scenario: text(10000).default(""),
  objectives: z.array(ExerciseObjective).max(30).default([]),
  injects: z.array(ExerciseInject).max(60).default([]),
  participants: z.array(ExerciseParticipant).max(60).default([]),
  plannedAt: z.string().date().nullable().optional(),
  facilitatorPositionId: z.string().uuid().nullable().optional(),
  planIds: z.array(z.string().uuid()).max(30).default([]),
  companyId: z.string().uuid().optional(),
});
export type ExerciseInput = z.input<typeof ExerciseInput>;
export const ExercisePatch = patchOf(ExerciseInput.omit({ companyId: true }));
export type ExercisePatch = z.input<typeof ExercisePatch>;

export const ExerciseLogInput = z.object({ kind: z.enum(EXERCISE_LOG_KINDS).default("note"), text: text(4000).min(1), injectIndex: z.number().int().min(0).max(59).optional() });
export type ExerciseLogInput = z.input<typeof ExerciseLogInput>;

export const ExerciseCompleteInput = z.object({
  result: z.enum(["passed", "partial", "failed"]),
  achievedRtoHours: z.number().min(0).max(10000).nullable().optional(),
  findings: text(10000).default(""),
  lessons: text(10000).default(""),
  objectives: z.array(z.object({ met: z.boolean().nullable(), note: text(1000).default("") })).max(30).default([]),
  /** Nápravná opatření → úkoly v Akce a úkoly. */
  actions: z.array(z.object({ title: text(500).min(3), ownerPositionId: z.string().uuid().nullable().default(null), dueDate: z.string().date().nullable().default(null) })).max(30).default([]),
});
export type ExerciseCompleteInput = z.input<typeof ExerciseCompleteInput>;

export interface ExerciseLogEntry {
  at: string;
  kind: ExerciseLogKind;
  text: string;
  userId: string | null;
  userName?: string | null;
  injectIndex?: number;
}

export interface ExerciseDto {
  id: string;
  companyId: string;
  code: string;
  title: string;
  exerciseType: TestType;
  scenarioKey: string | null;
  scenario: string;
  objectives: z.infer<typeof ExerciseObjective>[];
  injects: z.infer<typeof ExerciseInject>[];
  participants: (z.infer<typeof ExerciseParticipant> & { positionName?: string | null })[];
  plannedAt: string | null;
  facilitatorPositionId: string | null;
  facilitatorPositionName: string | null;
  plans: { id: string; name: string }[];
  status: ExerciseStatus;
  startedAt: string | null;
  endedAt: string | null;
  log: ExerciseLogEntry[];
  result: TestResult | null;
  achievedRtoHours: number | null;
  findings: string;
  lessons: string;
  tasks: { id: string; seq: number; title: string; status: string }[];
  canEdit: boolean;
}

export const exerciseCode = (seq: number) => `CV-${seq}`;

/** Které injecty už byly vloženy (podle záznamu průběhu). */
export const deliveredInjects = (log: Pick<ExerciseLogEntry, "kind" | "injectIndex">[]) => new Set(log.filter((l) => l.kind === "inject" && l.injectIndex != null).map((l) => l.injectIndex!));

export interface ExerciseTemplate {
  key: string;
  name: { cs: string; en: string };
  scenario: { cs: string; en: string };
  objectives: { cs: string; en: string }[];
  injects: { offsetMin: number; cs: string; en: string; expectedCs: string; expectedEn: string }[];
}

export const EXERCISE_TEMPLATES: ExerciseTemplate[] = [
  {
    key: "ransomware",
    name: { cs: "Ransomware na souborovém serveru", en: "Ransomware on the file server" },
    scenario: {
      cs: "V pondělí ráno uživatelé hlásí nedostupné soubory a výkupní zprávu. Šifrování se šíří po síti, zasažen je souborový server a část stanic.",
      en: "On Monday morning users report inaccessible files and a ransom note. Encryption spreads across the network, the file server and some workstations are affected.",
    },
    objectives: [
      { cs: "Ověřit postup izolace zasažených systémů do 1 hodiny", en: "Verify isolating affected systems within 1 hour" },
      { cs: "Ověřit obnovu ze záloh v rámci RTO", en: "Verify recovery from backups within the RTO" },
      { cs: "Ověřit rozhodnutí o hlášení NÚKIB a lhůty", en: "Verify the decision on reporting to the national CSIRT and deadlines" },
      { cs: "Ověřit krizovou komunikaci se zaměstnanci a vedením", en: "Verify crisis communication with staff and management" },
    ],
    injects: [
      { offsetMin: 0, cs: "Helpdesk: 15 uživatelů hlásí soubory s příponou .lock a soubor README_DECRYPT.txt.", en: "Helpdesk: 15 users report files with a .lock extension and README_DECRYPT.txt.", expectedCs: "Aktivace týmu, izolace sítě, eskalace incidentu.", expectedEn: "Team activation, network isolation, incident escalation." },
      { offsetMin: 30, cs: "Monitoring: šifrování probíhá i na záložním NAS.", en: "Monitoring: encryption is also running on the backup NAS.", expectedCs: "Odpojení záloh, ověření offline kopií.", expectedEn: "Disconnect backups, verify offline copies." },
      { offsetMin: 60, cs: "Útočník e-mailem žádá výkupné a hrozí zveřejněním osobních údajů.", en: "The attacker demands a ransom by e-mail and threatens to publish personal data.", expectedCs: "Rozhodnutí vedení, posouzení úniku osobních údajů (GDPR), komunikace s policií.", expectedEn: "Management decision, personal data breach assessment (GDPR), contact the police." },
      { offsetMin: 120, cs: "Uplynuly 2 hodiny od zjištění – blíží se lhůta prvotního hlášení.", en: "2 hours since detection – the initial report deadline is approaching.", expectedCs: "Prvotní hlášení NÚKIB do 24 h, záznam do evidence incidentů.", expectedEn: "Initial report within 24 h, record in the incident register." },
    ],
  },
  {
    key: "cloud_outage",
    name: { cs: "Výpadek klíčového cloudového dodavatele", en: "Outage of a key cloud supplier" },
    scenario: {
      cs: "Poskytovatel SaaS, na kterém běží klíčová agenda, je nedostupný. Dodavatel neuvádí odhad obnovy.",
      en: "The SaaS provider running a key business process is unavailable. The supplier gives no recovery estimate.",
    },
    objectives: [
      { cs: "Ověřit náhradní postup procesu při výpadku dodavatele", en: "Verify the process fallback during a supplier outage" },
      { cs: "Ověřit kontakty a eskalaci u dodavatele podle smlouvy", en: "Verify supplier contacts and escalation per contract" },
      { cs: "Ověřit splnění MTPD procesu", en: "Verify meeting the process MTPD" },
    ],
    injects: [
      { offsetMin: 0, cs: "Uživatelé hlásí chybu 503 při přihlášení do aplikace.", en: "Users report error 503 when signing in to the application.", expectedCs: "Ověření rozsahu, kontakt dodavatele.", expectedEn: "Check the scope, contact the supplier." },
      { offsetMin: 60, cs: "Dodavatel potvrzuje výpadek datového centra, odhad obnovy neznámý.", en: "The supplier confirms a data centre outage, recovery estimate unknown.", expectedCs: "Aktivace náhradního postupu, informování vedení.", expectedEn: "Activate the fallback, inform management." },
      { offsetMin: 240, cs: "Výpadek trvá 4 hodiny, blíží se uzávěrka zpracování.", en: "The outage has lasted 4 hours, the processing deadline is approaching.", expectedCs: "Rozhodnutí o ručním zpracování, komunikace s klienty.", expectedEn: "Decide on manual processing, communicate with clients." },
    ],
  },
  {
    key: "datacenter_power",
    name: { cs: "Výpadek napájení serverovny", en: "Server room power outage" },
    scenario: { cs: "Dlouhodobý výpadek elektřiny v budově; UPS vydrží 30 minut, dieselagregát nenastartoval.", en: "Long power outage in the building; UPS lasts 30 minutes, the generator did not start." },
    objectives: [
      { cs: "Ověřit řízené vypnutí a pořadí obnovy systémů", en: "Verify a controlled shutdown and system recovery order" },
      { cs: "Ověřit přepnutí na záložní lokalitu (je-li)", en: "Verify failover to the backup site (if any)" },
    ],
    injects: [
      { offsetMin: 0, cs: "Výpadek proudu v celé budově, UPS hlásí běh na baterie.", en: "Power outage in the whole building, UPS reports running on battery.", expectedCs: "Aktivace plánu, kontakt správce budovy.", expectedEn: "Activate the plan, contact facility management." },
      { offsetMin: 20, cs: "Dieselagregát nenastartoval, baterie na 30 %.", en: "The generator did not start, battery at 30 %.", expectedCs: "Řízené vypnutí méně kritických systémů.", expectedEn: "Controlled shutdown of less critical systems." },
      { offsetMin: 180, cs: "Elektřina obnovena.", en: "Power restored.", expectedCs: "Obnova podle pořadí, kontrola integrity dat.", expectedEn: "Recovery in order, data integrity check." },
    ],
  },
  {
    key: "data_breach",
    name: { cs: "Únik osobních údajů", en: "Personal data breach" },
    scenario: { cs: "Na internetu se objevil export z personálního systému s osobními údaji zaměstnanců.", en: "An export from the HR system with employee personal data has appeared on the internet." },
    objectives: [
      { cs: "Ověřit posouzení rizika pro subjekty údajů a ohlášení ÚOOÚ do 72 h", en: "Verify the risk assessment for data subjects and notifying the DPA within 72 h" },
      { cs: "Ověřit dohledání zdroje úniku z protokolů", en: "Verify tracing the source of the breach from logs" },
    ],
    injects: [
      { offsetMin: 0, cs: "Novinář žádá o vyjádření k uniklým datům.", en: "A journalist asks for a statement on the leaked data.", expectedCs: "Krizová komunikace, ověření pravosti dat.", expectedEn: "Crisis communication, verify the data authenticity." },
      { offsetMin: 90, cs: "Logy ukazují export dat účtem bývalého zaměstnance.", en: "Logs show a data export by a former employee's account.", expectedCs: "Zablokování účtu, kontrola přezkumu přístupů.", expectedEn: "Block the account, check access reviews." },
    ],
  },
  {
    key: "bec",
    name: { cs: "Kompromitace účtu vedení (BEC)", en: "Executive account compromise (BEC)" },
    scenario: { cs: "Účetní obdržela z účtu ředitele pokyn k urgentní platbě na nový účet dodavatele.", en: "Accounting received an urgent payment instruction to a new supplier account from the director's mailbox." },
    objectives: [
      { cs: "Ověřit postup ověření platebních pokynů mimo e-mail", en: "Verify the out-of-band payment instruction verification" },
      { cs: "Ověřit reakci na kompromitovaný účet (reset, MFA, pravidla schránky)", en: "Verify the response to a compromised account (reset, MFA, mailbox rules)" },
    ],
    injects: [
      { offsetMin: 0, cs: "E-mail od ředitele: „Uhraďte dnes fakturu, je to důvěrné.“", en: "E-mail from the director: \"Pay this invoice today, it is confidential.\"", expectedCs: "Telefonické ověření, nahlášení phishingu.", expectedEn: "Phone verification, report phishing." },
      { offsetMin: 45, cs: "V poštovní schránce ředitele je nové pravidlo přeposílání ven.", en: "A new external forwarding rule exists in the director's mailbox.", expectedCs: "Reset hesla, odvolání relací, odstranění pravidla, kontrola přihlášení.", expectedEn: "Password reset, revoke sessions, remove the rule, review sign-ins." },
    ],
  },
];

export const EXERCISE_LABELS = {
  status: { planned: "Plánováno", running: "Probíhá", completed: "Dokončeno", cancelled: "Zrušeno" } as Record<ExerciseStatus, string>,
  logKind: { inject: "Vstup scénáře", decision: "Rozhodnutí", note: "Poznámka", issue: "Problém" } as Record<ExerciseLogKind, string>,
};
