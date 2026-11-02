import { askConfirm } from "@/components/ui/overlay";
/** Plánované hledání hrozeb (ADR-059): knihovna dotazů, vlastní dotazy do Wazuh Indexeru, zkušební běh, plán. */
import { MitreBadges, SeverityBadge } from "@/components/soc";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { SOC_HUNT_GROUP_FIELDS, SOC_HUNT_LABELS, SOC_LABELS, SOC_SEVERITIES, type SocHuntDto, type SocHuntInput, type SocHuntRun, type SocHuntTemplate } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FlaskConical, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Draft = Required<Omit<SocHuntInput, "companyId" | "templateKey">> & { templateKey: string | null };
const empty: Draft = { name: "", hypothesis: "", query: "", groupBy: "agent.id", threshold: 1, intervalHours: 24, lookbackHours: 24, severity: "medium", mitreIds: [], enabled: true, templateKey: null };
const fromTemplate = (x: SocHuntTemplate): Draft => ({ ...empty, ...x, templateKey: x.key, lookbackHours: Math.max(24, x.intervalHours) });

export function HuntsTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "hunts"], queryFn: api.soc.hunts });
  const tpl = useQuery({ queryKey: ["soc", "hunt-templates"], queryFn: api.soc.huntTemplates });
  const [edit, setEdit] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [result, setResult] = useState<{ name: string; run: SocHuntRun } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["soc", "hunts"] });
  const run = useMutation({
    mutationFn: (d: { h: SocHuntDto; dryRun: boolean }) => api.soc.runHunt(d.h.id, d.dryRun),
    onSuccess: (r, d) => {
      refresh();
      if (!d.dryRun) qc.invalidateQueries({ queryKey: ["soc", "alerts"] });
      setResult({ name: d.h.name, run: r.run });
    },
  });
  const toggle = useMutation({ mutationFn: (h: SocHuntDto) => api.soc.updateHunt(h.id, { enabled: !h.enabled }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.soc.deleteHunt, onSuccess: refresh });
  const w = can("soc:write");
  const used = new Set((q.data ?? []).map((h) => h.templateKey).filter(Boolean));
  return (
    <>
      <Card className="mb-6 overflow-hidden" data-testid="soc-hunts">
        <CardHeader
          title={t("soc.hunt.title")}
          subtitle={t("soc.hunt.subtitle")}
          action={
            w && (
              <Button onClick={() => setEdit({ id: null, draft: empty })}>
                <Plus size={15} /> {t("soc.hunt.new")}
              </Button>
            )
          }
        />
        <ErrorBox error={q.error ?? run.error ?? toggle.error ?? remove.error} />
        {q.data?.length === 0 ? (
          <EmptyState>{t("soc.hunt.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t("soc.hunt.col.name")}</th>
                  <th className="px-3 py-2">{t("soc.hunt.col.schedule")}</th>
                  <th className="px-3 py-2">{t("soc.hunt.col.last")}</th>
                  <th className="px-3 py-2 text-right">{t("soc.hunt.col.open")}</th>
                  <th className="w-56 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data?.map((h) => (
                  <tr key={h.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{h.name}</span>
                        <SeverityBadge s={h.severity} />
                        {!h.enabled && <Badge tone="slate">{t("soc.src.disabled")}</Badge>}
                      </div>
                      <code className="mt-1 block break-all text-xs text-slate-600">{h.query}</code>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {t("soc.hunt.groupInfo", { field: t.lbl(SOC_HUNT_LABELS.groupBy[h.groupBy] ?? h.groupBy), n: h.threshold })}
                        <MitreBadges ids={h.mitreIds} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {t("soc.hunt.every", { n: h.intervalHours })}
                      {h.nextRunAt && <div className="text-slate-400">{t("soc.hunt.next", { at: new Date(h.nextRunAt).getTime() <= 0 ? t("soc.hunt.asap") : fmtDate(h.nextRunAt) })}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {h.lastRun ? (
                        <>
                          {fmtDate(h.lastRun.at)} · {t("soc.hunt.lastInfo", { total: h.lastRun.total, groups: h.lastRun.buckets.length, alerts: h.lastRun.alerts })}
                          {h.lastRun.error && <div className="text-amber-800">{h.lastRun.error}</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {h.openAlerts > 0 ? (
                        <Link to="/soc" search={{ q: `Hledání hrozeb: ${h.name}` } as never} className="font-medium text-red-700 hover:underline">
                          {h.openAlerts}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {w && (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={run.isPending} onClick={() => run.mutate({ h, dryRun: true })} title={t("soc.hunt.testHint")}>
                            <FlaskConical size={13} /> {t("soc.hunt.test")}
                          </Button>
                          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={run.isPending} onClick={() => run.mutate({ h, dryRun: false })}>
                            <Play size={13} /> {t("soc.hunt.run")}
                          </Button>
                          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEdit({ id: h.id, draft: { ...h } })} aria-label={t("soc.hunt.edit", { name: h.name })}>
                            <Pencil size={13} />
                          </Button>
                          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => toggle.mutate(h)}>
                            {h.enabled ? t("soc.hunt.disable") : t("soc.hunt.enable")}
                          </Button>
                          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={async () => (await askConfirm(t("soc.hunt.confirmDelete"))) && remove.mutate(h.id)} aria-label={t("soc.hunt.delete", { name: h.name })}>
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">{t("soc.hunt.privacy")}</p>
      </Card>

      {w && (
        <Card className="mb-6 overflow-hidden">
          <CardHeader title={t("soc.hunt.library")} subtitle={t("soc.hunt.librarySub")} />
          <ul className="divide-y divide-slate-100">
            {tpl.data?.map((x) => (
              <li key={x.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.lbl(x.name)}</span>
                    <SeverityBadge s={x.severity} />
                    <MitreBadges ids={x.mitreIds} />
                  </div>
                  <div className="text-xs text-slate-500">{t.lbl(x.hypothesis)}</div>
                </div>
                <Button variant="secondary" className="px-2 py-1 text-xs" disabled={used.has(x.key)} onClick={() => setEdit({ id: null, draft: fromTemplate(x) })}>
                  {used.has(x.key) ? t("soc.hunt.added") : t("soc.hunt.use")}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {edit && <HuntModal id={edit.id} initial={edit.draft} onClose={() => setEdit(null)} onSaved={() => (refresh(), setEdit(null))} />}
      {result && <RunModal name={result.name} run={result.run} onClose={() => setResult(null)} />}
    </>
  );
}

function HuntModal({ id, initial, onClose, onSaved }: { id: string | null; initial: Draft; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [d, setD] = useState<Draft>(initial);
  const [mitre, setMitre] = useState(initial.mitreIds.join(", "));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const m = useMutation({
    mutationFn: () => {
      const body = { ...d, mitreIds: mitre.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) };
      return id ? api.soc.updateHunt(id, body) : api.soc.createHunt(body);
    },
    onSuccess: onSaved,
  });
  const known = (SOC_HUNT_GROUP_FIELDS as readonly string[]).includes(d.groupBy);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={id ? t("soc.hunt.editTitle") : t("soc.hunt.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || d.name.trim().length < 3 || d.query.trim().length < 3}>
            {t("soc.save")}
          </Button>
        </>
      }
    >
      <Field label={t("soc.hunt.f.name")}>
        <Input value={d.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label={t("soc.hunt.f.hypothesis")}>
        <Textarea rows={2} value={d.hypothesis} onChange={(e) => set("hypothesis", e.target.value)} />
      </Field>
      <Field label={t("soc.hunt.f.query")} hint={t("soc.hunt.f.queryHint")}>
        <Textarea rows={3} className="font-mono text-xs" value={d.query} onChange={(e) => set("query", e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("soc.hunt.f.groupBy")}>
          <Select value={known ? d.groupBy : "__custom"} onChange={(e) => set("groupBy", e.target.value === "__custom" ? "" : e.target.value)}>
            {SOC_HUNT_GROUP_FIELDS.map((f) => (
              <option key={f} value={f}>
                {t.lbl(SOC_HUNT_LABELS.groupBy[f] ?? f)} ({f})
              </option>
            ))}
            <option value="__custom">{t("soc.hunt.f.customField")}</option>
          </Select>
          {!known && <Input className="mt-1 font-mono text-xs" value={d.groupBy} placeholder="data.win.eventdata.image" aria-label={t("soc.hunt.f.customField")} onChange={(e) => set("groupBy", e.target.value)} />}
        </Field>
        <Field label={t("soc.hunt.f.threshold")}>
          <Input type="number" min={1} value={d.threshold} onChange={(e) => set("threshold", Number(e.target.value))} />
        </Field>
        <Field label={t("soc.hunt.f.severity")}>
          <Select value={d.severity} onChange={(e) => set("severity", e.target.value as Draft["severity"])}>
            {SOC_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(SOC_LABELS.severity[s])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("soc.hunt.f.interval")}>
          <Input type="number" min={1} max={168} value={d.intervalHours} onChange={(e) => set("intervalHours", Number(e.target.value))} />
        </Field>
        <Field label={t("soc.hunt.f.lookback")}>
          <Input type="number" min={1} max={720} value={d.lookbackHours} onChange={(e) => set("lookbackHours", Number(e.target.value))} />
        </Field>
        <Field label={t("soc.hunt.f.mitre")}>
          <Input value={mitre} placeholder="T1110, T1059.001" onChange={(e) => setMitre(e.target.value)} />
        </Field>
      </div>
      <Checkbox checked={d.enabled} onChange={(v) => set("enabled", v)} label={t("soc.hunt.f.enabled")} />
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function RunModal({ name, run, onClose }: { name: string; run: SocHuntRun; onClose: () => void }) {
  const t = useT();
  return (
    <Modal open wide onClose={onClose} title={run.dryRun ? t("soc.hunt.testTitle", { name }) : t("soc.hunt.runTitle", { name })}>
      <div data-testid="soc-hunt-result" className="space-y-3 text-sm">
        <p className="text-slate-600">
          {t("soc.hunt.window", { since: fmtDate(run.since), until: fmtDate(run.until) })} · {t("soc.hunt.lastInfo", { total: run.total, groups: run.buckets.length, alerts: run.alerts })}
        </p>
        {run.dryRun && <p className="text-xs text-slate-500">{t("soc.hunt.testNote")}</p>}
        <ErrorBox error={run.error ? new Error(run.error) : null} />
        {run.buckets.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">{t("soc.hunt.col.value")}</th>
                <th className="px-3 py-2">{t("soc.hunt.col.host")}</th>
                <th className="px-3 py-2 text-right">{t("soc.hunt.col.count")}</th>
                <th className="px-3 py-2">{t("soc.hunt.col.lastSeen")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {run.buckets.map((b) => (
                <tr key={b.key}>
                  <td className="px-3 py-2 font-mono text-xs">{b.key}</td>
                  <td className="px-3 py-2 text-xs">{b.agentName ?? b.agentId ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.count}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{b.last ? fmtDate(b.last) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
