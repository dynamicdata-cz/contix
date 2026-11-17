import { Badge, Card, CardHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { HOST_FINDING_LABELS, type HostInventoryDto } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Inventář serveru ze sběrače (v1.51, ADR-148): nálezy, účty, SSH klíče, kontejnery, firewall. */
export function HostInventoryCard({ assetId }: { assetId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["hosts", "asset", assetId], queryFn: () => api.hosts.byAsset(assetId) });
  if (!q.data?.length) return null;
  return (
    <>
      {q.data.map((h) => (
        <HostCard key={h.id} h={h} />
      ))}
    </>
  );
}

const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;
const tone = { high: "red", medium: "amber", low: "slate" } as const;
/** Kolik položek seznamu ukázat u aktiva – zbytek je v detailu serveru. */
const SHOW = { findings: 6, users: 12, keys: 4, containers: 4 };

/**
 * Inventář serveru u aktiva – stručný přehled: souhrnné dlaždice, nálezy seskupené podle druhu a zkrácené seznamy.
 * Úplné seznamy (všechny účty, klíče, porty, služby, balíčky, historie) jsou v detailu serveru.
 */
function HostCard({ h }: { h: HostInventoryDto }) {
  const t = useT();
  const d = h.data;
  const fw = d.firewall;
  const detail = { to: "/discovery/hosts/$hostId", params: { hostId: h.id } } as const;
  // nálezy stejného druhu dohromady: „Klíč bez komentáře ×5“ místo pěti řádků
  const groups = [...h.findings.reduce((m, f) => m.set(f.code, [...(m.get(f.code) ?? []), f]), new Map<string, HostInventoryDto["findings"]>()).values()].sort(
    (a, b) => SEV_ORDER[a[0]!.severity] - SEV_ORDER[b[0]!.severity] || b.length - a.length,
  );
  const n = (sev: keyof typeof tone) => h.findings.filter((f) => f.severity === sev).length;
  const failed = d.services.filter((s) => s.state === "failed").length;
  const more = (rest: number) =>
    rest > 0 ? (
      <Link {...detail} className="text-xs text-brand-700 hover:underline">
        {t("col.more", { n: rest })}
      </Link>
    ) : null;
  return (
    <Card className="lg:col-span-3" data-testid="host-inventory">
      <CardHeader
        title={d.collectorVersion.startsWith("agent") ? t("col.asset.titleAgent") : t("col.asset.title")}
        subtitle={t("col.asset.at", { date: fmtDate(h.collectedAt), conn: h.connectionName })}
        action={
          <Link {...detail} className="text-sm text-brand-700 hover:underline" data-testid="host-detail-link">
            {t("hd.open")}
          </Link>
        }
      />
      <div className="space-y-4 p-5 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6" data-testid="host-inventory-stats">
          <Stat label={t("col.st.findings")}>
            {h.findings.length ? (
              <span className="flex flex-wrap gap-1">
                {(["high", "medium", "low"] as const).map((s) => n(s) > 0 && <Badge key={s} tone={tone[s]}>{n(s)}</Badge>)}
              </span>
            ) : (
              <span className="text-emerald-700">0</span>
            )}
          </Stat>
          <Stat label={t("col.st.users")}>
            {d.users.length}
            {d.users.some((u) => u.sudo) && <span className="ml-1 text-xs font-normal text-slate-500">({t("col.st.sudo", { n: d.users.filter((u) => u.sudo).length })})</span>}
          </Stat>
          <Stat label={t("col.st.keys")}>{d.sshKeys.length}</Stat>
          <Stat label={t("col.st.ports")}>{d.listening.length}</Stat>
          <Stat label={t("col.st.services")}>
            {d.services.length}
            {failed > 0 && (
              <span className="ml-1.5">
                <Badge tone="red">{t("col.st.failed", { n: failed })}</Badge>
              </span>
            )}
          </Stat>
          {d.packages.length > 0 ? <Stat label={t("col.st.packages")}>{d.packages.length}</Stat> : <Stat label={t("col.st.containers")}>{d.containers.length}</Stat>}
        </div>

        {groups.length ? (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200" data-testid="host-inventory-findings">
            {groups.slice(0, SHOW.findings).map((g) => (
              <li key={g[0]!.code} className="flex items-center gap-2 px-3 py-1.5">
                <Badge tone={tone[g[0]!.severity]}>{g[0]!.severity === "high" ? "!" : g[0]!.severity === "medium" ? "~" : "i"}</Badge>
                <span className="min-w-0 flex-1 truncate">
                  {t.lbl(HOST_FINDING_LABELS[g[0]!.code])}
                  {g.length === 1 && g[0]!.subject && <code className="ml-2 text-xs text-slate-500">{g[0]!.subject}</code>}
                </span>
                {g.length > 1 && <span className="shrink-0 text-xs text-slate-500">×{g.length}</span>}
              </li>
            ))}
            {groups.length > SHOW.findings && <li className="px-3 py-1.5">{more(groups.length - SHOW.findings)}</li>}
          </ul>
        ) : (
          <p className="text-emerald-700">{t("col.asset.ok")}</p>
        )}

        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("col.users")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {[...d.users]
                .sort((a, b) => Number(b.uid === 0) - Number(a.uid === 0) || Number(b.sudo) - Number(a.sudo) || a.name.localeCompare(b.name))
                .slice(0, SHOW.users)
                .map((u) => (
                  <span key={u.name} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs" title={`uid ${u.uid}`}>
                    <code>{u.name}</code>
                    {u.sudo && <span className="font-medium text-amber-700">sudo</span>}
                    {u.locked && <span className="text-slate-400">{t("col.locked")}</span>}
                  </span>
                ))}
              {d.users.length === 0 && <span className="text-xs text-slate-500">—</span>}
            </div>
            <div className="mt-1">{more(d.users.length - SHOW.users)}</div>
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("col.keys")}</h3>
            <ul className="space-y-0.5 text-xs text-slate-600">
              {d.sshKeys.slice(0, SHOW.keys).map((k, i) => (
                <li key={i} className="truncate" title={k.fingerprint}>
                  <code>{k.user}</code> · {k.type}
                  {k.bits ? ` ${k.bits}` : ""} · {k.comment || "—"}
                </li>
              ))}
              {d.sshKeys.length === 0 && <li>—</li>}
            </ul>
            <div className="mt-1">{more(d.sshKeys.length - SHOW.keys)}</div>
          </section>
          {d.containers.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("col.containers")}</h3>
              <ul className="space-y-0.5 text-xs text-slate-600">
                {d.containers.slice(0, SHOW.containers).map((c) => (
                  <li key={c.name} className="truncate">
                    <code>{c.name}</code> · {c.image} · {c.status}
                    {c.privileged && <Badge tone="red">privileged</Badge>}
                  </li>
                ))}
              </ul>
              <div className="mt-1">{more(d.containers.length - SHOW.containers)}</div>
            </section>
          )}
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("col.firewall")}</h3>
            <p className="text-xs text-slate-600">
              {fw.tool === "none"
                ? "—"
                : t("col.fw.line", { tool: fw.tool, policy: fw.defaultInput ?? "?", n: fw.ruleCount, persist: fw.rulesHash && fw.rulesHash === fw.savedHash ? t("col.fw.saved") : t("col.fw.notSaved") })}
            </p>
          </section>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-center text-base font-semibold text-slate-900">{children}</div>
    </div>
  );
}

/** Přehled serverů ze sběrače (Discovery). */
export function HostList() {
  const t = useT();
  const q = useQuery({ queryKey: ["hosts"], queryFn: api.hosts.list });
  const rows = q.data ?? [];
  return (
    <Card className="mb-6" data-testid="host-list">
      <CardHeader title={t("col.list.title")} />
      {!rows.length ? (
        <p className="px-5 py-4 text-sm text-slate-500">{t("col.list.empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((h) => (
              <tr key={h.id}>
                <td className="px-5 py-2 font-medium">
                  <Link to="/discovery/hosts/$hostId" params={{ hostId: h.id }} className="text-brand-700 hover:underline">
                    {h.hostname}
                  </Link>
                  {h.os && <span className="ml-2 text-xs font-normal text-slate-500">{h.os}</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{h.connectionName}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(h.collectedAt)}</td>
                <td className="px-3 py-2 text-right">
                  {h.high > 0 && <Badge tone="red">{h.high}</Badge>} {h.medium > 0 && <Badge tone="amber">{h.medium}</Badge>} {h.low > 0 && <Badge>{h.low}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
