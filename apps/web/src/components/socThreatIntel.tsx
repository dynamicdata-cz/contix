/** Veřejné zdroje hrozeb (ADR-057): stav zdrojů, stažení, nastavení (Auth-Key, adresy, vlastní seznamy), ruční nahrání. */
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { TI_FEEDS, TI_LABELS, type TiCustomList, type TiFeed, type TiStatusDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, RefreshCw, Settings2, Trash2, Upload } from "lucide-react";
import { useState } from "react";

export function ThreatIntelCard() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "threat-intel"], queryFn: api.soc.threatIntel });
  const [settings, setSettings] = useState(false);
  const refresh = useMutation({ mutationFn: api.soc.refreshThreatIntel, onSuccess: (r) => (qc.setQueryData(["soc", "threat-intel"], r), qc.invalidateQueries({ queryKey: ["soc", "alerts"] })) });
  const upload = useMutation({ mutationFn: (d: { source: string; file: File }) => api.soc.uploadThreatIntel(d.source, d.file), onSuccess: () => qc.invalidateQueries({ queryKey: ["soc", "threat-intel"] }) });
  const s = q.data;
  const admin = can("admin:settings");
  const rows: { key: string; name: string; enabled: boolean }[] = s
    ? [...TI_FEEDS.map((f) => ({ key: f as string, name: t.lbl(TI_LABELS.feed[f]), enabled: s.feeds[f]?.enabled ?? false })), ...s.custom.map((c) => ({ key: `custom:${c.id}`, name: c.name, enabled: c.enabled })), ...(s.mispEnabled ? [{ key: "misp", name: t.lbl(TI_LABELS.misp), enabled: true }] : [])]
    : [];
  const count = (k: string) => s?.totals.filter((x) => x.source === k).reduce((a, x) => a + x.n, 0) ?? 0;
  return (
    <Card className="mb-6 overflow-hidden" data-testid="threat-intel">
      <CardHeader
        title={t("soc.ti.title")}
        subtitle={t("soc.ti.subtitle")}
        action={
          <div className="flex gap-2">
            {admin && (
              <Button variant="secondary" onClick={() => setSettings(true)} disabled={!s}>
                <Settings2 size={15} /> {t("soc.ti.settings")}
              </Button>
            )}
            {can("soc:write") && (
              <Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                <RefreshCw size={15} className={refresh.isPending ? "animate-spin" : ""} /> {t("soc.ti.refresh")}
              </Button>
            )}
          </div>
        }
      />
      <ErrorBox error={q.error ?? refresh.error ?? upload.error} />
      {s && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t("soc.ti.col.source")}</th>
                  <th className="w-32 px-3 py-2 text-right">{t("soc.ti.col.count")}</th>
                  <th className="w-44 px-3 py-2">{t("soc.ti.col.updated")}</th>
                  {admin && <th className="w-24 px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const st = s.state[r.key];
                  return (
                    <tr key={r.key} className="align-top">
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{r.name}</span> {!r.enabled && <Badge tone="slate">{t("soc.src.disabled")}</Badge>}
                        {st?.error && <div className="mt-0.5 text-xs text-amber-800">{st.error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{count(r.key).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{st?.at ? fmtDate(st.at) : "—"}</td>
                      {admin && r.key === "misp" && <td />}
                      {admin && r.key !== "misp" && (
                        <td className="px-3 py-2.5">
                          <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-brand-700 hover:underline" title={t("soc.ti.uploadHint")}>
                            <Upload size={13} /> {t("soc.ti.upload")}
                            <input type="file" className="hidden" accept=".csv,.txt,.zip,.gz" aria-label={t("soc.ti.uploadFor", { name: r.name })} onChange={(e) => e.target.files?.[0] && upload.mutate({ source: r.key, file: e.target.files[0] })} />
                          </label>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            <div>
              {s.lastHunt ? t("soc.ti.lastHunt", { at: fmtDate(s.lastHunt.at), hits: s.lastHunt.hits, alerts: s.lastHunt.alerts }) : t("soc.ti.noHunt")}
              {s.lastHunt?.error && <span className="text-amber-800"> – {s.lastHunt.error}</span>}
            </div>
            {s.matchedAlerts > 0 && (
              <Link to="/soc" search={{ intel: "1" } as never} className="font-medium text-red-700 hover:underline">
                {t("soc.ti.matched", { n: s.matchedAlerts })}
              </Link>
            )}
            {!s.hasAuthKey && <div className="text-amber-800">{t("soc.ti.noKey")}</div>}
            <div className="text-slate-400">{t("soc.ti.privacy")}</div>
          </div>
        </>
      )}
      {settings && s && <SettingsModal s={s} onClose={() => setSettings(false)} onSaved={(r) => (qc.setQueryData(["soc", "threat-intel"], r), setSettings(false))} />}
    </Card>
  );
}

function SettingsModal({ s, onClose, onSaved }: { s: TiStatusDto; onClose: () => void; onSaved: (r: TiStatusDto) => void }) {
  const t = useT();
  const [autoRefresh, setAuto] = useState(s.autoRefresh);
  const [interval, setIntervalH] = useState(s.intervalHours);
  const [hunt, setHunt] = useState(s.hunt);
  const [key, setKey] = useState("");
  const [feeds, setFeeds] = useState(s.feeds);
  const [custom, setCustom] = useState<TiCustomList[]>(s.custom);
  const m = useMutation({ mutationFn: () => api.soc.saveThreatIntel({ autoRefresh, intervalHours: interval, hunt, feeds, custom, ...(key ? { authKey: key } : {}) }), onSuccess: onSaved });
  const setFeed = (f: TiFeed, patch: Partial<TiStatusDto["feeds"][TiFeed]>) => setFeeds({ ...feeds, [f]: { ...feeds[f], ...patch } });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("soc.ti.settings")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {t("soc.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox checked={autoRefresh} onChange={setAuto} label={t("soc.ti.auto")} />
        <Field label={t("soc.ti.interval")}>
          <Input type="number" min={1} max={168} value={interval} onChange={(e) => setIntervalH(Number(e.target.value))} />
        </Field>
        <Checkbox checked={hunt} onChange={setHunt} label={t("soc.ti.hunt")} hint={t("soc.ti.huntHint")} />
        <Field label={t("soc.ti.key")} hint={s.hasAuthKey ? t("soc.act.pwSet") : t("soc.ti.keyHint")}>
          <Input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
      </div>
      <div className="space-y-3">
        {TI_FEEDS.map((f) => (
          <div key={f} className="rounded-md border border-slate-200 p-3">
            <Checkbox checked={feeds[f].enabled} onChange={(x) => setFeed(f, { enabled: x })} label={t.lbl(TI_LABELS.feed[f])} />
            <Input className="mt-2 font-mono text-xs" value={feeds[f].url} aria-label={t("soc.ti.urlOf", { name: t.lbl(TI_LABELS.feed[f]) })} onChange={(e) => setFeed(f, { url: e.target.value })} />
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">{t("soc.ti.custom")}</div>
        <p className="mb-2 text-xs text-slate-500">{t("soc.ti.customHint")}</p>
        {custom.map((c, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <input type="checkbox" checked={c.enabled} aria-label={t("soc.ti.enabled")} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
            <Input className="w-48" value={c.name} placeholder={t("soc.ti.customName")} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input className="font-mono text-xs" value={c.url} placeholder="https://…" onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <Button variant="secondary" onClick={() => setCustom(custom.filter((_, j) => j !== i))} aria-label={t("soc.ti.remove")}>
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {custom.length < 20 && (
          <Button variant="secondary" onClick={() => setCustom([...custom, { id: `c${Date.now().toString(36)}`, name: "", url: "", enabled: true }])}>
            <Plus size={14} /> {t("soc.ti.addCustom")}
          </Button>
        )}
      </div>
      <ErrorBox error={m.error} />
    </Modal>
  );
}
