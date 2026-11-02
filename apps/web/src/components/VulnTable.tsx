import { useT } from "@/lib/i18n";
import { Badge, Button, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { SeverityBadge } from "@/components/health";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { fmtDate, fmtDay, useDebounced } from "@/lib/utils";
import { isCveId, SEVERITIES, VULN_INTEL_LABELS, VULN_LABELS, VULN_PRIORITIES, VULN_SCAN_LABELS, VULN_SCANNERS, VULN_STATUSES, type Severity, type VulnerabilityDto, type VulnPriority, type VulnStatus, type VulnTriageAction } from "@contix/shared";
import { epssText, KevBadge, PriorityBadge } from "@/components/vulnPriority";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ExternalLink, Search } from "lucide-react";
import { useState } from "react";

const PAGE = 50;

export function VulnTable({
  assetId,
  canEditAsset,
  initialSeverity,
  initialPriority,
  initialKev,
  initialPackage,
  initialOverdue,
  scanId,
}: {
  scanId?: string;
  assetId?: string;
  canEditAsset?: boolean;
  initialSeverity?: Severity;
  initialPriority?: VulnPriority;
  initialKev?: boolean;
  initialPackage?: string;
  initialOverdue?: boolean;
}) {
  const t = useT();
  const can = useCan();
  const [severity, setSeverity] = useState<Severity | "">(initialSeverity ?? "");
  const [status, setStatus] = useState<VulnStatus | "">(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("status") === "accepted" ? "accepted" : "open"));
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [priority, setPriority] = useState<VulnPriority | "">(initialPriority ?? "");
  const [kev, setKev] = useState(!!initialKev);
  const [pkg, setPkg] = useState(initialPackage ?? "");
  const [overdue, setOverdue] = useState(!!initialOverdue);
  const [offset, setOffset] = useState(0);
  const [scanner, setScanner] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [triage, setTriage] = useState<{ action: VulnTriageAction; rows: VulnerabilityDto[] } | null>(null);
  const [accepting, setAccepting] = useState<VulnerabilityDto | null>(null);
  const qc = useQueryClient();

  const query = { assetId, severity: severity || undefined, status: status || undefined, q: dq || undefined, priority: priority || undefined, kev: kev ? ("1" as const) : undefined, packageName: pkg || undefined, overdue: overdue ? ("1" as const) : undefined, scanId, scanner: scanner || undefined, limit: PAGE, offset };
  const list = useQuery({ queryKey: ["vulns", query], queryFn: () => api.vulns.list(query), placeholderData: keepPreviousData });
  const reopen = useMutation({
    mutationFn: (id: string) => api.vulns.reopen(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vulns"] });
      qc.invalidateQueries({ queryKey: ["asset"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["vuln-summary"] });
    },
  });
  const canEdit = canEditAsset ?? can("assets:write");
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setOffset(0);
    setSelected(new Set());
  };
  const quick = useMutation({
    mutationFn: (x: { id: string; action: VulnTriageAction }) => api.vulns.triage({ ids: [x.id], action: x.action }),
    onSuccess: () => {
      for (const k of ["vulns", "asset", "assets", "vuln-summary", "vuln-scans"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const items = list.data?.items ?? [];
  const picked = items.filter((v) => selected.has(v.id));
  const toggle = (id: string) =>
    setSelected((s0) => {
      const n = new Set(s0);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const sameAsset = picked.length > 0 && picked.every((v) => v.assetId === picked[0]!.assetId);
  const bulk = (action: VulnTriageAction) => setTriage({ action, rows: picked });

  return (
    <div>
      <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-[1fr_11rem_11rem_13rem]">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <Input
            className="pl-9"
            placeholder={assetId ? t("ast.hledatCveNeboKomponentu") : t("ast.hledatCveKomponentuNeboAktivum")}
            value={q}
            onChange={(e) => reset(setQ)(e.target.value)}
          />
        </div>
        <Select value={priority} onChange={(e) => reset(setPriority)(e.target.value as VulnPriority | "")} aria-label={t("vp.priority")}>
          <option value="">{t("vp.anyPriority")}</option>
          {VULN_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t.lbl(VULN_INTEL_LABELS.priority[p])}
            </option>
          ))}
        </Select>
        <Select value={severity} onChange={(e) => reset(setSeverity)(e.target.value as Severity | "")}>
          <option value="">{t("ast.vsechnyZavaznosti")}</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(VULN_LABELS.severity[s])}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => reset(setStatus)(e.target.value as VulnStatus | "")}>
          <option value="">{t("ast.vsechnyStavy")}</option>
          {VULN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(VULN_LABELS.status[s])}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-4 py-2 text-sm">
        <label className="inline-flex items-center gap-1.5 text-slate-700">
          <input type="checkbox" checked={overdue} onChange={(e) => reset(setOverdue)(e.target.checked)} /> {t("vr.filterOverdue")}
        </label>
        <label className="inline-flex items-center gap-1.5 text-slate-700">
          <input type="checkbox" checked={kev} onChange={(e) => reset(setKev)(e.target.checked)} /> {t("vp.filterKev")}
        </label>
        {!scanId && (
          <Select className="ml-auto w-56" value={scanner} onChange={(e) => reset(setScanner)(e.target.value)} aria-label={t("vs.source")}>
            <option value="">{t("vs.anySource")}</option>
            <option value="wazuh">Wazuh</option>
            {VULN_SCANNERS.map((x) => (
              <option key={x} value={x}>
                {t.lbl(VULN_SCAN_LABELS.scanner[x])}
              </option>
            ))}
          </Select>
        )}
      </div>
      {canEdit && picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-brand-50/40 px-4 py-2 text-sm">
          <span className="font-medium text-slate-700">{t("vs.selected", { n: picked.length })}</span>
          {(["verify", "false_positive", "out_of_scope", "reopen"] as const).map((a) => (
            <Button key={a} variant="secondary" className="px-2 py-1 text-xs" onClick={() => bulk(a)}>
              {t.lbl(VULN_SCAN_LABELS.triage[a])}
            </Button>
          ))}
          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!sameAsset} title={sameAsset ? undefined : t("vs.dupSameAsset")} onClick={() => bulk("duplicate")}>
            {t.lbl(VULN_SCAN_LABELS.triage.duplicate)}
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setSelected(new Set())}>
            {t("common.cancelAction")}
          </Button>
        </div>
      )}
      {pkg && (
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-2 text-xs">
          {pkg && (
            <button type="button" className="rounded-full border border-slate-200 px-2.5 py-0.5 hover:border-red-300" onClick={() => reset(setPkg)("")}>
              {t("vp.filterPackage", { p: pkg })} ✕
            </button>
          )}
        </div>
      )}
      <ErrorBox error={list.error ?? reopen.error ?? quick.error} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canEdit && (
                <th className="w-8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={t("vs.selectAll")}
                    checked={items.length > 0 && picked.length === items.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(items.map((v) => v.id)) : new Set())}
                  />
                </th>
              )}
              <th className="px-4 py-2.5">{t("vp.priority")}</th>
              <th className="px-4 py-2.5">{t("ast.cve")}</th>
              <th className="px-4 py-2.5">{t("ast.zavaznost")}</th>
              <th className="px-4 py-2.5 text-right">{t("ast.cvss")}</th>
              <th className="px-4 py-2.5">{t("ast.komponenta")}</th>
              {!assetId && <th className="px-4 py-2.5">{t("ast.aktivum")}</th>}
              <th className="px-4 py-2.5">{t("ast.zjisteno")}</th>
              <th className="px-4 py-2.5">{t("vr.due")}</th>
              <th className="px-4 py-2.5">{t("ast.stav")}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className={list.isFetching ? "opacity-60" : ""}>
            {list.data?.items.map((v) => (
              <tr key={v.id} className="border-b border-slate-100 align-top">
                {canEdit && (
                  <td className="px-3 py-2.5">
                    <input type="checkbox" aria-label={t("vs.selectRow", { id: v.cveId })} checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-2.5">
                  <PriorityBadge p={v.priority} reasons={v.priorityReasons} />
                </td>
                <td className="px-4 py-2.5">
                  {isCveId(v.cveId) ? (
                    <span className="whitespace-nowrap">
                      <Link to="/vulnerabilities/cve/$cveId" params={{ cveId: v.cveId }} className="font-mono text-xs font-medium text-brand-700 hover:underline" title={v.description ?? undefined}>
                        {v.cveId}
                      </Link>
                      <a href={`https://nvd.nist.gov/vuln/detail/${v.cveId}`} target="_blank" rel="noreferrer" className="ml-1 inline-block text-slate-400 hover:text-brand-700" aria-label="NVD">
                        <ExternalLink size={11} />
                      </a>
                    </span>
                  ) : (
                    <span className="font-mono text-xs font-medium text-slate-800" title={v.description ?? undefined}>
                      {v.cveId}
                    </span>
                  )}
                  {v.verified && <CheckCircle2 size={13} className="ml-1 inline text-emerald-600" aria-label={t("vs.verified")} />}
                  {v.title && <div className="mt-0.5 max-w-72 text-xs text-slate-600">{v.title}</div>}
                  {(v.relatedCves.length > 0 || v.cwe) && (
                    <div className="text-[11px] text-slate-400">
                      {[v.relatedCves.length ? t("vs.moreCves", { n: v.relatedCves.length }) : null, v.cwe ? `CWE-${v.cwe}` : null].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {(v.kev || v.epss != null) && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                      {v.kev && <KevBadge ransomware={v.kevRansomware} />}
                      {v.epss != null && <span title={t("vp.epssHint")}>EPSS {epssText(v.epss)}</span>}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <SeverityBadge severity={v.severity} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{v.cvssScore?.toFixed(1) ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-800">{v.packageName || (v.endpoint ? "" : "—")}</div>
                  <div className="text-xs text-slate-500">
                    {v.packageVersion}
                    {v.fixedVersion && <span className="text-emerald-700"> → {v.fixedVersion}</span>}
                  </div>
                  {v.endpoint && <div className="max-w-56 break-all font-mono text-[11px] text-slate-500">{v.endpoint}</div>}
                </td>
                {!assetId && (
                  <td className="px-4 py-2.5">
                    <Link to="/assets/$assetId" params={{ assetId: v.assetId }} className="text-brand-700 hover:underline">
                      {v.assetName}
                    </Link>
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                  {fmtDate(v.detectedAt ?? v.firstSeenAt)}
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    {v.scanner}
                    {v.exposed && <span className="ml-1 normal-case text-red-700">· {t("vs.exposedShort")}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {v.due ? <span className={v.overdue ? "font-medium text-red-700" : "text-slate-600"}>{fmtDay(v.due)}{v.overdue && <div className="text-xs font-normal">{t("vr.overdue")}</div>}</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  {v.status === "accepted" ? (
                    <div title={v.acceptedReason ?? undefined}>
                      <Badge tone="violet">{t("ast.vyjimka")}</Badge>
                      <div className="mt-1 max-w-56 text-xs text-slate-500">
                        {v.acceptedReason}
                        {v.acceptedUntil && ` · do ${new Date(v.acceptedUntil).toLocaleDateString("cs-CZ")}`}
                        {v.acceptedByName && ` · ${v.acceptedByName}`}
                      </div>
                    </div>
                  ) : v.status === "resolved" ? (
                    <Badge tone="green">{t("ast.vyreseno", { p: v.resolvedAt ? new Date(v.resolvedAt).toLocaleDateString("cs-CZ") : "" })}</Badge>
                  ) : v.status === "false_positive" || v.status === "out_of_scope" || v.status === "duplicate" ? (
                    <div>
                      <Badge tone="slate">{t.lbl(VULN_LABELS.status[v.status])}</Badge>
                      {v.triageReason && <div className="mt-1 max-w-56 text-xs text-slate-500">{v.triageReason}</div>}
                    </div>
                  ) : (
                    <Badge tone="amber">{t("ast.otevrena")}</Badge>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  {canEdit && v.status === "open" && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setAccepting(v)}>
                      {t("ast.vyjimka2")}
                    </Button>
                  )}
                  {canEdit && v.status === "accepted" && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => reopen.mutate(v.id)}>
                      {t("ast.zrusitVyjimku")}
                    </Button>
                  )}
                  {canEdit && (v.status === "false_positive" || v.status === "out_of_scope" || v.status === "duplicate") && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" disabled={quick.isPending} onClick={() => quick.mutate({ id: v.id, action: "reopen" })}>
                      {t.lbl(VULN_SCAN_LABELS.triage.reopen)}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !list.data.items.length && (
          <EmptyState>{status === "open" ? t("ast.zadneOtevreneZranitelnosti") : t("common.nothingFound")}</EmptyState>
        )}
      </div>
      {list.data && list.data.total > PAGE && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, list.data.total)} {t("common.of")} {list.data.total}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(offset - PAGE)}>
              {t("ast.predchozi")}
            </Button>
            <Button variant="secondary" disabled={offset + PAGE >= list.data.total} onClick={() => setOffset(offset + PAGE)}>
              {t("ast.dalsi")}
            </Button>
          </div>
        </div>
      )}
      {accepting && <AcceptModal vuln={accepting} onClose={() => setAccepting(null)} />}
      {triage && (
        <TriageModal
          action={triage.action}
          rows={triage.rows}
          onClose={(done) => {
            setTriage(null);
            if (done) setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

function AcceptModal({ vuln, onClose }: { vuln: VulnerabilityDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const accept = useMutation({
    mutationFn: () => api.vulns.accept(vuln.id, { reason, until: until || null }),
    onSuccess: () => {
      for (const k of ["vulns", "asset", "assets", "vuln-summary"]) qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("ast.vyjimka3", { cveId: vuln.cveId })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={accept.isPending || reason.trim().length < 5} onClick={() => accept.mutate()}>
            {t("ast.udelitVyjimku")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {t("ast.akceptaceRizikaZranitelnostSeNebude")}
      </p>
      <Field label={t("ast.zduvodneni")} hint={t("ast.naprKompenzacniOpatreniPlanovanaAktualiz")}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t("ast.platnostDo")} hint={t("ast.doporucenoVyjimkyMajiBytCasove")}>
        <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      <ErrorBox error={accept.error} />
    </Modal>
  );
}



/** Hromadná triáž (ADR-095): ověření, falešně pozitivní / mimo rozsah se zdůvodněním, duplicita vůči nálezu na stejném aktivu. */
function TriageModal({ action, rows, onClose }: { action: VulnTriageAction; rows: VulnerabilityDto[]; onClose: (done: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [dupOf, setDupOf] = useState("");
  const ids = new Set(rows.map((r) => r.id));
  const assetId = rows[0]?.assetId;
  const candidates = useQuery({
    queryKey: ["vulns", "dup-candidates", assetId],
    queryFn: () => api.vulns.list({ assetId, status: "open", limit: 500 }),
    enabled: action === "duplicate" && !!assetId,
  });
  const needReason = action === "false_positive" || action === "out_of_scope";
  const run = useMutation({
    mutationFn: () => api.vulns.triage({ ids: [...ids], action, reason: reason.trim() || undefined, duplicateOfId: action === "duplicate" ? dupOf : undefined }),
    onSuccess: () => {
      for (const k of ["vulns", "asset", "assets", "vuln-summary", "vuln-scans"]) qc.invalidateQueries({ queryKey: [k] });
      onClose(true);
    },
  });
  const disabled = run.isPending || (needReason && reason.trim().length < 5) || (action === "duplicate" && !dupOf);
  return (
    <Modal
      open
      onClose={() => onClose(false)}
      title={t("vs.triageTitle", { action: t.lbl(VULN_SCAN_LABELS.triage[action]), n: rows.length })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose(false)}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={disabled} onClick={() => run.mutate()}>
            {t.lbl(VULN_SCAN_LABELS.triage[action])}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t(`vs.triageHint.${action}` as "vs.triageHint.verify")}</p>
      <ul className="max-h-32 overflow-y-auto text-xs text-slate-600">
        {rows.slice(0, 20).map((r) => (
          <li key={r.id}>
            <span className="font-mono">{r.cveId}</span> {r.title ?? r.packageName} · {r.assetName}
          </li>
        ))}
        {rows.length > 20 && <li>…</li>}
      </ul>
      {action === "duplicate" && (
        <Field label={t("vs.duplicateOf")}>
          <Select value={dupOf} onChange={(e) => setDupOf(e.target.value)}>
            <option value="">—</option>
            {candidates.data?.items
              .filter((c) => !ids.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cveId} {c.title ?? c.packageName} ({c.scanner})
                </option>
              ))}
          </Select>
        </Field>
      )}
      {action !== "verify" && action !== "unverify" && action !== "reopen" && (
        <Field label={t("ast.zduvodneni")} hint={needReason ? t("vs.reasonRequired") : undefined}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <ErrorBox error={run.error} />
    </Modal>
  );
}
