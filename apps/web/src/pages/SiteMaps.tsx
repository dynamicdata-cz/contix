import { AssetPicker, type PickedAsset } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, type Tone } from "@/components/ui";
import { askConfirm, toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useUrlParam } from "@/lib/urlState";
import { cn } from "@/lib/utils";
import { LABELS, MAP_FILE_EXTENSIONS, MARKER_STATUSES, SITE_MAP_LABELS, type MapPlacementDto, type MarkerStatus, type SiteMapDetailDto, type SiteMapDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Map as MapIcon, Maximize2, Minus, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";

/* Mapy a půdorysy (v1.25, ADR-122): podklad (PDF / DWG / DXF / obrázek) + aktiva s barvou podle stavu. */

export const markerColor: Record<MarkerStatus, string> = { red: "bg-red-600", orange: "bg-amber-500", green: "bg-emerald-600", unknown: "bg-slate-400" };
export const markerTone: Record<MarkerStatus, Tone> = { red: "red", orange: "amber", green: "green", unknown: "slate" };

export function SiteMapsPage() {
  const t = useT();
  const can = useCan();
  const [mapId, setMapId] = useUrlParam("map");
  const [focus] = useUrlParam("asset");
  const [upload, setUpload] = useState(false);
  const list = useQuery({ queryKey: ["site-maps"], queryFn: api.maps.list, refetchInterval: 60_000 });
  const maps = list.data ?? [];
  const current = maps.find((m) => m.id === mapId) ?? maps[0];

  /** Areál → budova → podlaží: seznam vlevo. */
  const groups = useMemo(() => {
    const g = new Map<string, SiteMapDto[]>();
    for (const m of maps) {
      const k = [m.site, m.building].filter(Boolean).join(" · ") || t("map.noBuilding");
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g.entries()];
  }, [maps, t]);

  return (
    <>
      <PageHeader
        title={t("map.title")}
        subtitle={t("map.subtitle")}
        actions={
          can("assets:write") && (
            <Button onClick={() => setUpload(true)}>
              <Upload size={16} /> {t("map.upload")}
            </Button>
          )
        }
      />
      <ErrorBox error={list.error} />
      {list.data && !maps.length && <EmptyState>{t("map.empty")}</EmptyState>}
      {current && (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <Card className="self-start">
            <div className="divide-y divide-slate-100">
              {groups.map(([g, ms]) => (
                <div key={g} className="px-3 py-2">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</div>
                  {ms.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMapId(m.id)}
                      className={cn("flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50", m.id === current.id && "bg-brand-50 font-medium text-brand-800")}
                    >
                      <span className="truncate">{m.floor ? `${m.floor} – ${m.name}` : m.name}</span>
                      <span className="flex shrink-0 gap-1">
                        {(["red", "orange"] as const).map((s) =>
                          m.counts[s] ? (
                            <span key={s} className={cn("rounded-full px-1.5 text-[11px] font-semibold text-white", markerColor[s])}>
                              {m.counts[s]}
                            </span>
                          ) : null,
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Card>
          <MapView key={current.id} id={current.id} focus={focus} />
        </div>
      )}
      <MapFormModal open={upload} onClose={() => setUpload(false)} onSaved={(m) => setMapId(m.id)} />
    </>
  );
}

function MapFormModal({ open, onClose, onSaved, edit }: { open: boolean; onClose: () => void; onSaved: (m: SiteMapDetailDto) => void; edit?: SiteMapDetailDto }) {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ name: "", site: "", building: "", floor: "" });
  useEffect(() => {
    if (open) {
      setFile(null);
      setF({ name: edit?.name ?? "", site: edit?.site ?? "", building: edit?.building ?? "", floor: edit?.floor ?? "" });
    }
  }, [open, edit]);
  const m = useMutation({
    mutationFn: () => (edit ? api.maps.update(edit.id, { name: f.name, site: f.site || null, building: f.building || null, floor: f.floor || null }) : api.maps.upload(file!, f)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["site-maps"] });
      qc.invalidateQueries({ queryKey: ["site-map", r.id] });
      toast(t("map.saved"));
      onSaved(r);
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? t("map.edit") : t("map.upload")}
      footer={
        <Button disabled={!f.name.trim() || (!edit && !file) || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? t("map.uploading") : t("map.save")}
        </Button>
      }
    >
      <div className="space-y-3">
        <ErrorBox error={m.error} />
        {!edit && (
          <Field label={t("map.file")} hint={t("map.fileHint")}>
            <Input type="file" accept={MAP_FILE_EXTENSIONS.map((e) => `.${e}`).join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        )}
        <Field label={t("map.name")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("map.namePh")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("map.site")}>
            <Input value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} />
          </Field>
          <Field label={t("map.building")}>
            <Input value={f.building} onChange={(e) => setF({ ...f, building: e.target.value })} />
          </Field>
          <Field label={t("map.floor")}>
            <Input value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function MapView({ id, focus }: { id: string; focus: string }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [, setMapId] = useUrlParam("map");
  const q = useQuery({ queryKey: ["site-map", id], queryFn: () => api.maps.get(id), refetchInterval: 60_000 });
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState(false);
  const [meta, setMeta] = useState(false);
  const [picked, setPicked] = useState<PickedAsset[]>([]);
  const [sel, setSel] = useState<string | null>(focus || null);
  const [shown, setShown] = useState<Set<MarkerStatus>>(new Set(MARKER_STATUSES));
  const [drag, setDrag] = useState<{ assetId: string; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const writable = can("assets:write");

  const setData = (d: SiteMapDetailDto) => {
    qc.setQueryData(["site-map", id], d);
    qc.invalidateQueries({ queryKey: ["site-maps"] });
  };
  const place = useMutation({ mutationFn: (p: { assetId: string; x: number; y: number }) => api.maps.place(id, p.assetId, p.x, p.y), onSuccess: setData });
  const unplace = useMutation({ mutationFn: (assetId: string) => api.maps.unplace(id, assetId), onSuccess: (d) => (setData(d), setSel(null)) });
  const remove = useMutation({
    mutationFn: () => api.maps.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site-maps"] });
      setMapId("");
      toast(t("map.deleted"));
    },
  });

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  if (!q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  const selected = d.placements.find((p) => p.assetId === sel);
  const visible = d.placements.filter((p) => shown.has(p.status));

  const onBackground = (e: React.MouseEvent) => {
    if (editing && picked[0]) {
      place.mutate({ assetId: picked[0].id, ...pos(e) });
      setPicked([]);
    } else setSel(null);
  };
  const startDrag = (p: MapPlacementDto) => (e: RPointerEvent) => {
    if (!editing) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ assetId: p.assetId, x: p.x, y: p.y });
  };
  const moveDrag = (e: RPointerEvent) => drag && setDrag({ ...drag, ...pos(e) });
  const endDrag = () => {
    if (!drag) return;
    const p = d.placements.find((x) => x.assetId === drag.assetId);
    if (p && (Math.abs(p.x - drag.x) > 0.002 || Math.abs(p.y - drag.y) > 0.002)) place.mutate(drag);
    setDrag(null);
  };

  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <CardHeader
          title={d.name}
          subtitle={[d.site, d.building, d.floor].filter(Boolean).join(" · ") || undefined}
          action={
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" className="px-2" title={t("map.zoomOut")} onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
                <Minus size={16} />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)} %</span>
              <Button variant="ghost" className="px-2" title={t("map.zoomIn")} onClick={() => setZoom((z) => Math.min(8, z * 1.5))}>
                <Plus size={16} />
              </Button>
              <Button variant="ghost" className="px-2" title={t("map.fit")} onClick={() => setZoom(1)}>
                <Maximize2 size={16} />
              </Button>
              <a href={api.maps.originalUrl(d.id)} title={t("map.original")}>
                <Button variant="ghost" className="px-2">
                  <Download size={16} />
                </Button>
              </a>
              {writable && (
                <>
                  <Button variant="ghost" className="px-2" title={t("map.edit")} onClick={() => setMeta(true)}>
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 text-red-600"
                    title={t("map.delete")}
                    onClick={async () => (await askConfirm(t("map.deleteConfirm", { name: d.name }), { danger: true })) && remove.mutate()}
                  >
                    <Trash2 size={16} />
                  </Button>
                  <Button variant={editing ? "primary" : "secondary"} onClick={() => (setEditing(!editing), setPicked([]))}>
                    <MapIcon size={16} /> {editing ? t("map.done") : t("map.place")}
                  </Button>
                </>
              )}
            </div>
          }
        />
        {editing && (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-brand-50/50 px-5 py-3 text-sm">
            <div className="min-w-64 flex-1">
              <AssetPicker value={picked} onChange={(v) => setPicked(v.slice(-1))} />
            </div>
            <span className="text-slate-600">{picked[0] ? t("map.clickToPlace", { name: picked[0].name }) : t("map.editHint")}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2 px-5 py-3 text-xs">
          {MARKER_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setShown((x) => (x.has(s) && x.size > 1 ? new Set([...x].filter((y) => y !== s)) : new Set([...x, s])))}
              className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1", shown.has(s) ? "border-slate-300" : "border-transparent opacity-40")}
            >
              <span className={cn("h-2.5 w-2.5 rounded-full", markerColor[s])} />
              {t.lbl(SITE_MAP_LABELS.status[s])} <b className="tabular-nums">{d.counts[s]}</b>
            </button>
          ))}
        </div>
        <div className="max-h-[75vh] overflow-auto border-t border-slate-100 bg-slate-50" data-testid="map-viewport">
          <div ref={box} className={cn("relative select-none", editing && picked[0] && "cursor-crosshair")} style={{ width: `${zoom * 100}%` }} onClick={onBackground} onPointerMove={moveDrag} onPointerUp={endDrag}>
            <img src={api.maps.imageUrl(d.id, d.createdAt)} alt={d.name} draggable={false} className="block w-full bg-white" />
            {visible.map((p) => {
              const at = drag?.assetId === p.assetId ? drag : p;
              return (
                <button
                  key={p.assetId}
                  data-testid={`marker-${p.status}`}
                  title={p.name}
                  aria-label={`${p.name}: ${t.lbl(SITE_MAP_LABELS.status[p.status])}`}
                  onClick={(e) => (e.stopPropagation(), setSel(p.assetId))}
                  onPointerDown={startDrag(p)}
                  className={cn(
                    "absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/20",
                    markerColor[p.status],
                    p.status === "red" && "animate-pulse",
                    sel === p.assetId && "h-5 w-5 ring-2 ring-brand-600",
                    editing && "cursor-move",
                  )}
                  style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
                />
              );
            })}
          </div>
        </div>
      </Card>
      {selected && (
        <Card>
          <div className="flex items-start justify-between gap-3 px-5 py-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Link to="/assets/$assetId" params={{ assetId: selected.assetId }} className="font-medium text-brand-700 hover:underline">
                  {selected.name}
                </Link>
                <span className="text-slate-500">{t.lbl(LABELS.assetType[selected.assetType as keyof typeof LABELS.assetType] ?? selected.assetType)}</span>
                <Badge tone={markerTone[selected.status]}>{t.lbl(SITE_MAP_LABELS.status[selected.status])}</Badge>
              </div>
              {selected.reasons.length ? (
                <ul className="list-disc pl-5 text-slate-600">
                  {selected.reasons.map((r) => (
                    <li key={r.key}>
                      {t.lbl(SITE_MAP_LABELS.reason[r.key])}
                      {r.n > 1 && ` (${r.n})`}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-slate-500">{t("map.noIssues")}</div>
              )}
            </div>
            <div className="flex gap-1">
              {editing && (
                <Button variant="ghost" className="px-2 text-red-600" onClick={() => unplace.mutate(selected.assetId)}>
                  <Trash2 size={14} /> {t("map.unplace")}
                </Button>
              )}
              <Button variant="ghost" className="px-2" onClick={() => setSel(null)}>
                <X size={14} />
              </Button>
            </div>
          </div>
        </Card>
      )}
      {!d.placements.length && <EmptyState>{writable ? t("map.noPlacementsEdit") : t("map.noPlacements")}</EmptyState>}
      <MapFormModal open={meta} onClose={() => setMeta(false)} onSaved={() => {}} edit={d} />
    </div>
  );
}

/** Karta v detailu aktiva: na kterých mapách je umístěné. */
export function AssetMapsCard({ assetId }: { assetId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["site-maps", "asset", assetId], queryFn: () => api.maps.byAsset(assetId) });
  if (!q.data?.length) return null;
  return (
    <Card>
      <CardHeader title={t("map.onMaps")} />
      <ul className="space-y-1 px-5 py-4 text-sm">
        {q.data.map((m) => (
          <li key={m.id}>
            <Link to="/assets/maps" search={{ map: m.id, asset: assetId } as never} className="text-brand-700 hover:underline">
              {[m.building, m.floor, m.name].filter(Boolean).join(" · ")}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
