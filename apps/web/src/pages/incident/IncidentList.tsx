/** Seznam událostí a incidentů (ADR-075): filtry, řazení kliknutím na sloupec, seskupení, uložené pohledy. */
import { CompanyCell } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { GroupRow, GroupSelect, SavedViews, SortTh } from "@/components/listTools";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { INCIDENT_CATEGORIES, INCIDENT_KINDS, INCIDENT_LABELS, INCIDENT_STATUSES, groupRows, sortRows, type IncidentListItem, type SortState } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { DeadlineChip, kindTone, statusTone } from "../Incidents";

type SortKey = "title" | "kind" | "status" | "detectedAt" | "deadline" | "owner";
type GroupKey = "category" | "status" | "kind" | "owner" | "asset" | "cause" | "month";
interface State extends Record<string, unknown> {
  q: string;
  view: "open" | "all" | "incidents" | "reportable";
  kind: string;
  status: string;
  category: string;
  owner: string;
  asset: string;
  significant: boolean;
  from: string;
  to: string;
  sort: SortState<SortKey> | null;
  group: GroupKey | "";
}
const DEFAULT: State = { q: "", view: "open", kind: "", status: "", category: "", owner: "", asset: "", significant: false, from: "", to: "", sort: null, group: "" };

/** Uložený pohled se slučuje s výchozím stavem (starší pohled bez nového pole nezpůsobí chybu). */
const fromSaved = (s: Record<string, unknown>): State => ({ ...DEFAULT, ...(s as Partial<State>) });

export function IncidentList({ group: groupView }: { group: boolean }) {
  const t = useT();
  const [s, setS] = useState<State>(DEFAULT);
  const set = (p: Partial<State>) => setS((x) => ({ ...x, ...p }));
  const list = useQuery({
    queryKey: ["incidents", s.q, s.view, s.from, s.to],
    queryFn: () => api.incidents.list({ q: s.q || undefined, view: s.view, from: s.from || undefined, to: s.to || undefined }),
    refetchInterval: 60_000,
  });
  const all = list.data ?? [];
  const owners = useMemo(() => [...new Set(all.map((r) => r.ownerPositionName).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "cs")), [all]);
  const assetsList = useMemo(() => [...new Set(all.flatMap((r) => r.assetNames))].sort((a, b) => a.localeCompare(b, "cs")), [all]);
  const rows = useMemo(() => {
    const f = all.filter(
      (r) =>
        (!s.kind || r.kind === s.kind) &&
        (!s.status || r.status === s.status) &&
        (!s.category || r.category === s.category) &&
        (!s.owner || (s.owner === "-" ? !r.ownerPositionName : r.ownerPositionName === s.owner)) &&
        (!s.asset || r.assetNames.includes(s.asset)) &&
        (!s.significant || r.significant),
    );
    if (!s.sort) return f;
    const val: Record<SortKey, (r: IncidentListItem) => string | number | null> = {
      title: (r) => `${r.code ?? ""} ${r.title}`,
      kind: (r) => INCIDENT_KINDS.indexOf(r.kind),
      status: (r) => INCIDENT_STATUSES.indexOf(r.status),
      detectedAt: (r) => r.detectedAt,
      deadline: (r) => r.nextDeadline?.due ?? null,
      owner: (r) => r.ownerPositionName,
    };
    return sortRows(f, val[s.sort.key], s.sort.dir);
  }, [all, s]);
  const groupLabel = (r: IncidentListItem): string => {
    switch (s.group) {
      case "category":
        return t.lbl(INCIDENT_LABELS.category[r.category]);
      case "status":
        return t.lbl(INCIDENT_LABELS.status[r.status]);
      case "kind":
        return t.lbl(INCIDENT_LABELS.kind[r.kind]);
      case "owner":
        return r.ownerPositionName ?? t("list.none");
      case "asset":
        return r.assetNames[0] ?? t("list.none");
      case "cause":
        return t.lbl(INCIDENT_LABELS.cause[r.cause]);
      case "month":
        return r.detectedAt.slice(0, 7);
      default:
        return "";
    }
  };
  const groups = s.group ? groupRows(rows, groupLabel, s.group === "month" ? "first" : "count") : [{ key: "", rows }];
  const overdue = all.filter((r) => r.overdueReports).length;
  const filtered = s.kind || s.status || s.category || s.owner || s.asset || s.significant || s.from || s.to || s.q || s.view !== "open";
  const cols = 6;
  return (
    <>
      <ErrorBox error={list.error} />
      {overdue > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <AlertTriangle size={15} color={STATUS_COLORS.critical} /> {overdue} {overdue === 1 ? t("inc.incidentMa") : t("inc.incidentyMaji")} {t("inc.lhutuHlaseniPoTerminu")}
        </div>
      )}
      <Card className="mb-4 space-y-3 p-4" data-testid="incident-filters">
        <div className="flex flex-wrap items-center gap-3">
          <Input className="max-w-xs" placeholder={t("inc.hledatNazevNeboKod")} value={s.q} onChange={(e) => set({ q: e.target.value })} aria-label={t("inc.hledatNazevNeboKod")} />
          <Select className="w-56" value={s.view} onChange={(e) => set({ view: e.target.value as State["view"] })} aria-label={t("inc.stav")}>
            <option value="open">{t("inc.neuzavrene")}</option>
            <option value="incidents">{t("inc.jenIncidenty")}</option>
            <option value="reportable">{t("inc.podlehajiciHlaseni")}</option>
            <option value="all">{t("common.all")}</option>
          </Select>
          <GroupSelect
            value={s.group}
            onChange={(group) => set({ group })}
            options={[
              { key: "category", label: t("inc.f.category") },
              { key: "status", label: t("inc.stav") },
              { key: "kind", label: t("inc.klasifikace") },
              { key: "owner", label: t("inc.odpovednost") },
              { key: "asset", label: t("inc.f.asset") },
              { key: "cause", label: t("inc.f.cause") },
              { key: "month", label: t("inc.f.month") },
            ]}
          />
          <div className="ml-auto">
            <SavedViews page="incidents" state={s} onApply={(v) => setS(fromSaved(v))} onReset={() => setS(DEFAULT)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select className="w-40" value={s.kind} onChange={(e) => set({ kind: e.target.value })} aria-label={t("inc.klasifikace")}>
            <option value="">{t("inc.f.anyKind")}</option>
            {INCIDENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(INCIDENT_LABELS.kind[k])}
              </option>
            ))}
          </Select>
          <Select className="w-40" value={s.status} onChange={(e) => set({ status: e.target.value })} aria-label={t("inc.f.status")}>
            <option value="">{t("inc.f.anyStatus")}</option>
            {INCIDENT_STATUSES.map((k) => (
              <option key={k} value={k}>
                {t.lbl(INCIDENT_LABELS.status[k])}
              </option>
            ))}
          </Select>
          <Select className="w-52" value={s.category} onChange={(e) => set({ category: e.target.value })} aria-label={t("inc.f.category")}>
            <option value="">{t("inc.f.anyCategory")}</option>
            {INCIDENT_CATEGORIES.map((k) => (
              <option key={k} value={k}>
                {t.lbl(INCIDENT_LABELS.category[k])}
              </option>
            ))}
          </Select>
          <Select className="w-48" value={s.owner} onChange={(e) => set({ owner: e.target.value })} aria-label={t("inc.odpovednost")}>
            <option value="">{t("inc.f.anyOwner")}</option>
            <option value="-">{t("list.none")}</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
          {assetsList.length > 0 && (
            <Select className="w-48" value={s.asset} onChange={(e) => set({ asset: e.target.value })} aria-label={t("inc.f.asset")}>
              <option value="">{t("inc.f.anyAsset")}</option>
              {assetsList.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          )}
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            {t("list.from")} <Input type="date" className="w-40" value={s.from} onChange={(e) => set({ from: e.target.value })} aria-label={t("list.from")} />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            {t("list.to")} <Input type="date" className="w-40" value={s.to} onChange={(e) => set({ to: e.target.value })} aria-label={t("list.to")} />
          </label>
          <Checkbox checked={s.significant} onChange={(v) => set({ significant: v })} label={t("inc.vyznamnyDopad")} />
          {filtered && (
            <Button variant="ghost" onClick={() => setS({ ...DEFAULT, sort: s.sort, group: s.group })}>
              <X size={14} /> {t("list.reset")}
            </Button>
          )}
          <span className="ml-auto text-xs text-slate-500">{t("inc.f.count", { n: rows.length, all: all.length })}</span>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState>{t("inc.zadneZaznamy")}</EmptyState>
        ) : (
          <table className="w-full text-sm" data-testid="incident-table">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <SortTh k="title" label={t("inc.udalostIncident")} sort={s.sort} onSort={(sort) => set({ sort })} className="pl-5" />
                <SortTh k="kind" label={t("inc.klasifikace")} sort={s.sort} onSort={(sort) => set({ sort })} />
                <SortTh k="status" label={t("inc.stav")} sort={s.sort} onSort={(sort) => set({ sort })} />
                <SortTh k="detectedAt" label={t("inc.zjisteno")} sort={s.sort} onSort={(sort) => set({ sort })} firstDir="desc" />
                <SortTh k="deadline" label={t("inc.hlaseni")} sort={s.sort} onSort={(sort) => set({ sort })} />
                <SortTh k="owner" label={t("inc.odpovednost")} sort={s.sort} onSort={(sort) => set({ sort })} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {s.group && <GroupRow label={g.key} count={g.rows.length} colSpan={cols} />}
                  {g.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-5 py-2.5">
                        <Link to="/incidents/$incidentId" params={{ incidentId: r.id }} className="font-medium hover:text-brand-700">
                          {r.code && <span className="mr-1.5 text-slate-500">{r.code}</span>}
                          {r.title}
                        </Link>
                        {groupView && (
                          <div>
                            <CompanyCell id={r.companyId} />
                          </div>
                        )}
                        <div className="text-xs text-slate-500">
                          {t.lbl(INCIDENT_LABELS.category[r.category])}
                          {r.assetNames.length > 0 && ` · ${r.assetNames.join(", ")}${r.assetCount > r.assetNames.length ? " …" : ""}`}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={kindTone[r.kind]}>{t.lbl(INCIDENT_LABELS.kind[r.kind])}</Badge>
                        {r.significant && (
                          <div className="mt-0.5">
                            <Badge tone="red">{t("inc.vyznamnyDopad")}</Badge>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={statusTone[r.status]}>{t.lbl(INCIDENT_LABELS.status[r.status])}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmtDate(r.detectedAt)}</td>
                      <td className="px-3 py-2.5">
                        {r.reportable || r.personalDataBreach ? (
                          r.nextDeadline ? (
                            <DeadlineChip d={r.nextDeadline} />
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                              <CheckCircle2 size={12} /> {t("inc.splneno")}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-slate-400">{t("inc.nepodleha")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{r.ownerPositionName ?? "—"}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
