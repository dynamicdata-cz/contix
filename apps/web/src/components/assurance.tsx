import { askConfirm } from "@/components/ui/overlay";
import { FrameworkOptions } from "@/components/frameworkOptions";
import { useT, tt } from "@/lib/i18n";
import { useDecree } from "@/lib/regime";
import { IdMultiSelect } from "@/components/pickers";
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
  Modal,
  Select,
  Textarea,
  type Tone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { fmtDay } from "@/lib/utils";
import {
  ASSURANCE_LABELS,
  CONTROL_FREQUENCIES,
  FRAMEWORKS,
  allRequirements,
  requirementsOf,
  type FrameworkId,
  EVIDENCE_KINDS,
  EVIDENCE_MAX_BYTES,
  TEST_KINDS,
  TEST_METHODS,
  fmtBytes,
  recommendedSample,
  type ControlFrequency,
  type ControlTestDto,
  type ControlTestResult,
  type EvidenceDto,
  type EvidenceInput,
  type EvidenceKind,
  type TestKind,
  type TestMethod,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, FileUp, Link2, Paperclip, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";

export const resultTone: Record<ControlTestResult, Tone> = {
  effective: "green",
  effective_with_exceptions: "amber",
  ineffective: "red",
  not_tested: "slate",
};
export const testStatusTone: Record<ControlTestDto["status"], Tone> = {
  planned: "slate",
  in_progress: "blue",
  completed: "green",
  cancelled: "slate",
};

export function ValidityBadge({
  e,
}: {
  e: Pick<EvidenceDto, "validity" | "validUntil">;
}) {
  const t = useT();
  if (e.validity === "none") return null;
  const map = {
    valid: ["green", t("asr.platneDo")],
    expiring: ["amber", t("asr.brzyVyprsi")],
    expired: ["red", t("asr.prosle")],
  } as const;
  const [tone, label] = map[e.validity];
  return (
    <Badge tone={tone}>
      {label} {e.validUntil ? fmtDay(e.validUntil) : ""}
    </Badge>
  );
}

export const useCanTest = () => {
  const can = useCan();
  return can("controls:test", "controls:write");
};

/** Nahrání souboru k důkazu (input type=file). */
export function UploadButton({
  evidenceId,
  onDone,
  small,
}: {
  evidenceId: string;
  onDone?: (e: EvidenceDto) => void;
  small?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [err, setErr] = useState<unknown>(null);
  const up = useMutation({
    mutationFn: (f: File) => {
      if (f.size > EVIDENCE_MAX_BYTES)
        throw new Error(
          tt("asr.souborJeVetsi", { name: f.name, max: fmtBytes(EVIDENCE_MAX_BYTES) }),
        );
      return api.assurance.uploadFile(evidenceId, f);
    },
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["evidence"] });
      onDone?.(e);
    },
    onError: setErr,
  });
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) up.mutate(f);
          e.target.value = "";
        }}
      />
      <Button
        variant="secondary"
        className={small ? "px-2 py-1 text-xs" : ""}
        disabled={up.isPending}
        onClick={() => ref.current?.click()}
      >
        <FileUp size={small ? 13 : 15} />{" "}
        {up.isPending ? t("asr.nahravam") : t("asr.nahratSoubor")}
      </Button>
      {!!err && <ErrorBox error={err} />}
    </>
  );
}

/** Formulář důkazu (nový / úprava). */
export function EvidenceModal({
  initial,
  controlIds = [],
  onClose,
  onSaved,
}: {
  initial?: EvidenceDto;
  controlIds?: string[];
  onClose: () => void;
  onSaved?: (e: EvidenceDto) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const controls = useQuery({
    queryKey: ["controls", "all"],
    queryFn: () => api.controls.list({ withGroup: "1" }),
  });
  const [f, setF] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    kind: (initial?.kind ?? "document") as EvidenceKind,
    url: initial?.url ?? "",
    collectedAt: initial?.collectedAt ?? new Date().toISOString().slice(0, 10),
    periodFrom: initial?.periodFrom ?? "",
    periodTo: initial?.periodTo ?? "",
    validUntil: initial?.validUntil ?? "",
    controlIds: initial?.controls.map((c) => c.id) ?? controlIds,
    requirementIds: initial?.requirements.map((r) => r.id) ?? [],
  });
  const [reqFw, setReqFw] = useState<FrameworkId>("soc2");
  const reqOptions = useMemo(() => requirementsOf(reqFw).map((r) => ({ id: r.id, label: `${r.ref} ${r.text.slice(0, 90)}` })), [reqFw]);
  const reqKnown = useMemo(() => allRequirements().filter((r) => f.requirementIds.includes(r.id)).map((r) => ({ id: r.id, label: `${FRAMEWORKS.find((x) => x.id === r.framework)?.shortName} ${r.ref}` })), [f.requirementIds]);
  const [file, setFile] = useState<File | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: async () => {
      const body: EvidenceInput = {
        title: f.title,
        description: f.description || null,
        kind: f.kind,
        url: f.url || null,
        collectedAt: f.collectedAt || null,
        periodFrom: f.periodFrom || null,
        periodTo: f.periodTo || null,
        validUntil: f.validUntil || null,
        controlIds: f.controlIds,
        requirementIds: f.requirementIds,
      };
      let e = initial
        ? await api.assurance.updateEvidence(initial.id, body)
        : await api.assurance.createEvidence(body);
      if (file) e = await api.assurance.uploadFile(e.id, file);
      return e;
    },
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["evidence"] });
      qc.invalidateQueries({ queryKey: ["assurance"] });
      onSaved?.(e);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? t("asr.upravitDukaz") : t("asr.novyDukaz")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button
            disabled={!f.title.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t("asr.ukladam") : t("asr.ulozit")}
          </Button>
        </>
      }
    >
      <Field label={t("asr.nazev")}>
        <Input
          value={f.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={t("asr.naprZapisZRevizePristupovych")}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("asr.druh")}>
          <Select
            value={f.kind}
            onChange={(e) => set("kind", e.target.value as EvidenceKind)}
          >
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(ASSURANCE_LABELS.evidenceKind[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("asr.porizeno")}>
          <Input
            type="date"
            value={f.collectedAt}
            onChange={(e) => set("collectedAt", e.target.value)}
          />
        </Field>
        <Field
          label={t("asr.obdobiOd")}
          hint={t("asr.keKteremuObdobiSeDukaz")}
        >
          <Input
            type="date"
            value={f.periodFrom}
            onChange={(e) => set("periodFrom", e.target.value)}
          />
        </Field>
        <Field label={t("asr.obdobiDo")}>
          <Input
            type="date"
            value={f.periodTo}
            onChange={(e) => set("periodTo", e.target.value)}
          />
        </Field>
        <Field
          label={t("asr.platneDo2")}
          hint={t("asr.predKoncemPlatnostiPrijdeUpozorneni")}
        >
          <Input
            type="date"
            value={f.validUntil}
            onChange={(e) => set("validUntil", e.target.value)}
          />
        </Field>
        <Field label={t("asr.odkazNepovinne")} hint={t("asr.sharepointConfluenceTicket")}>
          <Input
            value={f.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder={t("asr.https")}
          />
        </Field>
      </div>
      <Field label={t("asr.popis")}>
        <Textarea
          rows={2}
          value={f.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <Field label={t("asr.opatreniKteraDukazDoklada")}>
        <IdMultiSelect
          linkKind="control"
          value={f.controlIds}
          onChange={(v) => set("controlIds", v)}
          options={(controls.data ?? []).map((c) => ({
            id: c.id,
            label: `${c.code ? `${c.code} ` : ""}${c.name}`,
          }))}
          known={initial?.controls.map((c) => ({
            id: c.id,
            label: `${c.code ? `${c.code} ` : ""}${c.name}`,
          }))}
        />
      </Field>
      <Field label={t("asr.pozadavkyKtereDukazPrimoDoklada")} hint={t("asr.naprKriteriumSoc2Nebo")}>
        <div className="space-y-2">
          <Select className="w-48" value={reqFw} onChange={(e) => setReqFw(e.target.value as FrameworkId)}>
            <FrameworkOptions label="short" />
          </Select>
          <IdMultiSelect
            value={f.requirementIds}
            onChange={(v) => set("requirementIds", v)}
            options={reqOptions}
            known={reqKnown}
            placeholder={t("asr.pridatPozadavek")}
          />
        </div>
      </Field>
      {!initial && (
        <Field
          label={t("asr.souborNepovinne")}
          hint={t("asr.maxUloziSeSKontrolnim", { p: fmtBytes(EVIDENCE_MAX_BYTES) })}
        >
          <input
            type="file"
            className="text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      )}
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** Formulář nového testu. */
export function NewTestModal({
  controlId,
  onClose,
}: {
  controlId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const nav = useNavigate();
  const controls = useQuery({
    queryKey: ["controls", "all"],
    queryFn: () => api.controls.list({ withGroup: "1" }),
    enabled: !controlId,
  });
  const year = new Date().getFullYear();
  const [f, setF] = useState({
    controlId: controlId ?? "",
    kind: "operating" as TestKind,
    methods: ["inspection"] as TestMethod[],
    frequency: "quarterly" as ControlFrequency,
    periodFrom: `${year}-01-01`,
    periodTo: `${year}-12-31`,
    dueDate: "",
    tester: "",
    populationSize: "",
    procedure: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const rec =
    f.kind === "operating"
      ? recommendedSample(
          f.frequency,
          f.populationSize ? Number(f.populationSize) : null,
        )
      : null;
  const save = useMutation({
    mutationFn: () =>
      api.assurance.createTest({
        controlId: f.controlId,
        kind: f.kind,
        methods: f.methods,
        frequency: f.kind === "operating" ? f.frequency : null,
        periodFrom: f.kind === "operating" ? f.periodFrom || null : null,
        periodTo: f.kind === "operating" ? f.periodTo || null : null,
        dueDate: f.dueDate || null,
        tester: f.tester || null,
        populationSize: f.populationSize ? Number(f.populationSize) : null,
        procedure: f.procedure || null,
      }),
    onSuccess: (tx) =>
      nav({ to: "/controls/tests/$testId", params: { testId: tx.id } }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("asr.naplanovatTestOpatreni")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button
            disabled={!f.controlId || !f.methods.length || save.isPending}
            onClick={() => save.mutate()}
          >
            {t("asr.zalozitTest")}
          </Button>
        </>
      }
    >
      {!controlId && (
        <Field label={t("asr.opatreni")}>
          <Select
            value={f.controlId}
            onChange={(e) => set("controlId", e.target.value)}
          >
            <option value="">{t("asr.vyberte")}</option>
            {(controls.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} ` : ""}
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("asr.druhTestu")}>
        <Select
          value={f.kind}
          onChange={(e) => set("kind", e.target.value as TestKind)}
        >
          {TEST_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.lbl(ASSURANCE_LABELS.testKind[k])}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-700">{t("asr.metody")}</div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {TEST_METHODS.map((m) => (
            <Checkbox
              key={m}
              checked={f.methods.includes(m)}
              onChange={(v) =>
                set(
                  "methods",
                  v ? [...f.methods, m] : f.methods.filter((x) => x !== m),
                )
              }
              label={t.lbl(ASSURANCE_LABELS.method[m])}
            />
          ))}
        </div>
      </div>
      {f.kind === "operating" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("asr.jakCastoOpatreniProbiha")}>
            <Select
              value={f.frequency}
              onChange={(e) =>
                set("frequency", e.target.value as ControlFrequency)
              }
            >
              {CONTROL_FREQUENCIES.map((k) => (
                <option key={k} value={k}>
                  {t.lbl(ASSURANCE_LABELS.frequency[k])}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("asr.velikostPopulaceNepovinne")}
            hint={t("asr.pocetVyskytuVObdobiNapr")}
          >
            <Input
              type="number"
              min={0}
              value={f.populationSize}
              onChange={(e) => set("populationSize", e.target.value)}
            />
          </Field>
          <Field label={t("asr.testovaneObdobiOd")}>
            <Input
              type="date"
              value={f.periodFrom}
              onChange={(e) => set("periodFrom", e.target.value)}
            />
          </Field>
          <Field label={t("asr.do")}>
            <Input
              type="date"
              value={f.periodTo}
              onChange={(e) => set("periodTo", e.target.value)}
            />
          </Field>
        </div>
      )}
      {rec && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t("asr.doporucenyVzorek")}{" "}
          <strong>
            {rec.min === rec.max ? rec.min : `${rec.min}–${rec.max}`}
          </strong>{" "}
          {t("asr.beznaPraxeProManualniOpatreni")}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("asr.terminProvedeniTestu")}>
          <Input
            type="date"
            value={f.dueDate}
            onChange={(e) => set("dueDate", e.target.value)}
          />
        </Field>
        <Field label={t("asr.kdoTestuje")}>
          <Input
            value={f.tester}
            onChange={(e) => set("tester", e.target.value)}
            placeholder={t("asr.interniAuditExterniAuditor")}
          />
        </Field>
      </div>
      <Field label={t("asr.postupTestu")}>
        <Textarea
          rows={3}
          value={f.procedure}
          onChange={(e) => set("procedure", e.target.value)}
          placeholder={t("asr.coAJakSeOveri")}
        />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** Karty Důkazy + Testy na detailu opatření. */
export function ControlAssurance({ controlId }: { controlId: string }) {
  const t = useT();
  const canTest = useCanTest();
  const ev = useQuery({
    queryKey: ["evidence", "control", controlId],
    queryFn: () => api.assurance.evidence({ controlId }),
  });
  const tests = useQuery({
    queryKey: ["assurance", "tests", "control", controlId],
    queryFn: () => api.assurance.tests({ controlId }),
  });
  const [newEv, setNewEv] = useState(false);
  const [newTest, setNewTest] = useState(false);
  return (
    <>
      <Card>
        <CardHeader
          title={t("asr.dukazy", { p: ev.data?.length ?? 0 })}
          subtitle={t("asr.dokladyOZavedeniAFungovani")}
          action={
            canTest && (
              <Button
                variant="secondary"
                className="px-2.5 py-1.5 text-xs"
                onClick={() => setNewEv(true)}
              >
                <Plus size={13} /> {t("asr.dukaz")}
              </Button>
            )
          }
        />
        <ErrorBox error={ev.error} />
        {(ev.data ?? []).length === 0 ? (
          <EmptyState>{t("asr.zatimZadnyDukaz")}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(ev.data ?? []).map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-3 px-5 py-2.5 text-sm"
              >
                <Paperclip
                  size={15}
                  className="mt-0.5 shrink-0 text-slate-400"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/controls/evidence/$evidenceId"
                    params={{ evidenceId: e.id }}
                    className="font-medium hover:text-brand-700"
                  >
                    {e.title}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {t.lbl(ASSURANCE_LABELS.evidenceKind[e.kind])}
                    {e.collectedAt && ` · ${fmtDay(e.collectedAt)}`}
                    {e.files.length > 0 &&
                      ` · ${e.files.length} soubor${e.files.length > 1 ? "y" : ""}`}
                    {e.url && " · odkaz"}
                  </div>
                </div>
                <ValidityBadge e={e} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader
          title={t("asr.testyUcinnosti", { p: tests.data?.length ?? 0 })}
          subtitle={t("asr.testNavrhuOveriZeOpatreni")}
          action={
            canTest && (
              <Button
                variant="secondary"
                className="px-2.5 py-1.5 text-xs"
                onClick={() => setNewTest(true)}
              >
                <Plus size={13} /> {t("asr.test")}
              </Button>
            )
          }
        />
        <ErrorBox error={tests.error} />
        {(tests.data ?? []).length === 0 ? (
          <EmptyState>{t("asr.opatreniZatimNebyloTestovano")}</EmptyState>
        ) : (
          <TestList tests={tests.data ?? []} compact />
        )}
      </Card>
      {newEv && (
        <EvidenceModal
          controlIds={[controlId]}
          onClose={() => setNewEv(false)}
        />
      )}
      {newTest && (
        <NewTestModal controlId={controlId} onClose={() => setNewTest(false)} />
      )}
    </>
  );
}

export function TestList({
  tests,
  compact,
}: {
  tests: ControlTestDto[];
  compact?: boolean;
}) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          {!compact && <th className="px-5 py-2">{t("asr.opatreni")}</th>}
          <th className={compact ? "px-5 py-2" : "px-3 py-2"}>{t("asr.test")}</th>
          <th className="px-3 py-2">{t("asr.obdobiTermin")}</th>
          <th className="px-3 py-2 text-right">{t("asr.vzorky")}</th>
          <th className="px-3 py-2">{t("asr.vysledek")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {tests.map((tx) => {
          const overdue =
            tx.status !== "completed" &&
            tx.status !== "cancelled" &&
            tx.dueDate &&
            tx.dueDate < today;
          return (
            <tr key={tx.id} className="hover:bg-slate-50">
              {!compact && (
                <td className="px-5 py-2">
                  <Link
                    to="/controls/$controlId"
                    params={{ controlId: tx.controlId }}
                    className="hover:text-brand-700"
                  >
                    {tx.controlCode && (
                      <span className="mr-1.5 text-slate-500">
                        {tx.controlCode}
                      </span>
                    )}
                    {tx.controlName}
                  </Link>
                </td>
              )}
              <td className={compact ? "px-5 py-2" : "px-3 py-2"}>
                <Link
                  to="/controls/tests/$testId"
                  params={{ testId: tx.id }}
                  className="font-medium hover:text-brand-700"
                >
                  {tx.kind === "design" ? t("asr.testNavrhu") : t("asr.provozniUcinnost")}
                </Link>
                <div className="text-xs text-slate-500">{tx.tester ?? "—"}</div>
              </td>
              <td className="px-3 py-2 text-xs text-slate-600">
                {tx.periodFrom && tx.periodTo
                  ? `${fmtDay(tx.periodFrom)} – ${fmtDay(tx.periodTo)}`
                  : "—"}
                <div className={overdue ? "font-medium text-red-700" : ""}>
                  {tx.performedAt
                    ? `provedeno ${fmtDay(tx.performedAt)}`
                    : tx.dueDate
                      ? t("asr.termin", { p: fmtDay(tx.dueDate) })
                      : ""}
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {tx.sampleCount}
                {tx.exceptions > 0 && (
                  <div className="text-xs text-red-700">
                    {t("asr.vyjimky", { exceptions: tx.exceptions })}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                {tx.status === "completed" && tx.result ? (
                  <Badge tone={resultTone[tx.result]}>
                    {t.lbl(ASSURANCE_LABELS.result[tx.result])}
                  </Badge>
                ) : (
                  <Badge tone={testStatusTone[tx.status]}>
                    {t.lbl(ASSURANCE_LABELS.status[tx.status])}
                  </Badge>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Soubory důkazu se stažením. */
export function EvidenceFiles({
  e,
  canEdit,
}: {
  e: EvidenceDto;
  canEdit: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (fileId: string) => api.assurance.deleteFile(e.id, fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["evidence"] }),
  });
  return (
    <div>
      {e.files.length === 0 && !e.url ? (
        <EmptyState>{t("asr.bezSouboru")}</EmptyState>
      ) : null}
      <ul className="divide-y divide-slate-100">
        {e.url && (
          <li className="flex items-center gap-3 px-5 py-2 text-sm">
            <Link2 size={15} className="text-slate-400" />
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-brand-700 hover:underline"
            >
              {e.url}
            </a>
          </li>
        )}
        {e.files.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-5 py-2 text-sm">
            <Download size={15} className="shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <a
                href={api.assurance.fileUrl(e.id, f.id)}
                className="font-medium hover:text-brand-700"
              >
                {f.filename}
              </a>
              <div className="text-xs text-slate-500">
                {fmtBytes(f.size)} ·{" "}
                {new Date(f.uploadedAt).toLocaleString("cs-CZ", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                · {f.uploadedByName ?? "?"} ·{" "}
                <span title={f.sha256} className="font-mono">
                  {t("asr.sha256", { p: f.sha256.slice(0, 12) })}
                </span>
              </div>
            </div>
            {canEdit && (
              <button
                className="text-xs text-slate-500 hover:text-red-700"
                onClick={async () =>
                  (await askConfirm(t("asr.odebratSoubor", { filename: f.filename }))) && del.mutate(f.id)
                }
              >
                {t("asr.odebrat")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorBox error={del.error} />
    </div>
  );
}

/** Stažení balíčku pro auditora (ZIP). */
export function AuditPackageModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const decree = useDecree();
  const [f, setF] = useState({ framework: decree as FrameworkId, periodFrom: `${new Date().getFullYear()}-01-01`, periodTo: today, files: true });
  const url = api.assurance.packageUrl({ framework: f.framework, periodFrom: f.periodFrom, periodTo: f.periodTo, files: f.files ? "1" : "0" });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("asr.balicekProAuditora")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <a href={url} onClick={() => setTimeout(onClose, 500)}>
            <Button>
              <Download size={15} /> {t("asr.stahnoutZip")}
            </Button>
          </a>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {t("asr.zipProAuditoraAuditKb")}
      </p>
      <Field label={t("asr.ramec")}>
        <Select value={f.framework} onChange={(e) => setF({ ...f, framework: e.target.value as FrameworkId })}>
          <FrameworkOptions label="name" />
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("asr.testyDokonceneOd")}>
          <Input type="date" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} />
        </Field>
        <Field label={t("asr.do")}>
          <Input type="date" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} />
        </Field>
      </div>
      <Checkbox checked={f.files} onChange={(v) => setF({ ...f, files: v })} label={t("asr.prilozitSouboryDukazu")} hint={t("asr.bezSouboruObsahujeBalicekJen")} />
      <p className="text-xs text-slate-500">{t("asr.stazeniSeZapiseDoAuditniho")}</p>
    </Modal>
  );
}
