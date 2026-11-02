import { cn } from "@/lib/utils";
import { Tabs, useTab } from "@/components/ui/tabs";
import { useFormGuard } from "@/lib/unsaved";
import { askConfirm } from "@/components/ui/overlay";
import { LinkedRecordsCard } from "@/components/linkedRecords";
import { ControlMonitorsCard } from "@/pages/Monitoring";
import { FrameworkOptions } from "@/components/frameworkOptions";
import { TasksCard } from "@/components/tasks";
import { useDecree } from "@/lib/regime";
import { useT } from "@/lib/i18n";
import { LinkedDocsCard } from "@/components/linkedDocs";
import { AiSuggestPanel } from "@/components/ai";
import { ControlAssurance } from "@/components/assurance";
import { TransferButton } from "@/components/transfer";
import { ControlStatusBadge } from "@/components/compliance";
import {
  AssetPicker,
  PositionSelect,
  type PickedAsset,
} from "@/components/pickers";
import { RiskLevelBadge } from "@/components/risk";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Select,
  SuccessBox,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import {
  allRequirements,
  CONTROL_CATEGORIES,
  CONTROL_LABELS,
  CONTROL_STATUSES,
  EFFECTIVENESS,
  FRAMEWORKS,
  type ControlCategory,
  type ControlDetail,
  type ControlInput,
  type ControlStatus,
  type Effectiveness,
  type FrameworkId,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { fwShort } from "./Controls";

type Form = Omit<ControlInput, "requirementIds" | "assetIds"> & {
  requirementIds: string[];
  assets: PickedAsset[];
};

const blank = (): Form => ({
  code: "",
  name: "",
  description: "",
  category: "organizational",
  ownerPositionId: null,
  status: "not_implemented",
  implementation: "",
  evidence: "",
  effectiveness: "not_assessed",
  plannedDate: null,
  priority: null,
  lastReviewAt: null,
  requirementIds: [],
  assets: [],
});

const fromDetail = (d: ControlDetail): Form => ({
  code: d.code ?? "",
  name: d.name,
  description: d.description ?? "",
  category: d.category,
  ownerPositionId: d.ownerPositionId,
  status: d.status,
  implementation: d.implementation ?? "",
  evidence: d.evidence ?? "",
  effectiveness: d.effectiveness,
  plannedDate: d.plannedDate,
  priority: d.priority,
  lastReviewAt: d.lastReviewAt,
  requirementIds: d.requirements.map((r) => r.id),
  assets: d.assets,
});

export function ControlNewPage() {
  return <ControlEditor initial={blank()} />;
}

export function ControlDetailPage() {
  const { controlId } = useParams({ strict: false }) as { controlId: string };
  const q = useQuery({
    queryKey: ["control", controlId],
    queryFn: () => api.controls.get(controlId),
  });
  if (!q.data) return <ErrorBox error={q.error} />;
  return (
    <ControlEditor
      key={q.data.id}
      detail={q.data}
      initial={fromDetail(q.data)}
    />
  );
}

function ControlEditor({
  detail,
  initial,
}: {
  detail?: ControlDetail;
  initial: Form;
}) {
  const t = useT();
  const can = useCan();
  const admin = can("controls:write");
  const edit = detail ? detail.canEdit : admin;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(initial);
  const [tab, setTab] = useTab(["overview", "assurance", "links", "tasks"] as const, "overview");
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const { assets, ...rest } = f;
      const body: ControlInput = {
        ...rest,
        code: rest.code || null,
        description: rest.description || null,
        implementation: rest.implementation || null,
        evidence: rest.evidence || null,
        assetIds: assets.map((a) => a.id),
      };
      if (detail && !admin) {
        delete body.ownerPositionId;
        delete body.requirementIds;
      }
      return detail
        ? api.controls.update(detail.id, body)
        : api.controls.create(body);
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["controls"] });
      qc.setQueryData(["control", d.id], d);
      if (!detail)
        nav({ to: "/controls/$controlId", params: { controlId: d.id } });
    },
  });
  const guard = useFormGuard(save);
  const del = useMutation({
    mutationFn: () => api.controls.remove(detail!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["controls"] });
      nav({ to: "/controls" });
    },
  });

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/controls" className="hover:text-brand-700">
          {t("soa.opatreniAShoda")}
        </Link>
      </div>
      <div className="sticky top-12 z-20 -mx-4 mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/70 bg-slate-50/85 px-4 py-3 backdrop-blur-md md:top-0 md:-mx-8 md:px-8">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">
            {detail
              ? `${detail.code ? `${detail.code} ` : ""}${detail.name}`
              : t("soa.noveOpatreni")}
          </h1>
          {detail && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <ControlStatusBadge s={detail.status} />
              <Badge>{t.lbl(CONTROL_LABELS.category[detail.category])}</Badge>
              {detail.frameworks.map((fw) => (
                <Badge key={fw} tone="violet">
                  {fwShort(fw)}
                </Badge>
              ))}
              <span>
                {detail.ownerPositionName
                  ? t("soa.vlastnik", { ownerPositionName: detail.ownerPositionName })
                  : t("soa.bezVlastnika")}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {detail && admin && (
            <TransferButton
              entity="controls"
              id={detail.id}
              companyId={detail.companyId}
            />
          )}
          {detail && admin && (
            <Button
              variant="danger"
              onClick={async () =>
                (await askConfirm(
                  t("soa.smazatOpatreniVazbyNaPozadavky"),
                )) && del.mutate()
              }
            >
              <Trash2 size={15} />
            </Button>
          )}
          {edit && (
            <Button
              disabled={!f.name.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {detail ? t("soa.ulozit") : t("soa.zalozitOpatreni")}
            </Button>
          )}
        </div>
      </div>
      {save.isSuccess && detail && <SuccessBox>{t("soa.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error} />

      {detail && (
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: "overview" as const, label: t("detail.tab.overview") },
            { key: "assurance" as const, label: t("detail.tab.assurance") },
            { key: "links" as const, label: t("detail.tab.links") },
            { key: "tasks" as const, label: t("detail.tab.tasks") },
          ]}
        />
      )}
      {detail && tab === "assurance" && (
        <div className="space-y-6">
          <ControlAssurance controlId={detail.id} />
          <ControlMonitorsCard controlId={detail.id} />
        </div>
      )}
      {detail && tab === "links" && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <LinkedRecordsCard target="control" id={detail.id} />
          <LinkedDocsCard kind="control" id={detail.id} />
        </div>
      )}
      {detail && tab === "tasks" && <TasksCard kind="control" id={detail.id} />}
      <div className={cn("mt-4 grid items-start gap-6 lg:grid-cols-2", detail && tab !== "overview" && "hidden")}>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t("soa.controls")} />
            <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                <Field label={t("soa.kod")}>
                  <Input
                    value={f.code ?? ""}
                    onChange={(e) => set("code", e.target.value)}
                    placeholder="V-13"
                  />
                </Field>
                <Field label={t("soa.nazev")}>
                  <Input
                    value={f.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </Field>
              </div>
              <Field label={t("soa.popis")}>
                <Textarea
                  rows={2}
                  value={f.description ?? ""}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("soa.druh")}>
                  <Select
                    value={f.category}
                    onChange={(e) =>
                      set("category", e.target.value as ControlCategory)
                    }
                  >
                    {CONTROL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t.lbl(CONTROL_LABELS.category[c])}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("soa.vlastnikFunkcniMisto")}>
                  <PositionSelect
                    disabled={!admin}
                    value={f.ownerPositionId ?? null}
                    onChange={(v) => set("ownerPositionId", v)}
                  />
                </Field>
                <Field label={t("soa.stavZavedeni")}>
                  <Select
                    value={f.status}
                    onChange={(e) =>
                      set("status", e.target.value as ControlStatus)
                    }
                  >
                    {CONTROL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t.lbl(CONTROL_LABELS.status[s])}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("soa.ucinnost")}>
                  <Select
                    value={f.effectiveness}
                    onChange={(e) =>
                      set("effectiveness", e.target.value as Effectiveness)
                    }
                  >
                    {EFFECTIVENESS.map((s) => (
                      <option key={s} value={s}>
                        {t.lbl(CONTROL_LABELS.effectiveness[s])}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("soa.planovanyTerminZavedeni")}>
                  <Input
                    type="date"
                    value={f.plannedDate ?? ""}
                    onChange={(e) => set("plannedDate", e.target.value || null)}
                  />
                </Field>
                <Field label={t("soa.posledniPrezkumUcinnosti")}>
                  <Input
                    type="date"
                    value={f.lastReviewAt ?? ""}
                    onChange={(e) =>
                      set("lastReviewAt", e.target.value || null)
                    }
                  />
                </Field>
              </div>
              <Field label={t("soa.zpusobPlneniPopisZavedeni")}>
                <Textarea
                  rows={3}
                  value={f.implementation ?? ""}
                  onChange={(e) => set("implementation", e.target.value)}
                />
              </Field>
              <Field
                label={t("soa.kdeJeKodifikovanoDolozeno")}
                hint={t("soa.smernicePostupyZaznamyProAuditora")}
              >
                <Textarea
                  rows={2}
                  value={f.evidence ?? ""}
                  onChange={(e) => set("evidence", e.target.value)}
                />
              </Field>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">
                  {t("soa.aktivaNaKteraSeOpatreni")}
                </div>
                <AssetPicker
                  value={f.assets}
                  onChange={(v) => set("assets", v)}
                  disabled={!edit}
                />
              </div>
            </fieldset>
          </Card>
        </div>

        <div className="space-y-6">
          <RequirementsPicker
            value={f.requirementIds}
            onChange={(v) => set("requirementIds", v)}
            disabled={!admin}
          />
          {detail && (
            <AiSuggestPanel
              useCase="control_mapping"
              entityId={detail.id}
              canApply={admin}
              onApplied={(s) => {
                // přijaté požadavky už jsou uložené – doplnit do formuláře, aby je další uložení nepřepsalo
                const added = s.acceptedItems
                  .map((i) => s.items[i])
                  .flatMap((it) =>
                    it?.kind === "mapping" ? [it.requirementId] : [],
                  );
                setF((x) => ({
                  ...x,
                  requirementIds: [...new Set([...x.requirementIds, ...added])],
                }));
                qc.invalidateQueries({ queryKey: ["control", detail.id] });
                qc.invalidateQueries({ queryKey: ["controls"] });
              }}
            />
          )}
          {detail && (
            <Card>
              <CardHeader
                title={t("soa.rizika")}
                subtitle={t("soa.rizikaKteraOpatreniSnizujeVazba")}
              />
              {detail.risks.length === 0 ? (
                <EmptyState>
                  {t("soa.opatreniZatimNeniNavazaneNa")}
                </EmptyState>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {detail.risks.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 px-5 py-2 text-sm"
                    >
                      <Link
                        to="/risks/$riskId"
                        params={{ riskId: r.id }}
                        className="flex-1 hover:text-brand-700"
                      >
                        {r.code && (
                          <span className="mr-1.5 text-slate-500">
                            {r.code}
                          </span>
                        )}
                        {r.name}
                      </Link>
                      <RiskLevelBadge level={r.level} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** Výběr požadavků rámců (ZKB, 409, 410, ISO, DORA) – vybrané nahoře, dole hledání v rámci. */
function RequirementsPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const all = useMemo(() => allRequirements(), []);
  const decree = useDecree();
  const [fw, setFw] = useState<FrameworkId>(decree);
  const [q, setQ] = useState("");
  const selected = new Set(value);
  const chosen = all.filter((r) => selected.has(r.id));
  const byFw = FRAMEWORKS.map((f) => ({
    f,
    items: chosen.filter((r) => r.framework === f.id),
  })).filter((x) => x.items.length);
  const found = all
    .filter(
      (r) =>
        r.framework === fw &&
        (!q ||
          `${r.ref} ${r.sectionTitle} ${r.text}`
            .toLowerCase()
            .includes(q.toLowerCase())),
    )
    .slice(0, 80);
  return (
    <Card>
      <CardHeader
        title={t("soa.pozadavky", { length: value.length })}
        subtitle={t("soa.naKterePozadavkyPredpisuA")}
      />
      <div className="space-y-4 p-5">
        {byFw.length === 0 && (
          <p className="text-sm text-slate-400">{t("soa.zadnePozadavky")}</p>
        )}
        {byFw.map(({ f, items }) => (
          <div key={f.id}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {f.shortName}
            </div>
            <div className="flex flex-wrap gap-1">
              {items.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 py-0.5 pl-1.5 pr-0.5 text-xs"
                  title={r.text}
                >
                  {r.ref}
                  {!disabled && (
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-slate-200"
                      onClick={() => onChange(value.filter((x) => x !== r.id))}
                      aria-label={t("soa.odebrat")}
                    >
                      <X size={11} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}
        {!disabled && (
          <div className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex gap-2">
              <Select
                className="w-44"
                value={fw}
                onChange={(e) => setFw(e.target.value as FrameworkId)}
              >
                <FrameworkOptions label="short" />
              </Select>
              <Input
                placeholder={t("soa.hledatText")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {found.map((r) => (
                <Checkbox
                  key={r.id}
                  checked={selected.has(r.id)}
                  onChange={(on) =>
                    onChange(
                      on ? [...value, r.id] : value.filter((x) => x !== r.id),
                    )
                  }
                  label={
                    <span>
                      <span className="font-mono text-xs text-slate-500">
                        {r.ref}
                      </span>{" "}
                      {r.text}
                    </span>
                  }
                  hint={r.sectionTitle}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
