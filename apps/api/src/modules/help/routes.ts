import { CONTIX_VERSION, HELP_AUDIENCE_LABELS, HELP_AUDIENCES, HELP_TOPICS, helpToHtml, localizeTopic, type HelpAudience, type Translate } from "@contix/shared";
import { tFor } from "../i18n/service";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requirePerm } from "../../auth/middleware";
import { getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html, printPage } from "../documents/render";

/* Uživatelská příručka ke stažení – skládá se z témat nápovědy (shared/help.ts) podle rolí. */

const Query = z.object({
  audience: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((x): x is HelpAudience => (HELP_AUDIENCES as readonly string[]).includes(x)) : [...HELP_AUDIENCES])),
});

export function helpRoutes(db: Db) {
  /** Příručka v jazyce uživatele – přeložená témata z jazykového balíčku, ostatní česky (ADR-036). */
  async function manual(audience: HelpAudience[], t: Translate) {
    const s = await getSettings(db);
    const topics = HELP_TOPICS.filter((x) => x.audience.some((a) => audience.includes(a)) && (!x.module || s.enabledModules.includes(x.module))).map((x) => localizeTopic(t, x));
    const e = html.esc;
    const title = t("manual.title");
    const body = `
<h1>${e(title)}</h1>
<p class="muted">${e(s.organizationName)} · ${e(t("manual.version", { v: CONTIX_VERSION }))} · ${e(t("manual.forRoles"))} ${audience.map((a) => e(t.dyn(`enum.helpAudience.${a}`, HELP_AUDIENCE_LABELS[a]))).join(", ")}</p>
<h2>${e(t("manual.contents"))}</h2>
<ol>${topics.map((x) => `<li>${e(x.title)} – ${e(x.summary)}</li>`).join("")}</ol>
${topics.map((x, i) => `<h2>${i + 1}. ${e(x.title)}</h2>\n${helpToHtml(x.body)}`).join("\n")}`;
    return { html: printPage(title, body, t.locale), org: s.organizationName, title };
  }
  const ANY = ["obligations:self", "policies:read", "assets:read", "risks:read", "admin:settings"] as const;
  return new Hono<AppEnv>()
    .get("/manual.html", requirePerm(...ANY), zValidator("query", Query), async (c) => c.html((await manual(c.req.valid("query").audience, await tFor(db, c))).html, 200, { "cache-control": "private, no-store" }))
    .get("/manual.docx", requirePerm(...ANY), zValidator("query", Query), async (c) => {
      const r = await manual(c.req.valid("query").audience, await tFor(db, c));
      return docxResponse(await htmlToDocx(r.html, { title: r.title, headerLine: r.org }), `${r.title}.docx`);
    });
}
