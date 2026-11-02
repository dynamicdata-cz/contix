import { z } from "zod";

/* ============================================================
 * Bezpečnostní dotazník pro dodavatele (ADR-040) – podklad pro hodnocení rizik dodavatele
 * (§ 9 odst. 2 písm. a) vyhl. č. 409/2025 Sb.) a kontrolu ustanovení přílohy č. 5 / přílohy č. 2 vyhl. č. 410/2025 Sb.
 * Dodavatel vyplní dotazník přes odkaz bez přihlášení (token v odkazu, v DB jen SHA-256), CONTIX odpovědi
 * vyhodnotí (`scoreQuestionnaire`) a navrhne úroveň rizika; riziko se zakládá jen na pokyn uživatele.
 * Otázky jsou vlastní formulace CONTIXu (ne text předpisu), dvojjazyčně – dodavatel může být zahraniční.
 * ============================================================ */

export const QUESTIONNAIRE_TEMPLATES = ["cz409", "cz410"] as const;
export type QuestionnaireTemplate = (typeof QUESTIONNAIRE_TEMPLATES)[number];

export const QUESTIONNAIRE_LOCALES = ["cs", "en"] as const;
export type QuestionnaireLocale = (typeof QUESTIONNAIRE_LOCALES)[number];

export const QUESTIONNAIRE_ANSWERS = ["yes", "partial", "no", "na"] as const;
export type QuestionnaireAnswerValue = (typeof QUESTIONNAIRE_ANSWERS)[number];

/** sent = odesláno (dodavatel může průběžně ukládat), submitted = odevzdáno, evaluated = vyhodnoceno, cancelled = zrušeno. */
export const QUESTIONNAIRE_STATUSES = ["sent", "submitted", "evaluated", "cancelled"] as const;
export type QuestionnaireStatus = (typeof QUESTIONNAIRE_STATUSES)[number];

export type Bilingual = Record<QuestionnaireLocale, string>;

export interface QuestionnaireSection {
  key: string;
  title: Bilingual;
}

export interface QuestionnaireQuestion {
  key: string;
  section: string;
  text: Bilingual;
  /** Klíčová otázka – odpověď „ne“ znamená vysoké riziko bez ohledu na celkové skóre. */
  critical?: boolean;
  /** Zahrnuto i ve zkrácené verzi pro režim nižších povinností (vyhl. 410). */
  lite?: boolean;
  /** Související ustanovení přílohy č. 5 vyhl. 409 (písmeno), jen orientačně. */
  clause?: string;
  /** Lze odpovědět „netýká se“. */
  allowNa?: boolean;
}

export const QUESTIONNAIRE_SECTIONS: QuestionnaireSection[] = [
  { key: "gov", title: { cs: "Řízení bezpečnosti", en: "Security governance" } },
  { key: "hr", title: { cs: "Lidské zdroje", en: "People" } },
  { key: "acc", title: { cs: "Řízení přístupu", en: "Access control" } },
  { key: "ops", title: { cs: "Provoz a technická opatření", en: "Operations and technical controls" } },
  { key: "inc", title: { cs: "Incidenty a kontinuita", en: "Incidents and continuity" } },
  { key: "data", title: { cs: "Subdodavatelé, data a ukončení spolupráce", en: "Subcontractors, data and exit" } },
];

export const QUESTIONNAIRE_QUESTIONS: QuestionnaireQuestion[] = [
  { key: "gov.policy", section: "gov", critical: true, lite: true, text: { cs: "Má vaše organizace schválenou bezpečnostní politiku, kterou pravidelně přezkoumává?", en: "Does your organization have an approved information security policy that is reviewed regularly?" } },
  { key: "gov.roles", section: "gov", lite: true, text: { cs: "Jsou určeny osoby odpovědné za kybernetickou bezpečnost a kontakt pro bezpečnostní záležitosti?", en: "Are persons responsible for cybersecurity and a contact for security matters designated?" } },
  { key: "gov.cert", section: "gov", lite: true, text: { cs: "Máte platnou certifikaci nebo atestaci bezpečnosti (např. ISO/IEC 27001, SOC 2) pokrývající služby pro nás?", en: "Do you hold a valid security certification or attestation (e.g. ISO/IEC 27001, SOC 2) covering the services provided to us?" } },
  { key: "gov.risk", section: "gov", clause: "i", text: { cs: "Řídíte rizika související s plněním pro nás a můžete nás informovat o zbytkových rizicích?", en: "Do you manage the risks related to the services provided to us and can you inform us about residual risks?" } },
  { key: "gov.policies", section: "gov", lite: true, clause: "f", text: { cs: "Zavážete se dodržovat naše bezpečnostní politiky, případně nám předložíte své k odsouhlasení?", en: "Will you commit to comply with our security policies, or submit your own policies for our approval?" } },
  { key: "hr.nda", section: "hr", critical: true, lite: true, clause: "a", text: { cs: "Jsou vaši zaměstnanci a externí pracovníci vázáni mlčenlivostí?", en: "Are your employees and contractors bound by confidentiality obligations?" } },
  { key: "hr.training", section: "hr", lite: true, text: { cs: "Absolvují pracovníci pravidelné školení bezpečnostního povědomí?", en: "Do your staff complete regular security awareness training?" } },
  { key: "hr.persons", section: "hr", clause: "i", text: { cs: "Můžete nám sdělit, které osoby přijdou do styku s našimi důvěrnými informacemi (např. administrátoři, penetrační testeři)?", en: "Can you tell us which persons will come into contact with our confidential information (e.g. administrators, penetration testers)?" } },
  { key: "acc.mfa", section: "acc", critical: true, lite: true, text: { cs: "Používáte vícefaktorové ověřování pro vzdálený a privilegovaný přístup?", en: "Do you use multi-factor authentication for remote and privileged access?" } },
  { key: "acc.least", section: "acc", lite: true, text: { cs: "Přidělujete oprávnění podle principu nejnižších oprávnění a pravidelně je přezkoumáváte?", en: "Do you grant access on a least-privilege basis and review it regularly?" } },
  { key: "acc.leavers", section: "acc", text: { cs: "Odebíráte přístupy neprodleně po ukončení spolupráce s pracovníkem?", en: "Do you revoke access promptly when a worker leaves?" } },
  { key: "acc.logging", section: "acc", text: { cs: "Zaznamenáváte a vyhodnocujete bezpečnostní události systémů, které při plnění pro nás používáte?", en: "Do you log and review security events of the systems you use to deliver services to us?" } },
  { key: "ops.patch", section: "ops", critical: true, lite: true, text: { cs: "Máte zavedené řízení zranitelností a včasnou instalaci bezpečnostních aktualizací?", en: "Do you have vulnerability management and timely installation of security updates in place?" } },
  { key: "ops.malware", section: "ops", lite: true, text: { cs: "Chráníte systémy a koncová zařízení proti škodlivému kódu?", en: "Do you protect systems and endpoints against malicious code?" } },
  { key: "ops.crypto", section: "ops", critical: true, text: { cs: "Šifrujete naše data při přenosu i uložení podle aktuálních doporučení (např. NÚKIB)?", en: "Do you encrypt our data in transit and at rest according to current recommendations (e.g. NÚKIB)?" } },
  { key: "ops.backup", section: "ops", lite: true, text: { cs: "Zálohujete data a pravidelně ověřujete obnovu ze zálohy?", en: "Do you back up data and regularly test restoring from backup?" } },
  { key: "ops.change", section: "ops", lite: true, clause: "g", text: { cs: "Řídíte změny systémů a informujete nás o změnách s dopadem na poskytovanou službu?", en: "Do you manage system changes and inform us about changes that affect the service?" } },
  { key: "ops.devsec", section: "ops", lite: true, clause: "m", allowNa: true, text: { cs: "Dodržujete pravidla bezpečného vývoje (pokud pro nás vyvíjíte nebo upravujete software)?", en: "Do you follow secure development practices (if you develop or modify software for us)?" } },
  { key: "ops.pentest", section: "ops", text: { cs: "Provádíte pravidelné penetrační testy nebo skeny zranitelností?", en: "Do you perform regular penetration tests or vulnerability scans?" } },
  { key: "inc.process", section: "inc", critical: true, lite: true, text: { cs: "Máte postup pro detekci a zvládání kybernetických bezpečnostních incidentů?", en: "Do you have a procedure for detecting and handling cybersecurity incidents?" } },
  { key: "inc.notify", section: "inc", critical: true, lite: true, clause: "i", text: { cs: "Zavážete se nás bez zbytečného odkladu informovat o incidentech souvisejících s plněním pro nás?", en: "Will you commit to notify us without undue delay of incidents related to the services provided to us?" } },
  { key: "inc.bcm", section: "inc", lite: true, clause: "k", text: { cs: "Máte plány kontinuity a obnovy pro služby, které nám poskytujete, a pravidelně je testujete?", en: "Do you have continuity and recovery plans for the services provided to us, and do you test them regularly?" } },
  { key: "inc.sla", section: "inc", lite: true, clause: "l", text: { cs: "Garantujete úroveň služeb (SLA) včetně dostupnosti a doby obnovení?", en: "Do you guarantee service levels (SLA) including availability and recovery time?" } },
  { key: "data.subcontractors", section: "data", lite: true, clause: "e", text: { cs: "Zavazujete subdodavatele ke stejným bezpečnostním požadavkům a informujete nás o nich?", en: "Do you bind subcontractors to the same security requirements and inform us about them?" } },
  { key: "data.location", section: "data", critical: true, text: { cs: "Jsou naše data zpracovávána a uložena výhradně v České republice nebo v EU?", en: "Is our data processed and stored exclusively in the Czech Republic or the EU?" } },
  { key: "data.foreign", section: "data", clause: "r", text: { cs: "Budete nás informovat o žádosti cizího státního orgánu o zpřístupnění našich dat a vyhovíte jí jen v nezbytném rozsahu po přezkoumání zákonnosti?", en: "Will you inform us of any request by a foreign authority to access our data, and comply only to the necessary extent after reviewing its lawfulness?" } },
  { key: "data.control", section: "data", clause: "i", text: { cs: "Informujete nás o významné změně ovládání vaší společnosti nebo vlastnictví zásadních aktiv používaných k plnění?", en: "Will you inform us of a significant change of control of your company or of ownership of key assets used for the services?" } },
  { key: "data.disposal", section: "data", lite: true, clause: "o", text: { cs: "Máte pravidla pro bezpečnou likvidaci dat a nosičů?", en: "Do you have rules for secure disposal of data and media?" } },
  { key: "data.exit", section: "data", lite: true, clause: "j", text: { cs: "Umožníte při ukončení spolupráce předání dat v dohodnutém formátu a přechodné období (exit strategie)?", en: "When the cooperation ends, will you hand over data in an agreed format and provide a transition period (exit strategy)?" } },
  { key: "data.audit", section: "data", critical: true, lite: true, clause: "d", text: { cs: "Umožníte nám nebo pověřenému auditorovi kontrolu zavedených bezpečnostních opatření?", en: "Will you allow us or an appointed auditor to verify the security measures in place?" } },
];

/** Otázky šablony (vyhl. 409 = všechny, vyhl. 410 = zkrácená sada). */
export function questionsFor(template: QuestionnaireTemplate): QuestionnaireQuestion[] {
  return template === "cz410" ? QUESTIONNAIRE_QUESTIONS.filter((q) => q.lite) : QUESTIONNAIRE_QUESTIONS;
}

export const QUESTIONNAIRE_LABELS = {
  template: { cz409: "Úplný (vyšší povinnosti, vyhl. 409)", cz410: "Zkrácený (nižší povinnosti, vyhl. 410)" } satisfies Record<QuestionnaireTemplate, string>,
  status: { sent: "Čeká na dodavatele", submitted: "Vyplněno – k vyhodnocení", evaluated: "Vyhodnoceno", cancelled: "Zrušeno" } satisfies Record<QuestionnaireStatus, string>,
  answer: { yes: "Ano", partial: "Částečně", no: "Ne", na: "Netýká se" } satisfies Record<QuestionnaireAnswerValue, string>,
  level: { low: "Nízké", medium: "Střední", high: "Vysoké" } satisfies Record<SupplierRiskLevel, string>,
} as const;

/** Popisky na veřejné stránce dodavatele (bez přihlášení, jazyk dotazníku). */
export const QUESTIONNAIRE_ANSWER_TEXT: Record<QuestionnaireLocale, Record<QuestionnaireAnswerValue, string>> = {
  cs: QUESTIONNAIRE_LABELS.answer,
  en: { yes: "Yes", partial: "Partially", no: "No", na: "Not applicable" },
};

export const QuestionnaireAnswer = z.object({
  value: z.enum(QUESTIONNAIRE_ANSWERS),
  comment: z.string().trim().max(2000).optional().nullable(),
  /** Odkaz nebo označení podkladu (certifikát, politika…). */
  evidence: z.string().trim().max(500).optional().nullable(),
});
export type QuestionnaireAnswer = z.infer<typeof QuestionnaireAnswer>;
export type QuestionnaireAnswers = Record<string, QuestionnaireAnswer>;

export const QuestionnaireCreateInput = z.object({
  template: z.enum(QUESTIONNAIRE_TEMPLATES).default("cz409"),
  locale: z.enum(QUESTIONNAIRE_LOCALES).default("cs"),
  title: z.string().trim().min(1).max(300).optional(),
  /** Platnost odkazu ve dnech. */
  validDays: z.number().int().min(1).max(180).default(30),
  /** Poslat odkaz e-mailem (na kontaktní e-mail dodavatele nebo `email`). */
  sendEmail: z.boolean().default(false),
  email: z.string().trim().email().max(200).optional().nullable(),
  /** Poznámka pro dodavatele (zobrazí se nad otázkami). */
  message: z.string().trim().max(2000).optional().nullable(),
});
export type QuestionnaireCreateInput = z.input<typeof QuestionnaireCreateInput>;

/** Uložení rozpracovaných odpovědí (veřejně) – neúplné odpovědi jsou dovoleny. */
export const QuestionnaireSaveInput = z.object({
  answers: z.record(z.string().max(60), QuestionnaireAnswer).refine((a) => Object.keys(a).length <= 100, "Příliš mnoho odpovědí"),
  respondentName: z.string().trim().max(200).optional().nullable(),
  respondentEmail: z.string().trim().max(200).optional().nullable(),
  respondentRole: z.string().trim().max(200).optional().nullable(),
  generalNote: z.string().trim().max(4000).optional().nullable(),
});
export type QuestionnaireSaveInput = z.input<typeof QuestionnaireSaveInput>;

/** Odevzdání – jméno a e-mail vyplňující osoby jsou povinné, odpovědi musí být úplné (kontroluje API podle šablony). */
export const QuestionnaireSubmitInput = QuestionnaireSaveInput.extend({
  respondentName: z.string().trim().min(1).max(200),
  respondentEmail: z.string().trim().email().max(200),
});
export type QuestionnaireSubmitInput = z.input<typeof QuestionnaireSubmitInput>;

export const QuestionnaireEvaluateInput = z.object({
  note: z.string().trim().max(4000).optional().nullable(),
  /** Zapsat k dodavateli datum hodnocení rizik (§ 9 odst. 2 písm. a). */
  markRiskAssessed: z.boolean().default(true),
});
export type QuestionnaireEvaluateInput = z.input<typeof QuestionnaireEvaluateInput>;

export const SUPPLIER_RISK_LEVELS = ["low", "medium", "high"] as const;
export type SupplierRiskLevel = (typeof SUPPLIER_RISK_LEVELS)[number];

export interface QuestionnaireGap {
  key: string;
  section: string;
  value: "no" | "partial";
  critical: boolean;
  comment: string | null;
}

export interface QuestionnaireScore {
  /** 0–100 (ano = 1, částečně = ½, ne = 0; klíčové otázky mají dvojnásobnou váhu; „netýká se“ se nepočítá). */
  score: number | null;
  answered: number;
  total: number;
  /** Nezodpovězené otázky šablony. */
  missing: string[];
  gaps: QuestionnaireGap[];
  /** Klíčové otázky s odpovědí „ne“. */
  criticalNo: number;
  level: SupplierRiskLevel | null;
}

/** Vyhodnocení odpovědí: skóre, mezery a navržená úroveň rizika dodavatele (návrh, rozhoduje člověk). */
export function scoreQuestionnaire(template: QuestionnaireTemplate, answers: QuestionnaireAnswers): QuestionnaireScore {
  const qs = questionsFor(template);
  let sum = 0;
  let max = 0;
  let answered = 0;
  const missing: string[] = [];
  const gaps: QuestionnaireGap[] = [];
  let criticalNo = 0;
  let criticalPartial = 0;
  for (const q of qs) {
    const a = answers[q.key];
    if (!a || (a.value === "na" && !q.allowNa)) {
      missing.push(q.key);
      continue;
    }
    answered++;
    if (a.value === "na") continue;
    const w = q.critical ? 2 : 1;
    max += w;
    sum += a.value === "yes" ? w : a.value === "partial" ? w / 2 : 0;
    if (a.value !== "yes") gaps.push({ key: q.key, section: q.section, value: a.value, critical: !!q.critical, comment: a.comment ?? null });
    if (q.critical && a.value === "no") criticalNo++;
    if (q.critical && a.value === "partial") criticalPartial++;
  }
  const score = max ? Math.round((sum / max) * 100) : null;
  const level: SupplierRiskLevel | null =
    score == null || missing.length ? null : criticalNo > 0 || score < 50 ? "high" : criticalPartial > 0 || score < 80 ? "medium" : "low";
  gaps.sort((a, b) => Number(b.critical) - Number(a.critical) || (a.value === b.value ? 0 : a.value === "no" ? -1 : 1));
  return { score, answered, total: qs.length, missing, gaps, criticalNo, level };
}

/** Odkaz už neplatí (vypršel a dotazník ještě nebyl odevzdán). */
export const questionnaireExpired = (q: { status: QuestionnaireStatus; expiresAt: string }, now = new Date()) =>
  q.status === "sent" && new Date(q.expiresAt) < now;

/** Přílohy dodavatele: limity a povolené přípony (typ obsahu určuje server podle přípony). */
export const QUESTIONNAIRE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const QUESTIONNAIRE_FILES_MAX = 20;
export const QUESTIONNAIRE_FILES_TOTAL_MAX = 50 * 1024 * 1024;
export const QUESTIONNAIRE_FILE_EXTENSIONS = ["pdf", "docx", "doc", "xlsx", "xls", "odt", "ods", "pptx", "png", "jpg", "jpeg", "txt", "csv"] as const;
export const questionnaireFileAllowed = (name: string) => (QUESTIONNAIRE_FILE_EXTENSIONS as readonly string[]).includes(name.split(".").pop()?.toLowerCase() ?? "");

export interface QuestionnaireFileDto {
  id: string;
  /** Otázka, ke které soubor patří (null = obecná příloha). */
  questionKey: string | null;
  filename: string;
  size: number;
  uploadedAt: string;
}

export interface QuestionnaireDto {
  id: string;
  supplierId: string;
  companyId: string;
  title: string;
  template: QuestionnaireTemplate;
  locale: QuestionnaireLocale;
  status: QuestionnaireStatus;
  expired: boolean;
  expiresAt: string;
  sentAt: string;
  sentTo: string | null;
  message: string | null;
  submittedAt: string | null;
  respondentName: string | null;
  respondentEmail: string | null;
  respondentRole: string | null;
  generalNote: string | null;
  answers: QuestionnaireAnswers;
  result: QuestionnaireScore;
  evaluatedAt: string | null;
  evaluatedByName: string | null;
  evaluationNote: string | null;
  riskId: string | null;
  createdByName: string | null;
  /** Rozpracováno dodavatelem (uložené odpovědi před odevzdáním). */
  lastSavedAt: string | null;
  files: QuestionnaireFileDto[];
}

/** Veřejný pohled dodavatele (bez interních údajů). */
export interface PublicQuestionnaireDto {
  title: string;
  organization: string;
  supplierName: string;
  template: QuestionnaireTemplate;
  locale: QuestionnaireLocale;
  status: "open" | "submitted" | "closed";
  expiresAt: string;
  message: string | null;
  sections: { key: string; title: string }[];
  questions: { key: string; section: string; text: string; critical: boolean; allowNa: boolean }[];
  answers: QuestionnaireAnswers;
  respondentName: string | null;
  respondentEmail: string | null;
  respondentRole: string | null;
  generalNote: string | null;
  submittedAt: string | null;
  files: QuestionnaireFileDto[];
}

/** Texty veřejné stránky dotazníku (bez přihlášení se nenačítá jazykový balíček uživatele). */
export const QUESTIONNAIRE_PUBLIC_TEXT: Record<QuestionnaireLocale, Record<string, string>> = {
  cs: {
    attach: "Přiložit soubor",
    attachGeneral: "Další přílohy (certifikáty, politiky, zprávy z auditů)",
    attachHint: "PDF, Office, obrázek nebo text, nejvýš 10 MB na soubor, celkem 20 souborů.",
    removeFile: "Odebrat",
    uploading: "Nahrávám…",
    heading: "Bezpečnostní dotazník pro dodavatele",
    intro: "{organization} vás žádá o vyplnění bezpečnostního dotazníku jako podkladu pro hodnocení rizik dodavatelů podle zákona o kybernetické bezpečnosti. Odpovědi můžete průběžně ukládat a odevzdat do {date}.",
    supplier: "Dodavatel",
    critical: "klíčová otázka",
    comment: "Komentář (u odpovědí Částečně / Ne prosím uveďte, co chybí nebo kdy bude doplněno)",
    evidence: "Podklad (odkaz, označení certifikátu nebo dokumentu)",
    respondent: "Kdo dotazník vyplnil",
    name: "Jméno a příjmení",
    email: "E-mail",
    role: "Funkce",
    generalNote: "Další informace pro nás",
    save: "Uložit rozpracované",
    saved: "Uloženo. K dotazníku se můžete vrátit přes stejný odkaz.",
    submit: "Odevzdat dotazník",
    confirmSubmit: "Po odevzdání už odpovědi nepůjde změnit. Odevzdat?",
    missing: "Zbývá zodpovědět: {n}",
    submitted: "Děkujeme, dotazník byl odevzdán {date}.",
    closed: "Odkaz už není platný. Obraťte se prosím na kontaktní osobu zadavatele.",
    progress: "Zodpovězeno {answered} z {total}",
  },
  en: {
    attach: "Attach file",
    attachGeneral: "Other attachments (certificates, policies, audit reports)",
    attachHint: "PDF, Office, image or text, up to 10 MB per file, 20 files in total.",
    removeFile: "Remove",
    uploading: "Uploading…",
    heading: "Supplier security questionnaire",
    intro: "{organization} asks you to complete a security questionnaire as input for the supplier risk assessment required by the Czech Cybersecurity Act. You can save your answers as you go and submit them by {date}.",
    supplier: "Supplier",
    critical: "key question",
    comment: "Comment (for Partially / No, please describe what is missing or when it will be in place)",
    evidence: "Supporting evidence (link, certificate or document reference)",
    respondent: "Completed by",
    name: "Full name",
    email: "E-mail",
    role: "Position",
    generalNote: "Additional information for us",
    save: "Save draft",
    saved: "Saved. You can return to the questionnaire using the same link.",
    submit: "Submit questionnaire",
    confirmSubmit: "Answers cannot be changed after submission. Submit?",
    missing: "Questions left: {n}",
    submitted: "Thank you, the questionnaire was submitted on {date}.",
    closed: "This link is no longer valid. Please contact the person who sent it to you.",
    progress: "Answered {answered} of {total}",
  },
};
