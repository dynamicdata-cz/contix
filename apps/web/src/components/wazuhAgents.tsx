import { Badge, Button, Input, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { WAZUH_STALE_DAYS, type WazuhAgentDto, type WazuhAgentState } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

/* ============================================================
 * Připojená zařízení Wazuhu (v1.93, ADR-187) – sekce panelu mapy propojení a úplný seznam v okně.
 * ============================================================ */

const DOT: Record<WazuhAgentState, string> = { active: "bg-emerald-500", disconnected: "bg-red-500", pending: "bg-amber-500", removed: "bg-slate-300" };
type Filter = "problems" | "all" | WazuhAgentState | "outdated" | "stale";

const offline = (t: ReturnType<typeof useT>, days: number) => (days ? t("imap.wz.offline", { days }) : t("imap.wz.offlineToday"));
const isStale = (a: WazuhAgentDto) => a.state === "disconnected" && (a.offlineDays === null || a.offlineDays >= WAZUH_STALE_DAYS);
const isProblem = (a: WazuhAgentDto) => a.state === "disconnected" || a.state === "pending" || (a.outdated && a.state !== "removed") || a.criticalVulns > 0;

function match(a: WazuhAgentDto, f: Filter, q: string) {
  if (q) {
    const s = `${a.name} ${a.ip ?? ""} ${a.groups.join(" ")} ${a.os ?? ""} ${a.asset?.name ?? ""} ${a.agentId}`.toLowerCase();
    if (!s.includes(q.toLowerCase())) return false;
  }
  switch (f) {
    case "all":
      return true;
    case "problems":
      return isProblem(a);
    case "outdated":
      return a.outdated && a.state !== "removed";
    case "stale":
      return isStale(a);
    default:
      return a.state === f;
  }
}

function AgentLine({ a }: { a: WazuhAgentDto }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[a.state])} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {a.asset ? (
            <Link to="/assets/$assetId" params={{ assetId: a.asset.id }} className="truncate font-medium text-slate-900 hover:text-brand-700 hover:underline">
              {a.name}
            </Link>
          ) : (
            <span className="truncate font-medium">{a.name}</span>
          )}
          <span className="ml-auto shrink-0 text-xs text-slate-500">{t(`imap.wz.st.${a.state}`)}</span>
        </div>
        <p className="truncate text-xs text-slate-500">
          {[
            a.ip,
            a.state === "active" ? null : a.offlineDays === null ? t("imap.wz.never") : offline(t, a.offlineDays),
            a.version && (a.outdated ? `${a.version} · ${t("imap.wz.old")}` : a.version),
            a.criticalVulns ? t("imap.wz.crit", { n: a.criticalVulns }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

/** Sekce v panelu uzlu Wazuhu. */
export function WazuhAgentsSection({ connectionId }: { connectionId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["integrations", "wazuh-agents", connectionId], queryFn: () => api.integrations.wazuhAgents(connectionId) });
  const [open, setOpen] = useState<Filter | null>(null);
  const d = q.data;
  if (!d) return q.isLoading ? <p className="text-xs text-slate-500">…</p> : null;
  const s = d.summary;
  const problems = d.items.filter(isProblem);
  const chip = (f: Filter, label: string, n: number, cls: string) =>
    n > 0 && (
      <button key={f} type="button" onClick={() => setOpen(f)} className={cn("rounded-md border px-2 py-1 text-left hover:bg-slate-50", cls)} data-testid={`wz-chip-${f}`}>
        <span className="block text-base font-semibold leading-tight tabular-nums">{n}</span>
        <span className="text-[11px] leading-tight text-slate-600">{label}</span>
      </button>
    );
  return (
    <section className="mb-3" data-testid="wz-agents">
      <h3 className="mb-1 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("imap.wz.title")}
        {d.managerVersion && <span className="ml-auto font-normal normal-case">{t("imap.wz.manager", { v: d.managerVersion })}</span>}
      </h3>
      {!s.total ? (
        <p className="text-xs text-slate-500">{t("imap.wz.noAgents")}</p>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            {chip("active", t("imap.wz.sum.active"), s.active, "border-emerald-200")}
            {chip("stale", t("imap.wz.sum.stale", { days: WAZUH_STALE_DAYS }), s.stale, "border-red-200")}
            {chip("disconnected", t("imap.wz.sum.disconnected"), s.disconnected, "border-red-100")}
            {chip("pending", t("imap.wz.sum.pending"), s.pending, "border-amber-200")}
            {chip("outdated", t("imap.wz.sum.outdated"), s.outdated, "border-amber-200")}
            {chip("removed", t("imap.wz.sum.removed"), s.removed, "border-slate-200")}
          </div>
          {problems.length ? (
            <div className="divide-y divide-slate-100">
              {problems.slice(0, 6).map((a) => (
                <AgentLine key={a.agentId} a={a} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-emerald-700">{t("imap.wz.allOk")}</p>
          )}
          <Button variant="secondary" className="mt-2 w-full justify-center py-1 text-xs" onClick={() => setOpen(problems.length ? "problems" : "all")} data-testid="wz-show-all">
            {t("imap.wz.showAll", { n: s.total })}
          </Button>
        </>
      )}
      {open && <AgentsModal connectionId={connectionId} title={d.connection.name} items={d.items} lastSyncAt={d.lastSyncAt} initial={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function AgentsModal({ connectionId, title, items, lastSyncAt, initial, onClose }: { connectionId: string; title: string; items: WazuhAgentDto[]; lastSyncAt: string | null; initial: Filter; onClose: () => void }) {
  const t = useT();
  const [f, setF] = useState<Filter>(initial);
  const [q, setQ] = useState("");
  const list = useMemo(() => items.filter((a) => match(a, f, q)), [items, f, q]);
  const tabs: [Filter, string][] = [
    ["problems", t("imap.wz.problems")],
    ["all", t("imap.wz.all")],
    ["active", t("imap.wz.sum.active")],
    ["disconnected", t("imap.wz.sum.disconnected")],
    ["pending", t("imap.wz.sum.pending")],
    ["outdated", t("imap.wz.sum.outdated")],
    ["removed", t("imap.wz.sum.removed")],
  ];
  return (
    <Modal open onClose={onClose} wide title={`${t("imap.wz.title")} – ${title}`}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={f === k}
            onClick={() => setF(k)}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs", f === k ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 hover:border-slate-300")}
          >
            {label} <span className="tabular-nums text-slate-500">{items.filter((a) => match(a, k, "")).length}</span>
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          <a href={api.integrations.wazuhAgentsExportUrl(connectionId, "csv")} download>
            <Button variant="secondary" className="px-2 py-1 text-xs">
              <Download size={13} /> CSV
            </Button>
          </a>
          <a href={api.integrations.wazuhAgentsExportUrl(connectionId, "xlsx")} download>
            <Button variant="secondary" className="px-2 py-1 text-xs">
              <Download size={13} /> XLSX
            </Button>
          </a>
        </div>
      </div>
      <Input placeholder={t("imap.wz.search")} value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
      {list.length ? (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm" data-testid="wz-table">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">{t("imap.wz.col.name")}</th>
                <th className="px-3 py-2">{t("imap.wz.col.state")}</th>
                <th className="px-3 py-2">{t("imap.wz.col.lastKeepAlive")}</th>
                <th className="px-3 py-2">{t("imap.wz.col.version")}</th>
                <th className="px-3 py-2">{t("imap.wz.col.os")}</th>
                <th className="px-3 py-2">{t("imap.wz.col.groups")}</th>
                <th className="px-3 py-2 text-right">{t("imap.wz.col.openVulns")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((a) => (
                <tr key={a.agentId} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-2">
                    {a.asset ? (
                      <Link to="/assets/$assetId" params={{ assetId: a.asset.id }} className="font-medium text-brand-700 hover:underline">
                        {a.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{a.name}</span>
                    )}
                    <span className="block text-xs text-slate-500">
                      {a.agentId}
                      {a.ip ? ` · ${a.ip}` : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span className={cn("mr-1.5 inline-block h-2 w-2 rounded-full", DOT[a.state])} aria-hidden />
                    {t(`imap.wz.st.${a.state}`)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {a.lastKeepAlive ? fmtDate(a.lastKeepAlive) : t("imap.wz.never")}
                    {a.state !== "active" && a.offlineDays !== null && <span className={cn("block", isStale(a) ? "font-medium text-red-700" : "text-slate-500")}>{offline(t, a.offlineDays)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {a.version ?? "—"}
                    {a.outdated && (
                      <Badge tone="amber">
                        {t("imap.wz.old")}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{a.os ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{a.groups.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {a.openVulns}
                    {a.criticalVulns > 0 && <span className="block font-medium text-red-700">{t("imap.wz.crit", { n: a.criticalVulns })}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-slate-500">{t("imap.wz.none")}</p>
      )}
      {lastSyncAt && <p className="mt-3 text-xs text-slate-500">{t("imap.wz.asOf", { date: fmtDate(lastSyncAt) })}</p>}
    </Modal>
  );
}
