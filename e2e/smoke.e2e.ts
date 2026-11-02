import { expect, request, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ADMIN, CELLAR_PORT } from "./playwright.config";

/** Hlavní průchody aplikací – přihlášení, evidence aktiv a rizik, shoda, administrace, bez chyb v konzoli. */
test.describe.configure({ mode: "serial" });

let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // potvrzovací dialog CONTIXu (v1.06) – stejně jako dřív `dialog.accept()` u window.confirm akci potvrdit
  await page.addLocatorHandler(page.getByRole("alertdialog"), async (d) => {
    await d.getByRole("button").last().click();
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/401|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
});
test.afterAll(async () => page.close());

test("přihlášení administrátora a přehled", async () => {
  await page.goto("/");
  await page.locator("input[type=email]").fill(ADMIN.email);
  await page.locator("input[type=password]").fill("spatne-heslo");
  await page.locator("button[type=submit]").click();
  await expect(page.getByText(/neplatn|nesprávn/i)).toBeVisible();
  await page.locator("input[type=password]").fill(ADMIN.password);
  await page.locator("button[type=submit]").click();
  // úvodní prohlídka při prvním přihlášení
  await expect(page.getByRole("dialog", { name: "Úvodní prohlídka" })).toBeVisible();
  await page.getByRole("button", { name: "Další" }).click();
  await page.getByRole("button", { name: "Přeskočit" }).click();
  await expect(page.getByRole("dialog", { name: "Úvodní prohlídka" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Přehled" })).toBeVisible();
  await expect(page.getByText("Administrátor").first()).toBeVisible();
});

test("nápověda k obrazovce a průvodce nastavením", async () => {
  await page.goto("/policies");
  await page.getByRole("button", { name: "Nápověda" }).click();
  await expect(page.getByRole("dialog", { name: "Nápověda" })).toBeVisible();
  // první téma k obrazovce Správa dokumentace se otevře rovnou
  await expect(page.getByRole("dialog", { name: "Nápověda" }).getByText(/Gestor|Správa dokumentace/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/");
  await page.getByRole("link", { name: /Pokračovat v průvodci/ }).click();
  await expect(page.getByText("Kroky nastavení")).toBeVisible();
  await expect(page.getByText("Bezpečnostní politika a dokumentace").first()).toBeVisible();
});

test("ruční evidence aktiva", async () => {
  await page.goto("/assets/new");
  await page.getByLabel("Název *").fill("E2E mzdový server");
  await page.getByLabel("Typ aktiva").selectOption("server");
  await page.getByLabel("Kritičnost").selectOption("high");
  await page.getByRole("button", { name: "Uložit" }).click();
  await expect(page).toHaveURL(/\/assets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "E2E mzdový server" })).toBeVisible();
  await page.goto("/assets");
  // .first(): při opakování skupiny testů v CI (retries) už aktivum z prvního pokusu existuje
  await expect(page.getByText("E2E mzdový server").first()).toBeVisible();
});

test("založení rizika", async () => {
  await page.goto("/risks/new");
  await page.getByLabel("Kód", { exact: true }).fill("R-E2E");
  await page.getByLabel("Název rizika").fill("Ransomware na mzdovém serveru");
  await page.getByRole("button", { name: "Založit riziko" }).click();
  await expect(page).toHaveURL(/\/risks\/[0-9a-f-]{36}$/);
  await page.goto("/risks");
  await expect(page.getByText("Ransomware na mzdovém serveru")).toBeVisible();
});

test("prohlášení o aplikovatelnosti se načte", async () => {
  await page.goto("/controls/soa");
  await expect(page.getByRole("heading", { name: "Prohlášení o aplikovatelnosti", level: 1 })).toBeVisible();
  await expect(page.locator("table").first()).toBeVisible();
});

test("import aktiv z Excelu", async () => {
  await page.goto("/import");
  await page.locator("input[type=file]").setInputFiles("apps/api/test/fixtures/import-aktiva.xlsx");
  await page.getByRole("button", { name: "Načíst náhled" }).click();
  await expect(page.getByText("nové 2")).toBeVisible();
  await expect(page.getByText("s chybou 1")).toBeVisible();
  await page.getByRole("button", { name: "Importovat 2 záznamů" }).click();
  await expect(page.getByText(/Import dokončen: nové 2/)).toBeVisible();
  await page.goto("/assets");
  await expect(page.getByText("Účetní systém Helios")).toBeVisible();
});

test("dokumentace: schválení verze, portál a potvrzení seznámení", async () => {
  const call = (path: string, body?: unknown) =>
    page.evaluate(
      async ([path, body]) => {
        const r = await fetch(`/api${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
        return r.json();
      },
      [path, body] as const,
    );
  const doc = await call("/policies", { code: "SM-E2E", title: "E2E směrnice o hesle", status: "active", classification: "internal", audience: { all: true } });
  const detail = await call(`/policies/${doc.id}/versions`, { version: "1.0", changeSummary: "První vydání", content: "# Hesla\n\nMinimálně **14 znaků**." });
  const v = detail.versions[0];
  await call(`/policies/${doc.id}/versions/${v.id}/approve`, {});
  await page.goto(`/policies/${doc.id}`);
  await expect(page.getByText("Verze a schvalování")).toBeVisible();
  await page.goto("/docs");
  await page.getByRole("link", { name: /E2E směrnice o hesle/ }).click();
  await expect(page.getByRole("heading", { name: "Hesla" })).toBeVisible();
  await page.getByRole("button", { name: /Potvrzuji seznámení/ }).click();
  await expect(page.getByText(/Seznámení potvrzeno/)).toBeVisible();

  // složky, automatické označení a rezervace k úpravě (check-out / check-in)
  const folders = await call("/policies/folders", { name: "E2E Směrnice ISMS", codePrefix: "E2E" });
  const folder = folders.find((f: { name: string }) => f.name === "E2E Směrnice ISMS");
  const d2 = await call("/policies", { title: "E2E řízení přístupu", folderId: folder.id });
  expect(d2.code).toBe("E2E-001");
  const dv = (await call(`/policies/${d2.id}/versions`, { version: "1.0", content: "Text" })).versions[0];
  await page.goto("/policies");
  await page.getByRole("button", { name: /E2E Směrnice ISMS/ }).click();
  await expect(page.getByRole("link", { name: /E2E řízení přístupu/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /E2E směrnice o hesle/ })).toHaveCount(0);
  // soubor Wordu → tlačítko „Upravit ve Wordu“ (desktopový Office se v testu nespouští)
  await page.evaluate(
    async ([id, vid]) => {
      const fd = new FormData();
      fd.set("file", new Blob(["PK"]), "pristup.docx");
      const r = await fetch(`/api/policies/${id}/versions/${vid}/files`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`upload ${r.status} ${await r.text()}`);
    },
    [d2.id, dv.id] as const,
  );
  await page.goto(`/policies/${d2.id}`);
  await expect(page.getByRole("button", { name: /Upravit ve Wordu/ })).toBeVisible();
  await page.getByRole("button", { name: /Rezervovat k úpravě/ }).click();
  await expect(page.getByText(/Máte rezervováno k úpravě/)).toBeVisible();
  await page.getByRole("button", { name: /Vrátit po úpravě/ }).click();
  await page.getByRole("button", { name: /Uvolnit bez změny souboru/ }).click();
  await expect(page.getByRole("button", { name: /Rezervovat k úpravě/ })).toBeVisible();
  expect(dv.status).toBe("draft");
  // porovnání verzí – v správě i v portálu
  const v11 = (await call(`/policies/${doc.id}/versions`, { version: "1.1", changeSummary: "Delší hesla", content: "# Hesla\n\nMinimálně **16 znaků** a MFA." })).versions[0];
  await call(`/policies/${doc.id}/versions/${v11.id}/approve`, {});
  await page.goto(`/policies/${doc.id}`);
  await page.getByRole("button", { name: /Porovnat s 1.0/ }).click();
  await expect(page.getByText(/upraveno/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/docs/${doc.id}`);
  await page.getByRole("button", { name: /Co se změnilo oproti verzi 1.0/ }).click();
  await expect(page.locator("ins").first()).toBeVisible();
  await page.goto("/policies");
  await page.getByRole("tab", { name: "Šablony" }).click();
  await expect(page.getByText("Značky v šabloně")).toBeVisible();
  await page.getByRole("tab", { name: "Skartace" }).click();
  await expect(page.getByText("Skartační lhůty")).toBeVisible();
});

test("dokumentace: hromadný import ze ZIP (náhled, mapování rolí, založení)", async () => {
  const { strToU8, zipSync } = await import("../apps/api/node_modules/fflate/esm/index.mjs");
  const csv = [
    "ID;Název;Druh;Klasifikační stupeň;Gestor;Vlastník procesu;Schvalovatel;Právní vazba;Přezkum;Nadřazený dokument;Verze;Soubor",
    "IMP-POL-01;Politika importu;Bezpečnostní politika;Interní;Manažer importu;;;§ 3;1× ročně;—;1.0;",
    "IMP-SM-01;Směrnice importu;Směrnice;Interní;Manažer importu;;;§ 6;1× ročně;IMP-POL-01;1.0;",
  ].join("\n");
  const zip = zipSync({ "sada/metadata.csv": strToU8(csv), "sada/IMP-POL-01_Politika.txt": strToU8("Text politiky") });
  await page.goto("/policies");
  await page.getByRole("tab", { name: "Hromadný import" }).click();
  await page.locator("input[type=file]").setInputFiles({ name: "sada.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await page.getByRole("button", { name: "Načíst náhled" }).click();
  await expect(page.getByText("založí se 2")).toBeVisible();
  await expect(page.getByText("bez souboru 1")).toBeVisible();
  await expect(page.getByText("Manažer importu")).toBeVisible();
  await page.getByRole("button", { name: "Importovat 2 dokumentů" }).click();
  await expect(page.getByText(/Založeno 2 dokumentů, nahráno 1 souborů, propojeno 1/)).toBeVisible();
  await page.getByRole("link", { name: "IMP-SM-01" }).click();
  await expect(page.getByText("Vazby dokumentu")).toBeVisible();
});

test("zeptej se dokumentace (lokální AI nahrazená testovacím serverem)", async () => {
  // testovací AI server: embedding podle slov + odpověď s citací
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/embeddings") {
      const vec = (t: string) => {
        const v = new Array(32).fill(0);
        for (const w of t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3)) v[[...w.slice(0, 5)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 32, 0)] += 1;
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      };
      return res.end(JSON.stringify({ data: body.input.map((t: string, i: number) => ({ index: i, embedding: vec(t) })) }));
    }
    if (req.url === "/api/chat/completions") return res.end(JSON.stringify({ model: "test", choices: [{ message: { content: "Heslo musí mít alespoň 14 znaků [1]." } }] }));
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  try {
    const call = (path: string, body?: unknown, method = body ? "POST" : "GET") =>
      page.evaluate(
        async ([path, body, method]) => {
          const r = await fetch(`/api${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
          if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
          return r.json();
        },
        [path, body, method] as const,
      );
    await call("/ai/settings", { enabled: true, provider: "openai", baseUrl: `http://127.0.0.1:${port}/api`, model: "test", docQaEnabled: true, embeddingModel: "bge-m3" }, "PATCH");
    await call("/policies/qa/reindex", {});
    for (let i = 0; i < 40; i++) {
      if ((await call("/policies/qa/index")).pending === 0) break;
      await page.waitForTimeout(250);
    }
    await page.goto("/docs");
    await page.getByLabel("Otázka na dokumentaci").fill("Kolik znaků musí mít heslo?");
    await page.getByRole("button", { name: "Zeptat se" }).click();
    await expect(page.getByText(/alespoň 14 znaků/)).toBeVisible();
    await expect(page.getByRole("link", { name: /E2E směrnice o hesle/ }).first()).toBeVisible();
    // jednotný AI vstup na Přehledu: odpověď s citací a odkazem na dokument
    await page.goto("/");
    await page.getByLabel("Dotaz pro AI asistenta").fill("Kolik znaků minimálně mají hesla?");
    await page.getByRole("button", { name: "Zeptat se" }).click();
    await expect(page.getByTestId("ai-answer")).toContainText("alespoň 14 znaků", { timeout: 15_000 });
    await expect(page.getByRole("list", { name: "Zdroje odpovědi" }).getByRole("link", { name: /E2E směrnice o hesle/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Co je po termínu?" })).toBeVisible();
    await call("/ai/settings", { enabled: false, docQaEnabled: false }, "PATCH");
  } finally {
    server.close();
  }
});

test("identity a přístupy: připojení AD, synchronizace, výjimka (testovací LDAP server)", async () => {
  // testovací Active Directory: 2 uživatelé, Domain Admins podle SID
  // @ts-expect-error – ldapjs nemá typy
  const ldap = (await import("ldapjs")).default;
  const BASE = "DC=e2e,DC=local";
  const sid = (rid: number) => {
    const b = Buffer.from([1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0]);
    b.writeUInt32LE(rid, 24);
    return b;
  };
  const ft = (daysAgo: number) => String((BigInt(Date.now() - daysAgo * 86_400_000) + 11_644_473_600_000n) * 10_000n);
  const groups = [{ dn: `CN=Domain Admins,CN=Users,${BASE}`, attributes: { cn: "Domain Admins", distinguishedName: `CN=Domain Admins,CN=Users,${BASE}`, objectSid: sid(512), memberOf: [] } }];
  const users = [
    { dn: `CN=spravce,OU=IT,${BASE}`, attributes: { sAMAccountName: "spravce", displayName: "Správce domény", userAccountControl: "66048", lastLogonTimestamp: ft(200), pwdLastSet: ft(500), whenCreated: "20200101000000.0Z", memberOf: [`CN=Domain Admins,CN=Users,${BASE}`], objectGUID: Buffer.alloc(16, 1) } },
    { dn: `CN=novak,OU=Lide,${BASE}`, attributes: { sAMAccountName: "novak", displayName: "Jan Novák", userAccountControl: "512", lastLogonTimestamp: ft(3), pwdLastSet: ft(20), whenCreated: "20240101000000.0Z", memberOf: [], objectGUID: Buffer.alloc(16, 2) } },
  ];
  const server = ldap.createServer();
  server.bind(BASE, (req: any, res: any, next: any) => (req.credentials === "ad-heslo" ? (res.end(), next()) : next(new ldap.InvalidCredentialsError())));
  server.search(BASE, (req: any, res: any, next: any) => {
    res.attributes = res.attributes.map((a: string) => a.toLowerCase());
    for (const e of req.filter.toString().toLowerCase().includes("objectclass=group") ? groups : users) res.send({ dn: e.dn, attributes: { ...e.attributes } });
    res.end();
    next();
  });
  const port: number = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
  try {
    await page.goto("/identity");
    await expect(page.getByText("Zatím není připojen žádný adresář")).toBeVisible();
    await page.getByRole("button", { name: "Připojit adresář" }).click();
    await page.getByRole("button", { name: "Active Directory" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Název").fill("Doména E2E");
    await dlg.getByLabel(/Adresa serveru/).fill(`ldap://127.0.0.1:${port}`);
    await dlg.getByLabel(/Base DN/).fill(BASE);
    await dlg.getByLabel(/Účet pro čtení/).fill(`CN=contix,${BASE}`);
    await dlg.getByLabel(/^Heslo/).fill("spatne");
    await dlg.getByRole("button", { name: "Otestovat připojení" }).click();
    await expect(dlg.getByText(/Přihlášení k AD selhalo/)).toBeVisible();
    await dlg.getByLabel(/^Heslo/).fill("ad-heslo");
    await dlg.getByRole("button", { name: "Otestovat připojení" }).click();
    await expect(dlg.getByText(/2 uživatelských účtů/)).toBeVisible();
    await dlg.getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Synchronizovat" }).click();
    await expect(page.getByText(/Načteno 2 účtů/)).toBeVisible();

    await page.getByRole("button", { name: "Přehled" }).click();
    await expect(page.getByText("Kritické nálezy")).toBeVisible();
    await page.getByRole("button", { name: /Neaktivní účet/ }).click();
    await expect(page.getByText("Co udělat:")).toBeVisible();
    await page.getByRole("button", { name: "Výjimka" }).click();
    await page.getByRole("dialog").getByLabel(/Odůvodnění/).fill("Nouzový účet v trezoru, kontrola čtvrtletně");
    await page.getByRole("button", { name: "Udělit výjimku" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByLabel("Stav").selectOption("accepted");
    await expect(page.getByText(/Nouzový účet v trezoru/)).toBeVisible();

    await page.getByRole("button", { name: "Účty" }).click();
    await page.getByText("spravce").first().click();
    await expect(page.getByRole("dialog").getByText("Domain Admins").first()).toBeVisible();
    await page.getByRole("button", { name: "Zavřít" }).click();

    // toxické kombinace – formulář pravidla se otevře se seznamem skupin
    await page.getByRole("button", { name: "Toxické kombinace" }).click();
    await page.getByRole("button", { name: "Nové pravidlo" }).click();
    await expect(page.getByRole("dialog").getByText("Strana A")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Zrušit" }).click();

    // přezkum přístupů: recenzent = funkční místo administrátora
    const me = await page.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user.id as string);
    await page.evaluate(async (uid) => {
      const post = (u: string, b: unknown) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
      const unit = await post("/api/org/units", { name: "IT E2E" });
      await post("/api/org/positions", { orgUnitId: unit.id, name: "Vlastník AD", holderIds: [uid] });
    }, me);
    await page.reload();
    await page.getByRole("button", { name: "Přezkum přístupů" }).click();
    await page.getByRole("button", { name: "Nový přezkum přístupů" }).click();
    const rd = page.getByRole("dialog");
    await rd.getByLabel("Recenzent (funkční místo)").selectOption({ label: "Vlastník AD (Administrátor)" });
    await rd.getByRole("button", { name: "Zahájit přezkum" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: /Přezkum privilegovaných účtů/ }).click();
    await expect(page.getByRole("cell", { name: /spravce/ })).toBeVisible();
    await page.getByRole("button", { name: "Odebrat" }).click();
    await page.getByRole("dialog").getByLabel(/Co odebrat/).fill("Odebrat ze skupiny Domain Admins");
    await page.getByRole("dialog").getByRole("button", { name: "Odebrat" }).click();
    await expect(page.getByText("čeká na provedení v adresáři")).toBeVisible();
      await page.getByRole("button", { name: "Uzavřít přezkum" }).click();
    await expect(page.getByText(/^Uzavřeno/)).toBeVisible();

    // automatický test opatření z kontroly účtů
    await page.evaluate(() => fetch("/api/controls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "E2E řízení přístupu", status: "implemented" }) }));
    await page.goto("/identity?tab=automations");
    await page.getByRole("button", { name: "Automatický test opatření" }).click();
    await page.getByRole("dialog").getByRole("combobox").first().selectOption({ label: "E2E řízení přístupu" });
    await page.getByRole("dialog").getByRole("button", { name: "Uložit" }).click();
    await page.getByRole("button", { name: "Spustit nyní" }).click();
    await expect(page.getByText(/^neúčinné$/)).toBeVisible();
  } finally {
    server.close();
  }
});

test("všechny položky menu se otevřou bez chyby", async () => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Přehled" })).toBeVisible();
  const links = await page.locator("aside nav a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!).filter(Boolean));
  expect(links.length).toBeGreaterThan(10);
  for (const href of links) {
    await page.goto(href);
    await expect(page.locator("main h1").first(), `stránka ${href}`).toBeVisible();
    await expect(page.getByText("API není dostupné")).toHaveCount(0);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("legislativa: předpis EU z EUR-Lex (náhradní CELLAR)", async () => {
  const doc = `<html><body><div class="eli-container"><div class="eli-subdivision" id="art_21"><p class="oj-ti-art">Článek 21</p><div class="eli-title" id="art_21.tit_1"><p class="oj-sti-art">Opatření k řízení kybernetických bezpečnostních rizik</p></div>
<div id="021.001"><p class="oj-normal">1. Členské státy zajistí, aby základní a důležité subjekty přijaly vhodná a přiměřená technická, provozní a organizační opatření.</p></div>
<div id="021.002"><p class="oj-normal">2. Opatření zahrnují alespoň:</p><table><tbody><tr><td><p>a)</p></td><td><p>politiku analýzy rizik a politiku bezpečnosti informačních systémů;</p></td></tr></tbody></table><table><tbody><tr><td><p>b)</p></td><td><p>řešení incidentů;</p></td></tr></tbody></table></div></div>
<div class="eli-subdivision" id="art_23"><p class="oj-ti-art">Článek 23</p><div class="eli-title" id="art_23.tit_1"><p class="oj-sti-art">Oznamovací povinnosti</p></div><div id="023.001"><p class="oj-normal">1. Každý členský stát zajistí, aby základní a důležité subjekty bez zbytečného odkladu oznámily významný incident.</p></div></div></div></body></html>`;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    if (req.url === "/sparql") {
      const q = new URLSearchParams(Buffer.concat(chunks).toString()).get("query") ?? "";
      const lit = (value: string) => ({ type: "literal", value });
      res.setHeader("content-type", "application/sparql-results+json");
      const rows = q.includes('"32022L2555"') ? [{ c: lit("32022L2555"), d: lit("2022-12-14"), force: lit("1"), eov: lit("9999-12-31"), title: lit("Směrnice (EU) 2022/2555"), i: { type: "uri", value: `http://127.0.0.1:${CELLAR_PORT}/doc/nis2` } }] : [];
      return res.end(JSON.stringify({ results: { bindings: rows } }));
    }
    if (req.url === "/doc/nis2") return res.setHeader("content-type", "application/xhtml+xml"), res.end(doc);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(CELLAR_PORT, "127.0.0.1", r));
  try {
    await page.goto("/legislation");
    await page.getByRole("button", { name: "Přidat předpis" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Předpisy EU" }).click();
    await dlg.getByRole("button", { name: /NIS2 – \(EU\) 2022\/2555/ }).click();
    await expect(dlg.getByLabel("Číslo CELEX, odkaz z EUR-Lex nebo ELI")).toHaveValue("32022L2555");
    await dlg.getByRole("button", { name: "Sledovat" }).click();
    await expect(dlg).toHaveCount(0);
    await page.getByRole("link", { name: "NIS2 – (EU) 2022/2555" }).click();
    await expect(page.getByRole("link", { name: /EUR-Lex/ })).toHaveAttribute("href", "https://eur-lex.europa.eu/legal-content/CS/ALL/?uri=CELEX:32022L2555");
    await expect(page.getByText("původní znění (Úř. věst. EU)").first()).toBeVisible();
    await expect(page.getByText("Čl. 21 odst. 2").first()).toBeVisible();
    await expect(page.getByText("b) řešení incidentů;").first()).toBeVisible();
  } finally {
    server.close();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("dodavatel: bezpečnostní dotazník – odkaz, vyplnění dodavatelem bez přihlášení, vyhodnocení", async ({ browser }) => {
  const sup = await (await page.request.post("/api/suppliers", { data: { name: "E2E Cloud s.r.o.", significant: true }, headers: { origin: new URL(page.url()).origin } })).json();
  await page.goto(`/suppliers/${sup.id}`);
  await page.getByRole("button", { name: "Poslat dotazník" }).click();
  const dlg = page.getByRole("dialog", { name: "Poslat bezpečnostní dotazník" });
  await dlg.getByLabel("Rozsah dotazníku").selectOption("cz410");
  await dlg.getByRole("button", { name: "Vytvořit odkaz" }).click();
  const link = await page.getByRole("dialog", { name: "Odkaz pro dodavatele" }).getByLabel("Odkaz pro dodavatele").inputValue();
  expect(link).toMatch(/\/q\/[A-Za-z0-9_-]{30,}$/);
  await page.getByRole("dialog", { name: "Odkaz pro dodavatele" }).getByRole("button", { name: "Zavřít" }).last().click();
  await expect(page.getByText("Čeká na dodavatele")).toBeVisible();

  // dodavatel – nový kontext bez přihlášení
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  const spErrors: string[] = [];
  sp.on("pageerror", (e) => spErrors.push(e.message));
  sp.on("dialog", (d) => d.accept());
  await sp.goto(new URL(link).pathname);
  await expect(sp.getByRole("heading", { name: "Bezpečnostní dotazník pro dodavatele" })).toBeVisible();
  await expect(sp.getByText("E2E Cloud s.r.o.")).toBeVisible();
  const groups = sp.getByRole("radiogroup");
  const n = await groups.count();
  expect(n).toBeGreaterThan(15);
  for (let i = 0; i < n; i++) await groups.nth(i).getByText(i === 0 ? "Ne" : "Ano", { exact: true }).click();
  // příloha k první otázce
  await sp.locator('input[type="file"]').first().setInputFiles({ name: "certifikat.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") });
  await expect(sp.getByText("certifikat.pdf")).toBeVisible();
  await sp.getByLabel("Jméno a příjmení").fill("Eva Dodavatelová");
  await sp.getByLabel("E-mail").fill("eva@e2e-cloud.test");
  await sp.getByRole("button", { name: "Uložit rozpracované" }).click();
  await expect(sp.getByText("Uloženo.")).toBeVisible();
  await sp.getByRole("button", { name: "Odevzdat dotazník" }).click();
  await expect(sp.getByText(/Děkujeme, dotazník byl odevzdán/)).toBeVisible();
  expect(spErrors).toEqual([]);
  await ctx.close();

  // vyhodnocení u dodavatele
  await page.reload();
  await expect(page.getByText("Vyplněno – k vyhodnocení")).toBeVisible();
  await page.getByRole("button", { name: /^Bezpečnostní dotazník/ }).click();
  const det = page.getByRole("dialog");
  await expect(det.getByText("Vysoké").first()).toBeVisible(); // klíčová odpověď „ne“
  await expect(det.getByRole("link", { name: "certifikat.pdf" })).toHaveCount(1);
  await det.getByRole("button", { name: "Vyhodnotit" }).click();
  await expect(det.getByText(/^Vyhodnotil\(a\)/)).toBeVisible();
  await det.getByRole("button", { name: "Založit riziko dodavatele" }).click();
  await det.getByRole("link", { name: "Otevřít riziko založené z dotazníku" }).click();
  await expect(page.getByRole("heading", { name: /Nedostatky v zabezpečení dodavatele E2E Cloud/ })).toBeVisible();
  // trendy na přehledu
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vývoj ukazatelů" })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("akce a úkoly: úkol u dodavatele, jednotný přehled, splnění", async () => {
  const sup = await (await page.request.post("/api/suppliers", { data: { name: "E2E Úkoly a.s." }, headers: { origin: new URL(page.url()).origin } })).json();
  await page.goto(`/suppliers/${sup.id}`);
  await page.getByRole("button", { name: "Přidat úkol" }).click();
  const dlg = page.getByRole("dialog", { name: "Nový úkol" });
  await dlg.getByLabel("Co je potřeba udělat").fill("E2E doplnit SLA do smlouvy");
  await dlg.getByLabel("Termín").fill("2020-01-15");
  await dlg.getByRole("button", { name: "Založit úkol" }).click();
  await expect(page.getByRole("button", { name: /E2E doplnit SLA do smlouvy/ })).toBeVisible();
  await page.goto("/actions");
  await expect(page.getByRole("heading", { name: "Akce a úkoly" })).toBeVisible();
  const row = page.getByRole("row", { name: /E2E doplnit SLA do smlouvy/ });
  await expect(row).toContainText("Dodavatel: E2E Úkoly a.s.");
  await expect(row).toContainText("po termínu");
  await row.getByRole("button", { name: "E2E doplnit SLA do smlouvy" }).click();
  const det = page.getByRole("dialog", { name: /E2E doplnit SLA do smlouvy/ });
  await det.getByRole("combobox", { name: /^Stav/ }).selectOption("done");
  await det.getByLabel("Jak bylo splněno").fill("Dodatek podepsán");
  await det.getByRole("button", { name: "Uložit" }).click();
  await expect(page.getByRole("row", { name: /E2E doplnit SLA do smlouvy/ })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Stav", exact: true }).selectOption("done");
  await expect(page.getByRole("row", { name: /E2E doplnit SLA do smlouvy/ })).toContainText("Splněno");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("moje práce a funkční místo: hromadné změny úkolů, předání odpovědnosti (v1.10)", async () => {
  const H = { origin: new URL(page.url()).origin };
  const post = async (url: string, data: unknown) => (await page.request.post(url, { data, headers: H })).json();
  const unit = await post("/api/org/units", { name: "E2E Útvar předání" });
  const pA = await post("/api/org/positions", { orgUnitId: unit.id, name: "E2E Odcházející" });
  await post("/api/org/positions", { orgUnitId: unit.id, name: "E2E Nástupce" });
  for (const n of [1, 2]) await post("/api/actions/tasks", { title: `E2E hromadný úkol ${n}`, ownerPositionId: pA.id, dueDate: "2031-01-0" + n });
  // hromadná změna stavu v přehledu akcí
  await page.goto("/actions");
  await page.getByPlaceholder(/Hledat/).first().fill("E2E hromadný");
  await expect(page.getByRole("row", { name: /E2E hromadný úkol/ })).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Vybrat všechny úkoly" }).check();
  await expect(page.getByTestId("bulk-bar")).toContainText("Vybráno: 2");
  await page.getByTestId("bulk-bar").getByRole("button", { name: "Rozpracováno" }).click();
  await expect(page.getByText("Upraveno 2 úkolů.")).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E hromadný úkol 1/ })).toContainText("Rozpracováno");
  // Moje práce – záložky
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "Moje práce" })).toBeVisible();
  await page.getByRole("tab", { name: "Úkoly a akce" }).click();
  await expect(page).toHaveURL(/tab=actions/);
  // funkční místo: vše, co vlastní, a předání
  await page.goto(`/organization/positions/${pA.id}`);
  await expect(page.getByRole("heading", { name: "E2E Odcházející" })).toBeVisible();
  await expect(page.getByTestId("position-usage")).toContainText("Úkoly (2)");
  await page.getByRole("button", { name: "Předat odpovědnost" }).click();
  const dlg = page.getByRole("dialog", { name: "Předat odpovědnost" });
  await dlg.getByRole("combobox", { name: "Cílové funkční místo" }).selectOption({ label: "E2E Nástupce (neobsazeno)" });
  await dlg.getByRole("button", { name: /^Předat \d+/ }).click();
  await expect(page.getByText("Předáno 2 položek.")).toBeVisible();
  await expect(page.getByText("Toto funkční místo zatím nic nevlastní.")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("výjimky: kompenzační opatření a zpětná vazba u opatření (v1.11)", async () => {
  const H = { origin: new URL(page.url()).origin };
  const ctl = await (await page.request.post("/api/controls", { data: { code: "E2E-KOMP", name: "E2E kompenzační opatření", status: "implemented" }, headers: H })).json();
  const ex = await (await page.request.get("/api/exceptions")).json();
  const e = (ex.items as any[]).find((x) => x.canEdit && x.companyId === ctl.companyId);
  test.skip(!e, "žádná upravitelná výjimka");
  await page.goto("/exceptions");
  await expect(page.getByRole("columnheader", { name: "Kompenzační opatření" })).toBeVisible();
  await page.getByRole("button", { name: `Upravit kompenzační opatření: ${e.title}` }).click();
  const dlg = page.getByRole("dialog", { name: "Kompenzační opatření" });
  await dlg.getByRole("combobox").first().selectOption({ label: "E2E-KOMP E2E kompenzační opatření" });
  await dlg.getByLabel(/Poznámka/).fill("Snižuje dopad");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await expect(page.getByText("Kompenzační opatření uložena.")).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E-KOMP" })).toBeVisible();
  await page.goto(`/controls/${ctl.id}?tab=links`);
  await expect(page.getByText("Výjimky, které opatření kompenzuje")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("automatické důkazy: externí kontrola s tokenem a výsledek ze skriptu (v1.13)", async () => {
  const H = { origin: new URL(page.url()).origin };
  const ctl = await (await page.request.post("/api/controls", { data: { code: "E2E-ZAL", name: "E2E zálohování", status: "implemented" }, headers: H })).json();
  await page.request.post("/api/monitors", { data: { controlId: ctl.id, kind: "external_check", name: "E2E noční záloha" }, headers: H });
  await page.goto("/controls/monitoring");
  const row = page.getByRole("row", { name: /E2E noční záloha/ });
  await expect(row.getByRole("button", { name: "Spustit teď" })).toHaveCount(0);
  await row.getByRole("button", { name: "Upravit" }).click();
  const dlg = page.getByRole("dialog", { name: "Upravit monitor" });
  await dlg.getByRole("button", { name: "Vydat token" }).click();
  const curl = await dlg.getByTestId("mon-token").locator("pre").innerText();
  expect(curl).toContain("/api/public/monitors/result");
  const token = /Bearer (cxm_[A-Za-z0-9_-]+)/.exec(curl)![1]!;
  await page.keyboard.press("Escape");
  // skript: bez cookies, jen token
  // samostatný kontext Playwrightu (ne fetch z Node): v kontejneru CI poslouchá preview jen na ::1 a Node fetch zkusí 127.0.0.1
  const script = await request.newContext({ baseURL: H.origin });
  const res = await script.post("/api/public/monitors/result", { headers: { authorization: `Bearer ${token}` }, data: { result: "pass", summary: "E2E záloha OK" } });
  expect(res.status()).toBe(201);
  await script.dispose();
  await page.reload();
  await expect(page.getByRole("row", { name: /E2E noční záloha/ })).toContainText("E2E záloha OK");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("ladění pravidel Wazuh: ruční návrh výjimky, simulace, XML (v1.14)", async () => {
  await page.goto("/soc?tab=rules");
  const card = page.getByTestId("tuning");
  await expect(card).toContainText("Návrhy úprav pravidel Wazuh");
  await card.getByRole("button", { name: "Nový návrh úpravy" }).click();
  const dlg = page.getByRole("dialog", { name: "Nový návrh úpravy" });
  await dlg.getByLabel("Číslo pravidla Wazuh").fill("5710");
  await dlg.getByLabel("Hodnota").fill("192.0.2.10");
  await dlg.getByLabel("Zdůvodnění").fill("Interní skener zranitelností");
  await dlg.getByRole("button", { name: "Založit návrh" }).click();
  const item = card.getByTestId("tuning-item").first();
  await expect(item).toContainText("data.srcip = 192.0.2.10");
  await expect(item).toContainText("Bez simulace");
  await item.getByRole("button", { name: /Simulovat/ }).click();
  await expect(item.getByTestId("tuning-sim")).toContainText("Simulace");
  await item.getByRole("button", { name: "Zobrazit pravidlo (XML)" }).click();
  await expect(item.locator("pre")).toContainText("<srcip>192.0.2.10</srcip>");
  await expect(item).toContainText("Schválit musí jiný člověk");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC: ruční alert, převzetí, playbook, ATT&CK, eskalace na incident", async () => {
  await page.goto("/soc");
  await expect(page.getByRole("heading", { name: "SOC – bezpečnostní alerty" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Získání přihlašovacích údajů/ })).toBeVisible();
  await page.getByRole("button", { name: "Ruční alert" }).click();
  const dlg = page.getByRole("dialog", { name: "Ruční alert" });
  await dlg.getByLabel("Název").fill("E2E hádání hesel na VPN");
  await dlg.getByLabel("Závažnost").selectOption("high");
  await dlg.getByLabel("Techniky MITRE ATT&CK").fill("T1110, X9");
  await expect(dlg.getByText("Neplatné ID techniky: X9")).toBeVisible();
  await dlg.getByLabel("Techniky MITRE ATT&CK").fill("T1110");
  await dlg.getByRole("button", { name: "Založit alert" }).click();
  await expect(page.getByRole("heading", { name: "E2E hádání hesel na VPN" })).toBeVisible();
  await expect(page.getByRole("link", { name: "T1110" })).toHaveAttribute("href", "https://attack.mitre.org/techniques/T1110/");
  await expect(page.getByRole("combobox", { name: "Playbook" })).toHaveValue("brute_force");
  await page.getByRole("button", { name: "Převzít" }).click();
  await expect(page.getByText("V řešení").first()).toBeVisible();
  await page.getByRole("button", { name: /^1\. Ověřit zdrojové IP/ }).click();
  await expect(page.getByText("Splněno 1 z 6 kroků")).toBeVisible();
  await page.getByLabel("Přidat poznámku").fill("Zdroj 203.0.113.7, bez úspěšného přihlášení.");
  await page.getByRole("button", { name: "Přidat poznámku" }).click();
  await expect(page.getByText("Zdroj 203.0.113.7, bez úspěšného přihlášení.")).toBeVisible();
  await page.getByRole("button", { name: "Eskalovat na incident" }).click();
  await page.getByRole("dialog", { name: "Eskalovat na incident" }).getByRole("button", { name: "Eskalovat" }).click();
  await expect(page.getByText("Eskalováno").first()).toBeVisible();
  await page.getByRole("link", { name: "E2E hádání hesel na VPN" }).click();
  await expect(page.getByRole("heading", { name: "E2E hádání hesel na VPN" })).toBeVisible();
  // incident × SOC: podklady, doplnění do formuláře a záznam o zvládání
  const isoc = page.getByTestId("incident-soc");
  await expect(isoc).toContainText("E2E hádání hesel na VPN");
  await isoc.getByRole("button", { name: "Doplnit ze SOC" }).click();
  const dd = page.getByRole("dialog", { name: "Doplnit záznam ze SOC" });
  await expect(dd.getByTestId("incident-soc-draft")).toContainText("Alerty SOC");
  await dd.getByRole("button", { name: "Převzít do formuláře" }).click();
  await page.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(page.getByText("Uloženo").first()).toBeVisible();
  const rec = await page.request.get(await page.getByRole("link", { name: /Záznam o zvládání/ }).first().getAttribute("href") ?? "");
  expect(await rec.text()).toContain("Detekce (SOC)");
  await page.goto("/soc");
  await page.getByRole("combobox", { name: "Stav" }).selectOption("accepted");
  await expect(page.getByRole("row", { name: /E2E hádání hesel na VPN/ })).toContainText("T1110");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC II: případ z vybraných alertů, lhůty, potlačení, ladění pravidel, nastavení", async () => {
  const origin = { origin: new URL(page.url()).origin };
  for (const title of ["E2E podezřelé přihlášení z VPN", "E2E nový administrátorský účet"])
    await page.request.post("/api/soc/alerts", { data: { title, severity: "high", mitreIds: title.includes("VPN") ? ["T1078"] : ["T1136"] }, headers: origin });
  await page.goto("/soc");
  await expect(page.getByRole("tab", { name: "Fronta alertů" })).toHaveAttribute("aria-selected", "true");
  const row = page.getByRole("row", { name: /E2E podezřelé přihlášení z VPN/ });
  await expect(row).toContainText("Převzetí");
  await page.getByRole("checkbox", { name: "Vybrat alert E2E podezřelé přihlášení z VPN" }).check();
  await page.getByRole("checkbox", { name: "Vybrat alert E2E nový administrátorský účet" }).check();
  await page.getByRole("button", { name: "Do případu (2)" }).click();
  const dlg = page.getByRole("dialog", { name: "Nový případ" });
  await dlg.getByLabel("Název").fill("E2E zneužití účtu");
  await dlg.getByRole("button", { name: "Založit případ" }).click();
  await expect(page.getByRole("heading", { name: /SOC-\d+ E2E zneužití účtu/ })).toBeVisible();
  await expect(page.getByText("Ruční případ")).toBeVisible();
  await page.getByRole("button", { name: "Převzít" }).click();
  await expect(page.getByRole("combobox", { name: "Analytik" })).not.toHaveValue("");
  await page.getByRole("link", { name: "Zpět na případy" }).click();
  await expect(page.getByRole("tab", { name: "Případy" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("row", { name: /E2E zneužití účtu/ })).toContainText("2 otevřené / 2");
  // potlačení
  await page.getByRole("tab", { name: "Potlačení" }).click();
  await page.getByRole("button", { name: "Nové potlačení" }).click();
  const sup = page.getByRole("dialog", { name: "Nové potlačení" });
  await sup.getByLabel("Pravidlo Wazuh (ID)").fill("550");
  await sup.getByLabel("Zdůvodnění").fill("E2E plánovaná změna souborů při aktualizaci");
  await sup.getByRole("button", { name: "Potlačit" }).click();
  const srow = page.getByRole("row", { name: /E2E plánovaná změna souborů/ });
  await expect(srow).toContainText("Platné");
  await srow.getByRole("button", { name: "Zrušit" }).click();
  await expect(page.getByRole("row", { name: /E2E plánovaná změna souborů/ })).toHaveCount(0);
  // ladění pravidel a nastavení lhůt
  await page.getByRole("tab", { name: "Ladění pravidel" }).click();
  await expect(page.getByRole("combobox", { name: "Období" })).toBeVisible();
  await page.getByRole("button", { name: "Lhůty a korelace" }).click();
  const st = page.getByRole("dialog", { name: "Lhůty a korelace" });
  await expect(st.getByLabel("Převzetí (minuty) – Kritická")).toHaveValue("15");
  await st.getByLabel("Převzetí (minuty) – Kritická").fill("10");
  await st.getByRole("button", { name: "Uložit" }).click();
  await expect(st).toHaveCount(0);
  expect((await (await page.request.get("/api/soc/settings")).json()).ackMinutes.critical).toBe(10);
  // SOC III: kapitola ve zprávě pro vedení a signály u rizika
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "Bezpečnostní monitoring (SOC)" })).toBeVisible();
  await page.goto("/risks");
  await page.locator("table a[href^='/risks/']").first().click();
  await page.getByRole("tab", { name: "Vazby" }).click();
  await expect(page.getByRole("heading", { name: "Signály SOC" })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC IV: AI předběžná triáž – návrh v detailu, použití návrhu (lokální AI nahrazená testovacím serverem)", async () => {
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/chat/completions")
      return res.end(JSON.stringify({ model: "test", choices: [{ message: { content: '{"verdict":"false_positive","severity":"low","confidence":"high","reasoning":"E2E plánovaný sken správce."}' } }] }));
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const origin = { origin: new URL(page.url()).origin };
  try {
    await page.request.patch("/api/ai/settings", { data: { enabled: true, provider: "openai", baseUrl: `http://127.0.0.1:${port}/api`, model: "test" }, headers: origin });
    const a = await (await page.request.post("/api/soc/alerts", { data: { title: "E2E skenování portů", severity: "medium", mitreIds: ["T1046"] }, headers: origin })).json();
    await page.goto(`/soc/${a.id}`);
    const card = page.getByTestId("soc-ai-triage");
    await expect(card.getByRole("heading", { name: "Předběžná triáž AI" })).toBeVisible();
    await card.getByRole("button", { name: /osoudit$/ }).click();
    await expect(card.getByText("E2E plánovaný sken správce.")).toBeVisible();
    await expect(card.getByTestId("ai-triage-badge")).toContainText("Falešný poplach");
    await expect(card.getByText("Vysoká jistota")).toBeVisible();
    // návrh se sám neaplikuje – alert je stále otevřený
    await expect(page.getByText("Nový").first()).toBeVisible();
    await card.getByRole("button", { name: "Použít návrh" }).click();
    const dlg = page.getByRole("dialog", { name: "Uzavřít alert" });
    await expect(dlg.getByLabel("Verdikt")).toHaveValue("false_positive");
    await expect(dlg.getByLabel("Zdůvodnění")).toHaveValue(/E2E plánovaný sken správce/);
    await dlg.getByRole("button", { name: "Uzavřít alert" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByText("Falešný poplach").first()).toBeVisible();
    // fronta: sloupec a filtr Návrh AI
    await page.goto("/soc");
    await page.getByRole("combobox", { name: "Stav" }).selectOption("all");
    await page.getByRole("combobox", { name: "Návrh AI" }).selectOption("fp");
    await expect(page.getByRole("row", { name: /E2E skenování portů/ })).toBeVisible();
  } finally {
    await page.request.patch("/api/ai/settings", { data: { enabled: false }, headers: origin });
    server.close();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC V: zdroj alertů s tokenem a nahlášení phishingu zaměstnancem", async () => {
  await page.goto("/soc?tab=sources");
  // veřejné zdroje hrozeb – karta a nastavení (bez stahování)
  await expect(page.getByTestId("threat-intel").getByRole("heading", { name: "Veřejné zdroje hrozeb" })).toBeVisible();
  await page.getByRole("button", { name: "Nastavení zdrojů" }).click();
  const tis = page.getByRole("dialog", { name: "Nastavení zdrojů" });
  await expect(tis.getByLabel("abuse.ch Auth-Key")).toBeVisible();
  await tis.getByRole("button", { name: "Zrušit" }).click();
  await expect(page.getByRole("tab", { name: "Zdroje" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Nový zdroj" }).click();
  const dlg = page.getByRole("dialog", { name: "Nový zdroj" });
  await dlg.getByLabel("Název").fill("E2E Suricata");
  await dlg.getByLabel("Formát").selectOption("suricata");
  await dlg.getByRole("button", { name: "Založit a zobrazit token" }).click();
  const tk = page.getByRole("dialog", { name: "Token zdroje E2E Suricata" });
  const token = await tk.getByTestId("soc-source-token").inputValue();
  expect(token).toMatch(/^cxs_/);
  await expect(tk.getByText("/api/public/soc/ingest").first()).toBeVisible();
  await tk.getByRole("button", { name: "Token mám uložený" }).click();
  const eve = JSON.stringify({ event_type: "alert", src_ip: "198.51.100.9", dest_ip: "10.9.8.7", alert: { signature_id: 2100498, signature: "E2E GPL ATTACK_RESPONSE id check returned root", severity: 2 } });
  const res = await page.request.post("/api/public/soc/ingest", { data: eve, headers: { authorization: `Bearer ${token}`, "content-type": "application/x-ndjson" } });
  expect(res.status()).toBe(202);
  await page.reload();
  await expect(page.getByRole("row", { name: /E2E Suricata/ })).toContainText("1 událostí · 1 alertů");
  await page.getByRole("tab", { name: "Fronta alertů" }).click();
  await expect(page.getByRole("row", { name: /E2E GPL ATTACK_RESPONSE/ })).toContainText("Suricata");
  // zaměstnanec nahlásí phishing s .eml
  await page.goto("/phishing");
  await expect(page.getByRole("heading", { name: "Nahlásit podezřelý e-mail (phishing)" })).toBeVisible();
  const eml = ["From: Podpora <it@firma-helpdesk.top>", "Subject: E2E Vaše schránka je plná", "Authentication-Results: mx; spf=fail; dkim=none; dmarc=fail", "Content-Type: text/plain; charset=utf-8", "", "Uvolněte místo zde: https://firma-helpdesk.top/mail", ""].join("\r\n");
  await page.getByLabel("E-mail jako soubor .eml (doporučeno)").setInputFiles({ name: "schranka.eml", mimeType: "message/rfc822", buffer: Buffer.from(eml) });
  await page.getByLabel("Poznámka").fill("Neklikal jsem.");
  await page.getByRole("button", { name: "Nahlásit", exact: true }).click();
  await expect(page.getByText("Děkujeme, hlášení předáno bezpečnostnímu týmu.")).toBeVisible();
  await page.getByRole("button", { name: "Otevřít alert v SOC" }).click();
  await expect(page.getByRole("heading", { name: "Nahlášený phishing: E2E Vaše schránka je plná" })).toBeVisible();
  const phishUrl = page.url();
  const card = page.getByTestId("soc-phishing");
  await expect(card).toContainText("SPF: fail");
  await expect(card).toContainText("hxxps://firma-helpdesk.top/mail");
  await expect(page.getByText("Hlášení zaměstnance: Neklikal jsem.")).toBeVisible();
  // IOC z nahlášeného phishingu → seznam k blokaci a feed
  const ic = page.getByTestId("soc-alert-iocs");
  await ic.getByRole("checkbox", { name: "Vybrat firma-helpdesk[.]top" }).check();
  await ic.getByRole("button", { name: "Blokovat vybrané (1)" }).click();
  await expect(ic.getByText("v seznamu")).toBeVisible();
  await page.goto("/soc?tab=iocs");
  await expect(page.getByRole("row", { name: /firma-helpdesk\[\.\]top/ })).toContainText("Blokovat");
  await page.getByLabel("Název feedu (např. FortiGate)").fill("E2E firewall");
  await page.getByRole("button", { name: "Vytvořit feed" }).click();
  const domUrl = await page.getByTestId("ioc-feed-urls").getByRole("textbox").nth(1).inputValue();
  expect(await (await page.request.get(domUrl)).text()).toContain("firma-helpdesk.top");
  await page.getByRole("button", { name: "Token mám uložený" }).click();
  // návrh zásahu (ruční) z detailu alertu a záložka Reakce
  await page.goto(phishUrl);
  await page.getByRole("button", { name: "Navrhnout zásah" }).click();
  const pa = page.getByRole("dialog", { name: "Navrhnout zásah" });
  await pa.getByRole("combobox").first().selectOption("reset_password");
  await pa.getByLabel("Cíl (účet, zařízení…)").fill("FIRMA\\uzivatel");
  await pa.getByLabel("Důvod").fill("Uživatel mohl zadat heslo na podvodné stránce");
  await pa.getByRole("button", { name: "Odeslat ke schválení" }).click();
  await expect(page.getByTestId("soc-actions")).toContainText("Čeká na schválení");
  await page.goto("/soc?tab=response");
  await expect(page.getByTestId("soc-actions")).toContainText("Vynutit změnu hesla");
  await expect(page.getByRole("heading", { name: "Upozornění a zásahy" })).toBeVisible();
  // výkonnost SOC a shoda AI
  await page.goto("/soc?tab=performance");
  await expect(page.getByTestId("soc-ai-metrics").getByRole("heading", { name: "AI předběžná triáž – shoda s analytiky" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Návrh AI × rozhodnutí analytika" })).toBeVisible();
  await page.getByRole("combobox", { name: "Období" }).selectOption("30");
  await expect(page.getByRole("heading", { name: "Podle zdroje" })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC XI: playbook organizace a úkoly týmu z kroků alertu", async () => {
  const headers = { origin: new URL(page.url()).origin };
  await page.goto("/soc?tab=playbooks");
  await page.getByRole("listitem").filter({ hasText: "Útok hádáním hesel" }).getByRole("button", { name: "Přizpůsobit" }).click();
  const dlg = page.getByRole("dialog", { name: "Nový playbook" });
  await dlg.getByLabel("Název").fill("E2E hesla – postup organizace");
  await dlg.getByLabel("Lhůta kroku 1 v hodinách").fill("4");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await expect(page.getByTestId("soc-playbooks")).toContainText("E2E hesla – postup organizace");
  const al = await (await page.request.post("/api/soc/alerts", { data: { title: "E2E playbook hesla", severity: "high", mitreIds: ["T1110"] }, headers })).json();
  await page.goto(`/soc/${al.id}`);
  const card = page.getByTestId("soc-playbook");
  await expect(card.getByRole("combobox", { name: "Playbook" })).toHaveValue(/^c:/);
  await card.getByRole("button", { name: "Zadat úkoly týmu" }).click();
  const as = page.getByRole("dialog", { name: "Zadat kroky playbooku jako úkoly" });
  await as.getByRole("button", { name: /Zadat úkoly/ }).click();
  await expect(card.getByText(/^Ú-\d+/).first()).toBeVisible();
  await page.goto("/actions");
  await expect(page.getByRole("row", { name: /E2E playbook hesla/ }).first()).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC XII: pohled na hostitele – seznam, aktivita, alerty, odkaz z aktiva", async () => {
  const headers = { origin: new URL(page.url()).origin };
  const asset = await (await page.request.post("/api/assets", { data: { name: "E2E-WEB-01", assetType: "server" }, headers })).json();
  await page.request.post("/api/soc/alerts", { data: { title: "E2E podezřelý proces na serveru", severity: "high", mitreIds: ["T1059"], assetId: asset.id }, headers });
  await page.goto("/soc?tab=hosts");
  const list = page.getByTestId("soc-hosts");
  await list.getByRole("link", { name: "E2E-WEB-01" }).click();
  await expect(page.getByRole("heading", { name: "E2E-WEB-01" })).toBeVisible();
  await expect(page.getByTestId("soc-host-activity")).toBeVisible();
  await expect(page.getByTestId("soc-host-alerts")).toContainText("E2E podezřelý proces na serveru");
  await page.goto(`/assets/${asset.id}`);
  await page.getByRole("link", { name: "Pohled SOC na hostitele" }).click();
  await expect(page.getByTestId("soc-host-alerts")).toContainText("E2E podezřelý proces na serveru");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC XIII: zdroj Elastic Security se stahováním – nastavení, stažení, chyba spojení", async () => {
  await page.goto("/soc?tab=sources");
  await page.getByRole("button", { name: "Nový zdroj" }).click();
  const dlg = page.getByRole("dialog", { name: "Nový zdroj" });
  await dlg.getByLabel("Název").fill("E2E Elastic");
  await dlg.getByLabel("Formát").selectOption("elastic");
  const pf = dlg.getByTestId("soc-pull-fields");
  await pf.getByLabel("Adresa Elasticsearch").fill("http://127.0.0.1:9");
  await pf.getByLabel("API klíč", { exact: true }).fill("e2e-key");
  await dlg.getByRole("button", { name: "Založit a zobrazit token" }).click();
  await page.getByRole("dialog", { name: "Token zdroje E2E Elastic" }).getByRole("button", { name: "Token mám uložený" }).click();
  const row = page.getByRole("row", { name: /E2E Elastic/ });
  await expect(row).toContainText("stahování každých 15 min");
  await row.getByRole("button", { name: "Stáhnout" }).click();
  await expect(row).toContainText("Elasticsearch");
  await row.getByRole("button", { name: "Nastavení stahování" }).click();
  await expect(page.getByRole("dialog", { name: "Stahování ze SIEM: E2E Elastic" }).getByLabel("Index alertů")).toHaveValue(".alerts-security.alerts-default");
  await page.getByRole("dialog", { name: "Stahování ze SIEM: E2E Elastic" }).getByRole("button", { name: "Zrušit" }).click();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC X: plánované hledání hrozeb – knihovna, úprava, zkušební běh", async () => {
  await page.goto("/soc?tab=hunts");
  const card = page.getByTestId("soc-hunts");
  await expect(card.getByRole("heading", { name: "Plánované hledání hrozeb" })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "Mazání bezpečnostních protokolů" }).getByRole("button", { name: "Přidat" }).click();
  const dlg = page.getByRole("dialog", { name: "Nové hledání" });
  await expect(dlg.getByLabel("Dotaz (Lucene / query_string)")).toHaveValue(/log_clearing/);
  await dlg.getByLabel("Práh (min. výskytů ve skupině)").fill("2");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  const row = card.getByRole("row", { name: /Mazání bezpečnostních protokolů/ });
  await expect(row).toContainText("práh 2");
  await expect(page.getByRole("listitem").filter({ hasText: "Mazání bezpečnostních protokolů" }).getByRole("button", { name: "Přidáno" })).toBeDisabled();
  await row.getByRole("button", { name: "Zkusit" }).click();
  await expect(page.getByTestId("soc-hunt-result")).toContainText("Wazuh Indexer není nastaven");
  await page.getByRole("dialog", { name: /Zkušební běh/ }).getByRole("button", { name: "Zavřít" }).click();
  await row.getByRole("button", { name: "Vypnout" }).click();
  await expect(row.getByRole("button", { name: "Zapnout" })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("prioritizace zranitelností: přehled priorit, plán oprav, ruční nahrání katalogu KEV", async () => {
  await page.goto("/vulnerabilities");
  await expect(page.getByRole("heading", { name: "Priority oprav" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plán oprav podle balíčků" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Priorita" })).toBeVisible();
  await page.getByRole("button", { name: "Zdroje hrozeb" }).click();
  const dlg = page.getByRole("dialog", { name: "Zdroje hrozeb" });
  await dlg.getByLabel("Stahovat automaticky jednou denně").uncheck();
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await dlg.getByLabel("Nahrát soubor").setInputFiles({
    name: "known_exploited_vulnerabilities.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ catalogVersion: "2026.10.15", vulnerabilities: [{ cveID: "CVE-2021-44228", vulnerabilityName: "Log4Shell", knownRansomwareCampaignUse: "Known" }] })),
  });
  await expect(dlg.getByText("Nahráno (KEV): 1 záznamů.")).toBeVisible();
  await expect(dlg.getByText(/KEV: 1 záznamů \(verze 2026\.10\.15/)).toBeVisible();
  // lhůty oprav (ADR-050)
  await expect(dlg.getByLabel("P1 (dní)")).toHaveValue("7");
  await dlg.getByLabel("P1 (dní)").fill("5");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await expect.poll(async () => (await (await page.request.get("/api/vulnerabilities/intel")).json()).sla.p1).toBe(5);
  await dlg.getByRole("button", { name: "Zavřít" }).last().click();
  await expect(page.getByText("lhůty P1 5 d · P2 30 d · P3 90 d")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Opravit do", exact: true })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("přehodnocení rizika z podnětů: incident, návrh, potvrzení beze změny, historie", async () => {
  const headers = { origin: new URL(page.url()).origin };
  const rk = await (await page.request.post("/api/risks", { data: { name: "E2E výpadek e-shopu", impact: 2, threatLevel: 2, vulnLevel: 2 }, headers })).json();
  await page.request.post("/api/incidents", { data: { title: "E2E výpadek e-shopu – DDoS", kind: "incident", category: "dos", detectedAt: new Date().toISOString(), riskIds: [rk.id] }, headers });
  await page.goto("/risks");
  await page.getByLabel("Jen s podněty k přehodnocení").check();
  await expect(page.getByRole("row", { name: /E2E výpadek e-shopu/ })).toContainText("Podněty: 1");
  await page.getByRole("link", { name: "E2E výpadek e-shopu" }).click();
  const card = page.getByTestId("risk-reassessment");
  await expect(card.getByRole("heading", { name: "Podněty k přehodnocení" })).toBeVisible();
  await expect(card.getByRole("link", { name: "E2E výpadek e-shopu – DDoS" })).toBeVisible();
  await expect(card).toContainText("Úroveň hrozby 2 → 3");
  await card.getByLabel("Zdůvodnění rozhodnutí").fill("Útok byl odražen ochranou poskytovatele, hodnocení odpovídá.");
  await card.getByRole("button", { name: "Potvrdit hodnocení beze změny" }).click();
  await expect(card).toContainText("žádné nové podněty");
  await card.getByRole("button", { name: /Historie/ }).click();
  await expect(card).toContainText("Potvrzeno beze změny");
  await expect(card).toContainText("Útok byl odražen ochranou poskytovatele");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("graf vazeb aktiv: vrstvy, detail uzlu, technická závislost, dopad výpadku", async () => {
  const headers = { origin: new URL(page.url()).origin };
  const mk = async (data: Record<string, unknown>) => (await page.request.post("/api/assets", { data, headers })).json();
  const svc = await mk({ name: "E2E Mzdová služba", assetType: "business_service", assetClass: "primary" });
  const app = await mk({ name: "E2E Mzdový systém", assetType: "application" });
  const srv = await mk({ name: "E2E Hypervisor", assetType: "server" });
  await page.request.post("/api/assets/links", { data: { primaryId: svc.id, supportingId: app.id }, headers });
  await page.goto("/assets/graph");
  const graph = page.getByTestId("asset-graph");
  await expect(graph.getByText("Primární aktiva (služby, informace)")).toBeVisible();
  await page.getByLabel("Zobrazit i aktiva bez vazeb").check();
  await graph.getByRole("button", { name: "E2E Mzdový systém" }).click();
  const panel = page.getByTestId("asset-graph-node");
  await expect(panel).toContainText("E2E Mzdová služba");
  await panel.getByLabel("Druh závislosti").selectOption("runs_on");
  await panel.getByLabel("Cílové aktivum").selectOption({ label: "E2E Hypervisor" });
  await panel.getByRole("button", { name: "Přidat závislost" }).click();
  await expect(panel.getByRole("button", { name: "E2E Hypervisor", exact: true })).toBeVisible();
  // dopad výpadku hypervizoru: aplikace i služba
  await panel.getByRole("button", { name: "E2E Hypervisor", exact: true }).click();
  await expect(page.getByTestId("asset-graph-impact")).toContainText("Výpadek zasáhne 2 uzlů");
  await page.getByLabel("Analýza dopadu výpadku").check();
  await expect(graph.getByRole("button", { name: "E2E Mzdová služba" })).toBeVisible();
  await page.goto(`/assets/${srv.id}`);
  await expect(page.getByTestId("asset-dependencies")).toContainText("E2E Mzdový systém");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("shoda konfigurace (Wazuh SCA): stránka, chyba bez Wazuhu, nový automatický test", async () => {
  await page.goto("/controls");
  await page.getByRole("link", { name: "Shoda konfigurace" }).click();
  await expect(page.getByRole("heading", { name: "Shoda konfigurace" })).toBeVisible();
  await page.getByRole("button", { name: "Načíst z Wazuhu" }).click();
  await expect(page.getByText("Wazuh API není nastaveno")).toBeVisible();
  await page.getByTestId("sca-automations").getByRole("button", { name: "Nový automatický test" }).click();
  await expect(page.getByRole("dialog", { name: "Nový automatický test" }).getByLabel("Účinné od skóre (%)")).toHaveValue("80");
  await page.getByRole("dialog", { name: "Nový automatický test" }).getByRole("button", { name: "Zrušit" }).click();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("analýza odolnosti: stránka, nálezy, redundance ve formuláři aktiva, překryv v grafu", async () => {
  await page.goto("/assets");
  await page.getByRole("link", { name: "Analýza odolnosti" }).click();
  await expect(page.getByRole("heading", { name: "Analýza odolnosti" })).toBeVisible();
  await expect(page.getByTestId("resilience-findings")).toBeVisible();
  await page.goto("/assets/new");
  await expect(page.getByLabel("Redundantní (cluster, HA, záložní linka)")).not.toBeChecked();
  await page.goto("/assets/graph");
  await page.getByLabel("Obarvit podle").selectOption("resilience");
  await expect(page.getByTestId("asset-graph").getByText("bez nálezu")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("cvičení: ze šablony, zahájení, vstup scénáře, rozhodnutí, vyhodnocení, záznam", async () => {
  await page.goto("/continuity/exercises");
  await page.getByRole("button", { name: "Nové cvičení" }).click();
  const dlg = page.getByRole("dialog", { name: "Nové cvičení" });
  await dlg.getByLabel("Šablona scénáře").selectOption("ransomware");
  await dlg.getByRole("button", { name: "Založit" }).click();
  await expect(page.getByRole("heading", { name: /CV-\d+ Ransomware na souborovém serveru/ })).toBeVisible();
  await expect(page.getByTestId("exercise-prep").getByLabel("Vstup 1")).toHaveValue(/Helpdesk/);
  await page.getByRole("button", { name: "Zahájit cvičení" }).click();
  const inj = page.getByTestId("exercise-injects");
  await inj.getByRole("button", { name: "Vložit" }).first().click();
  const log = page.getByTestId("exercise-log");
  await expect(log).toContainText("Vstup scénáře");
  await log.getByLabel("Text záznamu").fill("Izolace segmentu, aktivace týmu.");
  await log.getByRole("button", { name: "Zapsat" }).click();
  await expect(log).toContainText("Izolace segmentu, aktivace týmu.");
  await page.getByRole("button", { name: "Ukončit a vyhodnotit" }).click();
  const ev = page.getByRole("dialog", { name: "Vyhodnocení cvičení" });
  await ev.getByLabel("Zjištění").fill("Obnova trvala déle.");
  await ev.getByRole("button", { name: "Ukončit a vyhodnotit" }).click();
  await expect(page.getByTestId("exercise-result")).toContainText("Obnova trvala déle.");
  const rec = await page.request.get(await page.getByRole("link", { name: /Záznam pro audit/ }).getAttribute("href") ?? "");
  expect(await rec.text()).toContain("Izolace segmentu, aktivace týmu.");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("hlášení incidentu NÚKIB: předvyplnění, chybějící údaje, zaznamenání podání s textem", async () => {
  const headers = { origin: new URL(page.url()).origin };
  const inc = await (await page.request.post("/api/incidents", { data: { title: "E2E hlášení – únik dat", kind: "incident", category: "data_leak", detectedAt: new Date(Date.now() - 3600_000).toISOString(), description: "Neoprávněný přístup k databázi klientů." }, headers })).json();
  await page.goto(`/incidents/${inc.id}`);
  await page.getByRole("button", { name: "Připravit hlášení" }).click();
  const dlg = page.getByRole("dialog", { name: "Hlášení incidentu" });
  await dlg.getByLabel("Druh hlášení").selectOption("initial");
  await expect(dlg).toContainText("Neoprávněný přístup k databázi klientů.");
  await expect(dlg.getByTestId("report-missing")).toContainText("Kontaktní osoba");
  await dlg.getByRole("button", { name: "Zaznamenat podání" }).click();
  const rec = page.getByRole("dialog", { name: "Zaznamenat podané hlášení" });
  await expect(rec.getByRole("textbox").last()).toHaveValue(/Neoprávněný přístup k databázi klientů/);
  await rec.getByRole("button", { name: "Uložit" }).click();
  await expect(page.getByText("Podaná hlášení")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("DORA registr informací: poskytovatel IKT, údaje smlouvy, kontrola úplnosti, export", async () => {
  const headers = { origin: new URL(page.url()).origin };
  const sup = await (await page.request.post("/api/suppliers", { data: { name: "E2E Cloud DORA s.r.o.", ico: "27074358" }, headers })).json();
  await page.request.post(`/api/suppliers/${sup.id}/contracts`, { data: { title: "E2E SaaS", number: "E2E-DORA-1", validFrom: "2025-01-01" }, headers });
  // příznak poskytovatele IKT na kartě dodavatele
  await page.goto(`/suppliers/${sup.id}`);
  const card = page.getByTestId("dora-provider-card");
  await card.getByRole("button", { name: "Označit jako poskytovatele IKT" }).click();
  const pd = page.getByRole("dialog", { name: "Poskytovatel služeb IKT (DORA)" });
  await pd.getByLabel("Poskytovatel služeb IKT (registr DORA)").check();
  await pd.getByLabel("Země sídla (ISO)").fill("CZ");
  await pd.getByRole("button", { name: "Uložit" }).click();
  await expect(card).toContainText("Zařazen do registru informací");
  await page.goto("/suppliers");
  await page.getByRole("link", { name: "Registr informací DORA" }).click();
  await expect(page.getByRole("heading", { name: "Registr informací DORA" })).toBeVisible();
  await expect(page.getByTestId("dora-findings")).toContainText("Smlouva bez druhu služby IKT");
  await page.getByRole("tab", { name: "Smlouvy" }).click();
  const row = page.getByTestId("dora-contracts").getByRole("row", { name: /E2E-DORA-1/ });
  await row.getByRole("button", { name: "Údaje smlouvy pro registr DORA" }).click();
  const dlg = page.getByRole("dialog", { name: "Údaje smlouvy pro registr DORA" });
  await dlg.getByLabel("S19 Cloud: SaaS").check();
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await expect(row).toContainText("S19");
  const z = await page.request.get(await page.getByRole("link", { name: /Export šablon/ }).getAttribute("href") ?? "");
  expect(z.headers()["content-type"]).toBe("application/zip");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("certifikáty a TLS: přidání koncového bodu, kontrola, detail, pravidla", async () => {
  await page.goto("/assets");
  await page.getByRole("link", { name: "Certifikáty a TLS" }).click();
  await expect(page.getByRole("heading", { name: "Certifikáty a TLS" })).toBeVisible();
  await page.getByRole("button", { name: "Přidat koncový bod" }).click();
  const dlg = page.getByRole("dialog", { name: "Přidat koncový bod" });
  await dlg.getByLabel(/Hostitel/).fill("127.0.0.1");
  await dlg.getByLabel("Port").fill("1");
  await dlg.getByRole("button", { name: "Přidat a zkontrolovat" }).click();
  const tbl = page.getByTestId("tls-endpoints");
  await expect(tbl).toContainText("Nedostupné / chyba spojení");
  await tbl.getByRole("button", { name: "127.0.0.1:1" }).click();
  await expect(page.getByTestId("tls-detail")).toContainText("Chyba");
  await expect(page.getByText("Pravidla kontroly")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("portál externího auditora: požadavek, přidělení, nahrání, odeslání a převzetí auditorem", async ({ browser }) => {
  const headers = { origin: new URL(page.url()).origin };
  const roles = await (await page.request.get("/api/admin/roles")).json();
  const extRole = roles.find((r: any) => r.key === "external_auditor").id;
  await page.request.post("/api/admin/users", { data: { email: "e2e.auditor@cpa.test", displayName: "E2E Auditor", password: "E2E-Auditor-Heslo-1!", roleIds: [extRole] }, headers });
  const aud = await (await page.request.post("/api/audits", { data: { title: "E2E SOC 2 audit" }, headers })).json();
  await page.goto(`/audits/${aud.id}`);
  const panel = page.getByTestId("pbc-panel");
  await panel.getByRole("button", { name: "Nový požadavek" }).click();
  const add = page.getByRole("dialog", { name: "Nový požadavek" });
  await add.getByLabel("Název požadavku").fill("Seznam administrátorů");
  await add.getByLabel("Odkaz na kritérium").fill("CC6.3");
  await add.getByRole("button", { name: "Založit" }).click();
  await expect(panel).toContainText("PBC-001");
  await panel.getByRole("button", { name: "Externí auditoři" }).click();
  const au = page.getByRole("dialog", { name: "Externí auditoři" });
  await au.getByLabel("Vyberte auditora…").selectOption({ label: "E2E Auditor (e2e.auditor@cpa.test)" });
  await au.locator("button:has(svg.lucide-plus)").click();
  await au.getByRole("button", { name: "Uložit" }).click();
  await expect(panel).toContainText("E2E Auditor");
  await panel.getByRole("button", { name: /PBC-001/ }).click();
  const req = page.getByRole("dialog", { name: /PBC-001/ });
  await req.getByLabel("Nahrát soubor").setInputFiles({ name: "admini.csv", mimeType: "text/csv", buffer: Buffer.from("admin;Administrátor") });
  await expect(req.getByTestId("pbc-request")).toContainText("admini.csv");
  await req.getByRole("button", { name: "Odeslat auditorovi" }).click();
  await expect(req.getByTestId("pbc-request")).toContainText("Odesláno auditorovi");
  await req.getByRole("button", { name: "Zavřít" }).click();
  // auditor v samostatné relaci
  const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const ap = await ctx.newPage();
  const oh = { origin: new URL(page.url()).origin };
  await ctx.request.post("/api/auth/login", { data: { email: "e2e.auditor@cpa.test", password: "E2E-Auditor-Heslo-1!" }, headers: oh });
  await ctx.request.post("/api/auth/password", { data: { currentPassword: "E2E-Auditor-Heslo-1!", newPassword: "E2E-Auditor-Nove-2!" }, headers: oh });
  await ctx.request.post("/api/auth/login", { data: { email: "e2e.auditor@cpa.test", password: "E2E-Auditor-Nove-2!" }, headers: oh });
  await ap.goto("/");
  await expect(ap.getByRole("heading", { name: "Portál auditora" })).toBeVisible();
  const ext = ap.getByTestId("pbc-panel");
  await ext.getByRole("button", { name: /PBC-001/ }).click();
  const er = ap.getByRole("dialog", { name: /PBC-001/ });
  await expect(er).toContainText("admini.csv");
  await er.getByRole("button", { name: "Převzít podklady" }).click();
  await expect(er.getByTestId("pbc-request")).toContainText("Převzato auditorem");
  await ctx.close();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("síťové segmenty: segment, sken, neevidované zařízení, schválení", async () => {
  const headers = { origin: new URL(page.url()).origin };
  await page.request.put("/api/admin/connectors/network-scan", { data: { enabled: true, allowedCidrs: ["127.0.0.1/32"] }, headers });
  // skutečný sken potřebuje nmap – obraz Playwrightu v CI ho nemá (sken s náhradou ověřují integrační testy)
  const info = await (await page.request.get("/api/discovery/segments")).json();
  test.skip(!info.scan?.nmap, "nmap není nainstalován");
  await page.goto("/discovery");
  const segs = page.getByTestId("net-segments");
  await segs.getByRole("button", { name: "Nový segment" }).click();
  const dlg = page.getByRole("dialog", { name: "Nový segment" });
  await dlg.getByLabel("Název segmentu").fill("E2E localhost");
  await dlg.getByLabel(/Rozsahy/).fill("127.0.0.1/32");
  await dlg.getByRole("combobox", { name: "Plán", exact: true }).selectOption("manual");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await expect(segs).toContainText("E2E localhost");
  await segs.getByRole("row", { name: /E2E localhost/ }).getByRole("button", { name: "Spustit sken" }).click();
  await expect(segs.getByRole("row", { name: /E2E localhost/ })).toContainText("Neevidované 1", { timeout: 30_000 });
  const devs = page.getByTestId("net-observations");
  await expect(devs).toContainText("127.0.0.1");
  await devs.getByRole("row", { name: /127\.0\.0\.1/ }).getByRole("button", { name: "Schválit" }).click();
  const ap = page.getByRole("dialog", { name: "Schválit zařízení mimo evidenci" });
  await ap.getByLabel("Proč je zařízení povolené").fill("Server CONTIX");
  await ap.getByRole("button", { name: "Potvrdit" }).click();
  await expect(devs).toContainText("Žádná neevidovaná zařízení.");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("třídění seznamů: pohled incidentů, seskupení fronty SOC, detail CVE", async () => {
  await page.goto("/incidents");
  const f = page.getByTestId("incident-filters");
  await f.getByRole("combobox", { name: "Seskupit" }).selectOption("category");
  await f.getByRole("button", { name: "Uložit pohled" }).click();
  const dlg = page.getByRole("dialog", { name: "Uložit pohled" });
  await dlg.getByLabel("Název pohledu").fill("E2E podle kategorie");
  await dlg.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(f.getByRole("combobox", { name: "Uložené pohledy" })).toContainText("E2E podle kategorie");
  await page.goto("/soc");
  const sf = page.getByTestId("soc-filters");
  await sf.getByRole("combobox", { name: "Seskupit" }).selectOption("source");
  await expect(sf.getByRole("combobox", { name: "Zdroj" })).toBeVisible();
  await page.goto("/vulnerabilities/cve/CVE-2021-44228");
  await expect(page.getByTestId("vuln-overview")).toContainText("KEV");
  await expect(page.getByTestId("vuln-advice")).toBeVisible();
  await expect(page.getByTestId("breadcrumbs")).toContainText("Detail");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Cortex a MISP: nastavení integrací", async () => {
  await page.goto("/soc?tab=sources");
  // drobečková navigace (kde se nacházím) a zpět
  await expect(page.getByTestId("breadcrumbs")).toContainText("Přehled");
  await expect(page.getByTestId("breadcrumbs")).toContainText("SOC");
  const card = page.getByTestId("soc-integrations");
  await expect(card).toContainText("Cortex a MISP");
  await card.getByRole("button", { name: "Nastavit integrace" }).click();
  const dlg = page.getByRole("dialog", { name: "Nastavit integrace" });
  await dlg.getByLabel("Interní domény").fill("firma.cz\nfirma.local");
  await dlg.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(dlg).toBeHidden();
  await card.getByRole("button", { name: "Nastavit integrace" }).click();
  await expect(page.getByRole("dialog", { name: "Nastavit integrace" }).getByLabel("Interní domény")).toHaveValue("firma.cz\nfirma.local");
  await page.getByRole("dialog", { name: "Nastavit integrace" }).getByRole("button", { name: "Zrušit" }).click();
  expect(errors, errors.join("\n")).toEqual([]);
});


test("sledované rámce v okně kořenové společnosti: CIS v8.1 s implementační skupinou", async () => {
  await page.goto("/admin/companies");
  await page.locator("tbody tr").first().getByRole("button").first().click();
  const dlg = page.getByRole("dialog");
  const fw = dlg.getByTestId("framework-scope");
  await expect(fw).toContainText("Vždy podle režimu");
  await fw.getByLabel("Vybrat další rámce ručně").check();
  await fw.getByRole("checkbox", { name: "CIS v8.1", exact: true }).check();
  await fw.getByTestId("cis-ig").getByRole("combobox").selectOption("2");
  await dlg.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(dlg).toBeHidden();
  await page.locator("tbody tr").first().getByRole("button").first().click();
  await expect(page.getByRole("dialog").getByTestId("cis-ig").getByRole("combobox")).toHaveValue("2");
  await page.getByRole("dialog").getByTestId("framework-scope").getByLabel("Vybrat další rámce ručně").uncheck();
  await page.getByRole("dialog").getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("přihlášení: připojení AD, zkouška přihlášení, poskytovatel SSO", async () => {
  await page.goto("/admin/login");
  const card = page.getByTestId("ad-login");
  await card.getByRole("button", { name: "Připojit AD" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Adresa řadiče domény").fill("ldaps://127.0.0.1:1");
  await dlg.getByLabel("Base DN").fill("DC=lab,DC=internal");
  await dlg.getByLabel("Účet pro čtení").fill("svc-contix@lab.internal");
  await dlg.getByLabel("Heslo účtu pro čtení").fill("e2e-heslo");
  await dlg.getByRole("checkbox", { name: /Povolit přihlášení účty tohoto AD/ }).uncheck();
  await dlg.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(card).toContainText("ldaps://127.0.0.1:1");
  await card.locator("div.flex-wrap", { hasText: "ldaps://127.0.0.1:1" }).getByRole("button", { name: "Vyzkoušet" }).click();
  const tdlg = page.getByRole("dialog");
  await tdlg.getByLabel("Uživatelské jméno").fill("jan.novak");
  await tdlg.getByLabel("Heslo").fill("x");
  await tdlg.getByRole("button", { name: "Vyzkoušet" }).click();
  await expect(tdlg.getByTestId("ad-test-result")).toContainText("není dostupný");
  await tdlg.getByRole("button", { name: "Zavřít", exact: true }).last().click();
  await expect(tdlg).toBeHidden();
  const sso = page.getByTestId("sso-providers");
  await sso.getByRole("button", { name: "Přidat poskytovatele" }).click();
  const sdlg = page.getByRole("dialog");
  await sdlg.getByLabel("ID tenanta (Directory ID)").fill("contoso.onmicrosoft.com");
  await sdlg.getByLabel("ID klienta (Application ID)").fill("00000000-0000-0000-0000-000000000001");
  await sdlg.getByLabel("Tajný klíč klienta").fill("e2e-secret");
  await sdlg.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(sdlg).toBeHidden();
  await expect(sso).toContainText("/api/auth/oidc/sso-");
  await expect(page.getByTestId("breadcrumbs")).toContainText("Přihlášení");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("knihovna rámců: import CSV, SoA vlastního rámce, smazání", async () => {
  await page.goto("/controls/library");
  const lib = page.getByTestId("framework-library");
  await expect(lib).toContainText("Česko (CZ)");
  await expect(lib).toContainText("Evropská unie (EU)");
  await page.getByRole("button", { name: "Importovat rámec" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Soubor").setInputFiles({
    name: "sk.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("ID;Oddíl;Text\n§ 20 ods. 1;§ 20;Prevádzkovateľ prijme bezpečnostné opatrenia.\n§ 24;§ 24;Prevádzkovateľ hlási incident.\n"),
  });
  await dlg.getByLabel("Klíč").fill("sk-e2e");
  await dlg.getByLabel("Zkratka").fill("SK E2E");
  await dlg.getByLabel("Země").fill("SK");
  await dlg.getByLabel("Název", { exact: true }).fill("Zákon o kybernetickej bezpečnosti (e2e)");
  await dlg.getByRole("button", { name: "Načíst náhled" }).click();
  await expect(dlg.getByTestId("fw-preview")).toContainText("2 požadavků");
  await dlg.getByRole("button", { name: "Importovat", exact: true }).click();
  await expect(dlg).toBeHidden();
  const row = page.getByTestId("fw-x-sk-e2e");
  await expect(row).toContainText("SK E2E");
  await expect(lib).toContainText("Slovensko (SK)");
  await row.getByRole("button", { name: "Shoda (SoA)" }).click();
  await expect(page.getByText("Prevádzkovateľ hlási incident.")).toBeVisible();
  await page.goto("/controls/library");
  await page.getByTestId("fw-x-sk-e2e").getByRole("button", { name: /Smazat rámec/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Smazat", exact: true }).click();
  await expect(page.getByTestId("fw-x-sk-e2e")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("regulatorní profil: dceřiná společnost mimo Česko s hlavním rámcem ISO 27001", async () => {
  await page.goto("/admin/companies");
  await page.getByRole("button", { name: "Společnost", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Název", { exact: true }).fill("E2E Tochter GmbH");
  const prof = dlg.getByTestId("profile-picker");
  await prof.locator("select").first().selectOption("generic");
  await expect(prof.getByLabel("Režim podle zákona č. 264/2025 Sb.")).toHaveCount(0);
  await prof.locator("select").nth(1).selectOption("iso27001");
  await expect(prof).toContainText("Hlavní rámec: ISO 27001");
  // finanční subjekt podle DORA (ADR-084) – nezávisle na balíčku země
  await prof.getByLabel("Finanční subjekt podle DORA (nařízení EU 2022/2554)").check();
  await expect(prof).toContainText("DORA platí přímo ve všech státech EU");
  await dlg.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator("tr", { hasText: "E2E Tochter GmbH" })).toContainText("ISO 27001");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("rizikový scénář s více hrozbami a zranitelnostmi", async () => {
  await page.goto("/risks/new");
  await page.getByLabel("Název rizika").fill("Únik dat z CRM");
  const more = page.getByTestId("more-threats");
  await more.locator("select").selectOption({ index: 1 });
  await more.locator("select").selectOption({ index: 1 });
  await expect(more.getByRole("button", { name: "Odebrat ze scénáře" })).toHaveCount(2);
  await page.getByTestId("more-weaknesses").locator("select").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Založit riziko" }).click();
  await expect(page).toHaveURL(/\/risks\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("more-threats").getByRole("button", { name: "Odebrat ze scénáře" })).toHaveCount(2);
  await page.goto("/risks");
  await expect(page.locator("tr", { hasText: "Únik dat z CRM" })).toContainText("+2");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("výběr rámce: sledované rámce nahoře", async () => {
  await page.goto("/controls/soa");
  // ve skupině s více společnostmi se SoA vede za jednu společnost – zvolíme první (kořen)
  const pick = page.getByRole("button", { name: "Moje organizace", exact: true });
  await expect(page.getByRole("heading", { name: "Prohlášení o aplikovatelnosti", level: 1 })).toBeVisible();
  if (await pick.count()) await pick.click();
  const sel = page.locator("select").filter({ has: page.locator('optgroup[label="Sledované rámce"]') }).first();
  await expect(sel).toBeVisible();
  await expect(sel.locator('optgroup[label="Další rámce"] option').first()).toBeAttached();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("informační servis NÚKIB: nahrání RSS a posouzení varování", async () => {
  await page.goto("/infoservice");
  await expect(page.getByRole("heading", { name: "Informační servis NÚKIB", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Zdroje", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Soubor", { exact: true }).setInputFiles({
    name: "rss.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(
      `<rss version="2.0"><channel><item><title>Varování NÚKIB E2E</title><link>https://nukib.gov.cz/x</link><guid>e2e-1</guid><pubDate>Wed, 21 Oct 2026 10:00:00 +0000</pubDate></item><item><title>NÚKIB upozorňuje na zranitelnost E2E</title><guid>e2e-2</guid></item></channel></rss>`,
    ),
  });
  await dlg.getByRole("button", { name: "Nahrát" }).click();
  await expect(dlg).toContainText("Načteno 2 položek.");
  await dlg.getByRole("button", { name: "Zrušit", exact: true }).click();
  const list = page.getByTestId("info-items");
  await expect(list).toContainText("Varování NÚKIB E2E");
  await list.locator("li", { hasText: "Varování NÚKIB E2E" }).getByRole("button", { name: "Posoudit" }).click();
  await page.getByRole("dialog").getByLabel("Závěr posouzení").fill("Netýká se nás.");
  await page.getByRole("dialog").getByRole("button", { name: "Uložit posouzení" }).click();
  await expect(list.locator("li", { hasText: "Varování NÚKIB E2E" })).toContainText("posouzeno");
  // ruční doplnění měsíce z přehledu NÚKIB
  await page.getByRole("button", { name: "Doplnit měsíc" }).click();
  const md = page.getByRole("dialog");
  await md.getByRole("combobox", { name: "Rok", exact: true }).selectOption("2026");
  await md.getByRole("combobox", { name: "Měsíc", exact: true }).selectOption("09");
  await md.getByLabel("Průnik", { exact: true }).fill("4");
  await md.getByLabel("Významný incident", { exact: true }).fill("1");
  await md.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(md).toBeHidden();
  await expect(page.getByTestId("info-stats")).toContainText("2026-09 ✎");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("AI Act: nový AI systém, screening, schválení a povinnosti", async () => {
  await page.goto("/aiact");
  await expect(page.getByRole("heading", { name: "Umělá inteligence (AI Act)", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Nový AI systém" }).click();
  await page.getByLabel("Název", { exact: true }).fill("Chatbot E2E");
  await page.getByLabel("Účel použití").fill("Odpovědi občanům");
  const sc = page.getByTestId("aiact-screening");
  await sc.getByLabel("Přímo komunikuje s lidmi (chatbot, hlasový asistent)").check();
  await expect(sc).toContainText("Omezené riziko (transparentnost)");
  await page.getByRole("button", { name: "Založit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chatbot E2E", level: 1 })).toBeVisible();
  await page.getByTestId("aiact-decision").getByRole("button", { name: "Schválit použití" }).click();
  await expect(page.getByTestId("aiact-decision")).toContainText("Schválil");
  await expect(page.getByTestId("aiact-obligations")).toContainText("čl. 4");
  await page.goto("/aiact");
  await expect(page.getByTestId("aiact-summary")).toBeVisible();
  await expect(page.getByRole("link", { name: "Chatbot E2E" })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("SOC 2: nová zakázka, kritéria, pracovní papír a mapování TSC", async () => {
  await page.goto("/soc2");
  await expect(page.getByRole("heading", { name: "Zprávy SOC 2", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "Mapování TSC ↔ 409 / ISO" }).click();
  await expect(page.getByTestId("soc2-mapping")).toContainText("A.5.16");
  await page.getByRole("button", { name: "Nová zakázka SOC 2" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Název zakázky").fill("SOC 2 E2E");
  await dlg.getByLabel("Posuzovaný systém / služba").fill("Cloud E2E");
  await dlg.getByLabel("Období od").fill("2026-01-01");
  await dlg.getByLabel("Období do").fill("2026-06-30");
  await dlg.getByRole("button", { name: "Založit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "SOC 2 E2E", level: 1 })).toBeVisible();
  const crit = page.getByTestId("soc2-criteria");
  await crit.getByText("CC6.2", { exact: true }).click();
  await page.getByRole("combobox", { name: "Závěr" }).last().selectOption("na");
  await page.getByRole("button", { name: "Uložit závěr" }).click();
  await expect(crit.locator("tr", { hasText: "CC6.2" }).first()).toContainText("Nerelevantní");
  await page.getByRole("tab", { name: /Zpráva/ }).click();
  await expect(page.getByTestId("soc2-readiness")).toContainText("Chybí datum zprávy");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("CRA: nový produkt, kategorie, požadavek a hlášení se lhůtami", async () => {
  await page.goto("/cra");
  await expect(page.getByRole("heading", { name: "Kybernetická odolnost produktů (CRA)", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Nový produkt" }).click();
  await page.getByLabel("Název", { exact: true }).fill("Brána E2E");
  await page.getByRole("combobox", { name: "Kategorie" }).selectOption("important_1");
  await page.getByRole("button", { name: "Založit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brána E2E", level: 1 })).toBeVisible();
  await expect(page.getByTestId("cra-gaps")).toContainText("Chybí SBOM");
  const req = page.getByTestId("cra-requirements");
  await req.locator("tr", { hasText: "Bezpečná výchozí konfigurace" }).getByRole("combobox").selectOption("done");
  await expect(req.locator("tr", { hasText: "Bezpečná výchozí konfigurace" }).getByRole("combobox")).toHaveValue("done");
  await page.getByRole("button", { name: "Nové hlášení" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Název", { exact: true }).fill("Zneužívaná zranitelnost E2E");
  await dlg.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("cra-reports")).toContainText("Zneužívaná zranitelnost E2E");
  await page.getByTestId("cra-reports").getByText("Zneužívaná zranitelnost E2E").click();
  await expect(page.getByTestId("cra-report-text")).toContainText("Brána E2E");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cra-findings")).toBeVisible();
  await page.goto("/cra");
  await page.getByRole("tab", { name: "Databáze OSV" }).click();
  await expect(page.getByTestId("cra-osv")).toContainText("Databáze je prázdná.");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("CRA distributor: doklady výrobce, oznámení CSAF a CPE (v1.16)", async () => {
  const H = { origin: new URL(page.url()).origin };
  const p = await (await page.request.post("/api/cra", { data: { name: "Kamera E2E", version: "2.4", role: "distributor", manufacturerName: "Acme", category: "default" }, headers: H })).json();
  await page.goto(`/cra/${p.id}`);
  const sup = page.getByTestId("cra-supply");
  await expect(sup).toContainText("Doklady výrobce (9 k ověření)");
  const ce = page.getByTestId("supply-ce_marking");
  await ce.getByRole("combobox").selectOption("ok");
  await ce.getByLabel(/Poznámka/).fill("Štítek na krabici");
  await ce.getByRole("button", { name: "Uložit" }).click();
  await expect(sup).toContainText("Doklady výrobce (8 k ověření)");
  await expect(page.getByTestId("supply-ce_marking")).toContainText("ověřeno");
  await page.getByTestId("supply-eu_doc").getByLabel(/Přiložit soubor/).setInputFiles({ name: "prohlaseni.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") });
  await expect(page.getByTestId("supply-eu_doc")).toContainText("prohlaseni.pdf");
  await expect(page.getByTestId("cra-findings")).toContainText("Produkt nemá SBOM, CPE ani oznámení výrobce");
  // oznámení výrobce CSAF
  await page.goto("/cra?tab=advisories");
  const csaf = {
    document: { csaf_version: "2.0", title: "Cam X auth bypass", publisher: { name: "Acme PSIRT", namespace: "https://acme.example" }, tracking: { id: "ACME-E2E-1", version: "1", current_release_date: "2026-10-20T00:00:00Z" } },
    product_tree: { branches: [{ category: "vendor", name: "Acme", branches: [{ category: "product_name", name: "Kamera E2E", branches: [{ category: "product_version_range", name: "vers:generic/<2.5", product: { product_id: "P1", name: "Acme Kamera E2E < 2.5" } }] }] }] },
    vulnerabilities: [{ cve: "CVE-2026-7777", title: "Auth bypass", product_status: { known_affected: ["P1"] }, remediations: [{ category: "vendor_fix", details: "Aktualizujte firmware na 2.5", product_ids: ["P1"] }] }],
  };
  await page.getByTestId("cra-advisories").getByLabel("Nahrát oznámení CSAF").setInputFiles({ name: "acme.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(csaf)) });
  await expect(page.getByTestId("cra-advisories")).toContainText("1 shoda s produkty");
  await expect(page.getByTestId("cra-advisories").getByRole("link", { name: "Kamera E2E" })).toBeVisible();
  await expect(page.getByTestId("cra-nvd")).toContainText("Povolit dohledání v NVD");
  await page.getByTestId("cra-advisories").getByRole("link", { name: "Kamera E2E" }).click();
  const fnd = page.getByTestId("cra-findings");
  await expect(fnd).toContainText("CVE-2026-7777");
  await expect(fnd).toContainText("Oznámení výrobce");
  await expect(fnd.getByLabel("Opatření")).toHaveValue(/Aktualizujte firmware na 2.5/);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("rizikové scénáře z dat: deklarace schopnosti, vyhodnocení, přijetí návrhu jako rizika (v1.17)", async () => {
  const H = { origin: new URL(page.url()).origin };
  const prim = await (await page.request.post("/api/assets", { data: { name: "E2E portál objednávek", assetType: "business_service", confidentiality: 3, integrity: 3, availability: 4 }, headers: H })).json();
  const srv = await (await page.request.post("/api/assets", { data: { name: "E2E web server", assetType: "server" }, headers: H })).json();
  await page.request.post("/api/assets/links", { data: { primaryId: prim.id, supportingId: srv.id }, headers: H });
  await page.goto("/risks");
  await page.getByRole("link", { name: "Scénáře z dat" }).click();
  await expect(page.getByRole("heading", { name: "Rizikové scénáře z dat", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "Profil schopností" }).click();
  const mfa = page.getByTestId("cap-mfa");
  await expect(mfa).toContainText("Neznámá");
  await mfa.getByRole("button", { name: "Doplnit deklaraci" }).click();
  await mfa.getByLabel("Stav").selectOption("weak");
  await mfa.getByLabel("Produkt / řešení").fill("Entra ID");
  await mfa.getByRole("button", { name: "Uložit" }).click();
  await expect(page.getByTestId("cap-mfa")).toContainText("Deklarováno");
  await page.getByRole("tab", { name: /Návrhy/ }).click();
  await page.getByRole("button", { name: "Vyhodnotit data" }).click();
  await expect(page.getByText(/Vyhodnoceno:/)).toBeVisible();
  const card = page.getByTestId("rsc-proposal").filter({ hasText: "Phishing a krádež přihlašovacích údajů" }).filter({ hasText: "E2E portál objednávek" });
  await expect(card).toContainText("Vícefaktorové ověření (MFA): Slabá");
  await card.getByRole("button", { name: "Přijmout jako riziko" }).click();
  const dlg = page.getByRole("dialog", { name: "Přijmout návrh jako riziko" });
  await expect(dlg.getByLabel("Název rizika")).toHaveValue("Phishing a krádež přihlašovacích údajů: E2E portál objednávek");
  await dlg.getByRole("button", { name: "Založit riziko" }).click();
  await expect(page.getByRole("heading", { name: "Phishing a krádež přihlašovacích údajů: E2E portál objednávek", level: 1 })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("pokrytí katalogu hrozeb: zdůvodněná nerelevantní hrozba u primárního aktiva (v1.18)", async () => {
  await page.goto("/risks/scenarios?tab=coverage");
  await expect(page.getByTestId("rsc-cov-summary")).toContainText("Posouzeno");
  await page.getByRole("button", { name: /E2E portál objednávek/ }).click();
  const row = page.getByTestId("rsc-cov-row").first();
  await expect(row).toContainText("Neposouzeno");
  await row.getByRole("button", { name: "Nerelevantní…" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Zdůvodnění").fill("Portál nezpracovává tuto kategorii dat (E2E).");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await expect(dlg).toBeHidden();
  await page.getByLabel("Filtr stavu").selectOption("not_relevant");
  await expect(page.getByTestId("rsc-cov-row").filter({ hasText: "Portál nezpracovává tuto kategorii dat (E2E)." })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("ochota riskovat a KRI, detekce ATT&CK (v1.22–v1.24)", async () => {
  await page.goto("/risks");
  await page.getByRole("link", { name: "Ochota riskovat a KRI" }).click();
  await expect(page.getByRole("heading", { name: "Ochota riskovat a KRI", level: 1 })).toBeVisible();
  const card = page.getByTestId("rap-appetite");
  await card.getByRole("button", { name: "Upravit" }).click();
  await card.getByLabel("Nejvyšší přijatelná úroveň").first().selectOption("medium");
  await card.getByRole("button", { name: "Uložit" }).click();
  await card.getByRole("button", { name: "Schválit" }).click();
  await expect(card).toContainText("Schváleno:");
  await expect(page.getByTestId("rap-kri-row").first()).toBeVisible();
  await page.goto("/risks/scenarios?tab=detection");
  await expect(page.getByTestId("rsc-det-row").first()).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("import skenu zranitelností: náhled, import, triáž falešně pozitivní", async () => {
  const headers = { origin: new URL(page.url()).origin };
  await page.request.post("/api/assets", { data: { name: "E2E-SCAN-01", assetType: "server", ipAddresses: ["10.88.0.1"] }, headers });
  await page.goto("/vulnerabilities");
  await page.getByRole("button", { name: "Importovat sken" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("input[type=file]").setInputFiles({ name: "sken.csv", mimeType: "text/csv", buffer: Buffer.from("host;ip;id;title;severity;port\nscan01;10.88.0.1;SSH-1;Slabé šifry SSH E2E;medium;22/tcp\n;10.88.9.9;X-1;Neznámý;low;80\n") });
  await dlg.getByRole("button", { name: "Náhled" }).click();
  await expect(dlg).toContainText("E2E-SCAN-01");
  await expect(dlg).toContainText("nenalezeno");
  await dlg.getByRole("button", { name: /Importovat 1 nález/ }).click();
  await expect(dlg).toBeHidden();
  const detail = page.locator("#vuln-scan-detail");
  await expect(detail).toContainText("Slabé šifry SSH E2E");
  await expect(detail).toContainText("10.88.9.9");
  await detail.getByLabel("Vybrat csv:SSH-1").check();
  await detail.getByRole("button", { name: "Falešně pozitivní" }).click();
  const tri = page.getByRole("dialog");
  await tri.getByLabel("Zdůvodnění").fill("Port 22 jen z interní sítě");
  await tri.getByRole("button", { name: "Falešně pozitivní" }).click();
  await expect(tri).toBeHidden();
  await expect(detail.getByText("Slabé šifry SSH E2E")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("průběžné monitorování: nový monitor, běh, historie", async () => {
  const headers = { origin: new URL(page.url()).origin };
  await page.request.post("/api/controls", { data: { name: "E2E Aktualizace systémů", status: "implemented" }, headers });
  await page.goto("/controls");
  await page.getByRole("main").getByRole("link", { name: "Průběžné monitorování" }).click();
  await expect(page.getByRole("heading", { name: "Průběžné monitorování", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Nový monitor" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("combobox", { name: "Opatření" }).selectOption({ label: "E2E Aktualizace systémů" });
  await dlg.getByLabel("Co se kontroluje").selectOption("eol_assets");
  await dlg.getByRole("button", { name: "Uložit" }).click();
  await expect(dlg).toBeHidden();
  const row = page.getByTestId("monitors").locator("tr", { hasText: "E2E Aktualizace systémů" });
  await row.getByRole("button", { name: "Spustit teď" }).click();
  await expect(row).toContainText("Splněno");
  await row.getByRole("button", { name: "Historie běhů" }).click();
  await expect(page.getByRole("dialog")).toContainText("aktivních systémů bez podpory výrobce");
  await page.keyboard.press("Escape");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("zpráva o ujištění dodavatele: nová zpráva, CUEC, mezery", async () => {
  const headers = { origin: new URL(page.url()).origin };
  const sup = await (await page.request.post("/api/suppliers", { data: { name: "E2E Cloud s.r.o.", significant: true }, headers })).json();
  await page.goto(`/suppliers/${sup.id}`);
  const card = page.getByTestId("supplier-reports");
  await card.getByRole("button", { name: "Nová zpráva" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Název").fill("SOC 2 Type II E2E");
  await dlg.getByLabel("Období do").fill("2026-06-30");
  await dlg.getByRole("button", { name: "Založit" }).click();
  await expect(page.getByRole("heading", { name: "SOC 2 Type II E2E", level: 1 })).toBeVisible();
  await expect(page.getByTestId("report-gaps")).toContainText("Zpráva není přiložena");
  const cuec = page.getByTestId("report-items-cuec");
  await cuec.getByRole("button", { name: "Přidat" }).click();
  await cuec.getByPlaceholder("Text položky ze zprávy").fill("Zákazník pravidelně přezkoumává účty.");
  await cuec.getByRole("button", { name: "Založit" }).click();
  await expect(cuec).toContainText("Zákazník pravidelně přezkoumává účty.");
  await expect(page.getByTestId("report-gaps")).toContainText("bez vlastního opatření");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("dotazník zákazníka a Trust Center: import, ruční odpověď, veřejná stránka", async () => {
  await page.goto("/trust");
  await expect(page.getByRole("heading", { name: "Dotazníky zákazníků a Trust Center", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Nahrát dotazník" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Zákazník").fill("E2E Zákazník");
  await dlg.locator("input[type=file]").setInputFiles({ name: "q.csv", mimeType: "text/csv", buffer: Buffer.from("ID;Question;Answer\nQ1;Do you perform regular backups?;\nQ2;Is MFA enforced for administrators?;\n") });
  await dlg.getByRole("button", { name: "Náhled" }).click();
  await expect(dlg).toContainText("Nalezeno 2 otázek");
  await dlg.getByRole("button", { name: /Importovat 2 otázek/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Zákazník", level: 1 })).toBeVisible();
  const items = page.getByTestId("qa-items");
  const first = items.locator("li").first();
  await first.getByRole("combobox", { name: "Odpověď" }).selectOption("yes");
  await expect(first).toContainText("Návrh");
  await first.getByRole("button", { name: "Schválit", exact: true }).click();
  await expect(first).toContainText("Schváleno");
  // Trust Center
  await page.goto("/trust?tab=center");
  const tc = page.getByTestId("trust-center");
  await tc.getByLabel("Název stránky").fill("E2E Trust");
  await tc.getByLabel("Adresa stránky").fill("e2e-trust");
  await tc.getByText("Stránka je zveřejněná").click();
  await tc.getByRole("button", { name: "Uložit" }).click();
  await expect(tc.getByRole("link", { name: /\/t\/e2e-trust/ })).toBeVisible();
  await page.goto("/t/e2e-trust?lang=cs");
  await expect(page.getByRole("heading", { name: "E2E Trust", level: 1 })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("vazby záznamů: klikací čip, Kde je záznam použit, vazby produktu CRA", async () => {
  const origin = { origin: new URL(page.url()).origin };
  const asset = await (await page.request.post("/api/assets", { data: { name: "E2E-VAZBY-SRV", assetType: "server" }, headers: origin })).json();
  const ctl = await (await page.request.post("/api/controls", { data: { name: "E2E opatření vazeb", status: "implemented", effectiveness: "effective", assetIds: [asset.id] }, headers: origin })).json();
  const inc = await (await page.request.post("/api/incidents", { data: { title: "E2E incident vazeb", kind: "incident", category: "dos", detectedAt: new Date().toISOString() }, headers: origin })).json();
  await page.request.patch(`/api/incidents/${inc.id}`, { data: { assetIds: [asset.id], controlIds: [ctl.id] }, headers: origin });
  // detail incidentu: navázané opatření je odkaz
  await page.goto(`/incidents/${inc.id}`);
  await page.getByRole("main").getByRole("link", { name: "E2E opatření vazeb" }).first().click();
  await expect(page.getByRole("heading", { name: /E2E opatření vazeb/, level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "Vazby" }).click();
  await expect(page.getByTestId("linked-records")).toContainText("E2E incident vazeb");
  // detail aktiva: zpětné vazby (incident, opatření) – záložka v adrese
  await page.goto(`/assets/${asset.id}?tab=governance`);
  const lr = page.getByTestId("linked-records");
  await expect(lr).toContainText("Incidenty");
  await expect(lr).toContainText("E2E opatření vazeb");
  // produkt CRA: vazba na aktivum → objeví se u aktiva
  const p = await (await page.request.post("/api/cra", { data: { name: "E2E produkt vazeb", role: "manufacturer", category: "default" }, headers: origin })).json();
  await page.goto(`/cra/${p.id}`);
  const card = page.getByTestId("cra-links");
  await card.getByPlaceholder(/Hledat aktivum/).fill("E2E-VAZBY");
  await card.getByRole("button", { name: /E2E-VAZBY-SRV/ }).click();
  await card.getByRole("button", { name: "Uložit" }).click();
  await expect(card.getByRole("link", { name: "E2E-VAZBY-SRV" })).toBeVisible();
  await page.goto(`/assets/${asset.id}?tab=governance`);
  await expect(page.getByTestId("linked-records")).toContainText("E2E produkt vazeb");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("ovládání: Ctrl+K, filtry v adrese, potvrzovací dialog, neuložené změny, mobilní menu", async () => {
  // rychlé hledání: záznam podle názvu i stránka z menu
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Hledat…/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  const pal = page.getByRole("dialog", { name: "Rychlé hledání" });
  await pal.getByRole("combobox").fill("E2E-VAZBY");
  await expect(pal.getByRole("option", { name: /E2E-VAZBY-SRV/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /E2E-VAZBY-SRV/, level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  await pal.getByRole("combobox").fill("dodavat");
  await pal.getByRole("option", { name: "Dodavatelé" }).click();
  await expect(page).toHaveURL(/\/suppliers$/);
  // naposledy otevřené
  await page.keyboard.press("Control+k");
  await expect(pal.getByRole("option", { name: /E2E-VAZBY-SRV/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pal).toBeHidden();
  // filtr rizik v adrese přežije návrat z detailu
  await page.goto("/risks");
  await page.getByPlaceholder(/Hledat/).first().fill("Ransomware");
  await expect(page).toHaveURL(/q=Ransomware/);
  await page.getByRole("link", { name: /Ransomware/ }).first().click();
  await page.goBack();
  await expect(page.getByPlaceholder(/Hledat/).first()).toHaveValue("Ransomware");
  // řazení v adrese (v1.09)
  await page.getByRole("columnheader", { name: /Úroveň/ }).getByRole("button").click();
  await expect(page).toHaveURL(/sort=level%3Adesc|sort=level:desc/);
  // potvrzovací dialog: Esc akci zruší
  await page.removeLocatorHandler(page.getByRole("alertdialog"));
  const sup = await (await page.request.post("/api/suppliers", { data: { name: "E2E smazat dialog" }, headers: { origin: new URL(page.url()).origin } })).json();
  await page.goto(`/suppliers/${sup.id}`);
  await page.getByRole("button", { name: "Smazat" }).first().click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Potvrzení");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("heading", { name: "E2E smazat dialog", level: 1 })).toBeVisible();
  // neuložené změny: odchod se potvrdí, „Zrušit“ ponechá stránku
  await page.getByLabel("Název").first().fill("E2E smazat dialog – upraveno");
  await page.getByRole("navigation").getByRole("link", { name: "Rizika" }).first().click();
  await expect(dlg).toContainText("Neuložené změny");
  await dlg.getByRole("button", { name: "Zrušit" }).click();
  await expect(page).toHaveURL(new RegExp(`/suppliers/${sup.id}`));
  await page.getByRole("navigation").getByRole("link", { name: "Rizika" }).first().click();
  await dlg.getByRole("button", { name: "Odejít bez uložení" }).click();
  await expect(page).toHaveURL(/\/risks$/);
  await page.addLocatorHandler(page.getByRole("alertdialog"), async (d) => {
    await d.getByRole("button").last().click();
  });
  // mobilní menu
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Aktiva" }).first().click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Aktiva" }).first()).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("znalostní báze: nový článek, náhled, zveřejnění, hledání Ctrl+K", async () => {
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "Znalostní báze", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Nový článek" }).click();
  await page.getByLabel("Název").fill("E2E runbook phishing");
  await page.getByLabel("Štítky").fill("SOC, phishing");
  await page.getByLabel("Stav").selectOption("published");
  await page.getByLabel("Obsah").fill("## Postup\nOvěřte odesílatele a **zablokujte** doménu.");
  await expect(page.getByText("zablokujte", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Založit" }).click();
  await expect(page.getByRole("heading", { name: "E2E runbook phishing", level: 1 })).toBeVisible();
  await expect(page.getByText("Zveřejněno")).toBeVisible();
  await page.goto("/knowledge?q=runbook");
  await expect(page.getByRole("link", { name: /E2E runbook phishing/ })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("štítek rámce v záhlaví modulů podle profilu společnosti", async () => {
  for (const path of ["/risks", "/incidents", "/controls"]) {
    await page.goto(path);
    const badge = page.getByTestId("framework-badge");
    if (await badge.count()) await expect(badge.first()).toContainText(/Rámec:|DORA/);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("jazyk ovládání: přepnutí do angličtiny v profilu a zpět", async () => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Legislation" })).toBeVisible();
  await page.goto("/legislation");
  await expect(page.getByRole("heading", { name: "Legislation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add regulation" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/profile");
  await page.getByRole("button", { name: /Výchozí jazyk organizace|Organization default/ }).click();
  await expect(page.getByRole("heading", { name: "Můj profil" })).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

// náhledy vzhledu (v1.08) – jen na vyžádání: E2E_SHOTS=adresář
test("náhledy vzhledu (světlý a tmavý režim)", async () => {
  test.skip(!process.env.E2E_SHOTS, "jen s E2E_SHOTS");
  const dir = process.env.E2E_SHOTS!;
  const risk = (await (await page.request.get("/api/risks?limit=1")).json()).items[0];
  const asset = (await (await page.request.get("/api/assets?limit=1&offset=0")).json()).items[0];
  const ctl = (await (await page.request.get("/api/controls")).json())[0];
  const pages: [string, string][] = [["dashboard", "/"], ["risks", "/risks"], ["risk", `/risks/${risk.id}`], ["asset", `/assets/${asset.id}`], ["control", `/controls/${ctl.id}`], ["knowledge", "/knowledge"], ["soc", "/soc"], ["admin", "/admin/users"]];
  for (const mode of ["light", "dark"]) {
    await page.evaluate((m) => localStorage.setItem("contix.mode", m), mode);
    for (const [name, url] of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/${mode}-${name}.png`, fullPage: false });
    }
  }
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Hledat…/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Rychlé hledání" }).getByRole("combobox").fill("ri");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/dark-palette.png` });
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.setItem("contix.mode", "light"));
});

test("odhlášení", async () => {
  await page.getByRole("button", { name: "Odhlásit" }).click();
  await expect(page.locator("input[type=email]")).toBeVisible();
});
