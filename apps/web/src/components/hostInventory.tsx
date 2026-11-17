import { Badge, Card, CardHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { HOST_FINDING_LABELS, type HostInventoryDto } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

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

function HostCard({ h }: { h: HostInventoryDto }) {
    const t = useT();
    const d = h.data;
    const fw = d.firewall;
    const tone = { high: "red", medium: "amber", low: "slate" } as const;
    return (
      <Card className="lg:col-span-3" data-testid="host-inventory">
        <CardHeader
          title={t("col.asset.title")}
          subtitle={t("col.asset.at", { date: fmtDate(h.collectedAt), conn: h.connectionName })}
          action={
            <Link to="/discovery/hosts/$hostId" params={{ hostId: h.id }} className="text-sm text-brand-700 hover:underline" data-testid="host-detail-link">
              {t("hd.open")}
            </Link>
          }
        />
        <div className="space-y-4 p-5 text-sm">
          {h.findings.length ? (
            <ul className="space-y-1">
              {h.findings.map((f, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <Badge tone={tone[f.severity]}>{f.severity === "high" ? "!" : f.severity === "medium" ? "~" : "i"}</Badge>
                  <span>{t.lbl(HOST_FINDING_LABELS[f.code])}</span>
                  {f.subject && <code className="text-xs text-slate-500">{f.subject}</code>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-emerald-700">{t("col.asset.ok")}</p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h3 className="mb-1 font-semibold text-slate-800">{t("col.users")}</h3>
              <ul className="space-y-0.5 text-xs text-slate-600">
                {d.users.map((u) => (
                  <li key={u.name}>
                    <code>{u.name}</code> (uid {u.uid}) {u.sudo && <Badge tone="amber">sudo</Badge>} {u.locked && <Badge>{t("col.locked")}</Badge>}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 font-semibold text-slate-800">{t("col.keys")}</h3>
              <ul className="space-y-0.5 text-xs text-slate-600">
                {d.sshKeys.map((k, i) => (
                  <li key={i} className="truncate">
                    <code>{k.user}</code> · {k.type}
                    {k.bits ? ` ${k.bits}` : ""} · {k.comment || "—"} · <code className="text-slate-400">{k.fingerprint}</code>
                  </li>
                ))}
              </ul>
            </section>
            {d.containers.length > 0 && (
              <section>
                <h3 className="mb-1 font-semibold text-slate-800">{t("col.containers")}</h3>
                <ul className="space-y-0.5 text-xs text-slate-600">
                  {d.containers.map((c) => (
                    <li key={c.name} className="truncate">
                      <code>{c.name}</code> · {c.image} · {c.status}
                      {c.privileged && <Badge tone="red">privileged</Badge>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="mb-1 font-semibold text-slate-800">{t("col.firewall")}</h3>
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
