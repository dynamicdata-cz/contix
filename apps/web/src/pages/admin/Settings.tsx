import { locScale } from "@/components/risk";
import { AresLookup } from "@/components/ares";
import { FrameworkScope } from "@/components/frameworkScope";
import { ProfilePicker } from "@/components/profilePicker";
import { useT } from "@/lib/i18n";
import { SOC2_CATEGORIES, SOC2_OPTIONAL } from "@contix/shared";
import { Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select, SuccessBox, Textarea } from "@/components/ui";
import { RiskMethodologySelect } from "@/components/methodology";
import { api } from "@/lib/api";
import { useMe, useRefreshMe } from "@/lib/auth";
import { profileOf, BUILTIN_RISK_METHODOLOGY, DECREE_LEVEL_NAMES, effectiveBounds, maxScore, MODULES, RISK_LABELS, scaleFor, type Settings } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

export function AdminSettingsPage() {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe();
  const refreshMe = useRefreshMe();
  const data = useQuery({ queryKey: ["admin", "settings"], queryFn: api.admin.settings });
  const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: api.admin.roles });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (data.data) setS(data.data.settings);
  }, [data.data]);
  const save = useMutation({
    mutationFn: () => api.admin.updateSettings({ ...s!, changeCriteria: s!.changeCriteria.map((x) => x.trim()).filter(Boolean) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      for (const k of ["assets", "asset", "vuln-summary", "risks", "risk", "process"]) qc.invalidateQueries({ queryKey: [k] });
      refreshMe();
    },
  });
  if (!s) return <ErrorBox error={data.error} />;
  const hp = (k: keyof Settings["healthPolicy"]) => ({
    type: "number",
    value: String(s.healthPolicy[k]),
    onChange: (e: { target: { value: string } }) => setS({ ...s, healthPolicy: { ...s.healthPolicy, [k]: Number(e.target.value) } }),
  });
  const num = (k: keyof Settings) => ({
    type: "number",
    value: String(s[k]),
    onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) }),
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t("set.organizaceKorenovaSpolecnostSkupiny")}
            subtitle={t("set.identitaARezimKorenoveSpolecnosti")}
          />
          <div className="space-y-4 p-5">
            <Field label={t("set.nazevOrganizace")}>
              <Input value={s.organizationName} onChange={(e) => setS({ ...s, organizationName: e.target.value })} />
            </Field>
            <AresLookup
              initial={s.organizationIco || (s.organizationName !== "Moje organizace" ? s.organizationName : "")}
              onPick={(a) => setS({ ...s, organizationName: a.name, organizationIco: a.ico, organizationAddress: a.address ?? s.organizationAddress })}
            />
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <Field label={t("set.ico")}>
                <Input value={s.organizationIco} onChange={(e) => setS({ ...s, organizationIco: e.target.value })} />
              </Field>
              <Field label={t("set.sidlo")}>
                <Input value={s.organizationAddress} onChange={(e) => setS({ ...s, organizationAddress: e.target.value })} />
              </Field>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-slate-700">{t("prf.title")}</div>
              <ProfilePicker value={{ pack: s.pack, regime: s.regime, primaryFramework: s.primaryFramework, doraEntity: s.doraEntity }} onChange={(v) => setS({ ...s, ...v })} />
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-slate-700">{t("fw.title")}</div>
              <FrameworkScope profile={profileOf(s)} value={s.frameworks} onChange={(v) => setS({ ...s, frameworks: v })} cisIg={s.cisIg} onCisIg={(v) => setS({ ...s, cisIg: v })} />
            </div>
            <Field
              label={t("set.unosnaMiraUjmyZIncidentu")}
              hint={t("set.14Odst1PismA")}
            >
              <Textarea rows={3} value={s.incidentTolerance} onChange={(e) => setS({ ...s, incidentTolerance: e.target.value })} />
            </Field>
            <Checkbox
              checked={s.trustServiceProvider}
              onChange={(v) => setS({ ...s, trustServiceProvider: v })}
              label={t("set.poskytovatelSluzebVytvarejicichDuveruEid")}
              hint={t("set.oznameniOIncidentuDo24")}
            />
            <Field label={t("set.rozsahZpravySoc2")} hint={t("set.bezpecnostSpolecnaKriteriaCc1Cc9")}>
              <Soc2Scope value={s.soc2Scope} onChange={(v) => setS({ ...s, soc2Scope: v })} />
            </Field>
            <Field
              label={t("set.kriteriaProUrceniVyznamnychZmen")}
              hint={t("set.11Odst1PismA")}
            >
              <Textarea
                rows={6}
                value={s.changeCriteria.join("\n")}
                onChange={(e) => setS({ ...s, changeCriteria: e.target.value.split("\n") })}
              />
            </Field>
            <Field label={t("set.regulovaneSluzby")} hint={t("set.uvadiSeVDokumentechIsms")}>
              <Textarea rows={2} value={s.regulatedServices} onChange={(e) => setS({ ...s, regulatedServices: e.target.value })} />
            </Field>
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("set.incidentContact")}</div>
              <p className="mb-2 text-xs text-slate-500">{t("set.incidentContactHint")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["name", "role", "phone", "email"] as const).map((k) => (
                  <Field key={k} label={t(`set.ic.${k}`)}>
                    <Input value={s.incidentContact[k]} onChange={(e) => setS({ ...s, incidentContact: { ...s.incidentContact, [k]: e.target.value } })} />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("set.prihlasovaniARelace")} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label={t("set.odhlaseniPriNecinnostiMin")}>
              <Input {...num("sessionTimeoutMinutes")} min={5} />
            </Field>
            <Field label={t("set.maximalniDelkaRelaceHod")}>
              <Input {...num("sessionMaxHours")} min={1} />
            </Field>
            <Field label={t("set.neuspesnychPokusuDoZamceni")}>
              <Input {...num("maxFailedLogins")} min={3} />
            </Field>
            <Field label={t("set.dobaZamceniUctuMin")}>
              <Input {...num("lockoutMinutes")} min={1} />
            </Field>
            <div className="sm:col-span-2">
              <Checkbox
                checked={s.mfaRequired}
                onChange={(v) => setS({ ...s, mfaRequired: v })}
                label={t("set.vyzadovatMfaUVsechLokalnich")}
                hint={
                  me.user.mfaEnabled || me.user.authProvider !== "local"
                    ? t("set.uzivateleBezMfaBudouPo")
                    : t("set.nejdrivSiNastavteMfaPro")
                }
              />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t("set.semaforAktivPravidla")}
          subtitle={t("set.kdyJeAktivumZeleneOranzove")}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("set.cervenaOdNKritickychCve")}>
            <Input {...hp("redCritical")} min={1} />
          </Field>
          <Field label={t("set.cervenaOdNVysokychCve")} hint={t("set.0Nepouzivat")}>
            <Input {...hp("redHigh")} min={0} />
          </Field>
          <Field label={t("set.oranzovaOdNVysokychCve")}>
            <Input {...hp("orangeHigh")} min={1} />
          </Field>
          <Field label={t("set.oranzovaOdNStrednichCve")} hint={t("set.0Nepouzivat")}>
            <Input {...hp("orangeMedium")} min={0} />
          </Field>
          <Field label={t("set.upozornitNaKonecPodporyDni")}>
            <Input {...hp("eolWarnDays")} min={0} />
          </Field>
          <Field label={t("set.neaktualniDataPoDnech")} hint={t("set.agentNehlasiStav0Nepouzivat")}>
            <Input {...hp("staleDays")} min={0} />
          </Field>
          <div className="space-y-3 sm:col-span-2">
            <Checkbox
              checked={s.healthPolicy.redOnEol}
              onChange={(v) => setS({ ...s, healthPolicy: { ...s.healthPolicy, redOnEol: v } })}
              label={t("set.systemBezPodporyVyrobceEol")}
              hint={t("set.jinakJenOranzova")}
            />
            <Checkbox
              checked={s.healthPolicy.redOnP1 !== false}
              onChange={(v) => setS({ ...s, healthPolicy: { ...s.healthPolicy, redOnP1: v } })}
              label={t("vr.redOnP1")}
              hint={t("vr.redOnP1Hint")}
            />
            <Checkbox
              checked={s.healthPolicy.propagateToPrimary}
              onChange={(v) => setS({ ...s, healthPolicy: { ...s.healthPolicy, propagateToPrimary: v } })}
              label={t("set.primarniAktivumPrebiraNejhorsiStav")}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("set.firemniPrihlaseniEntraIdActive")} />
        <div className="flex flex-wrap items-center gap-3 p-5 text-sm text-slate-600">
          <span className="flex-1">{t("set.loginMoved")}</span>
          <Link to="/admin/login">
            <Button variant="secondary">{t("set.loginOpen")}</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("set.moduly")} subtitle={t("set.vypnutyModulZmiziZMenu")} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => {
            const on = s.enabledModules.includes(m.key);
            const neededBy = MODULES.filter((x) => s.enabledModules.includes(x.key) && (x.dependsOn as readonly string[]).includes(m.key));
            const missing = m.dependsOn.filter((d) => !s.enabledModules.includes(d));
            return (
              <Checkbox
                key={m.key}
                checked={on}
                disabled={(on && neededBy.length > 0) || (!on && missing.length > 0)}
                onChange={(v) =>
                  setS({ ...s, enabledModules: v ? [...s.enabledModules, m.key] : s.enabledModules.filter((k) => k !== m.key) })
                }
                label={t.lbl(m.name)}
                hint={
                  on && neededBy.length
                    ? t("set.potrebujeHo", { description: t.lbl(m.description), p: neededBy.map((x) => t.lbl(x.name)).join(", ") })
                    : !on && missing.length
                      ? t("set.nejdrivZapnete", { description: t.lbl(m.description), p: missing.map((d) => t.lbl(MODULES.find((x) => x.key === d)!.name)).join(", ") })
                      : t.lbl(m.description)
                }
              />
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("set.metodikaHodnoceniRizik")}
          subtitle={t("set.dle8APrilohyC")}
        />
        <div className="space-y-4 p-5">
          <Field
            label={t("set.metodika")}
            hint={t("set.vyhlaskaVypocetNizeOctaveAllegro")}
          >
            <RiskMethodologySelect value={s.riskPolicy.methodology || BUILTIN_RISK_METHODOLOGY} onChange={(v) => setS({ ...s, riskPolicy: { ...s.riskPolicy, methodology: v } })} />
          </Field>
          {(s.riskPolicy.methodology || BUILTIN_RISK_METHODOLOGY) === BUILTIN_RISK_METHODOLOGY && (
          <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("set.funkceProUrceniRizika")}>
              <Select
                value={s.riskPolicy.method}
                onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, method: e.target.value as Settings["riskPolicy"]["method"], bounds: null } })}
              >
                <option value="three_factor">{t("set.hodnotaAktivaHrozbaZranitelnostVyhlaska")}</option>
                <option value="two_factor">{t("set.dopadPravdepodobnostScenareSloucenaHrozb")}</option>
              </Select>
            </Field>
            <Field label={t("set.pocetUrovniStupnicMatice")} hint={t("set.4UrovnePresneStupniceVyhlasky")}>
              <Select value={s.riskPolicy.levels} onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, levels: Number(e.target.value) as 3 | 4 | 5, bounds: null } })}>
                <option value={3}>3 × 3</option>
                <option value={4}>{t("set.44Vyhlaska")}</option>
                <option value={5}>5 × 5</option>
              </Select>
            </Field>
            <Field label={t("set.kriteriumAkceptovatelnosti8Odst1")}>
              <Select value={s.riskPolicy.acceptLevel} onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, acceptLevel: e.target.value as "low" | "medium" } })}>
                <option value="low">{t("set.akceptovatelnaJsouJenNizkaRizika")}</option>
                <option value="medium">{t("set.akceptovatelnaJsouNizkaAStredni")}</option>
              </Select>
            </Field>
            <Field label={t("set.intervalPravidelnehoHodnoceniMesice")} hint={t("set.vyhlaskaAlesponJednouRocneA")}>
              <Input
                type="number"
                min={1}
                max={12}
                value={s.riskPolicy.reviewMonths}
                onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, reviewMonths: Number(e.target.value) } })}
              />
            </Field>
          </div>
          {(() => {
            const lv = s.riskPolicy.levels;
            const tx = effectiveBounds(s.riskPolicy);
            const max = maxScore(s.riskPolicy.method, lv);
            const upd = (k: keyof typeof tx) => (e: { target: { value: string } }) =>
              setS({ ...s, riskPolicy: { ...s.riskPolicy, bounds: { ...tx, [k]: Number(e.target.value) } } });
            return (
              <>
              <div className="text-sm font-medium text-slate-700">
                {t("set.hraniceUrovniRizikaSkore1")}{max}){" "}
                {s.riskPolicy.bounds && (
                  <button type="button" className="ml-2 text-xs font-normal text-brand-700 hover:underline" onClick={() => setS({ ...s, riskPolicy: { ...s.riskPolicy, bounds: null } })}>
                    {t("set.obnovitVychozi")}
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={`${RISK_LABELS.level.low} do`}>
                  <Input type="number" min={1} max={max} value={tx.maxLow} onChange={upd("maxLow")} />
                </Field>
                <Field label={`${RISK_LABELS.level.medium} do`}>
                  <Input type="number" min={1} max={max} value={tx.maxMedium} onChange={upd("maxMedium")} />
                </Field>
                <Field label={`${RISK_LABELS.level.high} do`}>
                  <Input type="number" min={1} max={max} value={tx.maxHigh} onChange={upd("maxHigh")} />
                </Field>
                <Field label={RISK_LABELS.level.critical}>
                  <Input disabled value={`${tx.maxHigh + 1}–${max}`} />
                </Field>
              </div>
              <details className="rounded-md border border-slate-200 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-slate-700">{t("set.prevodniTabulkaStupnicNaUrovne", { lv: lv })}</summary>
                <table className="mt-2 w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">{t("set.uroven")}</th>
                      <th className="py-1 pr-2">{t("set.nazev")}</th>
                      <th className="py-1">{t("set.odpovidaUrovniVyhlasky")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locScale(scaleFor("threat", lv)).map((st) => (
                      <tr key={st.value} className="border-t border-slate-100">
                        <td className="py-1 pr-2 tabular-nums">{st.value}</td>
                        <td className="py-1 pr-2">{st.name}</td>
                        <td className="py-1">{st.decree.map((d) => t.lbl(DECREE_LEVEL_NAMES[d])).join(t("set.az"))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              </>
            );
          })()}
          </>
          )}
          {(s.riskPolicy.methodology || BUILTIN_RISK_METHODOLOGY) !== BUILTIN_RISK_METHODOLOGY && (
            <Field label={t("set.intervalPravidelnehoHodnoceniMesice")} hint={t("set.vyhlaskaAlesponJednouRocneA2")}>
              <Input type="number" min={1} max={12} value={s.riskPolicy.reviewMonths} onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, reviewMonths: Number(e.target.value) } })} />
            </Field>
          )}
          <div className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 text-sm font-medium text-slate-700">{t("set.kvantitativniAnalyzaFairPasmaOcekavane")}</div>
            <div className="grid gap-4 sm:grid-cols-4">
              {(
                [
                  ["maxLow", `${RISK_LABELS.level.low} do`],
                  ["maxMedium", `${RISK_LABELS.level.medium} do`],
                  ["maxHigh", `${RISK_LABELS.level.high} do`],
                ] as const
              ).map(([k, l]) => (
                <Field key={k} label={l}>
                  <Input type="number" min={0} step={10000} value={s.riskPolicy.quant[k]} onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, quant: { ...s.riskPolicy.quant, [k]: Number(e.target.value) || 0 } } })} />
                </Field>
              ))}
              <Field label={t("set.ochotaNestRizikoKcRok")} hint={t("set.rocniZtrataS95Pravdepodobnosti")}>
                <Input
                  type="number"
                  min={0}
                  step={100000}
                  value={s.riskPolicy.quant.appetiteYear ?? ""}
                  onChange={(e) => setS({ ...s, riskPolicy: { ...s.riskPolicy, quant: { ...s.riskPolicy.quant, appetiteYear: e.target.value ? Number(e.target.value) : null } } })}
                />
              </Field>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {t("set.ulozitNastaveni")}
        </Button>
        {save.isSuccess && <SuccessBox>{t("set.ulozeno")}</SuccessBox>}
      </div>
      <ErrorBox error={save.error} />
    </div>
  );
}

/** Volitelné kategorie Trust Services Criteria v rozsahu zprávy SOC 2. */
export function Soc2Scope({ value, onChange }: { value: (typeof SOC2_OPTIONAL)[number][]; onChange: (v: (typeof SOC2_OPTIONAL)[number][]) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1">
      <Checkbox checked disabled onChange={() => {}} label={t("set.bezpecnostCc")} />
      {SOC2_OPTIONAL.map((k) => (
        <Checkbox key={k} checked={value.includes(k)} onChange={(v) => onChange(v ? [...value, k] : value.filter((x) => x !== k))} label={SOC2_CATEGORIES[k]} />
      ))}
    </div>
  );
}
