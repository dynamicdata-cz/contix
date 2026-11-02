import { FrameworkOptions } from "@/components/frameworkOptions";
import { useT, lbl, tt } from "@/lib/i18n";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorBox,
  Input,
  Select,
  SuccessBox,
  type Tone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import {
  AIACT_LABELS,
  AI_SET_FIELD_LABELS,
  INCIDENT_LABELS,
  VEX_LABELS,
  actionableItems,
  AI_FIELD_LABELS,
  AI_STATUS_LABELS,
  AI_USE_CASE_LABELS,
  CONTROL_LABELS,
  GAP_LABELS,
  gapScore,
  type GapStatus,
  type AiItem,
  type AiSuggestionDto,
  type AiUseCase,
  type FrameworkId, SUPPLIER_REPORT_LABELS, TRUST_LABELS } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

/** Popisek hodnoty návrhu „set“ podle pole. */
function setValueLabel(field: string, v: string): string {
  const m: Record<string, Record<string, string>> = {
    prohibited: AIACT_LABELS.prohibited,
    annexIII: AIACT_LABELS.annexIII,
    exception: AIACT_LABELS.exception,
    transparency: AIACT_LABELS.transparency,
    kind: INCIDENT_LABELS.kind,
    category: INCIDENT_LABELS.category,
    cause: INCIDENT_LABELS.cause,
  };
  return m[field]?.[v] ?? v;
}

export const aiStatusTone: Record<AiSuggestionDto["status"], Tone> = {
  running: "blue",
  proposed: "violet",
  accepted: "green",
  partially_accepted: "green",
  rejected: "slate",
  failed: "red",
};

const dt = (v: string) =>
  new Date(v).toLocaleString("cs-CZ", {
    dateStyle: "short",
    timeStyle: "short",
  });

/** Hook: je AI asistent pro danou úlohu dostupný? */
export function useAi(useCase: AiUseCase) {
  const can = useCan();
  const st = useQuery({
    queryKey: ["ai", "status"],
    queryFn: api.ai.status,
    enabled: can("ai:use"),
    staleTime: 60_000,
  });
  return {
    available: !!st.data?.enabled && st.data.useCases.includes(useCase),
    model: st.data?.model ?? null,
  };
}

/**
 * Panel AI asistenta u záznamu. Návrhy jsou vizuálně odlišené, obsahují zdůvodnění a nic se neaplikuje bez rozhodnutí člověka.
 * `canApply` = uživatel smí záznam upravit (jinak může návrh jen vyžádat a zobrazit).
 */
export function AiSuggestPanel({
  useCase,
  entityId,
  canApply,
  onApplied,
}: {
  useCase: AiUseCase;
  entityId: string;
  canApply: boolean;
  onApplied?: (s: AiSuggestionDto) => void;
}) {
  const t = useT();
  const { available, model } = useAi(useCase);
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [framework, setFramework] = useState<FrameworkId | "">("");
  const [showHistory, setShowHistory] = useState(false);
  const list = useQuery({
    queryKey: ["ai", "entity", entityId],
    queryFn: () => api.ai.forEntity(entityId),
    enabled: available,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((s) => s.status === "running") ? 3000 : false,
  });
  const ask = useMutation({
    mutationFn: () =>
      api.ai.request({
        useCase,
        entityId,
        note: note.trim() || undefined,
        framework: framework || undefined,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["ai", "entity", entityId] }),
  });
  if (!available) return null;
  // na jednom záznamu může být víc úloh (např. shrnutí a triáž incidentu)
  const items = (list.data ?? []).filter((s) => s.useCase === useCase);
  const latest = items[0];
  const running = latest?.status === "running";
  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles size={16} className="text-violet-600" /> {t("ai.aiAsistent2")}{" "}
            {AI_USE_CASE_LABELS[useCase].charAt(0).toLowerCase() +
              AI_USE_CASE_LABELS[useCase].slice(1)}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("ai.navrhLokalnihoModeluZkontrolujteHo", { model: model })}
          </p>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap gap-2">
          {useCase === "control_mapping" && (
            <Select
              className="w-44"
              value={framework}
              onChange={(e) => setFramework(e.target.value as FrameworkId | "")}
            >
              <option value="">{t("ai.ramecDleRezimu")}</option>
              <FrameworkOptions label="short" />
            </Select>
          )}
          <Input
            className="min-w-48 flex-1"
            placeholder={t("ai.upresneniNepovinneNaprPreferujemeTechnic")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            variant="secondary"
            className="border-violet-300 text-violet-800"
            disabled={running || ask.isPending}
            onClick={() => ask.mutate()}
          >
            <Sparkles size={14} /> {latest ? t("ai.navrhnoutZnovu") : "Navrhnout"}
          </Button>
        </div>
        <ErrorBox error={ask.error ?? list.error} />
        {latest && (
          <SuggestionView
            key={latest.id + latest.status}
            s={latest}
            canApply={canApply}
            onApplied={onApplied}
          />
        )}
        {items.length > 1 && (
          <div>
            <button
              className="text-xs text-slate-500 hover:text-slate-800"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? t("ai.skryt") : "Zobrazit"} {t("ai.predchoziNavrhy")}
              {items.length - 1})
            </button>
            {showHistory && (
              <ul className="mt-2 divide-y divide-violet-100 rounded-md border border-violet-100 bg-white text-xs">
                {items.slice(1).map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                    <Badge tone={aiStatusTone[s.status]}>
                      {t.lbl(AI_STATUS_LABELS[s.status])}
                    </Badge>
                    <span className="text-slate-600">{dt(s.createdAt)}</span>
                    <span className="text-slate-500">
                      {decisionCount(s)}{" "}
                      · {s.createdByName ?? "?"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

const CRIT_LABELS: Record<string, string> = {
  low: "nízká",
  medium: "střední",
  high: "vysoká",
  critical: "kritická",
};
const ciaLabel = (v: string | number | null) =>
  v == null
    ? "—"
    : typeof v === "number"
      ? `${v} – ${lbl(["", "nízká", "střední", "vysoká", "kritická"][v] ?? "")}`
      : (lbl(CRIT_LABELS[v]) ?? v);

function ItemBody({ it }: { it: AiItem }) {
  const t = useT();
  if (it.kind === "field")
    return (
      <div>
        <div>
          <span className="font-medium">{t.lbl(AI_FIELD_LABELS[it.field])}:</span>{" "}
          <span className="text-slate-500 line-through">
            {ciaLabel(it.current)}
          </span>{" "}
          → <strong>{ciaLabel(it.value)}</strong>
        </div>
        {it.reason && (
          <div className="mt-0.5 text-xs text-slate-500">
            {t("ai.zduvodneniAi", { reason: it.reason })}
          </div>
        )}
      </div>
    );
  if (it.kind === "text")
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t.lbl(AI_FIELD_LABELS[it.field])}</span>
          {it.field === "summary" ? (
            <button
              className="text-xs text-brand-700 hover:underline"
              onClick={() => navigator.clipboard?.writeText(it.text)}
            >
              {t("ai.kopirovat")}
            </button>
          ) : (
            it.hasValue && (
              <Badge tone="amber">{t("ai.poleUzJeVyplneneText")}</Badge>
            )
          )}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{it.text}</p>
      </div>
    );
  if (it.kind === "gap")
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={
              it.status === "covered"
                ? "green"
                : it.status === "partial"
                  ? "amber"
                  : "red"
            }
          >
            {t.lbl(GAP_LABELS[it.status])}
          </Badge>
          <span className="font-medium">{it.ref}</span>
        </div>
        <div className="mt-0.5 text-slate-700">{it.text}</div>
        {it.reason && (
          <div className="mt-0.5 text-xs text-slate-500">{t("ai.ai", { reason: it.reason })}</div>
        )}
        {it.suggestion && (
          <div className="mt-1 rounded bg-blue-50 px-2 py-1 text-xs text-blue-900">{t("ai.nametKeZlepseni", { suggestion: it.suggestion })}</div>
        )}
      </div>
    );
  if (it.kind === "legal_task")
    return (
      <div>
        <div className="font-medium">{it.title}</div>
        {it.description && <div className="mt-0.5 whitespace-pre-wrap text-slate-700">{it.description}</div>}
        <div className="mt-1 flex flex-wrap gap-1">
          {it.policyLabel && <Badge tone="blue">{it.policyLabel}</Badge>}
          {it.requirementRef && <Badge tone="violet">{it.requirementRef}</Badge>}
        </div>
      </div>
    );
  if (it.kind === "treatment")
    return (
      <div>
        <div className="font-medium">{it.title}</div>
        {it.description && (
          <div className="mt-0.5 text-slate-700">{it.description}</div>
        )}
        {it.objective && (
          <div className="mt-0.5 text-xs text-slate-500">
            {t("ai.cil", { objective: it.objective })}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {it.category &&
            t.lbl(CONTROL_LABELS.category[
              it.category as keyof typeof CONTROL_LABELS.category
            ]) && (
              <Badge>
                {
                  t.lbl(CONTROL_LABELS.category[
                    it.category as keyof typeof CONTROL_LABELS.category
                  ])
                }
              </Badge>
            )}
          {it.paragraphs.map((p) => (
            <Badge key={p} tone="violet">
              § {p}
            </Badge>
          ))}
        </div>
      </div>
    );
  if (it.kind === "set") {
    const one = (v: string | boolean | null) => (v === null ? "—" : typeof v === "boolean" ? (v ? t("ai.yes") : t("ai.no")) : t.lbl(setValueLabel(it.field, v)));
    const fmt = (v: typeof it.value) => (Array.isArray(v) ? (v.length ? v.map(one).join(", ") : "—") : one(v));
    return (
      <div>
        <div>
          <span className="font-medium">{t.lbl(AI_SET_FIELD_LABELS[it.field] ?? it.field)}:</span> <span className="text-slate-500 line-through">{fmt(it.current)}</span> → <strong>{fmt(it.value)}</strong>
        </div>
        {it.reason && <div className="mt-0.5 text-xs text-slate-500">{t("ai.zduvodneniAi", { reason: it.reason })}</div>}
      </div>
    );
  }
  if (it.kind === "qa_answer")
    return (
      <div>
        <div className="text-slate-800">{it.question}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {it.answer && <Badge tone="violet">{t.lbl(TRUST_LABELS.answer[it.answer])}</Badge>}
          <span className="text-slate-700">{it.answerText}</span>
        </div>
        {it.sources.length > 0 && <div className="mt-0.5 text-xs text-slate-500">{it.sources.map((s) => `${t.lbl(TRUST_LABELS.source[s.kind])}: ${s.label}`).join(" · ")}</div>}
        {it.reason && <div className="mt-0.5 text-xs text-slate-500">{t("ai.zduvodneniAi", { reason: it.reason })}</div>}
      </div>
    );
  if (it.kind === "report_item")
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={it.itemKind === "exception" ? "red" : it.itemKind === "cuec" ? "violet" : "slate"}>{t.lbl(SUPPLIER_REPORT_LABELS.itemKind[it.itemKind])}</Badge>
          {it.ref && <span className="font-mono text-xs text-slate-500">{it.ref}</span>}
          {it.criterion && <span className="text-xs text-slate-600">{it.criterion}</span>}
          {it.severity && <span className="text-xs text-slate-600">{t.lbl(SUPPLIER_REPORT_LABELS.severity[it.severity])}</span>}
        </div>
        <div className="mt-0.5 text-slate-800">{it.text}</div>
        {it.controlName && <div className="mt-0.5 text-xs text-slate-600">→ {it.controlName}</div>}
        {it.managementResponse && <div className="mt-0.5 text-xs text-slate-600">{it.managementResponse}</div>}
        {it.reason && <div className="mt-0.5 text-xs text-slate-500">{t("ai.zduvodneniAi", { reason: it.reason })}</div>}
      </div>
    );
  if (it.kind === "vuln_triage")
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={it.action === "verify" ? "red" : "slate"}>{t(`ai.vulnTriage.${it.action}` as "ai.vulnTriage.verify")}</Badge>
          <span className="text-slate-800">{it.title}</span>
        </div>
        {it.duplicateTitle && <div className="mt-0.5 text-xs text-slate-600">{t("ai.vulnTriage.of", { title: it.duplicateTitle })}</div>}
        {it.reason && <div className="mt-0.5 text-xs text-slate-500">{t("ai.zduvodneniAi", { reason: it.reason })}</div>}
      </div>
    );
  if (it.kind === "vex")
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold">{it.vulnId}</span>
          <span className="text-xs text-slate-500">{it.componentRef}</span>
          <Badge tone={it.status === "not_affected" ? "green" : it.status === "affected" ? "red" : "slate"}>{t.lbl(VEX_LABELS.status[it.status as keyof typeof VEX_LABELS.status] ?? it.status)}</Badge>
          {it.justification && <span className="text-xs text-slate-600">{t.lbl(VEX_LABELS.justification[it.justification as keyof typeof VEX_LABELS.justification] ?? it.justification)}</span>}
        </div>
        {(it.impactStatement || it.actionStatement) && <div className="mt-0.5 text-slate-700">{[it.impactStatement, it.actionStatement].filter(Boolean).join(" ")}</div>}
        {it.reason && <div className="mt-0.5 text-xs text-slate-500">{t("ai.zduvodneniAi", { reason: it.reason })}</div>}
      </div>
    );
  if (it.kind !== "mapping") return null;
  return (
    <div>
      <div>
        <span className="font-medium">{it.ref}</span>{" "}
        <span className="text-slate-700">{it.text}</span>
      </div>
      {it.reason && (
        <div className="mt-0.5 text-xs text-slate-500">
          {t("ai.zduvodneniAi", { reason: it.reason })}
        </div>
      )}
    </div>
  );
}

function SuggestionView({
  s,
  canApply,
  onApplied,
}: {
  s: AiSuggestionDto;
  canApply: boolean;
  onApplied?: (s: AiSuggestionDto) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // u skóre dokumentu má smysl přijmout jen náměty (částečně / chybí) – ty založí připomínky
  const [sel, setSel] = useState<number[]>(actionableItems(s.items as never));
  const [reason, setReason] = useState("");
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (s.status !== "running") return;
    const t0 = new Date(s.createdAt).getTime();
    const h = setInterval(
      () => setElapsed(Math.round((Date.now() - t0) / 1000)),
      1000,
    );
    return () => clearInterval(h);
  }, [s.status, s.createdAt]);
  const decide = useMutation({
    mutationFn: ({ accept, acknowledge }: { accept: number[]; acknowledge?: boolean }) =>
      api.ai.decide(s.id, { accept, acknowledge, note: reason.trim() || undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["ai", "entity", s.entityId] });
      onApplied?.(r.suggestion);
    },
  });

  const isInfo = s.useCase === "policy_review";
  if (s.status === "running")
    return (
      <div className="flex items-center gap-2 rounded-md bg-white px-3 py-3 text-sm text-slate-600">
        <Loader2 size={16} className="animate-spin text-violet-600" /> {t("ai.modelPracuje")} {elapsed > 0 && `${elapsed} s`} {t("ai.lokalniModelSUvazovanimObvykle")}
      </div>
    );
  if (s.status === "failed")
    return (
      <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
        {t("ai.navrhSeNepodaril", { error: s.error })}
      </div>
    );

  const decided = s.status !== "proposed";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone={aiStatusTone[s.status]}>
          {t("ai.navrhAi", { p: t.lbl(AI_STATUS_LABELS[s.status]) })}
        </Badge>
        <span>
          {s.model} · {dt(s.createdAt)}
          {s.durationMs ? ` · ${(s.durationMs / 1000).toFixed(0)} s` : ""} {t("ai.vyzadalA")} {s.createdByName ?? "?"}
        </span>
        {decided && s.decidedByName && (
          <span>
            {t("ai.rozhodlA", { decidedByName: s.decidedByName, p: s.decidedAt ? dt(s.decidedAt) : "" })}
          </span>
        )}
      </div>
      {s.useCase === "policy_review" && gapScore(s.items.filter((x) => x.kind === "gap") as { status: GapStatus }[]) != null && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">{t("ai.skorePokrytiPozadavku")}</span>
          <span className="text-lg font-semibold">{gapScore(s.items.filter((x) => x.kind === "gap") as { status: GapStatus }[])} %</span>
          <span className="text-xs text-slate-500">{t("ai.pokryto1Castecne05")}</span>
        </div>
      )}
      {s.summary && <p className="text-sm text-slate-700">{s.summary}</p>}
      {s.items.length === 0 ? (
        <p className="text-sm text-slate-500">
          {t("ai.modelNenaselVhodnePolozkyNebo")}
        </p>
      ) : (
        <ul className="divide-y divide-violet-100 rounded-md border border-violet-100 bg-white text-sm">
          {s.items.map((it, i) => (
            <li
              key={i}
              className={`flex gap-3 px-3 py-2.5 ${decided && !s.acceptedItems.includes(i) ? "opacity-50" : ""}`}
            >
              {!decided && canApply ? (
                <div className="pt-0.5">
                  <Checkbox
                    checked={sel.includes(i)}
                    onChange={(v) =>
                      setSel(
                        v
                          ? [...sel, i].sort((a, b) => a - b)
                          : sel.filter((x) => x !== i),
                      )
                    }
                    label=""
                  />
                </div>
              ) : decided ? (
                <span
                  className={`pt-0.5 text-xs ${s.acceptedItems.includes(i) ? "text-green-700" : "text-slate-400"}`}
                >
                  {s.acceptedItems.includes(i) ? "✓" : "–"}
                </span>
              ) : null}
              <ItemBody it={it} />
            </li>
          ))}
        </ul>
      )}
      {decided && s.decisionNote && (
        <p className="text-xs text-slate-500">
          {t("ai.poznamkaKRozhodnuti", { decisionNote: s.decisionNote })}
        </p>
      )}
      {!decided && canApply && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-48 flex-1"
            placeholder={t("ai.poznamkaKRozhodnutiNepovinne")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            disabled={(!sel.length && !isInfo) || decide.isPending}
            onClick={() => decide.mutate({ accept: sel, acknowledge: isInfo })}
          >
            {isInfo
              ? sel.length
                ? t("ai.zalozitPripominkyZNametu", { length: sel.length })
                : t("ai.vzitNaVedomi")
              : t("ai.prijmoutVybrane", { length: sel.length })}
          </Button>
          <Button
            variant="ghost"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ accept: [] })}
          >
            {t("ai.zamitnout")}
          </Button>
        </div>
      )}
      {!decided && !canApply && (
        <p className="text-xs text-slate-500">
          {t("ai.navrhMuzePrijmoutVlastnikZaznamu")}
        </p>
      )}
      {decide.data && <SuccessBox>{decisionText(decide.data)}</SuccessBox>}
      <ErrorBox error={decide.error} />
    </div>
  );
}

function decisionText(d: Record<string, unknown>) {
  if (d.createdActions != null)
    return tt("ai.dec.actions", { n: d.createdActions as number });
  if (d.addedRequirements != null)
    return tt("ai.dec.requirements", { n: d.addedRequirements as number });
  if (d.updatedFields != null) return tt("ai.dec.fields", { n: d.updatedFields as number });
  if (d.addedMeasures != null)
    return tt("ai.dec.measures", { n: d.addedMeasures as number });
  if (d.acknowledged != null)
    return tt("ai.dec.acknowledged", { n: d.acknowledged as number });
  return tt("ai.dec.rejected");
}

/** „přijato 2/5“ – u skóre dokumentu jen náměty (pokryté požadavky se nepřijímají). */
export function decisionCount(s: { useCase: string; items: unknown[]; acceptedItems: number[] }) {
  const act = actionableItems(s.items as never);
  if (s.useCase === "policy_review") return act.length ? tt("ai.dec.suggestionsAccepted", { a: s.acceptedItems.filter((i) => act.includes(i)).length, n: act.length }) : tt("ai.dec.allCovered");
  return tt("ai.dec.accepted", { a: s.acceptedItems.length, n: s.items.length });
}
