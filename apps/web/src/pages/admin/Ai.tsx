import { useT } from "@/lib/i18n";
import { aiStatusTone, decisionCount } from "@/components/ai";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { AI_PRESETS, AI_PROVIDERS, AI_PROVIDER_LABELS, AI_STATUS_LABELS, AI_USE_CASE_LABELS, type AiLogRow, type AiProvider, type AiSettingsDto, RECORD_KINDS, RECORD_LABELS, type RecordKind } from "@contix/shared";
import { cn, useDebounced } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const dt = (v: string) => new Date(v).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });

/** Administrace AI asistenta: připojení k lokálnímu modelu (Ollama / Open WebUI) a auditní přehled návrhů. */
export function AdminAiPage() {
  const can = useCan();
  const q = useQuery({ queryKey: ["ai", "settings"], queryFn: api.ai.settings, enabled: can("admin:settings") });
  return (
    <div className="space-y-6">
      {can("admin:settings") && (q.data ? <SettingsForm key={q.data.lastTestAt ?? "x"} s={q.data} /> : <ErrorBox error={q.error} />)}
      <AiLog />
      <QueryLog />
    </div>
  );
}

function SettingsForm({ s }: { s: AiSettingsDto }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ ...s, apiKey: "", clearKey: false, ipsText: s.mcpAllowedIps.join("\n") });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api.ai.saveSettings({
        enabled: f.enabled,
        provider: f.provider,
        baseUrl: f.baseUrl,
        model: f.model,
        timeoutSec: f.timeoutSec,
        temperature: f.temperature,
        instructions: f.instructions || null,
        mcpEnabled: f.mcpEnabled,
        mcpAllowedIps: f.ipsText.split(/[\s,;]+/).filter(Boolean),
        docQaEnabled: f.docQaEnabled,
        recordSearchEnabled: f.recordSearchEnabled,
        embeddingModel: f.embeddingModel,
        ...(f.apiKey ? { apiKey: f.apiKey } : f.clearKey ? { apiKey: "" } : {}),
      }),
    onSuccess: (d) => {
      qc.setQueryData(["ai", "settings"], d);
      qc.invalidateQueries({ queryKey: ["ai", "status"] });
      setF((x) => ({ ...x, apiKey: "", clearKey: false, apiKeySet: d.apiKeySet }));
    },
  });
  // test vždy nad aktuálním formulářem – nejdřív uložit (jinak by se testoval starý / chybějící klíč)
  const test = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      return api.ai.test();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai", "settings"] }),
  });
  const models = useMutation({ mutationFn: api.ai.models });
  return (
    <Card>
      <CardHeader
        title={t("ai.aiAsistent")}
        subtitle={t("ai.navrhyOpatreniKRizikumA")}
      />
      <div className="space-y-4 p-5">
        <Checkbox checked={f.enabled} onChange={(v) => set("enabled", v)} label={t("ai.zapnoutAiAsistenta")} hint={t("ai.uzivateleSOpravnenimPouzivatAi")} />
        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-700">{t("ai.predvolby")}</div>
          <div className="flex flex-wrap gap-2">
            {AI_PRESETS.map((p) => (
              <button
                key={p.key}
                title={p.hint}
                onClick={() => setF((x) => ({ ...x, provider: p.provider, baseUrl: p.baseUrl }))}
                className={`rounded-md border px-2.5 py-1.5 text-xs ${f.baseUrl === p.baseUrl && f.provider === p.provider ? "border-brand-400 bg-brand-50 text-brand-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("ai.typRozhrani")}>
            <Select value={f.provider} onChange={(e) => set("provider", e.target.value as AiProvider)}>
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t.lbl(AI_PROVIDER_LABELS[p])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("ai.adresaServeru")} hint={f.provider === "openai" ? "Open WebUI: http://<server>:8080/api" : t("ai.ollamaHttpServer11434Pres")}>
            <Input value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />
          </Field>
          <Field label={t("ai.model")}>
            <div className="flex gap-2">
              <Input value={f.model} onChange={(e) => set("model", e.target.value)} list="ai-models" />
              <Button variant="secondary" className="whitespace-nowrap px-2.5 text-xs" disabled={models.isPending} onClick={() => models.mutate()} title={t("ai.nacistSeznamModeluZUlozene")}>
                {t("ai.nacistModely")}
              </Button>
            </div>
            <datalist id="ai-models">
              {(models.data?.models ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label={t("ai.apiKlic")} hint={s.apiKeySet ? t("ai.klicJeUlozenSifrovaneVyplnenim") : t("ai.openWebuiNastaveniUcetApi")}>
            <Input type="password" autoComplete="off" value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder={s.apiKeySet ? "••••••••" : ""} />
          </Field>
          <Field label={t("ai.casovyLimitDotazuS")} hint={t("ai.lokalniModelSUvazovanimGpt")}>
            <Input type="number" min={10} max={900} value={f.timeoutSec} onChange={(e) => set("timeoutSec", Number(e.target.value) || 240)} />
          </Field>
          <Field label={t("ai.teplota")} hint={t("ai.0Deterministicke02Doporuceno")}>
            <Input type="number" min={0} max={1.5} step={0.1} value={f.temperature} onChange={(e) => set("temperature", Number(e.target.value))} />
          </Field>
        </div>
        {s.apiKeySet && <Checkbox checked={f.clearKey} onChange={(v) => set("clearKey", v)} label={t("ai.smazatUlozenyApiKlic")} />}
        <Field label={t("ai.doplnujiciPokynyProModel")} hint={t("ai.naprTerminologieOrganizacePreferovanaOpa")}>
          <Textarea rows={2} value={f.instructions ?? ""} onChange={(e) => set("instructions", e.target.value)} />
        </Field>
        <div className="space-y-2 rounded-md border border-slate-200 p-3">
          <Checkbox
            checked={f.mcpEnabled}
            onChange={(v) => set("mcpEnabled", v)}
            label={t("ai.zapnoutMcpServerApiMcp")}
            hint={t("ai.externiAiKlientSePripoji")}
          />
          <p className="rounded bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            {t("ai.dataZNastrojuZpracuje")} <b>{t("ai.modelKlienta")}</b>{t("ai.neModelNastavenyVyseAby")}
          </p>
          <Field label={t("ai.povoleneIpAdresyMcpKlientu")} hint={t("ai.jednaNaRadekIpv4Rozsah")}>
            <Textarea rows={2} value={f.ipsText} placeholder={t("ai.napr1921681250")} onChange={(e) => set("ipsText", e.target.value)} />
          </Field>
        </div>
        <div className="space-y-2 rounded-md border border-slate-200 p-3">
          <Checkbox
            checked={f.docQaEnabled}
            onChange={(v) => set("docQaEnabled", v)}
            label={t("ai.zeptejSeDokumentace")}
            hint={t("ai.zamestnanciSeVDokumentechZeptaji")}
          />
          <Field label={t("ai.modelProVyhledavaniPodleVyznamu")} hint={t("ai.doporucenoBgeM3VicejazycnyCestina")}>
            <Input value={f.embeddingModel} onChange={(e) => set("embeddingModel", e.target.value)} list="ai-models" />
          </Field>
          {s.docQaEnabled && <DocIndexStatus />}
          <Checkbox checked={f.recordSearchEnabled} onChange={(v) => set("recordSearchEnabled", v)} label={t("rec.adminLabel")} hint={t("rec.adminHint")} />
          {s.recordSearchEnabled && <RecordIndexStatus />}
        </div>
        {models.data && <p className="text-xs text-slate-500">{t("ai.modelyNaServeru")} {models.data.models.join(", ") || t("ai.zadne")}</p>}
        {s.lastTestAt && (
          <p className={`text-sm ${s.lastTestResult?.startsWith("Spojení funguje") ? "text-green-800" : "text-amber-800"}`}>
            {t("ai.posledniTest", { p: dt(s.lastTestAt), lastTestResult: s.lastTestResult })}
          </p>
        )}
        {!f.enabled && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t("ai.aiAsistentJeVypnutyPanel")}
          </p>
        )}
        <ErrorBox error={save.error ?? models.error ?? test.error} />
        {save.isSuccess && <SuccessBox>{t("ai.ulozeno")}</SuccessBox>}
        {test.data && !test.data.ok && <ErrorBox error={new Error(test.data.message)} />}
        <div className="flex gap-2">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("ai.ulozit")}
          </Button>
          <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? t("ai.ukladamATestujiMuzeTrvat") : t("ai.ulozitAOtestovatSpojeni")}
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          {t("ai.serverSModelemMusiByt")}
        </p>
      </div>
    </Card>
  );
}

function AiLog() {
  const t = useT();
  const q = useQuery({ queryKey: ["ai", "log"], queryFn: api.ai.log });
  const [open, setOpen] = useState<AiLogRow | null>(null);
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("ai.zaznamyAi")} subtitle={t("ai.auditniStopaKdoSiNavrh")} />
      <ErrorBox error={q.error} />
      {(q.data ?? []).length === 0 ? (
        <EmptyState>{q.isLoading ? t("common.loading") : t("ai.zatimZadneDotazyNaAi")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("ai.kdy")}</th>
              <th className="px-3 py-2">{t("ai.ulohaZaznam")}</th>
              <th className="px-3 py-2">{t("ai.model")}</th>
              <th className="px-3 py-2">{t("ai.stav")}</th>
              <th className="px-3 py-2">{t("ai.vyzadalRozhodl")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(q.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2 whitespace-nowrap text-xs text-slate-600">{dt(r.createdAt)}</td>
                <td className="px-3 py-2">
                  <div className="text-xs text-slate-500">{t.lbl(AI_USE_CASE_LABELS[r.useCase])}</div>
                  <div>{r.entityName ?? "—"}</div>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {r.model}
                  {r.durationMs ? <div>{(r.durationMs / 1000).toFixed(0)} s</div> : null}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={aiStatusTone[r.status]}>{t.lbl(AI_STATUS_LABELS[r.status])}</Badge>
                  {r.items.length > 0 && <div className="mt-0.5 text-xs text-slate-500">{decisionCount(r)}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {r.createdByName ?? "—"}
                  {r.decidedByName && <div>{r.decidedByName}</div>}
                </td>
                <td className="px-5 py-2 text-right">
                  <button className="text-xs text-brand-700 hover:underline" onClick={() => setOpen(r)}>
                    {t("ai.detail")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={t("ai.zaznamAi")} footer={<Button onClick={() => setOpen(null)}>{t("common.close")}</Button>}>
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-slate-500">{t("ai.odeslanyKontext")}</div>
              <pre className="max-h-60 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(open.input, null, 2)}</pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-slate-500">{t("ai.odpovedModelu")}</div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{open.rawOutput ?? open.error ?? "—"}</pre>
            </div>
            {open.decisionNote && <p className="text-xs text-slate-600">{t("ai.poznamkaKRozhodnuti", { decisionNote: open.decisionNote })}</p>}
          </div>
        </Modal>
      )}
    </Card>
  );
}

function QueryLog() {
  const t = useT();
  const q = useQuery({ queryKey: ["ai", "queryLog"], queryFn: api.ai.queryLog });
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("ai.dotazyVPrirozenemJazyce")} subtitle={t("ai.kdoSeNaCoPtal")} />
      <ErrorBox error={q.error} />
      {(q.data ?? []).length === 0 ? (
        <EmptyState>{q.isLoading ? t("common.loading") : t("ai.zatimZadneDotazy")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("ai.kdy")}</th>
              <th className="px-3 py-2">{t("ai.uzivatel")}</th>
              <th className="px-3 py-2">{t("ai.dotaz")}</th>
              <th className="px-3 py-2">{t("ai.prehledy")}</th>
              <th className="px-3 py-2">{t("ai.stav")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(q.data ?? []).map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-5 py-2 whitespace-nowrap text-xs text-slate-600">{dt(r.createdAt)}</td>
                <td className="px-3 py-2 text-xs">{r.userName ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.question}
                  {r.answer && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{r.answer}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{r.plan.map((p) => p.tool).join(", ") || "—"}</td>
                <td className="px-3 py-2">
                  <Badge tone={r.status === "done" ? "green" : r.status === "error" ? "red" : "amber"}>{r.status === "done" ? "hotovo" : r.status === "error" ? "chyba" : t("ai.bezi")}</Badge>
                  {r.durationMs ? <div className="text-xs text-slate-500">{(r.durationMs / 1000).toFixed(0)} s</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Stav indexu „Zeptej se dokumentace“ s možností přeindexovat. */
function DocIndexStatus() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["policies", "qa-index"], queryFn: api.policies.qaIndex, refetchInterval: (x) => ((x.state.data?.pending ?? 0) > 0 ? 5000 : false) });
  const re = useMutation({ mutationFn: api.policies.qaReindex, onSuccess: (d) => qc.setQueryData(["policies", "qa-index"], d) });
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  return (
    <div className="space-y-1.5 text-sm">
      <p className="text-slate-700">
        {t("ai.zaindexovano")} {d.indexed} {t("common.of")} {d.documents} {t("ai.platnychDokumentu")}{d.chunks} {t("ai.useku")}{d.pending ? (" " + t("ai.ceka", { pending: d.pending })) : ""}
        {d.lastIndexedAt ? ` · ${t("rec.lastIndexed", { date: dt(d.lastIndexedAt) })}` : ""}
      </p>
      {d.errors.slice(0, 5).map((e) => (
        <p key={e.policyId} className="text-xs text-red-700">
          {e.title}: {e.error}
        </p>
      ))}
      <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={re.isPending} onClick={() => re.mutate()}>
        {t("ai.preindexovatDokumentaci")}
      </Button>
      <ErrorBox error={re.error} />
    </div>
  );
}

function RecordIndexStatus() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["records", "status"], queryFn: api.records.status, refetchInterval: (x) => (x.state.data?.running ? 3000 : 15_000) });
  const re = useMutation({ mutationFn: api.records.reindex, onSuccess: (d) => qc.setQueryData(["records", "status"], d) });
  const setKinds = useMutation({ mutationFn: (disabledKinds: RecordKind[]) => api.records.saveIndexSettings({ disabledKinds }), onSuccess: (d) => qc.setQueryData(["records", "status"], d) });
  const [browse, setBrowse] = useState(false);
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  const off = new Set(d.disabledKinds ?? []);
  const total = RECORD_KINDS.reduce((n, k) => n + (off.has(k) ? 0 : d.byKind[k].records), 0);
  const done = RECORD_KINDS.reduce((n, k) => n + (off.has(k) ? 0 : d.byKind[k].indexed), 0);
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div className="space-y-3 text-sm" data-testid="record-index">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
          <span>
            {t("rec.progress", { done, total })}
            {d.running ? ` · ${t("rec.running")}` : ""}
          </span>
          <span>{d.lastIndexedAt ? t("rec.lastIndexed", { date: dt(d.lastIndexedAt) }) : ""}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full rounded-full transition-all", d.running ? "animate-pulse bg-brand-500" : "bg-brand-600")} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {RECORD_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!off.has(k)} disabled={setKinds.isPending} onChange={(e) => setKinds.mutate(e.target.checked ? [...off].filter((x) => x !== k) : [...off, k])} />
            <span className={cn("flex-1", off.has(k) && "text-slate-400")}>{t.lbl(RECORD_LABELS[k])}</span>
            <span className="tabular-nums text-xs text-slate-500">
              {d.byKind[k].indexed}/{d.byKind[k].records}
              {d.byKind[k].excluded ? ` · ${t("rec.excludedN", { n: d.byKind[k].excluded })}` : ""}
            </span>
          </label>
        ))}
      </div>
      {d.errors > 0 && <p className="text-xs text-red-700">{t("rec.indexErrors", { n: d.errors })}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={re.isPending || d.running} onClick={() => re.mutate()}>
          {d.running ? t("rec.running") : t("rec.reindex")}
        </Button>
        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setBrowse(true)}>
          {t("rec.browse")}
        </Button>
      </div>
      <ErrorBox error={re.error ?? setKinds.error} />
      {browse && <IndexBrowser onClose={() => setBrowse(false)} />}
    </div>
  );
}

/** Náhled indexu: co přesně model dostane, vyřazení jednotlivých záznamů (v1.07). */
function IndexBrowser({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [kind, setKind] = useState<RecordKind | "">("");
  const [q, setQ] = useState("");
  const [onlyExcluded, setOnlyExcluded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ["records", "items", kind, dq, onlyExcluded, offset], queryFn: () => api.records.indexItems({ kind: kind || undefined, q: dq || undefined, excluded: onlyExcluded ? "1" : undefined, offset }), placeholderData: (p) => p });
  const toggle = useMutation({
    mutationFn: (v: { kind: RecordKind; refId: string; excluded: boolean }) => api.records.exclude(v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["records"] });
    },
  });
  return (
    <Modal open onClose={onClose} title={t("rec.browse")} wide>
      <div className="flex flex-wrap gap-2">
        <Select className="w-52" value={kind} onChange={(e) => (setKind(e.target.value as RecordKind | ""), setOffset(0))} aria-label={t("rec.kind")}>
          <option value="">{t("rec.allKinds")}</option>
          {RECORD_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.lbl(RECORD_LABELS[k])}
            </option>
          ))}
        </Select>
        <Input className="flex-1" placeholder={t("rec.searchIndex")} value={q} onChange={(e) => (setQ(e.target.value), setOffset(0))} />
        <Checkbox checked={onlyExcluded} onChange={(v) => (setOnlyExcluded(v), setOffset(0))} label={t("rec.onlyExcluded")} />
      </div>
      <p className="text-xs text-slate-500">{t("rec.browseHint", { n: list.data?.total ?? 0 })}</p>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {(list.data?.items ?? []).map((x) => {
          const key = `${x.kind}:${x.refId}`;
          return (
            <li key={key} className={cn("px-3 py-2 text-sm", x.excluded && "bg-slate-50 text-slate-400")}>
              <div className="flex items-center gap-2">
                <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:text-brand-700" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                  {x.title}
                </button>
                <Badge tone="slate">{t.lbl(RECORD_LABELS[x.kind])}</Badge>
                {!x.indexed && !x.excluded && <Badge tone={x.error ? "red" : "amber"}>{x.error ? t("rec.err") : t("rec.waiting")}</Badge>}
                <button type="button" className="text-xs text-brand-700 hover:underline disabled:opacity-50" disabled={toggle.isPending} onClick={() => toggle.mutate({ kind: x.kind, refId: x.refId, excluded: !x.excluded })}>
                  {x.excluded ? t("rec.include") : t("rec.exclude")}
                </button>
              </div>
              {open === key && <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-xs text-slate-700">{x.text}</pre>}
            </li>
          );
        })}
        {list.data && !list.data.items.length && <li className="px-3 py-4 text-center text-sm text-slate-500">{t("pal.none")}</li>}
      </ul>
      {(list.data?.total ?? 0) > 50 && (
        <div className="flex justify-between">
          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
            ←
          </Button>
          <span className="text-xs text-slate-500">
            {offset + 1}–{Math.min(offset + 50, list.data!.total)} / {list.data!.total}
          </span>
          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={offset + 50 >= (list.data?.total ?? 0)} onClick={() => setOffset(offset + 50)}>
            →
          </Button>
        </div>
      )}
      <ErrorBox error={list.error ?? toggle.error} />
    </Modal>
  );
}
