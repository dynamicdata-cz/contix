import { useT } from "@/lib/i18n";
import { RiskLevelBadge } from "@/components/risk";
import { Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import {
  checkMethodology,
  formulaVariables,
  MethodologyDef,
  RISK_LABELS,
  RISK_LEVELS,
  scoreMethodology,
  type AuditMethodologyDef,
  type FactorValues,
  type RiskLevel,
  type RiskMethodologyDef,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

type RiskDef = RiskMethodologyDef;
type AuditDef = AuditMethodologyDef;

const NEW_RISK: RiskDef = {
  kind: "risk",
  id: "moje_metodika",
  name: "Vlastní metodika",
  version: "1.0",
  areaAggregate: "weighted_sum",
  formula: "dopad * pravdepodobnost",
  factors: [
    { key: "dopad", label: "Dopad", perArea: false, scale: [1, 2, 3, 4].map((v) => ({ value: v, label: ["nízký", "střední", "vysoký", "kritický"][v - 1]! })) },
    { key: "pravdepodobnost", label: "Pravděpodobnost", perArea: false, scale: [1, 2, 3, 4].map((v) => ({ value: v, label: ["nízká", "střední", "vysoká", "velmi vysoká"][v - 1]! })) },
  ],
  levels: [
    { key: "nizke", label: "Nízké", mapsTo: "low", max: 3, acceptable: true },
    { key: "stredni", label: "Střední", mapsTo: "medium", min: 4, max: 6, acceptable: false },
    { key: "vysoke", label: "Vysoké", mapsTo: "high", min: 7, max: 11, acceptable: false },
    { key: "kriticke", label: "Kritické", mapsTo: "critical", min: 12, acceptable: false },
  ],
};
const NEW_AUDIT: AuditDef = {
  kind: "audit",
  id: "muj_audit",
  name: "Vlastní kontrolní seznam",
  version: "1.0",
  checklist: [{ id: "q1", section: "", question: "Je schválena bezpečnostní politika?" }],
};

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "m_$1")
    .slice(0, 40) || "klic";

/** Editor metodiky v aplikaci – výsledek se ukládá jako balíček JSON (stejně jako import). */
export function MethodologyEditorPage() {
  const t = useT();
  const search = useSearch({ strict: false }) as { from?: string; kind?: "risk" | "audit" };
  const list = useQuery({ queryKey: ["methodologies"], queryFn: api.methodologies.list });
  if (search.from && !list.data) return <ErrorBox error={list.error} />;
  const src = search.from ? list.data?.find((m) => m.id === search.from) : undefined;
  if (search.from && !src?.definition) return <ErrorBox error={new Error("Metodiku nelze upravit (vestavěná metodika dle vyhlášky se nastavuje v Nastavení).")} />;
  const builtin = !!src?.builtin;
  const initial: MethodologyDef = src?.definition
    ? (() => {
        const d = structuredClone(src.definition) as MethodologyDef;
        if (builtin) {
          d.id = `${d.id}_vlastni`.slice(0, 40);
          d.name = t("meth.upravena", { name: d.name });
        }
        return d;
      })()
    : search.kind === "audit"
      ? NEW_AUDIT
      : NEW_RISK;
  return <Editor key={search.from ?? search.kind ?? "new"} initial={initial} replace={!!src && !builtin} />;
}

function Editor({ initial, replace }: { initial: MethodologyDef; replace: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [def, setDef] = useState<MethodologyDef>(initial);
  const parsed = useMemo(() => MethodologyDef.safeParse(def), [def]);
  const errors = useMemo(
    () => (parsed.success ? checkMethodology(parsed.data) : parsed.error.issues.map((i) => `${i.path.join(".") || t("meth.koren")}: ${i.message}`)),
    [parsed],
  );
  const save = useMutation({
    mutationFn: () => api.methodologies.import({ format: "json", content: JSON.stringify(parsed.success ? parsed.data : def), replace }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["methodologies"] });
      nav({ to: "/admin/methodologies" });
    },
  });
  const set = (patch: Partial<MethodologyDef>) => setDef((d) => ({ ...d, ...patch }) as MethodologyDef);
  return (
    <div className="space-y-6">
      <div className="text-sm text-slate-500">
        <Link to="/admin/methodologies" className="hover:text-brand-700">
          {t("meth.metodiky")}
        </Link>
      </div>
      <Card>
        <CardHeader title={def.kind === "risk" ? t("meth.metodikaAnalyzyRizik") : t("meth.kontrolniSeznamAuditu")} subtitle={replace ? t("meth.upravaImportovaneMetodikyUlozenimSe") : t("meth.novaMetodikaUloziSeJako")} />
        <div className="grid gap-4 p-5 sm:grid-cols-[14rem_1fr_7rem]">
          <Field label={t("meth.idKlic")} hint={t("meth.malaPismenaCislice")}>
            <Input value={def.id} disabled={replace} onChange={(e) => set({ id: e.target.value.toLowerCase() })} />
          </Field>
          <Field label={t("meth.nazev")}>
            <Input value={def.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t("meth.verze")}>
            <Input value={def.version} onChange={(e) => set({ version: e.target.value })} />
          </Field>
          <Field label={t("meth.popis")} className="sm:col-span-2">
            <Textarea rows={2} value={def.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
          </Field>
          <Field label={t("meth.zdroj")}>
            <Input value={def.source ?? ""} onChange={(e) => set({ source: e.target.value || undefined })} />
          </Field>
        </div>
      </Card>
      {def.kind === "risk" ? <RiskParts def={def} setDef={(d) => setDef(d)} /> : <AuditParts def={def} setDef={(d) => setDef(d)} />}
      <Card className="p-5">
        {errors.length ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <div className="font-medium">{t("meth.metodikaZatimNeniPlatna")}</div>
            <ul className="mt-1 list-disc pl-5">
              {errors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : (
          <SuccessBox>{t("meth.metodikaJePlatna")}</SuccessBox>
        )}
        <ErrorBox error={save.error} />
        <div className="mt-3 flex gap-3">
          <Button disabled={!!errors.length || save.isPending} onClick={() => save.mutate()}>
            {replace ? t("meth.ulozitNahradit") : t("meth.ulozitMetodiku")}
          </Button>
          <Link to="/admin/methodologies">
            <Button variant="secondary">{t("common.cancelAction")}</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- metodika rizik ---------------- */

function RiskParts({ def, setDef }: { def: RiskDef; setDef: (d: RiskDef) => void }) {
  const t = useT();
  const set = (p: Partial<RiskDef>) => setDef({ ...def, ...p });
  const vars = useMemo(() => {
    try {
      return formulaVariables(def.formula);
    } catch {
      return [];
    }
  }, [def.formula]);
  const perArea = def.factors.some((f) => f.perArea);
  return (
    <>
      <Card>
        <CardHeader title={t("meth.faktoryAStupnice")} subtitle={t("meth.kazdyFaktorJePromennaVe")} />
        <div className="space-y-4 p-5">
          {def.factors.map((f, i) => (
            <div key={i} className="rounded-md border border-slate-200 p-3">
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto_auto]">
                <Field label={t("meth.klic")}>
                  <Input value={f.key} onChange={(e) => set({ factors: def.factors.map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase() } : x)) })} />
                </Field>
                <Field label={t("meth.nazev")}>
                  <Input
                    value={f.label}
                    onChange={(e) => set({ factors: def.factors.map((x, j) => (j === i ? { ...x, label: e.target.value, ...(x.key.startsWith("faktor") ? { key: slug(e.target.value) } : {}) } : x)) })}
                  />
                </Field>
                <div className="pt-6">
                  <Checkbox checked={f.perArea} onChange={(v) => set({ factors: def.factors.map((x, j) => (j === i ? { ...x, perArea: v } : x)) })} label={t("meth.poOblastech")} />
                </div>
                <button className="pt-6 text-slate-400 hover:text-red-600" disabled={def.factors.length <= 1} onClick={() => set({ factors: def.factors.filter((_, j) => j !== i) })} aria-label={t("meth.odebratFaktor")}>
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="mt-2 text-xs font-medium text-slate-600">{t("meth.stupnice")}</div>
              <div className="mt-1 space-y-1.5">
                {f.scale.map((st, k) => (
                  <div key={k} className="grid grid-cols-[5rem_12rem_1fr_auto] gap-2">
                    <Input type="number" value={st.value} onChange={(e) => set({ factors: def.factors.map((x, j) => (j === i ? { ...x, scale: x.scale.map((y, m) => (m === k ? { ...y, value: Number(e.target.value) } : y)) } : x)) })} />
                    <Input value={st.label} onChange={(e) => set({ factors: def.factors.map((x, j) => (j === i ? { ...x, scale: x.scale.map((y, m) => (m === k ? { ...y, label: e.target.value } : y)) } : x)) })} />
                    <Input
                      placeholder={t("meth.popisVolitelne")}
                      value={st.description ?? ""}
                      onChange={(e) => set({ factors: def.factors.map((x, j) => (j === i ? { ...x, scale: x.scale.map((y, m) => (m === k ? { ...y, description: e.target.value || undefined } : y)) } : x)) })}
                    />
                    <button className="text-slate-400 hover:text-red-600" disabled={f.scale.length <= 2} onClick={() => set({ factors: def.factors.map((x, j) => (j === i ? { ...x, scale: x.scale.filter((_, m) => m !== k) } : x)) })} aria-label={t("meth.odebratStupen")}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  className="text-xs text-brand-700 hover:underline"
                  onClick={() => set({ factors: def.factors.map((x, j) => (j === i ? { ...x, scale: [...x.scale, { value: Math.max(0, ...x.scale.map((s) => s.value)) + 1, label: "" }] } : x)) })}
                >
                  {t("meth.stupen")}
                </button>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            onClick={() => set({ factors: [...def.factors, { key: `faktor${def.factors.length + 1}`, label: t("meth.novyFaktor"), perArea: false, scale: [{ value: 1, label: t("meth.nizky") }, { value: 2, label: t("meth.vysoky") }] }] })}
          >
            <Plus size={14} /> {t("meth.faktor")}
          </Button>
        </div>
      </Card>

      {perArea && (
        <Card>
          <CardHeader title={t("meth.oblastiDopadu")} subtitle={t("meth.vahaPrioritaOblastiNaprOctave")} />
          <div className="space-y-2 p-5">
            {(def.areas ?? []).map((a, i) => (
              <div key={i} className="grid grid-cols-[10rem_1fr_6rem_auto] gap-2">
                <Input value={a.key} onChange={(e) => set({ areas: def.areas!.map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase() } : x)) })} />
                <Input value={a.label} onChange={(e) => set({ areas: def.areas!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <Input type="number" value={a.weight} onChange={(e) => set({ areas: def.areas!.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)) })} />
                <button className="text-slate-400 hover:text-red-600" onClick={() => set({ areas: def.areas!.filter((_, j) => j !== i) })} aria-label={t("meth.odebratOblast")}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button className="text-xs text-brand-700 hover:underline" onClick={() => set({ areas: [...(def.areas ?? []), { key: `oblast${(def.areas?.length ?? 0) + 1}`, label: t("meth.novaOblast"), weight: 1 }] })}>
              {t("meth.oblast")}
            </button>
            <Field label={t("meth.slouceniHodnotPoOblastech")}>
              <Select value={def.areaAggregate} onChange={(e) => set({ areaAggregate: e.target.value as RiskDef["areaAggregate"] })}>
                <option value="weighted_sum">{t("meth.vazenySoucetOctave")}</option>
                <option value="sum">{t("meth.soucet")}</option>
                <option value="max">{t("meth.maximum")}</option>
                <option value="weighted_max">{t("meth.vazeneMaximum")}</option>
              </Select>
            </Field>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t("meth.vzorecAUrovne")} subtitle={t("meth.vzorecZavorkyMinMaxRound")} />
        <div className="space-y-4 p-5">
          <Field label={t("meth.skore")} hint={vars.length ? t("meth.promenne", { p: vars.join(", ") }) : undefined}>
            <Input className="font-mono" value={def.formula} onChange={(e) => set({ formula: e.target.value })} />
          </Field>
          <div className="text-xs font-medium text-slate-600">{t("meth.urovneRozsahSkoreVcetneHranic")}</div>
          {def.levels.map((l, i) => (
            <div key={i} className="grid grid-cols-[8rem_1fr_9rem_5rem_5rem_1fr_auto_auto] items-center gap-2">
              <Input value={l.key} onChange={(e) => set({ levels: def.levels.map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase() } : x)) })} />
              <Input value={l.label} onChange={(e) => set({ levels: def.levels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Select value={l.mapsTo} onChange={(e) => set({ levels: def.levels.map((x, j) => (j === i ? { ...x, mapsTo: e.target.value as RiskLevel } : x)) })}>
                {RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>
                    → {t.lbl(RISK_LABELS.level[r])}
                  </option>
                ))}
              </Select>
              <Input type="number" placeholder={t("meth.od")} value={l.min ?? ""} onChange={(e) => set({ levels: def.levels.map((x, j) => (j === i ? { ...x, min: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} />
              <Input type="number" placeholder={t("meth.do")} value={l.max ?? ""} onChange={(e) => set({ levels: def.levels.map((x, j) => (j === i ? { ...x, max: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} />
              <Input placeholder={t("meth.zvladani")} value={l.treatment ?? ""} onChange={(e) => set({ levels: def.levels.map((x, j) => (j === i ? { ...x, treatment: e.target.value || undefined } : x)) })} />
              <Checkbox checked={l.acceptable} onChange={(v) => set({ levels: def.levels.map((x, j) => (j === i ? { ...x, acceptable: v } : x)) })} label={t("meth.akcept")} />
              <button className="text-slate-400 hover:text-red-600" disabled={def.levels.length <= 2} onClick={() => set({ levels: def.levels.filter((_, j) => j !== i) })} aria-label={t("meth.odebratUroven")}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="text-xs text-brand-700 hover:underline" onClick={() => set({ levels: [...def.levels, { key: `uroven${def.levels.length + 1}`, label: t("meth.novaUroven"), mapsTo: "medium", acceptable: false }] })}>
            {t("meth.uroven")}
          </button>
          {def.rules?.length ? (
            <p className="text-xs text-amber-800">
              {t("meth.metodikaMaPravidelZarazeniNapr", { length: def.rules.length })}
            </p>
          ) : null}
        </div>
      </Card>
      <Preview def={def} />
    </>
  );
}

function Preview({ def }: { def: RiskDef }) {
  const t = useT();
  const [v, setV] = useState<FactorValues>({});
  const parsed = RiskMethodologyDefSafe(def);
  const r = parsed ? scoreMethodology(parsed, v) : null;
  return (
    <Card>
      <CardHeader title={t("meth.zkouskaVypoctu")} />
      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-3">
          {def.factors.map((f) =>
            f.perArea ? (
              <div key={f.key} className="grid gap-2 sm:grid-cols-3">
                {(def.areas ?? []).map((a) => (
                  <Field key={a.key} label={`${f.label} – ${a.label}`}>
                    <Select
                      value={(v[f.key] as Record<string, number> | undefined)?.[a.key] ?? ""}
                      onChange={(e) => setV({ ...v, [f.key]: { ...((v[f.key] as Record<string, number>) ?? {}), [a.key]: Number(e.target.value) } })}
                    >
                      <option value="">—</option>
                      {f.scale.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.value} – {s.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            ) : (
              <Field key={f.key} label={f.label}>
                <Select value={(v[f.key] as number | undefined) ?? ""} onChange={(e) => setV({ ...v, [f.key]: Number(e.target.value) })}>
                  <option value="">—</option>
                  {f.scale.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.value} – {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ),
          )}
        </div>
        <div className="rounded-md bg-slate-50 p-4 text-sm">
          {r?.score != null ? (
            <>
              <div className="text-xs uppercase tracking-wide text-slate-500">{t("meth.skore2")}</div>
              <div className="text-2xl font-semibold tabular-nums">
                {r.score} <span className="text-sm font-normal text-slate-500">/ {r.max}</span>
              </div>
              <div className="mt-2">
                {def.levels.find((l) => l.key === r.levelKey)?.label ?? t("meth.mimoUrovne")} <RiskLevelBadge level={r.level} />
              </div>
            </>
          ) : (
            <span className="text-slate-500">{t("meth.vyberteHodnotyVsechFaktoru")}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

function RiskMethodologyDefSafe(def: RiskDef): RiskDef | null {
  const p = MethodologyDef.safeParse(def);
  return p.success && p.data.kind === "risk" && !checkMethodology(p.data).length ? p.data : null;
}

/* ---------------- kontrolní seznam ---------------- */

function AuditParts({ def, setDef }: { def: AuditDef; setDef: (d: AuditDef) => void }) {
  const t = useT();
  const [paste, setPaste] = useState("");
  const items = def.checklist;
  const setItems = (checklist: AuditDef["checklist"]) => setDef({ ...def, checklist });
  const importPaste = () => {
    const rows = paste
      .split(/\r?\n/)
      .map((l) => l.split(/\t|;/).map((x) => x.trim()))
      .filter((r) => r.some(Boolean));
    const add = rows.map((r, i) => {
      const [section, ref, question, guidance, requirementId] = r.length >= 3 ? r : ["", "", r[r.length - 1] ?? ""];
      return { id: `q${items.length + i + 1}`, section: section || undefined, ref: ref || undefined, question: question ?? "", guidance: guidance || undefined, requirementId: requirementId || undefined };
    });
    setItems([...items, ...add]);
    setPaste("");
  };
  return (
    <Card>
      <CardHeader title={t("meth.polozky", { length: items.length })} subtitle={t("meth.oddilNapr8SlouziK")} />
      <div className="space-y-2 p-5">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[6rem_6rem_8rem_1fr_9rem_auto] gap-2">
            <Input placeholder={t("meth.id")} value={it.id} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} />
            <Input placeholder={t("meth.oddil")} value={it.section ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, section: e.target.value || undefined } : x)))} />
            <Input placeholder={t("meth.odkaz")} value={it.ref ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, ref: e.target.value || undefined } : x)))} />
            <Input placeholder={t("meth.otazka")} value={it.question} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
            <Input placeholder={t("meth.pozadavek")} value={it.requirementId ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, requirementId: e.target.value || undefined } : x)))} />
            <button className="text-slate-400 hover:text-red-600" disabled={items.length <= 1} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t("meth.odebrat")}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="text-xs text-brand-700 hover:underline" onClick={() => setItems([...items, { id: `q${items.length + 1}`, question: "" }])}>
          {t("meth.polozka")}
        </button>
        <Field label={t("meth.vlozitZTabulkyExcel")} hint={t("meth.sloupceOddilOdkazOtazkaPokyn")}>
          <Textarea rows={4} className="font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)} />
        </Field>
        <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={!paste.trim()} onClick={importPaste}>
          {t("meth.pridatRadky")}
        </Button>
      </div>
    </Card>
  );
}
