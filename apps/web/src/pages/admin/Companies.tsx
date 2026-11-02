import { askConfirm } from "@/components/ui/overlay";
import { AresLookup } from "@/components/ares";
import { CisIgSelect, FrameworkPicker, FrameworkScope } from "@/components/frameworkScope";
import { ProfilePicker } from "@/components/profilePicker";
import { useT } from "@/lib/i18n";
import { Soc2Scope } from "./Settings";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { RiskMethodologySelect } from "@/components/methodology";
import { api } from "@/lib/api";
import { useCan, useRefreshMe } from "@/lib/auth";
import { FRAMEWORKS, profileOf, BUILTIN_RISK_METHODOLOGY, type RiskPolicy, COMPANY_KIND_LABELS, COMPANY_KINDS, ROOT_COMPANY_ID, type OptionalFramework, type CompanyDto, type CompanyInput, type CompanyKind } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Network, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const REGIMES = { higher: "Vyšší povinnosti (vyhl. 409)", lower: "Nižší povinnosti (vyhl. 410)", none: "Neregulovaná" } as const;

export function AdminCompaniesPage() {
  const t = useT();
  const list = useQuery({ queryKey: ["companies"], queryFn: api.companies.list });
  const [editing, setEditing] = useState<CompanyDto | "new" | null>(null);
  const rows = list.data ?? [];
  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          title={t("usr.spolecnostiSkupiny")}
          subtitle={t("usr.holdingAJehoDcerineSpolecnosti")}
          action={
            <Button className="px-2.5 py-1.5 text-xs" onClick={() => setEditing("new")}>
              <Plus size={14} /> {t("usr.spolecnost")}
            </Button>
          }
        />
        <ErrorBox error={list.error} />
        {rows.length === 0 ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("usr.spolecnost")}</th>
                <th className="px-3 py-2">{t("usr.ico")}</th>
                <th className="px-3 py-2">{t("usr.rezim")}</th>
                <th className="px-3 py-2">{t("usr.vlastniNastaveni")}</th>
                <th className="px-3 py-2">{t("usr.stav")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <button className="flex items-center gap-2 text-left font-medium hover:text-brand-700" style={{ paddingLeft: c.depth * 20 }} onClick={() => setEditing(c)}>
                      {c.kind === "holding" ? <Network size={15} className="text-brand-600" /> : <Building2 size={15} className="text-slate-400" />}
                      {c.name}
                      {c.shortName && <span className="text-xs text-slate-400">({c.shortName})</span>}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{c.ico ?? "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{c.pack === "generic" ? (FRAMEWORKS.find((x) => x.id === c.primaryFramework)?.shortName ?? "—") : t.lbl(REGIMES[c.regime])}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">
                    {[c.overrides.riskPolicy && `metodika rizik: ${c.overrides.riskPolicy.methodology || BUILTIN_RISK_METHODOLOGY}`, c.overrides.changeCriteria && t("usr.kriteriaZmen"), c.overrides.incidentTolerance !== undefined && t("usr.unosnaUjma"), c.overrides.trustServiceProvider !== undefined && t("usr.sluzbyDuvery")]
                      .filter(Boolean)
                      .join(", ") || (c.id === ROOT_COMPANY_ID ? t("usr.nastaveniSkupiny") : t("usr.dediZeSkupiny"))}
                  </td>
                  <td className="px-3 py-2.5">{c.active ? <Badge tone="green">{t("usr.aktivni")}</Badge> : <Badge>{t("usr.neaktivni")}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <CompanyModal company={editing === "new" ? null : editing} all={rows} onClose={() => setEditing(null)} />}
    </>
  );
}

function CompanyModal({ company, all, onClose }: { company: CompanyDto | null; all: CompanyDto[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const refreshMe = useRefreshMe();
  const isRoot = company?.id === ROOT_COMPANY_ID;
  const [f, setF] = useState({
    name: company?.name ?? "",
    shortName: company?.shortName ?? "",
    kind: company?.kind ?? ("company" as CompanyKind),
    parentId: company?.parentId ?? ROOT_COMPANY_ID,
    ico: company?.ico ?? "",
    address: company?.address ?? "",
    regulatedServices: company?.regulatedServices ?? "",
    // nová společnost přebírá režim nadřazené (ne natvrdo vyšší povinnosti)
    regime: company?.regime ?? (all.find((c) => c.id === ROOT_COMPANY_ID)?.regime ?? "higher") as CompanyDto["regime"],
    // regulatorní profil (ADR-080) – nová společnost přebírá balíček nadřazené
    pack: company?.pack ?? all.find((c) => c.id === ROOT_COMPANY_ID)?.pack ?? "cz",
    primaryFramework: company?.primaryFramework ?? null,
    doraEntity: company?.doraEntity ?? false,
    active: company?.active ?? true,
    ownTolerance: company?.overrides.incidentTolerance !== undefined,
    incidentTolerance: company?.overrides.incidentTolerance ?? "",
    ownTrust: company?.overrides.trustServiceProvider !== undefined,
    trustServiceProvider: company?.overrides.trustServiceProvider ?? false,
    ownMethodology: !!company?.overrides.riskPolicy,
    methodology: company?.overrides.riskPolicy?.methodology || BUILTIN_RISK_METHODOLOGY,
    ownSoc2: company?.overrides.soc2Scope !== undefined,
    soc2Scope: company?.overrides.soc2Scope ?? [],
    ownFrameworks: company?.overrides.frameworks !== undefined,
    frameworks: (company?.overrides.frameworks ?? []) as OptionalFramework[],
    cisIg: (company?.overrides.cisIg ?? 1) as 1 | 2 | 3,
    ownCriteria: company?.overrides.changeCriteria !== undefined,
    changeCriteria: (company?.overrides.changeCriteria ?? []).join("\n"),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // kořenová společnost: sledované rámce jsou nastavení celé skupiny (Administrace → Nastavení)
  const can = useCan();
  const rootSettings = useQuery({ queryKey: ["admin", "settings"], queryFn: api.admin.settings, enabled: isRoot && can("admin:settings") });
  const [rootFw, setRootFw] = useState<{ frameworks: OptionalFramework[] | null; cisIg: 1 | 2 | 3 } | null>(null);
  useEffect(() => {
    const st = rootSettings.data?.settings;
    if (st && !rootFw) setRootFw({ frameworks: st.frameworks as OptionalFramework[] | null, cisIg: st.cisIg as 1 | 2 | 3 });
  }, [rootSettings.data, rootFw]);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["companies"] });
    refreshMe();
    onClose();
  };
  const body = (): CompanyInput => ({
    name: f.name,
    shortName: f.shortName || null,
    kind: f.kind,
    ...(isRoot ? {} : { parentId: f.parentId }),
    ico: f.ico || null,
    address: f.address || null,
    regulatedServices: f.regulatedServices || null,
    regime: f.regime,
    pack: f.pack,
    primaryFramework: f.primaryFramework,
    doraEntity: f.doraEntity,
    active: f.active,
    overrides: {
      ...(f.ownMethodology ? { riskPolicy: { ...(company?.overrides.riskPolicy ?? {}), methodology: f.methodology } as RiskPolicy } : {}),
      ...(f.ownTolerance ? { incidentTolerance: f.incidentTolerance } : {}),
      ...(f.ownTrust ? { trustServiceProvider: f.trustServiceProvider } : {}),
      ...(f.ownSoc2 ? { soc2Scope: f.soc2Scope } : {}),
      ...(f.ownFrameworks ? { frameworks: f.frameworks } : {}),
      ...(f.ownFrameworks && f.frameworks.includes("cis8") ? { cisIg: f.cisIg } : {}),
      ...(f.ownCriteria ? { changeCriteria: f.changeCriteria.split("\n").map((x) => x.trim()).filter(Boolean) } : {}),
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const r = company ? await api.companies.update(company.id, body()) : await api.companies.create(body());
      if (isRoot && rootFw) {
        await api.admin.updateSettings({ frameworks: rootFw.frameworks, cisIg: rootFw.cisIg });
        qc.invalidateQueries({ queryKey: ["admin", "settings"] });
        qc.invalidateQueries({ queryKey: ["frameworks"] });
      }
      return r;
    },
    onSuccess: done,
  });
  const del = useMutation({ mutationFn: () => api.companies.remove(company!.id), onSuccess: done });
  // nadřazená nesmí být sama společnost ani její potomek
  const banned = new Set<string>();
  if (company) {
    banned.add(company.id);
    for (const c of all) if (c.path.length > company.path.length && c.path.slice(0, company.path.length).join("/") === company.path.join("/")) banned.add(c.id);
  }
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={company ? company.name : t("usr.novaSpolecnost")}
      footer={
        <>
          {company && !isRoot && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("usr.smazatSpolecnostJdeJenU"))) && del.mutate()}>
              <Trash2 size={14} />
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || !f.name.trim()} onClick={() => save.mutate()}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label={t("usr.nazev2")}>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("usr.zkratka")}>
          <Input value={f.shortName} onChange={(e) => set("shortName", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("usr.typ")}>
          <Select value={f.kind} onChange={(e) => set("kind", e.target.value as CompanyKind)}>
            {COMPANY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(COMPANY_KIND_LABELS[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("usr.nadrazenaSpolecnost")}>
          <Select
            value={isRoot ? "" : f.parentId}
            disabled={isRoot}
            onChange={(e) => {
              const parentId = e.target.value;
              const parent = all.find((c) => c.id === parentId);
              // u nové společnosti převzít režim nadřazené
              setF((x) => ({ ...x, parentId, ...(!company && parent ? { regime: parent.regime, pack: parent.pack, primaryFramework: parent.primaryFramework } : {}) }));
            }}
          >
            {isRoot && <option value="">{t("usr.korenSkupiny")}</option>}
            {all
              .filter((c) => !banned.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {"  ".repeat(c.depth)}
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("usr.ico")}>
          <Input value={f.ico} maxLength={8} inputMode="numeric" onChange={(e) => set("ico", e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <AresLookup initial={f.ico || f.name} onPick={(a) => setF((x) => ({ ...x, name: a.name, ico: a.ico, address: a.address ?? x.address }))} />
      <Field label={t("usr.sidlo")}>
        <Input value={f.address} onChange={(e) => set("address", e.target.value)} />
      </Field>
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-700">{t("prf.title")}</div>
        <ProfilePicker value={{ pack: f.pack, regime: f.regime, primaryFramework: f.primaryFramework, doraEntity: f.doraEntity }} onChange={(v) => setF((x) => ({ ...x, ...v }))} />
      </div>
      <Checkbox checked={f.active} disabled={isRoot} onChange={(v) => set("active", v)} label={t("usr.aktivni")} />
      <Field label={t("usr.regulovaneSluzby")}>
        <Textarea rows={2} value={f.regulatedServices} onChange={(e) => set("regulatedServices", e.target.value)} />
      </Field>
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-700">{t("fw.title")}</div>
        {isRoot ? (
          rootFw ? (
            <FrameworkScope profile={profileOf(f)} value={rootFw.frameworks} onChange={(v) => setRootFw({ ...rootFw, frameworks: v })} cisIg={rootFw.cisIg} onCisIg={(v) => setRootFw({ ...rootFw, cisIg: v })} />
          ) : (
            <p className="text-xs text-slate-500">{can("admin:settings") ? t("common.loading") : t("fw.rootNoPerm")}</p>
          )
        ) : (
          <div className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="company-frameworks">
            <Checkbox checked={f.ownFrameworks} onChange={(v) => set("ownFrameworks", v)} label={t("fw.ownForCompany")} hint={t("fw.ownForCompanyHint")} />
            {f.ownFrameworks ? <FrameworkPicker value={f.frameworks} onChange={(v) => set("frameworks", v)} /> : <p className="text-xs text-slate-500">{t("fw.inherited")}</p>}
            {f.ownFrameworks && f.frameworks.includes("cis8") && <CisIgSelect value={f.cisIg} onChange={(v) => set("cisIg", v)} />}
          </div>
        )}
      </div>
      {!isRoot && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <div className="text-sm font-medium text-slate-700">{t("usr.vlastniNastaveniJinakSeDedi")}</div>
          <Checkbox checked={f.ownTolerance} onChange={(v) => set("ownTolerance", v)} label={t("usr.vlastniUnosnaMiraUjmyZ")} />
          {f.ownTolerance && <Textarea rows={2} value={f.incidentTolerance} onChange={(e) => set("incidentTolerance", e.target.value)} />}
          <Checkbox checked={f.ownTrust} onChange={(v) => set("ownTrust", v)} label={t("usr.vlastniPriznakPoskytovateleSluzebVytvare")} />
          {f.ownTrust && <Checkbox checked={f.trustServiceProvider} onChange={(v) => set("trustServiceProvider", v)} label={t("usr.poskytujeSluzbyVytvarejiciDuveruOznameni")} />}
          <Checkbox checked={f.ownSoc2} onChange={(v) => set("ownSoc2", v)} label={t("usr.vlastniRozsahZpravySoc2")} />
          {f.ownSoc2 && <Soc2Scope value={f.soc2Scope} onChange={(v) => set("soc2Scope", v)} />}
          <Checkbox checked={f.ownCriteria} onChange={(v) => set("ownCriteria", v)} label={t("usr.vlastniKriteriaVyznamnychZmen11")} />
          {f.ownCriteria && <Textarea rows={4} placeholder={t("usr.jednoKriteriumNaRadek")} value={f.changeCriteria} onChange={(e) => set("changeCriteria", e.target.value)} />}
          <Checkbox checked={f.ownMethodology} onChange={(v) => set("ownMethodology", v)} label={t("usr.vlastniMetodikaHodnoceniRizik")} />
          {f.ownMethodology && (
            <>
              <RiskMethodologySelect value={f.methodology} onChange={(v) => set("methodology", v)} />
              <p className="text-xs text-slate-500">
                {t("usr.naprOctaveAllegroJenPro")}
              </p>
            </>
          )}
        </div>
      )}
      {isRoot && <p className="text-xs text-slate-500">{t("usr.nastaveniKorenoveSpolecnostiPlatiPro")}</p>}
      <ErrorBox error={save.error ?? del.error} />
    </Modal>
  );
}
