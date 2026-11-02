/**
 * Výjimky a přijatá rizika (v0.43, ADR-039): jednotný přehled výjimek napříč moduly – nálezy identit, SoD,
 * zranitelnosti, přijatá rizika a neaplikovaná ustanovení; platnost, odůvodnění, kdo udělil, kompenzační opatření (v1.11).
 */
import { FrameworkBadge } from "@/components/frameworkBadge";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { IdMultiSelect } from "@/components/pickers";
import { useModule } from "@/lib/auth";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import { EXCEPTION_KINDS, EXCEPTION_LABELS, EXCEPTION_STATES, type ExceptionDto, type ExceptionKind, type ExceptionState } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { AlarmClock, CalendarX2, Download, Pencil, ShieldCheck, ShieldOff } from "lucide-react";
import { useMemo, useState } from "react";

const stateTone: Record<ExceptionState, Tone> = { expired: "red", expiring: "amber", valid: "green", no_expiry: "slate" };
const sevTone: Record<string, Tone> = { critical: "red", high: "red", medium: "amber", low: "slate" };

export function ExceptionsPage() {
  const t = useT();
  const router = useRouter();
  const q = useQuery({ queryKey: ["exceptions"], queryFn: api.exceptions.list });
  const [kind, setKind] = useState<"" | ExceptionKind>("");
  const [state, setState] = useState<"" | ExceptionState>("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ExceptionDto | null>(null);
  const mod = useModule();
  const kindLabel = (k: ExceptionKind) => t.dyn(`enum.exception.kind.${k}`, EXCEPTION_LABELS.kind[k]);
  const stateLabel = (s: ExceptionState) => t.dyn(`enum.exception.state.${s}`, EXCEPTION_LABELS.state[s]);
  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.items ?? []).filter(
      (e) => (!kind || e.kind === kind) && (!state || e.state === state) && (!s || `${e.title} ${e.detail ?? ""} ${e.reason ?? ""} ${e.acceptedByName ?? ""}`.toLowerCase().includes(s)),
    );
  }, [q.data, kind, state, search]);
  const sm = q.data?.summary;
  const kinds = q.data?.kinds ?? [];

  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("exc.title")}
        subtitle={t("exc.subtitle")}
        actions={
          <a href={api.exceptions.exportUrl()} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
            <Download size={15} /> CSV
          </a>
        }
      />
      <ErrorBox error={q.error} />
      {sm && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={<CalendarX2 size={16} />} label={stateLabel("expired")} value={sm.byState.expired} note={t("exc.kpi.expiredNote")} tone={sm.byState.expired ? "red" : "slate"} onClick={() => setState("expired")} />
          <Kpi icon={<AlarmClock size={16} />} label={stateLabel("expiring")} value={sm.byState.expiring} note={t("exc.kpi.expiringNote")} tone={sm.byState.expiring ? "amber" : "slate"} onClick={() => setState("expiring")} />
          <Kpi icon={<ShieldCheck size={16} />} label={stateLabel("valid")} value={sm.byState.valid} note={t("exc.kpi.validNote")} onClick={() => setState("valid")} />
          <Kpi icon={<ShieldOff size={16} />} label={stateLabel("no_expiry")} value={sm.byState.no_expiry} note={t("exc.kpi.noExpiryNote")} onClick={() => setState("no_expiry")} />
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Select className="w-64" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t("exc.filter.kind")}>
            <option value="">{t("exc.filter.allKinds")}</option>
            {EXCEPTION_KINDS.filter((k) => kinds.includes(k)).map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)} ({sm?.byKind[k] ?? 0})
              </option>
            ))}
          </Select>
          <Select className="w-48" value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label={t("exc.filter.state")}>
            <option value="">{t("exc.filter.allStates")}</option>
            {EXCEPTION_STATES.map((s) => (
              <option key={s} value={s}>
                {stateLabel(s)}
              </option>
            ))}
          </Select>
          <Input className="max-w-xs" placeholder={t("exc.filter.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="ml-auto text-xs text-slate-500">{t("exc.filter.count", { n: items.length, total: sm?.total ?? 0 })}</span>
        </div>
        {!q.data ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>{sm?.total ? t("exc.emptyFilter") : t("exc.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-2">{t("exc.col.subject")}</th>
                  <th scope="col" className="w-72 px-3 py-2">{t("exc.col.reason")}</th>
                  <th scope="col" className="w-56 px-3 py-2">{t("exc.col.compensating")}</th>
                  <th scope="col" className="w-40 px-3 py-2">{t("exc.col.by")}</th>
                  <th scope="col" className="w-40 px-3 py-2">{t("exc.col.until")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((e) => (
                  <tr key={e.key} className={cn("align-top", e.state === "expired" && "bg-red-50/40")}>
                    <td className="px-5 py-2.5">
                      <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span>{kindLabel(e.kind)}</span>
                        {e.severity && <Badge tone={sevTone[e.severity] ?? "slate"}>{t.dyn(`enum.exception.severity.${e.severity}`, e.severity)}</Badge>}
                      </div>
                      <a href={e.link} onClick={(ev) => (ev.preventDefault(), router.history.push(e.link))} className="font-medium hover:text-brand-700">
                        {e.title}
                      </a>
                      {e.detail && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{e.detail}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-700">
                      {e.reason ? <div className="line-clamp-3" title={e.reason}>{e.reason}</div> : <span className="text-red-700">{t("exc.noReason")}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-1">
                        {e.compensating.map((x) => (
                          <Link key={x.id} to="/controls/$controlId" params={{ controlId: x.id }}>
                            <Badge tone="green">{x.code ?? x.name}</Badge>
                          </Link>
                        ))}
                        {!e.compensating.length && <span className="text-slate-400">{t("exc.comp.none")}</span>}
                        {e.canEdit && mod("controls") && (
                          <button type="button" className="rounded p-0.5 text-slate-400 hover:text-brand-700" aria-label={`${t("exc.comp.edit")}: ${e.title}`} onClick={() => setEditing(e)}>
                            <Pencil size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{e.acceptedByName ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={stateTone[e.state]}>{stateLabel(e.state)}</Badge>
                      {e.until && <div className="mt-0.5 text-xs text-slate-600">{t("exc.until", { date: fmtDay(e.until) })}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-2 text-xs text-slate-500">{t("exc.footnote")}</p>
      {editing && <CompensatingModal e={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const kpiTone = { slate: "text-slate-500", amber: "text-amber-700", red: "text-red-700", green: "text-emerald-700" } as const;
function Kpi({ icon, label, value, note, tone = "slate", onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; note: string; tone?: keyof typeof kpiTone; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon} {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className={cn("mt-0.5 text-xs", kpiTone[tone])}>{note}</div>
    </button>
  );
}


function CompensatingModal({ e, onClose }: { e: ExceptionDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }) });
  const [ids, setIds] = useState(e.compensating.map((x) => x.id));
  const [note, setNote] = useState(e.compensatingNote ?? "");
  const label = (x: { code?: string | null; name: string }) => (x.code ? `${x.code} ${x.name}` : x.name);
  const save = useMutation({
    mutationFn: () => api.exceptions.setControls(e.kind, e.id, { controlIds: ids, note: note.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exceptions"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      toast(t("exc.comp.saved"));
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("exc.comp.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("ui.confirm.cancel")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("aud.ulozit")}
          </Button>
        </>
      }
    >
      <p className="text-sm font-medium text-slate-800">{e.title}</p>
      <p className="text-sm text-slate-600">{t("exc.comp.hint")}</p>
      <Field label={t("exc.comp.title")}>
        <IdMultiSelect linkKind="control" value={ids} onChange={setIds} options={(controls.data ?? []).filter((x) => x.companyId === e.companyId).map((x) => ({ id: x.id, label: label(x) }))} known={e.compensating.map((x) => ({ id: x.id, label: label(x) }))} />
      </Field>
      <Field label={t("exc.comp.note")}>
        <Textarea rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
