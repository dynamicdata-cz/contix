import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Input, Kpi, PageHeader, Select } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { AssetPicker, type PickedAsset } from "@/components/pickers";
import { useCan } from "@/lib/auth";
import { Tabs, useTab } from "@/components/ui/tabs";
import { FindingsTable } from "@/pages/Findings";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { HOST_CHANGE_LABELS, HOST_FINDING_GUIDE, HOST_FINDING_LABELS, type HostDetailDto, type HostFinding, type HostInventory } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

/* ============================================================
 * Detail serveru ze sběrače (v1.55): nálezy s vysvětlením a nápravou, účty a klíče, kontejnery, služby a porty,
 * systém a SSH, historie změn. Vše jen z posledního inventáře; historie z host_inventory_changes.
 * ============================================================ */

const TABS = ["findings", "accounts", "containers", "network", "system", "history"] as const;
type Tab = (typeof TABS)[number];
const tone = { high: "red", medium: "amber", low: "slate" } as const;
const ALL_IFACES = new Set(["0.0.0.0", "::", "*", ""]);

export function HostDetailPage() {
  const t = useT();
  const { hostId } = useParams({ strict: false }) as { hostId: string };
  const q = useQuery({ queryKey: ["hosts", hostId], queryFn: () => api.hosts.get(hostId) });
  const [tab, setTab] = useTab(TABS, "findings");
  if (q.error) return <ErrorBox error={q.error} />;
  const h = q.data;
  if (!h) return null;
  const d = h.data;
  const sev = (s: HostFinding["severity"]) => h.findings.filter((f) => f.severity === s).length;
  const running = d.containers.filter((c) => /^up/i.test(c.status)).length;
  return (
    <div data-testid="host-detail">
      <PageHeader
        title={h.hostname}
        subtitle={[d.host.os, d.host.kernel].filter(Boolean).join(" · ")}
        actions={
          h.assetId ? (
            <Link to="/assets/$assetId" params={{ assetId: h.assetId }} className="text-sm text-brand-700 hover:underline">
              {t("hd.asset", { name: h.assetName ?? h.hostname })}
            </Link>
          ) : (
            <span className="text-sm text-slate-500" data-testid="host-no-asset">
              {t("hd.noAsset")}
            </span>
          )
        }
      />
      {!h.assetId && <AssetActions h={h} />}
      <Card className="mb-4 p-5">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t("hd.ips")}>{d.host.ips.join(", ") || "—"}</Fact>
          <Fact label="FQDN">{d.host.fqdn ?? "—"}</Fact>
          <Fact label={t("hd.lastReport")}>{fmtDate(h.collectedAt)}</Fact>
          <Fact label={t("hd.collector")}>
            {h.connectionName} · {d.collectorVersion || "?"}
          </Fact>
          <Fact label={t("hd.booted")}>{d.system?.bootedAt ? `${fmtDate(d.system.bootedAt)} (${uptime(d.system.uptimeSeconds)})` : "—"}</Fact>
          <Fact label={t("hd.machineId")}>
            <code className="text-xs">{d.host.machineId ?? "—"}</code>
          </Fact>
        </dl>
      </Card>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t("hd.tile.findings")} onClick={() => setTab("findings")}>
          <span className="text-red-700">{sev("high")}</span> / <span className="text-amber-700">{sev("medium")}</span> / <span className="text-slate-500">{sev("low")}</span>
        </Tile>
        <Tile label={t("hd.tile.accounts")} onClick={() => setTab("accounts")}>
          {d.users.length} <span className="text-sm font-normal text-slate-500">({t("hd.sudoN", { n: d.users.filter((u) => u.sudo).length })})</span>
        </Tile>
        <Tile label={t("hd.tile.keys")} onClick={() => setTab("accounts")}>
          {d.sshKeys.length}
        </Tile>
        <Tile label={t("hd.tile.containers")} onClick={() => setTab("containers")}>
          {running} / {d.containers.length}
        </Tile>
        <Tile label={t("hd.tile.ports")} onClick={() => setTab("network")}>
          {new Set(d.listening.map((p) => `${p.proto}/${p.port}`)).size}
        </Tile>
        <Tile label={t("hd.tile.updates")} onClick={() => setTab("system")}>
          {d.system?.updatesPending == null ? "—" : d.system.updatesPending}
          {!!d.system?.securityUpdates && <span className="text-sm font-normal text-amber-700"> ({t("hd.securityN", { n: d.system.securityUpdates })})</span>}
        </Tile>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "findings", label: t("hd.tab.findings"), badge: h.findings.length ? <Badge tone={sev("high") ? "red" : "amber"}>{h.findings.length}</Badge> : undefined },
          { key: "accounts", label: t("hd.tab.accounts") },
          { key: "containers", label: t("hd.tab.containers") },
          { key: "network", label: t("hd.tab.network") },
          { key: "system", label: t("hd.tab.system") },
          { key: "history", label: t("hd.tab.history"), badge: h.changes.length ? <Badge>{h.changes.length}</Badge> : undefined },
        ]}
      />
      {tab === "findings" && (
        <div className="space-y-4">
          <HostFindingsLifecycle hostId={h.id} />
          <Findings h={h} />
        </div>
      )}
      {tab === "accounts" && <Accounts d={d} />}
      {tab === "containers" && <Containers d={d} />}
      {tab === "network" && <Network d={d} reachable={h.reachable} />}
      {tab === "system" && <SystemTab d={d} />}
      {tab === "history" && <History h={h} />}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-slate-800">{children}</dd>
    </div>
  );
}

function Tile({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return <Kpi label={label} value={children} onClick={onClick} />;
}

function uptime(s: number | null | undefined) {
  if (!s) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d} d ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
}

/** Rozbalovací řádek (nativní details – klávesnice i čtečky). */
function Row({ summary, children, testId }: { summary: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <details className="group border-b border-slate-100 last:border-0" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="space-y-2 bg-slate-50 px-11 py-3 text-sm text-slate-700">{children}</div>
    </details>
  );
}

function Findings({ h }: { h: HostDetailDto }) {
  const t = useT();
  if (!h.findings.length) return <Card className="p-5 text-sm text-emerald-700">{t("col.asset.ok")}</Card>;
  const order = { high: 0, medium: 1, low: 2 };
  const list = [...h.findings].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <Card>
      {list.map((f, i) => (
        <Row
          key={i}
          testId={`host-finding-${f.code}`}
          summary={
            <>
              <Badge tone={tone[f.severity]}>{t(`hd.sev.${f.severity}`)}</Badge>
              <span className="flex-1">{t.lbl(HOST_FINDING_LABELS[f.code])}</span>
              {f.subject && <code className="truncate text-xs text-slate-500">{f.subject}</code>}
            </>
          }
        >
          <p>
            <span className="font-medium">{t("hd.why")}</span> {t.lbl(HOST_FINDING_GUIDE[f.code].why)}
          </p>
          <p>
            <span className="font-medium">{t("hd.fix")}</span> {t.lbl(HOST_FINDING_GUIDE[f.code].fix)}
          </p>
        </Row>
      ))}
    </Card>
  );
}

function Accounts({ d }: { d: HostInventory }) {
  const t = useT();
  const [q, setQ] = useState("");
  const users = d.users.filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()));
  const orphan = d.sshKeys.filter((k) => !d.users.some((u) => u.name === k.user));
  return (
    <Card>
      <CardHeader title={t("hd.accounts.title")} subtitle={t("hd.accounts.sub")} action={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("hd.search")} className="w-48" />} />
      {users.map((u) => {
        const keys = d.sshKeys.filter((k) => k.user === u.name);
        return (
          <Row
            key={u.name}
            testId={`host-user-${u.name}`}
            summary={
              <>
                <code className="font-semibold text-slate-900">{u.name}</code>
                <span className="text-xs text-slate-500">uid {u.uid}</span>
                {u.uid === 0 && <Badge tone={u.name === "root" ? "slate" : "red"}>root</Badge>}
                {u.sudo && <Badge tone="amber">sudo</Badge>}
                {u.locked && <Badge>{t("col.locked")}</Badge>}
                <span className="flex-1" />
                <span className="text-xs text-slate-500">{t("hd.keysN", { n: keys.length })}</span>
              </>
            }
          >
            <p className="text-xs text-slate-500">
              {t("hd.shell")} <code>{u.shell || "—"}</code> · {t("hd.home")} <code>{u.home || "—"}</code> · {t("hd.lastLogin")} {u.lastLogin ?? t("hd.never")}
            </p>
            {keys.length ? <KeyTable keys={keys} /> : <p className="text-xs text-slate-500">{t("hd.noKeys")}</p>}
          </Row>
        );
      })}
      {orphan.length > 0 && (
        <div className="px-5 py-3">
          <p className="mb-1 text-xs font-medium text-slate-600">{t("hd.orphanKeys")}</p>
          <KeyTable keys={orphan} />
        </div>
      )}
    </Card>
  );
}

function KeyTable({ keys }: { keys: HostInventory["sshKeys"] }) {
  const t = useT();
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-slate-500">
        <tr>
          <th className="py-1 pr-3">{t("hd.key.type")}</th>
          <th className="py-1 pr-3">{t("hd.key.comment")}</th>
          <th className="py-1 pr-3">{t("hd.key.fp")}</th>
          <th className="py-1">{t("hd.key.opts")}</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k, i) => (
          <tr key={i} className="align-top">
            <td className="py-1 pr-3">
              {k.type}
              {k.bits ? ` ${k.bits}` : ""}
            </td>
            <td className="py-1 pr-3">{k.comment || <span className="text-amber-700">{t("hd.key.noComment")}</span>}</td>
            <td className="break-all py-1 pr-3 font-mono text-slate-500">{k.fingerprint}</td>
            <td className="break-all py-1 font-mono text-slate-500">{k.options.join(", ") || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Containers({ d }: { d: HostInventory }) {
  const t = useT();
  if (!d.containers.length && !d.images.length) return <EmptyState>{t("hd.noDocker")}</EmptyState>;
  const usedBy = (img: HostInventory["images"][number]) => d.containers.filter((c) => c.image === `${img.repo}:${img.tag}` || (img.tag === "latest" && c.image === img.repo) || (!!img.id && !!c.imageId && c.imageId.includes(img.id))).map((c) => c.name);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("col.containers")} />
        {d.containers.map((c) => (
          <Row
            key={c.name}
            testId={`host-container-${c.name}`}
            summary={
              <>
                <code className="font-semibold text-slate-900">{c.name}</code>
                <span className="truncate text-xs text-slate-500">{c.image}</span>
                <span className="flex-1" />
                {c.privileged && <Badge tone="red">privileged</Badge>}
                {(!c.user || c.user === "root" || c.user === "0") && <Badge tone="amber">root</Badge>}
                <Badge tone={/^up/i.test(c.status) ? "green" : "slate"}>{c.status || "?"}</Badge>
              </>
            }
          >
            <p className="text-xs">
              {t("hd.c.project")} {c.project ?? "—"} · {t("hd.c.user")} <code>{c.user || "root"}</code> · image ID <code>{c.imageId?.slice(0, 19) ?? "—"}</code>
            </p>
            <p className="text-xs">
              {t("hd.c.ports")} {c.ports.length ? c.ports.map((p) => <code key={p} className="mr-2">{p}</code>) : "—"}
            </p>
          </Row>
        ))}
      </Card>
      <Card>
        <CardHeader title={t("hd.images")} subtitle={t("hd.imagesSub")} />
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {d.images.map((i, k) => {
              const u = usedBy(i);
              return (
                <tr key={k}>
                  <td className="px-5 py-2 font-mono text-xs">
                    {i.repo}:{i.tag}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{i.created ?? ""}</td>
                  <td className="px-3 py-2 text-xs">{u.length ? u.join(", ") : <span className="text-slate-400">{t("hd.unused")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Network({ d, reachable }: { d: HostInventory; reachable: HostDetailDto["reachable"] }) {
  const t = useT();
  const [filter, setFilter] = useState<"all" | "running" | "failed" | "enabled">("running");
  const ports = [...new Map(d.listening.map((p) => [`${p.proto}/${p.address}/${p.port}`, p])).values()].sort((a, b) => a.port - b.port);
  const services = d.services.filter((s) => (filter === "all" ? true : filter === "enabled" ? s.enabled : s.state === filter));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("hd.ports")} subtitle={t("hd.portsSub")} />
        <table className="w-full text-sm" data-testid="host-ports">
          <tbody className="divide-y divide-slate-100">
            {ports.map((p, i) => (
              <tr key={i}>
                <td className="px-5 py-1.5 font-mono text-xs">
                  {p.proto}/{p.port}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{p.address || "*"}</td>
                <td className="px-3 py-1.5 text-xs">{p.process ?? "—"}</td>
                <td className="px-3 py-1.5 text-right">
                  {reachable.some((x) => x.port === p.port && x.proto === p.proto.replace(/6$/, "")) && (
                    <Badge tone="red">{t("hd.reachable")}</Badge>
                  )}{" "}
                  {ALL_IFACES.has(p.address) ? <Badge tone="amber">{t("hd.allIfaces")}</Badge> : p.address.startsWith("127.") || p.address === "::1" ? <Badge>{t("hd.localOnly")}</Badge> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {reachable.length > 0 && <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-600">{t("hd.reachableNote", { date: fmtDate(reachable[0]!.at) })}</p>}
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
          {t("col.firewall")}:{" "}
          {d.firewall.tool === "none"
            ? t("hd.fwNone")
            : t("col.fw.line", { tool: d.firewall.tool, policy: d.firewall.defaultInput ?? "?", n: d.firewall.ruleCount, persist: d.firewall.rulesHash && d.firewall.rulesHash === d.firewall.savedHash ? t("col.fw.saved") : t("col.fw.notSaved") })}
        </div>
      </Card>
      <Card>
        <CardHeader
          title={t("hd.services")}
          action={
            <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-40">
              <option value="running">{t("hd.svc.running")}</option>
              <option value="failed">{t("hd.svc.failed")}</option>
              <option value="enabled">{t("hd.svc.enabled")}</option>
              <option value="all">{t("hd.svc.all")}</option>
            </Select>
          }
        />
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {services.map((s) => (
              <tr key={s.name}>
                <td className="px-5 py-1.5 font-mono text-xs">{s.name}</td>
                <td className="px-3 py-1.5 text-xs">
                  <Badge tone={s.state === "running" ? "green" : s.state === "failed" ? "red" : "slate"}>{s.state}</Badge>
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-500">{s.enabled == null ? "" : s.enabled ? t("hd.svc.atBoot") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** Server bez aktiva (agent nenašel jednoznačnou shodu): založit aktivum z inventáře, nebo spárovat s existujícím. */
function AssetActions({ h }: { h: HostDetailDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [pick, setPick] = useState<PickedAsset[]>([]);
  const [pairing, setPairing] = useState(false);
  const attach = useMutation({
    mutationFn: (assetId: string | null) => api.hosts.attachAsset(h.id, assetId),
    onSuccess: (d, assetId) => {
      qc.setQueryData(["hosts", h.id], d);
      void qc.invalidateQueries({ queryKey: ["hosts"] });
      void qc.invalidateQueries({ queryKey: ["assets"] });
      toast(assetId ? t("hd.assetLinked", { name: d.assetName ?? "" }) : t("hd.assetCreated", { name: d.assetName ?? "" }));
    },
  });
  if (!can("assets:write")) return null;
  return (
    <Card className="mb-4 border-amber-200 bg-amber-50/60 p-5" data-testid="host-asset-actions">
      <p className="text-sm text-slate-700">{t("hd.noAssetHelp")}</p>
      <div className="mt-3 flex flex-wrap items-start gap-2">
        <Button onClick={() => attach.mutate(null)} disabled={attach.isPending} data-testid="host-asset-create">
          {t("hd.createAsset")}
        </Button>
        {!pairing && (
          <Button variant="secondary" onClick={() => setPairing(true)} disabled={attach.isPending}>
            {t("hd.linkAsset")}
          </Button>
        )}
      </div>
      {pairing && (
        <div className="mt-3 max-w-xl space-y-2">
          <AssetPicker value={pick} onChange={(v) => setPick(v.slice(-1))} />
          <div className="flex gap-2">
            <Button onClick={() => pick[0] && attach.mutate(pick[0].id)} disabled={!pick[0] || attach.isPending} data-testid="host-asset-link">
              {t("hd.linkConfirm")}
            </Button>
            <Button variant="secondary" onClick={() => (setPairing(false), setPick([]))}>
              {t("common.cancelAction")}
            </Button>
          </div>
        </div>
      )}
      {attach.error && <ErrorBox error={attach.error} />}
    </Card>
  );
}

function SystemTab({ d }: { d: HostInventory }) {
  const t = useT();
  const sd = d.sshd;
  const sy = d.system;
  const yn = (v: boolean | null | undefined, bad: boolean) => (v == null ? "—" : <Badge tone={v === bad ? "red" : "green"}>{v ? "yes" : "no"}</Badge>);
  const agent = d.collectorVersion.startsWith("agent");
  if (!sd && !sy && !agent) return <EmptyState>{t("hd.oldCollector")}</EmptyState>;
  return (
    <div className="space-y-4">
      {agent && <AgentSystem d={d} />}
      {(sd || sy) && <SshdUpdates d={d} yn={yn} />}
    </div>
  );
}

/** Balíčky a plánované úlohy (agent CONTIX, ADR-177). */
function AgentSystem({ d }: { d: HostInventory }) {
  const t = useT();
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const pkgs = f ? d.packages.filter((p) => p.name.toLowerCase().includes(f) || p.version.toLowerCase().includes(f)) : d.packages;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("hd.packages", { n: d.packages.length })} />
        <div className="p-5 pt-0">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("hd.packagesFilter")} aria-label={t("hd.packagesFilter")} className="mb-2" />
          <ul className="max-h-96 space-y-0.5 overflow-y-auto text-xs" data-testid="host-packages">
            {pkgs.slice(0, 500).map((p) => (
              <li key={`${p.name}:${p.arch}`}>
                <code>{p.name}</code> <span className="text-slate-500">{p.version}</span> {p.arch && <span className="text-slate-400">{p.arch}</span>}
              </li>
            ))}
          </ul>
          {pkgs.length > 500 && <p className="mt-2 text-xs text-slate-500">{t("hd.packagesMore", { n: pkgs.length - 500 })}</p>}
        </div>
      </Card>
      <Card>
        <CardHeader title={t("hd.scheduled", { n: d.scheduled.length })} subtitle={t("hd.scheduledHint")} />
        {d.scheduled.length ? (
          <table className="w-full text-xs" data-testid="host-scheduled">
            <tbody>
              {d.scheduled.map((s, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-5 py-1.5">
                    <code>{s.program || s.source}</code>
                    <div className="text-slate-400">{s.source}</div>
                  </td>
                  <td className="py-1.5">{s.user}</td>
                  <td className="py-1.5 pr-5 font-mono">{s.schedule || s.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-5 text-sm text-slate-500">—</p>
        )}
      </Card>
    </div>
  );
}

function SshdUpdates({ d, yn }: { d: HostInventory; yn: (v: boolean | null | undefined, bad: boolean) => ReactNode }) {
  const t = useT();
  const sd = d.sshd;
  const sy = d.system;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("hd.sshd")} subtitle="sshd -T" />
        {sd ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-5 text-sm">
            <dt>PermitRootLogin</dt>
            <dd>
              <Badge tone={sd.permitRootLogin === "yes" ? "red" : sd.permitRootLogin === "no" ? "green" : "amber"}>{sd.permitRootLogin ?? "—"}</Badge>
            </dd>
            <dt>PasswordAuthentication</dt>
            <dd>{yn(sd.passwordAuthentication, true)}</dd>
            <dt>PermitEmptyPasswords</dt>
            <dd>{yn(sd.permitEmptyPasswords, true)}</dd>
            <dt>PubkeyAuthentication</dt>
            <dd>{yn(sd.pubkeyAuthentication, false)}</dd>
            <dt>X11Forwarding</dt>
            <dd>{yn(sd.x11Forwarding, true)}</dd>
            <dt>MaxAuthTries</dt>
            <dd>{sd.maxAuthTries ?? "—"}</dd>
            <dt>Port</dt>
            <dd>{sd.ports.join(", ") || "—"}</dd>
            <dt>AllowUsers</dt>
            <dd className="break-all">{sd.allowUsers.join(" ") || "—"}</dd>
          </dl>
        ) : (
          <p className="p-5 text-sm text-slate-500">—</p>
        )}
      </Card>
      <Card>
        <CardHeader title={t("hd.updates")} subtitle={sy?.packageManager ?? undefined} />
        {sy ? (
          <div className="space-y-3 p-5 text-sm">
            <p>
              {t("hd.updatesLine", { n: sy.updatesPending ?? "?", s: sy.securityUpdates ?? "?" })} · {t("hd.autoUpdates")} {yn(sy.autoUpdates, false)} · {t("hd.reboot")} {yn(sy.rebootRequired, true)}
            </p>
            {sy.updates.length > 0 && (
              <ul className="max-h-80 space-y-0.5 overflow-y-auto text-xs" data-testid="host-updates">
                {sy.updates.map((u) => (
                  <li key={u.name}>
                    <code>{u.name}</code> <span className="text-slate-500">{u.version}</span> {u.security && <Badge tone="amber">security</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="p-5 text-sm text-slate-500">—</p>
        )}
      </Card>
    </div>
  );
}

function History({ h }: { h: HostDetailDto }) {
  const t = useT();
  if (!h.changes.length) return <EmptyState>{t("hd.noChanges")}</EmptyState>;
  const bad = new Set(["user_added", "sudo_granted", "key_added", "port_opened", "finding_new", "firewall_changed", "sshd_changed"]);
  return (
    <Card data-testid="host-history">
      {h.changes.map((c, i) => (
        <Row
          key={i}
          summary={
            <>
              <span className="w-40 shrink-0 text-xs text-slate-500">{fmtDate(c.collectedAt)}</span>
              <span className="flex-1 truncate">{[...new Set(c.changes.map((x) => t.lbl(HOST_CHANGE_LABELS[x.kind])))].join(", ")}</span>
              <Badge>{c.changes.length}</Badge>
            </>
          }
        >
          <ul className="space-y-0.5 text-xs">
            {c.changes.map((x, k) => (
              <li key={k}>
                <Badge tone={bad.has(x.kind) ? "amber" : "slate"}>{t.lbl(HOST_CHANGE_LABELS[x.kind])}</Badge> <code>{x.subject}</code>
              </li>
            ))}
          </ul>
        </Row>
      ))}
    </Card>
  );
}

/** Stav nálezů serveru – úkoly, přijaté riziko, opravené (v1.67): stejná tabulka jako stránka Nálezy. */
function HostFindingsLifecycle({ hostId }: { hostId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["findings", { hostId }], queryFn: () => api.findings.list({ hostId, source: "host", status: "all" }) });
  if (!q.data?.items.length) return null;
  return (
    <Card className="overflow-hidden" data-testid="host-findings-lifecycle">
      <CardHeader title={t("hd.lifecycle.title")} subtitle={t("hd.lifecycle.subtitle")} />
      <FindingsTable items={q.data.items} compact />
    </Card>
  );
}
