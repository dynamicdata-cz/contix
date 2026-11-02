import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { CompanyCell, useGroupView } from "@/components/company";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import {
  DEFAULT_RETENTION,
  DISPOSAL_MODES,
  POLICY_LABELS,
  POLICY_TYPES,
  RETENTION_MARKS,
  TEMPLATE_PLACEHOLDERS,
  type DisposalMode,
  type PolicyDetail,
  type PolicyFolderDto,
  type PolicyType,
  type RetentionMark,
  type RetentionState,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, Download, Folder, FolderOpen, FolderPlus, Pencil, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

/* ============================================================
 * DMS II: strom složek, šablony Wordu, skartační lhůty (v0.23)
 * ============================================================ */

export const ALL = "__all";
export const NONE = "__none";

/** Navigace ve složkách dokumentace (vlevo vedle seznamu). */
export function FolderTree({ value, onChange, counts }: { value: string; onChange: (id: string) => void; counts: { all: number; none: number } }) {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const folders = useQuery({ queryKey: ["policies", "folders"], queryFn: api.policies.folders });
  const [edit, setEdit] = useState<PolicyFolderDto | "new" | null>(null);
  const item = (id: string, label: string, n: number, depth = 0, open = false) => (
    <button
      key={id}
      onClick={() => onChange(id)}
      className={cn("flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-slate-100", value === id && "bg-brand-50 font-medium text-brand-700")}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {id === ALL || id === NONE ? null : open ? <FolderOpen size={14} className="shrink-0 text-slate-400" /> : <Folder size={14} className="shrink-0 text-slate-400" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums text-slate-400">{n}</span>
    </button>
  );
  const current = (folders.data ?? []).find((f) => f.id === value);
  return (
    <Card className="self-start p-2">
      <div className="mb-1 flex items-center justify-between px-2 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("pol.slozky")}</span>
        {can("policies:write") && !group && (
          <span className="flex gap-1">
            {current && (
              <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700" title={t("pol.upravitSlozku")} onClick={() => setEdit(current)}>
                <Pencil size={13} />
              </button>
            )}
            <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700" title={t("pol.novaSlozka")} onClick={() => setEdit("new")}>
              <FolderPlus size={14} />
            </button>
          </span>
        )}
      </div>
      {item(ALL, t("pol.vsechnyDokumenty"), counts.all)}
      {(folders.data ?? []).map((f) => item(f.id, f.name, f.documents, f.depth, value === f.id))}
      {counts.none > 0 && item(NONE, t("pol.nezarazene"), counts.none)}
      <ErrorBox error={folders.error} />
      {edit && <FolderModal folder={edit === "new" ? null : edit} parentId={edit === "new" && current ? current.id : null} folders={folders.data ?? []} onClose={() => setEdit(null)} onDeleted={() => onChange(ALL)} />}
    </Card>
  );
}

function FolderModal({ folder, parentId, folders, onClose, onDeleted }: { folder: PolicyFolderDto | null; parentId: string | null; folders: (PolicyFolderDto & { depth?: number })[]; onClose: () => void; onDeleted: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: folder?.name ?? "", parentId: folder?.parentId ?? parentId, codePrefix: folder?.codePrefix ?? "", position: folder?.position ?? 0 });
  const done = (list: PolicyFolderDto[]) => {
    qc.setQueryData(["policies", "folders"], list);
    qc.invalidateQueries({ queryKey: ["policies"] });
    onClose();
  };
  const body = { name: f.name, parentId: f.parentId, codePrefix: f.codePrefix.trim().toUpperCase() || null, position: f.position };
  const save = useMutation({ mutationFn: () => (folder ? api.policies.updateFolder(folder.id, body) : api.policies.createFolder(body)), onSuccess: done });
  const del = useMutation({
    mutationFn: () => api.policies.deleteFolder(folder!.id),
    onSuccess: (l) => {
      done(l);
      onDeleted();
    },
  });
  // složka nemůže být pod sebou ani pod vlastní podsložkou
  const blocked = new Set<string>();
  if (folder) {
    blocked.add(folder.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of folders)
        if (x.parentId && blocked.has(x.parentId) && !blocked.has(x.id)) {
          blocked.add(x.id);
          grew = true;
        }
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={folder ? t("pol.upravitSlozku") : t("pol.novaSlozka")}
      footer={
        <>
          {folder && (
            <Button variant="danger" className="mr-auto" disabled={del.isPending} onClick={async () => (await askConfirm(t("pol.smazatSlozkuMusiBytPrazdna"))) && del.mutate()}>
              <Trash2 size={15} />
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
            {t("pol.ulozit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("pol.nazev")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("pol.naprSmerniceIsms")} />
        </Field>
        <Field label={t("pol.nadrazenaSlozka")}>
          <Select value={f.parentId ?? ""} onChange={(e) => setF({ ...f, parentId: e.target.value || null })}>
            <option value="">{t("pol.koren")}</option>
            {folders
              .filter((x) => !blocked.has(x.id))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.path}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("pol.prefixOznaceni")} hint={t("pol.noveDokumentyVeSlozceI")}>
            <Input value={f.codePrefix} onChange={(e) => setF({ ...f, codePrefix: e.target.value.toUpperCase() })} placeholder={t("pol.smIsms")} />
          </Field>
          <Field label={t("pol.poradi")}>
            <Input type="number" min={0} max={1000} value={f.position} onChange={(e) => setF({ ...f, position: Number(e.target.value) || 0 })} />
          </Field>
        </div>
        <ErrorBox error={save.error ?? del.error} />
      </div>
    </Modal>
  );
}

/** Výběr složky ve formuláři dokumentu. */
export function FolderSelect({ value, onChange, companyId, disabled }: { value: string | null; onChange: (v: string | null) => void; companyId?: string; disabled?: boolean }) {
  const t = useT();
  const folders = useQuery({ queryKey: ["policies", "folders"], queryFn: api.policies.folders });
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
      <option value="">{t("pol.nezarazeno")}</option>
      {(folders.data ?? [])
        .filter((f) => !companyId || f.companyId === companyId)
        .map((f) => (
          <option key={f.id} value={f.id}>
            {f.path}
            {f.codePrefix ? ` (${f.codePrefix})` : ""}
          </option>
        ))}
    </Select>
  );
}

/** Šablony Wordu pro nové dokumenty. */
export function TemplatesTab() {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["policies", "templates"], queryFn: api.policies.templates });
  const input = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<{ file: File | null; name: string; docType: string }>({ file: null, name: "", docType: "" });
  const done = (l: Awaited<ReturnType<typeof api.policies.templates>>) => {
    qc.setQueryData(["policies", "templates"], l);
    setF({ file: null, name: "", docType: "" });
  };
  const up = useMutation({ mutationFn: () => api.policies.uploadTemplate(f.file!, f.name, f.docType || null), onSuccess: done });
  const del = useMutation({ mutationFn: (id: string) => api.policies.deleteTemplate(id), onSuccess: done });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card className="overflow-hidden">
        <CardHeader title={t("pol.sablonyDokumentu")} subtitle={t("pol.gestorVytvoriSouborNoveVerze")} />
        <ErrorBox error={list.error ?? del.error} />
        {(list.data ?? []).length === 0 ? (
          <EmptyState>{t("pol.zatimZadneSablonyNahrajteSablonu")}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {(list.data ?? []).map((tx) => (
              <li key={tx.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <a href={api.policies.templateUrl(tx.id)} className="font-medium text-brand-700 hover:underline">
                  {tx.name}
                </a>
                <span className="text-xs text-slate-500">{tx.filename}</span>
                {tx.docType ? <Badge tone="blue">{t.lbl(POLICY_LABELS.type[tx.docType])}</Badge> : <Badge>{t("pol.vsechnyDruhy")}</Badge>}
                {group && <CompanyCell id={tx.companyId} />}
                <span className="ml-auto text-xs text-slate-400">
                  {fmtDay(tx.uploadedAt)} · {tx.uploadedByName ?? "?"}
                </span>
                {can("policies:write") && (
                  <button className="text-slate-400 hover:text-red-600" title={t("pol.smazatSablonu")} onClick={async () => (await askConfirm(t("pol.smazatSablonu2", { name: tx.name }))) && del.mutate(tx.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {can("policies:write") && !group && (
          <div className="space-y-3 border-t border-slate-100 p-5">
            <input
              ref={input}
              type="file"
              accept=".docx,.dotx,.odt,.xlsx,.pptx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setF((x) => ({ ...x, file, name: x.name || (file?.name.replace(/\.\w+$/, "") ?? "") }));
                e.target.value = "";
              }}
            />
            <div className="grid gap-3 sm:grid-cols-[auto_1fr_14rem_auto] sm:items-end">
              <Button variant="secondary" onClick={() => input.current?.click()}>
                <Upload size={15} /> {f.file ? f.file.name : t("pol.vybratSoubor")}
              </Button>
              <Field label={t("pol.nazevSablony")}>
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field label={t("pol.proDruhDokumentu")}>
                <Select value={f.docType} onChange={(e) => setF({ ...f, docType: e.target.value })}>
                  <option value="">{t("pol.vsechnyDruhy")}</option>
                  {POLICY_TYPES.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(POLICY_LABELS.type[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button disabled={!f.file || !f.name.trim() || up.isPending} onClick={() => up.mutate()}>
                {t("pol.nahrat")}
              </Button>
            </div>
            <ErrorBox error={up.error} />
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title={t("pol.znackyVSablone")} subtitle={t("pol.napisteJeDoTextuZahlavi")} />
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {Object.entries(TEMPLATE_PLACEHOLDERS).map(([k, l]) => (
              <tr key={k}>
                <td className="px-5 py-1.5 font-mono text-xs text-brand-700">{`{{${k}}}`}</td>
                <td className="px-3 py-1.5 text-slate-600">{l}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

const retentionTone: Record<RetentionState, Tone> = { active: "slate", running: "blue", due: "amber", disposed: "green" };
export const retentionLabel: Record<RetentionState, string> = { active: "Platný / v přípravě", running: "Lhůta běží", due: "Lhůta uplynula", disposed: "Vyřazeno" };

/** Přehled zrušených dokumentů a skartačních lhůt. */
export function RetentionTab() {
  const t = useT();
  const group = useGroupView();
  const list = useQuery({ queryKey: ["policies", "retention"], queryFn: api.policies.retention });
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={t("pol.skartacniLhuty")}
        subtitle={t("pol.lhutaBeziOd1Ledna")}
      />
      <ErrorBox error={list.error} />
      {(list.data ?? []).length === 0 ? (
        <EmptyState>{list.isLoading ? t("common.loading") : t("pol.zadneZruseneDokumenty")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("pol.dokument")}</th>
              <th className="px-3 py-2">{t("pol.znakLhuta")}</th>
              <th className="px-3 py-2">{t("pol.zrusen")}</th>
              <th className="px-3 py-2">{t("pol.lhutaUplyne")}</th>
              <th className="px-3 py-2">{t("pol.obsah")}</th>
              <th className="px-3 py-2">{t("pol.stav")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(list.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2.5">
                  <Link to="/policies/$policyId" params={{ policyId: r.id }} className="font-medium hover:text-brand-700">
                    {r.code && <span className="mr-1.5 text-slate-500">{r.code}</span>}
                    {r.title}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {t.lbl(POLICY_LABELS.type[r.docType])}
                    {r.folderPath && ` · ${r.folderPath}`}
                  </div>
                  {group && <CompanyCell id={r.companyId} />}
                </td>
                <td className="px-3 py-2.5 text-slate-700">
                  {t("pol.let", { mark: r.retention.mark, years: r.retention.years })}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{r.retention.retiredAt ? fmtDay(r.retention.retiredAt) : "—"}</td>
                <td className={cn("px-3 py-2.5", r.retention.state === "due" ? "font-medium text-amber-800" : "text-slate-600")}>{r.retention.dueAt ? fmtDay(r.retention.dueAt) : "—"}</td>
                <td className="px-3 py-2.5 text-xs text-slate-500">
                  {r.disposal ? "—" : t("pol.verziSouboru", { versions: r.versions, files: r.files })}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={retentionTone[r.retention.state]}>{r.disposal ? t.lbl(POLICY_LABELS.disposalMode[r.disposal.mode]) : t.lbl(retentionLabel[r.retention.state])}</Badge>
                  {r.disposal && (
                    <div className="mt-0.5 text-xs text-slate-500">
                      {fmtDay(r.disposal.at)}
                      {r.disposal.reference && ` · ${r.disposal.reference}`}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Skartační režim dokumentu – pole formuláře. */
export function RetentionFields({
  docType,
  years,
  mark,
  onChange,
  disabled,
}: {
  docType: PolicyType;
  years: number | null;
  mark: RetentionMark | null;
  onChange: (v: { retentionYears: number | null; retentionMark: RetentionMark | null }) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const def = DEFAULT_RETENTION[docType];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("pol.skartacniZnak")} hint={t("pol.vychoziPro", { p: POLICY_LABELS.type[docType].toLowerCase(), mark: def.mark })}>
        <Select value={mark ?? ""} disabled={disabled} onChange={(e) => onChange({ retentionYears: years, retentionMark: (e.target.value || null) as RetentionMark | null })}>
          <option value="">{t("pol.vychozi", { mark: def.mark })}</option>
          {RETENTION_MARKS.map((m) => (
            <option key={m} value={m}>
              {t.lbl(POLICY_LABELS.retentionMark[m])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("pol.skartacniLhutaRoky")} hint={t("pol.vychoziLetOdRokuZruseni", { years: def.years })}>
        <Input type="number" min={1} max={100} placeholder={String(def.years)} value={years ?? ""} disabled={disabled} onChange={(e) => onChange({ retentionYears: e.target.value ? Number(e.target.value) : null, retentionMark: mark })} />
      </Field>
    </div>
  );
}

/** Karta skartace v detailu zrušeného dokumentu. */
export function DisposalCard({ p, onDone }: { p: PolicyDetail; onDone: (d: PolicyDetail) => void }) {
  const t = useT();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const r = p.retention;
  if (r.state === "active") return null;
  return (
    <Card className="mt-6">
      <CardHeader
        title={t("pol.skartaceAArchivace")}
        subtitle={t("pol.skartacniZnakLhutaLet", { p: t.lbl(POLICY_LABELS.retentionMark[r.mark]), years: r.years })}
        action={
          <div className="flex gap-2">
            {!p.disposal && (
              <a href={api.policies.packageUrl(p.id)}>
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs">
                  <Download size={14} /> {t("pol.balicekZip")}
                </Button>
              </a>
            )}
            {can("policies:write") && r.state === "due" && (
              <Button className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(true)}>
                <Archive size={14} /> {r.mark === "A" ? t("pol.predatDoArchivu") : t("pol.skartovatPredat")}
              </Button>
            )}
          </div>
        }
      />
      <div className="p-5 text-sm">
        {p.disposal ? (
          <p>
            <Badge tone="green">{t.lbl(POLICY_LABELS.disposalMode[p.disposal.mode])}</Badge> {fmtDay(p.disposal.at)} · {p.disposal.byName ?? "?"}
            {p.disposal.reference && ` · protokol ${p.disposal.reference}`}
            {p.disposal.note && <span className="mt-1 block text-slate-600">{p.disposal.note}</span>}
            <span className="mt-1 block text-xs text-slate-500">{t("pol.souboryATextyVerziByly")}</span>
          </p>
        ) : (
          <p className="text-slate-700">
            {t("pol.zrusen")} {r.retiredAt ? fmtDay(r.retiredAt) : "—"} {t("pol.lhuta")} {r.state === "due" ? t("pol.uplynula") : t("pol.uplyne")} {r.dueAt ? fmtDay(r.dueAt) : "—"}.
            {r.state === "running" && t("pol.doTeDobySeDokument")}
          </p>
        )}
      </div>
      {open && <DisposeModal p={p} onClose={() => setOpen(false)} onDone={onDone} />}
    </Card>
  );
}

function DisposeModal({ p, onClose, onDone }: { p: PolicyDetail; onClose: () => void; onDone: (d: PolicyDetail) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const modes = DISPOSAL_MODES.filter((m) => !(m === "shredded" && p.retention.mark === "A"));
  const [f, setF] = useState<{ mode: DisposalMode; reference: string; note: string }>({ mode: modes.includes("shredded") && p.retention.mark === "S" ? "shredded" : "archived", reference: "", note: "" });
  const m = useMutation({
    mutationFn: () => api.policies.dispose(p.id, { mode: f.mode, reference: f.reference || null, note: f.note || null }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["policies"] });
      onDone(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("pol.vyradit", { p: p.code ?? "", title: p.title })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button variant="danger" disabled={m.isPending} onClick={async () => (await askConfirm(t("pol.souboryATextyVsechVerzi"))) && m.mutate()}>
            {t("pol.vyraditAOdstranitObsah")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("pol.predVyrazenimSiStahnete")} <a href={api.policies.packageUrl(p.id)} className="font-medium underline">{t("pol.balicekDokumentu")}</a> {t("pol.vsechnyVerzeSouboryAHistorie")}
        </p>
        <Field label={t("pol.zpusob")}>
          <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as DisposalMode })}>
            {modes.map((x) => (
              <option key={x} value={x}>
                {t.lbl(POLICY_LABELS.disposalMode[x])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("pol.cisloProtokolu")} hint={t("pol.skartacniProtokolPredavaciProtokolArchiv")}>
          <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
        <Field label={t("pol.poznamka")}>
          <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}
