import { SupportBadge } from "@/components/health";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Input, Kpi, Select, SuccessBox } from "@/components/ui";
import { api, type IdentityComputerFilter } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate, useDebounced } from "@/lib/utils";
import { COMPUTER_ROLE_LABELS, COMPUTER_ROLES, type ComputerRole, type IdentitySourceDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download } from "lucide-react";
import { useEffect, useState } from "react";

/* ============================================================
 * Počítače a servery z AD (v1.90, ADR-185) – inventář, vazba na aktiva, sběr dat a nálezy.
 * ============================================================ */

type View = NonNullable<IdentityComputerFilter["view"]>;

export function Computers({ sources, onFindings }: { sources: IdentitySourceDto[]; onFindings: (computerId: string) => void }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [f, setF] = useState<{ q: string; sourceId: string; role: string; view: View | ""; removed: boolean }>({ q: "", sourceId: "", role: "", view: "", removed: false });
  const dq = useDebounced(f.q);
  const fq: IdentityComputerFilter = { q: dq || undefined, sourceId: f.sourceId || undefined, role: f.role || undefined, view: f.view || undefined, removed: f.removed ? "1" : undefined };
  const list = useQuery({ queryKey: ["identity", "computers", fq], queryFn: () => api.identity.computers(fq) });
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setSel([]), [dq, f.sourceId, f.role, f.view, f.removed]);
  const canAssets = can("identity:write") && can("assets:write");
  const create = useMutation({
    mutationFn: () => api.identity.computerAssets(sel),
    onSuccess: (r) => {
      setMsg(t("idn.pc.assetsDone", { created: r.created, linked: r.linked }));
      setSel([]);
      qc.invalidateQueries({ queryKey: ["identity"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
  });
  const s = list.data?.summary;
  const items = list.data?.items ?? [];
  const selectable = items.filter((p) => !p.asset && !p.removedAt);
  const tile = (view: View, label: string, value: number | undefined, tone: "slate" | "amber" | "red" = "slate") => (
    <Kpi label={label} value={value ?? "—"} tone={value ? tone : "slate"} active={f.view === view} onClick={() => setF({ ...f, view: f.view === view ? "" : view })} />
  );
  const yesNo = (b: boolean, bad?: boolean) => (b ? t("idn.pc.yes") : <span className={bad ? "font-medium text-red-700" : undefined}>{t("idn.pc.no")}</span>);

  return (
    <>
      {s && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="pc-summary">
          <Kpi label={t("idn.pc.total")} value={s.enabled} note={t("idn.pc.totalNote", { dcs: s.dcs, servers: s.servers, ws: s.workstations })} />
          {tile("stale", t("idn.pc.vStale"), s.stale, "amber")}
          {tile("eol", t("idn.pc.vEol"), s.eol, "red")}
          {tile("noAsset", t("idn.pc.vNoAsset"), s.noAsset, "amber")}
          {tile("unmonitored", t("idn.pc.vUnmonitored"), s.unmonitored, "red")}
          <Kpi label={t("idn.pc.lapsShare")} value={s.enabled ? `${Math.round((s.laps / s.enabled) * 100)} %` : "—"} tone={s.enabled && s.laps < s.enabled ? "amber" : "slate"} />
        </div>
      )}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Input placeholder={t("idn.pc.search")} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <Select value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })} aria-label={t("idn.zdroj")}>
            <option value="">{t("idn.vsechnyZdroje")}</option>
            {sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label={t("idn.pc.role")}>
            <option value="">{t("idn.pc.allRoles")}</option>
            {COMPUTER_ROLES.map((r) => (
              <option key={r} value={r}>
                {t.lbl(COMPUTER_ROLE_LABELS[r])}
              </option>
            ))}
          </Select>
          <Select value={f.view} onChange={(e) => setF({ ...f, view: e.target.value as View | "" })} aria-label={t("idn.pc.view")}>
            <option value="">{t("idn.pc.vAll")}</option>
            {(["stale", "eol", "noAsset", "unmonitored", "findings", "disabled"] as const).map((v) => (
              <option key={v} value={v}>
                {t.dyn(`idn.pc.v${v[0]!.toUpperCase()}${v.slice(1)}`, v)}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3">
          <Checkbox checked={f.removed} onChange={(v) => setF({ ...f, removed: v })} label={t("idn.odstraneneZAdresare")} />
        </div>
      </Card>
      {msg && <SuccessBox>{msg}</SuccessBox>}
      <ErrorBox error={list.error ?? create.error} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-slate-500">{t("idn.pc.count", { n: list.data?.total ?? 0 })}</span>
        {canAssets && sel.length > 0 && (
          <>
            <span className="text-sm text-slate-700">{t("idn.bulk.selected", { n: sel.length })}</span>
            <Button disabled={create.isPending} onClick={() => create.mutate()} data-testid="pc-create-assets">
              {t("idn.pc.createAssets")}
            </Button>
          </>
        )}
        <a href={api.identity.computersExportUrl("csv", fq)} download>
          <Button variant="secondary">
            <Download size={15} /> CSV
          </Button>
        </a>
        <a href={api.identity.computersExportUrl("xlsx", fq)} download>
          <Button variant="secondary">
            <Download size={15} /> XLSX
          </Button>
        </a>
      </div>
      <Card>
        {list.data && !items.length ? (
          <EmptyState>{t("idn.pc.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="pc-table">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {canAssets && (
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={t("idn.pc.selectAll")}
                        checked={!!selectable.length && sel.length === selectable.length}
                        onChange={(e) => setSel(e.target.checked ? selectable.map((p) => p.id) : [])}
                      />
                    </th>
                  )}
                  <th className="px-4 py-2">{t("idn.pc.computer")}</th>
                  <th className="px-3 py-2">{t("idn.pc.os")}</th>
                  <th className="px-3 py-2">{t("idn.posledniPrihlaseni")}</th>
                  <th className="px-3 py-2">{t("idn.pc.laps")}</th>
                  <th className="px-3 py-2">{t("idn.pc.delegation")}</th>
                  <th className="px-3 py-2">{t("idn.pc.asset")}</th>
                  <th className="px-3 py-2">{t("idn.pc.monitoring")}</th>
                  <th className="px-3 py-2">{t("idn.nalezy")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((p) => {
                  const server = p.role === "server" || p.role === "dc";
                  return (
                    <tr key={p.id} className="align-top hover:bg-slate-50">
                      {canAssets && (
                        <td className="px-3 py-2">
                          {!p.asset && !p.removedAt && (
                            <input type="checkbox" aria-label={p.name} checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2">
                        <span className="font-medium">{p.name}</span> <Badge tone={p.role === "dc" ? "blue" : p.role === "server" ? "violet" : "slate"}>{t.lbl(COMPUTER_ROLE_LABELS[p.role as ComputerRole])}</Badge>
                        {!p.enabled && <Badge tone="slate">{t("idn.zakazany")}</Badge>}
                        <span className="block text-xs text-slate-500">
                          {p.dnsName ?? ""}
                          {p.ou ? ` · ${p.ou}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.os ?? "—"}
                        {p.os && (
                          <span className="mt-0.5 block">
                            <SupportBadge status={p.support} eolDate={p.eolDate} />
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{p.lastLogonAt ? fmtDate(p.lastLogonAt) : t("idn.pc.never")}</td>
                      <td className="px-3 py-2 text-xs">{p.role === "dc" ? "—" : yesNo(p.laps, true)}</td>
                      <td className="px-3 py-2 text-xs">
                        {p.unconstrainedDelegation ? <span className="font-medium text-red-700">{t("idn.pc.unconstrained")}</span> : p.constrainedDelegation ? t("idn.pc.constrained") : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.asset ? (
                          <a href={`/assets/${p.asset.id}`} className="text-brand-700 hover:underline">
                            {p.asset.name}
                          </a>
                        ) : (
                          <span className="text-amber-700">{t("idn.pc.noAsset")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.monitoring.length ? p.monitoring.map((m) => t.dyn(`idn.pc.mon.${m}`, m)).join(", ") : server ? <span className="font-medium text-red-700">{t("idn.pc.none")}</span> : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {p.openFindings ? (
                          <button type="button" className="text-brand-700 hover:underline" onClick={() => onFindings(p.id)}>
                            {p.openFindings}
                          </button>
                        ) : (
                          <CheckCircle2 size={15} className="text-green-600" aria-label={t("idn.bezNalezu")} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.data && list.data.total > items.length && <p className="px-4 py-2 text-xs text-slate-500">{t("idn.pc.truncated", { n: items.length })}</p>}
          </div>
        )}
      </Card>
    </>
  );
}
