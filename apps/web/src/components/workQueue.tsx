/**
 * Fronta práce (v1.37, ADR-134): povinnosti uživatele seskupené podle naléhavosti (po termínu → dnes → brzy → později),
 * filtry, akce přímo v řádku (schválit / zamítnout / hotovo) a ovládání klávesnicí (J/K, Enter, A).
 * Akci vždy znovu ověří server; když nejde provést z fronty (např. SoD vyžaduje zdůvodnění), otevře se detail.
 */
import { CompanyCell } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { Button, EmptyState, Field, Modal, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtDate, fmtDay } from "@/lib/utils";
import { OBLIGATION_LABELS, type ObligationAction, type ObligationItem, type ObligationKind, type ObligationUrgency } from "@contix/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, CheckCircle2, ChevronRight, X } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

const ORDER: ObligationUrgency[] = ["overdue", "today", "soon", "later"];
const stripe: Record<ObligationUrgency, string> = { overdue: "bg-red-600", today: "bg-amber-500", soon: "bg-blue-500", later: "bg-slate-300" };
const APPROVALS = new Set<ObligationKind>(["access_approval", "project_change", "project_gate", "doc_approval", "access_certification"]);
const LEARN = new Set<ObligationKind>(["policy_ack", "training"]);

export type QueueFilter = "all" | "approve" | "overdue" | "week" | "learn";

const dayDiff = (due: string) => Math.round((Date.parse(due.slice(0, 10)) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000);

export function filterQueue(items: ObligationItem[], f: QueueFilter) {
  if (f === "approve") return items.filter((i) => APPROVALS.has(i.kind));
  if (f === "overdue") return items.filter((i) => i.urgency === "overdue");
  if (f === "week") return items.filter((i) => i.urgency !== "later" && (!i.due || dayDiff(i.due) <= 7));
  if (f === "learn") return items.filter((i) => LEARN.has(i.kind));
  return items;
}

/** Relativní termín: „před 3 dny“, „dnes“, „za 5 dní“. */
function useRelDue() {
  const t = useT();
  return (due: string | null) => {
    if (!due) return t("wq.noDue");
    const d = dayDiff(due);
    if (d === 0) return t("wq.today");
    return d < 0 ? t("wq.ago", { n: -d }) : t("wq.in", { n: d });
  };
}

export function WorkQueue({ items, showCompany, limit, compact, filter = "all" }: { items: ObligationItem[]; showCompany: boolean; limit?: number; compact?: boolean; filter?: QueueFilter }) {
  const t = useT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const rel = useRelDue();
  const box = useRef<HTMLDivElement>(null);
  const [showLater, setShowLater] = useState(false);
  const [reject, setReject] = useState<{ item: ObligationItem; action: ObligationAction } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async ({ action, decision, comment }: { item: ObligationItem; action: ObligationAction; decision: "approved" | "rejected" | "done"; comment?: string }) => {
      if (action.type === "access_decide") return api.access.decide(action.requestId, decision === "rejected" ? "rejected" : "approved", comment);
      if (action.type === "project_change") return api.projects.decideChange(action.projectId, action.changeId, decision === "rejected" ? "rejected" : "approved", comment);
      if (action.type === "project_task_done") return api.projects.updateTask(action.projectId, action.taskId, { status: "done" });
      return api.actions.update(action.taskId, { status: "done" });
    },
    onMutate: (v) => setBusy(v.item.key),
    onSettled: () => setBusy(null),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["obligations"] });
      qc.invalidateQueries({ queryKey: ["access"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast(v.decision === "done" ? t("wq.doneToast") : v.decision === "approved" ? t("wq.approvedToast") : t("wq.rejectedToast"));
      setReject(null);
      setReason("");
    },
    onError: (e, v) => {
      // nejde z fronty (např. SoD vyžaduje zdůvodnění, už rozhodnuto) – otevřít detail
      toast(`${(e as Error).message} ${t("wq.openingDetail")}`, "error");
      nav({ to: v.item.link as never });
    },
  });
  const sorted = useMemo(() => {
    const list = filterQueue(items, filter);
    return ORDER.flatMap((u) => list.filter((i) => i.urgency === u).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9")));
  }, [items, filter]);
  const visible = limit ? sorted.slice(0, limit) : sorted.filter((i) => showLater || i.urgency !== "later");
  const hiddenLater = !limit && !showLater ? sorted.filter((i) => i.urgency === "later").length : 0;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input,textarea,select")) return;
    const rows = [...(box.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    const i = rows.indexOf((e.target as HTMLElement).closest("[data-row]") as HTMLElement);
    if (e.key === "j" || e.key === "ArrowDown") rows[Math.min(rows.length - 1, i + 1)]?.focus();
    else if (e.key === "k" || e.key === "ArrowUp") rows[Math.max(0, i - 1)]?.focus();
    else if (e.key === "a" && i >= 0) rows[i]?.querySelector<HTMLButtonElement>("[data-primary]")?.click();
    else if (e.key === "Enter" && i >= 0 && e.target === rows[i]) rows[i]?.querySelector<HTMLAnchorElement>("[data-open]")?.click();
    else return;
    e.preventDefault();
  };
  if (!sorted.length)
    return (
      <EmptyState>
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 size={16} color={STATUS_COLORS.good} /> {filter === "all" ? t("obl.none") : t("wq.noneFilter")}
        </span>
      </EmptyState>
    );
  let lastGroup: ObligationUrgency | null = null;
  return (
    <div ref={box} onKeyDown={onKey} data-testid="work-queue">
      {visible.map((i, idx) => {
        const head = !compact && i.urgency !== lastGroup;
        lastGroup = i.urgency;
        const a = i.action ?? null;
        const decide = a && (a.type === "access_decide" || a.type === "project_change");
        return (
          <div key={i.key}>
            {head && <div className={cn("px-5 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider", i.urgency === "overdue" ? "text-red-700" : "text-slate-500")}>{t(`wq.group.${i.urgency}`)}</div>}
            <div
              data-row
              tabIndex={0}
              className={cn("group flex items-center gap-3 border-b border-slate-100 py-2.5 pl-3 pr-4 outline-none focus-visible:bg-brand-50 hover:bg-slate-50", idx === 0 && compact && "border-t-0")}
              aria-label={i.title}
            >
              <span className={cn("w-1 self-stretch rounded-full", stripe[i.urgency])} aria-hidden />
              <Link to={i.link as never} data-open className="min-w-0 flex-1 focus-visible:outline-none" tabIndex={-1}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800 group-hover:text-brand-800">{i.title}</span>
                  {i.escalation && (
                    <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200" title={t("wq.esc.hint")} data-testid="wq-escalation">
                      {t("wq.esc.badge", { level: i.escalation.level, days: i.escalation.daysOverdue })}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {t.dyn(`enum.obligation.${i.kind}`, OBLIGATION_LABELS[i.kind])}
                  {i.detail ? ` · ${i.detail}` : ""}
                  {i.ownerName ? ` · ${i.ownerName}` : ""}
                </div>
                {showCompany && <CompanyCell id={i.companyId} />}
              </Link>
              <span className={cn("hidden shrink-0 whitespace-nowrap text-xs tabular-nums sm:inline", i.urgency === "overdue" ? "font-semibold text-red-700" : "text-slate-500")} title={i.due ? (i.due.length > 10 ? fmtDate(i.due) : fmtDay(i.due)) : undefined}>
                {rel(i.due)}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                {decide && (
                  <>
                    <Button variant="ghost" className="px-2 py-1 text-xs text-red-700" disabled={busy === i.key} onClick={() => setReject({ item: i, action: a })} aria-label={`${t("wq.reject")}: ${i.title}`}>
                      <X size={14} /> <span className="hidden md:inline">{t("wq.reject")}</span>
                    </Button>
                    <Button data-primary className="px-2.5 py-1 text-xs" disabled={busy === i.key} onClick={() => run.mutate({ item: i, action: a, decision: "approved" })} aria-label={`${t("wq.approve")}: ${i.title}`}>
                      <Check size={14} /> {t("wq.approve")}
                    </Button>
                  </>
                )}
                {a && (a.type === "task_done" || a.type === "project_task_done") && (
                  <Button data-primary variant="secondary" className="px-2.5 py-1 text-xs" disabled={busy === i.key} onClick={() => run.mutate({ item: i, action: a, decision: "done" })} aria-label={`${t("wq.done")}: ${i.title}`}>
                    <Check size={14} /> {t("wq.done")}
                  </Button>
                )}
                {!a && (
                  <Link data-primary to={i.link as never} className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50" tabIndex={-1}>
                    {t("wq.open")} <ChevronRight size={14} />
                  </Link>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {hiddenLater > 0 && (
        <button type="button" className="block w-full px-5 py-2.5 text-left text-sm text-brand-700 hover:bg-slate-50" onClick={() => setShowLater(true)}>
          {t("wq.showLater", { n: hiddenLater })}
        </button>
      )}
      {reject && (
        <Modal
          open
          onClose={() => setReject(null)}
          title={t("wq.rejectTitle")}
          footer={
            <Button variant="danger" disabled={reason.trim().length < 3 || run.isPending} onClick={() => run.mutate({ item: reject.item, action: reject.action, decision: "rejected", comment: reason.trim() })}>
              <X size={16} /> {t("wq.reject")}
            </Button>
          }
        >
          <p className="mb-3 text-sm text-slate-700">{reject.item.title}</p>
          <Field label={t("wq.reason")}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  );
}

/** Filtry fronty s počty. */
export function QueueFilters({ items, value, onChange }: { items: ObligationItem[]; value: QueueFilter; onChange: (f: QueueFilter) => void }) {
  const t = useT();
  const opts: QueueFilter[] = ["all", "approve", "overdue", "week", "learn"];
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("wq.filters")}>
      {opts.map((f) => {
        const n = filterQueue(items, f).length;
        if (f !== "all" && !n) return null;
        return (
          <button
            key={f}
            type="button"
            aria-pressed={value === f}
            onClick={() => onChange(f)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium transition", value === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
          >
            {t(`wq.f.${f}`)} <span className={cn("tabular-nums", value === f ? "text-white/80" : "text-slate-500")}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}
