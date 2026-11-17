/**
 * Cesta k souladu (v1.42, ADR-139): stav průvodců všech zapnutých modulů na jednom místě – postup, další krok
 * a počet kroků k vyřízení; vše z dat (`GET /api/guides`).
 */
import { useSwitchCompany } from "@/components/company";
import { stepStatus, useGuideText } from "@/components/processGuide";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Facts, Modal, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { STARTER_ITEMS, type StarterItem } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ClipboardCheck, Download, PackagePlus, Upload } from "lucide-react";

export function CompliancePathPage() {
  const t = useT();
  const gt = useGuideText();
  const q = useQuery({ queryKey: ["guides"], queryFn: api.guides.list });
  const me = useMe();
  const can = useCan();
  const [starter, setStarter] = useState(false);
  const [importing, setImporting] = useState(false);
  const many = me.companies.length > 1;
  const group = useQuery({ queryKey: ["guides", "group"], queryFn: api.guides.group, enabled: many });
  const d = q.data;
  // nejdřív moduly s nejmenším postupem
  const list = [...(d?.guides ?? [])].sort((a, b) => Number(!a.next) - Number(!b.next) || a.progress - b.progress);
  return (
    <>
      <PageHeader
        title={t("gd.page.title")}
        subtitle={t("gd.page.subtitle")}
        more={
          can("policies:write", "controls:write", "isms:write")
            ? [
                { label: t("gd.starter.title"), icon: <PackagePlus size={16} />, onClick: () => setStarter(true) },
                "separator",
                { label: t("gd.cfg.export"), icon: <Download size={16} />, href: api.guides.configExportUrl() },
                { label: t("gd.cfg.import"), icon: <Upload size={16} />, onClick: () => setImporting(true) },
              ]
            : undefined
        }
        actions={
          can("controls:read") && (
            <Link to="/compliance-path/audit" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <ClipboardCheck size={16} /> {t("gd.audit.title")}
            </Link>
          )
        }
      />
      <ErrorBox error={q.error} />
      {importing && <ImportConfig onClose={() => setImporting(false)} />}
      {starter && (
        <Modal open onClose={() => setStarter(false)} title={t("gd.starter.title")}>
          <Starter />
        </Modal>
      )}
      {!d ? (
        <Card>
          <EmptyState>{t("common.loading")}</EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-4xl font-semibold tabular-nums text-slate-900">{d.summary.progress} %</div>
              <div className="min-w-48 flex-1">
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.summary.progress}%` }} />
                </div>
                <p className="mt-1.5 text-sm text-slate-600">{t("gd.page.summary", { d: d.summary.done, n: d.summary.todo })}</p>
              </div>
            </div>
          </Card>
          {d.onboarding.phases.length > 0 && <Onboarding ob={d.onboarding} />}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="compliance-path">
            {list.map((g) => {
              const next = g.steps.find((s) => s.key === g.next);
              return (
                <Card key={g.id} className="flex flex-col" data-testid={`path-${g.id}`}>
                  <div className="flex items-center gap-2 px-5 pt-4">
                    <Link to={g.path as never} className="min-w-0 flex-1 truncate font-semibold text-slate-900 hover:text-brand-700">
                      {gt.title(g.id)}
                    </Link>
                    <span className="text-sm font-semibold tabular-nums text-slate-700">{g.progress} %</span>
                  </div>
                  <div className="mx-5 mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <div className={cn("h-full rounded-full", g.progress === 100 ? "bg-emerald-500" : "bg-brand-500")} style={{ width: `${g.progress}%` }} />
                  </div>
                  <ol className="flex flex-wrap gap-1 px-5 pt-3" aria-label={gt.title(g.id)}>
                    {g.steps.map((s, i) => (
                      <li key={s.key} title={`${gt.step(g.id, s.key)} – ${stepStatus(t, gt, g, s)}`}>
                        <span className={cn("grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold", s.state === "done" ? "bg-emerald-100 text-emerald-700" : s.key === g.next ? "bg-brand-600 text-white" : s.state === "waiting" ? "bg-slate-50 text-slate-300" : "bg-amber-50 text-amber-800")}>
                          {s.state === "done" ? <Check size={12} /> : i + 1}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-auto px-5 pb-4 pt-3">
                    {next ? (
                      <Link to={next.path as never} className="group block rounded-lg border border-slate-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/50">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("gd.page.next")}</span>
                        <span className="flex items-center gap-1 text-sm font-medium text-slate-900 group-hover:text-brand-800">
                          {gt.step(g.id, next.key)} <ArrowRight size={14} className="text-slate-400" />
                        </span>
                        <span className="block text-xs text-amber-800">{stepStatus(t, gt, g, next)}</span>
                      </Link>
                    ) : (
                      <Badge tone="green">{t("gd.allDone")}</Badge>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          {many && (group.data?.length ?? 0) > 1 && <GroupTable rows={group.data!} />}
          {!list.length && (
            <Card>
              <EmptyState>{t("gd.page.none")}</EmptyState>
            </Card>
          )}
        </>
      )}
    </>
  );
}

/** Přehled skupiny: postup každé společnosti celkem a po oblastech (klik = přepnout na společnost). */
function GroupTable({ rows }: { rows: import("@contix/shared").GroupGuideRow[] }) {
  const t = useT();
  const gt = useGuideText();
  const switchTo = useSwitchCompany();
  const ids = [...new Set(rows.flatMap((r) => Object.keys(r.guides)))];
  const tone = (p: number | undefined) => (p == null ? "text-slate-300" : p === 100 ? "text-emerald-700" : p >= 50 ? "text-slate-800" : "text-amber-800");
  return (
    <Card className="mt-4 overflow-hidden" data-testid="compliance-group">
      <div className="px-5 pb-2 pt-4">
        <h2 className="font-semibold text-slate-900">{t("gd.group.title")}</h2>
        <p className="text-sm text-slate-500">{t("gd.group.subtitle")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-2 font-semibold uppercase tracking-wide">{t("gd.group.company")}</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide">{t("gd.group.total")}</th>
              {ids.map((id) => (
                <th key={id} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  {gt.title(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.companyId}>
                <td className="px-5 py-2">
                  <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => switchTo(r.companyId)}>
                    {r.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.summary.progress} %</td>
                {ids.map((id) => {
                  const g = r.guides[id];
                  return (
                    <td key={id} className={cn("px-3 py-2 text-right tabular-nums", tone(g?.progress))} title={g?.next ? `${t("gd.page.next")}: ${gt.step(id, g.next)}` : undefined}>
                      {g ? `${g.progress} %` : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Úvodní cesta: doporučené pořadí zavádění po fázích (v1.45, ADR-142). */
function Onboarding({ ob }: { ob: { phase: string | null; phases: { key: string; progress: number; guides: string[] }[] } }) {
  const t = useT();
  const can = useCan();
  const gt = useGuideText();
  return (
    <Card className="mb-4 p-5" data-testid="onboarding">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="font-semibold text-slate-900">{t("gd.ob.title")}</h2>
        <span className="text-sm text-slate-500">{ob.phase ? t("gd.ob.current", { p: t(`gd.ob.phase.${ob.phase as "foundation"}`) }) : t("gd.ob.done")}</span>
        <Link to="/admin/setup" className="ml-auto text-xs text-brand-700 hover:underline">
          {t("gd.ob.setup")}
        </Link>
      </div>
      {can("policies:write", "controls:write", "isms:write") && ob.phase === "foundation" && <Starter />}
      <ol className="grid gap-2 md:grid-cols-5">
        {ob.phases.map((p, i) => {
          const cur = p.key === ob.phase;
          return (
            <li key={p.key} className={cn("rounded-lg border px-3 py-2", cur ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200", p.progress === 100 && "bg-emerald-50/50")}>
              <div className="flex items-center gap-2">
                <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold", p.progress === 100 ? "bg-emerald-100 text-emerald-700" : cur ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600")}>{p.progress === 100 ? <Check size={12} /> : i + 1}</span>
                <span className="text-sm font-medium text-slate-900">{t(`gd.ob.phase.${p.key as "foundation"}`)}</span>
                <span className="ml-auto text-xs tabular-nums text-slate-500">{p.progress} %</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{p.guides.map((g) => gt.title(g)).join(" · ")}</div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** Startovací balíček (v1.46, ADR-143): výchozí podklady pro novou společnost – jen co ještě chybí. */
function Starter() {
  const t = useT();
  const qc = useQueryClient();
  const [sel, setSel] = useState<StarterItem[]>([...STARTER_ITEMS]);
  const run = useMutation({
    mutationFn: () => api.guides.starter(sel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guides"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
      qc.invalidateQueries({ queryKey: ["controls"] });
    },
  });
  return (
    <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3" data-testid="starter">
      <div className="mb-1 text-sm font-medium text-slate-900">{t("gd.starter.title")}</div>
      <p className="mb-2 text-xs text-slate-600">{t("gd.starter.hint")}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {STARTER_ITEMS.map((i) => (
          <Checkbox key={i} checked={sel.includes(i)} onChange={(v) => setSel(v ? [...sel, i] : sel.filter((x) => x !== i))} label={t(`gd.starter.item.${i}`)} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button className="px-2.5 py-1 text-xs" disabled={!sel.length || run.isPending} onClick={() => run.mutate()}>
          {t("gd.starter.run")}
        </Button>
        {run.data?.map((r) => (
          <Badge key={r.item} tone={r.status === "created" ? "green" : r.status === "exists" ? "slate" : r.status === "skipped" ? "amber" : "red"}>
            {t(`gd.starter.item.${r.item}`)}: {t(`gd.starter.status.${r.status}`)}
          </Badge>
        ))}
      </div>
      <ErrorBox error={run.error} />
    </div>
  );
}

/** Import nastavení průvodců z jiné instalace (garanti podle názvu místa, profil hrozeb) – v1.47, ADR-144. */
function ImportConfig({ onClose }: { onClose: () => void }) {
  const t = useT();
  const gt = useGuideText();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async (f: File) => api.guides.importConfig(JSON.parse(await f.text())),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guides"] }),
  });
  return (
    <Modal open onClose={onClose} title={t("gd.cfg.import")}>
      <p className="mb-3 text-sm text-slate-600">{t("gd.cfg.importHint")}</p>
      <input
        type="file"
        accept="application/json,.json"
        aria-label={t("gd.cfg.file")}
        className="block w-full text-sm"
        onChange={(e) => {
          const f = e.target.files?.[0];
          setErr(null);
          if (f) run.mutate(f, { onError: (x) => setErr(x instanceof SyntaxError ? t("gd.cfg.badFile") : (x as Error).message) });
        }}
      />
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {run.data && (
        <div className="mt-3 space-y-1 text-sm" data-testid="import-result">
          {run.data.owners.map((o) => (
            <div key={o.guide} className="flex items-center gap-2">
              <Badge tone={o.status === "applied" ? "green" : "amber"}>{t(`gd.cfg.status.${o.status}`)}</Badge>
              <span>
                {gt.title(o.guide)} – {o.position}
              </span>
            </div>
          ))}
          <div className="text-xs text-slate-500">{t(`gd.cfg.threat.${run.data.threatProfile}`)}</div>
        </div>
      )}
    </Modal>
  );
}
