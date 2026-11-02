/**
 * Ladění pravidel Wazuh – návrhy (v1.14, ADR-111): návrh z dat, ruční návrh, simulace nad indexerem, schválení (čtyři oči)
 * a export local_rules.xml. Do Wazuhu se nic nezapisuje.
 */
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { askConfirm, toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { TUNING_CONDITION_KINDS, TUNING_KINDS, TUNING_LABELS, tuningIndexPath, type TuningCondition, type TuningConditionKind, type TuningKind, type TuningProposalDto, type TuningStatus } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Download, FlaskConical, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

const STATUS_TONE: Record<TuningStatus, Tone> = { draft: "amber", approved: "green", rejected: "slate" };

export function condLabel(c: TuningCondition) {
  return `${tuningIndexPath(c)} ${c.op === "equals" ? "=" : "~"} ${c.value}`;
}

export function TuningCard() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["soc", "tuning"], queryFn: api.soc.tuning });
  const [creating, setCreating] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["soc", "tuning"] });
  const items = list.data ?? [];
  return (
    <Card className="mb-6 overflow-hidden" data-testid="tuning">
      <CardHeader
        title={t("soc.tune.title")}
        subtitle={t("soc.tune.sub")}
        action={
          <div className="flex gap-2">
            {items.some((x) => x.status === "approved") && (
              <a href={api.soc.tuningXmlUrl()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
                <Download size={14} /> {t("soc.tune.export")}
              </a>
            )}
            {can("soc:write") && (
              <Button variant="secondary" onClick={() => setCreating(true)}>
                <Plus size={14} /> {t("soc.tune.new")}
              </Button>
            )}
          </div>
        }
      />
      <ErrorBox error={list.error} />
      {!list.data ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : !items.length ? (
        <EmptyState>{t("soc.tune.empty")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((p) => (
            <TuningItem key={p.id} p={p} onChanged={refresh} />
          ))}
        </ul>
      )}
      {creating && <TuningModal onClose={() => setCreating(false)} onSaved={refresh} />}
    </Card>
  );
}

function TuningItem({ p, onChanged }: { p: TuningProposalDto; onChanged: () => void }) {
  const t = useT();
  const can = useCan();
  const [note, setNote] = useState("");
  const [showXml, setShowXml] = useState(false);
  const sim = useMutation({ mutationFn: () => api.soc.simulateTuning(p.id, 30), onSuccess: onChanged });
  const decide = useMutation({ mutationFn: (decision: "approve" | "reject") => api.soc.decideTuning(p.id, { decision, note: note.trim() || null }), onSuccess: onChanged });
  const del = useMutation({ mutationFn: () => api.soc.deleteTuning(p.id), onSuccess: onChanged });
  const s = p.simulation;
  const share = s && s.total ? Math.round((s.matched / s.total) * 100) : null;
  return (
    <li className="space-y-2 px-5 py-3 text-sm" data-testid="tuning-item">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-500">{p.ref}</span>
        <Badge tone={STATUS_TONE[p.status]}>{t.lbl(TUNING_LABELS.status[p.status])}</Badge>
        <span className="font-medium">
          {t.lbl(TUNING_LABELS.kind[p.kind])}
          {p.kind === "level" && ` → ${p.newLevel}`}
        </span>
        <span className="text-xs text-slate-500">
          {t("soc.tune.rule", { id: p.ruleId })} {p.ruleDescription && `· ${p.ruleDescription}`}
        </span>
        {p.source === "auto" && <Badge tone="blue">{t("soc.tune.auto")}</Badge>}
      </div>
      {p.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {p.conditions.map((c, i) => (
            <code key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
              {condLabel(c)}
            </code>
          ))}
        </div>
      )}
      {p.rationale && <p className="text-xs text-slate-600">{p.rationale}</p>}
      {s ? (
        <div className={s.protectedAlerts.length ? "rounded-md bg-red-50 px-3 py-2 text-xs text-red-900" : "rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700"} data-testid="tuning-sim">
          {t("soc.tune.sim", { matched: s.matched, total: s.total, share: share ?? 0, days: s.days, date: fmtDate(s.at) })}
          {s.source === "contix" && ` ${t("soc.tune.simContix")}`}
          {s.note && <div className="mt-1">{s.note}</div>}
          {s.protectedAlerts.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 font-medium">
              <AlertTriangle size={13} /> {t("soc.tune.protected", { n: s.protectedAlerts.length })}
              {s.protectedAlerts.map((a) => (
                <Link key={a.id} to="/soc/$alertId" params={{ alertId: a.id }} className="underline">
                  {a.title}
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-amber-700">{t("soc.tune.noSim")}</p>
      )}
      <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setShowXml(!showXml)}>
        {showXml ? t("soc.tune.hideXml") : t("soc.tune.showXml")}
      </button>
      {showXml && <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-[11px]">{p.xml}</pre>}
      {p.status !== "draft" && (
        <p className="text-xs text-slate-500">
          {t("soc.tune.decided", { who: p.decidedByName ?? "—", date: p.decidedAt ? fmtDate(p.decidedAt) : "" })}
          {p.decisionNote && ` – ${p.decisionNote}`}
        </p>
      )}
      {p.status === "draft" && (
        <div className="flex flex-wrap items-center gap-2">
          {can("soc:write") && (
            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={sim.isPending} onClick={() => sim.mutate()}>
              <FlaskConical size={13} /> {t("soc.tune.simulate")}
            </Button>
          )}
          {p.canDecide && (
            <>
              <Input className="w-64 py-1 text-xs" placeholder={t("soc.tune.notePh")} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("soc.tune.note")} />
              <Button className="px-2.5 py-1 text-xs" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
                <Check size={13} /> {t("soc.tune.approve")}
              </Button>
              <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
                <X size={13} /> {t("soc.tune.reject")}
              </Button>
            </>
          )}
          {!p.canDecide && can("soc:respond") && <span className="text-xs text-slate-500">{t("soc.tune.otherApprover")}</span>}
          {can("soc:write") && (
            <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" aria-label={t("common.delete")} onClick={async () => (await askConfirm(t("soc.tune.deleteConfirm", { ref: p.ref }))) && del.mutate()}>
              <Trash2 size={13} />
            </Button>
          )}
        </div>
      )}
      <ErrorBox error={sim.error ?? decide.error ?? del.error} />
    </li>
  );
}

/** Tlačítko u pravidla v Ladění pravidel – návrh výjimky z dat indexeru. */
export function SuggestTuningButton({ ruleId }: { ruleId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.soc.suggestTuning(ruleId, 30),
    onSuccess: (p) => {
      toast(t("soc.tune.suggested", { ref: p.ref }));
      qc.invalidateQueries({ queryKey: ["soc", "tuning"] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
  return (
    <Button variant="ghost" disabled={m.isPending} onClick={() => m.mutate()} aria-label={t("soc.tune.suggestFor", { id: ruleId })} title={t("soc.tune.suggestFor", { id: ruleId })}>
      <FlaskConical size={14} />
    </Button>
  );
}

function TuningModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [ruleId, setRuleId] = useState("");
  const [kind, setKind] = useState<TuningKind>("exclude");
  const [newLevel, setNewLevel] = useState(3);
  const [conds, setConds] = useState<{ kind: TuningConditionKind; field: string; op: "equals" | "regex"; value: string }[]>([{ kind: "srcip", field: "", op: "equals", value: "" }]);
  const [rationale, setRationale] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api.soc.createTuning({
        ruleId: ruleId.trim(),
        kind,
        newLevel: kind === "level" ? newLevel : null,
        conditions: conds.filter((c) => c.value.trim()).map((c) => ({ kind: c.kind, field: c.kind === "field" ? c.field.trim() : null, op: c.op, value: c.value.trim() })),
        rationale,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const set = (i: number, v: Partial<(typeof conds)[number]>) => setConds((x) => x.map((c, j) => (j === i ? { ...c, ...v } : c)));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("soc.tune.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("ui.confirm.cancel")}
          </Button>
          <Button disabled={!ruleId.trim() || save.isPending} onClick={() => save.mutate()}>
            {t("soc.tune.create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("soc.tune.ruleId")}>
          <Input value={ruleId} onChange={(e) => setRuleId(e.target.value)} placeholder="60106" />
        </Field>
        <Field label={t("soc.tune.kind")}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as TuningKind)}>
            {TUNING_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(TUNING_LABELS.kind[k])}
              </option>
            ))}
          </Select>
        </Field>
        {kind === "level" && (
          <Field label={t("soc.tune.newLevel")}>
            <Input type="number" min={0} max={15} value={newLevel} onChange={(e) => setNewLevel(Number(e.target.value))} />
          </Field>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium text-slate-700">{t("soc.tune.conditions")}</div>
        {conds.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[10rem_10rem_7rem_1fr_auto]">
            <Select value={c.kind} onChange={(e) => set(i, { kind: e.target.value as TuningConditionKind, op: e.target.value === "srcip" || e.target.value === "dstip" ? "equals" : c.op })} aria-label={t("soc.tune.condKind")}>
              {TUNING_CONDITION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t.lbl(TUNING_LABELS.condition[k])}
                </option>
              ))}
            </Select>
            <Input value={c.field} disabled={c.kind !== "field"} onChange={(e) => set(i, { field: e.target.value })} placeholder="win.eventdata.image" aria-label={t("soc.tune.field")} />
            <Select value={c.op} disabled={c.kind === "srcip" || c.kind === "dstip"} onChange={(e) => set(i, { op: e.target.value as "equals" | "regex" })} aria-label={t("soc.tune.op")}>
              <option value="equals">{t("soc.tune.opEquals")}</option>
              <option value="regex">{t("soc.tune.opRegex")}</option>
            </Select>
            <Input value={c.value} onChange={(e) => set(i, { value: e.target.value })} aria-label={t("soc.tune.value")} />
            <Button variant="ghost" type="button" aria-label={t("common.delete")} onClick={() => setConds((x) => x.filter((_, j) => j !== i))}>
              <X size={14} />
            </Button>
          </div>
        ))}
        {conds.length < 5 && (
          <Button variant="secondary" type="button" className="px-2.5 py-1 text-xs" onClick={() => setConds((x) => [...x, { kind: "field", field: "", op: "equals", value: "" }])}>
            <Plus size={13} /> {t("soc.tune.addCond")}
          </Button>
        )}
        <p className="text-xs text-slate-500">{t("soc.tune.condHint")}</p>
      </div>
      <Field label={t("soc.tune.rationale")}>
        <Textarea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
