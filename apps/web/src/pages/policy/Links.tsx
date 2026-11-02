/**
 * Vazby dokumentu (v0.31): nadřazený / podřízené / související dokumenty, požadavky předpisů,
 * procesy, aktiva, rizika a dodavatelé. Ukládá se spolu s kartou dokumentu (tlačítko Uložit).
 */
import { FrameworkOptions } from "@/components/frameworkOptions";
import { useT, lbl } from "@/lib/i18n";
import { useDecree } from "@/lib/regime";
import { AssetPicker, IdMultiSelect, type PickedAsset } from "@/components/pickers";
import { Card, CardHeader, Field, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { allRequirements, FRAMEWORKS, parentCycle, POLICY_LABELS, requirementsOf, type FrameworkId, type PolicyDetail, type PolicyRef } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export type PolicyLinkState = {
  parentId: string | null;
  relatedIds: string[];
  requirementIds: string[];
  processIds: string[];
  assets: PickedAsset[];
  riskIds: string[];
  supplierIds: string[];
};

export const linkStateOf = (p: PolicyDetail | null): PolicyLinkState => ({
  parentId: p?.parent?.id ?? null,
  relatedIds: p?.related.map((x) => x.id) ?? [],
  requirementIds: p?.requirements.map((x) => x.id) ?? [],
  processIds: p?.processes.map((x) => x.id) ?? [],
  assets: p?.assets.map((x) => ({ id: x.id, name: x.name, assetType: x.assetType })) ?? [],
  riskIds: p?.risks.map((x) => x.id) ?? [],
  supplierIds: p?.suppliers.map((x) => x.id) ?? [],
});

const docLabel = (d: { code: string | null; title: string }) => `${d.code ? `${d.code} ` : ""}${d.title}`;
const fwShort = (id: string) => FRAMEWORKS.find((x) => x.id === id)?.shortName ?? id;

function DocLink({ d }: { d: PolicyRef }) {
  return (
    <Link to="/policies/$policyId" params={{ policyId: d.id }} className="hover:text-brand-700">
      {docLabel(d)} <span className="text-xs text-slate-400">({lbl(POLICY_LABELS.type[d.docType])})</span>
    </Link>
  );
}

export function PolicyLinksCard({ p, value, onChange, disabled }: { p: PolicyDetail | null; value: PolicyLinkState; onChange: (v: Partial<PolicyLinkState>) => void; disabled: boolean }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const docs = useQuery({ queryKey: ["policies", "list"], queryFn: api.policies.list, enabled: can("policies:read") });
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const risks = useQuery({ queryKey: ["risks", "list", "all"], queryFn: () => api.risks.list({ limit: 500 }), enabled: mod("risks") && can("risks:read") });
  const suppliers = useQuery({ queryKey: ["suppliers", "group"], queryFn: () => api.suppliers.list({ withGroup: "1" }), enabled: mod("suppliers") && can("suppliers:read") });
  const decree = useDecree();
  const [fw, setFw] = useState<FrameworkId>(p?.system === "qms" ? "iso9001" : decree);

  const all = docs.data ?? [];
  const companyDocs = all.filter((d) => d.id !== p?.id && (!p || d.companyId === p.companyId));
  // nadřazený nesmí vytvořit cyklus (dokument pod sebou / pod svým potomkem)
  const parentOptions = p ? companyDocs.filter((d) => !parentCycle(all, p.id, d.id)) : companyDocs;
  const reqOptions = useMemo(() => requirementsOf(fw).map((r) => ({ id: r.id, label: `${r.ref} ${r.text.slice(0, 90)}` })), [fw]);
  const reqKnown = useMemo(
    () => allRequirements().filter((r) => value.requirementIds.includes(r.id)).map((r) => ({ id: r.id, label: `${fwShort(r.framework)} ${r.ref}` })),
    [value.requirementIds],
  );

  return (
    <Card className="mt-6">
      <CardHeader title={t("dms.vazbyDokumentu")} subtitle={t("dms.hierarchieDokumentaceSouvisejiciDokument")} />
      <fieldset disabled={disabled} className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label={t("dms.nadrazenyDokument")} hint={t("dms.naprSmernicePolitikaPostupSmernice")}>
            <Select value={value.parentId ?? ""} onChange={(e) => onChange({ parentId: e.target.value || null })}>
              <option value="">{t("dms.zadnyNejvyssiUroven")}</option>
              {parentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {docLabel(d)}
                </option>
              ))}
              {value.parentId && p?.parent && !parentOptions.some((d) => d.id === value.parentId) && <option value={p.parent.id}>{docLabel(p.parent)}</option>}
            </Select>
          </Field>
          {p && p.children.length > 0 && (
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">{t("dms.podrizeneDokumenty")}</div>
              <ul className="space-y-0.5 text-sm">
                {p.children.map((d) => (
                  <li key={d.id}>
                    <DocLink d={d} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field label={t("dms.souvisejiciDokumenty")} hint={t("dms.vazbaJeObousmernaZobraziSe")}>
            <IdMultiSelect
              linkKind="policy"
              value={value.relatedIds}
              onChange={(v) => onChange({ relatedIds: v })}
              disabled={disabled}
              options={companyDocs.map((d) => ({ id: d.id, label: docLabel(d) }))}
              known={(p?.related ?? []).map((d) => ({ id: d.id, label: docLabel(d) }))}
              placeholder={t("dms.pridatDokument")}
              emptyLabel={t("dms.zadneSouvisejiciDokumenty")}
            />
          </Field>
          <Field label={t("dms.pozadavkyPredpisu")} hint={t("dms.konkretniUstanoveniKteraDokumentNaplnuje")}>
            <div className="space-y-2">
              <Select className="w-48" value={fw} onChange={(e) => setFw(e.target.value as FrameworkId)}>
                <FrameworkOptions label="short" />
              </Select>
              <IdMultiSelect
                value={value.requirementIds}
                onChange={(v) => onChange({ requirementIds: v })}
                disabled={disabled}
                options={reqOptions}
                known={reqKnown}
                placeholder={t("dms.pridatPozadavek")}
                emptyLabel={t("dms.zadnePozadavky")}
              />
            </div>
          </Field>
        </div>
        <div className="space-y-4">
          {mod("processes") && can("processes:read") && (
            <Field label={t("dms.procesy")}>
              <IdMultiSelect
                linkKind="process"
                value={value.processIds}
                onChange={(v) => onChange({ processIds: v })}
                disabled={disabled}
                options={(processes.data ?? []).map((x) => ({ id: x.id, label: `${x.code ? `${x.code} ` : ""}${x.name}` }))}
                known={(p?.processes ?? []).map((x) => ({ id: x.id, label: `${x.code ? `${x.code} ` : ""}${x.name}` }))}
                placeholder={t("dms.pridatProces")}
                emptyLabel={t("dms.zadneProcesy")}
              />
            </Field>
          )}
          {mod("assets") && can("assets:read") && (
            <Field label={t("dms.aktiva")}>
              <AssetPicker value={value.assets} onChange={(v) => onChange({ assets: v })} disabled={disabled} />
            </Field>
          )}
          {mod("risks") && can("risks:read") && (
            <Field label={t("dms.rizika")} hint={t("dms.rizikaKteraDokumentPomahaZvladat")}>
              <IdMultiSelect
                linkKind="risk"
                value={value.riskIds}
                onChange={(v) => onChange({ riskIds: v })}
                disabled={disabled}
                options={(risks.data?.items ?? []).map((x) => ({ id: x.id, label: `${x.code ? `${x.code} ` : ""}${x.name}` }))}
                known={(p?.risks ?? []).map((x) => ({ id: x.id, label: `${x.code ? `${x.code} ` : ""}${x.name}` }))}
                placeholder={t("dms.pridatRiziko")}
                emptyLabel={t("dms.zadnaRizika")}
              />
            </Field>
          )}
          {mod("suppliers") && can("suppliers:read") && (
            <Field label={t("dms.dodavatele")} hint={t("dms.naprDodavateleProKtereDokument")}>
              <IdMultiSelect
                linkKind="supplier"
                value={value.supplierIds}
                onChange={(v) => onChange({ supplierIds: v })}
                disabled={disabled}
                options={(suppliers.data ?? []).map((x) => ({ id: x.id, label: x.name }))}
                known={(p?.suppliers ?? []).map((x) => ({ id: x.id, label: x.name }))}
                placeholder={t("dms.pridatDodavatele")}
                emptyLabel={t("dms.zadniDodavatele")}
              />
            </Field>
          )}
        </div>
      </fieldset>
    </Card>
  );
}
