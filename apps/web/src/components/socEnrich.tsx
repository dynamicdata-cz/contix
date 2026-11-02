import { askConfirm } from "@/components/ui/overlay";
/** Cortex a MISP (ADR-073): nastavení integrací, obohacení IOC (ručně, jen povolené analyzátory), sdílení IOC do MISP. */
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import {
  ENRICH_LABELS,
  MISP_TLPS,
  SOC_IOC_LABELS,
  cortexDataType,
  enrichGuard,
  type EnrichLevel,
  type MispShareResult,
  type SocEnrichmentDto,
  type SocIntegrationsDto,
  type SocIocDto,
  type SocIocType,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, PlugZap, RefreshCw, Settings2, Share2 } from "lucide-react";
import { useState } from "react";

const levelTone: Record<EnrichLevel, Tone> = { info: "slate", safe: "green", suspicious: "amber", malicious: "red" };
const reachTone = { local: "green", external: "red", unknown: "amber" } as const;

export function VerdictBadge({ v }: { v: EnrichLevel | null }) {
  const t = useT();
  if (!v) return null;
  return <Badge tone={levelTone[v]}>{t.lbl(ENRICH_LABELS.level[v])}</Badge>;
}

/* ---------- nastavení (správce) ---------- */

export function IntegrationsCard() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const admin = can("admin:settings");
  const q = useQuery({ queryKey: ["soc", "integrations"], queryFn: api.soc.integrations, enabled: admin });
  const [open, setOpen] = useState(false);
  if (!admin) return null;
  const s = q.data;
  const row = (kind: "cortex" | "misp", name: string, detail: string) => {
    const c = s?.[kind];
    return (
      <tr className="align-top">
        <td className="px-4 py-2.5">
          <span className="font-medium">{name}</span> {c && !c.enabled && <Badge tone="slate">{t("soc.src.disabled")}</Badge>}
          <div className="text-xs text-slate-500">{detail}</div>
        </td>
        <td className="px-3 py-2.5 text-xs">
          {c?.check ? (
            c.check.ok ? (
              <Badge tone="green">{t("soc.integ.ok", { v: c.check.version ?? "" })}</Badge>
            ) : (
              <span className="text-amber-800">{c.check.error}</span>
            )
          ) : (
            <span className="text-slate-400">{t("soc.integ.notTested")}</span>
          )}
          {c?.check && <div className="text-slate-400">{fmtDate(c.check.at)}</div>}
        </td>
      </tr>
    );
  };
  return (
    <Card className="mb-6 overflow-hidden" data-testid="soc-integrations">
      <CardHeader
        title={t("soc.integ.title")}
        subtitle={t("soc.integ.subtitle")}
        action={
          <Button variant="secondary" onClick={() => setOpen(true)} disabled={!s}>
            <Settings2 size={15} /> {t("soc.integ.settings")}
          </Button>
        }
      />
      <ErrorBox error={q.error} />
      {s && (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {row("cortex", "Cortex", s.cortex.enabled ? t("soc.integ.cortexInfo", { n: s.cortex.allowed.length, all: s.cortex.analyzers.length }) : t("soc.integ.cortexOff"))}
            {row("misp", "MISP", s.misp.enabled ? [s.misp.pull.enabled && t("soc.integ.mispPull", { d: s.misp.pull.days }), s.misp.lookup && t("soc.integ.mispLookup"), s.misp.share.enabled && t("soc.integ.mispShare")].filter(Boolean).join(" · ") : t("soc.integ.mispOff"))}
          </tbody>
        </table>
      )}
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">{t("soc.integ.privacy")}</p>
      {open && s && <IntegrationsModal s={s} onClose={() => setOpen(false)} onSaved={(r) => (qc.setQueryData(["soc", "integrations"], r), qc.invalidateQueries({ queryKey: ["soc", "enrich-options"] }), qc.invalidateQueries({ queryKey: ["soc", "threat-intel"] }))} />}
    </Card>
  );
}

const lines = (v: string) =>
  v
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function IntegrationsModal({ s, onClose, onSaved }: { s: SocIntegrationsDto; onClose: () => void; onSaved: (r: SocIntegrationsDto) => void }) {
  const t = useT();
  const [domains, setDomains] = useState(s.internalDomains.join("\n"));
  const [cx, setCx] = useState({ enabled: s.cortex.enabled, url: s.cortex.url, verifyTls: s.cortex.verifyTls, tlp: s.cortex.tlp, pap: s.cortex.pap });
  const [cKey, setCKey] = useState("");
  const [allowed, setAllowed] = useState<Set<string>>(new Set(s.cortex.allowed));
  const [mp, setMp] = useState({ enabled: s.misp.enabled, url: s.misp.url, verifyTls: s.misp.verifyTls, lookup: s.misp.lookup });
  const [mKey, setMKey] = useState("");
  const [pull, setPull] = useState(s.misp.pull);
  const [share, setShare] = useState(s.misp.share);
  const [tags, setTags] = useState(s.misp.pull.tags.join(", "));
  const [exTags, setExTags] = useState(s.misp.pull.excludeTags.join(", "));
  const [cur, setCur] = useState(s);
  const body = () => ({
    internalDomains: lines(domains),
    cortex: { ...cx, allowed: [...allowed], ...(cKey ? { apiKey: cKey } : {}) },
    misp: { ...mp, pull: { ...pull, tags: lines(tags), excludeTags: lines(exTags) }, share, ...(mKey ? { apiKey: mKey } : {}) },
  });
  const save = useMutation({ mutationFn: () => api.soc.saveIntegrations(body()), onSuccess: (r) => (onSaved(r), onClose()) });
  const test = useMutation({
    mutationFn: async (kind: "cortex" | "misp") => {
      await api.soc.saveIntegrations(body());
      setCKey("");
      setMKey("");
      return api.soc.testIntegration(kind);
    },
    onSuccess: (r) => (setCur(r), onSaved(r)),
  });
  const check = (kind: "cortex" | "misp") => {
    const c = cur[kind].check;
    if (!c) return null;
    return c.ok ? <Badge tone="green">{t("soc.integ.ok", { v: c.version ?? "" })}</Badge> : <span className="text-xs text-amber-800">{c.error}</span>;
  };
  const lvl = [0, 1, 2, 3];
  const tlpName = ["WHITE", "GREEN", "AMBER", "RED"];
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("soc.integ.settings")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {t("soc.save")}
          </Button>
        </>
      }
    >
      <Field label={t("soc.integ.domains")} hint={t("soc.integ.domainsHint")}>
        <Textarea rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={"firma.cz\nfirma.local"} />
      </Field>

      <section className="space-y-3 rounded-md border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Cortex</h3>
          {check("cortex")}
        </div>
        <Checkbox checked={cx.enabled} onChange={(v) => setCx({ ...cx, enabled: v })} label={t("soc.integ.enable", { name: "Cortex" })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("soc.integ.url")}>
            <Input value={cx.url} onChange={(e) => setCx({ ...cx, url: e.target.value })} placeholder="https://cortex.firma.local:9001" />
          </Field>
          <Field label={t("soc.integ.apiKey")} hint={cur.cortex.hasApiKey ? t("soc.act.pwSet") : t("soc.integ.cortexKeyHint")}>
            <Input type="password" autoComplete="new-password" value={cKey} onChange={(e) => setCKey(e.target.value)} />
          </Field>
          <Field label="TLP">
            <Select value={cx.tlp} onChange={(e) => setCx({ ...cx, tlp: Number(e.target.value) })} aria-label="TLP">
              {lvl.map((x) => (
                <option key={x} value={x}>
                  {tlpName[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="PAP">
            <Select value={cx.pap} onChange={(e) => setCx({ ...cx, pap: Number(e.target.value) })} aria-label="PAP">
              {lvl.map((x) => (
                <option key={x} value={x}>
                  {tlpName[x]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Checkbox checked={!cx.verifyTls} onChange={(v) => setCx({ ...cx, verifyTls: !v })} label={t("soc.integ.noVerify")} />
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => test.mutate("cortex")} disabled={test.isPending || !cx.url}>
            <PlugZap size={14} /> {t("soc.integ.test")}
          </Button>
          <span className="text-xs text-slate-500">{t("soc.integ.testHint")}</span>
        </div>
        {cur.cortex.analyzers.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">{t("soc.integ.analyzers")}</div>
            <p className="mb-2 text-xs text-slate-500">{t("soc.integ.analyzersHint")}</p>
            <div className="max-h-72 overflow-y-auto rounded border border-slate-200">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {cur.cortex.analyzers.map((a) => (
                    <tr key={a.id} className="align-top">
                      <td className="w-8 px-2 py-1.5">
                        <input
                          type="checkbox"
                          aria-label={t("soc.integ.allow", { name: a.name })}
                          checked={allowed.has(a.id)}
                          onChange={(e) =>
                            setAllowed((x) => {
                              const n = new Set(x);
                              if (e.target.checked) n.add(a.id);
                              else n.delete(a.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{a.name}</div>
                        <div className="text-slate-500">{a.description}</div>
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{a.dataTypes.join(", ")}</td>
                      <td className="px-2 py-1.5">
                        <Badge tone={reachTone[a.reach]}>{t.lbl(ENRICH_LABELS.reach[a.reach])}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">MISP</h3>
          {check("misp")}
        </div>
        <Checkbox checked={mp.enabled} onChange={(v) => setMp({ ...mp, enabled: v })} label={t("soc.integ.enable", { name: "MISP" })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("soc.integ.url")}>
            <Input value={mp.url} onChange={(e) => setMp({ ...mp, url: e.target.value })} placeholder="https://misp.firma.local" />
          </Field>
          <Field label={t("soc.integ.apiKey")} hint={cur.misp.hasApiKey ? t("soc.act.pwSet") : t("soc.integ.mispKeyHint")}>
            <Input type="password" autoComplete="new-password" value={mKey} onChange={(e) => setMKey(e.target.value)} />
          </Field>
        </div>
        <Checkbox checked={!mp.verifyTls} onChange={(v) => setMp({ ...mp, verifyTls: !v })} label={t("soc.integ.noVerify")} />
        <Button variant="secondary" onClick={() => test.mutate("misp")} disabled={test.isPending || !mp.url}>
          <PlugZap size={14} /> {t("soc.integ.test")}
        </Button>
        <div className="rounded border border-slate-100 p-2">
          <Checkbox checked={pull.enabled} onChange={(v) => setPull({ ...pull, enabled: v })} label={t("soc.integ.pull")} hint={t("soc.integ.pullHint")} />
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Field label={t("soc.integ.days")}>
              <Input type="number" min={1} max={365} value={pull.days} onChange={(e) => setPull({ ...pull, days: Number(e.target.value) })} />
            </Field>
            <Field label={t("soc.integ.tags")} hint={t("soc.integ.tagsHint")}>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tlp:green, circl:incident" />
            </Field>
            <Field label={t("soc.integ.exTags")}>
              <Input value={exTags} onChange={(e) => setExTags(e.target.value)} placeholder="tlp:red" />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap gap-4">
            <Checkbox checked={pull.toIdsOnly} onChange={(v) => setPull({ ...pull, toIdsOnly: v })} label={t("soc.integ.toIds")} />
            <Checkbox checked={pull.publishedOnly} onChange={(v) => setPull({ ...pull, publishedOnly: v })} label={t("soc.integ.published")} />
          </div>
        </div>
        <div className="rounded border border-slate-100 p-2">
          <Checkbox checked={mp.lookup} onChange={(v) => setMp({ ...mp, lookup: v })} label={t("soc.integ.lookup")} hint={t("soc.integ.lookupHint")} />
        </div>
        <div className="rounded border border-slate-100 p-2">
          <Checkbox checked={share.enabled} onChange={(v) => setShare({ ...share, enabled: v })} label={t("soc.integ.share")} hint={t("soc.integ.shareHint")} />
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Field label={t("soc.integ.distribution")}>
              <Select value={share.distribution} onChange={(e) => setShare({ ...share, distribution: Number(e.target.value) })} aria-label={t("soc.integ.distribution")}>
                {[0, 1, 2, 3].map((x) => (
                  <option key={x} value={x}>
                    {t.lbl(ENRICH_LABELS.distribution[x]!)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="TLP">
              <Select value={share.tlp} onChange={(e) => setShare({ ...share, tlp: e.target.value as typeof share.tlp })} aria-label={t("soc.integ.shareTlp")}>
                {MISP_TLPS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("soc.integ.threatLevel")}>
              <Select value={share.threatLevel} onChange={(e) => setShare({ ...share, threatLevel: Number(e.target.value) })} aria-label={t("soc.integ.threatLevel")}>
                {[1, 2, 3, 4].map((x) => (
                  <option key={x} value={x}>
                    {t.lbl(ENRICH_LABELS.threatLevel[x]!)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-2">
            <Checkbox checked={share.publish} onChange={(v) => setShare({ ...share, publish: v })} label={t("soc.integ.publish")} hint={t("soc.integ.publishHint")} />
          </div>
        </div>
      </section>
      <ErrorBox error={save.error ?? test.error} />
    </Modal>
  );
}

/* ---------- obohacení IOC (analytik) ---------- */

export function EnrichButton({ type, value, alertId, iocId, compact }: { type: SocIocType; value: string; alertId?: string; iocId?: string; compact?: boolean }) {
  const t = useT();
  const can = useCan();
  const o = useQuery({ queryKey: ["soc", "enrich-options"], queryFn: api.soc.enrichOptions, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const opts = o.data;
  if (!can("soc:write") || !opts || (!opts.cortex.length && !opts.mispLookup)) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} title={t("soc.enr.button")} aria-label={t("soc.enr.buttonFor", { v: value })}>
        <FlaskConical size={14} /> {!compact && t("soc.enr.button")}
      </Button>
      {open && <EnrichModal type={type} value={value} alertId={alertId} iocId={iocId} onClose={() => setOpen(false)} />}
    </>
  );
}

function EnrichModal({ type, value, alertId, iocId, onClose }: { type: SocIocType; value: string; alertId?: string; iocId?: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const o = useQuery({ queryKey: ["soc", "enrich-options"], queryFn: api.soc.enrichOptions });
  const hist = useQuery({ queryKey: ["soc", "enrichments", "value", value], queryFn: () => api.soc.enrichments({ value }) });
  const opts = o.data;
  const usable = (opts?.cortex ?? []).filter((a) => cortexDataType(type, a.dataTypes));
  const choices = [...(opts?.mispLookup ? [{ key: "misp", name: t("soc.enr.mispLookup"), reach: "local" as const }] : []), ...usable.map((a) => ({ key: `c:${a.id}`, name: a.name, reach: a.reach }))];
  const [pick, setPick] = useState("");
  const sel = choices.find((c) => c.key === (pick || choices[0]?.key));
  const guard = enrichGuard(type, value);
  const run = useMutation({
    mutationFn: () => api.soc.runEnrichment({ provider: sel!.key === "misp" ? "misp" : "cortex", analyzerId: sel!.key.startsWith("c:") ? sel!.key.slice(2) : undefined, type, value, alertId, iocId }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["soc", "enrichments"] }), qc.invalidateQueries({ queryKey: ["soc", "enrichments", "value", value] })),
  });
  return (
    <Modal open wide onClose={onClose} title={t("soc.enr.title")}>
      <p className="break-all font-mono text-sm">{value}</p>
      {"reason" in guard ? (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">{t("soc.enr.blocked", { r: t.lbl(ENRICH_LABELS.guard[guard.reason]) })}</p>
      ) : choices.length === 0 ? (
        <p className="text-sm text-slate-600">{t("soc.enr.noAnalyzer", { type: t.lbl(SOC_IOC_LABELS.type[type]) })}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("soc.enr.analyzer")} className="min-w-64 flex-1">
            <Select value={sel?.key ?? ""} onChange={(e) => setPick(e.target.value)} aria-label={t("soc.enr.analyzer")}>
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                  {c.reach !== "local" ? ` – ${t.lbl(ENRICH_LABELS.reach[c.reach])}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => run.mutate()} disabled={run.isPending || !sel}>
            <FlaskConical size={14} /> {run.isPending ? t("soc.enr.running") : t("soc.enr.run")}
          </Button>
        </div>
      )}
      {sel && sel.reach !== "local" && !("reason" in guard) && <p className="text-xs text-red-700">{t("soc.enr.externalWarn")}</p>}
      <ErrorBox error={run.error ?? hist.error} />
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">{t("soc.enr.history")}</div>
        <EnrichmentRows items={hist.data ?? []} />
      </div>
    </Modal>
  );
}

function EnrichmentRows({ items, showValue }: { items: SocEnrichmentDto[]; showValue?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [detail, setDetail] = useState<string | null>(null);
  const refresh = useMutation({ mutationFn: api.soc.refreshEnrichment, onSuccess: () => qc.invalidateQueries({ queryKey: ["soc", "enrichments"] }) });
  if (!items.length) return <EmptyState>{t("soc.enr.empty")}</EmptyState>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {items.map((e) => (
        <li key={e.id} className="py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">{e.provider === "misp" ? "MISP" : e.analyzer}</Badge>
            {showValue && <span className="break-all font-mono text-xs">{e.display}</span>}
            {e.status === "done" ? <VerdictBadge v={e.verdict} /> : <Badge tone={e.status === "failed" ? "red" : "blue"}>{t.lbl(ENRICH_LABELS.status[e.status])}</Badge>}
            <span className="text-xs text-slate-400">
              {fmtDate(e.createdAt)}
              {e.createdByName ? ` · ${e.createdByName}` : ""}
            </span>
            {e.status === "running" && (
              <Button variant="secondary" onClick={() => refresh.mutate(e.id)} disabled={refresh.isPending} aria-label={t("soc.enr.refresh")}>
                <RefreshCw size={13} />
              </Button>
            )}
            {e.provider === "cortex" && e.status === "done" && (
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setDetail(e.id)}>
                {t("soc.enr.report")}
              </button>
            )}
          </div>
          {e.error && <div className="mt-1 text-xs text-amber-800">{e.error}</div>}
          {e.taxonomies.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {e.taxonomies.map((x, i) => (
                <Badge key={i} tone={levelTone[x.level]}>
                  {x.predicate === "not_found" ? t("soc.enr.notFound") : `${x.namespace}:${x.predicate}${x.value ? ` = ${x.value}` : ""}`}
                </Badge>
              ))}
            </div>
          )}
          {e.provider === "misp" && Array.isArray((e.report as { events?: unknown[] } | null)?.events) && (
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              {(e.report as { events: { id: string; url: string }[] }).events.map((ev) => (
                <a key={ev.id} href={ev.url} target="_blank" rel="noreferrer noopener" className="text-brand-700 hover:underline">
                  MISP #{ev.id}
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
      {detail && <ReportModal id={detail} onClose={() => setDetail(null)} />}
    </ul>
  );
}

function ReportModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["soc", "enrichment", id], queryFn: () => api.soc.enrichment(id) });
  return (
    <Modal open wide onClose={onClose} title={t("soc.enr.report")}>
      <ErrorBox error={q.error} />
      {q.data && <pre className="max-h-[60vh] overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(q.data.report, null, 2)}</pre>}
    </Modal>
  );
}

/** Výsledky obohacení v detailu alertu. */
export function AlertEnrichmentsCard({ alertId }: { alertId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["soc", "enrichments", "alert", alertId], queryFn: () => api.soc.enrichments({ alertId }) });
  if (!q.data?.length) return null;
  return (
    <Card className="overflow-hidden" data-testid="soc-alert-enrichments">
      <CardHeader title={t("soc.enr.alertTitle")} subtitle={t("soc.enr.alertSubtitle")} />
      <div className="px-4">
        <EnrichmentRows items={q.data} showValue />
      </div>
    </Card>
  );
}

/* ---------- sdílení do MISP ---------- */

export function MispShareButton({ items }: { items: SocIocDto[] }) {
  const t = useT();
  const can = useCan();
  const o = useQuery({ queryKey: ["soc", "enrich-options"], queryFn: api.soc.enrichOptions, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  if (!can("soc:share") || !o.data?.mispShare) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Share2 size={15} /> {t("soc.share.button")}
      </Button>
      {open && <MispShareModal items={items.filter((i) => i.state === "active")} onClose={() => setOpen(false)} />}
    </>
  );
}

function MispShareModal({ items, onClose }: { items: SocIocDto[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const shareable = items.filter((i) => !("reason" in enrichGuard(i.type, i.value)));
  const [sel, setSel] = useState<Set<string>>(new Set(shareable.filter((i) => !i.mispEventId).map((i) => i.id)));
  const [info, setInfo] = useState("");
  const [res, setRes] = useState<MispShareResult | null>(null);
  const m = useMutation({ mutationFn: () => api.soc.mispShare({ iocIds: [...sel], info }), onSuccess: (r) => (setRes(r), qc.invalidateQueries({ queryKey: ["soc", "iocs"] })) });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("soc.share.title")}
      footer={
        res ? (
          <Button onClick={onClose}>{t("common.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancelAction")}
            </Button>
            <Button onClick={async () => (await askConfirm(t("soc.share.confirm", { n: sel.size }))) && m.mutate()} disabled={m.isPending || !sel.size || info.trim().length < 3}>
              <Share2 size={14} /> {t("soc.share.send", { n: sel.size })}
            </Button>
          </>
        )
      }
    >
      {res ? (
        <div className="space-y-2 text-sm">
          <p>
            {t("soc.share.done", { n: res.shared })}{" "}
            {res.eventUrl && (
              <a href={res.eventUrl} target="_blank" rel="noreferrer noopener" className="text-brand-700 hover:underline">
                MISP #{res.eventId}
              </a>
            )}
          </p>
          {res.skipped.length > 0 && (
            <ul className="text-xs text-amber-800">
              {res.skipped.map((s) => (
                <li key={s.value}>
                  {s.value} – {t.lbl(ENRICH_LABELS.guard[s.reason])}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-600">{t("soc.share.hint")}</p>
          <Field label={t("soc.share.info")} hint={t("soc.share.infoHint")}>
            <Input value={info} onChange={(e) => setInfo(e.target.value)} placeholder={t("soc.share.infoPh")} />
          </Field>
          {shareable.length === 0 ? (
            <EmptyState>{t("soc.share.none")}</EmptyState>
          ) : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 text-sm">
              {shareable.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-3 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={t("soc.ioc.select", { v: i.display })}
                    checked={sel.has(i.id)}
                    onChange={(e) =>
                      setSel((x) => {
                        const n = new Set(x);
                        if (e.target.checked) n.add(i.id);
                        else n.delete(i.id);
                        return n;
                      })
                    }
                  />
                  <Badge tone="slate">{t.lbl(SOC_IOC_LABELS.type[i.type])}</Badge>
                  <span className="break-all font-mono text-xs">{i.display}</span>
                  {i.mispEventId && <Badge tone="violet">MISP #{i.mispEventId}</Badge>}
                </li>
              ))}
            </ul>
          )}
          {items.length > shareable.length && <p className="text-xs text-slate-500">{t("soc.share.excluded", { n: items.length - shareable.length })}</p>}
          <ErrorBox error={m.error} />
        </>
      )}
    </Modal>
  );
}
