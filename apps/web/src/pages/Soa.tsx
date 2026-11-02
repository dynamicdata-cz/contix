import { FrameworkOptions } from "@/components/frameworkOptions";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import { useDecree } from "@/lib/regime";
import { LinkedDocsInline } from "@/components/linkedDocs";
import { NeedsCompany, useGroupView } from "@/components/company";
import { DocumentVersions } from "@/components/documents";
import { ComplianceBadge, ComplianceBar, ComplianceLegend, ControlStatusBadge, ScoreValue } from "@/components/compliance";
import { PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { fmtDay } from "@/lib/utils";
import {
  complianceScore,
  COMPLIANCE,
  CONTROL_LABELS,
  emptyComplianceCounts,
  FRAMEWORKS,
  type Compliance,
  type FrameworkId,
  type RequirementRow,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

export function SoaPage() {
  const t = useT();
  const group = useGroupView();
  if (group)
    return (
      <>
        <PageHeader badge={<FrameworkBadge />} title={t("soa.prohlaseniOAplikovatelnosti")} />
        <NeedsCompany what={t("soa.prohlaseniOAplikovatelnostiPrehledBezpec")}>{null}</NeedsCompany>
      </>
    );
  return <SoaInner />;
}

function SoaInner() {
  const t = useT();
  const search = useSearch({ strict: false }) as { framework?: FrameworkId; section?: string };
  const nav = useNavigate();
  const decree = useDecree();
  const framework: FrameworkId = search.framework ?? decree;
  const section = search.section ?? "";
  const [q, setQ] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [editing, setEditing] = useState<RequirementRow | null>(null);
  const reqs = useQuery({ queryKey: ["controls", "requirements", framework], queryFn: () => api.controls.requirements({ framework }) });
  const fw = FRAMEWORKS.find((f) => f.id === framework)!;
  const setSearch = (s: { framework?: FrameworkId; section?: string }) => nav({ to: "/controls/soa", search: { framework, section: section || undefined, ...s } });

  const sections = useMemo(() => [...new Map((reqs.data ?? []).map((r) => [r.section, r.sectionTitle])).entries()], [reqs.data]);
  const rows = (reqs.data ?? []).filter(
    (r) =>
      (!section || r.section === section) &&
      (!onlyGaps || (r.applicable && r.compliance !== "compliant")) &&
      (!q || `${r.ref} ${r.lead ?? ""} ${r.text} ${r.points.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  );
  const counts = emptyComplianceCounts();
  for (const r of rows) counts[r.compliance]++;
  const isDecree = framework === "cz409" || framework === "cz410" || framework === "zkb";

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/controls" className="hover:text-brand-700">
          {t("soa.opatreniAShoda")}
        </Link>
      </div>
      <PageHeader
        title={framework === "cz410" ? t("soa.overview") : t("soa.prohlaseniOAplikovatelnosti")}
        subtitle={
          framework === "cz410"
            ? t("soa.3Odst2APriloha")
            : framework === "cz409"
              ? t("soa.8Odst1PismF")
              : t("soa.posouzeniPozadavkuAMiryShody", { name: fw.name })
        }
        actions={
          <a href={api.controls.soaCsvUrl(framework)}>
            <Button variant="secondary">
              <Download size={16} /> {t("soa.exportCsv")}
            </Button>
          </a>
        }
      />
      <ErrorBox error={reqs.error} />
      <DocumentVersions kind="soa" framework={framework} writePerm="controls:write" />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select className="w-64" value={framework} onChange={(e) => setSearch({ framework: e.target.value as FrameworkId, section: undefined })}>
            <FrameworkOptions label="name" />
          </Select>
          <Select className="w-64" value={section} onChange={(e) => setSearch({ section: e.target.value || undefined })}>
            <option value="">{t("soa.vsechnyOddily")}</option>
            {sections.map(([s, tx]) => (
              <option key={s} value={s}>
                {s} {tx}
              </option>
            ))}
          </Select>
          <Input className="max-w-xs" placeholder={t("soa.hledatVTextu")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Checkbox checked={onlyGaps} onChange={setOnlyGaps} label={t("soa.jenNesplnene")} />
          <div className="ml-auto text-right">
            <div className="text-xs text-slate-500">{t("soa.miraShodyVyber")}</div>
            <ScoreValue score={complianceScore(counts)} className="text-lg" />
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <ComplianceBar counts={counts} />
          <ComplianceLegend counts={counts} />
        </div>
        {!fw.fullText && (
          <p className="mt-3 text-xs text-slate-500">
            {framework === "iso9001"
              ? t("soa.iso90012015CislaKapitol")
              : framework === "iso27001"
              ? t("soa.nazvyOpatreniIsoIec27001")
              : framework === "soc2"
                ? t("soa.soc2IdentifikatoryTrustServices")
                : framework === "cis8"
                  ? t("soa.cisNote")
                  : fw.custom
                    ? t("soa.customNote", { source: fw.source || fw.name })
                    : t("soa.uDoraJsouUvedenyUredni")}
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState>{t("soa.zadnePozadavkyNeodpovidajiFiltru")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-40 px-5 py-2">{t("soa.col.provision")}</th>
                <th className="px-3 py-2">{t("soa.col.requirement")}</th>
                <th className="w-36 px-3 py-2">{t("soa.shoda")}</th>
                <th className="w-64 px-3 py-2">{t("soa.opatreniZpusobPlneni")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <FragmentRow key={r.id} r={r} showHeader={i === 0 || rows[i - 1]!.section !== r.section} onEdit={() => setEditing(r)} isDecree={isDecree} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <AssessModal row={editing} onClose={() => setEditing(null)} framework={framework} />}
    </>
  );
}

function FragmentRow({ r, showHeader, onEdit, isDecree }: { r: RequirementRow; showHeader: boolean; onEdit: () => void; isDecree: boolean }) {
  const t = useT();
  return (
    <>
      {showHeader && (
        <tr className="border-t border-slate-200 bg-slate-50/60">
          <td colSpan={4} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {r.section} {r.sectionTitle}
          </td>
        </tr>
      )}
      <tr className="cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50" onClick={onEdit}>
        <td className="px-5 py-2.5 font-mono text-xs text-slate-600">{r.ref}</td>
        <td className="px-3 py-2.5">
          {r.lead && isDecree && <div className="text-xs text-slate-400">{r.lead} …</div>}
          <div className={r.applicable ? "text-slate-800" : "text-slate-400 line-through"}>{r.text}</div>
          {r.points.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {r.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {(r.level || r.guidance) && (
            <div className="mt-1 text-xs text-slate-500">
              {r.level && <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5">{r.level}</span>}
              {r.guidance && <span className="line-clamp-2">{r.guidance}</span>}
            </div>
          )}
          {!r.applicable && r.justification && <div className="mt-1 text-xs text-slate-600">{t("soa.oduvodneni", { justification: r.justification })}</div>}
        </td>
        <td className="px-3 py-2.5">
          <ComplianceBadge c={r.compliance} />
          {r.manualCompliance && r.manualCompliance !== r.derivedCompliance && (
            <div className="mt-1 text-[11px] text-slate-500" title={t("soa.rucniPosouzeniPrebijiStavOdvozeny")}>
              {t("soa.rucneZOpatreni", { p: CONTROL_LABELS.compliance[r.derivedCompliance].toLowerCase() })}
            </div>
          )}
          {r.dueDate && <div className="mt-1 text-[11px] text-slate-500">{t("soa.termin", { p: fmtDay(r.dueDate) })}</div>}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap gap-1">
            {r.controls.map((c) => (
              <Link
                key={c.id}
                to="/controls/$controlId"
                params={{ controlId: c.id }}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs hover:border-brand-300"
              >
                {c.code ?? c.name}
                <ControlStatusBadge s={c.status} />
              </Link>
            ))}
          </div>
          {r.applicable && (
            <div className={`mt-1 text-[11px] ${r.evidenceCount ? "text-slate-500" : "text-amber-700"}`}>{r.evidenceCount ? t("soa.dukazy", { evidenceCount: r.evidenceCount }) : t("soa.bezDukazu")}</div>
          )}
          {r.implementationNote && <div className="mt-1 text-xs text-slate-600">{r.implementationNote}</div>}
          {r.ownerPositionName && <div className="mt-1 text-[11px] text-slate-500">{t("soa.odpovida", { ownerPositionName: r.ownerPositionName })}</div>}
        </td>
      </tr>
    </>
  );
}

function AssessModal({ row, onClose, framework }: { row: RequirementRow; onClose: () => void; framework: FrameworkId }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const edit = can("controls:write");
  const [f, setF] = useState({
    applicable: row.applicable,
    justification: row.justification ?? "",
    compensating: row.compensating ?? "",
    compliance: row.manualCompliance as Compliance | null,
    implementationNote: row.implementationNote ?? "",
    priority: row.priority,
    dueDate: row.dueDate,
    ownerPositionId: row.ownerPositionId,
  });
  const save = useMutation({
    mutationFn: () =>
      api.controls.assess(row.id, {
        ...f,
        justification: f.justification || null,
        compensating: f.compensating || null,
        implementationNote: f.implementationNote || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["controls"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${row.ref} – ${row.sectionTitle}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {edit ? t("common.cancelAction") : t("common.close")}
          </Button>
          {edit && (
            <Button disabled={save.isPending || (!f.applicable && !f.justification.trim())} onClick={() => save.mutate()}>
              {t("soa.ulozitPosouzeni")}
            </Button>
          )}
        </>
      }
    >
      <ErrorBox error={save.error} />
      <div className="rounded-md bg-slate-50 p-3 text-sm">
        {row.lead && <div className="text-xs text-slate-500">{row.lead} …</div>}
        <div>{row.text}</div>
        {row.points.map((p) => (
          <div key={p} className="text-xs text-slate-600">
            {p}
          </div>
        ))}
      </div>
      <fieldset disabled={!edit} className="space-y-4">
        <Checkbox checked={f.applicable} onChange={(v) => setF({ ...f, applicable: v })} label={t("soa.pozadavekJeAplikovanUplatnovan")} hint={t("soa.8Odst4OpatreniLze")} />
        {!f.applicable && (
          <>
            <Field label={t("soa.oduvodneniNeaplikovaniPovinne")}>
              <Textarea rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} />
            </Field>
            <Field label={t("soa.prijataNahradniBezpecnostniOpatreni")}>
              <Textarea rows={2} value={f.compensating} onChange={(e) => setF({ ...f, compensating: e.target.value })} />
            </Field>
          </>
        )}
        {f.applicable && (
          <>
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">{t("soa.navazanaOpatreni")}</div>
              {row.controls.length === 0 ? (
                <p className="text-sm text-slate-500">{t("soa.zadnePozadavekNamapujteNaOpatreni")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {row.controls.map((c) => (
                    <Link key={c.id} to="/controls/$controlId" params={{ controlId: c.id }} className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs">
                      {c.code} {c.name} <ControlStatusBadge s={c.status} />
                    </Link>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">{t("soa.odvozenaMiraShodyZOpatreni", { p: t.lbl(CONTROL_LABELS.compliance[row.derivedCompliance]) })}</p>
            </div>
            <LinkedDocsInline kind="requirement" id={row.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("soa.rucniPosouzeniMiryShody")} hint={t("soa.prazdneOdvoditZOpatreni")}>
                <Select value={f.compliance ?? ""} onChange={(e) => setF({ ...f, compliance: (e.target.value || null) as Compliance | null })}>
                  <option value="">{t("soa.odvoditZOpatreni")}</option>
                  {COMPLIANCE.filter((c) => c !== "not_applicable").map((c) => (
                    <option key={c} value={c}>
                      {t.lbl(CONTROL_LABELS.compliance[c])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("soa.prioritaZavedeniPrilC1")}>
                <Select value={f.priority ?? ""} onChange={(e) => setF({ ...f, priority: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {[1, 2, 3, 4].map((p) => (
                    <option key={p} value={p}>
                      {t.lbl(CONTROL_LABELS.priority[p])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("soa.410.col.due")}>
                <Input type="date" value={f.dueDate ?? ""} onChange={(e) => setF({ ...f, dueDate: e.target.value || null })} />
              </Field>
              <Field label={t("soa.odpovednostFunkcniMisto")}>
                <PositionSelect value={f.ownerPositionId ?? null} onChange={(v) => setF({ ...f, ownerPositionId: v })} />
              </Field>
            </div>
            <Field label={t("soa.zpusobPlneni")} hint={t("soa.proProhlaseniOAplikovatelnostiNevyplneno")}>
              <Textarea rows={3} value={f.implementationNote} onChange={(e) => setF({ ...f, implementationNote: e.target.value })} />
            </Field>
          </>
        )}
      </fieldset>
      {framework === "cz410" && <Badge tone="blue">{t("soa.prehledBezpecnostnichOpatreniUchovavejte")}</Badge>}
    </Modal>
  );
}
