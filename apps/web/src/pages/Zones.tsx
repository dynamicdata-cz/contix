import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ZONE_KIND_LABELS, ZONE_KINDS, ZONE_TRUST_LABELS, ZONE_TRUST_LEVELS, type SecurityZoneDto, type SecurityZoneInput, type ZoneKind, type ZoneMapDto, type ZoneSuggestionDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Layers, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

/* ============================================================
 * Bezpečnostní zóny (v1.97, ADR-191): katalog zón, vrstvená mapa aktiv po zónách (od nedůvěryhodné po kritickou)
 * s vazbami přes hranice zón, ruční zóna aktiva.
 * ============================================================ */

const FLOW_COLOR = { high: "#dc2626", warn: "#d97706", ok: "#94a3b8", controlled: "#16a34a" } as const;
/** Barva vazby: řízený přechod (firewall …) je zelený bez ohledu na hodnocení hranice (v1.101). */
const flowKey = (f: ZoneMapDto["flows"][number]) => (f.control && f.level !== "ok" ? "controlled" : f.level);
const HEALTH_COLOR: Record<string, string> = { green: "#16a34a", orange: "#ea580c", red: "#dc2626", yellow: "#ca8a04", unknown: "#94a3b8" };

export function ZonesPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const map = useQuery({ queryKey: ["zones", "map"], queryFn: api.zones.map });
  const [edit, setEdit] = useState<SecurityZoneDto | "new" | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const write = can("assets:write");
  const done = (r: { moved: number }) => {
    qc.invalidateQueries({ queryKey: ["zones"] });
    qc.invalidateQueries({ queryKey: ["findings"] });
    setMsg(t("zn.moved", { n: r.moved }));
  };
  const defaults = useMutation({ mutationFn: api.zones.defaults, onSuccess: done });
  const assign = useMutation({ mutationFn: api.zones.assign, onSuccess: done });
  const remove = useMutation({ mutationFn: (id: string) => api.zones.remove(id), onSuccess: done });
  const d = map.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <Layers size={22} className="text-slate-400" /> {t("zn.title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("zn.sub")}</p>
        </div>
        {write && d && d.zones.length > 0 && (
          <>
            <Button variant="secondary" onClick={() => setSuggest(true)} data-testid="zn-suggest">
              <Wand2 size={15} /> {t("zn.sg.open")}
            </Button>
            <Button variant="secondary" onClick={() => assign.mutate()} disabled={assign.isPending} data-testid="zn-assign">
              <RefreshCw size={15} /> {t("zn.assign")}
            </Button>
            <Button onClick={() => setEdit("new")} data-testid="zn-new">
              <Plus size={15} /> {t("zn.new")}
            </Button>
          </>
        )}
      </div>
      <ErrorBox error={map.error ?? defaults.error ?? assign.error ?? remove.error} />
      {msg && <SuccessBox>{msg}</SuccessBox>}
      {d && !d.zones.length && (
        <Card className="p-6" data-testid="zn-empty">
          <p className="text-sm text-slate-700">{t("zn.empty")}</p>
          {write && (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => defaults.mutate()} disabled={defaults.isPending} data-testid="zn-defaults">
                {t("zn.defaults")}
              </Button>
              <Button variant="secondary" onClick={() => setEdit("new")}>
                {t("zn.new")}
              </Button>
            </div>
          )}
        </Card>
      )}
      {d && d.zones.length > 0 && (
        <>
          {d.unassigned > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("zn.unassigned", { n: d.unassigned })}</p>}
          <LayeredMap d={d} />
          <FlowsCard d={d} write={write} />
          <Card>
            <CardHeader title={t("zn.catalog")} subtitle={t("zn.catalogSub")} />
            <div className="divide-y divide-slate-100" data-testid="zn-list">
              {d.zones.map((z) => (
                <div key={z.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: z.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{z.name}</span>
                      <Badge tone="slate">{t.lbl(ZONE_KIND_LABELS[z.kind])}</Badge>
                      <span className="text-xs text-slate-500">
                        {t("zn.trust")}: {z.trust} – {t.lbl(ZONE_TRUST_LABELS[z.trust])}
                      </span>
                    </div>
                    {z.description && <p className="text-xs text-slate-600">{z.description}</p>}
                    <p className="mt-0.5 text-xs text-slate-500">
                      {z.cidrs.length ? z.cidrs.join(", ") : t("zn.noCidrs")} · {t("zn.counts", { n: z.assets, mon: z.monitored })}
                      {z.openFindings ? ` · ${t("zn.findings", { n: z.openFindings })}` : ""}
                    </p>
                  </div>
                  {write && (
                    <div className="flex gap-1">
                      <Button variant="secondary" className="px-2 py-1" onClick={() => setEdit(z)} aria-label={t("zn.edit")}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="secondary" className="px-2 py-1" onClick={() => window.confirm(t("zn.deleteConfirm", { name: z.name })) && remove.mutate(z.id)} aria-label={t("zn.delete")}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {write && (
              <div className="border-t border-slate-100 px-5 py-3">
                <Button variant="secondary" onClick={() => defaults.mutate()} disabled={defaults.isPending} className="text-xs">
                  {t("zn.addMissingDefaults")}
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
      {suggest && d && <SuggestModal zones={d.zones} onClose={() => setSuggest(false)} onDone={(r) => (setSuggest(false), done(r))} />}
      {edit && <ZoneModal zone={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={done} />}
    </div>
  );
}

/* ---------- vrstvená mapa ---------- */

const W = 1120;
const LABEL = 230;
const CHIP_W = 158;
const CHIP_H = 26;
const GAP = 8;
const MAX_CHIPS = 60;

function LayeredMap({ d }: { d: ZoneMapDto }) {
  const t = useT();
  const nav = useNavigate();
  const [onlyRisky, setOnlyRisky] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const cols = Math.max(1, Math.floor((W - LABEL - 24 + GAP) / (CHIP_W + GAP)));
  const lay = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const bands: { z: SecurityZoneDto; y: number; h: number; more: number }[] = [];
    let y = 0;
    // pásy od nedůvěryhodné zóny nahoře po kritickou dole; „bez zóny“ na konci
    const order = [...d.zones].sort((a, b) => a.trust - b.trust || a.sortOrder - b.sortOrder);
    for (const z of order) {
      const list = d.assets.filter((a) => a.zoneId === z.id);
      const shown = list.slice(0, MAX_CHIPS);
      const rows = Math.max(1, Math.ceil(shown.length / cols));
      const h = rows * (CHIP_H + GAP) + 28;
      shown.forEach((a, i) => pos.set(a.id, { x: LABEL + 12 + (i % cols) * (CHIP_W + GAP), y: y + 16 + Math.floor(i / cols) * (CHIP_H + GAP) }));
      bands.push({ z, y, h, more: list.length - shown.length });
      y += h + 6;
    }
    return { pos, bands, height: y };
  }, [d, cols]);
  const flows = d.flows.filter((f) => (!onlyRisky || f.level !== "ok") && lay.pos.has(f.fromId) && lay.pos.has(f.toId));
  const risky = d.flows.filter((f) => f.level !== "ok").length;
  const name = new Map(d.assets.map((a) => [a.id, a.name]));
  return (
    <Card className="overflow-hidden" data-testid="zn-map">
      <CardHeader
        title={t("zn.mapTitle")}
        subtitle={t("zn.mapSub", { flows: d.flows.length, risky })}
        action={
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={onlyRisky} onChange={(e) => setOnlyRisky(e.target.checked)} />
            {t("zn.onlyRisky")}
          </label>
        }
      />
      <div className="overflow-x-auto p-3">
        <svg width={W} height={lay.height} viewBox={`0 0 ${W} ${lay.height}`} className="block" role="img" aria-label={t("zn.mapTitle")}>
          <defs>
            {(["high", "warn", "ok", "controlled"] as const).map((l) => (
              <marker key={l} id={`zn-arrow-${l}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={FLOW_COLOR[l]} />
              </marker>
            ))}
          </defs>
          {lay.bands.map(({ z, y, h, more }) => (
            <g key={z.id} data-testid={`zn-band-${z.kind}`}>
              <rect x={0} y={y} width={W} height={h} rx={10} fill={z.color} fillOpacity={0.07} stroke={z.color} strokeOpacity={0.35} />
              <rect x={0} y={y} width={6} height={h} rx={3} fill={z.color} />
              <text x={16} y={y + 22} className="fill-slate-900 text-[13px] font-semibold">
                {z.name}
              </text>
              <text x={16} y={y + 40} className="fill-slate-500 text-[11px]">
                {t("zn.trustShort", { n: z.trust })} · {t.lbl(ZONE_TRUST_LABELS[z.trust])}
              </text>
              <text x={16} y={y + 56} className={cn("text-[11px]", z.assets && z.monitored < z.assets ? "fill-amber-700" : "fill-slate-500")}>
                {t("zn.counts", { n: z.assets, mon: z.monitored })}
              </text>
              {more > 0 && (
                <text x={W - 16} y={y + h - 8} textAnchor="end" className="fill-slate-500 text-[11px]">
                  {t("zn.more", { n: more })}
                </text>
              )}
              {!z.assets && (
                <text x={LABEL + 12} y={y + 34} className="fill-slate-400 text-[12px]">
                  {z.cidrs.length ? t("zn.noAssets") : t("zn.noCidrsShort")}
                </text>
              )}
            </g>
          ))}
          {flows.map((f, i) => {
            const a = lay.pos.get(f.fromId)!;
            const b = lay.pos.get(f.toId)!;
            const x1 = a.x + CHIP_W / 2;
            const y1 = a.y + (b.y > a.y ? CHIP_H : 0);
            const x2 = b.x + CHIP_W / 2;
            const y2 = b.y + (b.y > a.y ? 0 : CHIP_H);
            const lit = hover === f.fromId || hover === f.toId;
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`}
                fill="none"
                stroke={FLOW_COLOR[flowKey(f)]}
                strokeWidth={lit ? 2.5 : f.level === "high" ? 1.8 : 1.2}
                strokeOpacity={hover && !lit ? 0.15 : 0.85}
                strokeDasharray={f.level === "ok" ? "4 4" : undefined}
                markerEnd={`url(#zn-arrow-${flowKey(f)})`}
              >
                <title>
                  {name.get(f.fromId)} → {name.get(f.toId)} · {t(`zn.flow.${flowKey(f)}`)}
                  {f.control ? ` (${f.control.viaName ?? f.control.note})` : ""}
                </title>
              </path>
            );
          })}
          {d.assets.map((a) => {
            const p = lay.pos.get(a.id);
            if (!p) return null;
            return (
              <g
                key={a.id}
                transform={`translate(${p.x},${p.y})`}
                className="cursor-pointer"
                role="link"
                tabIndex={0}
                onMouseEnter={() => setHover(a.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => nav({ to: "/assets/$assetId", params: { assetId: a.id } })}
                onKeyDown={(e) => e.key === "Enter" && nav({ to: "/assets/$assetId", params: { assetId: a.id } })}
                data-testid="zn-chip"
              >
                <rect width={CHIP_W} height={CHIP_H} rx={6} fill="var(--color-white)" stroke={HEALTH_COLOR[a.health] ?? HEALTH_COLOR.unknown} strokeWidth={1.5} />
                <circle cx={11} cy={CHIP_H / 2} r={4} fill={a.monitored ? "#16a34a" : "var(--color-slate-200)"} stroke={a.monitored ? "none" : "var(--color-slate-400)"}>
                  <title>{a.monitored ? t("zn.monitored") : t("zn.notMonitored")}</title>
                </circle>
                <text x={21} y={CHIP_H / 2 + 4} className="fill-slate-800 text-[11px]">
                  {a.name.length > 20 ? `${a.name.slice(0, 19)}…` : a.name}
                </text>
                {a.internetFacing && (
                  <text x={CHIP_W - 8} y={CHIP_H / 2 + 4} textAnchor="end" className="fill-red-600 text-[10px] font-semibold">
                    ⇡
                  </text>
                )}
                <title>
                  {a.name}
                  {a.manual ? ` · ${t("zn.manual")}` : ""}
                </title>
              </g>
            );
          })}
        </svg>
        <div className="mt-2 flex flex-wrap gap-4 px-1 text-xs text-slate-600">
          <span>
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-green-600 align-middle" /> {t("zn.monitored")}
          </span>
          <span>
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-slate-400 bg-slate-200 align-middle" /> {t("zn.notMonitored")}
          </span>
          <span className="text-red-600">⇡ {t("zn.internetFacing")}</span>
          {(["high", "warn", "controlled", "ok"] as const).map((l) => (
            <span key={l}>
              <span className="mr-1 inline-block h-0.5 w-5 align-middle" style={{ background: FLOW_COLOR[l] }} /> {t(`zn.flow.${l}`)}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---------- vazby přes hranice zón a řízené přechody (v1.101) ---------- */

function FlowsCard({ d, write }: { d: ZoneMapDto; write: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const risky = d.flows.filter((f) => f.level !== "ok").sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
  const [open, setOpen] = useState<ZoneMapDto["flows"][number] | null>(null);
  const name = new Map(d.assets.map((a) => [a.id, a.name]));
  const zname = new Map(d.zones.map((z) => [z.id, z.name]));
  const clear = useMutation({
    mutationFn: (f: ZoneMapDto["flows"][number]) => api.zones.clearFlow(f.fromId, f.toId),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["zones"] }), qc.invalidateQueries({ queryKey: ["findings"] })),
  });
  if (!risky.length) return null;
  return (
    <Card className="overflow-hidden" data-testid="zn-flows">
      <CardHeader title={t("zn.fl.title")} subtitle={t("zn.fl.sub")} />
      <ErrorBox error={clear.error} />
      <ul className="divide-y divide-slate-100">
        {risky.map((f) => (
          <li key={`${f.fromId}:${f.toId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm" data-testid="zn-flow">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: FLOW_COLOR[flowKey(f)] }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-slate-900">{name.get(f.fromId)}</span> <span className="text-slate-500">({zname.get(f.fromZone)})</span> →{" "}
              <span className="font-medium text-slate-900">{name.get(f.toId)}</span> <span className="text-slate-500">({zname.get(f.toZone)})</span>
            </span>
            {f.control ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700" data-testid="zn-flow-control">
                <ShieldCheck size={14} /> {f.control.viaName ? t("zn.fl.via", { name: f.control.viaName }) : t("zn.fl.controlled")}
                {f.control.note ? ` – ${f.control.note}` : ""}
              </span>
            ) : (
              <Badge tone={f.level === "high" ? "red" : "amber"}>{t(`zn.flow.${f.level}`)}</Badge>
            )}
            {write &&
              (f.control ? (
                <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => clear.mutate(f)} disabled={clear.isPending}>
                  {t("zn.fl.clear")}
                </Button>
              ) : (
                <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setOpen(f)} data-testid="zn-flow-set">
                  {t("zn.fl.set")}
                </Button>
              ))}
          </li>
        ))}
      </ul>
      {open && <FlowControlModal d={d} flow={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function FlowControlModal({ d, flow, onClose }: { d: ZoneMapDto; flow: ZoneMapDto["flows"][number]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const devices = d.assets.filter((a) => a.assetType === "security_device" || a.assetType === "network_device" || a.assetType === "server" || a.assetType === "virtual_machine");
  devices.sort((a, b) => (a.assetType === "security_device" ? -1 : 0) - (b.assetType === "security_device" ? -1 : 0) || a.name.localeCompare(b.name));
  const [via, setVia] = useState(devices.find((a) => a.assetType === "security_device")?.id ?? "");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api.zones.setFlow({ fromId: flow.fromId, toId: flow.toId, viaAssetId: via || null, note }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["zones"] }), qc.invalidateQueries({ queryKey: ["findings"] }), onClose()),
  });
  return (
    <Modal
      open
      title={t("zn.fl.modal")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!via && !note.trim())} data-testid="zn-flow-save">
            {t("zn.save")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("zn.fl.modalHint")}</p>
      <Field label={t("zn.fl.device")}>
        <Select value={via} onChange={(e) => setVia(e.target.value)} data-testid="zn-flow-via">
          <option value="">{t("zn.fl.noDevice")}</option>
          {devices.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("zn.fl.note")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("zn.fl.notePh")} data-testid="zn-flow-note" />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/* ---------- návrh rozsahů (v1.101) ---------- */

function SuggestModal({ zones, onClose, onDone }: { zones: SecurityZoneDto[]; onClose: () => void; onDone: (r: { moved: number }) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["zones", "suggestions"], queryFn: api.zones.suggestions });
  const [pick, setPick] = useState<Record<string, string>>({});
  const [on, setOn] = useState<Record<string, boolean>>({});
  const zoneFor = (s: ZoneSuggestionDto) => pick[s.cidr] ?? s.suggestedZoneId ?? "";
  const chosen = (q.data ?? []).filter((s) => (on[s.cidr] ?? !!s.suggestedZoneId) && zoneFor(s));
  const apply = useMutation({ mutationFn: () => api.zones.applySuggestions(chosen.map((s) => ({ cidr: s.cidr, zoneId: zoneFor(s) }))), onSuccess: onDone });
  return (
    <Modal
      open
      wide
      title={t("zn.sg.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending || !chosen.length} data-testid="zn-sg-apply">
            {t("zn.sg.apply", { n: chosen.length })}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("zn.sg.hint")}</p>
      <ErrorBox error={q.error ?? apply.error} />
      {q.data && !q.data.length && <p className="text-sm text-slate-600" data-testid="zn-sg-empty">{t("zn.sg.empty")}</p>}
      <ul className="divide-y divide-slate-100">
        {(q.data ?? []).map((s) => (
          <li key={s.cidr} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid="zn-sg-item">
            <input type="checkbox" checked={on[s.cidr] ?? !!s.suggestedZoneId} onChange={(e) => setOn({ ...on, [s.cidr]: e.target.checked })} aria-label={s.cidr} />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-slate-900">{s.cidr}</div>
              <div className="text-xs text-slate-500">
                {s.source.kind === "segment" ? t("zn.sg.segment", { name: s.source.name }) : t("zn.sg.fromAssets")} · {t("zn.sg.assets", { n: s.assets })}
                {s.sample.length ? `: ${s.sample.join(", ")}` : ""}
              </div>
            </div>
            <Select className="w-48" value={zoneFor(s)} onChange={(e) => setPick({ ...pick, [s.cidr]: e.target.value })} aria-label={t("zn.sg.zone")} data-testid="zn-sg-zone">
              <option value="">{t("zn.sg.pickZone")}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                  {z.kind === s.suggestedKind ? ` ★` : ""}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ---------- úprava zóny ---------- */

function ZoneModal({ zone, onClose, onDone }: { zone: SecurityZoneDto | null; onClose: () => void; onDone: (r: { moved: number }) => void }) {
  const t = useT();
  const [f, setF] = useState<SecurityZoneInput & { cidrText: string }>({
    name: zone?.name ?? "",
    kind: zone?.kind ?? "custom",
    trust: zone?.trust ?? 2,
    color: zone?.color ?? "#64748b",
    description: zone?.description ?? "",
    sortOrder: zone?.sortOrder ?? 100,
    cidrText: (zone?.cidrs ?? []).join("\n"),
  });
  const save = useMutation({
    mutationFn: () => {
      const { cidrText, ...rest } = f;
      const body = { ...rest, cidrs: cidrText.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) };
      return zone ? api.zones.update(zone.id, body) : api.zones.create(body);
    },
    onSuccess: (r) => {
      onDone(r);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={zone ? t("zn.edit") : t("zn.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim()} data-testid="zn-save">
            {t("zn.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("zn.f.name")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="zn-name" />
        </Field>
        <Field label={t("zn.f.kind")}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ZoneKind })}>
            {ZONE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(ZONE_KIND_LABELS[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("zn.f.trust")} hint={t("zn.f.trustHint")}>
          <Select value={String(f.trust)} onChange={(e) => setF({ ...f, trust: Number(e.target.value) })}>
            {ZONE_TRUST_LEVELS.map((n) => (
              <option key={n} value={n}>
                {n} – {t.lbl(ZONE_TRUST_LABELS[n])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("zn.f.color")}>
          <Input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 w-20 p-1" />
        </Field>
        <Field label={t("zn.f.cidrs")} hint={t("zn.f.cidrsHint")} className="sm:col-span-2">
          <Textarea rows={4} value={f.cidrText} onChange={(e) => setF({ ...f, cidrText: e.target.value })} placeholder={"10.10.0.0/24\n10.10.1.0/24"} data-testid="zn-cidrs" />
        </Field>
        <Field label={t("zn.f.description")} className="sm:col-span-2">
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/* ---------- zóna v detailu aktiva ---------- */

export function AssetZoneSelect({ assetId, zoneId, manual }: { assetId: string; zoneId: string | null; manual: boolean }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const zones = useQuery({ queryKey: ["zones", "list"], queryFn: api.zones.list });
  const set = useMutation({
    mutationFn: (v: string | null) => api.zones.setAssetZone(assetId, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset", assetId] });
      qc.invalidateQueries({ queryKey: ["zones"] });
    },
  });
  if (!zones.data?.length) return <span className="text-slate-400">{t("zn.none")}</span>;
  const cur = zones.data.find((z) => z.id === zoneId);
  if (!can("assets:write"))
    return cur ? (
      <span>
        {cur.name} <span className="text-xs text-slate-500">{manual ? t("zn.manual") : t("zn.auto")}</span>
      </span>
    ) : (
      <span className="text-slate-400">{t("zn.noZone")}</span>
    );
  return (
    <div className="flex items-center gap-2">
      <Select
        className="w-auto"
        value={manual ? (zoneId ?? "") : ""}
        onChange={(e) => set.mutate(e.target.value || null)}
        aria-label={t("zn.assetZone")}
        data-testid="asset-zone"
      >
        <option value="">{manual ? t("zn.autoReset") : cur ? t("zn.autoWith", { name: cur.name }) : t("zn.autoNone")}</option>
        {zones.data.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </Select>
      <span className="text-xs text-slate-500" data-testid="asset-zone-mode">{manual ? t("zn.manual") : t("zn.auto")}</span>
      {set.error && <span className="text-xs text-red-700">{String((set.error as Error).message)}</span>}
    </div>
  );
}
