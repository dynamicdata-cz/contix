import { askConfirm } from "@/components/ui/overlay";
/** Síťové segmenty a neevidovaná zařízení (ADR-072). */
import { AssetPicker, type PickedAsset } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { ASSET_TYPES, LABELS, NETSCAN_LABELS, NETSCAN_MODES, NETSCAN_PROFILES, NETSCAN_SCHEDULES, type NetObservationDto, type NetObsStatus, type NetSegmentDto, type NetSegmentInput } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Link2, Pencil, Play, Plus, RotateCcw, Server, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const obsTone: Record<NetObsStatus, Tone> = { unknown: "red", changed: "amber", known: "green", approved: "blue" };

export function NetSegmentsSection() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["netsegments"],
    queryFn: api.discovery.segments,
    refetchInterval: (x) => (x.state.data?.segments.some((s) => s.running) ? 3000 : false),
  });
  const [edit, setEdit] = useState<NetSegmentDto | "new" | null>(null);
  const [filter, setFilter] = useState<"" | NetObsStatus>("unknown");
  const [seg, setSeg] = useState<string>("");
  const obs = useQuery({ queryKey: ["netobs", seg, filter], queryFn: () => api.discovery.observations({ segmentId: seg || undefined, status: filter || undefined }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["netsegments"] });
    qc.invalidateQueries({ queryKey: ["netobs"] });
    qc.invalidateQueries({ queryKey: ["runs"] });
  };
  const run = useMutation({ mutationFn: (id: string) => api.discovery.runSegment(id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.discovery.deleteSegment(id), onSuccess: refresh });
  const write = can("discovery:run");
  const d = q.data;
  // po doběhnutí skenu načíst nalezená zařízení znovu
  const anyRunning = !!d?.segments.some((s) => s.running);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !anyRunning) {
      qc.invalidateQueries({ queryKey: ["netobs"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    }
    wasRunning.current = anyRunning;
  }, [anyRunning, qc]);
  return (
    <>
      <Card className="mb-6 overflow-hidden" data-testid="net-segments">
        <CardHeader
          title={t("net.title")}
          subtitle={t("net.subtitle")}
          action={
            write && (
              <Button className="px-2.5 py-1.5 text-xs" onClick={() => setEdit("new")}>
                <Plus size={14} /> {t("net.add")}
              </Button>
            )
          }
        />
        <ErrorBox error={q.error ?? run.error ?? remove.error} />
        {d && (!d.scan.enabled || !d.scan.allowedCidrs.length || !d.scan.nmap) && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {t("net.scanOff")}{" "}
            {can("admin:settings") && (
              <Link to="/admin/connectors" className="font-medium underline">
                {t("net.setup")}
              </Link>
            )}
          </div>
        )}
        {d && d.segments.length === 0 ? (
          <EmptyState>{t("net.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t("net.col.segment")}</th>
                  <th className="px-3 py-2">{t("net.col.mode")}</th>
                  <th className="px-3 py-2">{t("net.col.schedule")}</th>
                  <th className="px-3 py-2">{t("net.col.last")}</th>
                  <th className="px-3 py-2">{t("net.col.devices")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(d?.segments ?? []).map((s) => (
                  <tr key={s.id} className={cn(!s.enabled && "opacity-50")}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{s.name}</div>
                      <div className="font-mono text-xs text-slate-500">
                        {s.cidrs.join(", ")}
                        {s.exclude.length > 0 && <span className="text-slate-400"> {t("net.excluding", { list: s.exclude.join(", ") })}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {t.lbl(NETSCAN_LABELS.mode[s.mode as "monitor"]).split(" – ")[0]}
                      <div className="text-slate-500">{t.lbl(NETSCAN_LABELS.profile[s.profile as "ping"])}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {t.lbl(NETSCAN_LABELS.schedule[s.schedule])}
                      {s.nextRunAt && <div className="text-slate-500">{t("net.next", { date: fmtDate(s.nextRunAt) })}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.running ? (
                        <Badge tone="blue">{t("net.running")}</Badge>
                      ) : s.lastRunAt ? (
                        <>
                          {fmtDate(s.lastRunAt)}
                          {s.lastSummary?.error ? <div className="text-red-700">{s.lastSummary.error}</div> : s.lastSummary && <div className="text-slate-500">{t("net.summary", { up: s.lastSummary.up, alerts: s.lastSummary.alerts })}</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(["unknown", "changed", "known", "approved"] as const)
                          .filter((k) => s.counts[k] > 0)
                          .map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => {
                                setSeg(s.id);
                                setFilter(k);
                              }}
                            >
                              <Badge tone={obsTone[k]}>
                                {t.lbl(NETSCAN_LABELS.status[k])} {s.counts[k]}
                              </Badge>
                            </button>
                          ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {write && (
                        <>
                          <button type="button" title={t("net.runNow")} aria-label={t("net.runNow")} className="mr-2 text-brand-700 disabled:opacity-40" disabled={s.running || run.isPending} onClick={() => run.mutate(s.id)}>
                            <Play size={15} />
                          </button>
                          <button type="button" aria-label={t("net.edit")} className="mr-2 text-slate-500 hover:text-brand-700" onClick={() => setEdit(s)}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" aria-label={t("net.remove")} className="text-red-700" onClick={async () => (await askConfirm(t("net.removeConfirm"))) && remove.mutate(s.id)}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-6 overflow-hidden" data-testid="net-observations">
        <CardHeader
          title={t("net.devices")}
          subtitle={t("net.devicesSub")}
          action={
            <div className="flex flex-wrap gap-2">
              <Select className="w-48" value={seg} onChange={(e) => setSeg(e.target.value)} aria-label={t("net.col.segment")}>
                <option value="">{t("net.allSegments")}</option>
                {(d?.segments ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select className="w-48" value={filter} onChange={(e) => setFilter(e.target.value as "" | NetObsStatus)} aria-label={t("net.col.status")}>
                <option value="">{t("net.allStatuses")}</option>
                {(["unknown", "changed", "known", "approved"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t.lbl(NETSCAN_LABELS.status[k])}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <ErrorBox error={obs.error} />
        {obs.data?.length === 0 ? (
          <EmptyState>{filter === "unknown" ? t("net.noUnknown") : t("net.noDevices")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t("net.col.device")}</th>
                  <th className="px-3 py-2">{t("net.col.segment")}</th>
                  <th className="px-3 py-2">{t("net.col.status")}</th>
                  <th className="px-3 py-2">{t("net.col.seen")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(obs.data ?? []).map((o) => (
                  <ObsRow key={o.id} o={o} canDecide={write} canAsset={can("assets:write")} onDone={refresh} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <SegmentModal seg={edit === "new" ? null : edit} allowed={d?.scan.allowedCidrs ?? []} onClose={() => setEdit(null)} onDone={refresh} />}
    </>
  );
}

function ObsRow({ o, canDecide, canAsset, onDone }: { o: NetObservationDto; canDecide: boolean; canAsset: boolean; onDone: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"approve" | "asset" | "link" | null>(null);
  const reset = useMutation({ mutationFn: () => api.discovery.resetObs(o.id), onSuccess: onDone });
  return (
    <tr className="align-top">
      <td className="px-4 py-2">
        <div className="font-mono text-xs font-medium">{o.ip ?? "—"}</div>
        <div className="text-xs text-slate-500">
          {[o.hostname, o.mac, o.vendor, o.osName].filter(Boolean).join(" · ") || "—"}
          {o.openPorts.length > 0 && <span className="ml-1 text-slate-400">({o.openPorts.map((p) => p.port).join(", ")})</span>}
        </div>
      </td>
      <td className="px-3 py-2 text-xs">{o.segmentName}</td>
      <td className="px-3 py-2">
        <Badge tone={obsTone[o.status]}>{t.lbl(NETSCAN_LABELS.status[o.status])}</Badge>
        {o.assetId && (
          <Link to="/assets/$assetId" params={{ assetId: o.assetId }} className="ml-1 text-xs text-brand-700 hover:underline">
            {o.assetName}
          </Link>
        )}
        {o.note && <div className="text-xs text-slate-500">{o.note}</div>}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
        {fmtDate(o.lastSeen)}
        <div>{t("net.seenCount", { n: o.seenCount })}</div>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {(o.status === "unknown" || o.status === "changed") && (
          <div className="flex flex-wrap justify-end gap-1">
            {canAsset && o.status === "unknown" && (
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setMode("asset")}>
                <Server size={13} /> {t("net.createAsset")}
              </Button>
            )}
            {canAsset && (
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setMode("link")}>
                <Link2 size={13} /> {t("net.link")}
              </Button>
            )}
            {canDecide && (
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setMode("approve")}>
                <CheckCircle2 size={13} /> {t("net.approve")}
              </Button>
            )}
          </div>
        )}
        {o.status === "approved" && canDecide && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700" onClick={() => reset.mutate()}>
            <RotateCcw size={12} /> {t("net.reset")}
          </button>
        )}
        {mode && <DecisionModal o={o} mode={mode} onClose={() => setMode(null)} onDone={onDone} />}
      </td>
    </tr>
  );
}

function DecisionModal({ o, mode, onClose, onDone }: { o: NetObservationDto; mode: "approve" | "asset" | "link"; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [name, setName] = useState(o.hostname ?? o.ip ?? "");
  const [type, setType] = useState("other");
  const [picked, setPicked] = useState<PickedAsset[]>([]);
  const save = useMutation({
    mutationFn: () => (mode === "approve" ? api.discovery.approveObs(o.id, note || null) : mode === "asset" ? api.discovery.createAssetFromObs(o.id, { name, assetType: type }) : api.discovery.linkObs(o.id, picked[0]!.id)),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const title = mode === "approve" ? t("net.approveTitle") : mode === "asset" ? t("net.createAsset") : t("net.linkTitle");
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || (mode === "link" && !picked.length) || (mode === "asset" && !name.trim())} onClick={() => save.mutate()}>
            {t("net.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-left text-sm text-slate-600">
        <span className="font-mono">{o.ip}</span> {[o.mac, o.hostname, o.vendor].filter(Boolean).join(" · ")}
      </p>
      {mode === "approve" && (
        <Field label={t("net.approveNote")}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("net.approvePlaceholder")} />
        </Field>
      )}
      {mode === "asset" && (
        <div className="grid gap-4 text-left sm:grid-cols-2">
          <Field label={t("net.assetName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("net.assetType")}>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {ASSET_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(LABELS.assetType[x as keyof typeof LABELS.assetType] ?? x)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      {mode === "link" && (
        <div className="text-left">
          <p className="mb-2 text-sm text-slate-600">{t("net.linkIntro")}</p>
          <AssetPicker value={picked} onChange={(v) => setPicked(v.slice(-1))} />
        </div>
      )}
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function SegmentModal({ seg, allowed, onClose, onDone }: { seg: NetSegmentDto | null; allowed: string[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState({
    name: seg?.name ?? "",
    cidrs: seg?.cidrs.join("\n") ?? "",
    exclude: seg?.exclude.join("\n") ?? "",
    profile: seg?.profile ?? "ping",
    mode: seg?.mode ?? "monitor",
    schedule: seg?.schedule ?? "daily",
    scheduleTime: seg?.scheduleTime ?? "02:00",
    scheduleWeekday: seg?.scheduleWeekday ?? 1,
    alertLevel: seg?.alertLevel ?? 8,
    enabled: seg?.enabled ?? true,
    note: seg?.note ?? "",
  });
  const lines = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => {
      const body: NetSegmentInput = { ...f, cidrs: lines(f.cidrs), exclude: lines(f.exclude), note: f.note || null } as NetSegmentInput;
      return seg ? api.discovery.updateSegment(seg.id, body) : api.discovery.createSegment(body);
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={seg ? t("net.edit") : t("net.add")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || !f.name.trim() || !lines(f.cidrs).length} onClick={() => save.mutate()}>
            {t("net.save")}
          </Button>
        </>
      }
    >
      <Field label={t("net.f.name")}>
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("net.f.namePh")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("net.f.cidrs")} hint={allowed.length ? t("net.f.allowed", { list: allowed.join(", ") }) : undefined}>
          <Textarea rows={3} className="font-mono text-xs" value={f.cidrs} onChange={(e) => setF({ ...f, cidrs: e.target.value })} placeholder="10.22.22.0/24" />
        </Field>
        <Field label={t("net.f.exclude")} hint={t("net.f.excludeHint")}>
          <Textarea rows={3} className="font-mono text-xs" value={f.exclude} onChange={(e) => setF({ ...f, exclude: e.target.value })} placeholder="10.22.22.1" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("net.f.mode")}>
          <Select value={f.mode} aria-label={t("net.f.mode")} onChange={(e) => setF({ ...f, mode: e.target.value as "monitor" })}>
            {NETSCAN_MODES.map((x) => (
              <option key={x} value={x}>
                {t.lbl(NETSCAN_LABELS.mode[x])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("net.f.profile")}>
          <Select value={f.profile} aria-label={t("net.f.profile")} onChange={(e) => setF({ ...f, profile: e.target.value as "ping" })}>
            {NETSCAN_PROFILES.map((x) => (
              <option key={x} value={x}>
                {t.lbl(NETSCAN_LABELS.profile[x])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("net.f.schedule")}>
          <Select value={f.schedule} aria-label={t("net.f.schedule")} onChange={(e) => setF({ ...f, schedule: e.target.value as "daily" })}>
            {NETSCAN_SCHEDULES.map((x) => (
              <option key={x} value={x}>
                {t.lbl(NETSCAN_LABELS.schedule[x])}
              </option>
            ))}
          </Select>
        </Field>
        {(f.schedule === "daily" || f.schedule === "weekly") && (
          <div className="grid grid-cols-2 gap-2">
            {f.schedule === "weekly" && (
              <Field label={t("net.f.weekday")}>
                <Select value={f.scheduleWeekday} onChange={(e) => setF({ ...f, scheduleWeekday: Number(e.target.value) })}>
                  {NETSCAN_LABELS.weekday.map((x, i) => (
                    <option key={x} value={i}>
                      {t.lbl(x)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t("net.f.time")}>
              <Input type="time" value={f.scheduleTime} onChange={(e) => setF({ ...f, scheduleTime: e.target.value })} />
            </Field>
          </div>
        )}
        <Field label={t("net.f.alertLevel")} hint={t("net.f.alertLevelHint")}>
          <Input type="number" min={3} max={15} value={f.alertLevel} onChange={(e) => setF({ ...f, alertLevel: Number(e.target.value) })} />
        </Field>
      </div>
      <Checkbox checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={t("net.f.enabled")} />
      <Field label={t("net.f.note")}>
        <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
