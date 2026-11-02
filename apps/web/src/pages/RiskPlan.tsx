import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT, lbl } from "@/lib/i18n";
import { DocumentVersions } from "@/components/documents";
import { Button, Card, EmptyState, ErrorBox, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { ACTION_LABELS, ACTION_STATUSES, RISK_LABELS, type TreatmentActionDto } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { ActionModal, actionToForm, ActionTable, fmtCzk } from "./risk/TreatmentPlan";

function exportCsv(rows: TreatmentActionDto[]) {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const head = ["Riziko", "Úroveň", "Opatření", "Cíle a přínosy", "Odpovědnost", "Lidské zdroje", "Finanční zdroje", "Technické zdroje", "Náklady (Kč)", "Termín", "Stav", "Vazba na opatření", "Způsob realizace"];
  const lines = rows.map((a) =>
    [
      `${a.riskCode ?? ""} ${a.riskName}`.trim(),
      a.riskLevel ? lbl(RISK_LABELS.level[a.riskLevel]) : "",
      a.title,
      a.objective,
      a.ownerPositionName,
      a.resourcesHuman,
      a.resourcesFinancial,
      a.resourcesTechnical,
      a.costEstimate,
      a.dueDate,
      lbl(ACTION_LABELS[a.status]),
      a.controlName ? `${a.controlCode ?? ""} ${a.controlName}`.trim() : "",
      a.realization,
    ]
      .map(cell)
      .join(";"),
  );
  const blob = new Blob([`﻿${head.map((h) => cell(lbl(h))).join(";")}\n${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: "plan-zvladani-rizik.csv" }).click();
  URL.revokeObjectURL(url);
}

export function RiskPlanPage() {
  const t = useT();
  const can = useCan();
  const [status, setStatus] = useState("");
  const plan = useQuery({ queryKey: ["risks", "plan", status], queryFn: () => api.risks.plan({ status }) });
  const [form, setForm] = useState<ReturnType<typeof actionToForm> | null>(null);
  const rows = plan.data ?? [];
  const open = rows.filter((a) => a.status === "planned" || a.status === "in_progress");
  const cost = open.reduce((s, a) => s + (a.costEstimate ?? 0), 0);

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/risks" className="hover:text-brand-700">
          {t("rsk.rizika")}
        </Link>
      </div>
      <PageHeader badge={<FrameworkBadge />}
        title={t("rsk.planZvladaniRizik")}
        subtitle={t("rsk.8Odst1PismG2")}
        actions={
          <Button variant="secondary" disabled={!rows.length} onClick={() => exportCsv(rows)}>
            <Download size={16} /> {t("rsk.csv")}
          </Button>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Kpi label={t("rsk.otevrenychAkci")} value={open.length} />
        <Kpi label={t("rsk.poTerminu")} value={rows.filter((a) => a.overdue).length} warn />
        <Kpi label={t("rsk.dokonceno")} value={rows.filter((a) => a.status === "done").length} />
        <Kpi label={t("rsk.nakladyOtevrenychAkci")} value={fmtCzk(cost)} />
      </div>
      <Card className="overflow-hidden">
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("rsk.vsechnyStavy")}</option>
            {ACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(ACTION_LABELS[s])}
              </option>
            ))}
          </Select>
        </div>
        <ErrorBox error={plan.error} />
        {rows.length === 0 ? (
          <EmptyState>{t("rsk.planJePrazdnyAkceSe")}</EmptyState>
        ) : (
          <ActionTable actions={rows} showRisk onEdit={can("risks:write") ? (a) => setForm(actionToForm(a)) : undefined} />
        )}
      </Card>
      <div className="mt-6">
        <DocumentVersions kind="treatment_plan" writePerm="risks:write" />
      </div>
      {form && <ActionModal form={form} setForm={setForm} onSaved={() => plan.refetch()} />}
    </>
  );
}

const Kpi = ({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) => (
  <Card className="px-5 py-4">
    <div className="text-sm text-slate-500">{label}</div>
    <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn && value ? "text-red-700" : ""}`}>{value}</div>
  </Card>
);
