import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { AssetPicker, type PickedAsset } from "@/components/pickers";
import { HealthIndicator } from "@/components/health";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import {
  FacilityPhysical as FacilityPhysicalSchema,
  formatAddress,
  type MapSettings,
  FACILITY_KINDS,
  LABELS,
  PHYSICAL_CONTROLS,
  PHYSICAL_LEVELS,
  PHYSICAL_REVISION_MONTHS,
  recordPath,
  requiredPhysical,
  type FacilityKind,
  type FacilityPhysical,
  type HealthStatus,
  type LocationDetailDto,
  type LocationIssueDto,
  type LocationNodeDto,
  type PhysicalLevel,
  type PhysicalControl,
  type PhysicalRevision,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Map as MapIcon, MapPin, Settings, Warehouse, Pencil, Plus, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { LocationMap } from "@/components/locationMap";

/* ============================================================
 * Lokality (v1.104, ADR-198): budovy, patra, místnosti a datová centra jako aktiva typu „prostory“.
 * Strom z vazeb „umístěno v“, fyzická bezpečnost, technika v lokalitě, zóny a půdorysy, kontrola vazeb.
 * ============================================================ */

const LEVEL_TONE: Record<PhysicalLevel, "green" | "amber" | "red"> = { yes: "green", partial: "amber", no: "red" };

export function LocationsPage() {
  const t = useT();
  const can = useCan();
  const write = can("assets:write");
  const q = useQuery({ queryKey: ["premises"], queryFn: api.premises.list });
  // odkaz z povinností / nálezů: /assets/locations?id=<lokalita>
  const [sel, setSel] = useState<string | null>(() => new URLSearchParams(window.location.search).get("id"));
  const [edit, setEdit] = useState<LocationNodeDto | "new" | null>(null);
  const [newParent, setNewParent] = useState<string | null>(null);
  const d = q.data;
  const current = (sel && d?.nodes.some((n) => n.id === sel) ? sel : null) ?? d?.nodes[0]?.id ?? null;
  const ms = useQuery({ queryKey: ["premises", "mapSettings"], queryFn: api.premises.mapSettings });
  const [showMap, setShowMap] = useState(false);
  const [mapCfg, setMapCfg] = useState(false);
  const located = useMemo(() => (d?.nodes ?? []).filter((n) => n.physical.lat != null && n.physical.lng != null), [d]);
  const points = useMemo(() => located.map((n) => ({ id: n.id, lat: n.physical.lat!, lng: n.physical.lng!, label: [...n.path.map((p) => p.name), n.name].join(" › "), selected: n.id === current })), [located, current]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <Warehouse size={22} className="text-slate-400" /> {t("prem.title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("prem.sub")}</p>
        </div>
        {ms.data?.enabled && located.length > 0 && (
          <Button variant="secondary" onClick={() => setShowMap(!showMap)} data-testid="loc-map-toggle">
            <MapIcon size={15} /> {t(showMap ? "prem.map.hide" : "prem.map.show", { n: located.length })}
          </Button>
        )}
        {can("admin:settings") && (
          <Button variant="secondary" onClick={() => setMapCfg(true)} aria-label={t("prem.map.settings")} title={t("prem.map.settings")} data-testid="loc-map-settings">
            <Settings size={15} />
          </Button>
        )}
        {write && (
          <Button
            onClick={() => {
              setNewParent(null);
              setEdit("new");
            }}
            data-testid="loc-new"
          >
            <Plus size={15} /> {t("prem.new")}
          </Button>
        )}
      </div>
      <ErrorBox error={q.error} />
      {showMap && ms.data?.enabled && points.length > 0 && (
        <Card className="p-3">
          <LocationMap points={points} attribution={ms.data.attribution} onSelect={setSel} height={360} testId="loc-overview-map" />
        </Card>
      )}
      {mapCfg && ms.data && <MapSettingsModal value={ms.data} onClose={() => setMapCfg(false)} />}
      {d && !d.nodes.length && (
        <Card className="p-6" data-testid="loc-empty">
          <p className="text-sm text-slate-700">{t("prem.empty")}</p>
        </Card>
      )}
      {d && d.nodes.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          <Card>
            <CardHeader title={t("prem.tree")} subtitle={d.unplaced ? t("prem.unplaced", { n: d.unplaced }) : undefined} />
            <ul className="py-1" data-testid="loc-tree">
              {d.nodes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setSel(n.id)}
                    className={cn("flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-slate-50", n.id === current && "bg-brand-50 text-brand-900")}
                    style={{ paddingLeft: `${0.75 + n.depth * 1.1}rem` }}
                  >
                    <MapPin size={14} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">{n.name}</span>
                    {n.gaps.length > 0 && <AlertTriangle size={13} className="shrink-0 text-amber-500" aria-label={t("prem.gaps", { n: n.gaps.length })} />}
                    <span className="shrink-0 text-xs text-slate-500">{n.assetsTotal}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {current && (
            <LocationDetail
              id={current}
              write={write}
              onEdit={(n) => setEdit(n)}
              onAddChild={(pid) => {
                setNewParent(pid);
                setEdit("new");
              }}
            />
          )}
        </div>
      )}
      {write && d && <TextLocationsCard nodes={d.nodes} />}
      {d && d.issues.length > 0 && <IssuesCard issues={d.issues} nodes={d.nodes} write={write} />}
      {edit && (
        <LocationModal
          node={edit === "new" ? null : edit}
          parentId={edit === "new" ? newParent : (edit.parentId ?? null)}
          nodes={d?.nodes ?? []}
          onClose={() => setEdit(null)}
          onDone={(id) => {
            setEdit(null);
            setSel(id);
          }}
        />
      )}
    </div>
  );
}

function LocationDetail({ id, write, onEdit, onAddChild }: { id: string; write: boolean; onEdit: (n: LocationNodeDto) => void; onAddChild: (parentId: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["premises", id], queryFn: () => api.premises.get(id) });
  const [placing, setPlacing] = useState(false);
  const [mapsOpen, setMapsOpen] = useState(false);
  const refresh = (d: LocationDetailDto) => {
    qc.setQueryData(["premises", id], d);
    qc.invalidateQueries({ queryKey: ["premises"] });
    qc.invalidateQueries({ queryKey: ["zones"] });
  };
  const unplace = useMutation({ mutationFn: (assetId: string) => api.premises.unplace(id, assetId), onSuccess: refresh });
  const ms = useQuery({ queryKey: ["premises", "mapSettings"], queryFn: api.premises.mapSettings });
  const d = q.data;
  const pin = useMemo(() => (d && d.physical.lat != null && d.physical.lng != null ? [{ id: d.id, lat: d.physical.lat, lng: d.physical.lng, label: d.name, selected: true }] : []), [d]);
  if (!d) return <ErrorBox error={q.error} />;
  const required = new Set(requiredPhysical(d.kind));
  const addr = formatAddress(d.physical);
  return (
    <div className="space-y-6" data-testid="loc-detail">
      <Card>
        <CardHeader
          title={d.name}
          subtitle={[d.path.map((p) => p.name).join(" › "), d.kind ? t(`prem.kind.${d.kind}`) : t("prem.kindUnknown")].filter(Boolean).join(" · ")}
          action={
            <div className="flex gap-2">
              <Link to={recordPath("asset", d.id)} className="text-sm text-brand-700 hover:underline">
                {t("prem.openAsset")}
              </Link>
              {write && (
                <Button variant="secondary" className="px-2 py-1" onClick={() => onEdit(d)} aria-label={t("prem.edit")} data-testid="loc-edit">
                  <Pencil size={14} />
                </Button>
              )}
            </div>
          }
        />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Stat label={t("prem.assetsTotal")} value={d.assetsTotal} />
          <Stat label={t("prem.assetsCritical")} value={d.assetsCritical} />
          <Stat label={t("prem.zones")} value={d.zones.length} />
        </div>
        {(d.zones.length > 0 || d.maps.length > 0 || addr || pin.length > 0) && (
          <div className="space-y-1 border-t border-slate-100 px-5 py-3 text-sm">
            {(addr || pin.length > 0) && (
              <p className="flex flex-wrap items-center gap-2 text-slate-700" data-testid="loc-address">
                <MapPin size={14} className="text-slate-400" />
                {addr}
                {pin.length > 0 && <span className="text-xs text-slate-500">({d.physical.lat}, {d.physical.lng})</span>}
                <a
                  className="text-xs text-brand-700 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={pin.length ? `https://mapy.cz/zakladni?x=${d.physical.lng}&y=${d.physical.lat}&z=17&source=coor&id=${d.physical.lng}%2C${d.physical.lat}` : `https://mapy.cz/zakladni?q=${encodeURIComponent(addr)}`}
                >
                  {t("prem.map.openMapy")}
                </a>
              </p>
            )}
            {ms.data?.enabled && pin.length > 0 && <LocationMap points={pin} attribution={ms.data.attribution} height={220} testId="loc-detail-map" />}
            {d.zones.length > 0 && (
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">{t("prem.zones")}:</span>
                {d.zones.map((z) => (
                  <Link key={z.id} to="/assets/zones" className="inline-flex items-center gap-1 hover:underline">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: z.color }} aria-hidden /> {z.name}
                  </Link>
                ))}
              </p>
            )}
            {d.maps.length > 0 && (
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">{t("prem.maps")}:</span>
                {d.maps.map((m) => (
                  <Link key={m.id} to="/assets/maps" search={{ map: m.id } as never} className="hover:underline">
                    {m.name}
                  </Link>
                ))}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={t("prem.physical")} subtitle={d.gaps.length ? t("prem.gaps", { n: d.gaps.length }) : t("prem.physicalSub")} />
        <div className="grid gap-x-6 gap-y-2 p-5 sm:grid-cols-2" data-testid="loc-physical">
          {PHYSICAL_CONTROLS.map((k) => {
            const v = d.physical.controls[k];
            const rev = d.revisions.find((r) => r.control === k);
            return (
              <div key={k} className="flex items-center justify-between gap-2 text-sm">
                <span className={cn("text-slate-700", required.has(k) && "font-medium")}>
                  {t(`prem.ctl.${k}`)}
                  {required.has(k) && <span className="text-slate-400"> *</span>}
                </span>
                <span className="flex items-center gap-2">
                  {rev && (
                    <span
                      className={cn("text-xs", rev.status === "overdue" ? "font-medium text-red-700" : rev.status === "soon" ? "text-amber-700" : "text-slate-500")}
                      title={t("prem.rev.last", { d: fmtDay(rev.lastAt), m: rev.intervalMonths })}
                      data-testid={`loc-rev-${k}`}
                    >
                      {t(rev.status === "overdue" ? "prem.rev.overdue" : "prem.rev.due", { d: fmtDay(rev.due) })}
                    </span>
                  )}
                  {v ? <Badge tone={LEVEL_TONE[v]}>{t(`prem.lvl.${v}`)}</Badge> : <span className={cn("text-xs", required.has(k) ? "text-amber-700" : "text-slate-400")}>{t("prem.lvl.unknown")}</span>}
                </span>
              </div>
            );
          })}
        </div>
        {(d.physical.note || d.physical.reviewedAt) && (
          <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-700">
            {d.physical.reviewedAt && <span className="mr-2 text-slate-500">{t("prem.reviewedAt", { d: d.physical.reviewedAt })}</span>}
            {d.physical.note}
          </p>
        )}
        <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">{t("prem.requiredHint")}</p>
      </Card>

      <Card>
        <CardHeader
          title={t("prem.contents", { n: d.assets.length })}
          subtitle={t("prem.contentsSub")}
          action={
            write && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => onAddChild(d.id)} data-testid="loc-add-child">
                  <Plus size={15} /> {t("prem.addChild")}
                </Button>
                <Button variant="secondary" onClick={() => setMapsOpen(true)}>
                  {t("prem.setMaps")}
                </Button>
                <Button onClick={() => setPlacing(true)} data-testid="loc-place">
                  <Plus size={15} /> {t("prem.place")}
                </Button>
              </div>
            )
          }
        />
        <ErrorBox error={unplace.error} />
        {d.assets.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">{t("prem.noContents")}</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="loc-assets">
            {d.assets.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                {a.assetType === "facility" ? <MapPin size={14} className="text-slate-400" /> : <HealthIndicator status={a.healthStatus as HealthStatus} size={13} />}
                <Link to={recordPath("asset", a.id)} className="min-w-0 flex-1 truncate hover:underline">
                  {a.name}
                </Link>
                <span className="text-xs text-slate-500">
                  {a.assetType === "facility" ? (a.facilityKind ? t(`prem.kind.${a.facilityKind}`) : t.lbl(LABELS.assetType.facility)) : t.lbl(LABELS.assetType[a.assetType as keyof typeof LABELS.assetType])}
                  {a.viaRack ? ` · ${t("prem.viaRack", { name: a.viaRack })}` : ""}
                </span>
                <Badge tone={a.criticality === "critical" ? "red" : a.criticality === "high" ? "amber" : "slate"}>{t.lbl(LABELS.criticality[a.criticality as keyof typeof LABELS.criticality])}</Badge>
                {write && a.assetType !== "facility" && !a.viaRack && (
                  <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => unplace.mutate(a.id)} aria-label={t("prem.unplace", { name: a.name })}>
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {placing && <PlaceModal id={d.id} name={d.name} onClose={() => setPlacing(false)} onDone={(r) => (setPlacing(false), refresh(r))} />}
      {mapsOpen && <MapsModal d={d} onClose={() => setMapsOpen(false)} onDone={(r) => (setMapsOpen(false), refresh(r))} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function IssuesCard({ issues, nodes, write }: { issues: LocationIssueDto[]; nodes: LocationNodeDto[]; write: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["premises"] });
    qc.invalidateQueries({ queryKey: ["asset"] });
  };
  // rychlá náprava přímo z kontroly (v1.108): umístit, odebrat nesmyslnou vazbu
  const place = useMutation({ mutationFn: (x: { loc: string; asset: string }) => api.premises.place(x.loc, [x.asset]), onSuccess: done });
  const unlink = useMutation({ mutationFn: (x: { from: string; to: string }) => api.assets.removeDependency(x.from, x.to), onSuccess: done });
  return (
    <Card>
      <CardHeader title={t("prem.issues", { n: issues.length })} subtitle={t("prem.issuesSub")} />
      <ErrorBox error={place.error ?? unlink.error} />
      <ul className="divide-y divide-slate-100" data-testid="loc-issues">
        {issues.map((i, k) => (
          <li key={`${i.code}:${i.assetId}:${k}`} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
            <AlertTriangle size={14} className="text-amber-500" />
            <Link to={recordPath("asset", i.assetId)} className="font-medium hover:underline">
              {i.assetName}
            </Link>
            <span className="text-slate-600">{t(`prem.issue.${i.code}`)}</span>
            {i.related.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1">
                <Link to={recordPath("asset", r.id)} className="text-slate-500 hover:underline">
                  {r.name}
                </Link>
                {write && i.code === "located_in_non_container" && (
                  <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-700" onClick={() => unlink.mutate({ from: i.assetId, to: r.id })} aria-label={t("prem.unlink", { name: r.name })}>
                    <X size={13} />
                  </button>
                )}
              </span>
            ))}
            {write && (i.code === "critical_unplaced" || i.code === "multiple_locations") && nodes.length > 0 && (
              <Select
                className="ml-auto w-56"
                value=""
                onChange={(e) => e.target.value && place.mutate({ loc: e.target.value, asset: i.assetId })}
                aria-label={t("prem.placeQuick", { name: i.assetName })}
                data-testid="loc-issue-place"
              >
                <option value="">{i.code === "multiple_locations" ? t("prem.keepOne") : t("prem.placeQuickPh")}</option>
                {nodes
                  .filter((n) => i.code !== "multiple_locations" || i.related.some((r) => r.id === n.id))
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {"\u00a0\u00a0".repeat(n.depth)}
                      {n.name}
                    </option>
                  ))}
              </Select>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Převod textového pole „Umístění“ na lokality (v1.108). */
function TextLocationsCard({ nodes }: { nodes: LocationNodeDto[] }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["premises", "text"], queryFn: api.premises.textLocations });
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<Record<string, FacilityKind>>({});
  const run = useMutation({
    mutationFn: () => {
      const items = (q.data ?? [])
        .map((x) => ({ x, c: choice[x.text] ?? (x.matchId ? x.matchId : "new") }))
        .filter(({ c }) => c !== "skip")
        .map(({ x, c }) => ({ text: x.text, locationId: c === "new" ? null : c, kind: kind[x.text] ?? "room" }));
      return api.premises.importTextLocations({ items });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["premises"] });
      setChoice({});
    },
  });
  if (!q.data?.length) return null;
  return (
    <Card data-testid="loc-text">
      <CardHeader title={t("prem.text.title", { n: q.data.length })} subtitle={t("prem.text.sub")} />
      <ul className="divide-y divide-slate-100">
        {q.data.map((x) => {
          const c = choice[x.text] ?? (x.matchId ? x.matchId : "new");
          return (
            <li key={x.text} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-slate-900">{x.text}</span>
                <span className="ml-2 text-xs text-slate-500">{t("prem.text.assets", { n: x.assets })}</span>
                {c === "new" && <span className="ml-2 text-xs text-slate-500">→ {x.path.join(" › ")}</span>}
              </span>
              <Select className="w-60" value={c} onChange={(e) => setChoice({ ...choice, [x.text]: e.target.value })} aria-label={t("prem.text.target", { text: x.text })} data-testid="loc-text-target">
                <option value="new">{t("prem.text.create")}</option>
                <option value="skip">{t("prem.text.skip")}</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {"\u00a0\u00a0".repeat(n.depth)}
                    {n.name}
                  </option>
                ))}
              </Select>
              {c === "new" && (
                <Select className="w-44" value={kind[x.text] ?? "room"} onChange={(e) => setKind({ ...kind, [x.text]: e.target.value as FacilityKind })} aria-label={t("prem.f.kind")}>
                  {FACILITY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`prem.kind.${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-3">
        <Button onClick={() => run.mutate()} disabled={run.isPending} data-testid="loc-text-run">
          {t("prem.text.run")}
        </Button>
        {run.data && <span className="text-sm text-emerald-800">{t("prem.text.done", { created: run.data.created, placed: run.data.placed })}</span>}
        <ErrorBox error={run.error ?? q.error} />
      </div>
    </Card>
  );
}

function LocationModal({ node, parentId, nodes, onClose, onDone }: { node: LocationNodeDto | null; parentId: string | null; nodes: LocationNodeDto[]; onClose: () => void; onDone: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: node?.name ?? "",
    kind: (node?.kind ?? "building") as FacilityKind,
    parentId: parentId,
    criticality: (node?.criticality ?? "medium") as "low" | "medium" | "high" | "critical",
  });
  const [ph, setPh] = useState<FacilityPhysical>(() => {
    const p = FacilityPhysicalSchema.parse(node?.physical ?? {});
    // starší jednořádková adresa → ulice (k doplnění obce a PSČ)
    return p.address && !p.street && !p.city && !p.zip && !p.country ? { ...p, street: p.address } : p;
  });
  const ms = useQuery({ queryKey: ["premises", "mapSettings"], queryFn: api.premises.mapSettings });
  const geo = useMutation({
    mutationFn: () => api.premises.geocode(formatAddress({ ...ph, address: "" }) || ph.address),
    onSuccess: (r) => r.result && setPh((x) => ({ ...x, lat: r.result!.lat, lng: r.result!.lng })),
  });
  const pickPin = useMemo(() => (ph.lat != null && ph.lng != null ? [{ id: "pin", lat: ph.lat, lng: ph.lng, label: f.name || "•", selected: true }] : []), [ph.lat, ph.lng, f.name]);
  const coord = (v: string, max: number) => {
    const n = Number(v.replace(",", "."));
    return v.trim() === "" || !Number.isFinite(n) ? null : Math.max(-max, Math.min(max, n));
  };
  const setRev = (k: PhysicalControl, patch: Partial<PhysicalRevision>) => {
    const cur = ph.revisions?.[k] ?? { lastAt: null, intervalMonths: null };
    setPh({ ...ph, revisions: { ...(ph.revisions ?? {}), [k]: { ...cur, ...patch } } });
  };
  // lokalita nesmí být sama sobě nadřazená ani ležet ve své podřízené
  const blocked = new Set<string>();
  if (node) {
    blocked.add(node.id);
    for (const n of nodes) if (n.path.some((p) => p.id === node.id)) blocked.add(n.id);
  }
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, physical: ph };
      return node ? api.premises.update(node.id, body) : api.premises.create(body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["premises"] });
      qc.invalidateQueries({ queryKey: ["zones"] });
      onDone(r.id);
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={node ? t("prem.edit") : t("prem.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim()} data-testid="loc-save">
            {t("prem.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("prem.f.name")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="loc-name" />
        </Field>
        <Field label={t("prem.f.kind")}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as FacilityKind })} data-testid="loc-kind">
            {FACILITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`prem.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("prem.f.parent")}>
          <Select value={f.parentId ?? ""} onChange={(e) => setF({ ...f, parentId: e.target.value || null })} data-testid="loc-parent">
            <option value="">{t("prem.root")}</option>
            {nodes
              .filter((n) => !blocked.has(n.id))
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {"  ".repeat(n.depth)}
                  {n.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("prem.f.criticality")}>
          <Select value={f.criticality} onChange={(e) => setF({ ...f, criticality: e.target.value as typeof f.criticality })}>
            {(["low", "medium", "high", "critical"] as const).map((k) => (
              <option key={k} value={k}>
                {t.lbl(LABELS.criticality[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("prem.f.street")} className="sm:col-span-2">
          <Input value={ph.street} maxLength={200} onChange={(e) => setPh({ ...ph, street: e.target.value })} data-testid="loc-street" />
        </Field>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field label={t("prem.f.zip")}>
            <Input value={ph.zip} maxLength={20} onChange={(e) => setPh({ ...ph, zip: e.target.value })} data-testid="loc-zip" />
          </Field>
          <Field label={t("prem.f.city")}>
            <Input value={ph.city} maxLength={120} onChange={(e) => setPh({ ...ph, city: e.target.value })} data-testid="loc-city" />
          </Field>
        </div>
        <Field label={t("prem.f.country")}>
          <Input value={ph.country} maxLength={80} placeholder="Česko" onChange={(e) => setPh({ ...ph, country: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-[1fr_1fr_auto]">
          <Field label={t("prem.f.lat")}>
            <Input inputMode="decimal" value={ph.lat ?? ""} onChange={(e) => setPh({ ...ph, lat: coord(e.target.value, 90) })} data-testid="loc-lat" />
          </Field>
          <Field label={t("prem.f.lng")}>
            <Input inputMode="decimal" value={ph.lng ?? ""} onChange={(e) => setPh({ ...ph, lng: coord(e.target.value, 180) })} data-testid="loc-lng" />
          </Field>
          {ms.data?.geocode && (
            <div className="col-span-2 flex items-end sm:col-span-1">
              <Button variant="secondary" onClick={() => geo.mutate()} disabled={geo.isPending || !(ph.street || ph.city)} data-testid="loc-geocode">
                <MapPin size={15} /> {t("prem.map.geocode")}
              </Button>
            </div>
          )}
        </div>
        {geo.isSuccess && !geo.data.result && <p className="text-xs text-amber-700 sm:col-span-2">{t("prem.map.notFound")}</p>}
        {geo.error && (
          <div className="sm:col-span-2">
            <ErrorBox error={geo.error} />
          </div>
        )}
        {ms.data?.enabled && (
          <div className="sm:col-span-2">
            <LocationMap points={pickPin} attribution={ms.data.attribution} onPick={(lat, lng) => setPh((x) => ({ ...x, lat, lng }))} height={200} testId="loc-pick-map" />
            <p className="mt-1 text-xs text-slate-500">{t("prem.map.pickHint")}</p>
          </div>
        )}
      </div>
      <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <ShieldCheck size={15} className="text-slate-400" /> {t("prem.physical")}
      </h3>
      <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {PHYSICAL_CONTROLS.map((k) => (
          <div key={k}>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-slate-700">
              {t(`prem.ctl.${k}`)}
              {requiredPhysical(f.kind).includes(k) && <span className="text-slate-400"> *</span>}
            </span>
            <Select
              value={ph.controls[k] ?? ""}
              onChange={(e) => {
                const controls = { ...ph.controls };
                if (e.target.value) controls[k] = e.target.value as PhysicalLevel;
                else delete controls[k];
                setPh({ ...ph, controls });
              }}
              className="w-36"
              data-testid={`loc-ctl-${k}`}
            >
              <option value="">{t("prem.lvl.unknown")}</option>
              {PHYSICAL_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`prem.lvl.${l}`)}
                </option>
              ))}
            </Select>
          </label>
          {PHYSICAL_REVISION_MONTHS[k] && (ph.controls[k] === "yes" || ph.controls[k] === "partial") && (
            <div className="mt-1 flex items-center justify-end gap-2 text-xs text-slate-500">
              {t("prem.rev.lastLabel")}
              <Input
                type="date"
                className="h-7 w-36 text-xs"
                aria-label={`${t("prem.rev.lastLabel")} – ${t(`prem.ctl.${k}`)}`}
                value={ph.revisions?.[k]?.lastAt ?? ""}
                onChange={(e) => setRev(k, { lastAt: e.target.value || null })}
                data-testid={`loc-rev-last-${k}`}
              />
              <Input
                type="number"
                min={1}
                max={120}
                className="h-7 w-16 text-xs"
                aria-label={`${t("prem.rev.interval")} – ${t(`prem.ctl.${k}`)}`}
                placeholder={String(PHYSICAL_REVISION_MONTHS[k])}
                value={ph.revisions?.[k]?.intervalMonths ?? ""}
                onChange={(e) => setRev(k, { intervalMonths: e.target.value ? Math.min(120, Math.max(1, Number(e.target.value))) : null })}
              />
              {t("prem.rev.months")}
            </div>
          )}
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label={t("prem.f.reviewedAt")}>
          <Input type="date" value={ph.reviewedAt ?? ""} onChange={(e) => setPh({ ...ph, reviewedAt: e.target.value || null })} />
        </Field>
        <Field label={t("prem.f.note")}>
          <Textarea rows={2} value={ph.note} onChange={(e) => setPh({ ...ph, note: e.target.value })} />
        </Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function PlaceModal({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone: (r: LocationDetailDto) => void }) {
  const t = useT();
  const [picked, setPicked] = useState<PickedAsset[]>([]);
  const save = useMutation({ mutationFn: () => api.premises.place(id, picked.map((p) => p.id)), onSuccess: onDone });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("prem.placeTitle", { name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !picked.length} data-testid="loc-place-save">
            {t("prem.place")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("prem.placeHint")}</p>
      <AssetPicker value={picked} onChange={setPicked} />
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function MapsModal({ d, onClose, onDone }: { d: LocationDetailDto; onClose: () => void; onDone: (r: LocationDetailDto) => void }) {
  const t = useT();
  const maps = useQuery({ queryKey: ["maps"], queryFn: api.maps.list });
  const [chosen, setChosen] = useState<Set<string>>(new Set(d.maps.map((m) => m.id)));
  const save = useMutation({ mutationFn: () => api.premises.setMaps(d.id, [...chosen]), onSuccess: onDone });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("prem.setMaps")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {t("prem.save")}
          </Button>
        </>
      }
    >
      {!maps.data?.length ? (
        <p className="text-sm text-slate-500">{t("prem.noMaps")}</p>
      ) : (
        <ul className="space-y-1">
          {maps.data.map((m) => (
            <li key={m.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.has(m.id)}
                  onChange={(e) => {
                    const n = new Set(chosen);
                    if (e.target.checked) n.add(m.id);
                    else n.delete(m.id);
                    setChosen(n);
                  }}
                />
                {m.name}
                <span className="text-xs text-slate-500">{[m.site, m.building, m.floor].filter(Boolean).join(" › ")}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={save.error} />
    </Modal>
  );
}



/** Nastavení mapy (správa systému, v1.114). */
function MapSettingsModal({ value, onClose }: { value: MapSettings; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState(value);
  const save = useMutation({
    mutationFn: () => api.premises.saveMapSettings(f),
    onSuccess: (d) => {
      qc.setQueryData(["premises", "mapSettings"], d);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("prem.map.settings")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="map-settings-save">
            {t("prem.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-500">{t("prem.map.settingsSub")}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} data-testid="map-enabled" /> {t("prem.map.enabled")}
        </label>
        <Field label={t("prem.map.tileUrl")}>
          <Input value={f.tileUrl} onChange={(e) => setF({ ...f, tileUrl: e.target.value })} />
        </Field>
        <Field label={t("prem.map.attribution")}>
          <Input value={f.attribution} onChange={(e) => setF({ ...f, attribution: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.geocode} onChange={(e) => setF({ ...f, geocode: e.target.checked })} /> {t("prem.map.geocodeEnabled")}
        </label>
        <Field label={t("prem.map.geocodeUrl")}>
          <Input value={f.geocodeUrl} onChange={(e) => setF({ ...f, geocodeUrl: e.target.value })} />
        </Field>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
