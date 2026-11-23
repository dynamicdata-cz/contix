import { Card, CardHeader, ErrorBox, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate, fmtDay } from "@/lib/utils";
import { DEADLINE_BASIS_LABELS, FINDING_LABELS, DEADLINE_BASES, type CalendarItemDto, type DeadlineBasis, type UnifiedFindingDto } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Download } from "lucide-react";
import { useMemo, useState } from "react";

/* ============================================================
 * Kalendář zákonných lhůt s exportem do kalendáře (.ics) a karta „Tento týden“ na Přehledu (v1.98, ADR-192).
 * ============================================================ */

const BASIS_CLS: Record<DeadlineBasis, string> = {
  zkb: "bg-red-50 text-red-800 ring-red-200",
  measures: "bg-brand-50 text-brand-800 ring-brand-200",
  gdpr: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  aiact: "bg-violet-50 text-violet-800 ring-violet-200",
  cra: "bg-amber-50 text-amber-900 ring-amber-200",
  internal: "bg-slate-50 text-slate-700 ring-slate-200",
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function BasisTag({ b }: { b: DeadlineBasis }) {
  const t = useT();
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", BASIS_CLS[b])}>{t.lbl(DEADLINE_BASIS_LABELS[b])}</span>;
}

function DueText({ i }: { i: CalendarItemDto }) {
  const d = i.due.length > 10 ? fmtDate(i.due) : fmtDay(i.due);
  return <span className={cn("whitespace-nowrap text-sm tabular-nums", i.urgency === "overdue" ? "font-semibold text-red-700" : i.urgency === "today" ? "font-semibold text-amber-700" : "text-slate-600")}>{d}</span>;
}

export function CalendarPage() {
  const t = useT();
  const [months, setMonths] = useState(12);
  const [legal, setLegal] = useState(true);
  const [basis, setBasis] = useState<DeadlineBasis | "">("");
  const from = today();
  const to = plusDays(from, Math.round(months * 30.5));
  const q = useQuery({ queryKey: ["calendar", from, to, legal], queryFn: () => api.calendar.list({ from, to, legal: legal ? "1" : "0" }) });
  const items = (q.data?.items ?? []).filter((i) => !basis || i.basis === basis);
  const overdue = items.filter((i) => i.urgency === "overdue");
  const groups = useMemo(() => {
    const m = new Map<string, CalendarItemDto[]>();
    for (const i of items) if (i.urgency !== "overdue") (m.get(i.due.slice(0, 7)) ?? m.set(i.due.slice(0, 7), []).get(i.due.slice(0, 7))!).push(i);
    return [...m.entries()];
  }, [items]);
  const monthName = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString(t.locale, { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        title={t("cal.title")}
        subtitle={t("cal.sub")}
        actions={
          <a href={api.calendar.icsUrl({ from, to, legal: legal ? "1" : "0" })} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50" data-testid="cal-ics">
            <Download size={16} /> {t("cal.ics")}
          </a>
        }
      />
      <ErrorBox error={q.error} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={legal} onChange={(e) => setLegal(e.target.checked)} data-testid="cal-legal" /> {t("cal.onlyLegal")}
        </label>
        <select className="rounded-md border border-slate-300 bg-white px-2 py-1.5" value={basis} onChange={(e) => setBasis(e.target.value as DeadlineBasis | "")} aria-label={t("cal.basis")}>
          <option value="">{t("cal.allBases")}</option>
          {DEADLINE_BASES.filter((b) => !legal || b !== "internal").map((b) => (
            <option key={b} value={b}>
              {t.lbl(DEADLINE_BASIS_LABELS[b])}
            </option>
          ))}
        </select>
        <select className="rounded-md border border-slate-300 bg-white px-2 py-1.5" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label={t("cal.period")}>
          {[3, 6, 12, 24].map((m) => (
            <option key={m} value={m}>
              {t("cal.months", { n: m })}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{t("cal.icsHint")}</span>
      </div>

      {q.data && !items.length && (
        <Card className="p-6 text-sm text-slate-600" data-testid="cal-empty">
          {t("cal.empty")}
        </Card>
      )}
      {overdue.length > 0 && (
        <Card className="mb-6 overflow-hidden border-red-200" data-testid="cal-overdue">
          <CardHeader title={t("cal.overdue", { n: overdue.length })} />
          <ItemList items={overdue} />
        </Card>
      )}
      <div className="space-y-6">
        {groups.map(([ym, list]) => (
          <Card key={ym} className="overflow-hidden" data-testid="cal-month">
            <CardHeader title={monthName(ym)} subtitle={t("cal.count", { n: list.length })} />
            <ItemList items={list} />
          </Card>
        ))}
      </div>
    </>
  );
}

function ItemList({ items, compact }: { items: CalendarItemDto[]; compact?: boolean }) {
  const t = useT();
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((i) => (
        <li key={i.key} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", compact ? "px-4 py-2" : "px-5 py-3")} data-testid="cal-item">
          <DueText i={i} />
          <Link to={i.link} className="min-w-0 flex-1 font-medium text-slate-900 hover:text-brand-700 hover:underline">
            {i.title}
          </Link>
          {!compact && <BasisTag b={i.basis} />}
          {!compact && (i.detail || i.ownerName) && <p className="w-full text-xs text-slate-500">{[i.detail, i.ownerName && t("cal.owner", { name: i.ownerName })].filter(Boolean).join(" · ")}</p>}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Přehled: „Co mám udělat tento týden“ ---------- */

export function WeekCard({ className }: { className?: string }) {
  const t = useT();
  const can = useCan();
  const from = today();
  const to = plusDays(from, 7);
  const cal = useQuery({ queryKey: ["calendar", "week", from], queryFn: () => api.calendar.list({ from, to, legal: "1" }), staleTime: 5 * 60_000 });
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setup.get, enabled: can("admin:settings"), staleTime: 5 * 60_000 });
  const crit = useQuery({ queryKey: ["findings", "week", "critical"], queryFn: () => api.findings.list({ severity: "critical", limit: 50 }), staleTime: 5 * 60_000 });
  const high = useQuery({ queryKey: ["findings", "week", "high"], queryFn: () => api.findings.list({ severity: "high", limit: 50 }), staleTime: 5 * 60_000 });

  const steps = (setup.data?.steps ?? []).filter((s) => !s.optional && (s.status === "todo" || s.status === "partial"));
  const deadlines = cal.data?.items ?? [];
  // kritické nálezy vždy, vysoké jen po termínu nebo s termínem do týdne
  const findings: UnifiedFindingDto[] = [...(crit.data?.items ?? []), ...(high.data?.items ?? []).filter((f) => f.dueDate && f.dueDate <= to)].sort((a, b) => b.priority - a.priority);
  if (!cal.data && !crit.data && !setup.data) return null;
  const total = steps.length + deadlines.length + findings.length;

  return (
    <Card className={cn("overflow-hidden", className)} data-testid="week-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
        <CalendarDays size={18} className="text-brand-600" />
        <h2 className="text-base font-semibold text-slate-900">{t("week.title")}</h2>
        <span className="text-sm text-slate-500">{total ? t("week.sub", { n: total }) : t("week.none")}</span>
        <Link to="/calendar" className="ml-auto text-sm text-brand-600 hover:underline">
          {t("week.toCalendar")}
        </Link>
      </div>
      {total > 0 && (
        <div className="grid divide-y divide-slate-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <WeekCol title={t("week.deadlines")} n={deadlines.length} empty={t("week.noDeadlines")} testid="week-deadlines">
            <ItemList items={deadlines.slice(0, 5)} compact />
          </WeekCol>
          <WeekCol title={t("week.findings")} n={findings.length} empty={t("week.noFindings")} testid="week-findings" more={findings.length > 5 ? { to: "/findings", label: t("dash.more", { n: findings.length - 5 }) } : undefined}>
            <ul className="divide-y divide-slate-100">
              {findings.slice(0, 5).map((f) => (
                <li key={f.key} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <span className={cn("rounded px-1.5 text-[11px] font-semibold uppercase", f.severity === "critical" ? "bg-red-600 text-white" : "bg-orange-100 text-orange-800")}>{t.lbl(FINDING_LABELS.severity[f.severity])}</span>
                  <Link to={f.link} className="min-w-0 flex-1 truncate text-slate-900 hover:text-brand-700 hover:underline" title={f.title}>
                    {f.title}
                  </Link>
                  {f.dueDate && <span className={cn("whitespace-nowrap text-xs tabular-nums", f.dueDate < from ? "font-semibold text-red-700" : "text-slate-500")}>{fmtDay(f.dueDate)}</span>}
                </li>
              ))}
            </ul>
          </WeekCol>
          {can("admin:settings") ? (
            <WeekCol title={t("week.setup")} n={steps.length} empty={t("week.noSetup")} testid="week-setup">
              <ul className="divide-y divide-slate-100">
                {steps.slice(0, 5).map((s) => (
                  <li key={s.key} className="px-4 py-2 text-sm">
                    <Link to={s.link} className="text-slate-900 hover:text-brand-700 hover:underline">
                      {s.title}
                    </Link>
                    {s.detail[0] && <p className="truncate text-xs text-slate-500">{s.detail[0]}</p>}
                  </li>
                ))}
              </ul>
            </WeekCol>
          ) : (
            <div />
          )}
        </div>
      )}
    </Card>
  );
}

function WeekCol({ title, n, empty, children, testid, more }: { title: string; n: number; empty: string; children: React.ReactNode; testid: string; more?: { to: string; label: string } }) {
  return (
    <div data-testid={testid}>
      <h3 className="flex items-center gap-2 px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} {n > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-slate-700">{n}</span>}
      </h3>
      {n ? children : <p className="px-4 py-3 text-sm text-slate-500">{empty}</p>}
      {more && (
        <Link to={more.to} className="block px-4 pb-3 text-xs text-brand-700 hover:underline">
          {more.label}
        </Link>
      )}
    </div>
  );
}


