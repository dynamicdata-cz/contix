import type { HelpTranslation } from "./index";

/** Anglická nápověda (pilot ADR-036): témata podle ID z HELP_TOPICS. Chybějící téma se zobrazí česky. */
export const HELP_EN: Record<string, HelpTranslation> = {
  start: {
    title: "Getting started with CONTIX",
    summary: "Signing in, the menu, choosing a company and where to find your tasks.",
    body: `
## Signing in
Sign in with your company account (the SSO button, if your organization uses it) or with your e-mail and password. If you have two-factor authentication turned on, enter the code from the app on your phone. For security reasons you are signed out automatically after a period of inactivity.

## Finding your way around
- The **menu on the left** only contains the parts you have permissions for – every user sees it differently.
- **My work** – everything you need to do: documents to acknowledge, training and tasks with a due date for your positions.
- **Documents** – the organization's valid policies, directives and procedures.
- **Report an event** – when you notice something suspicious (a lost laptop, unusual system behaviour).
- **Report phishing** – hand a suspicious e-mail over to the security team, ideally as an .eml file (in Outlook, drag the message to the desktop). Do not click links or open attachments.
- The **Help** button (the question mark at the bottom right) shows procedures for the screen you are on.
- **Quick search** – press **Ctrl+K** (**⌘K** on a Mac) or use the **Search…** field at the top of the menu: type the name or code of a risk, asset, supplier, control, incident or document, a CVE number or a page name and press Enter to open it. With nothing typed it shows recently opened records; with the AI assistant enabled it also offers to ask a question.
- **List filters** (risks, assets, controls, suppliers) and the selected tab are kept in the page address – they survive returning from a detail and the link can be shared with a colleague. For risks, controls and suppliers you sort by clicking a column header and can save a combination of filters and sorting as a **view** (also shared with colleagues).
- Before deleting or approving, CONTIX asks in a confirmation window (Esc = cancel). If a form has unsaved changes, it warns you when you leave the page.
- On a phone, open the menu with the ☰ button at the top left.
- **Appearance**: in **My profile → Appearance** choose a colour theme and **light, dark** or **system** mode. The risk, asset and control detail has a fixed header with status and actions, and the content is split into tabs (Overview, Treatment / Tests, Links, Tasks); the selected tab is kept in the page address.

## Links between records
Linked records (processes, risks, controls, suppliers, assets) are clickable in a detail and lead straight to their detail. The **Where this record is used** card on an asset, process, risk, control and supplier shows the other direction: which incidents, changes, continuity plans, BIAs, AI systems, processing activities, audits and their findings, supplier reports and questionnaires, treatment actions or CRA products link to the record. You only see records you are permitted to read.

## Group of companies
If CONTIX manages several companies, choose the company you are working with at the top of the menu. The "whole group" option shows consolidated overviews; new records are always created in one specific company.

## Notifications
CONTIX can send you e-mails or Teams messages about approaching deadlines. The summary is in **My obligations**; the number next to the menu item shows how many tasks are waiting.
`,
  },
  profile: {
    title: "My profile: password and two-factor authentication",
    summary: "Changing your password, turning on two-factor authentication (MFA) and account details.",
    body: `
## My profile
The link with your name at the bottom left opens **My profile** – sign-in method, last sign-in and account security settings.

## Two-factor authentication (MFA)
1. Click **Set up MFA**.
2. On your phone, open an Authenticator app (Microsoft, Google…) and scan the QR code.
3. Enter the six-digit code from the app and confirm. Store the backup codes in a safe place.
The next time you sign in, enter the code from the app after your password. Turning MFA off requires your password; if you lose your phone, tell an administrator, who will reset MFA.

## Changing your password
For a local account, enter your current and new password. After the change you are signed out of other devices. A company account (SSO) signs in through the identity provider (e.g. Entra ID) – the password and MFA are changed there according to the organization's rules.
`,
  },
  dashboard: {
    title: "Overview: cybersecurity status",
    summary: "What the tiles on the home screen show and how to get from them to the fix.",
    body: `
## Area tiles
The home **Overview** summarises the status of all enabled areas: assets and vulnerabilities (critical, unsupported OS, red status), risks (above the threshold without treatment, due for reassessment, overdue plan actions), controls and compliance (compliance level, ineffective tests, expired evidence), incidents (open events, overdue reports), audits, documentation, training, continuity, suppliers and GDPR. Click a tile to go to the relevant records.

## Deadlines and tasks
The **Deadlines and tasks from all areas** card shows what is overdue or approaching – for the whole organization, not just for you. Your own tasks are in **My obligations**.

## Indicator trends
The **Indicator trends** card shows the monthly history of the main figures – compliance level, unacceptable risks, critical vulnerabilities, overdue obligations and exceptions, audit findings. CONTIX stores one snapshot per month and company (the current month is updated continuously, closed months do not change); each indicator shows the change against the previous month with the word improvement / deterioration. The **Table** switch shows the figures by month. The history starts on the day this version was deployed. A more detailed 12-month trend is in the **Management report** (also in print and Word).

## Suggestions and the group
**Draft records** counts AI and Wazuh suggestions awaiting review (you find them at the relevant records). With "whole group" selected, the overview shows totals for all companies and the compliance level of each according to its regime.
`,
  },
  my: {
    title: "My work",
    summary: "An overview of everything you need to do and how to complete a task.",
    body: `
## What you will find here
The **My work** page has tabs: **My obligations** (below), **Tasks and actions** (the actions and tasks overview filtered to Mine by default) and **Team** (deadlines within your permissions).
- **Documents to acknowledge** – new or changed documents that concern your role. Open the document, read it and confirm that you have read it.
- **My training** – courses you need to complete, with a due date.
- **Tasks of my positions** – deadlines your position is responsible for (document review, risk treatment plan action, corrective action from an audit, document approval…).

## How to complete a task
Click an item – it opens exactly where the task is done. A task disappears from the overview by itself once it is done (acknowledgement confirmed, document approved, action closed). The colour shows urgency: red is overdue, orange means the deadline is approaching. On the **Tasks and actions** tab, tick several tasks and mark them done or in progress at once.
`,
  },
  "docs-read": {
    title: "Documents: reading, acknowledgement and quiz",
    summary: "How to find a valid document, confirm you have read it and take a comprehension test.",
    body: `
## Finding a document
**Documents** contains only valid (approved) versions. You can search document titles and text – even without diacritics. Documents can be filtered by folder; the **To acknowledge** switch shows only those you need to confirm.

## Reading a document
- **Read (PDF)** opens the document in the browser with a validity statement (version, who approved it and when, effective date). A printed copy is uncontrolled – always check the valid version in CONTIX.
- **Download** downloads the original (Word, Excel).
- For a changed document, the **What changed since version …** button highlights added and removed text.

## Confirming acknowledgement
1. Read the document.
2. If the document has a **comprehension test**, answer the questions. You can repeat the test.
3. Click **I confirm I have read version …**. The confirmation is recorded as evidence and also completes the linked training.

## Ask the documentation
If the feature is enabled, ask a question in plain language at the top of Documents ("How long must a password be?"). The answer is prepared by AI on the organization's server **only from valid documents you are allowed to read**, and each statement cites the source number – click it to open the document. The wording of the document is always binding.

## Comment on a document
If a document is unclear or contains an error, write a **Comment** (you can specify the article). You will see the document owner's reply with the comment.
`,
  },
  "incident-report": {
    title: "Reporting a security event",
    summary: "What to report and how – quickly and without worry.",
    body: `
## What to report
A suspicious e-mail or link, the loss or theft of a laptop or phone, unusual behaviour of a computer or system, unauthorised access, a data leak, a suspected vulnerability. Report even small things – assessing them is up to the security team.

## How to report
1. In the menu, choose **Report an event**.
2. Describe what happened, when, and what it concerns (device, system, e-mail).
3. Submit. The event goes to the security team, which assesses it and contacts you if needed.

## Suspicious e-mail (phishing)
If SOC is enabled, use **Report phishing**: attach the message as an **.eml** file (in Outlook, drag it to the desktop or use File → Save As) and write in the note whether you clicked a link, opened an attachment or entered a password – in that case change your password immediately. The security team sees only the headers, links and attachment names, not the message text. If several colleagues report the same e-mail, the reports are merged into one.

## What not to do
Do not reply to a suspicious e-mail or open its attachments. Do not switch off a device you suspect has been compromised; disconnect it from the network and follow the security team's instructions.
`,
  },
  training: {
    title: "Training and awareness",
    summary: "How to find out which training you need to complete and how completion is recorded.",
    body: `
## My training
In **My obligations** you see the courses you need to complete and their due dates. Courses of the **Document acknowledgement** type are completed by confirming that you have read the document (possibly with a test). Classroom training is recorded by the organizer.

## For the security manager
In **Awareness & training** you create a course (format, frequency, audience), schedule sessions and record attendance. A course linked to a document can repeat with every new version of the document. The completion overview serves as evidence under § 10 of the Decree.
`,
  },
  "dms-gestor": {
    title: "Document owner: preparing a new document version",
    summary: "New version, template, editing in Word, check-out and submission for review.",
    body: `
## Roles in the document workflow
- The **Document owner** prepares versions and is responsible for the content and review of the document.
- The **Process owner** reviews the substance of the submitted version (if none is assigned, the step is skipped).
- The **Approver** approves the version.
Roles are assigned to positions – when staff change, it is enough to change who holds the position.

## New version
1. In the document detail, on the **Versions and approval** card, click **New version** and enter the version number and a description of the change.
2. Prepare the file: **From template…** (Word with the company header and the code, title, version and roles filled in), **Upload file** (your own Word / PDF), or **Edit in Word** (opens the file in desktop Word; saving with Ctrl+S writes to CONTIX).
3. Text can also be entered directly in CONTIX (**Edit text and details**).

## Editing and check-out
**Check out for editing** locks the draft for others. After editing, click **Check in** – upload the edited file as a new revision, or just release the check-out (when editing in Word, the changes are already saved). Older file revisions stay in the history.

## Submission
Click **Submit for review** (or **for approval**). The version is locked and goes to the process owner, then to the approver. A returned version is marked by a yellow bar with the reason – edit it and submit it again.

## Management systems and general regulations
Every document belongs to a **management system / area**: information security (ISMS), quality (ISO 9001), environment, occupational health and safety, personal data protection, continuity or general internal regulations (organizational rules, HR, finance…). Checks of the elements required by § 6 of the Decree and the Decree's sections apply only to the ISMS (for a company in the lower-obligations regime under Decree No. 410/2025 Coll.). Other documents are linked to the requirements of standards (ISO 9001, ISO 27001, DORA…) on the **Document links** card. On the **Coverage** tab you choose a framework and see which chapters have valid documentation. The document list can be filtered by management system.

## Bulk documentation import
On the **Document management** page, on the **Bulk import** tab, upload a ZIP archive with a metadata table (CSV or XLSX: ID, Title, Type, Classification level, Document owner, Process owner, Approver, Legal basis, Review, Parent document, Version, File) and the document files. **Load preview** shows what will be created, errors and files that were not found. Assign the roles from the table to positions (suggested by matching names). Optional columns **Management system** (e.g. "Quality (ISO 9001)") and **Requirements** (requirement IDs, e.g. iso9001:7.5; iso27001:A.5.15; dora:6). **Import** creates the documents as drafts with a version and file, sets the Decree sections according to the legal basis (according to the company's regime, 409 / 410), the review interval and parent documents. Documents with a code that already exists are skipped. Approval then follows the normal workflow.

## Document links
On the **Document links** card you set the **parent document** (e.g. directive → policy; child documents are listed automatically), **related documents** (the link works both ways), **regulatory requirements** (specific provisions of the Decree, the Cybersecurity Act, ISO…), and the **processes, assets, risks and suppliers** the document concerns. Save with **Save**. Linked documents are then also shown on the process, asset, risk, supplier and control cards and in the requirement assessment in the Statement of Applicability.

## After approval
The document is valid, appears to employees in Documents, and affected persons receive a task to acknowledge it. You handle employees' comments on the **Comments** card (accept / reject with a response). Confirm a periodic review without changes with **Reviewed without changes**.
`,
  },
  cra: {
    title: "Product cyber resilience (CRA)",
    summary: "Products with digital elements under Regulation (EU) 2024/2847: category, conformity assessment, Annex I requirements, support period, SBOM and vulnerability and incident reporting under Art. 14.",
    body: `
## Products
Record the **products with digital elements** the organisation manufactures (or places on the market under its own name), imports or distributes – software, hardware and combinations. For each product enter the **organisation's role** (manufacturer, importer, distributor, open-source steward), the intended purpose, the Member States where it is made available and the owner (position).

## Category and conformity assessment
**Category**: default, **important product class I** or **II** (Annex III – e.g. identity management, browsers, password managers, VPN, SIEM, operating systems, routers; class II hypervisors, firewalls and IDS/IPS) or **critical product** (Annex IV – security boxes, smart meter gateways, smartcards). The technical description of the categories is in Implementing Regulation (EU) 2025/2392. Based on the category, CONTIX shows the permitted **conformity assessment procedures** (module A internal control, B + C, H or an EUCC certificate) and flags a non-permitted choice. You also record harmonised standards, the notified body, the dates of the EU declaration of conformity and CE marking, placing on the market and the **end of the support period** (generally at least 5 years; a shorter one needs a justification), plus the vulnerability reporting contact and the coordinated disclosure policy.

## Requirements
The list is compiled by role: for a manufacturer **Annex I Part I** (security properties – no known exploitable vulnerabilities, secure default configuration, updates, access control, encryption, integrity, data minimisation, availability, limited attack surface, logging, data removal), **Part II** (vulnerability handling – SBOM, remediation, testing, disclosure, CVD, contact, distribution and free security updates) and **obligations** (risk assessment, due diligence for components, technical documentation, conformity assessment, declaration, CE, user information, 10-year retention, reporting); for importers and distributors their verification duties. For each requirement you keep the status and evidence.

## Product links
In the **Product links** card you connect the product with **assets** (servers and services it runs on or consists of), **suppliers** of components and services, **processes** and **risks**. The product then also appears in the **Where this record is used** card of the asset, supplier, process and risk. On a component vulnerability finding, **Create risk** creates a risk (only at your request) linked to the product and its assets; you rate it in the risk detail. CVEs in a finding lead to the vulnerability overview across assets.

## SBOM
**Upload SBOM** reads components from a **CycloneDX JSON** or **SPDX JSON** file (name, version, purl, supplier, licence) or directly from a **dependency lock file** – **bun.lock**, **package-lock.json** (npm) and **requirements.txt** (pip, the purl is filled in automatically) – and replaces the existing list; individual components can be added manually. The file is processed in CONTIX only; nothing is sent anywhere.

## Component vulnerabilities and VEX
On the **OSV database** tab you select ecosystems (npm, PyPI, Maven, Go, Debian, Alpine…) and CONTIX downloads their vulnerability database from the public OSV bucket – download only, nothing is sent; a server without internet uploads the all.zip file manually. SBOM components with a purl are then **matched locally** by version (the match is indicative – verify it) and appear on the product's **Component vulnerabilities and VEX** card. For each vulnerability you record a **VEX statement**: under investigation, affected (with an action), not affected (always with a justification – code not present, not in execute path, cannot be controlled by an adversary, mitigated otherwise) or fixed. Components not covered by OSV (pkg:generic, C firmware) are added manually by CVE. A vulnerability in the **KEV catalogue** (actively exploited) is highlighted and one click creates an **Art. 14 notification** from it. Statements are exported as **OpenVEX** or **CycloneDX VEX** for customers and authorities. After a new SBOM the matches are recomputed – removed components and versions are marked as outdated.

## Importer and distributor
For other manufacturers' products (role **importer** or **distributor**) there is a **Manufacturer documents** card: CE marking, EU declaration of conformity, information and instructions under Annex II (manufacturer contact and vulnerability reporting point, identification, purpose, **support end date**, security instructions), importer details and, for importers, also the technical documentation and conformity assessment. For each document you set the status (missing / verified / not applicable), a note, a link and attach a file; the date and who verified it are recorded. Unverified documents and a missing manufacturer support end date show up in the product gaps. You do not need the manufacturer's SBOM – it is part of their technical documentation.

## Vendor advisories (CSAF) and NVD
Vulnerabilities of products without an SBOM come from **manufacturer security advisories in CSAF 2.0 format** (.json files on the manufacturer's website): **Vendor advisories** tab → **Upload CSAF advisory**. CONTIX matches the advisory to your products – by the product **CPE** first (a field on the product card), otherwise by manufacturer, name and version – and creates findings with the vendor status (affected, fixed, not affected with a justification, under investigation) and the recommended remediation. A newer advisory revision updates the status; your own VEX assessment is not overwritten if it differs from the vendor's (the finding shows what the vendor states). The file is only read, nothing is sent out. Optionally, an **NVD lookup** can be allowed for products with a CPE – only the CPE identifier is sent to NVD, so it is off by default and an administrator turns it on.

## Notifications under Art. 14
From **11 September 2026** manufacturers must report **actively exploited vulnerabilities** and **severe incidents** affecting product security – also for products already on the market. Create a **New notification** with the moment of **awareness** (when you gained reasonable certainty) and CONTIX computes the deadlines: **early warning within 24 hours**, **notification within 72 hours** and the **final report** – for a vulnerability within 14 days of a fix being available, for an incident within one month of the notification. The deadlines appear in My obligations. For each stage CONTIX prepares the **notification text** (Czech or English) to copy into the ENISA Single Reporting Platform (SRP) – the notification goes to the coordinating CSIRT (NÚKIB in Czechia) and ENISA. After submission record the time and the SRP number; remember to inform affected users (Art. 14(8)).

## Dates
Reporting from 11 Sep 2026, notified body provisions from 11 Jun 2026, all other obligations from 11 Dec 2027. An approaching end of the support period is tracked by the obligation "End of product support period".
`,
  },
  soc2: {
    title: "SOC 2 reports",
    summary: "SOC 2 auditor engagement: TSC scope, system description, CUECs and subservice organisations, criterion → control → test → exception matrix, workpapers, PBC and Type I / Type II report in Word.",
    body: `
## Engagement
**New SOC 2 engagement** creates an audit of type "SOC 2 examination" (with PBC requests, assigned external auditors and findings) and the report data: **report type** (Type I = suitability of design as of a date, Type II = design and operating effectiveness over a period), **TSC categories** (security always, optionally availability, confidentiality, processing integrity, privacy), the **system** in scope and the service auditor firm. The engagement lives in the client's company – the auditor works with its controls, tests and evidence.

## Criteria and tests
The **Criteria and tests** tab is a matrix for each criterion in scope: mapping to **Decree 409 paragraphs** and **ISO/IEC 27001:2022**, the organisation's **controls** mapped to the criterion ("soc2:…" requirements on controls), **tests** in report scope (Type I design tests, Type II operating tests whose period overlaps the report period) with the number of samples and failures, **PBC** status by request reference, and the **workpaper** (auditor's conclusion and note). Criteria without controls can be filled with **Map controls to TSC** (decree crosswalk and framework library) or manually on the control detail; tests and samples are kept in **Controls → Tests and evidence**.

An **exception** is created for a criterion (optionally linked to a test) as an audit finding coded EX-nn; the **management response** is entered directly on the exception and appears in Section V of the report. The criterion conclusion "Not relevant" removes the criterion from Section IV (state the rationale in the system description).

## PBC
**Add standard PBC** creates typical evidence requests for the criteria in scope (for Type II also populations for sampling) – contacts, due dates and submission then happen in **Audit and PBC requests** (external auditor portal).

## System description
Description sections per the description criteria (services, commitments and system requirements, components – infrastructure, software, people, procedures, data, control environment, risk assessment, information and communication, monitoring, incidents, changes, criteria not relevant). Enter **CUECs** and **subservice controls (CSOC)** one per line with criteria in square brackets, e.g. "The customer manages its users' access [CC6.2, CC6.3]". For a subservice organisation linked to a supplier, CONTIX shows its latest **SOC 2 report** (opinion, validity, gaps); **Take CSOC from the report** adds the subservice controls recorded on the report. Without a report it warns you to request one or use the inclusive method.

## Report
The **Report** tab shows **readiness** (missing period, description sections, criteria without controls or tests, open workpapers, exceptions without management response, missing signature and date) and downloads the **report in Word** or for print: Section I independent service auditor's report (per the selected opinion), II management assertion, III system description with CUECs and subservice organisations, IV criteria, controls, tests and results, V other information and management responses. The texts are CONTIX's own texts, not the AICPA illustrative report, and the TSC criteria text is not included (ID and a short caption only) – review and edit the report before issuance.

## TSC mapping
The **TSC ↔ 409 / ISO mapping** tab on the overview shows the relevant Decree 409 paragraphs and ISO/IEC 27001:2022 controls for each criterion – a guide for organisations with an ISMS under the Decree or ISO preparing for SOC 2.
`,
  },
  aiact: {
    title: "Artificial intelligence (AI Act)",
    summary: "AI system register, prohibited practices, risk classification, deployer and provider obligations, FRIA, approval of use and AI literacy.",
    body: `
## AI system register
Record **every AI tool** the organisation uses or considers – cloud services (ChatGPT, Copilot, translators), AI features in other applications, chatbots, locally hosted models and in-house development. For each system enter the **organisation's role** (deployer = user, provider = whoever develops the system or places it on the market under its own name), the **intended purpose**, users, **input data** and **outputs**, data location, owner (position) and the person for **human oversight**. Link the system to processes, assets, suppliers, processing activities (GDPR), **risks** from the register and the **controls** that reduce its risk – the AI system then appears in the links of the risk and the control. A new system starts as **Proposed for approval**.

## Screening and classification
Screening has three parts: **prohibited practices** (Art. 5 – a ticked practice means the system must not be used), **high-risk use** (Annex III areas – recruitment and management of workers, education, creditworthiness, insurance, public benefits, critical infrastructure…, or a safety component of a product under Annex I) and **transparency** (Art. 50 – chatbot, generated content, deep fake, emotion recognition). For Annex III uses the **Art. 6(3) exception** can be applied (narrow procedural task, preparatory task…), but it does not apply when the system **profiles** persons. The classification is derived from the answers: prohibited practice → high risk → limited risk (transparency) → minimal risk. The result preview is shown immediately and applies after saving.

## Obligations
Based on the role and classification, a **list of obligations** is compiled with the article and the date from which it applies – for a deployer e.g. use according to instructions, human oversight, monitoring, keeping logs for 6 months, informing workers and affected persons, DPIA, FRIA; for a provider risk and quality management, technical documentation (Annex IV), logging, conformity assessment, EU declaration and CE marking, registration in the EU database, post-market monitoring and reporting serious incidents. For each obligation you keep the **status** (not fulfilled / in progress / fulfilled / not applicable) and a note with evidence. **AI literacy** (Art. 4) applies to all systems.

## Approval of use
The system is approved by its **owner** (position holder) or the AI administrator with **Approve use**, a justification and conditions. Approval is not possible without screening, for a prohibited practice, or for a high-risk system without assigned human oversight. Only an approved system can be set to **In use**; if screening changes to a prohibited practice, the approval is revoked. After approval a **periodic review** runs (shown in My obligations).

## FRIA
A **fundamental rights impact assessment** (Art. 27) is required for high-risk Annex III systems used by bodies governed by public law and providers of public services, and always for creditworthiness assessment and life and health insurance. Fill in elements a–f, the date of notification to the authority and the next review, and **complete** the FRIA – a completed FRIA is locked; the administrator reopens it for changes. The FRIA can build on the DPIA of the linked processing activity.

## Directive and AI literacy
**Create directive from template** creates in Documentation a draft **Directive on the Use of Artificial Intelligence** (listing approved tools from the register) and a child **one-page employee summary** with a comprehension test and required acknowledgement for everyone; optionally also an annual **AI literacy course** linked to the summary. Adapt the texts to your organisation before approval and run them through the workflow. The card shows training status for courses with the topic “AI gramotnost”.

## Dates
Dates follow Regulation (EU) 2026/1744 (Digital Omnibus): prohibitions and AI literacy from 2 Feb 2025, transparency from 2 Aug 2026, new prohibitions from 2 Dec 2026, high-risk Annex III systems from 2 Dec 2027 and Annex I from 2 Aug 2028. The **AI system register** (print and Word) serves as evidence for audit and supervision.
`,
  },
  infoservice: {
    title: "NÚKIB information service",
    summary: "News, warnings and vulnerability alerts from the NÚKIB RSS feed, statistics of reported incidents and the National MISP status.",
    body: `
## What the page shows
**NÚKIB information service** (top of the menu, next to Overview) gathers the regulator's information in one place: **news from the RSS** of the main NÚKIB website (and other feeds – the NÚKIB Portal RSS, SK-CERT, BSI), **statistics of reported incidents** from NÚKIB open data and the **National MISP connection status**. CONTIX only downloads the sources (GET) – nothing is sent.

## News and warnings
Items are sorted by title into **warnings**, **vulnerability alerts**, **overviews and reports**, **guidance and recommendations** and other **news**. For an item you record a **review** for the active company – that you have acknowledged the information and what follows from it (e.g. “not applicable”, “updated”, “risk R-12 reassessed”). The obliged entity must consider a **NÚKIB warning** in its risk assessment – unreviewed warnings are shown by the first indicator. Reviews are written to the audit log.

## Impact review
NÚKIB warnings and alerts are not incidents – nothing has happened; they are **threat information** to be reviewed and considered in the risk analysis. **Review** opens the review for the active company: **status** (under review → not applicable / affected – being handled → resolved), conclusion, **responsible position and due date** (shown in My obligations) and **affected assets**. **Suggest from inventory** finds assets whose vulnerabilities include the CVE from the item, or whose software, OS or manufacturer matches the product from the item – add only those really affected. From the review you can **create a risk** (scenario linked to the warning with the affected assets), a **task** (e.g. an update) and – only with signs of exploitation – a **security event** in incidents; the links are shown with the item. The asset detail has a card with the warnings concerning it. Warnings and alerts for the period with the review result are an input of the risk assessment report (relevant threats) and of the ISMS review.

## Publishers and countries
For a feed under Sources you set the **publisher** (NÚKIB, SK-CERT, CERT.at, BSI…) and the **country**. A company sees feeds without a country, “EU” and its own country by the regulatory profile (a Slovak subsidiary SK-CERT, a Czech one NÚKIB); “other countries too” shows everything, the publisher filter sorts the list.

## Feeds in other languages and sources without RSS
The item kind is recognised from the title in Czech, Slovak, German and English (Warnung, Sicherheitslücke, Schwachstelle, vulnerability…). For a feed you can set the **kind of unrecognised items** – e.g. for the CERT.at “Warnungen” feed = warning. A source without an RSS feed (e.g. CSIRT.CZ) is added with the format **web page with news**: the address = the page listing the news, the **path prefix of news links** = the part of the address the links to individual news items start with (for CSIRT.CZ “/cs/kyberbezpecnost/aktualne-z-bezpecnosti/”). CONTIX takes only titles, links and dates; if the website changes its layout, a source error is shown.

**Bulk from PDFs** (statistics card): select up to 36 NÚKIB PDF reports, the model proposes figures for each in turn and only the selected rows are saved (rows without warnings are preselected).

## Incident statistics
The chart shows reported incidents by ENISA classification over the last 12 published months and a comparison with the previous year. The source is the NUKIB/incidents-opendata repository (data.csv); the repository has been archived since March 2025, newer monthly overviews are published in the NÚKIB news feed.

**Add month:** current figures are only in the monthly reports “Cyber security incidents from NÚKIB’s perspective” (PDF). With **Add month** you enter the counts by ENISA classification and by severity; manual figures replace the open data of the same month and are marked ✎ in the chart (click the month to edit). With the AI assistant and the PDF conversion service enabled, **Propose figures** downloads the report PDF from the NÚKIB news item (or uses an uploaded file), converts it to text and the model proposes the counts – nothing is saved, check the figures against the PDF (the model may misread charts) and save. Downloads only from the hosts of configured RSS feeds.

## National MISP
Regulated entities obtain access to the National MISP via the NÚKIB Portal. Enter the instance address and API key in **SOC → Sources → MISP** – IOCs are then downloaded and matched against alerts. The card shows only the connection status (no keys).

## Sources and a server without internet
Under **Sources** (administrator) you set the RSS / Atom feeds, the open data address and automatic fetching (default every 6 h). Server without internet access: download the RSS or CSV file on another computer and upload it manually.
`,
  },
  legislation: {
    title: "Legislation: watching regulations and assessing changes",
    summary: "Regulations watched in e-Sbírka and EUR-Lex, new versions, differences, impact assessment, affected requirements and tasks.",
    body: `
## Watched regulations
In **Legislation**, click **Add regulation** and enter the regulation number (e.g. **264/2025 Sb.**) or its permanent URL / ELI, and choose the **responsible position** that assesses changes. Recommended regulations (the Cybersecurity Act and Decrees No. 408–410/2025 Coll.) can be picked from the list; standards and internal rules are added on the **Manual** tab. The summary at the top shows changes to assess, overdue tasks and the next amendment coming into force. Once a day CONTIX checks the current version in e-Sbírka and stores the text by fragment (sections, subsections, letters), the source link, the effective date and the download date. The **Check now** button in the regulation detail runs the check immediately.

Texts are downloaded from the **e-Sbírka open data** (no registration, updated daily); the RSS feed "Changes in e-Sbírka" also triggers a check right after a new version is published and warns about a **repeal date** set for a regulation. If the administrator configures an e-Sbírka REST API key (registration with the Ministry of the Interior), the API is used instead. The newest published version is watched – even with a future effective date – so you can assess an amendment in advance (the regulation shows "new version effective from …").

If the open data return no text for a version, CONTIX reads it from the **e-Sbírka website** (fallback, no key); the regulation detail shows where the text comes from. Switching the source for the same version creates no change or assessment, and the difference of a new version is computed against the older version from the same source. Below the list of regulations the administrator can choose the **Text source**: automatic, open data only, e-Sbírka website or REST API. If the text has been read from the fallback for over a week, Operations shows a warning.

## EU legislation (EUR-Lex)
On the **EU acts** tab you add an EU regulation or directive by its **CELEX** number (e.g. **32022L2555** = NIS2), an EUR-Lex link or an ELI; recommended acts (NIS2 and Implementing Regulation 2024/2690, DORA, GDPR, AI Act, CRA, eIDAS, CER) can be picked from the list. The text is downloaded without registration from the **CELLAR repository of the Publications Office of the EU** in Czech or English (chosen when adding; each language is a separately watched act). The **latest consolidated version** is watched (even with a future date); acts without a consolidation use the original Official Journal text. The text is split into **articles, paragraphs and annex points**, checked once a day, and a new version opens an assessment just like for e-Sbírka. For DORA, the NIS2 directive and Implementing Regulation 2024/2690, changed articles and annex points are linked to the DORA and NIS2 framework requirements; the end of validity of an act is shown in its state.

**ENISA** issues guidelines and methodologies, not legislation, and offers no machine-readable feed – keep important ENISA documents as a manually maintained regulation for now.

## Manually maintained regulations and standards
Copyrighted standards (ISO/IEC 27001, ISO 9001…) or regulations outside the Collection are added as a **manually maintained regulation** and you upload the text (Word, ODT, plain text). The text is split by headings (§, Art., numbered clauses) and stays within your company only. A new version is compared with the previous one in the same way as for e-Sbírka.

## Assessing a change
A new version creates a **change to assess** with a due date (14 days); the responsible person sees it in **My obligations**. The detail shows the **difference** per fragment (highlighted words), the **affected requirements** in CONTIX, and the **controls** and **documents** linked to them. **Suggest with AI** lets the local model prepare a summary and proposed tasks – they are only suggestions you confirm. The assessment (impact level and justification) is confirmed by the responsible person with **Confirm assessment**; the record keeps who assessed the change and when.

## Tasks
You create tasks for a change (e.g. update a directive), optionally linked to a document or a requirement, with a responsible position and a due date. A change can be **closed** once its tasks are done or cancelled. All tasks are listed on the **Tasks** tab.

## Document score against requirements
In the document detail (Document management), the AI function **Document score against requirements and improvement suggestions** compares the document text with the linked requirements, computes a coverage score and suggests improvements; accepted suggestions are recorded as comments on the document.
`,
  },
  languages: {
    title: "Language versions",
    summary: "Interface language, the organization's default language and adding another language without a new application version.",
    body: `
## Choosing a language
Every user chooses their language in **My profile → Language**. Users who do not choose one see the **organization's default language**, set in **Administration → Languages**. On the sign-in screen the language can be switched below the form.

## Adding another language
1. In **Administration → Languages**, enter the language code (e.g. de, uk, sk, sr-Latn) and download the **template** – a table with the columns key, cs, en and a column for the translation.
2. Fill in the translations in the last column (Excel, LibreOffice or a translation tool). Keep the texts in curly braces, such as {n} or {name}, unchanged.
3. Upload the table with **Upload**, fill in the language name and the fallback language. Untranslated texts are shown in the fallback language.

Help can be translated in a JSON pack (download the English pack as a sample). For each language you can see what percentage of texts is translated.

## What is not translated
Texts of Czech regulations (the Act, decrees) remain in Czech – only the Czech wording is binding. Data entered by users (document names, risks…) is shown as entered.
`,
  },
  "dms-approver": {
    title: "Process owner and approver: review and approval",
    summary: "How to review, return or approve a submitted version.",
    body: `
## Where to find documents for review
In **My obligations** ("Document review / approval"), in Documents on the **My role in approvals** card, and in the e-mail notification.

## Review
1. Open the document and on the **Versions and approval** card read the version (PDF with a DRAFT watermark, or the original).
2. **Compare with …** shows the changes against the previous version.
3. Process owner: **Content OK – send for approval**, or **Return** stating what to change.
4. Approver: **Approve**, or **Return**. On approval the version becomes valid and the previous one is marked as superseded.

Every step is recorded in the version history (who, when, with what note).
`,
  },
  "dms-admin": {
    title: "Document management: folders, templates, audience, disposal",
    summary: "Documentation structure, numbering, Word templates, affected persons and retention periods.",
    body: `
## New document
**+ Document** – fill in the title, type, folder, classification and the positions of the document owner, process owner and approver. The code can be left empty – it is assigned automatically from the folder prefix (e.g. SM-ISMS-003) or the document type. The **Decision** type (code RO-…) is used for management decisions – appointments to roles, assignment of responsibilities, approval of the risk management approach and so on; it goes through the same approval workflow and affected persons can acknowledge it.

## Folders
The **Folders** panel on the left: a button for a new folder, the pencil to edit. A folder can have a code prefix; it also applies to subfolders. Only an empty folder can be deleted.

## Templates
The **Templates** tab – upload a Word file (.docx / .dotx) with the company header and the placeholders {{kod}}, {{nazev}}, {{verze}}, {{gestor}}, {{schvalovatel}}, {{datum}}… The list of placeholders is on the tab. A template can be restricted to a document type.

## Affected persons and acknowledgement
On the **Affected persons and acknowledgment** card, define the audience (everyone, units, positions, security roles, management). The acknowledgement period runs from the approval of the version; the overview shows who has already confirmed. Optionally a comprehension test and linked training (repeated with each new version).

## Disposal
A document has a retention code (A archival records, S disposal, V selection) and a retention period. The period starts on 1 January of the year after the document is withdrawn. The **Disposal** tab shows the status; once the period has elapsed, download the **Package (ZIP)** and dispose of the document or hand it over to the archive with a protocol number.
`,
  },
  organization: {
    title: "Organization: units and positions",
    summary: "Organizational structure, positions, who holds them and security roles.",
    body: `
## Why positions
Responsibility in CONTIX (process and risk owner, document owner and approver, RACI, responsibility for actions) is assigned to a **position**, not to a specific person. When staff change, it is enough to change who holds the position – tasks, notifications and roles in the document workflow pass to the new holder.

## Units
The **Structure** tab: **New unit** (name, abbreviation, type, parent unit, description of remit). Units can be nested. Deleting a unit also deletes its positions – first check where they are used.

## Positions
**New position** – name, unit, job description, whether it is the head of the unit, holders (users) and **security roles** (cybersecurity manager, architect and auditor, committee…). The **Where used** button opens the position page: holders, everything the position owns (processes, risks, controls, documents, tasks, incidents, audits, continuity plans, AI systems, CRA products…) and its RACI roles in process steps.

## Handover when someone leaves
On the position page, **Hand over responsibility** moves selected kinds of records to another position in the same company (e.g. when someone leaves or after a reorganization). Only kinds you can write are offered; the handover is recorded in the audit log together with the note. If only the person changes, just change the position's **holders**.

## Overviews
The **Process owner**, **Risk owner** and **RACI in process steps** tabs show what each position is responsible for – useful for checking that nothing is left without an owner. The audience for documents and training is evaluated by units, positions and security roles.
`,
  },
  processes: {
    title: "Processes: process map, card, RACI and BPMN",
    summary: "Process register, steps with RACI, BPMN diagram, versions and links to assets, risks and documents.",
    body: `
## Process map
The list is divided into **governing**, **core (key)** and **supporting** processes. **New process** – name, type, parent process, owner (position) and responsible unit. The holder of the owner position can edit their process.

## Process card and steps
- **Process card** – purpose and objective, process boundaries, trigger, inputs and outputs, performance indicators (KPIs), legislation, criticality.
- **Process steps** – the source of truth about the process: description of the activity, responsibility (**RACI matrix** on positions), systems, deadline and frequency. Change the order with the arrows.
- **Assets and documents** – the assets the process relies on (for BIA and CIA inheritance) and linked documents. **Process risks** are created and managed in the risk register.

## BPMN diagram
The **BPMN diagram** tab generates a diagram from the steps. It can be edited manually and saved, downloaded (BPMN / image), or tasks from the diagram can be added to the steps. A saved diagram can be discarded – the diagram generated from the steps is then shown again.

## Process versions
**Save version** creates a snapshot of the process with a description of the change; the version is submitted for approval. Approved versions cannot be deleted and can be compared with another version or with the current state.
`,
  },
  assets: {
    title: "Assets and vulnerabilities",
    summary: "Register of primary and supporting assets, import from Wazuh, vulnerability traffic light and remediation priorities.",
    body: `
## Vulnerability detail and remediation
Click a CVE identifier (in the vulnerability list, on an asset or in the fix plan) to open the **vulnerability detail**: priority, CVSS, CISA KEV catalogue and EPSS, description, all occurrences in the organisation with the fix due date and **remediation by operating system** – a package manager command (apt, dnf/yum, zypper, apk, pacman) to copy and a command to verify the version; for Windows a pointer to the cumulative update. **Generate analysis** (AI assistant) adds an explanation, impact, exploitability, remediation steps, temporary mitigations and verification. Only CVE, package, version and operating system data are sent to the model – never asset or person names. The analysis is stored with the CVE and visible to the whole team; always verify versions and update numbers with the vendor.

## Primary and supporting assets
Primary assets are information and services (what we protect); supporting assets are the servers, applications, networks and devices they run on. Links between them determine how confidentiality, integrity and availability ratings are inherited.

## Shared group assets
In a holding an asset (e.g. a common ERP, data centre or network) may serve several companies. In the asset detail, **Sharing** selects the group companies the asset is shared with: they see it in their asset list (label “shared from …”) and can use it in risks, BIA, processes and controls. The asset still belongs to its owning company – only that company can edit, move or delete it; the others see it read-only.

## Asset relationship graph
**Assets → Asset relationship graph** shows assets in **layers**: processes, primary assets (services, information), applications and data, infrastructure and endpoints, network and security devices, people, suppliers and facilities. An arrow points from a node to what it depends on: a primary asset on a supporting one, a process on an asset and **technical dependencies** (runs on, uses, via network, located in, backed up to) that you add in the node detail. Layers and link types can be switched off, nodes **coloured** by status, criticality, vulnerabilities, open SOC alerts or risks. Clicking a node shows the **detail** (CIA, vulnerabilities, alerts, risks, links); you can show only its **neighbourhood** (1–3 hops) and turn on **outage impact analysis** – everything that (even indirectly) depends on the node is highlighted in red, what it depends on in blue. Use the mouse wheel to zoom and drag to pan. Technical dependencies are also shown in the asset detail.

## Certificates and TLS
**Assets → Certificates and TLS** registers TLS endpoints (host and port, optionally a name for SNI and a link to an asset); **Suggest from assets** offers assets with a host name. Once a day (and on **Check now**) CONTIX opens a read-only TLS connection and checks the certificate validity, issuer and chain trust, name match, key type and size, signature algorithm and – if openssl is installed on the server – whether the server still accepts **TLS 1.0 / 1.1**. Findings (expired or soon-expiring, untrusted or self-signed certificate, weak key, SHA-1, legacy protocol, validity too long) follow the **check rules** that the administrator sets according to the organisation's cryptographic requirements. Certificates about to expire appear in team obligations.

## Resilience analysis
**Assets → Resilience analysis** propagates **RTO and RPO from process BIAs** along the dependency graph (process → asset → supporting assets → technical dependencies) to every asset a process depends on, even indirectly, and finds: **single points of failure** (non-redundant asset with a short RTO or many critical dependents), **lower criticality** than dependent assets require, an asset with an RTO up to 72 h **without a continuity plan** (a process plan also covers its assets) or with a plan whose target RTO is longer, a **critical dependency in poor condition** (red status, P1 vulnerabilities) and a **BIA without linked assets**. Mark a redundant asset (cluster, HA, backup line) in its form. Findings are also shown as colouring in the relationship graph and in the BIA detail (process assets, copy to the Dependencies field).

## Where assets come from
- **Manually** – the new asset button.
- **Discovery & import** – import from Wazuh (agents), network scan, CSV / Excel import. Repeated imports match assets (serial number, hostname, IP) and never overwrite the owner or ratings.
- **Duplicates** – similar assets can be merged.

## Network segments and unregistered devices
In **Discovery & import → Network segments**, name the networks you want to monitor (e.g. Servers, Clients, DMZ) – CIDR ranges, **exclusions** (addresses that are not scanned, e.g. sensitive OT devices), scan profile and **schedule** (every hour, every 6 hours, daily, weekly at a set time; or manual only). The ranges must lie within the allowed scan ranges (Administration → Connectors). Every host found is compared with the asset register by **MAC, IP and name**. A device that is not registered raises a **SOC alert** (source Network scan, technique T1200); when a different MAC address answers on the IP of a registered asset, a **device change** alert is raised (replacement or address spoofing). A repeated scan does not duplicate the alert, it only increases the occurrence count. In the **Devices found on networks** list you **create an asset** from an unregistered device, **link it to an existing one** (its IP and MAC are added) or **approve** it with a reason (e.g. guest network) – approved devices no longer raise alerts. **Register** mode also creates and updates assets directly like a manual scan; **Monitor only** mode does not change the register. The CONTIX server in Docker sees only IP addresses (no MAC or vendor) and detects a live device only by an open port (it tries common ports of servers, Windows and Mac workstations, printers and phones). Workstations whose firewall rejects all connections (Windows on a **public** network, Mac in stealth mode) are not found – set the network profile to **Private** / enable file sharing on them, or use an ARP scan from the same network.

## Vulnerabilities and the traffic light
Vulnerabilities (CVEs) and operating system versions are loaded from Wazuh. An asset's traffic light (green / orange / red) reflects open vulnerabilities and OS support. A vulnerability can be accepted with a reason and a deadline (exception). CONTIX can suggest risks from vulnerabilities – a person always confirms the suggestion.

## Remediation priorities (KEV and EPSS)
Thousands of CVEs cannot be fixed at once. Each vulnerability has a **priority P1–P4**: **P1** = in the **CISA KEV** catalog (actively exploited) or **EPSS** (probability of exploitation in the next 30 days) of at least 50%; **P2** = EPSS of at least 10% or a critical vulnerability on a critical asset; **P3** = other critical and high; **P4** = medium and low. The list is sorted by priority and can be filtered by priority, KEV and package.

The **remediation plan by package** shows what disappears by fixing (updating) one package – how many vulnerabilities of which priority on how many assets. From a row you can **create a risk for the package** (all affected assets and uncovered critical and high CVEs).

**Remediation deadlines** follow the priority (default P1 7 days, P2 30, P3 90, P4 none; an administrator changes them under **Threat sources**). The deadline runs from first detection, for the KEV catalog at the earliest from the date added. The list shows the deadline and "overdue", with the filter **Past remediation deadline only**. P1 and P2 create a **Vulnerability remediation** obligation – the asset owner sees it in My obligations, the team in the obligations overview. A P1 vulnerability turns the asset **red** (can be turned off in the traffic light settings). The management report includes chapter **4.1 Vulnerabilities and remediation** (P1, P2, KEV, overdue, share fixed on time) and trends of P1 and overdue vulnerabilities.

The KEV catalog and EPSS scores are public files; CONTIX downloads them once a day (nothing is sent out). If the server has no internet access, an administrator downloads them elsewhere and uploads them under **Threat sources**.

## Scan imports and finding triage
Besides Wazuh you can upload the outputs of other scanners: **Nessus** (.nessus), **OpenVAS / Greenbone** (XML), **Burp Suite** (XML), **OWASP ZAP** (JSON), **Nuclei** (JSON / JSONL), **Trivy** and **Grype** (JSON), **SARIF** (Semgrep, CodeQL, SonarQube…) or a generic **CSV** (columns host / ip, cve or id, title, severity, port…). In **Vulnerabilities → Scan imports** choose **Import scan**, upload the file and first check the **preview** – how many findings, which hosts were matched to assets (by IP, FQDN, name) and which are missing from the inventory. The file is processed only on the server, nothing is sent out.
- **Target asset** – for a container image, repository or application scan (Trivy, Grype, SARIF) all findings go to one asset.
- **Reimport** – importing the same scanner again updates the existing findings. Whatever is missing from the file on the scanned assets is marked as resolved; findings that reappear are reopened automatically.
- **External scan (from the internet)** – critical and high findings get priority **P2**. The **Reachable from the internet** option on an asset works the same way.
- **Deduplication** – a new finding with the same CVE on an asset that another source (e.g. Wazuh) already reports is marked as a duplicate automatically.

In the vulnerability list you can tick findings and in bulk **verify** them, mark them as **false positive** or **out of scope** (always with a justification), as a **duplicate** of another finding on the same asset, or **reopen** them. These states do not count towards the health status or deadlines and a reimport does not overwrite them. For an import, **AI triage** can propose duplicates across scanners (e.g. the same XSS from Burp and ZAP), false positives and findings to verify first – the model only gets the findings and asset types without their names, and nothing changes until you accept it.

## Import from CI/CD, metrics and DefectDojo
- **More formats** – besides the above also **Qualys VMDR** (detection XML and scan report) and **Dependency-Track** (FPF findings export; suppressed and false-positive findings are skipped).
- **From a pipeline (CI/CD)** – the runner uploads the scanner output to /api/public/vulnerabilities/scans with a personal **API token** of a user who may manage assets (Profile → API tokens, ideally restricted to a company). Processing is the same as a manual import. The **failOn** parameter (critical, high, medium, none) evaluates the **gate**: the response contains new open findings by severity and a failed flag the pipeline uses to stop the build. Instructions with the command are below the import list.
- **Metrics** – on the Vulnerabilities page: mean **time to fix** by severity, share **fixed on time**, open past deadline, **age** of open vulnerabilities, **monthly trend** (new, resolved, open at month end) and sources; a switch shows everything as a table too.
- **DefectDojo connector** (administrator) – if the team already uses DefectDojo, CONTIX **only reads active findings** from it via API v2 (key of a read-only user, stored encrypted). A finding is matched to an asset by the endpoint host; findings without an endpoint (SAST, SCA) optionally by product name. Whatever stops being active in DefectDojo is resolved in CONTIX. Nothing is written to DefectDojo.
`,
  },
  risks: {
    title: "Risks and the treatment plan",
    summary: "Risk register, threat catalog, assessment under the Decree and the treatment plan.",
    body: `
## Risk assessment
A risk arises from a threat and a vulnerability and affects assets. Impact, threat and vulnerability are rated on the scale from Annex 4 to the Decree (or the chosen methodology); CONTIX calculates the risk level. A position is responsible for the risk.

## Treatment
Choose the treatment option (reduce, accept, transfer, avoid), link controls and treatment plan actions with a due date and responsibility. You assess the residual risk after the controls are implemented; CONTIX can suggest residual values based on control effectiveness. A control whose last test was ineffective or whose continuous monitor is failing is not counted in the suggestion; a last test "effective with exceptions" lowers its effectiveness to partial. A failing monitor of a linked control also appears among the risk reassessment prompts.

**Plan actions suggested from data** (Treatment tab): CONTIX suggests actions to implement linked controls, to restore the effectiveness of controls with an ineffective test or a failing monitor, and to strengthen weak capabilities from accepted data-driven scenarios. You pick the suggestions, the responsible position and the due date – actions are created only after confirmation; suggestions already in the plan are just marked.

## Scenario with multiple threats and vulnerabilities
A risk scenario has a **main threat and vulnerability** and, as needed, **further threats and vulnerabilities of the scenario** (e.g. ransomware and an operator error exploiting the same backup weakness). Add further items with “+ add…” below the main threat / vulnerability. The impact suggestion takes the confidentiality, integrity and availability of all scenario threats into account; the risk register and the risk assessment report list all items, the risk list shows their number (+N) and the threat filter also finds a risk by a further threat.

## Threat and vulnerability catalog
**Risks → Catalog** contains threats and vulnerabilities (weaknesses) from the Annex to the Decree with their impact on confidentiality, integrity and availability. Add your own items with **New threat / New vulnerability**; deactivate unused items (they remain on older risks).

## Risk treatment plan
**Risks → Treatment plan** summarises the actions of all risks: link to controls, implementation method, responsibility, due date, human, technical and financial resources and costs. Overdue actions are highlighted and appear in **My obligations** of the responsible positions. The approved plan is stored as an ISMS document (print, Word).

## Periodic assessment
The annual assessment takes place in an **assessment cycle** (see the topic Assessment cycles). The heat map shows the distribution of risks.

## Reassessment triggers
A risk assessment should reflect what has happened since it was made. The risk detail shows **Reassessment triggers** since the last assessment or confirmation: incidents on the risk or its assets, major and minor audit findings, approved and implemented significant changes, SOC signals (escalation, confirmed attack, exploitation attempt), new P1/KEV vulnerabilities on the assets, ineffective tests of linked controls, expired vulnerability exceptions and evaluated supplier questionnaires with a "no" answer.

For the Decree methodology, CONTIX suggests raising the threat level (incidents, SOC) or the vulnerability level (vulnerabilities, findings, tests, exceptions). **Apply suggestion** only fills the values into the form – nothing changes by itself. The risk owner then either adjusts the assessment and saves it, or **confirms it without changes** with a justification. Both are saved in the history together with the triggers that led to the decision, and a confirmation also counts as a periodic assessment.

The decision is due within 30 days of the first trigger – the obligation appears in the risk owner's **My obligations**. The risk list can be filtered to risks with triggers, and the ISMS review report lists pending decisions and the number of reassessments in the period.
`,
  },
  "risk-appetite": {
    title: "Risk appetite and KRIs",
    summary: "Risk appetite approved by management per category, risks above that limit and key risk indicators from data.",
    body: `
## Risk appetite
For the categories **confidentiality, integrity, availability and suppliers** set the highest risk level the organisation is willing to accept and add a management statement. The responsible person **approves** the appetite with the Approve button (who and when is recorded); any later change is marked as awaiting new approval.

## Risks above appetite
A risk's categories are derived from the CIA components of its threats (main and additional) and from links to suppliers or supplier dependency / breach of contract threats. A risk whose current level exceeds the appetite in one of its categories is listed – with a warning if it has no treatment.

## Key risk indicators (KRI)
Indicators are calculated from CONTIX data: MFA and EDR coverage, internet-facing assets with a KEV vulnerability, assets with overdue vulnerabilities, critical processes without tested recovery, unassessed catalogue threats and risks with a prompt past the decision deadline. For each you set a warning and a breach threshold or disable it. On breach the date is recorded and risks with an accepted data-driven scenario whose capability the indicator tracks get a **reassessment prompt**. The scheduler recalculates the indicators once a day.

## Trends and group of companies
**Risk trends over time** shows monthly snapshots: critical and high, medium and low risks, risks above appetite, threat catalogue coverage, unassessed threats, weak capabilities, breached KRIs and detection blind spots. The **group overview** (with several companies) compares the companies where you can read risks by their latest monthly snapshot.

## In outputs
The appetite, risks above it and KRIs are part of the risk assessment report (section 8) and the ISMS management review report.
`,
  },
  "risk-scenarios": {
    title: "Data-driven risk scenarios",
    summary: "Risk scenario proposals from real data and a security capability profile – every rating with evidence, a person decides.",
    body: `
## What it is for
Instead of inventing scenarios, CONTIX proposes them based on what the data actually shows: Wazuh agent coverage (EDR), vulnerabilities including KEV on internet-facing assets, accounts without MFA and findings on privileged accounts (AD / Entra ID), secure configuration score (SCA), unmanaged devices on the network, processes without a tested recovery (BIA, plan tests), significant suppliers without a valid assurance report and attacks recorded in the SOC (ATT&CK techniques).

## Capability profile
The **Capability profile** tab shows eight capabilities (EDR, MFA, privileged access, segmentation, vulnerability management, hardening, backup and recovery, suppliers) with status strong / partial / weak / unknown, coverage and a link to the data source. What cannot be determined from data you add as a **declaration** with a product, note, evidence link and validity. A declaration is used only where data is missing; if it is better than the measured status, CONTIX flags the conflict. An unknown capability never counts as implemented. Each capability also shows the related ISO 27001, NIS2 and CIS requirements and Decree sections.

## Scenario proposals
**Evaluate data** goes through primary assets and their supporting assets (links and technical dependencies) and, for the template library (ransomware, privileged account takeover, exploitation of a known vulnerability, phishing, lateral movement, backup failure, supplier failure, data leak, insider misuse, outage of an internet-facing service, cloud and M365 misconfiguration, software component compromise, OT attack, device loss), proposes a scenario only where data shows a weakness. A proposal contains:
- **impact** from the primary asset's CIA rating (threatened components only), **threat** (middle of the scale, higher with SOC attacks and internet-facing vulnerabilities) and **vulnerability** from evidenced signals and weak capabilities;
- **evidence** with links to specific assets, findings and processes;
- **existing controls** mapped to the requirements of mitigating capabilities (if none, it is a candidate for the treatment plan);
- a **Little data** flag when most capabilities cannot be measured.

Some templates apply only to a matching scope: OT only with an OT / IoT device, device loss only with a laptop or mobile, cloud only with a cloud resource or SaaS, software component only with an application, container, database or SaaS, service outage only with an internet-facing asset. New signals: high-availability supporting assets without redundancy, a failing Microsoft Secure Score monitor, vulnerabilities in applications and components and vulnerable or exposed OT devices.

## Decisions
- **Accept as a risk** – a risk is created with the threat and vulnerabilities from the Decree catalogue, assets, controls and evidence in the description; you can adjust the ratings before creating it.
- **Link to an existing risk** – the scenario is already covered by a risk in the register.
- **Reject** with a justification – kept in history; when new facts appear in the data, the proposal is reopened.
For accepted and linked proposals CONTIX flags when the data has changed since the decision. A change of the evidenced facts after the risk's last assessment also appears among the **reassessment prompts** on the risk detail (a strong prompt when the proposal rates higher than the current assessment); confirming or changing the assessment clears it.

## Threat catalogue coverage
The **Threat catalogue coverage** tab shows, for each primary asset, all active catalogue threats with a state:
- **Covered by a risk** – a risk (main or additional threat of the scenario) on the asset or one of its supporting assets;
- **Data-driven scenario proposal** – an open proposal addressing the threat;
- **Not relevant (justified)** – you excluded the threat for the asset with a justification (written to the audit log);
- **Unassessed** – a gap in the risk analysis.
The summary at the top shows the share of assessed asset × threat combinations – evidence that the risk analysis is complete.

## Automatic refresh
Once a day the scheduler re-evaluates the data for companies that use data-driven scenarios: proposals and prompts are updated, risks are never changed.

## ATT&CK detection
The **ATT&CK detection** tab shows the MITRE ATT&CK techniques from scenario templates and how the SOC can detect them: **detected** (alerts with the technique or a sub-technique in 90 days, excluding false positives), **scheduled hunt** (an enabled threat hunt with the technique), **declared rule** (a SIEM / EDR rule outside CONTIX – give the source and a note) or **blind spot**. Once detection is measured (the SOC has alerts, hunts or declarations) and most techniques of a scenario are blind spots, the proposal's vulnerability level is raised by 1 with a justification. A summary is also in the risk assessment report (7.7).

## Tasks for unassessed threats
For an unassessed threat in Threat catalogue coverage, the **Task** button creates a task linked to the asset ("Assess threat … for asset …") – the decision stays with the responsible person.

## In the risk assessment report
A new version of the **risk assessment report** (Risks → document versions) contains section **7. Data-driven risk analysis**: the capability profile, threat catalogue coverage per primary asset with the list of unassessed threats, threats excluded as not relevant with their justification, decided scenarios, risk reassessments in the period and open prompts. The state is frozen in the approved version; versions also show catalogue coverage and the number of unassessed threats compared with the previous version.
`,
  },
  "risk-quant": {
    title: "Quantitative risk analysis (FAIR)",
    summary: "Estimated annual loss in CZK, loss exceedance curve and return on controls.",
    body: `
## What it is for
Quantitative analysis complements the assessment under the Decree (which remains primary for regulatory purposes) with a financial view for management: how much a risk costs per year and whether controls pay off.

## Input on a risk
In the risk detail, on the quantitative analysis card, always estimate the **minimum, most likely value and maximum**:
- incident **frequency** per year (0.1 = once in 10 years),
- **loss per incident** in CZK (recovery, downtime, fines, reputation),
- optionally the values **after controls** and the annual cost of the controls (otherwise the sum of the plan action estimates is used).
CONTIX runs a Monte Carlo simulation – the same inputs always give the same result.

## Overview
**Risks → Quantitative risk analysis** shows the **expected annual loss**, the loss you will not exceed with 95% / 99% probability, the **loss exceedance curve** for the whole portfolio and the return on controls (**ROSI** = (loss reduction − annual cost of controls) / cost).
`,
  },
  cycles: {
    title: "Assessment cycles: periodic risk assessment and BIA",
    summary: "Annual reassessment of risks and impact analyses with a decision on each item and approval.",
    body: `
## Starting
In Risks (or in Continuity for BIA), open **Assessment cycles** → **Start assessment**: name, assessed period, due date and the position leading the assessment. Valid risks (processes for BIA) are included in the scope; items you do not want to assess can be **excluded from scope** with a justification.

## Progress
For each item, decide:
- **reassess** – update the risk / BIA assessment (recorded as "reassessed"),
- **no change** – confirm that the assessment is up to date.
The responsible positions see their items in **My obligations**. The overview shows pending items and changes since the start.

## Completion and approval
Once all items are decided, submit and approve the assessment – the result is **frozen as a snapshot**. **Comparison with previous** approved assessment shows deteriorations, improvements and removed items; it serves as evidence of the periodic assessment required by the Decree.
`,
  },
  exceptions: {
    title: "Exceptions and accepted risks",
    summary: "A single overview of all granted exceptions with justification, author and validity; reminders before expiry.",
    body: `
## What the overview contains
The **Exceptions & accepted risks** page (Security management menu) gathers in one place everything that was knowingly accepted instead of being fixed:
- **account findings** (Identity and access) and **segregation of duties (SoD) violations** with an exception,
- **vulnerabilities** with an exception (risk acceptance on an asset),
- **accepted risks** (status "accepted" or treatment option "acceptance") – the risk owner is responsible for the exception,
- **non-applicable provisions** from the Statement of Applicability with a justification and compensating control.

For each item you see the justification, who granted the exception (for a risk, its owner) and until when it is valid. An exception without a justification is highlighted in red.

## Validity and reminders
The **Expired** status means the deadline has passed – the finding or violation will be reopened at the next synchronization; resolve the exception or extend it by granting it again. **Expiring soon** = within 30 days; the exception then appears in **My obligations** of whoever granted it, in the team overview and in the e-mail notification summary. Accepted risks and non-applicable provisions have no deadline – review them during the periodic risk assessment and the review of the Statement of Applicability.

## Compensating controls
In the **Compensating controls** column, use the pencil to assign controls that reduce the risk while the exception lasts (e.g. a WAF for an unpatched vulnerability) and a note on how they compensate. Controls are chosen from the exception's company; they can be changed by whoever can write in the exception's register (identity, assets, risks, controls, SOC). The exception appears in the control's links; the controls are also in the CSV export.

## Where to grant and revoke exceptions
Exceptions are managed at their records: Identity and access → Findings / Segregation of duties (filter **With exception**), Vulnerabilities (status filter), Risks, Statement of Applicability. Clicking the subject of an exception opens the relevant record. Every change is in the audit log; the overview can be exported to **CSV** for an audit.
`,
  },
  coverage: {
    title: "Regulation coverage",
    summary: "A matrix of provisions × documents × controls, bulk AI scoring of documents with the local model and status snapshots for audit.",
    body: `
## Coverage matrix
The **Regulation coverage** page (in the menu under Controls & compliance) shows, for the selected regulation or framework (Decree No. 409/2025 Coll. / 410/2025 Coll., the Cybersecurity Act, NIS2, DORA, ISO 27001…), for each provision:
- the **documents** covering it – through linked requirements (document card → Links) or, for security documentation, through the Decree sections according to the company's regime; both valid documents and drafts are included,
- the **AI verdict** from the latest document score (green = covered, orange = partially, red = missing, grey = not scored); hover to see the reasoning, "older version" means the AI scored a previous version of the document,
- the **controls** and compliance level (as in the Statement of Applicability),
- **gaps**: no document, AI did not find it in the documents or found it only partially, no control, control not compliant.

The summary at the top shows the share of documented requirements, the AI document coverage score (covered 1, partially ½) and the share of requirements with a control; click a tile to filter the corresponding gaps. Provisions marked as not applicable are not counted as gaps.

## Bulk AI document scoring
The **Score documents with AI** button sends to the local model, one by one, all documents of the regulation that have not been scored yet or have changed since scoring (optionally all of them). Documents are scored one after another, you see the progress above the matrix and the results are filled in as they arrive. Each score is a normal AI suggestion on the document – you accept or reject the improvement suggestions in the document detail; nothing changes automatically. A document without text (no version content and no converted file) is skipped with a warning.

## Snapshots for audit
**Save state for audit** stores an immutable snapshot of the matrix with the date, author and a note (e.g. "status before internal audit"). Select snapshots in the **Show** field; they can be exported to CSV just like the current state.
`,
  },
  monitoring: {
    title: "Continuous control monitoring",
    summary: "Automated control checks over data from Entra ID, AD, Wazuh, vulnerabilities, certificates, SOC, training and obligations, plus results from external scripts; period tests for SOC 2 Type II.",
    body: `
## What it is for
For SOC 2 Type II (and increasingly ISO 27001) the auditor wants to see that a control operated **throughout the period**, not only on the day of testing. A control **monitor** automatically checks data CONTIX already has at the set frequency (daily, weekly, monthly) and stores each run as an **immutable record** with a summary and details. A monitor changes nothing – it only reads.

## What can be monitored
- **MFA on accounts** – share of enabled accounts with registered multi-factor authentication (Entra ID, AD).
- **Account hygiene** – critical and high findings in Identity and access.
- **Privileged accounts** – their number against a tolerance.
- **Microsoft Secure Score** – the M365 / Entra tenant score (the app needs the SecurityEvents.Read.All permission, read-only).
- **Vulnerabilities past their remediation deadline** and **actively exploited vulnerabilities (KEV)**.
- **Configuration compliance (Wazuh SCA)**, **Wazuh agent coverage of assets**, **systems without support (EOL)**.
- **Certificates** that are expired or expire soon and **SOC alerts past their deadline**.
- **Mandatory training completion** and **acknowledgement of valid documents** (share in %).
- **Overdue obligations** – deadlines from all modules (document reviews, suppliers, access reviews, tasks…), optionally only selected types.
- **External check** – the result is sent by your script (see below).
Each monitor has a threshold (minimum in % or a tolerated count). When the source has no current data (e.g. the directory did not synchronize), the run ends as an **error** – never as passed.

## New monitor
**Controls → Continuous monitoring → New monitor**: choose the control, what to check, the frequency and the threshold. **Run now** verifies the setup. The table shows the last result, a strip of the last 30 runs and the 90-day pass rate; a control's monitors are also on its detail. A monitor with run history cannot be deleted (it is evidence) – only disabled.

## External check and a task on failure
For things CONTIX cannot see itself (backups, firewall configuration checks, restore tests…), create an **External check** monitor and **issue a token** in its settings (shown only once). When done, your script sends the result: \`POST /api/public/monitors/result\` with the header \`Authorization: Bearer <token>\` and a JSON body \`{"result":"pass"}\` or \`{"value": number of errors}\` (compared with the tolerance), optionally \`summary\` and \`details\`. If no result arrives within the monitor's interval (+ 2 h), an **error** run is recorded. **Create a task on failure** creates a task for the control owner due in 7 days; while it is open, further failures do not create another one.

## Period test and SOC 2 Type II
**Test for a period** turns the runs into a completed **operating effectiveness test**: each run is a sample, failed runs and source errors are exceptions, and if fewer than 90 % of the expected runs took place, a **monitoring gap** exception is added. The run log is attached as evidence (CSV). In a **SOC 2** Type II engagement, **Tests from monitoring** creates these tests at once for all controls mapped to in-scope criteria for the report period; the same period is never created twice.
`,
  },
  controls: {
    title: "Controls, compliance and the Statement of Applicability",
    summary: "Control catalog, mapping to regulatory requirements and the Statement of Applicability.",
    body: `
## Configuration compliance (Wazuh SCA)
**Controls → Configuration compliance** loads **Security Configuration Assessment** results from Wazuh – checks against CIS benchmarks and other policies on the agents. CONTIX downloads them once a day (or with the **Load from Wazuh** button) and only reads them. It shows the **compliance score** (passed / passed + failed checks) by policy and asset, the **most frequently failed checks** with references to frameworks (CIS Controls, ISO 27001, NIST, PCI DSS…) and, in the asset detail, failed checks with remediation steps. The **Automated control test** based on the score and thresholds (effective / with exceptions) records a completed test with CSV evidence at the configured frequency; it changes control effectiveness only if that option is turned on.

## Control catalog
**Frameworks in scope:** the act and the decree by the company's regime (higher obligations = 409, lower = 410) always apply. Choose additional frameworks (ISO 27001, DORA, NIS2, SOC 2, ISO 9001, CIS Controls v8.1) in **Administration → Settings → Frameworks in scope** or in the root company dialog in **Administration → Companies** (applies to the whole group); a subsidiary can have its own selection in the same dialog. The dashboard and the Controls cards then show only frameworks in scope; the others stay available as “not in scope”. Without a selection, frameworks that already have an assessment or mapped controls are in scope. Each group company has its own regime – a new subsidiary takes it over from its parent.

At the start you can **create the default control catalog**. A control has a responsibility, an implementation status and links to requirements (Decree No. 409/2025 Coll. / 410/2025 Coll., the Cybersecurity Act, ISO 27001, DORA, NIS2, SOC 2). When the catalog is created with mapping, the controls based on Decree No. 409/2025 Coll. are also linked to related requirements of the other frameworks – for NIS2, the letters of Art. 21 of the directive and the annex points of Implementing Regulation (EU) 2024/2690 (indicative CONTIX mapping). For a catalog created earlier, add the related requirements with the **Complete mapping** button – choose the frameworks (e.g. NIS2), view a preview of what will be added to each control and confirm. Existing links remain; nothing is removed.

## NIS2
The **NIS2** framework contains the official Czech wording of the obligations of entities under Directive (EU) 2022/2555 (Art. 20 governance, Art. 21 risk management measures, Art. 23 incident reporting) and the 161 annex points of Implementing Regulation (EU) 2024/2690 in 13 areas (policy, risks, incidents, continuity, suppliers, development and maintenance, effectiveness, hygiene and training, cryptography, human resources, access control, assets, physical security). The Implementing Regulation directly binds only selected digital providers (DNS, cloud, data centres, managed services…); for others it serves as a detailed reference catalog. In the Czech Republic, Art. 21 of the directive is implemented by the Cybersecurity Act and Decrees No. 409/2025 Coll. and 410/2025 Coll. – assess primarily against them.

## Regulatory profile
Each company has a **regulatory profile** (Administration → Companies, for the root also Administration → Settings): **country / legislation** and, accordingly, the obligation level and the **main framework**. The **Czechia** pack = Act No. 264/2025 Coll. with higher (Decree 409) or lower obligations (Decree 410), or an unregulated company. The **Slovakia** (Act No. 69/2018, NBÚ / SK-CERT), **Poland** (UKSC, key / important entity, CSIRT NASK / GOV / MON), **Germany** (BSIG as amended by NIS2UmsuCG, particularly important / important entity, BSI) and **Austria** (NISG 2026, essential / important entity) packs have entity categories and reporting deadlines under the national NIS2 transposition (early warning 24 h, notification 72 h, final report within 1 month, citing the national provision); the main framework is NIS2 with Implementing Regulation 2024/2690, or the national law text imported into the framework library. The packs reflect the state as of 10/2026 – check the current wording. The **No national legislation** pack is for companies in other countries or voluntary management: choose the main framework from the library (ISO/IEC 27001, NIS2, another country's imported law). The profile drives the default framework in the SoA, coverage and dashboards, tracked frameworks, the default **checklist of a new audit** and audit coverage, and the recommended **risk methodology** (Czechia: Annex 4 of the Decree, otherwise a 5 × 5 matrix – a subsidiary without its own methodology gets the one of its pack). An audit checklist can be created from any library framework with the “Audit” use (e.g. CIS v8.1, ISO/IEC 27001, a custom framework). **Incident reporting** follows the profile: Czechia under the Act (NÚKIB / national CERT, deadlines of § 16), no national legislation under Art. 23 of the NIS2 Directive (significant incident: early warning within 24 h, notification within 72 h, final report within 1 month – check the national transposition). Outside the Czechia pack, document and significant-change checks do not cite sections of the Czech Decree; the management report and the setup guide show the profile.

## Financial entity (DORA)
If the company is a **financial entity under DORA, Regulation (EU) 2022/2554** – a bank, insurer, payment institution, investment firm etc. – tick **Financial entity under DORA** in the regulatory profile. It does not depend on the country: DORA applies directly in all EU Member States. CONTIX then **always tracks DORA** (alongside the pack's act and decree), for the no-national-legislation pack DORA is the main framework, and **incidents are reported under DORA**: a major ICT-related incident (criteria of Regulation 2024/1772) – initial notification within 4 h of classification, no later than 24 h of awareness; intermediate report within 72 h of the initial notification; final report within 1 month of the latest intermediate report (Regulation 2025/301). The recipient is the **financial supervisory authority** (ČNB, NBS, KNF, BaFin, FMA). National obligations DORA does not cover (registration, state of cyber threat) remain. In module headers (risks, incidents, audits, controls, SoA, ISMS…) the **Framework** badge shows what the active company's module follows, e.g. “Framework: Vyhl. 410 · ZKB · NÚKIB” and “DORA · supervised by ČNB”.

## Outputs by framework
Documents and reports follow the **company's main framework** (regulatory profile): the header shows a **Framework** line and the legal basis, references in the text match the framework. Decree 409 – Section 8 (risk assessment), Section 3(f) and (g) (review); Decree 410 – overview of security measures and its annual update (Section 3(2)); **DORA** (financial entity) – ICT risk assessment report (Art. 6 and 8, Regulation 2024/1774), ICT risk treatment plan (Art. 9), **review of the ICT risk management framework** (Art. 6(5), at least annually); NIS2 – Art. 21 and the Annex to Implementing Regulation 2024/2690; ISO/IEC 27001 – clauses 6.1.2, 6.1.3 and management review 9.3. The statement of applicability follows the framework it is compiled for. The framework is stored in the document version when it is created – a later profile change does not alter older versions. For a financial entity the **management report** adds DORA indicators: major ICT-related incidents, ICT third-party register gaps and digital operational resilience testing (exercises in the period). The **incident report basis** follows the company's rules: for DORA the initial notification / intermediate / final report on a major ICT-related incident for the supervisory authority (ČNB…), with the LEI code and the classification criteria of Regulation 2024/1772; for NIS2 with the national provision. Framework pickers show **tracked frameworks first**, the rest under “Other frameworks”.

## Framework library
**Controls → Framework library** lists all frameworks by jurisdiction (Czechia, EU, international and others) with type (law, regulation, EU directive, standard, best practice, internal requirements) and use (compliance / SoA, audit, risk analysis). **Import framework** adds your own framework – e.g. another country's law and regulation, an industry standard or the group's internal requirements:
- a **CSV / XLSX table** with columns ID, Section, Section title, Text, Guidance, Level, Mapping (download the template in the import dialog; framework details – key, name, jurisdiction, type – are filled in the form),
- a **CONTIX YAML / JSON / XML package** – the same shape that **Export** produces (to move a framework between installations),
- an **OSCAL catalog** (JSON / YAML) – e.g. NIST SP 800-53.

**Preview** shows the number of requirements, sections and mappings, errors and warnings. The **Mapping** column holds requirement IDs of other frameworks (e.g. nis2:21/2/a; iso27001:A.5.1) – mappings apply both ways and **Complete control mapping** uses them to add the custom framework to controls that already have a related requirement mapped. Importing the same key again updates the framework: assessments of requirements with the same reference are kept. Then choose the custom framework among the company's **tracked frameworks** and assess it in the statement of applicability like built-in frameworks. A custom framework can be deleted; if it has assessments or links, they are deleted only after confirmation.

## CIS Controls v8.1
The **CIS v8.1** framework contains 18 controls and 153 safeguards with implementation group **IG1–IG3**. Numbers follow CIS, titles are short CONTIX labels (the CIS text is licensed – get the full text from cisecurity.org). For a tracked framework choose the **implementation group**: IG1 (56 safeguards – essential cyber hygiene), IG2 (130) or IG3 (all). Safeguards of a higher group are automatically not applicable with a justification; an explicit assessment takes precedence. Add the mapping from decree 409 to CIS to the default catalogue controls with **Complete control mapping** (framework CIS v8.1) – it is not added on its own until you track CIS.

## Compliance and SoA
For each requirement you mark applicability (with a justification) and the compliance level. This produces the **Statement of Applicability** and the compliance level; approved versions are stored as an ISMS document (print, Word).

## Tests and evidence
For a control you can plan design and operating effectiveness tests with samples and attach evidence with a validity period. The test result affects the control's effectiveness and therefore the residual risk.
`,
  },
  "incidents-handling": {
    title: "Incident handling and reporting to NÚKIB",
    summary: "Event assessment, reporting deadlines and the incident handling record.",
    body: `
## Searching and sorting
The list of events and incidents can be **filtered** (classification, status, category, owner, asset, period, significant impact), **sorted** by clicking a column header (again to reverse, a third time to clear) and **grouped** by category, status, classification, owner, asset, cause or month. Save the combination as a **view** (disk icon) – personal or **shared** with the whole team (e.g. “Open phishing”). Pick a view in the drop-down next to it; the same name overwrites an earlier view.

## From event to incident
A reported event (from an employee, or from a Wazuh alert as a suggestion) is assessed: impact, affected assets and services. If it is an incident, CONTIX calculates the **reporting deadlines** under the Act (initial report, interim reports, final report) and shows them in the overview and in My obligations.

## Handling
Record handling steps, decisions and communication in the timeline. Record the reports you have submitted (when, to whom, reference number). The AI assistant can prepare an incident summary – always check it.

## Evidence from SOC
For an incident escalated from SOC, the **Evidence from SOC** card shows the alerts (including those from the case), indicators of compromise and response actions, including who approved and performed them. The **Fill in from SOC** button suggests texts for the Evidence, Indicators and Measures taken fields, new progress entries, the start of the incident based on the first alert and the affected assets – you choose what to take over, check it in the form and save. Only lines that are not yet in the record are added, so it can be used repeatedly.

## Reports to NÚKIB / ÚOOÚ
The **Prepare report** button (or **Report** at a deadline) assembles a prefilled report of the selected type – initial report, notification, interim and final report, voluntary report or personal data breach notification to ÚOOÚ. The data come from the incident, from the organization settings (name, company ID, regulated services, **Incident reporting contact**) and, for an incident from SOC, also the number of alerts, ATT&CK techniques and indicators. At the top there is a **checklist of missing mandatory data** with where to fill it in. Copy the text into the NÚKIB Portal or an e-mail (or download a .txt or print it) and then choose **Record submission** – the report content is stored with the submission record and the deadline is marked as met. CONTIX never sends a report by itself.

## Incident handling record
The **Handling record** button creates a document under § 14(1) of Decree No. 409/2025 Coll. (print / PDF or Word): identification and responsibility, classification and reporting obligation, impact, detection from SOC, evidence and IOCs, measures and response actions (who proposed, approved and performed them), reports and deadlines, cause and lessons learned, progress. Incomplete handling steps are listed at the top – supporting material for an audit and for a NÚKIB inspection.
`,
  },
  soc: {
    title: "SOC: alert queue, triage and AI advisors",
    summary: "Wazuh and manually reported alerts, analyst takeover, MITRE ATT&CK, playbooks, escalation to an incident and the SOC advisor.",
    body: `
## Sorting the alert queue
The queue can be filtered by status, minimum severity, **source** (Wazuh, phishing, network scan…), **period** of last occurrence, AI triage, threat feed match and assignment. Click a column header to sort by severity, title, status, analyst or deadline; **grouping** by source, severity, host / asset, rule, ATT&CK tactic, analyst, status or day shows what repeats. Save the combination of filters, sorting and grouping as a **view** – personal or shared with the SOC team.

## Alert queue
Wazuh alerts (above the configured level, grouped by rule and host) and **manual alerts** (reports from another tool, a phone call, an e-mail) form one queue. At the top you see open, unassigned and critical alerts, escalations and the **time to acknowledge** (30-day median). The **MITRE ATT&CK tactics** strip shows where attacks appeared in the last 30 days – click a tactic to filter the queue.

## Triage
An analyst **takes over** the alert (or assigns it to a colleague) – it moves to In progress. The detail shows occurrences, the host and asset, the history of the same rule (how often it was previously closed as a false positive or escalated) and the asset's open vulnerabilities. **ATT&CK** techniques come from the Wazuh rule or are estimated from the rule groups; the analyst can edit them. Based on the techniques a **playbook** is suggested – a checklist of steps you tick off. Record findings and actions in the **notes**.

## Closing or escalating
Close the alert with a **verdict** (false positive, benign activity, undetermined) and a reason, or **escalate it to an incident** – a security event is created with the asset, techniques and timeline and continues in incident handling (reporting deadlines). A closed alert can be reopened.

## Cases
Related alerts are grouped into a **case** – automatically (same host or same source IP within the correlation window, 24 h by default) or manually: select alerts in the queue and choose **To case**. When the alerts form an **attack chain** (e.g. credential access followed by privilege escalation, or steps ending in exfiltration or impact), the case severity is raised by one level. Taking over a case also takes over its unassigned alerts; closing it closes its open alerts with the same verdict; escalation creates **one incident** for all open alerts of the case.

## Deadlines (SLA)
Every alert and case has an **acknowledge** and a **resolve** deadline by severity (defaults: critical 15 min / 4 h, high 1 h / 24 h, medium 4 h / 72 h, low 24 h / 7 days; the administrator changes them in **Deadlines and correlation**). An alert in a case follows the case deadline. When a deadline is missed, SOC analysts get an immediate notification (e-mail, and Teams if enabled) and the item appears in team obligations; assigned items appear in the analyst's **My obligations**.

## Suppression and rule tuning
Suppress recurring false positives when closing an alert (**Suppress repeats**) or on the **Suppressions** tab: a Wazuh rule, optionally a host and source IP, always with an expiry date (at most one year). Suppressed alerts are not created, only hits are counted; the rules also appear in **Exceptions** with a reminder before expiry. The **Rule tuning** tab shows each rule's alerts, escalations and false-positive rate with advice (tune / review / useful).

**Rule change proposals:** the flask icon next to a rule prepares an **exception** proposal from Wazuh Indexer data – it finds a trait (field and value) shared by most of the rule's events that does not fall into alerts marked as a true attack or escalated. A proposal can also be created manually (exception or level change, conditions on IP, user, program, host, location or event field). **Simulation** counts how many events over 30 days the change would hide and whether it would hide events of true attacks. Approval requires the Approve SOC responses permission and a person other than the author; a change that would hide a true attack can only be approved with a justification. Download approved proposals as a **rules file (XML)**, deploy it on the manager (/var/ossec/etc/rules/), verify with wazuh-logtest and restart the manager – CONTIX writes nothing to Wazuh by itself. The noisy rules overview and proposal status are also available as an AI query and MCP tool (Wazuh rule tuning).

## Vulnerabilities and risks
When an alert targets an asset with an open vulnerability, CONTIX flags it. An exploit attempt (the alert mentions a CVE that is open on the asset, or an exploitation technique such as T1190 on an asset with a high or critical vulnerability) **raises the severity by one level** – and with it the deadlines. Alerts and cases show the **risks of the affected assets** from the register, and the risk detail shows **SOC signals** (alerts, real attacks and exploit attempts in the last 90 days) with a suggestion to consider reassessment – the risk itself never changes automatically. The management report includes a **Security monitoring (SOC)** chapter.

## Alert sources and phishing reports
Besides Wazuh, the queue accepts alerts from other tools via a **webhook with a token** (**Sources** tab, administrator): generic JSON, **Suricata** (eve.json lines, alert events only) and **Microsoft Defender** (Defender for Endpoint and Microsoft Graph – e.g. from a Logic App). The token is shown only once and CONTIX stores only its hash; it can be renewed or the source disabled at any time. Events are grouped by source, rule and host, the asset is matched by hostname or IP, and suppression of repeats works for them too. Receive syslog and server logs through Wazuh.

Employees report suspicious e-mails via **Report phishing** – ideally with the .eml attached. Only headers (sender, Reply-To, Return-Path), SPF / DKIM / DMARC results, links and attachment names are stored, not the message text. Same sender and subject = one alert with a report count (campaign). The alert gets technique T1566 and the Phishing playbook; failed sender authentication or an attachment raises the severity. Links are shown inactive (hxxp) in the detail.

## Indicators of compromise (IOC)
The **IOC** tab records attacker IP addresses, domains, URLs, file hashes and e-mails. In the alert detail, the **Indicators** card offers values from the alert (external source IP; for phishing the sender, sender's server, links and their domains; hashes from the description) – select them and choose **Block** or **Monitor only**. Several values can be entered at once (the type is detected, evil[.]com and hxxp:// are converted). Each IOC has a validity (default 90 days); internal IP addresses cannot be blocked.

**Retro hunt** searches alerts in the Wazuh Indexer (read only) and in CONTIX for the last 30 days and shows on which hosts the value appeared – e.g. who visited a phishing domain. The **block list** (text or CSV) and the **feed** for a firewall or proxy (External Dynamic List, Threat Feed – a URL with a secret token the firewall downloads itself) contain only active IOCs with action Block; a revoked or expired IOC drops out of the feed automatically.

## Response with approval
**Instant notifications:** a new alert from the set severity (default critical only) is sent to SOC analysts right away by e-mail and Teams (channels per Administration → Notifications), each alert only once.

**Response actions** are proposed by an analyst in the alert detail (**Propose action**) – block an IP, disable an account, force a password change, isolate a device or another action with a reason. Nothing is executed without approval by a person with the **approve SOC actions** permission; with the **four-eyes principle** on, the approver must differ from the requester (they are notified). After approval CONTIX sends an **IP block** right away via **Wazuh Active Response** to the selected agents (a separate Wazuh API account with only active-response:command, configured on the **Response** tab); the blocked IP is also added to the IOC block list. Unblocking is governed by the Active Response settings in Wazuh. Other actions are performed by an administrator (CONTIX does not change AD accounts or devices), who records the result with **Mark as done**. Every step (proposal, decision, execution, failure) goes to the audit log, the alert notes and the incident timeline – evidence for the incident handling record.

## Public threat feeds
On the **Sources** tab, the **Public threat feeds** card downloads lists of known malicious IPs, domains, URLs and hashes: **abuse.ch Feodo Tracker** (botnet C2 servers, no key), **URLhaus** and **ThreatFox** (require a free Auth-Key from auth.abuse.ch, stored encrypted) and **custom lists** (e.g. national CERT warnings, one value per line). Feeds are **only downloaded** – nothing from CONTIX is sent. Server without internet: download the file elsewhere and **upload** it.

After a download CONTIX compares the feeds with alerts of the last 14 days (source and destination IP, phishing links and domains, hashes) – a match shows as a **Known threat** badge in the queue (also a filter) and a notice in the alert detail, and AI triage receives it too. With **Wazuh hunting** on, the scheduler searches new Wazuh Indexer alerts (read only) and on an IP or domain match creates an alert **Communication with a known threat** for the host (repeats are added, can be suppressed).

## Cortex and MISP
The **Cortex and MISP** card on the **Sources** tab (configured by an administrator) connects CONTIX with SOC analysis tools:

- **Cortex** – IOC enrichment with analyzers. After entering the URL and API key (a Cortex user with the analyze role), **Save and test** loads the list of analyzers. Analysts can run **only the ticked** analyzers. Each one shows whether it is **local** (MaxMind, Yara, FileInfo, MISP…) or **sends the value to a third party** (VirusTotal, AbuseIPDB, Shodan…) – allow those only deliberately. Only the value, type, TLP and PAP are sent to Cortex, never the alert context, names or notes.
- **MISP** – **pulling** attributes (IPs, domains, URLs, hashes, e-mails) for the chosen period as another threat feed: matching against alerts and hunting in Wazuh work as for abuse.ch, pulled together with the other feeds. **Looking up a value** in MISP shows the events that contain it. **Sharing IOCs** creates a new event from the selected valid IOCs (distribution, TLP and threat level per settings, optional publishing) – requires the **Share IOCs to MISP** permission; analyst notes are not shared.

An analyst starts an analysis with **Analyze** on an IOC (IOC tab) or on a candidate in the alert detail. The result – a verdict (safe, suspicious, malicious) and the analyzer taxonomies, for MISP links to events – is stored with the alert and the IOC (**IOC enrichment** card) and the full report is available. A longer-running analysis is completed by CONTIX in the background.

**Internal data are never sent**: private IPs, single-label names, .local, .lan, .internal, .corp, .test domains etc. and the **internal domains** entered in the settings are rejected by CONTIX (for analysis and sharing). Every analysis, lookup and share is in the audit log; API keys are stored encrypted.

## Microsoft Sentinel and Elastic Security
On the **Sources** tab you can create a **Microsoft Sentinel** or **Elastic Security** source. Alerts can arrive via webhook (Sentinel Logic App / playbook, Kibana Webhook connector) or CONTIX **pulls** them at an interval: for Sentinel the incidents changed since the last pull (an Entra ID application with the Microsoft Sentinel Reader role, the client secret is stored encrypted), for Elastic the new alerts from the .alerts-security.alerts-* index (API key or a user with read privilege). Closed Sentinel incidents are skipped, ATT&CK techniques are taken over. **Pull** pulls immediately and checks the settings; on error the cursor is not moved and the error is shown at the source. The SIEM is only read.

## Host view
The **Hosts** tab lists machines with alerts in the selected period (or with open alerts) – inventory assets as well as agents that have no asset yet; sorted by open alerts and severity, flagged for exploitation attempts and known threats. The host detail (also the **SOC host view** button on an asset or the host link in the alert detail) puts everything in one place: **activity over time** by severity, ATT&CK tactics (click to filter alerts), alerts, open vulnerabilities with P1–P4 priority and KEV, incidents and SOC cases, asset risks, playbook tasks and response actions, IOCs and threat feed matches. Everything is computed from current data.

## Playbooks and team tasks
The alert detail suggests a playbook by ATT&CK techniques and tactics – preferring an **organisation playbook**. On the **Playbooks** tab you **customize** a built-in procedure (a copy is created) or create a new one: steps, responsible **position** and **deadline** in hours. **Assign team tasks** on the playbook card creates tasks in **Actions and tasks** from the selected steps (owner and due date can be changed, priority follows the alert severity); position holders see them in **My obligations**. Completing a task marks the playbook step as done and records who completed it in the alert notes. A playbook used by alerts is only disabled when deleted.

## Scheduled threat hunting
The **Threat hunting** tab runs saved queries over Wazuh Indexer alerts (same syntax as Wazuh Dashboard search, e.g. "rule.groups:authentication_failures"). Results are **grouped** by the chosen field (host, source IP, user…) and each group with hits above the **threshold** creates a **Threat hunting** alert with the configured severity and ATT&CK techniques. The scheduler runs hunts at the set **interval**, always only over the new window since the last run; on error the window is not moved. **Test** checks the last N hours without creating alerts – useful for tuning the query and threshold. The **hunt library** contains ready-made queries (password guessing, log clearing, encoded PowerShell, credential dumping, scheduled tasks and services, new admin accounts, critical file changes). The indexer is only read.

## SOC and AI performance
The **Performance** tab shows for the selected period (30–365 days) the number of alerts, escalations, false-alarm share, median **time to acknowledge** and **time to decision**, and SLA compliance by severity; the by-source table reveals a tool that only produces noise. The **AI pre-triage** card compares the model's suggestion with the analyst's final decision (attack vs. false alarm): **agreement**, agreement by model confidence, **missed attacks** (AI suggested a false alarm but it was an attack – review each) and over-calls. With agreement below 60 % or any missed attacks, treat suggestions as indicative only and add organisation guidance in the AI settings. Time to decision and AI agreement also appear in the SOC chapter of the management report.

## AI pre-triage (local model)
The scheduler pre-assesses every new open alert: it finds **similar decided alerts** from the last 180 days (same rule, host, source IP or ATT&CK technique) and the local model suggests a **verdict, severity and confidence** with reasoning. The queue has an **AI suggestion** column and filter (likely attack / likely false alarm). In the alert detail, **Apply suggestion** opens closing with the verdict prefilled, or escalation – the analyst always confirms, nothing is applied automatically. **Re-assess** runs the triage again (e.g. after adding techniques). The model receives alert data and only the verdicts of similar alerts – no names, notes or analyst reasoning. It can be turned off in **Deadlines and correlation**.

## AI advisors (local model)
- **AI alert analysis** – what is probably happening, what the attacker typically does next, how to verify it quickly, recommended steps and signs of a false positive. The analysis is saved with the alert.
- **SOC advisor** – questions about attack types, ATT&CK techniques and vulnerabilities; for a CVE it adds data from your vulnerability register (on which assets it is open).

The model receives data about the alert, techniques, asset and its vulnerabilities; never person names or analyst notes. Always verify the advice before acting.
`,
  },
  isms: {
    title: "ISMS management and the management report",
    summary: "Significant changes, ISMS objectives and review, management report.",
    body: `
## ISMS management
- **Significant changes** (§ 11) – register of changes, impact assessment against the organization's criteria (can be set per company) and implementation deadlines.
- **Objectives and effectiveness** – measurable ISMS objectives and their evaluation.
- **Review** – the management review report of the ISMS; CONTIX tracks the date of the next review.

## Management report
A traffic light of the main indicators (risks, incidents, compliance, training, documentation) for the selected period – for printing or in Word.
`,
  },
  audits: {
    title: "Audits, findings and corrective actions",
    summary: "Audit plan, checklists, findings, corrective actions and the auditor package.",
    body: `
## Audit plan and execution
**New audit** – type (full-scope audit, continuous audit by sections, audit on a significant change, supplier audit, inspection, NÚKIB inspection), scope, date and auditor (who must meet the experience and impartiality requirements). The checklist is based on the chosen audit methodology (regulatory requirements or a custom list from Administration → Methodologies); for each item you record the result and evidence.

## Findings and corrective actions
Assign a corrective action with a due date and a responsible position to each finding (major / minor nonconformity, observation, recommendation). Overdue actions appear in **My obligations** and on the Overview. Coverage shows which areas of the regulation have not yet been audited.

## Auditor package
The **Auditor package** prepares a ZIP with the Statement of Applicability, control tests and evidence – for an external audit without the need for access to CONTIX.

## External auditor portal and evidence requests
On the audit detail, the **Evidence requests (PBC)** card keeps the list of what the auditor requests – one by one or in **bulk** (a line "title; criterion reference; due date", e.g. from the auditor's list), with an **owner** (position) and due date. The owner uploads files, may add a comment and chooses **Send to auditor** – only then does the auditor see the files; a sent file can no longer be deleted, only a corrected one added. Open and returned requests appear in the owner's **My obligations**.

The external auditor gets an account with the **External auditor** role (Administration → Users) and the audit manager assigns them with the **External auditors** button. After signing in, the auditor sees only the **Auditor portal** with their audits – requests, sent files (always downloaded as attachments, with SHA-256) and comments; they **accept** the evidence or **return it for completion** with a comment. They see neither owner names nor any other CONTIX data. Every upload, send, download, acceptance and return is in the audit log; **Download evidence (ZIP)** gives the sent files with a manifest.
`,
  },
  continuity: {
    title: "Continuity: business impact analysis (BIA) and plans",
    summary: "Process BIA (MTPD, RTO, RPO), continuity and recovery plans and their tests.",
    body: `
## Exercises and tabletop scenarios
An **Exercise** tests continuity and incident response plans. Create a new exercise from a **scenario template** (ransomware, cloud provider outage, power outage, personal data leak, compromise of an executive's account) or start from scratch. During **preparation** you edit the scenario, objectives, participants, facilitator and the **scenario injects** with their time from the start. After the **start**, the facilitator releases the injects (CONTIX keeps track of the time) and records decisions, notes and issues with the time and author. The **Evaluation** records the outcome, the RTO achieved, whether the objectives were met, findings and lessons learned; corrective actions are created as **tasks** and the result is recorded as a **test of the linked plans**. The **Audit record** can be printed or downloaded in Word. A scheduled exercise appears in the facilitator's obligations.

## Business impact analysis (BIA)
BIA is carried out for processes: the impacts of an outage over time (financial, operational, legal, reputational) determine the **MTPD**, and from it the **RTO** and **RPO**. Availability requirements are passed on to the process's supporting assets. The periodic BIA review takes place in an assessment cycle.

## Continuity and recovery plans
The **Plans** tab – a continuity, recovery, incident response or crisis communication plan for processes and assets: scenario, procedure, responsibilities and resources. A plan is approved and regularly **tested** (tabletop exercise, walkthrough, simulation, full test); the test result and findings are recorded with the plan. CONTIX tracks test dates (Overview, My obligations).
`,
  },
  actions: {
    title: "Actions and tasks",
    summary: "A single overview of corrective actions and tasks from all areas – responsibility, deadlines, completion.",
    body: `
## What the overview contains
**Actions & tasks** gathers in one place everything that needs to be done: **tasks** (created in CONTIX), **risk treatment plan actions**, **corrective actions from audit findings** and **tasks from regulatory changes**. Overdue actions are at the top, then by due date. Filters: type, status, **Mine** (actions of the positions you hold), overdue only, search. The overview can be downloaded as CSV. Ticking tasks shows the **bulk changes** bar: status (done, in progress), new due date and new owner. Due date and owner are changed only by a task administrator; tasks you lack permission for are skipped.

## Tasks
**New task** – what needs to be done, the responsible **position**, due date, priority. A task can also be created directly on a record (the **Tasks** card on an incident, supplier, change, control, asset or process) – it is then linked to the record and moves with it between companies. The holder of the position sees a task with a due date in **My obligations** (and in the e-mail summary) and can change its **status** and record **how it was completed**; other details are changed by a task administrator.

## Actions from other modules
Treatment plan actions, audit findings and tasks from regulatory changes are edited at their own record – the overview links to them. Their status is reflected in the overview automatically.
`,
  },
  knowledge: {
    title: "Knowledge base",
    summary: "Your own knowledge articles – procedures, FAQs and SOC runbooks; published ones are found by quick search and used by the AI assistant.",
    body: `
## Articles
Create a **New article** with the button at the top right. The text is written in Markdown (## heading, **bold**, - bullets) with a preview alongside. Tags (comma-separated) help with searching.

## Publishing
A draft is visible only to authors (permission Write and publish knowledge articles). A **published** article is visible to everyone with Read knowledge articles and goes into the vector index – split into sections by ## headings, so the AI assistant cites a specific part of the article.

## What belongs in articles
Procedures that are not controlled documentation: how to report an incident, a phishing runbook, a password and MFA FAQ, support contacts of suppliers, lessons from exercises. Controlled documents (policies, directives) belong in Documentation.
`,
  },
  trust: {
    title: "Customer questionnaires and Trust Center",
    summary: "Answers to customer security questionnaires with AI proposals from documentation and controls, an answer library and a public trust page.",
    body: `
## Customer questionnaires
In **Questionnaires and Trust Center → Questionnaires** upload the customer's questionnaire (XLSX or CSV). In the preview check the question column and optionally the ID column; a row with only a heading becomes a section. Questions with a very similar approved answer in the library are pre-filled as a draft.

## Answer proposals (AI)
On the questionnaire detail, **AI proposes** answers to the next 20 unanswered questions. The local model only gets the evidence for each question: library answers, your controls with status and effectiveness, excerpts of current documentation you may read, and certifications from the Trust Center. Each answer shows the sources used and a confidence level. A control that is only planned or ineffective leads to at most a Partially answer.

## Approval and export
Edit and **approve** each answer (one by one or selected drafts at once). When all are approved, **approve the questionnaire** – the answers are saved to the **library** and reused next time. The **XLSX export** contains the row of the original file, the question, answer, comment and sources; you transfer them into the customer's form yourself. Nothing is sent automatically.

## Trust Center
On the **Trust Center** tab set up the public trust page at /t/<address>: introduction, certifications, a summary of controls by category, continuous monitoring (90-day pass rate only), selected subprocessors and documents. Publish a document **publicly** or **after approval (NDA)** – always only the current approved version as a PDF with a footer.

## Access requests
A visitor requests access to confidential documents and must accept the non-disclosure terms. You approve the request in **Access requests**: a time-limited link is created (you set the validity) and e-mailed to the requester; without configured e-mail you pass it on yourself. The downloaded PDF carries the recipient's name, organization and e-mail. Access can be revoked at any time.
`,
  },
  suppliers: {
    title: "Suppliers and contracts",
    summary: "Supplier register, identification of significant suppliers, security questionnaires and contract requirements under the Decree.",
    body: `
## Register
**New supplier** – company ID, name, services provided, linked assets and processes. The **Look up in ARES** button finds the company by company ID or name and fills in the name, company ID and registered address (the query is sent by the CONTIX server; only the company ID or name goes to ARES). Suppliers can be loaded in bulk via **Data import**.

## Significant supplier
Based on the criteria of the Decree (impact on regulated services, access to assets) you determine whether a supplier is **significant**. For a significant supplier, CONTIX checks the **contract requirements** under the Annex to the Decree (409 / 410 according to the company's regime) and shows the gaps.

## Security questionnaire
On the supplier card, **Send questionnaire** creates a unique link through which the supplier fills in a security questionnaire **without signing in** (in Czech or English). The **full** scope (30 questions) is for the higher-obligations regime, the **short** one for Decree No. 410/2025 Coll. The link can be sent by e-mail (SMTP from Administration → Notifications) or copied – it is shown only once; **New link** issues a different one and the old one stops working. The supplier can save answers as they go and **attach files** to questions or in general (PDF, Office, image, text; max. 10 MB, 20 files); after submission they can no longer change them (you can **return it for completion**).

A submitted questionnaire shows the **score**, shortcomings and a **suggested risk level** (a "no" to a key question = high). After the **evaluation**, the risk assessment date is recorded on the supplier (§ 9(2)(a)). The **Create supplier risk** button creates a risk listing the shortcomings, linked to the supplier – its owner rates it according to the methodology. Pending and completed questionnaires are tracked by the Overview and My obligations; answers can be printed as supporting material for an audit.

## DORA register of information
Under Article 28 DORA, financial entities keep a **register of contractual arrangements with ICT third-party service providers** (templates of Implementing Regulation (EU) 2024/2956). The **DORA register of information** button in the supplier overview builds it from your records: on the supplier card, in the **DORA – ICT third-party service provider** section, choose **Mark as ICT provider** (or in the register, in the list of **Suppliers outside the register**, with suppliers significant under the Decree first) (LEI, or EUID or company ID, country of headquarters, ultimate parent undertaking); on a contract, fill in the service type (S01–S19), annual cost and **supported functions** – these are processes, criticality, RTO and RPO are taken from the process and BIA, and every process gets a permanent identifier (F1, F2 …). For a contract supporting a critical or important function, also fill in the notice periods, governing law, country of provision and data storage, data sensitivity, level of reliance and the service assessment (substitutability, exit plan, alternatives); list subcontractors in the supply chain. On the **Entities** tab, fill in the LEI and type of financial entity.

The **completeness check** lists missing mandatory data with the template column code (e.g. B_02.02.0050) and opens editing on click; LEIs are validated by checksum. **Concentration** shows how many critical functions one provider or its group supports. **Export templates (CSV)** downloads a ZIP with files B_01.01 to B_07.01 in the template column layout (closed lists as option numbers) – input for the tool that builds the reporting package for the ČNB.

## Deadlines
The contract expiry date appears on the Overview and in **My obligations** of the responsible position.

## Assurance reports (SOC 2, ISO 27001)
On the supplier detail, in the **Assurance reports** card, record SOC 2 / SOC 1 reports, ISO 27001 certificates and penetration tests: type, auditor, period, opinion and validity (default end of period + 12 months). Upload the report as a PDF – the text for AI is obtained by the conversion service on the server; for a scan or without the conversion service paste the relevant sections manually.
- **AI extraction** (local model) proposes **CUECs** – controls we must ensure ourselves – with a suggested own control, **testing exceptions** with the supplier management response and **controls of carved-out subservice organizations**. Only an excerpt of the report and control names go to the model; items are created only after acceptance.
- **CUEC → control**: map each CUEC to an own control. CONTIX warns when a CUEC has no control or the control is planned, not implemented or ineffective.
- **Exceptions → risks**: **Create supplier risk** on an exception creates an unscored risk linked to the supplier with the exception description.
- **Report gaps**: expiry (also reminded in obligations), qualified opinion, period older than 3 months without a bridge letter, unresolved exceptions, carved-out subservice organizations.
`,
  },
  gdpr: {
    title: "Personal data protection (GDPR)",
    summary: "Records of processing activities, screening and data protection impact assessment (DPIA).",
    body: `
## Records of processing activities
**New activity** – purpose, legal basis, categories of data subjects and personal data, recipients, transfers to third countries, erasure periods and technical and organizational measures (Art. 30 GDPR). Link the activity to processes and assets – security is then based on their assessment. The overview shows missing information (gaps).

## Data protection impact assessment (DPIA)
**Screening** against the criteria for high-risk processing shows whether a DPIA is mandatory. A DPIA contains a description of the processing, necessity and proportionality, risks to data subjects and measures; it is locked once approved. A missing DPIA is shown on the Overview.
`,
  },
  ai: {
    title: "AI assistant and natural language queries",
    summary: "What AI in CONTIX does, what it does not do and where it runs.",
    body: `
## Ask AI
Ask a question in plain language ("Which critical assets have no owner?"). The assistant only reads – it picks suitable overviews, CONTIX runs them with your permissions and the model summarises the result.

## AI input on the Overview
The home page has a single field for all questions. CONTIX looks up excerpts of valid documentation and similar records (risks, vulnerabilities, incidents, exceptions) for the question – if enabled in Administration → AI assistant – and the model also runs data overviews as needed. The answer contains numbers [1], [2] with links to the specific document or record. Below the field there are quick questions based on your permissions; "What is overdue?" is highlighted when something is overdue. Full tables and history are in Ask AI.

## Suggestions
For risks, controls, assets, incidents and documents, AI can suggest controls, mappings, classification or a check of a document against the Decree. A suggestion is never saved by itself – you accept or reject each item.

## Ask the documentation
In **Administration → AI assistant**, turn on "Ask the documentation" and enter the model for semantic search (bge-m3 recommended; on a server with Ollama run **ollama pull bge-m3**). Valid document versions are split into chunks and indexed (status and "Reindex" are in the same place, a summary in Operations). Drafts are not indexed; answers are based only on documents the user is allowed to read.

## Similar records and search in registers
In **Administration → AI assistant**, turn on "Record vectors" – risks, vulnerabilities, incidents and exceptions are indexed with the same model as the documentation (status and "Reindex" in the same place). The incident and risk cards then show **Similar records**, and questions about registers get answers with links to specific records. Everyone sees only the records they have permission for.

## Knowledge base and index management
Besides risks and incidents, the vectors now also contain **controls, assets, processes, suppliers, legislative change assessments, approved questionnaire answers and published knowledge articles** – the AI assistant and quick search find them by meaning. In **Administration → AI assistant**, under Record vectors, you see the indexing progress, can switch individual kinds off (they are removed from the index) and in **Browse index** see the exact text the model receives and **exclude** a record – it is not searched and never sent to the model, even after reindexing. Keyword search uses accent-insensitive full-text with word prefixes (finds other word forms); for common embedding models (384, 768, 1024, 1536 dimensions) the search uses an HNSW index, so it stays fast with tens of thousands of records. AI answer proposals for customer questionnaires also pick up differently worded questions from the approved library and controls.

## AI for the AI Act, CRA and incidents
- **AI Act** – on the AI system detail, AI proposes the screening answers (prohibited practices, Annex III, exceptions, transparency). After acceptance the classification is recalculated; if a prohibited practice results, the decision goes back for a new assessment.
- **CRA** – for a product with vulnerabilities in the "Under investigation" state, AI proposes the VEX status, justification and impact statement, taking KEV and EPSS into account.
- **Incidents** – triage proposes whether it is an event or an incident, the category, the cause and whether it is a personal data breach. It uses similar past cases you may read as context.
Every suggestion is only a proposal – nothing is saved until you accept it.

## Related records and tasks
The **Related records** card (e.g. in an information system review or a vulnerability) finds risks, incidents, product vulnerabilities and AI systems on the same topic by meaning. The vectors now also include audit findings including SOC 2 exceptions, AI systems and product vulnerabilities. Tasks can be created directly on an AI system, a CRA product and a SOC 2 engagement.

## Where AI runs
The model runs on the organization's server (locally). No person names or e-mail addresses are sent to the model; every request is recorded in the audit log.
`,
  },
  identity: {
    title: "Identity and access: account checks in AD and Entra ID",
    summary: "Inactive and privileged accounts, risky account settings, MFA – findings, exceptions and export for the auditor.",
    body: `
## What it is for
CONTIX regularly loads accounts from Active Directory and Microsoft Entra ID and checks them against rules: inactive accounts, accounts that have never signed in, accounts of departed employees (deactivated in CONTIX), passwords that never expire, accounts without a password or without Kerberos pre-authentication, user accounts with an SPN (Kerberoasting), unconstrained delegation, an old administrator password, missing MFA and too many members of privileged groups. **CONTIX changes nothing in the directory** – it only reads and shows what needs to be done.

## Connecting a directory (administrator)
The **Sources** tab → **Active Directory** or **Microsoft Entra ID**:
- **AD** – address **ldaps://controller:636**, Base DN, a read-only account (an ordinary domain account without administrator rights) and its password. If the domain controller uses a certificate from an internal CA, paste its root certificate.
- **Entra ID** – an app registration with a client secret and the Application permissions **User.Read.All**, **RoleManagement.Read.Directory** and, with an Entra ID P1 licence, **AuditLog.Read.All** (last sign-in, MFA registration). Without a P1 licence, inactive accounts and MFA are not evaluated – the source says so in a note.
Check the settings with **Test connection**, then **Save** and **Synchronize**. Hybrid organizations connect both sources. Privileged AD groups are recognised by SID (even on a server in Czech); further groups or roles can be added. The rules (days of inactivity, administrator password age, member limit) can be adjusted per source.

## Working with findings
- **Overview** shows findings by severity and rule, the trend over time and the status of sources.
- **Findings** – each rule explains why it matters and what to do. Fix the finding in the directory; at the next synchronization it is marked as **resolved** automatically.
- If the state is knowingly acceptable (e.g. a service account with a long password), grant an **exception** with a justification and a deadline. After the deadline the finding is reopened. Exceptions are recorded in the audit log.
- **Accounts** – search, filter for privileged, disabled and deleted accounts; the detail shows groups including nested ones and the finding history.
- **Findings (CSV)** downloads the list for the auditor or for handing over to the AD administrators.

## Toxic combinations (segregation of duties)
The **Toxic combinations** tab → **New rule**: side A and side B (AD groups, Entra ID roles or CONTIX positions). A violation is a person who has something from both A and B – e.g. "A domain administrator must not approve payments" (A: Domain Admins, B: the Payment approver position). Accounts from AD and Entra ID are joined through the CONTIX user (same e-mail) and their positions. Rules are evaluated after each synchronization and regularly by the scheduler; a violation can be resolved by changing access or who holds the position, or an exception with a deadline can be granted.

## Access review (recertification)
The **Access review** tab → **New review**: scope (sources, privileged accounts only, selected groups), who decides (a single position, or the head of the account holder's unit) and the due date. The list of accounts and access rights is frozen at the start and reviewers receive a task in **My obligations**. For each account they decide **Keep** / **Remove** (describing what to remove). The removal is performed by the directory administrator – CONTIX verifies it at the next synchronization (account disabled or without the reviewed access), otherwise it can be confirmed manually. Once all items are decided, **close** the review; the **Report** (print / Word) is evidence for an audit. Recommendation: privileged accounts quarterly, others at least annually.

## Synchronizing users and structure
In the source settings, turn on **Synchronize users and organizational structure** and enter the group whose members should be CONTIX users (e.g. "CONTIX-Users"). At each synchronization CONTIX:
- creates missing users (they sign in via SSO) with the default role,
- creates units from the **department** attribute and positions from **title**, and assigns the holders,
- deactivates users whose account is disabled, deleted or outside the group.
Synchronization never changes manually created users or positions. **Preview changes** shows the impact in advance. Keep assigning responsibilities (document owner, risk owner…) manually – synchronized positions serve mainly for audiences and unit heads for reviews. Entra ID requires the GroupMember.Read.All permission.

## Automated control tests
The **Control tests** tab: assign an **account check** (weekly / monthly / quarterly, tolerance for critical and high findings) or an **access review** to a control (e.g. "Access rights management"). CONTIX then records on the control a completed test with a sample for each rule (or account) and evidence – the findings CSV or the review report respectively. The test is not performed if the last synchronization of the source failed. Control effectiveness changes only if the "set effectiveness" option is turned on.

## Permissions
Reading: **identity:read** (CISO, cybersecurity manager, auditor). Exceptions and manual synchronization: **identity:write**. Connecting directories: system administrator. Employees have no access to other people's accounts.
`,
  },
  "access-review": {
    title: "Access review: how to decide",
    summary: "The reviewer's task: for each account, confirm whether to keep or remove access.",
    body: `
## What is expected of you
As a manager or system owner, you confirm that people have only the access they need for their work. You find the task in **My obligations**; the link opens the list of accounts you decide on.

## How to decide
1. For each account, look at the **access** (groups, roles; privileged ones in red) and the date of the last sign-in.
2. If the holder needs the access for their work, click **Keep**.
3. If not (change of role, departure, unused account), click **Remove** and write what to remove – e.g. "disable the account" or "remove from the Accountants group".
You can change your decision until the review is closed. The removal is performed by the directory administrator; you do not need to do anything else.

## Not sure?
If you do not recognise an account or your unit should not decide on it, write a note with your decision or contact the cybersecurity manager – they can pass the item to another reviewer.
`,
  },
  group: {
    title: "Group of companies",
    summary: "Several companies in one CONTIX: regime under the Act, group overview and custom settings.",
    body: `
## Companies
**Administration → Companies** – creating a company, the parent company and the **regime under the Act** (higher obligations – Decree No. 409/2025 Coll., lower obligations – Decree No. 410/2025 Coll., unregulated) with regulated services. A company can have its own risk assessment methodology, acceptable level of harm, significant change criteria or SOC 2 report scope; otherwise the organization's settings apply. Only a company without data can be deleted; otherwise deactivate it.

## Working in the group
Choose the company you are working with at the top of the menu. Data, permissions and tasks follow the selected company; roles can be assigned for the whole group or for a single company.

## Group overview
The **Group overview** compares companies side by side: compliance level, critical and unacceptable risks, overdue actions, incidents and overdue reports, suppliers with gaps, the status of risk assessment, BIA and ISMS review. Click a company to switch to it. A record (asset, process, document…) can be moved to another company in its detail.
`,
  },
  import: {
    title: "Data import from Excel",
    summary: "Bulk loading of assets, risks, processes, controls and suppliers from an .xlsx or .csv file.",
    body: `
## Procedure
1. **File** – choose the register (assets, risks, processes, controls, suppliers), upload an .xlsx or .csv file and select the sheet. For existing records, choose whether they are **updated with the filled-in columns** or **left unchanged**.
2. **Column mapping** – CONTIX maps columns by their names (even without diacritics and with synonyms); check the mapping and fill in the mandatory fields.
3. **Preview and validation** – for each row you see whether it will be created, updated or contains an error (invalid value, non-existent user). Only then click **Import**.

## Good to know
Records are matched with existing ones (assets by serial number, hostname or name; suppliers by company ID; others by code or name), so a repeated import does not create duplicates. An import is recorded in the same way as manual entry – with permission checks and in the audit log. Load assets from Wazuh and network scans in **Discovery & import**.
`,
  },
  "admin-setup": {
    title: "Administrator: initial setup and wizard",
    summary: "Step-by-step initial setup of a new organization.",
    body: `
## Setup wizard
**Administration → Setup wizard** shows the steps and their status (done / in progress / missing) with a link to where each step is configured. Recommended order:
1. Organization – name, company ID, regulated services and regime under the Act.
2. Security – two-factor authentication for administrators, SSO and allowed domains.
3. Organizational structure – units, positions and their holders, security roles (cybersecurity manager, cybersecurity architect, cybersecurity auditor…).
4. Users and roles – ordinary employees get the **Employee** role.
5. Assets – Wazuh connection, import, owner check.
6. Risks, controls and the Statement of Applicability.
7. Documentation – folders (a default structure can be created), templates, security policy.
8. Notifications (e-mail / Teams), AI assistant, backups and the conversion service.
9. Optionally, connecting Active Directory / Entra ID for account checks (Identity and access).

## Handover report
When finished, download the **Handover report** (Word) – it summarises the state of the setup, operations and security as of the handover date.

## Sample data
To try CONTIX without your own data, the command \`bun run demo:seed\` (on the server \`docker compose --profile full exec api bun src/scripts/demo-seed.ts\`) creates a fictitious company **Vzorová strojírna a.s. (ukázka)** with an organization, assets, processes, risks, controls, suppliers and tasks. It is a separate group company – your data is not affected. Running it again adds nothing.

## Licence and source code
CONTIX is free software under the AGPL-3.0 licence. The version, licence and a link to the source code are at the bottom of the menu. Set the link with the **CONTIX_SOURCE_URL** variable in the server configuration; if you run a modified version, it must point to the modified code.
`,
  },
  "admin-users": {
    title: "Administrator: users, roles, SSO and security",
    summary: "Accounts, roles and permissions, groups, sign-in via Entra ID / AD FS and security settings.",
    body: `
## Users and roles
Roles are sets of permissions; system roles (Administrator, CISO, Cybersecurity manager, Architect, SOC analyst L1 and L2, IT administrator, Data protection officer, Auditor, Employee…) can be edited, or you can create your own. SOC analyst L1 triages alerts and only proposes actions, L2 approves them (four-eyes principle). A role can be assigned for the whole group or for a single company. Groups make it easier to assign roles to several people at once.

## Sign-in with Active Directory accounts
**Administration → Sign-in → Connect AD**: domain controller address (ldaps://…:636), Base DN and a read-only account. The controller must run LDAPS with a certificate; paste the internal CA certificate into **Root certificate**, or turn verification off for testing. In **Who can sign in** you restrict sign-in to group members, choose whether a user is created at first sign-in and the default role. **Test** checks a specific user's name and password – it shows their groups and roles and creates nothing. Then enable sign-in.

Users sign in with the same name and password as for Windows (john.smith, DOMAIN\john.smith or john.smith@company.local). AD verifies the password, CONTIX does not store it; disabled or locked accounts cannot sign in. Local accounts with a CONTIX password (e.g. the administrator) keep their password and are not linked to an AD account – an administrator can convert an account in **Users** (Sign-in method). CONTIX two-factor authentication applies to AD accounts too. The same AD connection can be used in **Identity and access** for account checks and user synchronisation.

## Roles by groups
In **Roles by AD and SSO groups** you assign groups to a role (AD group name, full DN, Entra ID group ID). Nested membership counts. Roles from groups are refreshed at every sign-in; manually assigned roles stay.

## SSO
Add sign-in via Microsoft 365 (Entra ID), Google or AD FS / Keycloak in **Administration → Sign-in → Add provider**: tenant ID or issuer, client ID and secret (stored encrypted). Enter the redirect URI when registering the application with the provider. Providers from the server configuration are listed as well. SSO rules define whether a user is created at first sign-in, with which role and from which **allowed domains**.

## Accounts
For a local account, an administrator can **reset the password**, **Reset MFA** (lost phone) and **unlock** an account locked after repeated failed attempts. Deactivate the account of a departing employee – the history and evidence are preserved.

## Security
Recommended: mandatory two-factor authentication, a short inactivity timeout, account lockout after repeated failed attempts.

## Audit log
**Administration → Audit log** contains sign-ins and failed attempts, MFA and password changes, SSO events (e.g. a domain that is not allowed) and all data changes – who, when, what and from where. Filter by action or e-mail. Records cannot be edited or deleted.
`,
  },
  "admin-methodologies": {
    title: "Risk analysis and audit methodologies",
    summary: "The built-in methodology under the Decree, custom methodologies (OCTAVE…), import and audit checklists.",
    body: `
## Built-in methodology
The default risk assessment follows Annex 4 to the Decree (impact × threat × vulnerability; scales and thresholds are set in **Settings**). It is sufficient for most organizations.

## Custom methodology
**Edit copy** of an existing methodology, or **Import methodology** (YAML / JSON / XML – paste the content and have it validated). In the editor you set:
- **factors and scales** (e.g. likelihood, impact; scales can be pasted from an Excel table),
- **impact areas** with weights and the way values are combined across areas,
- the risk **formula and levels**,
and verify them in the **Test calculation**. The formula is evaluated safely, without running code.

## Use
Choose the methodology on a risk or as the default for a company (Administration → Companies). A methodology that is in use cannot be deleted. The **Audit (checklist)** type serves as a custom checklist for audits.
`,
  },
  "admin-integrations": {
    title: "Administrator: Wazuh, network scan, e-mail and Teams",
    summary: "Configuring connectors and deadline notifications.",
    body: `
## Wazuh
**Administration → Connectors → Wazuh**:
- **Wazuh Server API** (manager, port 55000 – not the dashboard address) with a read-only account – agents and their inventory (OS, hardware, network, software).
- **Wazuh Indexer** (port 9200) with an account with read rights – vulnerabilities and alerts (the role must be able to read the vulnerability indices and wazuh-alerts-*).
- Automatic synchronization of assets and vulnerabilities and TLS certificate verification (turn off only for testing).
Verify each connection with the **Test** button.

## Network scan (nmap)
Active discovery of devices without an agent (network devices, printers, IoT). Scanning is allowed only in the **allowed ranges (allow-list)**; it is started in **Discovery & import**.

## Notifications
**Administration → Notifications** – e-mail (SMTP server, sender, TLS) and a Microsoft Teams channel (webhook, Microsoft HTTPS addresses only, stored encrypted). Set how many days in advance to notify, the time of the daily summary and whether only on working days. Incident alerts are always sent. Use the test button to verify delivery.
`,
  },
  "admin-ops": {
    title: "Administrator: operations, backups, updates",
    summary: "System status, backup and restore, the conversion service and updates.",
    body: `
## Operations
**Administration → Operations** shows the status of the database, backups, scheduler, notifications, Wazuh, AI, the document conversion service and the encryption key. The same is available for monitoring (Prometheus) via metrics with a token.

## Backup and restore
The backup service backs up the database daily (optionally encrypted and off the server). Test a restore right after installation and then regularly (the restore.sh script, procedure in the operations documentation).

## Updates
On the server, in the installation folder: **sudo ./infra/scripts/update.sh** – a backup is created automatically before the update. For a customer without internet access, the update is delivered as a package.

## Connectors and notifications
Wazuh, network scan, e-mail and Teams – see the topic **Administrator: Wazuh, network scan, e-mail and Teams**.
`,
  },
};
