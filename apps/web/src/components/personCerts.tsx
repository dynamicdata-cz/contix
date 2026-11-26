import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { Combobox, type ComboOption } from "@/components/combobox";
import { askConfirm } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import { PERSON_CERT_KINDS, PERSON_CERT_STATES, type SupplierCertRequirement, type PersonCertDto, type PersonCertInput, type PersonCertKind, type PersonCertState } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

/* ============================================================
 * Certifikáty a osvědčení osob (v1.105, ADR-199) – seznam s filtrem platnosti, založení, soubor, započtení kurzu.
 * Používá se ve Školení (všechny osoby) a u dodavatele (jeho pracovníci).
 * ============================================================ */

const STATE_TONE: Record<PersonCertState, Tone> = { valid: "green", expiring: "amber", expired: "red", no_expiry: "slate" };

export function PersonCertsCard({ supplierId, title }: { supplierId?: string; title?: string }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const write = can("awareness:write");
  const [state, setState] = useState<PersonCertState | "">("");
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["personCerts", supplierId ?? "", state, q], queryFn: () => api.personCerts.list({ state: state || undefined, supplierId, q: q || undefined }) });
  const [edit, setEdit] = useState<PersonCertDto | "new" | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => api.personCerts.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["personCerts"] }) });
  const d = list.data;
  return (
    <Card className="overflow-hidden" data-testid="pc-card">
      <CardHeader
        title={title ?? t("pc.title")}
        subtitle={t("pc.sub")}
        action={
          write && (
            <Button onClick={() => setEdit("new")} data-testid="pc-new">
              <Plus size={15} /> {t("pc.new")}
            </Button>
          )
        }
      />
      {supplierId && <QualificationBox supplierId={supplierId} />}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        {(["", ...PERSON_CERT_STATES] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setState(s)}
            className={cn("rounded-full border px-3 py-1 text-xs", state === s ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
            data-testid={`pc-filter-${s || "all"}`}
          >
            {s ? t(`pc.state.${s}`) : t("pc.all")}
            {d && s ? ` (${d.counts[s]})` : ""}
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pc.search")} className="ml-auto w-56" />
      </div>
      <ErrorBox error={list.error ?? remove.error} />
      {!d?.items.length ? (
        <EmptyState>{list.isLoading ? t("common.loading") : t("pc.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="pc-table">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("pc.f.holder")}</th>
                <th className="px-3 py-2">{t("pc.f.name")}</th>
                <th className="px-3 py-2">{t("pc.f.issuer")}</th>
                <th className="px-3 py-2">{t("pc.f.validUntil")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.items.map((x) => (
                <tr key={x.id}>
                  <td className="px-5 py-2">
                    <div className="font-medium text-slate-900">{x.holder.name}</div>
                    <div className="text-xs text-slate-500">{[t(`pc.holder.${x.holder.type}`), x.supplier?.name, x.holder.detail].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{x.name}</div>
                    <div className="text-xs text-slate-500">
                      {t(`pc.kind.${x.kind}`)}
                      {x.credentialId ? ` · ${x.credentialId}` : ""}
                      {x.course ? ` · ${t("pc.countsFor", { course: x.course.title })}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{x.issuer}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATE_TONE[x.state]}>{x.validUntil ? fmtDay(x.validUntil) : t("pc.state.no_expiry")}</Badge>
                    {x.state === "expiring" && x.daysLeft !== null && <div className="mt-0.5 text-xs text-amber-700">{t("pc.daysLeft", { n: x.daysLeft })}</div>}
                    {x.state === "expired" && <div className="mt-0.5 text-xs text-red-700">{t("pc.state.expired")}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {x.file && (
                      <a href={api.personCerts.fileUrl(x.id)} className="mr-1 inline-flex rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={x.file.name} aria-label={t("pc.download", { name: x.file.name })}>
                        <Download size={15} />
                      </a>
                    )}
                    {write && (
                      <>
                        <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={() => setEdit(x)} aria-label={t("pc.edit")}>
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                          onClick={async () => (await askConfirm(t("pc.deleteConfirm", { name: x.name, holder: x.holder.name }))) && remove.mutate(x.id)}
                          aria-label={t("pc.delete")}
                        >
                          <Trash2 size={15} />
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
      {edit && <PersonCertModal cert={edit === "new" ? null : edit} supplierId={supplierId} onClose={() => setEdit(null)} />}
    </Card>
  );
}

type HolderMode = "user" | "person" | "external";

function PersonCertModal({ cert, supplierId, onClose }: { cert: PersonCertDto | null; supplierId?: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const holders = useQuery({ queryKey: ["personCerts", "holders"], queryFn: api.personCerts.holders });
  const courses = useQuery({ queryKey: ["awareness"], queryFn: api.awareness.list });
  const [mode, setMode] = useState<HolderMode>(cert?.holder.type ?? (supplierId ? "external" : "user"));
  const [f, setF] = useState({
    userId: cert?.holder.type === "user" ? cert.holder.id : null,
    personId: cert?.holder.type === "person" ? cert.holder.id : null,
    holderName: cert?.holder.type === "external" ? cert.holder.name : "",
    supplierId: cert?.supplier?.id ?? supplierId ?? null,
    name: cert?.name ?? "",
    kind: (cert?.kind ?? "certification") as PersonCertKind,
    issuer: cert?.issuer ?? "",
    credentialId: cert?.credentialId ?? "",
    issuedAt: cert?.issuedAt ?? "",
    validUntil: cert?.validUntil ?? "",
    courseId: cert?.course?.id ?? null,
    note: cert?.note ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const body: PersonCertInput = {
        userId: mode === "user" ? f.userId : null,
        personId: mode === "person" ? f.personId : null,
        holderName: mode === "external" ? f.holderName : null,
        supplierId: f.supplierId,
        name: f.name,
        kind: f.kind,
        issuer: f.issuer,
        credentialId: f.credentialId,
        issuedAt: f.issuedAt || null,
        validUntil: f.validUntil || null,
        courseId: mode === "user" ? f.courseId : null,
        note: f.note,
      };
      const r = cert ? await api.personCerts.update(cert.id, body) : await api.personCerts.create(body);
      return file ? api.personCerts.upload(r.id, file) : r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personCerts"] });
      qc.invalidateQueries({ queryKey: ["awareness"] });
      onClose();
    },
  });
  const h = holders.data;
  const userOpts: ComboOption[] = (h?.users ?? []).map((u) => ({ id: u.id, label: u.name, hint: u.email }));
  const personOpts: ComboOption[] = (h?.people ?? []).map((p) => ({ id: p.id, label: p.name, hint: [t(`pc.personKind.${p.kind}` as "pc.personKind.employee"), p.detail].filter(Boolean).join(" · ") }));
  const supplierOpts: ComboOption[] = (h?.suppliers ?? []).map((s) => ({ id: s.id, label: s.name }));
  const holderOk = mode === "user" ? !!f.userId : mode === "person" ? !!f.personId : !!f.holderName.trim();
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={cert ? t("pc.edit") : t("pc.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim() || !holderOk} data-testid="pc-save">
            {t("pc.save")}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t("pc.f.holder")}>
        {(["user", "person", "external"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn("rounded-lg border px-3 py-1.5 text-sm", mode === m ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600")}
            data-testid={`pc-mode-${m}`}
          >
            {t(`pc.holder.${m}`)}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "user" && (
          <Field label={t("pc.f.user")}>
            <Combobox value={f.userId} onChange={(v) => setF({ ...f, userId: v })} options={userOpts} placeholder={t("pc.searchPerson")} testId="pc-user" />
          </Field>
        )}
        {mode === "person" && (
          <Field label={t("pc.f.person")} hint={t("pc.f.personHint")}>
            <Combobox value={f.personId} onChange={(v) => setF({ ...f, personId: v })} options={personOpts} placeholder={t("pc.searchPerson")} testId="pc-person" />
          </Field>
        )}
        {mode === "external" && (
          <Field label={t("pc.f.holderName")}>
            <Input value={f.holderName} onChange={(e) => setF({ ...f, holderName: e.target.value })} data-testid="pc-holder-name" />
          </Field>
        )}
        <Field label={t("pc.f.supplier")} hint={t("pc.f.supplierHint")}>
          <Combobox value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} options={supplierOpts} emptyLabel={t("pc.noSupplier")} testId="pc-supplier" />
        </Field>
        <Field label={t("pc.f.name")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="CCNA, ISO 27001 Lead Auditor…" data-testid="pc-name" />
        </Field>
        <Field label={t("pc.f.kind")}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PersonCertKind })}>
            {PERSON_CERT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`pc.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("pc.f.issuer")}>
          <Input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="Cisco, PECB, dodavatel školení…" />
        </Field>
        <Field label={t("pc.f.credentialId")}>
          <Input value={f.credentialId} onChange={(e) => setF({ ...f, credentialId: e.target.value })} />
        </Field>
        <Field label={t("pc.f.issuedAt")}>
          <Input type="date" value={f.issuedAt} onChange={(e) => setF({ ...f, issuedAt: e.target.value })} data-testid="pc-issued" />
        </Field>
        <Field label={t("pc.f.validUntil")} hint={t("pc.f.validUntilHint")}>
          <Input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} data-testid="pc-valid" />
        </Field>
        {mode === "user" && (
          <Field label={t("pc.f.course")} hint={t("pc.f.courseHint")} className="sm:col-span-2">
            <Select value={f.courseId ?? ""} onChange={(e) => setF({ ...f, courseId: e.target.value || null })} data-testid="pc-course">
              <option value="">{t("pc.noCourse")}</option>
              {(courses.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} ` : ""}
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("pc.f.file")} hint={cert?.file ? t("pc.f.fileReplace", { name: cert.file.name }) : t("pc.f.fileHint")} className="sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <Paperclip size={15} className="text-slate-400" />
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="pc-file" />
          </label>
        </Field>
        <Field label={t("pc.f.note")} className="sm:col-span-2">
          <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** Požadovaná kvalifikace pracovníků dodavatele (v1.112, ADR-204). */
function QualificationBox({ supplierId }: { supplierId: string }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["personCerts", "qualification", supplierId], queryFn: () => api.personCerts.qualification(supplierId) });
  const [edit, setEdit] = useState<SupplierCertRequirement[] | null>(null);
  const save = useMutation({
    mutationFn: (items: SupplierCertRequirement[]) => api.personCerts.setQualification(supplierId, items),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personCerts"] });
      setEdit(null);
    },
  });
  const d = q.data;
  return (
    <div className="border-b border-slate-100 px-5 py-3 text-sm" data-testid="pc-qualification">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-800">{t("pc.req.title")}</span>
        {can("suppliers:write") && (
          <button type="button" className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => setEdit(d?.items.map(({ name, min }) => ({ name, min })) ?? [])} data-testid="pc-req-edit">
            {t("pc.req.edit")}
          </button>
        )}
      </div>
      {!d?.items.length ? (
        <p className="text-xs text-slate-500">{t("pc.req.none")}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {d.items.map((it) => (
            <li key={it.name} className="flex flex-wrap items-center gap-2">
              <Badge tone={it.ok ? "green" : "red"}>
                {it.ok
                  ? it.until
                    ? t("pc.req.okUntil", { have: it.holders.length, n: it.min, d: fmtDay(it.until) })
                    : t("pc.req.ok", { have: it.holders.length, n: it.min })
                  : t("pc.req.missing", { have: it.holders.length, n: it.min })}
              </Badge>
              <span className="text-slate-700">{it.name}</span>
              {it.holders.length > 0 && <span className="text-xs text-slate-500">({it.holders.join(", ")})</span>}
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={q.error} />
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={t("pc.req.title")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t("common.cancelAction")}
              </Button>
              <Button onClick={() => save.mutate(edit.filter((x) => x.name.trim().length >= 2))} disabled={save.isPending} data-testid="pc-req-save">
                {t("pc.req.save")}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-xs text-slate-500">{t("pc.req.sub")}</p>
          <div className="space-y-2">
            {edit.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  placeholder={t("pc.req.name")}
                  aria-label={t("pc.req.name")}
                  value={r.name}
                  maxLength={200}
                  onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  data-testid={`pc-req-name-${i}`}
                />
                <Input
                  type="number"
                  className="w-20"
                  min={1}
                  max={50}
                  aria-label={t("pc.req.min")}
                  title={t("pc.req.min")}
                  value={r.min}
                  onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, min: Math.min(50, Math.max(1, Number(e.target.value) || 1)) } : x)))}
                />
                <button type="button" className="text-slate-400 hover:text-red-700" aria-label={t("common.delete")} onClick={() => setEdit(edit.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          {edit.length < 20 && (
            <Button variant="secondary" className="mt-3" onClick={() => setEdit([...edit, { name: "", min: 1 }])} data-testid="pc-req-add">
              <Plus size={15} /> {t("pc.req.add")}
            </Button>
          )}
          <ErrorBox error={save.error} />
        </Modal>
      )}
    </div>
  );
}
