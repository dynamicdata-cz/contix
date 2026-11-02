import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import {
  EvidenceModal,
  resultTone,
  testStatusTone,
  useCanTest,
} from "@/components/assurance";
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
} from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDay } from "@/lib/utils";
import {
  ASSURANCE_LABELS,
  CONTROL_LABELS,
  CONTROL_TEST_RESULTS,
  SAMPLE_RESULTS,
  effectivenessFromResult,
  type ControlTestDto,
  type ControlTestResult,
  type SampleResult,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { CheckCircle2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

export function ControlTestPage() {
  const { testId } = useParams({ strict: false }) as { testId: string };
  const q = useQuery({
    queryKey: ["assurance", "test", testId],
    queryFn: () => api.assurance.test(testId),
  });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <TestView t={q.data} />;
}

function TestView({ t: tx }: { t: ControlTestDto }) {
  const t = useT();
  const canTest = useCanTest();
  const qc = useQueryClient();
  const nav = useNavigate();
  const done = tx.status === "completed";
  const editable = canTest && !done;
  const setData = (d: ControlTestDto) => {
    qc.setQueryData(["assurance", "test", tx.id], d);
    qc.invalidateQueries({ queryKey: ["assurance", "tests"] });
    qc.invalidateQueries({ queryKey: ["assurance", "overview"] });
  };
  const evidence = useQuery({
    queryKey: ["evidence", "control", tx.controlId],
    queryFn: () => api.assurance.evidence({ controlId: tx.controlId }),
  });
  const [complete, setComplete] = useState(false);
  const [newEv, setNewEv] = useState(false);
  const [bulk, setBulk] = useState("");
  const [f, setF] = useState({
    tester: tx.tester ?? "",
    dueDate: tx.dueDate ?? "",
    procedure: tx.procedure ?? "",
    tolerableExceptions: tx.tolerableExceptions,
    populationSize: tx.populationSize?.toString() ?? "",
  });
  const save = useMutation({
    mutationFn: () =>
      api.assurance.updateTest(tx.id, {
        tester: f.tester || null,
        dueDate: f.dueDate || null,
        procedure: f.procedure || null,
        tolerableExceptions: f.tolerableExceptions,
        populationSize: f.populationSize ? Number(f.populationSize) : null,
      }),
    onSuccess: setData,
  });
  const addSamples = useMutation({
    mutationFn: (refs: string[]) =>
      api.assurance.addSamples(
        tx.id,
        refs.map((ref) => ({ ref, result: "pass" as const })),
      ),
    onSuccess: (d) => {
      setData(d);
      setBulk("");
    },
  });
  const upd = useMutation({
    mutationFn: (x: {
      sid: string;
      data: Parameters<typeof api.assurance.updateSample>[2];
    }) => api.assurance.updateSample(tx.id, x.sid, x.data),
    onSuccess: setData,
  });
  const delSample = useMutation({
    mutationFn: (sid: string) => api.assurance.deleteSample(tx.id, sid),
    onSuccess: setData,
  });
  const reopen = useMutation({
    mutationFn: () => api.assurance.reopenTest(tx.id),
    onSuccess: setData,
  });
  const del = useMutation({
    mutationFn: () => api.assurance.deleteTest(tx.id),
    onSuccess: () =>
      nav({ to: "/controls/$controlId", params: { controlId: tx.controlId } }),
  });

  const shownResult = tx.result ?? tx.derivedResult;
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/controls/assurance" className="hover:text-brand-700">
          {t("asr.testyADukazy")}
        </Link>{" "}
        ·{" "}
        <Link
          to="/controls/$controlId"
          params={{ controlId: tx.controlId }}
          className="hover:text-brand-700"
        >
          {tx.controlCode ? `${tx.controlCode} ` : ""}
          {tx.controlName}
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.lbl(ASSURANCE_LABELS.testKind[tx.kind])}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge tone={testStatusTone[tx.status]}>
              {t.lbl(ASSURANCE_LABELS.status[tx.status])}
            </Badge>
            {done && tx.result && (
              <Badge tone={resultTone[tx.result]}>
                {t.lbl(ASSURANCE_LABELS.result[tx.result])}
              </Badge>
            )}
            <span>
              {tx.methods.map((m) => t.lbl(ASSURANCE_LABELS.method[m])).join(", ")}
            </span>
            {tx.periodFrom && tx.periodTo && (
              <span>
                {t("asr.obdobi", { p: fmtDay(tx.periodFrom), p2: fmtDay(tx.periodTo) })}
              </span>
            )}
            {tx.frequency && (
              <span>
                · {ASSURANCE_LABELS.frequency[tx.frequency].toLowerCase()}
              </span>
            )}
            {tx.performedAt && <span>{t("asr.provedeno", { p: fmtDay(tx.performedAt) })}</span>}
          </div>
        </div>
        {canTest && (
          <div className="flex gap-2">
            {done ? (
              <Button
                variant="secondary"
                disabled={reopen.isPending}
                onClick={async () =>
                  (await askConfirm(
                    t("asr.znovuOtevritDokoncenyTestZmena"),
                  )) && reopen.mutate()
                }
              >
                <RotateCcw size={15} /> {t("common.reopen")}
              </Button>
            ) : (
              <>
                <Button
                  variant="danger"
                  onClick={async () => (await askConfirm(t("asr.smazatTest"))) && del.mutate()}
                >
                  <Trash2 size={15} />
                </Button>
                <Button onClick={() => setComplete(true)}>
                  <CheckCircle2 size={15} /> {t("asr.dokoncitTest")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <ErrorBox
        error={
          save.error ??
          addSamples.error ??
          upd.error ??
          delSample.error ??
          reopen.error ??
          del.error
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title={t("asr.parametryTestu")} />
          <fieldset disabled={!editable} className="space-y-4 p-5">
            <Field label={t("asr.kdoTestuje")}>
              <Input
                value={f.tester}
                onChange={(e) => setF({ ...f, tester: e.target.value })}
              />
            </Field>
            <Field label={t("asr.termin2")}>
              <Input
                type="date"
                value={f.dueDate}
                onChange={(e) => setF({ ...f, dueDate: e.target.value })}
              />
            </Field>
            {tx.kind === "operating" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("asr.populace")}>
                  <Input
                    type="number"
                    min={0}
                    value={f.populationSize}
                    onChange={(e) =>
                      setF({ ...f, populationSize: e.target.value })
                    }
                  />
                </Field>
                <Field label={t("asr.tolerovaneVyjimky")}>
                  <Input
                    type="number"
                    min={0}
                    value={f.tolerableExceptions}
                    onChange={(e) =>
                      setF({
                        ...f,
                        tolerableExceptions: Number(e.target.value) || 0,
                      })
                    }
                  />
                </Field>
              </div>
            )}
            <Field label={t("asr.postupTestu")}>
              <Textarea
                rows={5}
                value={f.procedure}
                onChange={(e) => setF({ ...f, procedure: e.target.value })}
              />
            </Field>
            {editable && (
              <Button
                variant="secondary"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {t("asr.ulozitParametry")}
              </Button>
            )}
          </fieldset>
          {tx.recommended && (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
              {t("asr.doporucenyVzorek")}{" "}
              <strong>
                {tx.recommended.min === tx.recommended.max
                  ? tx.recommended.min
                  : `${tx.recommended.min}–${tx.recommended.max}`}
              </strong>
              {t("asr.zatim")} {tx.sampleCount}.
              {tx.sampleCount < tx.recommended.min && (
                <span className="text-amber-800">
                  {t("asr.vzorekJeMensiNezDoporuceny", { p: " " })}
                </span>
              )}
            </p>
          )}
          {done && tx.conclusion && (
            <div className="border-t border-slate-100 px-5 py-3 text-sm">
              <div className="text-xs font-medium uppercase text-slate-500">
                {t("asr.zaver")}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">
                {tx.conclusion}
              </p>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader
            title={t("asr.vzorky2", { sampleCount: tx.sampleCount })}
            subtitle={`${t("asr.odvozenyVysledekX", { p: t.lbl(ASSURANCE_LABELS.result[tx.derivedResult]) })}${tx.exceptions ? (" " + t("asr.vyjimkyTolerovano", { exceptions: tx.exceptions, tolerableExceptions: tx.tolerableExceptions })) : ""}`}
            action={
              editable && (
                <Button
                  variant="secondary"
                  className="px-2.5 py-1.5 text-xs"
                  onClick={() => setNewEv(true)}
                >
                  <Plus size={13} /> {t("asr.novyDukaz")}
                </Button>
              )
            }
          />
          {tx.samples.length === 0 ? (
            <EmptyState>
              {tx.kind === "design"
                ? t("asr.uTestuNavrhuStaciJeden")
                : t("asr.pridejteVybraneVyskytyNaprQ1")}
            </EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("asr.vzorek")}</th>
                  <th className="px-3 py-2">{t("asr.vysledek")}</th>
                  <th className="px-3 py-2">{t("asr.dukaz")}</th>
                  <th className="px-3 py-2">{t("asr.poznamka")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tx.samples.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap px-5 py-2 font-medium">
                      {s.ref}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Select
                          className="w-36 py-1 text-xs"
                          value={s.result}
                          onChange={(e) =>
                            upd.mutate({
                              sid: s.id,
                              data: { result: e.target.value as SampleResult },
                            })
                          }
                        >
                          {SAMPLE_RESULTS.map((r) => (
                            <option key={r} value={r}>
                              {t.lbl(ASSURANCE_LABELS.sample[r])}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge
                          tone={
                            s.result === "pass"
                              ? "green"
                              : s.result === "fail"
                                ? "red"
                                : "slate"
                          }
                        >
                          {t.lbl(ASSURANCE_LABELS.sample[s.result])}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Select
                          className="w-48 py-1 text-xs"
                          value={s.evidenceId ?? ""}
                          onChange={(e) =>
                            upd.mutate({
                              sid: s.id,
                              data: { evidenceId: e.target.value || null },
                            })
                          }
                        >
                          <option value="">—</option>
                          {(evidence.data ?? []).map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.title}
                            </option>
                          ))}
                        </Select>
                      ) : s.evidenceId ? (
                        <Link
                          to="/controls/evidence/$evidenceId"
                          params={{ evidenceId: s.evidenceId }}
                          className="text-xs text-brand-700 hover:underline"
                        >
                          {s.evidenceTitle}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Input
                          className="py-1 text-xs"
                          defaultValue={s.note ?? ""}
                          onBlur={(e) =>
                            e.target.value !== (s.note ?? "") &&
                            upd.mutate({
                              sid: s.id,
                              data: { note: e.target.value || null },
                            })
                          }
                          placeholder={
                            s.result === "fail" ? t("asr.popisVyjimky") : ""
                          }
                        />
                      ) : (
                        <span className="text-xs text-slate-600">{s.note}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editable && (
                        <button
                          className="text-xs text-slate-400 hover:text-red-700"
                          onClick={() => delSample.mutate(s.id)}
                        >
                          {t("asr.odebrat")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editable && (
            <div className="flex gap-2 border-t border-slate-100 p-4">
              <Input
                className="flex-1"
                placeholder={t("asr.noveVzorkyOddelteCarkouNebo")}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  bulk.trim() &&
                  addSamples.mutate(
                    bulk
                      .split(/[,\n]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  )
                }
              />
              <Button
                variant="secondary"
                disabled={!bulk.trim() || addSamples.isPending}
                onClick={() =>
                  addSamples.mutate(
                    bulk
                      .split(/[,\n]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  )
                }
              >
                <Plus size={15} /> {t("asr.pridat")}
              </Button>
            </div>
          )}
        </Card>
      </div>
      {complete && (
        <CompleteModal
          t={tx}
          initial={shownResult}
          onClose={() => setComplete(false)}
          onDone={setData}
        />
      )}
      {newEv && (
        <EvidenceModal
          controlIds={[tx.controlId]}
          onClose={() => setNewEv(false)}
        />
      )}
    </>
  );
}

function CompleteModal({
  t: tx,
  initial,
  onClose,
  onDone,
}: {
  t: ControlTestDto;
  initial: ControlTestResult;
  onClose: () => void;
  onDone: (d: ControlTestDto) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [result, setResult] = useState<ControlTestResult>(initial);
  const [conclusion, setConclusion] = useState("");
  const [performedAt, setPerformedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [apply, setApply] = useState(true);
  const eff = effectivenessFromResult(result);
  const m = useMutation({
    mutationFn: () =>
      api.assurance.completeTest(tx.id, {
        result,
        conclusion,
        performedAt,
        applyEffectiveness: apply,
      }),
    onSuccess: (d) => {
      onDone(d);
      qc.invalidateQueries({ queryKey: ["control", tx.controlId] });
      qc.invalidateQueries({ queryKey: ["controls"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("asr.dokoncitTest")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button
            disabled={!conclusion.trim() || m.isPending}
            onClick={() => m.mutate()}
          >
            {t("asr.dokoncit")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {t("asr.vzorku")} {tx.sampleCount}{t("asr.vyjimek")} {tx.exceptions}{t("asr.odvozenyVysledek")}{" "}
        <strong>{t.lbl(ASSURANCE_LABELS.result[tx.derivedResult])}</strong>.
        {tx.recommended && tx.sampleCount < tx.recommended.min && (
          <span className="text-amber-800">
            {t("asr.vzorekJeMensiNezDoporuceny2", { p: " ", min: tx.recommended.min })}
          </span>
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("asr.vysledek")}>
          <Select
            value={result}
            onChange={(e) => setResult(e.target.value as ControlTestResult)}
          >
            {CONTROL_TEST_RESULTS.map((r) => (
              <option key={r} value={r}>
                {t.lbl(ASSURANCE_LABELS.result[r])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("asr.datumProvedeni")}>
          <Input
            type="date"
            value={performedAt}
            onChange={(e) => setPerformedAt(e.target.value)}
          />
        </Field>
      </div>
      <Field
        label={t("asr.zaver")}
        hint={t("asr.coByloOverenoZjisteneVyjimky")}
      >
        <Textarea
          rows={4}
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value)}
        />
      </Field>
      {eff && (
        <Checkbox
          checked={apply}
          onChange={setApply}
          label={t("asr.nastavitUcinnostOpatreniNaA", { p: t.lbl(CONTROL_LABELS.effectiveness[eff]) })}
          hint={t("asr.ucinnostSePromitneDoNavrhu")}
        />
      )}
      <p className="text-xs text-slate-500">
        {t("asr.dokoncenyTestJeAuditniZaznam")}
      </p>
      <ErrorBox error={m.error} />
    </Modal>
  );
}
