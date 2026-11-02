/* ============================================================
 * Šablona interní směrnice o používání umělé inteligence a jednostránkového shrnutí pro zaměstnance (ADR-090).
 * Vlastní text CONTIXu (ne text předpisu) – organizace ho po vytvoření v DMS upraví, nechá schválit a vyžádá seznámení s testem.
 * ============================================================ */

export interface AiDirectiveParams {
  org: string;
  /** Schválené AI nástroje z registru (název – účel). */
  tools: { name: string; purpose: string }[];
  locale: "cs" | "en";
}

export interface AiDirectiveTemplate {
  directive: { title: string; description: string; content: string };
  summary: { title: string; description: string; content: string };
  quiz: { question: string; options: string[]; correct: number[] }[];
  courseTitle: string;
  courseDescription: string;
}

const toolList = (p: AiDirectiveParams, none: string) =>
  p.tools.length ? p.tools.map((t) => `- **${t.name}**${t.purpose ? ` – ${t.purpose.replace(/\s+/g, " ").slice(0, 200)}` : ""}`).join("\n") : `- ${none}`;

function cs(p: AiDirectiveParams): AiDirectiveTemplate {
  const directive = `# Směrnice o používání umělé inteligence

**Organizace:** ${p.org}

## 1. Účel a rozsah
1. Směrnice stanoví pravidla pro výběr, schvalování a používání systémů umělé inteligence (AI) v organizaci tak, aby bylo jejich používání bezpečné, v souladu s nařízením (EU) 2024/1689 o umělé inteligenci (AI Act), s GDPR a s pravidly bezpečnosti informací.
2. Směrnice se vztahuje na všechny zaměstnance a další osoby, které pro organizaci pracují (dále jen „uživatelé“), a na všechny AI nástroje – cloudové služby, funkce AI v jiných aplikacích, lokálně provozované modely i vlastní vývoj.

## 2. Pojmy
- **Systém AI** – strojový systém, který z přijatých vstupů odvozuje výstupy, jako jsou predikce, obsah, doporučení nebo rozhodnutí.
- **Zavádějící subjekt** – organizace, která systém AI používá v rámci své činnosti.
- **Registr AI systémů** – evidence schválených a posuzovaných AI systémů vedená v CONTIXu.
- **Vlastník AI systému** – funkční místo odpovědné za účel, schválení a dodržování povinností u konkrétního systému.

## 3. Základní zásady
1. Používat lze jen AI nástroje **schválené a zapsané v registru AI systémů**. Seznam je dostupný uživatelům na portálu dokumentace.
2. **Odpovědnost za výsledek nese vždy člověk.** Výstup AI je návrh – uživatel ho před použitím zkontroluje (věcná správnost, úplnost, aktuálnost, zdroje).
3. AI se nesmí používat k **zakázaným praktikám** podle čl. 5 AI Act (manipulace, zneužívání zranitelnosti, sociální skóre, rozpoznávání emocí na pracovišti, necílené sbírání snímků obličejů apod.).
4. AI nesmí sama rozhodovat o právech a povinnostech osob (např. přijetí, hodnocení nebo propuštění zaměstnance, nárok na službu) bez lidského posouzení a schválení vlastníkem systému.

## 4. Schválené AI nástroje
${toolList(p, "Seznam schválených nástrojů vede registr AI systémů v CONTIXu.")}

## 5. Ochrana informací a osobních údajů
1. Do AI nástrojů, které nejsou schválené pro daný stupeň klasifikace, se **nesmí vkládat** důvěrné a interní informace, osobní údaje, přístupové údaje, zdrojové kódy, smlouvy ani informace o zranitelnostech a incidentech.
2. Osobní údaje lze zpracovávat jen v nástroji, u kterého je to v registru výslovně povoleno a který je navázán na záznam o činnosti zpracování (GDPR); je-li to třeba, zpracuje se posouzení vlivu (DPIA).
3. Uživatel používá pouze firemní účet a vypíná ukládání historie a použití dat k tréninku modelu, pokud to nástroj umožňuje.

## 6. Kontrola výstupů a autorská práva
1. Výstupy AI mohou obsahovat chyby, vymyšlené údaje nebo neaktuální informace – vždy je ověřte.
2. Při použití vygenerovaného textu, obrázku nebo kódu dbejte na autorská práva a licenční podmínky; kód z AI prochází běžnou kontrolou (code review).

## 7. Transparentnost
1. Komunikuje-li s klienty nebo veřejností chatbot či jiný systém AI, musí být zřejmé, že jde o AI.
2. Obsah vytvořený nebo upravený AI, který by mohl působit jako skutečný (deepfake), se označuje. Texty zveřejněné k informování veřejnosti se označí, pokud neprošly lidskou redakcí.

## 8. Zavedení nového AI nástroje
1. Zájemce podá návrh vlastníkovi AI systémů / manažerovi kybernetické bezpečnosti; nástroj se zapíše do registru se stavem „Navrženo ke schválení“.
2. Před schválením se provede **screening** (zakázané praktiky, klasifikace rizika, transparentnost), posoudí se dodavatel, umístění dat, smluvní podmínky a bezpečnost.
3. U **vysoce rizikových** systémů se navíc určí osoba pro lidský dohled, zajistí uchovávání logů, informování dotčených osob a zaměstnanců a případně posouzení dopadu na základní práva (FRIA) a DPIA.
4. Nástroj schvaluje vlastník AI systému po vyjádření bezpečnosti a pověřence pro ochranu osobních údajů.

## 9. AI gramotnost
Organizace přijímá opatření k podpoře AI gramotnosti (čl. 4 AI Act): každý uživatel se před prvním použitím seznámí s touto směrnicí a jejím shrnutím, absolvuje test porozumění a pravidelné školení. Osoby pověřené lidským dohledem absolvují rozšířené školení k danému systému.

## 10. Odpovědnosti
- **Vedení organizace** – schvaluje směrnici a zajišťuje zdroje.
- **Gestor směrnice / vlastník AI systémů** – vede registr, posuzuje návrhy, přezkoumává systémy a směrnici.
- **Manažer kybernetické bezpečnosti** – posuzuje bezpečnost nástrojů a dodavatelů.
- **Pověřenec pro ochranu osobních údajů** – posuzuje zpracování osobních údajů a DPIA.
- **Vedoucí zaměstnanci** – dohlížejí na dodržování směrnice ve svém útvaru.
- **Uživatelé** – dodržují směrnici a hlásí problémy.

## 11. Hlášení problémů a incidentů
Chybný, škodlivý nebo diskriminační výstup, únik dat do AI nástroje nebo podezření na zneužití uživatel neprodleně nahlásí jako bezpečnostní událost. U vysoce rizikových systémů vlastník informuje poskytovatele a orgán dozoru podle AI Act.

## 12. Kontrola a přezkum
Dodržování směrnice se kontroluje v rámci interních auditů. Směrnice a registr AI systémů se přezkoumávají nejméně jednou ročně a při významné změně předpisů nebo používaných nástrojů. Porušení směrnice může být posouzeno jako porušení pracovních povinností.
`;
  const summary = `# Umělá inteligence v práci – shrnutí pro zaměstnance

Toto shrnutí vychází ze **Směrnice o používání umělé inteligence**. Přečtěte si ho a potvrďte seznámení testem.

## Smíte
- Používat **jen schválené AI nástroje** z registru (seznam na portálu dokumentace).
- Nechat si pomoci s texty, shrnutím, překladem, nápady a kódem – výsledek ale vždy **zkontrolujte**.
- Ptát se gestora směrnice nebo bezpečnosti, když si nejste jistí.

## Nesmíte
- Vkládat do neschválených nástrojů **důvěrné nebo interní informace, osobní údaje, hesla, smlouvy ani zdrojové kódy**.
- Nechat AI **rozhodovat o lidech** (nábor, hodnocení, nárok na službu) bez lidského posouzení.
- Používat AI k manipulaci, sledování emocí kolegů nebo k jiným **zakázaným praktikám**.
- Vydávat obsah vytvořený AI, který působí jako skutečný (deepfake), bez označení.

## Nezapomeňte
1. **Za výsledek odpovídáte vy**, ne AI – ověřte fakta, čísla a zdroje.
2. Používejte **firemní účet** a vypněte ukládání historie / trénink na vašich datech, pokud to jde.
3. Komunikuje-li s klienty chatbot, musí být jasné, že jde o AI.
4. Chybu, únik dat nebo podezřelý výstup **hlaste hned** jako bezpečnostní událost.
5. Nový AI nástroj? Nejdřív **návrh ke schválení**, pak používání.
`;
  return {
    directive: { title: "Směrnice o používání umělé inteligence", description: "Pravidla výběru, schvalování a používání AI nástrojů (AI Act, GDPR, bezpečnost informací). Vytvořeno ze šablony CONTIX – před schválením upravte podle organizace.", content: directive },
    summary: { title: "Umělá inteligence v práci – shrnutí pro zaměstnance", description: "Jednostránkové shrnutí směrnice o AI se seznámením a testem porozumění (AI gramotnost, čl. 4 AI Act).", content: summary },
    quiz: [
      { question: "Které AI nástroje smíte v práci používat?", options: ["Jakýkoli volně dostupný nástroj", "Jen nástroje schválené a zapsané v registru AI systémů", "Jakýkoli nástroj, pokud ho používám ze soukromého účtu"], correct: [1] },
      { question: "Kdo odpovídá za správnost výstupu, který AI připravila?", options: ["Poskytovatel AI nástroje", "Uživatel, který výstup použije", "Nikdo – AI se nemýlí"], correct: [1] },
      { question: "Co nesmíte vložit do neschváleného AI nástroje?", options: ["Osobní údaje klientů a zaměstnanců", "Hesla a přístupové údaje", "Veřejně dostupný text z našeho webu", "Interní smlouvy a zdrojové kódy"], correct: [0, 1, 3] },
      { question: "Smí AI sama rozhodnout o přijetí uchazeče o zaměstnání?", options: ["Ano, pokud je nástroj schválený", "Ne – o lidech rozhoduje člověk, AI může nanejvýš pomáhat"], correct: [1] },
      { question: "Co uděláte, když AI nástroj vrátí škodlivý výstup nebo do něj omylem vložíte důvěrná data?", options: ["Nic, výstup smažu", "Neprodleně to nahlásím jako bezpečnostní událost", "Počkám na další školení"], correct: [1] },
      { question: "Jak postupovat, když chcete začít používat nový AI nástroj?", options: ["Zaregistruji se a začnu ho používat", "Podám návrh ke schválení – nástroj projde posouzením a zápisem do registru"], correct: [1] },
    ],
    courseTitle: "AI gramotnost – pravidla používání umělé inteligence",
    courseDescription: "Seznámení se směrnicí o AI a jejím shrnutím a test porozumění (čl. 4 AI Act). Opakuje se ročně.",
  };
}

function en(p: AiDirectiveParams): AiDirectiveTemplate {
  const directive = `# Directive on the Use of Artificial Intelligence

**Organisation:** ${p.org}

## 1. Purpose and scope
1. This directive sets rules for selecting, approving and using artificial intelligence (AI) systems so that their use is safe and complies with Regulation (EU) 2024/1689 (AI Act), the GDPR and the organisation's information security rules.
2. It applies to all employees and other persons working for the organisation ("users") and to all AI tools – cloud services, AI features in other applications, locally hosted models and in-house development.

## 2. Definitions
- **AI system** – a machine-based system that infers from the input it receives how to generate outputs such as predictions, content, recommendations or decisions.
- **Deployer** – the organisation using an AI system in the course of its activities.
- **AI system register** – the record of approved and assessed AI systems kept in CONTIX.
- **AI system owner** – the position responsible for the purpose, approval and obligations of a given system.

## 3. Principles
1. Only AI tools **approved and recorded in the AI system register** may be used. The list is available on the documentation portal.
2. **A human is always accountable for the result.** AI output is a draft – the user checks it before use (accuracy, completeness, currency, sources).
3. AI must not be used for **prohibited practices** under Art. 5 AI Act (manipulation, exploiting vulnerabilities, social scoring, emotion recognition at the workplace, untargeted scraping of facial images, etc.).
4. AI must not decide on people's rights and obligations (e.g. hiring, evaluating or dismissing an employee, eligibility for a service) without human assessment and approval by the system owner.

## 4. Approved AI tools
${toolList(p, "The list of approved tools is kept in the AI system register in CONTIX.")}

## 5. Protection of information and personal data
1. Confidential and internal information, personal data, credentials, source code, contracts and information about vulnerabilities and incidents **must not be entered** into AI tools that are not approved for that classification level.
2. Personal data may be processed only in a tool explicitly permitted for it in the register and linked to a record of processing activities (GDPR); a DPIA is carried out where required.
3. Users use only their company account and disable history and model training on their data where the tool allows.

## 6. Output review and copyright
1. AI output may contain errors, fabricated facts or outdated information – always verify it.
2. When using generated text, images or code, respect copyright and licence terms; AI-generated code goes through the usual code review.

## 7. Transparency
1. When a chatbot or other AI system communicates with clients or the public, it must be clear that it is AI.
2. Content generated or manipulated by AI that could appear authentic (deep fake) is labelled. Texts published to inform the public are labelled unless they underwent human editorial review.

## 8. Introducing a new AI tool
1. The requester submits a proposal to the AI system owner / cybersecurity manager; the tool is recorded in the register as "Proposed for approval".
2. Before approval, a **screening** is carried out (prohibited practices, risk classification, transparency) and the supplier, data location, contract terms and security are assessed.
3. For **high-risk** systems, a person for human oversight is assigned, log retention is ensured, affected persons and employees are informed and, where required, a fundamental rights impact assessment (FRIA) and DPIA are carried out.
4. The tool is approved by the AI system owner after the opinion of security and the data protection officer.

## 9. AI literacy
The organisation takes measures to support AI literacy (Art. 4 AI Act): every user reads this directive and its summary before first use, passes a comprehension test and attends regular training. Persons assigned to human oversight receive extended training for the system.

## 10. Responsibilities
- **Management** – approves the directive and provides resources.
- **Directive owner / AI system owner** – keeps the register, assesses proposals, reviews systems and the directive.
- **Cybersecurity manager** – assesses the security of tools and suppliers.
- **Data protection officer** – assesses personal data processing and DPIAs.
- **Line managers** – oversee compliance in their units.
- **Users** – follow the directive and report problems.

## 11. Reporting problems and incidents
Incorrect, harmful or discriminatory output, data leakage into an AI tool or suspected misuse is reported without delay as a security event. For high-risk systems, the owner informs the provider and the supervisory authority under the AI Act.

## 12. Monitoring and review
Compliance is checked in internal audits. The directive and the AI system register are reviewed at least annually and upon significant changes in legislation or the tools used. Breaching the directive may be treated as a breach of work duties.
`;
  const summary = `# AI at work – summary for employees

This summary is based on the **Directive on the Use of Artificial Intelligence**. Read it and confirm by passing the test.

## You may
- Use **only approved AI tools** from the register (see the documentation portal).
- Get help with texts, summaries, translation, ideas and code – but always **check** the result.
- Ask the directive owner or security when in doubt.

## You must not
- Enter **confidential or internal information, personal data, passwords, contracts or source code** into tools that are not approved.
- Let AI **decide about people** (hiring, evaluation, eligibility) without human assessment.
- Use AI for manipulation, monitoring colleagues' emotions or other **prohibited practices**.
- Publish AI-generated content that looks authentic (deep fake) without a label.

## Remember
1. **You are accountable for the result**, not the AI – verify facts, numbers and sources.
2. Use your **company account** and switch off history / training on your data where possible.
3. When a chatbot talks to clients, it must be clear that it is AI.
4. Report errors, data leakage or suspicious output **immediately** as a security event.
5. New AI tool? **Proposal for approval** first, use afterwards.
`;
  return {
    directive: { title: "Directive on the Use of Artificial Intelligence", description: "Rules for selecting, approving and using AI tools (AI Act, GDPR, information security). Created from the CONTIX template – adapt before approval.", content: directive },
    summary: { title: "AI at work – summary for employees", description: "One-page summary of the AI directive with acknowledgement and comprehension test (AI literacy, Art. 4 AI Act).", content: summary },
    quiz: [
      { question: "Which AI tools may you use at work?", options: ["Any freely available tool", "Only tools approved and recorded in the AI system register", "Any tool used with my private account"], correct: [1] },
      { question: "Who is accountable for the correctness of AI-prepared output?", options: ["The AI tool provider", "The user who uses the output", "Nobody – AI does not make mistakes"], correct: [1] },
      { question: "What must you not enter into an unapproved AI tool?", options: ["Personal data of clients and employees", "Passwords and credentials", "Public text from our website", "Internal contracts and source code"], correct: [0, 1, 3] },
      { question: "May AI decide on hiring a job applicant on its own?", options: ["Yes, if the tool is approved", "No – people decide about people, AI may only assist"], correct: [1] },
      { question: "What do you do if an AI tool returns harmful output or you accidentally enter confidential data?", options: ["Nothing, I delete the output", "Report it without delay as a security event", "Wait for the next training"], correct: [1] },
      { question: "How do you start using a new AI tool?", options: ["Sign up and start using it", "Submit a proposal for approval – the tool is assessed and recorded in the register"], correct: [1] },
    ],
    courseTitle: "AI literacy – rules for using artificial intelligence",
    courseDescription: "Acknowledgement of the AI directive and its summary and a comprehension test (Art. 4 AI Act). Repeated annually.",
  };
}

/** Šablona směrnice o AI a shrnutí pro zaměstnance (Markdown pro verzi dokumentu v DMS). */
export function aiDirectiveTemplate(p: AiDirectiveParams): AiDirectiveTemplate {
  return p.locale === "en" ? en(p) : cs(p);
}
