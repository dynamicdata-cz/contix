import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select, SuccessBox, Textarea } from "@/components/ui";
import { askConfirm } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { VULN_LABELS, type VulnStaleCriteria, type VulnSuppressRuleDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

/* ============================================================
 * Historické zranitelnosti (v1.106, ADR-200): hromadné utlumení starých nálezů a nálezů na aktivech, která se
 * dlouho nehlásí, a pravidla, která to dělají automaticky po každé synchronizaci Wazuhu.
 * ============================================================ */

type Criteria = { olderThanDays: string; assetOfflineDays: string; maxSeverity: "" | "low" | "medium" | "high" | "critical"; wazuhOnly: boolean; keepKev: boolean };
const toCriteria = (c: Criteria): VulnStaleCriteria => ({
  olderThanDays: c.olderThanDays ? Number(c.olderThanDays) : null,
  assetOfflineDays: c.assetOfflineDays ? Number(c.assetOfflineDays) : null,
  maxSeverity: c.maxSeverity || null,
  wazuhOnly: c.wazuhOnly,
  keepKev: c.keepKev,
});

export function VulnSuppressionCard() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const write = can("assets:write");
  const [c, setC] = useState<Criteria>({ olderThanDays: "", assetOfflineDays: "30", maxSeverity: "", wazuhOnly: true, keepKev: true });
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const valid = !!(c.olderThanDays || c.assetOfflineDays);
  const rules = useQuery({ queryKey: ["vuln-suppression-rules"], queryFn: api.vulns.suppressionRules });
  // náhled: kolik otevřených nálezů kritéria zasáhnou
  const preview = useMutation({ mutationFn: () => api.vulns.suppress({ criteria: toCriteria(c), reason: "náhled", dryRun: true }) });
  useEffect(() => {
    if (!valid) return;
    const h = setTimeout(() => preview.mutate(), 300);
    return () => clearTimeout(h);
  }, [c.olderThanDays, c.assetOfflineDays, c.maxSeverity, c.wazuhOnly, c.keepKev]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (text: string) => {
    for (const k of ["vulns", "vuln-summary", "assets", "asset", "vuln-suppression-rules"]) qc.invalidateQueries({ queryKey: [k] });
    setMsg(text);
    preview.mutate();
  };
  const run = useMutation({ mutationFn: () => api.vulns.suppress({ criteria: toCriteria(c), reason, until: until || null }), onSuccess: (r) => done(t("vsup.done", { n: r.count })) });
  const saveRule = useMutation({ mutationFn: () => api.vulns.createSuppressionRule({ name, criteria: toCriteria(c), reason }), onSuccess: (r) => done(t("vsup.ruleDone", { n: r.suppressed })) });
  const toggle = useMutation({ mutationFn: (r: VulnSuppressRuleDto) => api.vulns.updateSuppressionRule(r.id, { name: r.name, criteria: r.criteria, reason: r.reason, active: !r.active }), onSuccess: () => done(t("vsup.ruleSaved")) });
  const remove = useMutation({ mutationFn: (id: string) => api.vulns.deleteSuppressionRule(id), onSuccess: (r) => done(t("vsup.ruleDeleted", { n: r.released })) });
  const n = preview.data?.count;
  return (
    <Card className="mb-6" data-testid="vsup-card">
      <CardHeader title={t("vsup.title")} subtitle={t("vsup.sub")} />
      <div className="grid gap-3 p-5 sm:grid-cols-3">
        <Field label={t("vsup.assetOffline")} hint={t("vsup.assetOfflineHint")}>
          <Input type="number" min={1} value={c.assetOfflineDays} onChange={(e) => setC({ ...c, assetOfflineDays: e.target.value })} data-testid="vsup-offline" />
        </Field>
        <Field label={t("vsup.olderThan")} hint={t("vsup.olderThanHint")}>
          <Input type="number" min={1} value={c.olderThanDays} onChange={(e) => setC({ ...c, olderThanDays: e.target.value })} data-testid="vsup-older" />
        </Field>
        <Field label={t("vsup.maxSeverity")}>
          <Select value={c.maxSeverity} onChange={(e) => setC({ ...c, maxSeverity: e.target.value as Criteria["maxSeverity"] })}>
            <option value="">{t("vsup.anySeverity")}</option>
            {(["low", "medium", "high", "critical"] as const).map((s) => (
              <option key={s} value={s}>
                {t("vsup.upTo", { s: t.lbl(VULN_LABELS.severity[s]) })}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox checked={c.wazuhOnly} onChange={(v) => setC({ ...c, wazuhOnly: v })} label={t("vsup.wazuhOnly")} />
        <Checkbox checked={c.keepKev} onChange={(v) => setC({ ...c, keepKev: v })} label={t("vsup.keepKev")} />
        <div className="text-sm text-slate-700" data-testid="vsup-preview">
          {!valid ? t("vsup.needCriteria") : n === undefined ? "…" : t("vsup.preview", { n })}
        </div>
      </div>
      {write && (
        <div className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-[1fr_12rem]">
          <Field label={t("vsup.reason")} hint={t("vsup.reasonHint")}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="vsup-reason" />
          </Field>
          <Field label={t("vsup.until")} hint={t("vsup.untilHint")}>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
            <Button
              disabled={!valid || reason.trim().length < 5 || !n || run.isPending}
              onClick={async () => (await askConfirm(t("vsup.confirm", { n: n ?? 0 }), { danger: false })) && run.mutate()}
              data-testid="vsup-run"
            >
              <BellOff size={15} /> {t("vsup.run", { n: n ?? 0 })}
            </Button>
            <span className="mx-2 text-xs text-slate-400">{t("vsup.or")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("vsup.ruleName")} className="w-64" data-testid="vsup-rule-name" />
            <Button variant="secondary" disabled={!valid || reason.trim().length < 5 || !name.trim() || saveRule.isPending} onClick={() => saveRule.mutate()} data-testid="vsup-rule-save">
              {t("vsup.saveRule")}
            </Button>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">{t("vsup.ruleHint")}</p>
        </div>
      )}
      {msg && (
        <div className="px-5 pb-3">
          <SuccessBox>{msg}</SuccessBox>
        </div>
      )}
      <ErrorBox error={preview.error ?? run.error ?? saveRule.error ?? toggle.error ?? remove.error ?? rules.error} />
      {(rules.data?.length ?? 0) > 0 && (
        <div className="border-t border-slate-100">
          <div className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("vsup.rules")}</div>
          <ul className="divide-y divide-slate-100" data-testid="vsup-rules">
            {rules.data!.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
                <span className="font-medium text-slate-900">{r.name}</span>
                <Badge tone={r.active ? "green" : "slate"}>{r.active ? t("vsup.active") : t("vsup.inactive")}</Badge>
                <span className="text-xs text-slate-500">
                  {[
                    r.criteria.assetOfflineDays ? t("vsup.cOffline", { n: r.criteria.assetOfflineDays }) : null,
                    r.criteria.olderThanDays ? t("vsup.cOlder", { n: r.criteria.olderThanDays }) : null,
                    r.criteria.maxSeverity ? t("vsup.upTo", { s: t.lbl(VULN_LABELS.severity[r.criteria.maxSeverity]) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {` · ${t("vsup.suppressedNow", { n: r.suppressed })}`}
                  {r.lastAppliedAt ? ` · ${fmtDate(r.lastAppliedAt)}` : ""}
                </span>
                {write && (
                  <span className="ml-auto flex gap-1">
                    <Button variant="secondary" className="px-2 py-1 text-xs" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>
                      {r.active ? t("vsup.deactivate") : t("vsup.activate")}
                    </Button>
                    <Button variant="secondary" className="px-2 py-1" onClick={async () => (await askConfirm(t("vsup.deleteConfirm", { name: r.name }))) && remove.mutate(r.id)} aria-label={t("vsup.delete")}>
                      <Trash2 size={14} />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
