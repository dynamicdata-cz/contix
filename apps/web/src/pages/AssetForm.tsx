import { useFormGuard } from "@/lib/unsaved";
import { useT } from "@/lib/i18n";
import { Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import {
  ASSET_CLASSES,
  ASSET_TYPES,
  AssetInput,
  defaultAssetClass,
  CRITICALITIES,
  ENVIRONMENTS,
  LABELS,
  LIFECYCLE_STATUSES,
  type AssetDto,
  type AssetType,
} from "@contix/shared";
import { useCan } from "@/lib/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

type FormState = Record<string, string>;

const EMPTY: FormState = {
  name: "", assetType: "server", description: "", hostname: "", fqdn: "", ipAddresses: "", macAddresses: "",
  osName: "", osVersion: "", manufacturer: "", model: "", serialNumber: "", location: "", ownerName: "",
  criticality: "medium", confidentiality: "", integrity: "", availability: "", lifecycleStatus: "active",
  environment: "", tags: "", assetClass: "", ownerUserId: "", redundant: "false", internetFacing: "false",
};

const toForm = (a: AssetDto): FormState => ({
  ...EMPTY,
  ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v)])),
});

const list = (v: string) => v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const numOrNull = (v: string) => (v ? Number(v) : null);
const strOrNull = (v: string) => v.trim() || null;

function toPayload(f: FormState) {
  // attributes záměrně vynecháváme – jsou plněné konektory a PATCH by je jinak přepsal
  const { attributes: _ignored, ...payload } = AssetInput.parse({
    name: f.name,
    assetType: f.assetType,
    description: strOrNull(f.description!),
    hostname: strOrNull(f.hostname!),
    fqdn: strOrNull(f.fqdn!),
    ipAddresses: list(f.ipAddresses!),
    macAddresses: list(f.macAddresses!),
    osName: strOrNull(f.osName!),
    osVersion: strOrNull(f.osVersion!),
    manufacturer: strOrNull(f.manufacturer!),
    model: strOrNull(f.model!),
    serialNumber: strOrNull(f.serialNumber!),
    location: strOrNull(f.location!),
    ownerName: strOrNull(f.ownerName!),
    ownerUserId: f.ownerUserId || null,
    assetClass: f.assetClass || undefined,
    criticality: f.criticality,
    confidentiality: numOrNull(f.confidentiality!),
    integrity: numOrNull(f.integrity!),
    availability: numOrNull(f.availability!),
    lifecycleStatus: f.lifecycleStatus,
    environment: f.environment || null,
    redundant: f.redundant === "true",
    internetFacing: f.internetFacing === "true",
    tags: list(f.tags!),
  });
  return payload;
}

export function AssetFormPage({ mode }: { mode: "create" | "edit" }) {
  const t = useT();
  const params = useParams({ strict: false }) as { assetId?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(EMPTY);
  const [validation, setValidation] = useState<string | null>(null);
  const can = useCan();
  const directory = useQuery({ queryKey: ["directory"], queryFn: api.directory.users });

  const existing = useQuery({
    queryKey: ["asset", params.assetId],
    queryFn: () => api.assets.get(params.assetId!),
    enabled: mode === "edit" && !!params.assetId,
  });
  useEffect(() => {
    if (existing.data) setF(toForm(existing.data));
  }, [existing.data]);

  const save = useMutation({
    mutationFn: (payload: ReturnType<typeof toPayload>) =>
      mode === "create" ? api.assets.create(payload) : api.assets.update(params.assetId!, payload),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["asset", a.id] });
      navigate({ to: "/assets/$assetId", params: { assetId: a.id } });
    },
  });
  const guard = useFormGuard(save);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setValidation(null);
    try {
      save.mutate(toPayload(f));
    } catch (err: any) {
      setValidation(err?.issues?.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? String(err));
    }
  };

  const bind = (k: string) => ({ value: f[k] ?? "", onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const ciaSelect = (k: string) => (
    <Select {...bind(k)}>
      <option value="">—</option>
      {[1, 2, 3, 4].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </Select>
  );

  return (
    <form onSubmit={submit} {...guard.bind}>
      <PageHeader
        title={mode === "create" ? t("ast.noveAktivum") : `Upravit: ${existing.data?.name ?? ""}`}
        subtitle={t("ast.rucniEvidenceVhodneProAktiva")}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => history.back()}>
              {t("common.cancelAction")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t("ast.ulozit")}
            </Button>
          </>
        }
      />
      <div className="mb-4 space-y-2">
        <ErrorBox error={validation} />
        <ErrorBox error={save.error} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("ast.identifikace")} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label={t("ast.nazev")} className="sm:col-span-2">
              <Input required {...bind("name")} />
            </Field>
            <Field label={t("ast.typAktiva")}>
              <Select {...bind("assetType")}>
                {ASSET_CLASSES.map((cls) => (
                  <optgroup key={cls} label={cls === "primary" ? t("ast.primarniAktiva") : t("ast.podpurnaAktiva2")}>
                    {ASSET_TYPES.filter((tx) => defaultAssetClass(tx) === cls).map((tx) => (
                      <option key={tx} value={tx}>
                        {t.lbl(LABELS.assetType[tx])}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field
              label={t("ast.tridaAktiva")}
              hint={t("ast.primarniInformaceSluzbyProcesyPodpurna")}
            >
              <Select {...bind("assetClass")}>
                {mode === "create" && (
                  <option value="">{t("ast.podleTypu", { p: t.lbl(LABELS.assetClass[defaultAssetClass(f.assetType as AssetType)]) })}</option>
                )}
                {ASSET_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {t.lbl(LABELS.assetClass[c])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("ast.zivotniCyklus")}>
              <Select {...bind("lifecycleStatus")}>
                {LIFECYCLE_STATUSES.map((tx) => (
                  <option key={tx} value={tx}>
                    {t.lbl(LABELS.lifecycleStatus[tx])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("ast.popis")} className="sm:col-span-2">
              <Textarea {...bind("description")} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("ast.rizeniGrc")} />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label={t("ast.garantVlastnikAktiva")} className="sm:col-span-2" hint={can("assets:write") ? undefined : t("ast.vlastnikaMeniSpravceAktiv")}>
              <Select {...bind("ownerUserId")} disabled={!can("assets:write")}>
                <option value="">{t("ast.neprirazen")}</option>
                {directory.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                    {u.jobTitle ? ` (${u.jobTitle})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("ast.kriticnost")}>
              <Select {...bind("criticality")}>
                {CRITICALITIES.map((tx) => (
                  <option key={tx} value={tx}>
                    {t.lbl(LABELS.criticality[tx])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("ast.duvernost")}>{ciaSelect("confidentiality")}</Field>
            <Field label={t("ast.integrita")}>{ciaSelect("integrity")}</Field>
            <Field label={t("ast.dostupnost")}>{ciaSelect("availability")}</Field>
            <Field label={t("ast.odpovednyUtvarSpravceText")} className="sm:col-span-3" hint={t("ast.naprItProvozPokudOdpovedna")}>
              <Input {...bind("ownerName")} />
            </Field>
            <Field label={t("ast.umisteni")} className="sm:col-span-2">
              <Input {...bind("location")} />
            </Field>
            <Field label={t("ast.prostredi")}>
              <Select {...bind("environment")}>
                <option value="">—</option>
                {ENVIRONMENTS.map((tx) => (
                  <option key={tx} value={tx}>
                    {t.lbl(LABELS.environment[tx])}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-3">
              <Checkbox checked={f.redundant === "true"} onChange={(v) => setF({ ...f, redundant: v ? "true" : "false" })} label={t("res.redundant")} hint={t("res.redundantHint")} />
            </div>
            <div className="sm:col-span-3">
              <Checkbox checked={f.internetFacing === "true"} onChange={(v) => setF({ ...f, internetFacing: v ? "true" : "false" })} label={t("vs.internetFacing")} hint={t("vs.internetFacingHint")} />
            </div>
            <Field label={t("ast.stitky")} hint={t("ast.oddelteCarkou")} className="sm:col-span-3">
              <Input {...bind("tags")} placeholder={t("ast.nis2Gdpr")} />
            </Field>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t("ast.technickeUdaje")} subtitle={t("ast.uObjevenychAktivJeDoplnuji")} />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("ast.hostname")}>
              <Input {...bind("hostname")} />
            </Field>
            <Field label={t("ast.fqdn")}>
              <Input {...bind("fqdn")} />
            </Field>
            <Field label={t("ast.ipAdresy")} hint={t("ast.oddelteCarkou")}>
              <Input {...bind("ipAddresses")} />
            </Field>
            <Field label={t("ast.macAdresy")} hint={t("ast.oddelteCarkou")}>
              <Input {...bind("macAddresses")} />
            </Field>
            <Field label={t("ast.os2")}>
              <Input {...bind("osName")} />
            </Field>
            <Field label={t("ast.verzeOs")}>
              <Input {...bind("osVersion")} />
            </Field>
            <Field label={t("ast.vyrobce")}>
              <Input {...bind("manufacturer")} />
            </Field>
            <Field label={t("ast.model")}>
              <Input {...bind("model")} />
            </Field>
            <Field label={t("ast.serioveCislo")}>
              <Input {...bind("serialNumber")} />
            </Field>
          </div>
        </Card>
      </div>
    </form>
  );
}
