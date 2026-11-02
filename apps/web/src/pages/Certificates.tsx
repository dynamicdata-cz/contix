import { askConfirm } from "@/components/ui/overlay";
/** Inventář certifikátů a TLS (ADR-070): koncové body, platnost, řetězec, klíč, podpis, zastaralé protokoly. */
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { TLS_LABELS, type TlsEndpointDto, type TlsPolicy, type TlsSeverity } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";

const sevTone: Record<TlsSeverity, Tone> = { critical: "red", high: "red", medium: "amber", low: "blue" };

export function CertificatesPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["certificates"], queryFn: api.certificates.list });
  const [adding, setAdding] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const write = can("assets:write");
  const refresh = () => qc.invalidateQueries({ queryKey: ["certificates"] });
  const scan = useMutation({ mutationFn: (id: string) => api.certificates.scan(id), onSuccess: refresh });
  const scanAll = useMutation({ mutationFn: api.certificates.scanAll, onSuccess: refresh });
  const toggle = useMutation({ mutationFn: (e: TlsEndpointDto) => api.certificates.update(e.id, { enabled: !e.enabled }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.certificates.remove(id), onSuccess: refresh });
  const d = q.data;
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/assets" className="hover:text-brand-700">
          {t("ag.back")}
        </Link>
      </div>
      <PageHeader
        title={t("tls.title")}
        subtitle={t("tls.subtitle")}
        actions={
          write && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setSuggest(true)}>
                <Wand2 size={15} /> {t("tls.suggest")}
              </Button>
              <Button variant="secondary" disabled={scanAll.isPending} onClick={() => scanAll.mutate()}>
                <RefreshCw size={15} className={cn(scanAll.isPending && "animate-spin")} /> {t("tls.scanAll")}
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus size={15} /> {t("tls.add")}
              </Button>
            </div>
          )
        }
      />
      <ErrorBox error={q.error ?? scan.error ?? scanAll.error ?? remove.error} />
      {d && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={t("tls.kpi.total")} value={d.summary.total} hint={d.summary.unscanned ? t("tls.kpi.unscanned", { n: d.summary.unscanned }) : undefined} />
            <Kpi label={t("tls.kpi.expired")} value={d.summary.expired} danger={d.summary.expired > 0} />
            <Kpi label={t("tls.kpi.expiring", { days: d.policy.warnDays })} value={d.summary.expiring} danger={d.summary.expiring > 0} />
            <Kpi label={t("tls.kpi.findings")} value={d.summary.withFindings} />
          </div>
          <Card className="mb-6 overflow-hidden" data-testid="tls-endpoints">
            <CardHeader title={t("tls.endpoints")} subtitle={d.summary.legacyCheck ? t("tls.endpointsSub") : t("tls.endpointsSubNoLegacy")} />
            {d.endpoints.length === 0 ? (
              <EmptyState>{t("tls.empty")}</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">{t("tls.col.endpoint")}</th>
                      <th className="px-3 py-2">{t("tls.col.cert")}</th>
                      <th className="px-3 py-2">{t("tls.col.expires")}</th>
                      <th className="px-3 py-2">{t("tls.col.findings")}</th>
                      <th className="px-3 py-2">{t("tls.col.scanned")}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.endpoints.map((e) => (
                      <tr key={e.id} className={cn(!e.enabled && "opacity-50")}>
                        <td className="px-4 py-2">
                          <button type="button" className="font-mono text-xs font-medium text-brand-700 hover:underline" onClick={() => setOpen(open === e.id ? null : e.id)}>
                            {e.host}:{e.port}
                          </button>
                          {e.serverName && e.serverName !== e.host && <div className="text-xs text-slate-500">SNI {e.serverName}</div>}
                          {e.assetId && (
                            <Link to="/assets/$assetId" params={{ assetId: e.assetId }} className="block text-xs text-slate-500 hover:text-brand-700">
                              {e.assetName}
                            </Link>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {e.result?.ok ? (
                            <>
                              <div className="font-medium">{e.result.subject}</div>
                              <div className="text-slate-500">
                                {e.result.keyType} {e.result.keyBits} · {e.result.protocol}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {e.result?.notAfter ? (
                            <>
                              {fmtDate(e.result.notAfter)}
                              <div className={cn("text-xs", e.daysLeft != null && e.daysLeft < 0 ? "text-red-700" : e.daysLeft != null && e.daysLeft <= d.policy.warnDays ? "text-amber-700" : "text-slate-500")}>
                                {e.daysLeft != null && e.daysLeft < 0 ? t("tls.expiredAgo", { n: -e.daysLeft }) : t("tls.daysLeft", { n: e.daysLeft ?? 0 })}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {!e.lastScanAt ? (
                              <Badge tone="slate">{t("tls.notScanned")}</Badge>
                            ) : e.findings.length === 0 ? (
                              <Badge tone="green">{t("tls.ok")}</Badge>
                            ) : (
                              e.findings.map((f, i) => (
                                <Badge key={i} tone={sevTone[f.severity]}>
                                  {t.lbl(TLS_LABELS.finding[f.kind])}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{e.lastScanAt ? fmtDate(e.lastScanAt) : "—"}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {write && (
                            <>
                              <button type="button" aria-label={t("tls.scan")} title={t("tls.scan")} className="mr-2 text-slate-500 hover:text-brand-700" disabled={scan.isPending} onClick={() => scan.mutate(e.id)}>
                                <RefreshCw size={14} className={cn(scan.isPending && scan.variables === e.id && "animate-spin")} />
                              </button>
                              <button type="button" className="mr-2 text-xs text-slate-500 hover:text-brand-700" onClick={() => toggle.mutate(e)}>
                                {e.enabled ? t("tls.disable") : t("tls.enable")}
                              </button>
                              <button type="button" aria-label={t("tls.remove")} className="text-red-700" onClick={async () => (await askConfirm(t("tls.removeConfirm"))) && remove.mutate(e.id)}>
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {open && <Detail e={d.endpoints.find((x) => x.id === open)!} />}
          </Card>
          <PolicyCard policy={d.policy} />
        </>
      )}
      {adding && <AddModal onClose={() => setAdding(false)} />}
      {suggest && <SuggestModal onClose={() => setSuggest(false)} />}
    </>
  );
}

function Kpi({ label, value, hint, danger }: { label: string; value: number; hint?: string; danger?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", danger && "text-red-700")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

function Detail({ e }: { e: TlsEndpointDto }) {
  const t = useT();
  if (!e) return null;
  const r = e.result;
  const rows: [string, string | null | undefined][] = r?.ok
    ? [
        [t("tls.d.subject"), r.subject],
        [t("tls.d.issuer"), r.issuer],
        [t("tls.d.sans"), r.sans?.join(", ")],
        [t("tls.d.validity"), `${r.notBefore ? fmtDate(r.notBefore) : "?"} – ${r.notAfter ? fmtDate(r.notAfter) : "?"}`],
        [t("tls.d.key"), `${r.keyType ?? "?"} ${r.keyBits ?? ""}`],
        [t("tls.d.sigAlg"), r.sigAlg],
        [t("tls.d.protocol"), `${r.protocol ?? "?"} · ${r.cipher ?? "?"}`],
        [t("tls.d.legacy"), r.legacyProtocols == null ? t("tls.d.legacyUnknown") : r.legacyProtocols.join(", ") || t("tls.d.legacyNone")],
        [t("tls.d.trust"), r.trusted ? t("tls.d.trusted") : (r.trustError ?? "—")],
        [t("tls.d.serial"), r.serial],
        ["SHA-256", r.fingerprint256],
      ]
    : [[t("tls.d.error"), r?.error ?? t("tls.notScanned")]];
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3" data-testid="tls-detail">
      <div className="mb-2 font-mono text-xs font-semibold">
        {e.host}:{e.port}
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[12rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="break-all">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      {e.findings.some((f) => f.detail) && (
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
          {e.findings
            .filter((f) => f.detail)
            .map((f, i) => (
              <li key={i}>
                {t.lbl(TLS_LABELS.finding[f.kind])}: {f.detail}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ host: "", port: "443", serverName: "", note: "" });
  const save = useMutation({
    mutationFn: async () => {
      const e = await api.certificates.create({ host: f.host, port: Number(f.port) || 443, serverName: f.serverName || null, note: f.note || null });
      return api.certificates.scan(e.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["certificates"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("tls.add")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || !f.host} onClick={() => save.mutate()}>
            {t("tls.addAndScan")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field label={t("tls.f.host")} hint={t("tls.f.hostHint")}>
          <Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value.trim() })} placeholder="portal.firma.cz" />
        </Field>
        <Field label={t("tls.f.port")}>
          <Input type="number" min={1} max={65535} value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} />
        </Field>
      </div>
      <Field label={t("tls.f.serverName")} hint={t("tls.f.serverNameHint")}>
        <Input value={f.serverName} onChange={(e) => setF({ ...f, serverName: e.target.value.trim() })} />
      </Field>
      <Field label={t("tls.f.note")}>
        <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function SuggestModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["certificates", "candidates"], queryFn: api.certificates.candidates });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const save = useMutation({
    mutationFn: async () => {
      for (const a of (q.data ?? []).filter((x) => sel.has(x.id))) await api.certificates.create({ host: a.hostname.toLowerCase(), port: 443, assetId: a.id, companyId: a.companyId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["certificates"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("tls.suggest")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || sel.size === 0} onClick={() => save.mutate()}>
            {t("tls.addSelected", { n: sel.size })}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("tls.suggestIntro")}</p>
      {q.data?.length === 0 && <EmptyState>{t("tls.noCandidates")}</EmptyState>}
      <div className="max-h-[50vh] space-y-1 overflow-y-auto">
        {(q.data ?? []).map((a) => (
          <Checkbox key={a.id} checked={sel.has(a.id)} onChange={(on) => setSel((s) => (on ? new Set(s).add(a.id) : new Set([...s].filter((x) => x !== a.id))))} label={`${a.hostname}:443 – ${a.name}`} />
        ))}
      </div>
      <ErrorBox error={q.error ?? save.error} />
    </Modal>
  );
}

function PolicyCard({ policy }: { policy: TlsPolicy }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [p, setP] = useState(policy);
  const save = useMutation({ mutationFn: () => api.admin.updateSettings({ tlsPolicy: p }), onSuccess: () => qc.invalidateQueries({ queryKey: ["certificates"] }) });
  const admin = can("admin:settings");
  const num = (k: "warnDays" | "minRsaBits" | "minEcBits" | "maxValidityDays") => ({ type: "number", value: p[k], disabled: !admin, onChange: (e: { target: { value: string } }) => setP({ ...p, [k]: Number(e.target.value) }) });
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={t("tls.policy")}
        subtitle={t("tls.policySub")}
        action={
          admin && (
            <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
              {t("tls.savePolicy")}
            </Button>
          )
        }
      />
      <div className="grid gap-4 p-5 sm:grid-cols-4">
        <Field label={t("tls.p.warnDays")}>
          <Input {...num("warnDays")} />
        </Field>
        <Field label={t("tls.p.minRsa")}>
          <Input {...num("minRsaBits")} />
        </Field>
        <Field label={t("tls.p.minEc")}>
          <Input {...num("minEcBits")} />
        </Field>
        <Field label={t("tls.p.maxValidity")}>
          <Input {...num("maxValidityDays")} />
        </Field>
        <div className="sm:col-span-4">
          <Checkbox checked={p.allowLegacyTls} disabled={!admin} onChange={(v) => setP({ ...p, allowLegacyTls: v })} label={t("tls.p.allowLegacy")} />
        </div>
      </div>
      <ErrorBox error={save.error} />
    </Card>
  );
}
