import { askConfirm } from "@/components/ui/overlay";
/** Indikátory kompromitace (ADR-054): evidence, zpětné hledání, export a feedy k blokaci; kandidáti z alertu. */
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate, fmtDay } from "@/lib/utils";
import { SOC_IOC_ACTIONS, SOC_IOC_DEFAULT_DAYS, SOC_IOC_FEED_TYPES, SOC_IOC_LABELS, SOC_IOC_TYPES, type SocIocAction, type SocIocCreateResult, type SocIocDto, type SocIocFeedSecret, type SocIocState } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ban, Download, Plus, Rss, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { EnrichButton, MispShareButton } from "@/components/socEnrich";

const stateTone: Record<SocIocState, Tone> = { active: "green", expired: "slate", revoked: "slate" };
const plus = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

export function IocTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [state, setState] = useState<"active" | "all">("active");
  const [type, setType] = useState("");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["soc", "iocs", state, type, text], queryFn: () => api.soc.iocs({ state, type: type || undefined, q: text.trim() || undefined }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["soc", "iocs"] });
  const hunt = useMutation({ mutationFn: (id: string) => api.soc.huntIoc(id, 30), onSuccess: (r) => (refresh(), setOpen(r.id)) });
  const revoke = useMutation({ mutationFn: api.soc.revokeIoc, onSuccess: refresh });
  const setAction = useMutation({ mutationFn: (d: { id: string; action: SocIocAction }) => api.soc.updateIoc(d.id, { action: d.action }), onSuccess: refresh });
  const w = can("soc:write");
  const items = q.data ?? [];
  return (
    <div className="mb-6 space-y-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Select className="w-40" value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label={t("soc.ioc.filterState")}>
            <option value="active">{t("soc.ioc.filterActive")}</option>
            <option value="all">{t("soc.ioc.filterAll")}</option>
          </Select>
          <Select className="w-40" value={type} onChange={(e) => setType(e.target.value)} aria-label={t("soc.ioc.col.type")}>
            <option value="">{t("soc.ioc.anyType")}</option>
            {SOC_IOC_TYPES.map((x) => (
              <option key={x} value={x}>
                {t.lbl(SOC_IOC_LABELS.type[x])}
              </option>
            ))}
          </Select>
          <Input className="max-w-xs" placeholder={t("soc.ioc.search")} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("soc.ioc.search")} />
          <div className="ml-auto flex flex-wrap gap-2">
            <a href={api.soc.iocExportUrl(type || undefined, "txt")} download>
              <Button variant="secondary">
                <Download size={15} /> {t("soc.ioc.exportTxt")}
              </Button>
            </a>
            <a href={api.soc.iocExportUrl(type || undefined, "csv")} download>
              <Button variant="secondary">CSV</Button>
            </a>
            <MispShareButton items={items} />
            {w && (
              <Button onClick={() => setAdding(true)}>
                <Plus size={15} /> {t("soc.ioc.add")}
              </Button>
            )}
          </div>
        </div>
        <ErrorBox error={q.error ?? hunt.error ?? revoke.error ?? setAction.error} />
        {!q.data ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>{t("soc.ioc.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-28 px-4 py-2">{t("soc.ioc.col.type")}</th>
                  <th className="px-3 py-2">{t("soc.ioc.col.value")}</th>
                  <th className="w-28 px-3 py-2">{t("soc.ioc.col.action")}</th>
                  <th className="w-32 px-3 py-2">{t("soc.ioc.col.valid")}</th>
                  <th className="w-44 px-3 py-2">{t("soc.ioc.col.hunt")}</th>
                  {w && <th className="w-56 px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((i) => (
                  <IocRow key={i.id} i={i} w={w} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onHunt={() => hunt.mutate(i.id)} hunting={hunt.isPending && hunt.variables === i.id} onRevoke={async () => (await askConfirm(t("soc.ioc.revokeConfirm", { v: i.display }))) && revoke.mutate(i.id)} onAction={(a) => setAction.mutate({ id: i.id, action: a })} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{t("soc.ioc.hint")}</p>
      </Card>
      <FeedsCard />
      {adding && <AddIocModal onClose={() => setAdding(false)} onDone={refresh} />}
    </div>
  );
}

function IocRow({ i, w, open, onToggle, onHunt, hunting, onRevoke, onAction }: { i: SocIocDto; w: boolean; open: boolean; onToggle: () => void; onHunt: () => void; hunting: boolean; onRevoke: () => void; onAction: (a: SocIocAction) => void }) {
  const t = useT();
  const h = i.lastHunt;
  return (
    <>
      <tr className="align-top">
        <td className="px-4 py-2.5">
          <Badge tone="slate">{t.lbl(SOC_IOC_LABELS.type[i.type])}</Badge>
        </td>
        <td className="px-3 py-2.5">
          <div className="break-all font-mono text-xs">{i.display}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {i.note && `${i.note} · `}
            {i.sourceAlertId ? (
              <Link to="/soc/$alertId" params={{ alertId: i.sourceAlertId }} className="text-brand-700 hover:underline">
                {i.sourceAlertTitle}
              </Link>
            ) : (
              t("soc.ioc.manual")
            )}
            {i.mispEventId && (
              <>
                {" · "}
                <Badge tone="violet">MISP #{i.mispEventId}</Badge>
              </>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <Badge tone={i.action === "block" ? "red" : "blue"}>{t.lbl(SOC_IOC_LABELS.action[i.action])}</Badge>
        </td>
        <td className="px-3 py-2.5 text-xs">
          <Badge tone={stateTone[i.state]}>{t.lbl(SOC_IOC_LABELS.state[i.state])}</Badge>
          <div className="mt-0.5 text-slate-500">{i.validUntil ? fmtDay(i.validUntil) : t("soc.ioc.noExpiry")}</div>
        </td>
        <td className="px-3 py-2.5 text-xs">
          {h ? (
            <button type="button" onClick={onToggle} className="text-left hover:underline" data-testid="ioc-hunt-result">
              <span className={h.total || h.contixAlerts ? "font-semibold text-red-700" : "text-slate-600"}>{t("soc.ioc.huntHits", { n: h.total, a: h.agents.length, c: h.contixAlerts })}</span>
              <div className="text-slate-400">{fmtDate(h.at)}</div>
            </button>
          ) : (
            <span className="text-slate-400">{t("soc.ioc.notHunted")}</span>
          )}
        </td>
        {w && (
          <td className="px-3 py-2.5">
            {i.state === "active" && (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="secondary" onClick={onHunt} disabled={hunting} title={t("soc.ioc.huntHint")}>
                  <Search size={14} /> {t("soc.ioc.hunt")}
                </Button>
                <EnrichButton type={i.type} value={i.value} iocId={i.id} compact />
                <Button variant="secondary" onClick={() => onAction(i.action === "block" ? "monitor" : "block")} title={i.action === "block" ? t("soc.ioc.toMonitor") : t("soc.ioc.toBlock")} aria-label={i.action === "block" ? t("soc.ioc.toMonitor") : t("soc.ioc.toBlock")}>
                  <Ban size={14} />
                </Button>
                <Button variant="danger" onClick={onRevoke} aria-label={t("soc.ioc.revoke")} title={t("soc.ioc.revoke")}>
                  <Trash2 size={14} />
                </Button>
              </div>
            )}
          </td>
        )}
      </tr>
      {open && h && (
        <tr>
          <td colSpan={w ? 6 : 5} className="bg-slate-50 px-4 py-3 text-xs">
            {h.error && <p className="mb-2 text-amber-800">{h.error}</p>}
            <p className="mb-2 text-slate-600">{t("soc.ioc.huntDetail", { days: h.days, n: h.total, c: h.contixAlerts })}</p>
            {h.agents.length > 0 && (
              <table className="w-full max-w-2xl">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1">{t("soc.ioc.agent")}</th>
                    <th className="py-1 text-right">{t("soc.ioc.hits")}</th>
                    <th className="py-1">{t("soc.ioc.firstLast")}</th>
                  </tr>
                </thead>
                <tbody>
                  {h.agents.map((a) => (
                    <tr key={a.name} className="border-t border-slate-200">
                      <td className="py-1 font-medium">{a.name}</td>
                      <td className="py-1 text-right tabular-nums">{a.count}</td>
                      <td className="py-1 text-slate-600">
                        {a.first ? fmtDate(a.first) : "—"} – {a.last ? fmtDate(a.last) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(h.total > 0 || h.contixAlerts > 0) && <p className="mt-2 text-slate-600">{t("soc.ioc.huntNext")}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

function AddIocModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [values, setValues] = useState("");
  const [action, setAction] = useState<SocIocAction>("block");
  const [until, setUntil] = useState(plus(SOC_IOC_DEFAULT_DAYS));
  const [note, setNote] = useState("");
  const [res, setRes] = useState<SocIocCreateResult | null>(null);
  const lines = values.split(/[\n,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const m = useMutation({ mutationFn: () => api.soc.addIocs({ items: lines.map((value) => ({ value })), action, validUntil: until, note }), onSuccess: (r) => (onDone(), setRes(r)) });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("soc.ioc.add")}
      footer={
        res ? (
          <Button onClick={onClose}>{t("common.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancelAction")}
            </Button>
            <Button onClick={() => m.mutate()} disabled={!lines.length || lines.length > 500 || m.isPending}>
              {t("soc.ioc.addN", { n: lines.length })}
            </Button>
          </>
        )
      }
    >
      {res ? (
        <div className="space-y-2 text-sm">
          <p>{t("soc.ioc.added", { c: res.created, u: res.updated })}</p>
          {res.rejected.length > 0 && (
            <ul className="text-xs text-amber-800">
              {res.rejected.map((r) => (
                <li key={r.value}>
                  {r.value} – {t.lbl(SOC_IOC_LABELS.rejected[r.reason])}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <Field label={t("soc.ioc.values")} hint={t("soc.ioc.valuesHint")}>
            <Textarea rows={6} className="font-mono text-xs" value={values} onChange={(e) => setValues(e.target.value)} placeholder={"203.0.113.7\nevil[.]example\nhxxps://evil.example/login\n44d88612fea8a8f36de82e1278abb02f"} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("soc.ioc.col.action")}>
              <Select value={action} onChange={(e) => setAction(e.target.value as SocIocAction)}>
                {SOC_IOC_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {t.lbl(SOC_IOC_LABELS.action[a])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("soc.ioc.col.valid")}>
              <Input type="date" value={until} min={plus(0)} max={plus(366)} onChange={(e) => setUntil(e.target.value)} />
            </Field>
          </div>
          <Field label={t("soc.ioc.note")}>
            <Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorBox error={m.error} />
        </>
      )}
    </Modal>
  );
}

function FeedsCard() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "ioc-feeds"], queryFn: api.soc.iocFeeds });
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<SocIocFeedSecret | null>(null);
  const create = useMutation({ mutationFn: () => api.soc.createIocFeed(name.trim()), onSuccess: (r) => (qc.invalidateQueries({ queryKey: ["soc", "ioc-feeds"] }), setName(""), setSecret(r)) });
  const remove = useMutation({ mutationFn: api.soc.deleteIocFeed, onSuccess: () => qc.invalidateQueries({ queryKey: ["soc", "ioc-feeds"] }) });
  const admin = can("admin:settings");
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("soc.ioc.feeds")} subtitle={t("soc.ioc.feedsHint")} />
      <ErrorBox error={q.error ?? create.error ?? remove.error} />
      <div className="space-y-3 p-4 text-sm">
        {(q.data ?? []).length === 0 ? (
          <p className="text-slate-500">{t("soc.ioc.noFeeds")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {q.data!.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Rss size={14} className="text-slate-400" />
                <span className="font-medium">{f.name}</span>
                <span className="font-mono text-xs text-slate-500">{f.tokenPrefix}…</span>
                <span className="text-xs text-slate-500">{t("soc.ioc.feedStats", { n: f.fetches, d: f.lastFetchAt ? fmtDate(f.lastFetchAt) : "—" })}</span>
                {admin && (
                  <Button variant="danger" className="ml-auto" onClick={async () => (await askConfirm(t("soc.ioc.feedDeleteConfirm", { name: f.name }))) && remove.mutate(f.id)} aria-label={t("soc.ioc.feedDelete")}>
                    <Trash2 size={14} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {admin && (
          <div className="flex gap-2">
            <Input className="max-w-xs" value={name} maxLength={120} placeholder={t("soc.ioc.feedName")} aria-label={t("soc.ioc.feedName")} onChange={(e) => setName(e.target.value)} />
            <Button variant="secondary" onClick={() => create.mutate()} disabled={name.trim().length < 2 || create.isPending}>
              <Plus size={15} /> {t("soc.ioc.feedCreate")}
            </Button>
          </div>
        )}
      </div>
      {secret && (
        <Modal open wide onClose={() => setSecret(null)} title={t("soc.ioc.feedTitle", { name: secret.feed.name })} footer={<Button onClick={() => setSecret(null)}>{t("soc.src.tokenDone")}</Button>}>
          <p className="text-sm text-amber-800">{t("soc.ioc.feedOnce")}</p>
          <ul className="space-y-2" data-testid="ioc-feed-urls">
            {SOC_IOC_FEED_TYPES.map((x) => (
              <li key={x}>
                <div className="text-xs text-slate-500">{t.lbl(SOC_IOC_LABELS.type[x])}</div>
                <Input readOnly className="font-mono text-xs" value={`${window.location.origin}/api/public/soc/feed/${secret.token}/${x}.txt`} onFocus={(e) => e.target.select()} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">{t("soc.ioc.feedUse")}</p>
        </Modal>
      )}
    </Card>
  );
}

/** Kandidáti na IOC v detailu alertu – analytik vybere a přidá k blokaci nebo sledování. */
export function AlertIocCard({ alertId, canWrite }: { alertId: string; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "alert-iocs", alertId], queryFn: () => api.soc.alertIocs(alertId) });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [res, setRes] = useState<SocIocCreateResult | null>(null);
  const items = q.data ?? [];
  const key = (x: { type: string; value: string }) => `${x.type}|${x.value}`;
  const add = useMutation({
    mutationFn: (action: SocIocAction) => api.soc.addIocs({ sourceAlertId: alertId, action, items: items.filter((x) => sel.has(key(x))).map((x) => ({ type: x.type, value: x.value })) }),
    onSuccess: (r) => (setRes(r), setSel(new Set()), qc.invalidateQueries({ queryKey: ["soc", "alert-iocs", alertId] }), qc.invalidateQueries({ queryKey: ["soc", "iocs"] })),
  });
  if (!items.length) return null;
  return (
    <Card className="overflow-hidden" data-testid="soc-alert-iocs">
      <CardHeader title={t("soc.ioc.alertTitle")} subtitle={t("soc.ioc.alertSubtitle")} />
      <ul className="divide-y divide-slate-100 text-sm">
        {items.map((x) => (
          <li key={key(x)} className="flex items-center gap-2 px-4 py-1.5">
            {canWrite && !x.existingId && (
              <input
                type="checkbox"
                aria-label={t("soc.ioc.select", { v: x.display })}
                checked={sel.has(key(x))}
                onChange={(e) =>
                  setSel((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(key(x));
                    else n.delete(key(x));
                    return n;
                  })
                }
              />
            )}
            <span className="break-all font-mono text-xs">{x.display}</span>
            <span className="text-xs text-slate-400">{t.lbl(SOC_IOC_LABELS.reason[x.reason])}</span>
            {x.existingId && <Badge tone="green">{t("soc.ioc.inList")}</Badge>}
            <span className="ml-auto">
              <EnrichButton type={x.type} value={x.value} alertId={alertId} compact />
            </span>
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <Button onClick={() => add.mutate("block")} disabled={!sel.size || add.isPending}>
            <Ban size={14} /> {t("soc.ioc.addBlock", { n: sel.size })}
          </Button>
          <Button variant="secondary" onClick={() => add.mutate("monitor")} disabled={!sel.size || add.isPending}>
            {t("soc.ioc.addMonitor")}
          </Button>
          {res && <span className="text-xs text-slate-600">{t("soc.ioc.added", { c: res.created, u: res.updated })}</span>}
          <ErrorBox error={add.error} />
        </div>
      )}
    </Card>
  );
}
