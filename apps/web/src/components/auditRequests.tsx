import { askConfirm } from "@/components/ui/overlay";
/** Portál externího auditora (ADR-071): požadavky na podklady (PBC) – interní správa i pohled auditora. */
import { PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { AUDIT_REQUEST_LABELS, type AuditPortalDto, type AuditRequestStatus } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ListPlus, MessageSquare, Paperclip, Plus, Send, Trash2, Undo2, Users } from "lucide-react";
import { useRef, useState } from "react";

export const statusTone: Record<AuditRequestStatus, Tone> = { open: "amber", submitted: "blue", returned: "red", accepted: "green", cancelled: "slate" };

export function AuditRequestsPanel({ auditId }: { auditId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["pbc", auditId], queryFn: () => api.pbc.portal(auditId) });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<"one" | "bulk" | null>(null);
  const [auditors, setAuditors] = useState(false);
  const [filter, setFilter] = useState<"" | AuditRequestStatus>("");
  const d = q.data;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return null;
  const rows = d.requests.filter((r) => !filter || r.status === filter);
  return (
    <Card className="mt-6 overflow-hidden" data-testid="pbc-panel">
      <CardHeader
        title={t("pbc.title")}
        subtitle={d.role === "internal" ? t("pbc.subInternal", { auditors: d.auditors.map((a) => a.displayName).join(", ") || "—" }) : t("pbc.subExternal")}
        action={
          <div className="flex flex-wrap gap-2">
            <a href={api.pbc.exportUrl(auditId)}>
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs">
                <Download size={14} /> {t("pbc.export")}
              </Button>
            </a>
            {d.canManage && (
              <>
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setAuditors(true)}>
                  <Users size={14} /> {t("pbc.auditors")}
                </Button>
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setAdding("bulk")}>
                  <ListPlus size={14} /> {t("pbc.bulk")}
                </Button>
                <Button className="px-2.5 py-1.5 text-xs" onClick={() => setAdding("one")}>
                  <Plus size={14} /> {t("pbc.add")}
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-2 text-xs">
        {(["", "open", "returned", "submitted", "accepted"] as const).map((s) => (
          <button key={s || "all"} type="button" onClick={() => setFilter(s)} className={cn("rounded-full px-2.5 py-1", filter === s ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
            {s ? `${t.lbl(AUDIT_REQUEST_LABELS[s])} (${d.summary[s]})` : t("pbc.all", { n: d.requests.length })}
          </button>
        ))}
        {d.summary.overdue > 0 && <span className="ml-auto self-center text-red-700">{t("pbc.overdue", { n: d.summary.overdue })}</span>}
      </div>
      {rows.length === 0 ? (
        <EmptyState>{t("pbc.empty")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">{t("pbc.col.request")}</th>
              {d.role === "internal" && <th className="px-3 py-2">{t("pbc.col.owner")}</th>}
              <th className="px-3 py-2">{t("pbc.col.due")}</th>
              <th className="px-3 py-2">{t("pbc.col.status")}</th>
              <th className="px-3 py-2 text-right">{t("pbc.col.files")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={cn(r.status === "cancelled" && "opacity-50")}>
                <td className="px-4 py-2">
                  <button type="button" className="text-left font-medium text-brand-700 hover:underline" onClick={() => setOpen(r.id)}>
                    <span className="font-mono text-xs text-slate-500">{r.code}</span> {r.title}
                  </button>
                  {r.reference && <div className="text-xs text-slate-500">{r.reference}</div>}
                </td>
                {d.role === "internal" && <td className="px-3 py-2 text-xs">{r.ownerName ?? "—"}</td>}
                <td className={cn("px-3 py-2 whitespace-nowrap", r.overdue && "font-medium text-red-700")}>{r.dueDate ? fmtDate(r.dueDate) : "—"}</td>
                <td className="px-3 py-2">
                  <Badge tone={statusTone[r.status]}>{t.lbl(AUDIT_REQUEST_LABELS[r.status])}</Badge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">
                  {r.files}
                  {r.comments > 0 && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-slate-400">
                      <MessageSquare size={11} /> {r.comments}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <RequestModal id={open} auditId={auditId} portal={d} onClose={() => setOpen(null)} />}
      {adding && <AddModal auditId={auditId} bulk={adding === "bulk"} onClose={() => setAdding(null)} />}
      {auditors && <AuditorsModal auditId={auditId} current={d.auditors.map((a) => a.id)} onClose={() => setAuditors(false)} />}
    </Card>
  );
}

function RequestModal({ id, auditId, portal, onClose }: { id: string; auditId: string; portal: AuditPortalDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pbc", "request", id], queryFn: () => api.pbc.get(id) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [comment, setComment] = useState("");
  const [returning, setReturning] = useState(false);
  const refresh = (d?: unknown) => {
    if (d) qc.setQueryData(["pbc", "request", id], d);
    else qc.invalidateQueries({ queryKey: ["pbc", "request", id] });
    qc.invalidateQueries({ queryKey: ["pbc", auditId] });
  };
  const upload = useMutation({ mutationFn: (f: File) => api.pbc.upload(id, f), onSuccess: refresh });
  const delFile = useMutation({ mutationFn: (fileId: string) => api.pbc.deleteFile(id, fileId), onSuccess: () => refresh() });
  const submit = useMutation({ mutationFn: () => api.pbc.submit(id), onSuccess: refresh });
  const accept = useMutation({ mutationFn: () => api.pbc.accept(id), onSuccess: refresh });
  const back = useMutation({
    mutationFn: () => api.pbc.returnBack(id, comment),
    onSuccess: (d) => {
      setComment("");
      setReturning(false);
      refresh(d);
    },
  });
  const say = useMutation({
    mutationFn: () => api.pbc.comment(id, comment),
    onSuccess: (d) => {
      setComment("");
      refresh(d);
    },
  });
  const cancel = useMutation({ mutationFn: () => api.pbc.update(id, { status: "cancelled" }), onSuccess: refresh });
  const r = q.data;
  return (
    <Modal open wide onClose={onClose} title={r ? `${r.code} ${r.title}` : t("pbc.title")}>
      <ErrorBox error={q.error ?? upload.error ?? delFile.error ?? submit.error ?? accept.error ?? back.error ?? say.error ?? cancel.error} />
      {r && (
        <div className="space-y-4" data-testid="pbc-request">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={statusTone[r.status]}>{t.lbl(AUDIT_REQUEST_LABELS[r.status])}</Badge>
            {r.reference && <span className="text-slate-600">{r.reference}</span>}
            {r.dueDate && <span className={cn("text-slate-600", r.overdue && "text-red-700")}>{t("pbc.dueOn", { date: fmtDate(r.dueDate) })}</span>}
            {portal.role === "internal" && r.ownerName && <span className="text-slate-600">· {r.ownerName}</span>}
          </div>
          {r.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{r.description}</p>}
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("pbc.files")}</h3>
            {r.fileList.length === 0 ? (
              <p className="text-sm text-slate-500">{portal.role === "external" ? t("pbc.noSharedFiles") : t("pbc.noFiles")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
                {r.fileList.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <a href={api.pbc.fileUrl(id, f.id)} className="flex-1 font-medium text-brand-700 hover:underline">
                      {f.filename}
                    </a>
                    <span className="text-xs text-slate-500">{Math.ceil(f.size / 1024)} kB</span>
                    {portal.role === "internal" && <Badge tone={f.shared ? "green" : "slate"}>{f.shared ? t("pbc.shared") : t("pbc.notShared")}</Badge>}
                    <span className="font-mono text-[10px] text-slate-400" title="SHA-256">
                      {f.sha256.slice(0, 12)}…
                    </span>
                    {r.canProvide && !f.shared && (
                      <button type="button" aria-label={t("pbc.removeFile")} className="text-red-700" onClick={() => delFile.mutate(f.id)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {r.canProvide && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input ref={fileRef} type="file" className="hidden" aria-label={t("pbc.upload")} onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
                <Button variant="secondary" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                  <Paperclip size={14} /> {t("pbc.upload")}
                </Button>
                <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
                  <Send size={14} /> {t("pbc.submit")}
                </Button>
              </div>
            )}
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("pbc.comments")}</h3>
            {r.commentList.length === 0 ? (
              <p className="text-sm text-slate-500">{t("pbc.noComments")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {r.commentList.map((c) => (
                  <li key={c.id} className={cn("rounded-md px-3 py-2", c.external ? "bg-amber-50" : "bg-slate-50")}>
                    <div className="text-xs text-slate-500">
                      {c.external ? t("pbc.auditor") : t("pbc.organization")} {c.authorName ? `· ${c.authorName}` : ""} · {fmtDate(c.createdAt)}
                    </div>
                    <div className="whitespace-pre-wrap">{c.body}</div>
                  </li>
                ))}
              </ul>
            )}
            {r.status !== "cancelled" && (
              <div className="mt-2 space-y-2">
                <Textarea rows={2} value={comment} aria-label={t("pbc.comment")} placeholder={returning ? t("pbc.returnPlaceholder") : t("pbc.commentPlaceholder")} onChange={(e) => setComment(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  {returning ? (
                    <Button disabled={!comment.trim() || back.isPending} onClick={() => back.mutate()}>
                      <Undo2 size={14} /> {t("pbc.returnConfirm")}
                    </Button>
                  ) : (
                    <Button variant="secondary" disabled={!comment.trim() || say.isPending} onClick={() => say.mutate()}>
                      {t("pbc.addComment")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </section>
          {r.canReview && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
                <CheckCircle2 size={14} /> {t("pbc.accept")}
              </Button>
              <Button variant="secondary" onClick={() => setReturning(true)}>
                <Undo2 size={14} /> {t("pbc.return")}
              </Button>
            </div>
          )}
          {portal.canManage && r.status !== "accepted" && r.status !== "cancelled" && (
            <div className="border-t border-slate-100 pt-3">
              <button type="button" className="text-xs text-red-700 hover:underline" onClick={async () => (await askConfirm(t("pbc.cancelConfirm"))) && cancel.mutate()}>
                {t("pbc.cancel")}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function AddModal({ auditId, bulk, onClose }: { auditId: string; bulk: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", reference: "", description: "", lines: "", dueDate: "", ownerPositionId: null as string | null });
  const save = useMutation({
    mutationFn: async () =>
      bulk
        ? api.pbc.bulk(auditId, { lines: f.lines, ownerPositionId: f.ownerPositionId, dueDate: f.dueDate || null })
        : api.pbc.create(auditId, { title: f.title, reference: f.reference || null, description: f.description || null, ownerPositionId: f.ownerPositionId, dueDate: f.dueDate || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pbc", auditId] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={bulk ? t("pbc.bulk") : t("pbc.add")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || (bulk ? !f.lines.trim() : !f.title.trim())} onClick={() => save.mutate()}>
            {t("pbc.create")}
          </Button>
        </>
      }
    >
      {bulk ? (
        <Field label={t("pbc.f.lines")} hint={t("pbc.f.linesHint")}>
          <Textarea rows={8} value={f.lines} onChange={(e) => setF({ ...f, lines: e.target.value })} placeholder={"Seznam privilegovaných účtů; CC6.1; 15. 11. 2026\nPolitika řízení přístupu; A.5.15"} />
        </Field>
      ) : (
        <>
          <Field label={t("pbc.f.title")}>
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label={t("pbc.f.reference")}>
            <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="CC6.1" />
          </Field>
          <Field label={t("pbc.f.description")}>
            <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("pbc.f.owner")}>
          <PositionSelect value={f.ownerPositionId} onChange={(v) => setF({ ...f, ownerPositionId: v })} ariaLabel={t("pbc.f.owner")} />
        </Field>
        <Field label={bulk ? t("pbc.f.dueDefault") : t("pbc.f.due")}>
          <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function AuditorsModal({ auditId, current, onClose }: { auditId: string; current: string[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pbc", "candidates"], queryFn: api.pbc.candidates });
  const [sel, setSel] = useState<string[]>(current);
  const [pick, setPick] = useState("");
  const save = useMutation({
    mutationFn: () => api.pbc.setAuditors(auditId, sel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pbc", auditId] });
      onClose();
    },
  });
  const users = q.data ?? [];
  return (
    <Modal
      open
      onClose={onClose}
      title={t("pbc.auditors")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("pbc.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("pbc.auditorsIntro")}</p>
      <ul className="space-y-1 text-sm">
        {sel.map((id) => {
          const u = users.find((x) => x.id === id);
          return (
            <li key={id} className="flex items-center gap-2">
              <span className="flex-1">{u ? `${u.displayName} (${u.email})` : id}</span>
              <button type="button" aria-label={t("pbc.removeAuditor")} className="text-red-700" onClick={() => setSel(sel.filter((x) => x !== id))}>
                <Trash2 size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t("pbc.pickAuditor")}>
          <option value="">{t("pbc.pickAuditor")}</option>
          {users
            .filter((u) => !sel.includes(u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.email})
              </option>
            ))}
        </Select>
        <Button
          variant="secondary"
          disabled={!pick}
          onClick={() => {
            setSel([...sel, pick]);
            setPick("");
          }}
        >
          <Plus size={14} />
        </Button>
      </div>
      {users.length === 0 && <p className="text-xs text-slate-500">{t("pbc.noCandidates")}</p>}
      <ErrorBox error={q.error ?? save.error} />
    </Modal>
  );
}

/** Stránka externího auditora: přidělené audity a jejich požadavky. */
export function AuditPortalPage() {
  const t = useT();
  const q = useQuery({ queryKey: ["pbc", "mine"], queryFn: api.pbc.mine });
  const [sel, setSel] = useState<string | null>(null);
  const audits = q.data ?? [];
  const current = sel ?? audits[0]?.id ?? null;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("pbc.portalTitle")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("pbc.portalSub")}</p>
      </div>
      <ErrorBox error={q.error} />
      {q.data && audits.length === 0 && (
        <Card>
          <EmptyState>{t("pbc.noAudits")}</EmptyState>
        </Card>
      )}
      {audits.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {audits.map((a) => (
            <button key={a.id} type="button" onClick={() => setSel(a.id)} className={cn("rounded-md border px-3 py-1.5 text-sm", current === a.id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white hover:bg-slate-50")}>
              {a.code ? `${a.code} ` : ""}
              {a.title}
            </button>
          ))}
        </div>
      )}
      {current && (
        <>
          <Card className="p-4">
            <div className="text-lg font-semibold">{audits.find((a) => a.id === current)?.title}</div>
            <div className="text-sm text-slate-500">
              {(() => {
                const a = audits.find((x) => x.id === current);
                return a?.plannedStart ? `${fmtDate(a.plannedStart)} – ${a.plannedEnd ? fmtDate(a.plannedEnd) : "?"}` : "";
              })()}
            </div>
          </Card>
          <AuditRequestsPanel auditId={current} />
        </>
      )}
    </>
  );
}
