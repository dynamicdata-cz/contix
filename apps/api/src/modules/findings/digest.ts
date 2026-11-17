import { CS_T } from "../i18n/service";
import { sql } from "drizzle-orm";
import type { FindingEscalationDto, QualityGap, Translate } from "@contix/shared";
import type { Db } from "../../db/client";

/* ============================================================
 * Týdenní souhrn nálezů pro garanty aktiv (v1.69, ADR-162): technický garant, zástupce, a když aktivum garanta
 * nemá, business vlastník – otevřené nálezy testů a serverů na jeho aktivech a úkoly z nich po termínu.
 * Jen počty a názvy aktiv; bez podrobností nálezů (ty jsou v aplikaci).
 * ============================================================ */

export interface GuarantorDigestRow {
  userId: string;
  assets: { id: string; name: string; critical: number; high: number; medium: number; overdue: number }[];
}

export async function guarantorFindings(db: Db): Promise<GuarantorDigestRow[]> {
  const rows = (await db.execute<{ user_id: string; asset_id: string; name: string; critical: number; high: number; medium: number; overdue: number }>(sql`
    with f as (
      select asset_id, severity, id, 'sectest_finding' as kind from sec_test_findings where status = 'open' and asset_id is not null
      union all
      select asset_id, severity, id, 'host_finding' from host_findings where status = 'open' and asset_id is not null
    ),
    agg as (
      select f.asset_id,
        count(*) filter (where f.severity = 'critical')::int as critical,
        count(*) filter (where f.severity = 'high')::int as high,
        count(*) filter (where f.severity = 'medium')::int as medium,
        count(*) filter (where exists (select 1 from tasks t where t.source_kind = f.kind and t.source_id = f.id and t.status in ('open', 'in_progress') and t.due_date < current_date))::int as overdue
      from f group by f.asset_id
    ),
    resp as (
      select id as asset_id, technical_owner_user_id as user_id from assets where technical_owner_user_id is not null
      union select id, technical_deputy_user_id from assets where technical_deputy_user_id is not null
      union select id, owner_user_id from assets where owner_user_id is not null and technical_owner_user_id is null and technical_deputy_user_id is null
    )
    select r.user_id::text, a.id::text as asset_id, a.name, g.critical, g.high, g.medium, g.overdue
    from agg g join assets a on a.id = g.asset_id join resp r on r.asset_id = a.id join users u on u.id = r.user_id
    where u.is_active and (g.critical + g.high + g.medium) > 0
    order by r.user_id, g.critical desc, g.high desc, a.name`)) as unknown as { user_id: string; asset_id: string; name: string; critical: number; high: number; medium: number; overdue: number }[];
  const out = new Map<string, GuarantorDigestRow>();
  for (const r of rows) {
    const u = out.get(r.user_id) ?? { userId: r.user_id, assets: [] };
    u.assets.push({ id: r.asset_id, name: r.name, critical: Number(r.critical), high: Number(r.high), medium: Number(r.medium), overdue: Number(r.overdue) });
    out.set(r.user_id, u);
  }
  return [...out.values()];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Týdenní souhrn (v1.71, ADR-164): nálezy na aktivech garanta, eskalace nálezů po termínu na vedoucího
 * a chybějící údaje, za které osoba odpovídá. Oddíly bez obsahu se vynechají.
 */
export interface WeeklyDigestRow extends GuarantorDigestRow {
  escalated: FindingEscalationDto[];
  gaps: QualityGap[];
}

const GAP_KEY = { asset_unrated: "srv.mail.gap.asset_unrated", asset_no_tech: "srv.mail.gap.asset_no_tech", task_unassigned: "srv.mail.gap.task_unassigned" } as const;

export function renderGuarantorDigest(row: WeeklyDigestRow, appUrl: string, t: Translate = CS_T) {
  const tot = row.assets.reduce((a, x) => ({ c: a.c + x.critical, h: a.h + x.high, m: a.m + x.medium, o: a.o + x.overdue }), { c: 0, h: 0, m: 0, o: 0 });
  const subject = row.assets.length
    ? t("srv.mail.findingsSubject", { n: tot.c + tot.h + tot.m })
    : row.escalated.length
      ? t("srv.mail.escSubject", { n: row.escalated.length })
      : t("srv.mail.gapsSubject", { n: row.gaps.length });
  const link = (href: string, label: string) => `<a href="${esc(`${appUrl}${href}`)}" style="color:#1d4ed8;text-decoration:none">${esc(label)}</a>`;
  const escHtml = row.escalated.length
    ? `<h3 style="margin:24px 0 4px">${esc(t("srv.mail.escTitle"))}</h3><p style="color:#64748b;margin:0 0 8px">${esc(t("srv.mail.escIntro"))}</p>
<table cellpadding="6" style="border-collapse:collapse;width:100%"><tr style="color:#64748b;text-align:left"><th>${esc(t("srv.mail.findingsAsset"))}</th><th>${esc(t("srv.mail.escGuarantor"))}</th><th>${esc(t("srv.mail.escOverdue"))}</th><th>${esc(t("srv.mail.escDays"))}</th></tr>
${row.escalated.map((e) => `<tr style="border-top:1px solid #e2e8f0"><td>${link(`/assets/${e.assetId}?tab=tasks`, e.assetName)}</td><td>${esc(e.guarantorName ?? "—")}</td><td style="color:#b91c1c">${e.overdue}</td><td>${e.daysOverdue}</td></tr>`).join("")}</table>
<p style="margin-top:8px">${link("/findings?who=team", t("srv.mail.escOpen"))}</p>`
    : "";
  const gapHtml = row.gaps.length
    ? `<h3 style="margin:24px 0 4px">${esc(t("srv.mail.gapsTitle"))}</h3><p style="color:#64748b;margin:0 0 8px">${esc(t("srv.mail.gapsIntro"))}</p><ul style="margin:0;padding-left:18px">${row.gaps
        .map((g) => `<li>${link(g.link, g.label)} – <span style="color:#64748b">${esc(t(GAP_KEY[g.kind]))}</span></li>`)
        .join("")}</ul><p style="margin-top:8px">${link("/quality", t("srv.mail.gapsOpen"))}</p>`
    : "";
  const findingsHtml = row.assets.length
    ? `<h2 style="margin:0 0 4px">${esc(t("srv.mail.findingsTitle"))}</h2>
<p style="color:#64748b;margin:0 0 16px">${esc(t("srv.mail.findingsIntro", { critical: tot.c, high: tot.h, medium: tot.m, overdue: tot.o }))}</p>
<table cellpadding="6" style="border-collapse:collapse;width:100%"><tr style="color:#64748b;text-align:left"><th>${esc(t("srv.mail.findingsAsset"))}</th><th>${esc(t("srv.mail.findingsCrit"))}</th><th>${esc(t("srv.mail.findingsHigh"))}</th><th>${esc(t("srv.mail.findingsMed"))}</th><th>${esc(t("srv.mail.findingsOverdue"))}</th></tr>
${row.assets
  .map(
    (a) =>
      `<tr style="border-top:1px solid #e2e8f0"><td><a href="${esc(`${appUrl}/assets/${a.id}?tab=tasks`)}" style="color:#1d4ed8;text-decoration:none">${esc(a.name)}</a></td><td style="color:${a.critical ? "#b91c1c" : "#64748b"}">${a.critical}</td><td style="color:${a.high ? "#c2410c" : "#64748b"}">${a.high}</td><td>${a.medium}</td><td style="color:${a.overdue ? "#b91c1c" : "#64748b"}">${a.overdue}</td></tr>`,
  )
  .join("")}</table>
<p style="margin-top:16px"><a href="${esc(`${appUrl}/findings?who=mine`)}" style="color:#1d4ed8">${esc(t("srv.mail.findingsOpen"))}</a></p>`
    : "";
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1e293b">${findingsHtml}${escHtml}${gapHtml}</div>`;
  const text = [
    ...(row.assets.length
      ? [t("srv.mail.findingsTitle"), t("srv.mail.findingsIntro", { critical: tot.c, high: tot.h, medium: tot.m, overdue: tot.o }), "", ...row.assets.map((a) => `${a.name}: ${a.critical}/${a.high}/${a.medium} (${a.overdue})`), "", `${appUrl}/findings?who=mine`, ""]
      : []),
    ...(row.escalated.length ? [t("srv.mail.escTitle"), ...row.escalated.map((e) => `${e.assetName} (${e.guarantorName ?? "—"}): ${e.overdue}, ${e.daysOverdue} d`), `${appUrl}/findings?who=team`, ""] : []),
    ...(row.gaps.length ? [t("srv.mail.gapsTitle"), ...row.gaps.map((g) => `${g.label} – ${t(GAP_KEY[g.kind])}`), `${appUrl}/quality`] : []),
  ].join("\n");
  return { subject, html, text };
}
