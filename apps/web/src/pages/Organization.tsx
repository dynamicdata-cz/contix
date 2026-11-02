import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { flattenUnits, UnitSelect, useOrg } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe } from "@/lib/auth";
import { cn, plural } from "@/lib/utils";
import { ORG_LABELS, ORG_UNIT_TYPES, SECURITY_ROLES, type OrgUnitDto, type OrgUnitType, type PositionDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, ChevronRight, Crown, Network, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";

type UnitForm = { id?: string; companyId: string; parentId: string | null; name: string; code: string; unitType: OrgUnitType; description: string };
type PosForm = { id?: string; orgUnitId: string; name: string; code: string; description: string; isManager: boolean; securityRoles: string[]; holderIds: string[] };

export function OrganizationPage() {
  const t = useT();
  const can = useCan();
  const edit = can("org:write");
  const qc = useQueryClient();
  const org = useOrg();
  const units = org.data ?? [];
  const me = useMe();
  const flat = useMemo(() => flattenUnits(units), [units]);
  /** Společnosti v organizaci: aktivní (nebo všechny ve skupinovém pohledu) + nadřazené holdingy, jejichž útvary jsou sdílené. */
  const companies = useMemo(() => {
    const scope = me.activeCompanyId ? [me.activeCompanyId] : me.companies.map((c) => c.id);
    const ids = [...new Set([...units.filter((u) => u.shared).map((u) => u.companyId), ...scope])];
    const info = (id: string) => {
      const c = me.companies.find((x) => x.id === id);
      const u = units.find((x) => x.companyId === id);
      return { id, name: c?.name ?? u?.companyName ?? "?", kind: (c?.kind ?? u?.companyKind ?? "company") as "holding" | "company", regime: c?.regime ?? null, depth: c?.depth ?? 0, shared: !scope.includes(id) };
    };
    return ids.map(info).sort((a, b) => Number(b.shared) - Number(a.shared) || a.depth - b.depth);
  }, [me, units]);
  const [selected, setSelected] = useState<string | null>(null);
  const selCompany = selected?.startsWith("co:") ? selected.slice(3) : null;
  const current = selCompany ? null : (units.find((u) => u.id === selected) ?? null);
  const company = companies.find((c) => c.id === (selCompany ?? current?.companyId ?? companies.find((x) => !x.shared)?.id ?? companies[0]?.id)) ?? null;
  const showCompany = !current && company;
  const canEditUnit = (u: { shared: boolean }) => edit && !u.shared;
  const [unitForm, setUnitForm] = useState<UnitForm | null>(null);
  const [posForm, setPosForm] = useState<PosForm | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const done = () => {
    qc.invalidateQueries({ queryKey: ["org"] });
    setErr(null);
  };
  const saveUnit = useMutation({
    mutationFn: async (f: UnitForm) => {
      const body = { parentId: f.parentId, name: f.name, code: f.code || null, unitType: f.unitType, description: f.description || null };
      return f.id ? api.org.updateUnit(f.id, body) : api.org.createUnit({ ...body, companyId: f.companyId });
    },
    onSuccess: (r: any) => {
      done();
      setUnitForm(null);
      if (r?.id) setSelected(r.id);
    },
  });
  const delUnit = useMutation({ mutationFn: api.org.deleteUnit, onSuccess: () => (done(), setSelected(company ? `co:${company.id}` : null)), onError: setErr });
  const savePos = useMutation({
    mutationFn: async (f: PosForm) => {
      const body = { orgUnitId: f.orgUnitId, name: f.name, code: f.code || null, description: f.description || null, isManager: f.isManager, securityRoles: f.securityRoles, holderIds: f.holderIds };
      return f.id ? api.org.updatePosition(f.id, body) : api.org.createPosition(body);
    },
    onSuccess: () => (done(), setPosForm(null)),
  });
  const delPos = useMutation({ mutationFn: api.org.deletePosition, onSuccess: done, onError: setErr });

  const children = (id: string) => units.filter((u) => u.parentId === id);
  const path = (u: OrgUnitDto) => {
    const out: { name: string }[] = [];
    let cur: OrgUnitDto | undefined = u;
    while (cur) {
      out.unshift(cur);
      cur = units.find((x) => x.id === cur!.parentId);
    }
    return [{ name: u.companyName }, ...out];
  };
  const newRootUnit = (companyId: string) =>
    setUnitForm({ companyId, parentId: null, name: "", code: "", unitType: units.some((u) => u.companyId === companyId) ? "department" : "section", description: "" });
  const totalPositions = units.reduce((s, u) => s + u.positions.length, 0);
  const vacant = units.reduce((s, u) => s + u.positions.filter((p) => !p.holders.length).length, 0);

  return (
    <>
      <PageHeader
        title={t("org.organizace")}
        subtitle={`${t("doc.utvaruN", { n: units.length })} · ${t("doc.funkcnichMistN", { n: totalPositions })}${vacant ? ` · ${t("org.neobsazenoN", { n: vacant })}` : ""}`}
        actions={
          edit &&
          company &&
          !company.shared && (
            <Button onClick={() => newRootUnit(company.id)}>
              <Plus size={16} /> {t("org.novyUtvar")}{company.name})
            </Button>
          )
        }
      />
      <ErrorBox error={org.error ?? err} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="self-start">
            <CardHeader title={t("org.struktura")} subtitle={t("org.spolecnostiZAdministraceSpolecnostiA")} />
            <ul className="p-2">
              {companies.map((co) => (
                <li key={co.id}>
                  <button
                    onClick={() => setSelected(`co:${co.id}`)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold hover:bg-slate-50",
                      showCompany && company?.id === co.id && "bg-brand-50 text-brand-700",
                    )}
                  >
                    {co.kind === "holding" ? <Network size={14} className="text-brand-600" /> : <Building2 size={14} className="text-slate-500" />}
                    <span className="flex-1 truncate">{co.name}</span>
                    {co.shared && <span className="text-[10px] font-normal uppercase tracking-wide text-slate-400">{t("org.sdileno")}</span>}
                  </button>
                  <ul>
                    {flat
                      .filter(({ unit }) => unit.companyId === co.id)
                      .map(({ unit, depth }) => (
                        <li key={unit.id}>
                          <button
                            onClick={() => setSelected(unit.id)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-slate-50",
                              current?.id === unit.id && "bg-brand-50 font-medium text-brand-700",
                              unit.shared && "text-slate-500",
                            )}
                            style={{ paddingLeft: 24 + depth * 16 }}
                          >
                            <ChevronRight size={14} className="text-slate-300" />
                            <span className="flex-1 truncate">{unit.name}</span>
                            {unit.positions.length > 0 && <span className="text-xs text-slate-400">{unit.positions.length}</span>}
                          </button>
                        </li>
                      ))}
                    {!units.some((u) => u.companyId === co.id) && <li className="py-1 pl-8 text-xs text-slate-400">{t("org.bezUtvaru")}</li>}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>

          {showCompany && company && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div>
                  <div className="mb-1 text-xs text-slate-500">{company.kind === "holding" ? "Holding" : t("org.spolecnost")}</div>
                  <h2 className="text-lg font-semibold">{company.name}</h2>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {company.regime && <Badge tone="blue">{company.regime === "higher" ? t("org.vyssiPovinnostiVyhl409") : company.regime === "lower" ? t("org.nizsiPovinnostiVyhl410") : t("org.neregulovana")}</Badge>}
                    {company.shared && <Badge>{t("org.utvarySdileneZHoldinguJen")}</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {t("org.nazevIcoRezimAPostaveni")}{" "}
                    {can("admin:settings") ? (
                      <Link to="/admin/companies" className="text-brand-700 hover:underline">
                        {t("org.administraciSpolecnosti")}
                      </Link>
                    ) : (
                      t("org.administraciSpolecnosti")
                    )}
                    {t("org.organizacniStrukturaNavazujePrimoNa")}
                  </p>
                </div>
                {edit && !company.shared && (
                  <Button variant="secondary" onClick={() => newRootUnit(company.id)}>
                    <Plus size={15} /> {t("org.utvar2")}
                  </Button>
                )}
              </div>
              <div className="border-t border-slate-100 px-5 py-3 text-sm">
                {units.filter((u) => u.companyId === company.id && !u.parentId).length === 0 ? (
                  <span className="text-slate-500">{t("org.spolecnostZatimNemaUtvaryPridejte")}</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <span className="text-slate-500">{t("org.utvaryNejvyssiUrovne")}</span>
                    {units
                      .filter((u) => u.companyId === company.id && !u.parentId)
                      .map((u) => (
                        <button key={u.id} className="text-brand-600 hover:underline" onClick={() => setSelected(u.id)}>
                          {u.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {current && (
            <div className="space-y-6">
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                  <div>
                    <div className="mb-1 text-xs text-slate-500">
                      {path(current)
                        .slice(0, -1)
                        .map((p) => p.name)
                        .join(" › ")}
                    </div>
                    <h2 className="text-lg font-semibold">
                      {current.name} {current.code && <span className="text-sm font-normal text-slate-500">({current.code})</span>}
                    </h2>
                    <div className="mt-1 flex gap-2">
                      <Badge tone="violet">{t.lbl(ORG_LABELS.unitType[current.unitType])}</Badge>
                      {current.shared && <Badge>{t("org.sdilenoZHoldingu")}</Badge>}
                    </div>
                    {current.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{current.description}</p>}
                    {current.unitType === "organization" && !current.parentId && canEditUnit(current) && (
                      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {t("org.tentoUtvarTypuOrganizaceZdvojuje", { companyName: current.companyName })}
                      </p>
                    )}
                  </div>
                  {canEditUnit(current) && (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setUnitForm({ companyId: current.companyId, parentId: current.id, name: "", code: "", unitType: "department", description: "" })}>
                        <Plus size={15} /> {t("org.podrizenyUtvar")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setUnitForm({ id: current.id, companyId: current.companyId, parentId: current.parentId, name: current.name, code: current.code ?? "", unitType: current.unitType, description: current.description ?? "" })
                        }
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button variant="danger" onClick={async () => (await askConfirm(t("org.smazatUtvarVcetneJehoFunkcnich", { name: current.name }))) && delUnit.mutate(current.id)}>
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  )}
                </div>
                {children(current.id).length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3 text-sm">
                    <span className="text-slate-500">{t("org.podrizeneUtvary")}</span>
                    {children(current.id).map((c) => (
                      <button key={c.id} className="text-brand-600 hover:underline" onClick={() => setSelected(c.id)}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader
                  title={t("org.funkcniMista2")}
                  subtitle={t("org.vazbyProcesuRizikARaci")}
                  action={
                    canEditUnit(current) && (
                      <Button
                        variant="secondary"
                        className="whitespace-nowrap"
                        onClick={() => setPosForm({ orgUnitId: current.id, name: "", code: "", description: "", isManager: false, securityRoles: [], holderIds: [] })}
                      >
                        <Plus size={15} /> {t("org.funkcniMisto2")}
                      </Button>
                    )
                  }
                />
                {current.positions.length === 0 ? (
                  <EmptyState>{t("org.utvarZatimNemaFunkcniMista")}</EmptyState>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-2">{t("org.funkcniMisto2")}</th>
                        <th className="px-3 py-2">{t("org.obsazeni")}</th>
                        <th className="px-3 py-2">{t("org.bezpecnostniRole")}</th>
                        <th className="w-32" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {current.positions.map((p) => (
                        <tr key={p.id}>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-1.5 font-medium">
                              {p.isManager && <Crown size={14} className="text-amber-600" aria-label={t("org.vedouci")} />}
                              {p.name}
                              {p.code && <span className="text-xs font-normal text-slate-500">{p.code}</span>}
                            </div>
                            {p.description && <div className="text-xs text-slate-500">{p.description}</div>}
                          </td>
                          <td className="px-3 py-2.5">
                            {p.holders.length ? p.holders.map((h) => <div key={h.id}>{h.displayName}</div>) : <Badge tone="amber">{t("common.vacant")}</Badge>}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {p.securityRoles.map((r) => (
                                <Badge key={r} tone="blue">
                                  {t.lbl(r)}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex justify-end gap-1">
                              <Link to="/organization/positions/$positionId" params={{ positionId: p.id }} className="inline-flex items-center rounded-lg px-2 py-2 text-slate-600 hover:bg-slate-100" title={t("org.kdeJePouzito")} aria-label={t("org.kdeJePouzito")}>
                                <Users size={15} />
                              </Link>
                              {canEditUnit(current) && (
                                <>
                                  <Button
                                    variant="ghost"
                                    className="px-2"
                                    onClick={() =>
                                      setPosForm({
                                        id: p.id,
                                        orgUnitId: p.orgUnitId,
                                        name: p.name,
                                        code: p.code ?? "",
                                        description: p.description ?? "",
                                        isManager: p.isManager,
                                        securityRoles: p.securityRoles,
                                        holderIds: p.holders.map((h) => h.id),
                                      })
                                    }
                                  >
                                    <Pencil size={15} />
                                  </Button>
                                  <Button variant="ghost" className="px-2 text-red-600" onClick={async () => (await askConfirm(t("org.smazatFunkcniMisto", { name: p.name }))) && delPos.mutate(p.id)}>
                                    <Trash2 size={15} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          )}
      </div>

      {unitForm && <UnitModal form={unitForm} setForm={setUnitForm} save={saveUnit} />}
      {posForm && <PositionModal form={posForm} setForm={setPosForm} save={savePos} />}
    </>
  );
}

function UnitModal({ form, setForm, save }: { form: UnitForm; setForm: (f: UnitForm | null) => void; save: { mutate: (f: UnitForm) => void; isPending: boolean; error: unknown } }) {
  const t = useT();
  return (
    <Modal
      open
      onClose={() => setForm(null)}
      title={form.id ? t("org.upravitUtvar") : t("org.novyUtvar2")}
      footer={
        <>
          <Button variant="secondary" onClick={() => setForm(null)}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate(form)}>
            {t("org.ulozit")}
          </Button>
        </>
      }
    >
      <ErrorBox error={save.error} />
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label={t("org.nazev")}>
          <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t("org.zkratkaKod")}>
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("org.typUtvaru")}>
          <Select value={form.unitType} onChange={(e) => setForm({ ...form, unitType: e.target.value as OrgUnitType })}>
            {ORG_UNIT_TYPES.map((tx) => (
              <option key={tx} value={tx}>
                {t.lbl(ORG_LABELS.unitType[tx])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("org.nadrizenyUtvar")}>
          <UnitSelect value={form.parentId} exclude={form.id} companyId={form.companyId} onChange={(v) => setForm({ ...form, parentId: v })} emptyLabel={t("org.nejvyssiUrovenSpolecnosti")} />
        </Field>
      </div>
      <Field label={t("org.popisPusobnost")}>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
    </Modal>
  );
}

function PositionModal({
  form,
  setForm,
  save,
}: {
  form: PosForm;
  setForm: (f: PosForm | null) => void;
  save: { mutate: (f: PosForm) => void; isPending: boolean; error: unknown };
}) {
  const t = useT();
  const users = useQuery({ queryKey: ["directory"], queryFn: api.directory.users });
  const [custom, setCustom] = useState("");
  const allRoles = [...new Set([...SECURITY_ROLES, ...form.securityRoles])];
  return (
    <Modal
      open
      wide
      onClose={() => setForm(null)}
      title={form.id ? t("org.upravitFunkcniMisto") : t("org.noveFunkcniMisto")}
      footer={
        <>
          <Button variant="secondary" onClick={() => setForm(null)}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate(form)}>
            {t("org.ulozit")}
          </Button>
        </>
      }
    >
      <ErrorBox error={save.error} />
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label={t("org.nazevFunkcnihoMista")}>
          <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("org.naprVedouciOddeleniProvozuIct")} />
        </Field>
        <Field label={t("org.kod")}>
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("org.utvar2")}>
          <UnitSelect value={form.orgUnitId} onChange={(v) => v && setForm({ ...form, orgUnitId: v })} />
        </Field>
        <div className="pt-7">
          <Checkbox checked={form.isManager} onChange={(v) => setForm({ ...form, isManager: v })} label={t("org.vedouciUtvaru")} />
        </div>
      </div>
      <Field label={t("org.popisNapln")}>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">{t("org.bezpecnostniRoleDleZkb")}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {allRoles.map((r) => (
            <Checkbox key={r} checked={form.securityRoles.includes(r)} onChange={(v) => setForm({ ...form, securityRoles: toggle(form.securityRoles, r, v) })} label={t.lbl(r)} />
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input placeholder={t("org.jinaRole")} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button
            variant="secondary"
            disabled={!custom.trim()}
            onClick={() => {
              setForm({ ...form, securityRoles: toggle(form.securityRoles, custom.trim(), true) });
              setCustom("");
            }}
          >
            {t("org.pridat")}
          </Button>
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">{t("org.obsazeniUzivateleContix")}</div>
        <div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border border-slate-200 p-3 sm:grid-cols-2">
          {users.data?.map((u) => (
            <Checkbox
              key={u.id}
              checked={form.holderIds.includes(u.id)}
              onChange={(v) => setForm({ ...form, holderIds: toggle(form.holderIds, u.id, v) })}
              label={u.displayName}
              hint={u.jobTitle ?? u.email}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("org.mistoMuzeBytDocasneNeobsazene")}</p>
      </div>
    </Modal>
  );
}

const Section = ({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) => (
  <div>
    <div className="mb-1 text-sm font-medium text-slate-700">{title}</div>
    <div className="space-y-1 text-sm">{empty ? <span className="text-slate-400">—</span> : children}</div>
  </div>
);
