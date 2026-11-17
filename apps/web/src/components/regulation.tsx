import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, FormSection, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import {
  REGULATED_SERVICES,
  RS_SECTORS,
  SIZE_LABELS,
  evaluateRegulation,
  regulatedService,
  sizeFromInput,
  type EnterpriseSize,
  type RegimeLevel,
  type RegulationAssessmentDto,
  type ResLookupDto,
  type RsAnswer,
  type CompanyDto,
  type RegistrationData,
  type RegistrationDto,
} from "@contix/shared";
import { PositionSelect } from "@/components/pickers";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Database, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/* ============================================================
 * Určení regulace (v1.61, ADR-156): RES (ČSÚ) → návrh služeb a velikosti → potvrzení podmínek přílohy
 * vyhl. 408/2025 → režim. Pro vlastní společnost (lze zapsat do profilu) i pro dodavatele.
 * ============================================================ */

const REGIME_TONE: Record<RegimeLevel | "none", "red" | "amber" | "slate"> = { higher: "red", lower: "amber", none: "slate" };

export function RegimeBadge({ regime }: { regime: RegimeLevel | "none" }) {
  const t = useT();
  return <Badge tone={REGIME_TONE[regime]}>{t(`rg.regime.${regime}`)}</Badge>;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

/** Administrace → Společnosti: výběr společnosti a její určení regulace. */
export function CompanyRegulationCard({ companies }: { companies: CompanyDto[] }) {
  const t = useT();
  const [id, setId] = useState(companies[0]?.id ?? "");
  const co = companies.find((c) => c.id === id);
  if (!co) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <Select value={id} onChange={(e) => setId(e.target.value)} className="w-72" aria-label={t("br.company")}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {" ".repeat(c.depth * 3)}
              {c.name}
            </option>
          ))}
        </Select>
        {co.pack === "cz" && <span className="text-xs text-slate-500">{t("rg.currentRegime")}: {t(`rg.regime.${co.regime}`)}</span>}
      </div>
      <RegulationCard subjectKind="company" subjectId={co.id} ico={co.ico ?? null} canEdit canApply={co.pack === "cz"} />
      {co.pack === "cz" && <RegistrationCard companyId={co.id} />}
    </div>
  );
}

const REG_STATUS_TONE = { not_required: "slate", to_notify: "red", notified: "green", changes_pending: "amber" } as const;
type RegForm = Omit<RegistrationData, "responsiblePositionId"> & { responsiblePositionId: string | null };

/** Ohlášení regulované služby NÚKIB (v1.63): podklad, stav ohlášení, změny k ohlášení se lhůtou. */
export function RegistrationCard({ companyId }: { companyId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["registration", companyId], queryFn: () => api.regulation.registration(companyId) });
  const d = q.data;
  const [f, setF] = useState<RegForm | null>(null);
  const [notifiedAt, setNotifiedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notifiedRef, setNotifiedRef] = useState("");
  const [mark, setMark] = useState(false);
  useEffect(() => {
    if (d) setF({ ...d.data });
  }, [d]);
  const done = (x: RegistrationDto) => {
    qc.setQueryData(["registration", companyId], x);
    qc.invalidateQueries({ queryKey: ["obligations"] });
  };
  const save = useMutation({ mutationFn: () => api.regulation.saveRegistration(companyId, f!), onSuccess: done });
  const notified = useMutation({ mutationFn: () => api.regulation.notified(companyId, { notifiedAt, notifiedRef }), onSuccess: (x) => { done(x); setMark(false); } });
  if (!d || !f) return null;
  const set = (k: keyof RegForm, v: string | null) => setF({ ...f, [k]: v });
  const field = (k: Exclude<keyof RegForm, "responsiblePositionId">, label: string, opts: { area?: boolean; span?: string; ph?: string } = {}) => (
    <Field label={label} className={opts.span}>
      {opts.area ? <Textarea rows={2} value={f[k] as string} onChange={(e) => set(k, e.target.value)} placeholder={opts.ph} /> : <Input value={f[k] as string} onChange={(e) => set(k, e.target.value)} placeholder={opts.ph} />}
    </Field>
  );
  return (
    <Card className="mt-6" data-testid="registration-card">
      <CardHeader
        title={t("rg.reg.title")}
        subtitle={t("rg.reg.sub")}
        action={
          <div className="flex shrink-0 gap-2 whitespace-nowrap">
            <a href={api.regulation.registrationUrl(companyId, "html")} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
              {t("rg.reg.print")}
            </a>
            <a href={api.regulation.registrationUrl(companyId, "docx")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
              Word
            </a>
          </div>
        }
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="rg-reg-status">
          <Badge tone={REG_STATUS_TONE[d.status]}>{t(`rg.reg.status.${d.status}`)}</Badge>
          <RegimeBadge regime={d.regime} />
          {d.due && <span className="text-slate-600">{t("rg.reg.due", { date: d.due })}</span>}
          {d.notifiedAt && (
            <span className="text-xs text-slate-500">
              {t("rg.reg.notifiedAt", { date: d.notifiedAt })}
              {d.notifiedRef ? ` · ${d.notifiedRef}` : ""}
            </span>
          )}
        </div>
        {d.regimeMismatch && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="rg-reg-mismatch">
            {t("rg.reg.mismatch", { profile: t(`rg.regime.${d.regime}`), assessment: t(`rg.regime.${d.assessmentRegime ?? "none"}`) })}
          </p>
        )}
        {d.services.length > 0 && (
          <ul className="text-sm">
            {d.services.map((s) => (
              <li key={s.code}>
                <span className="font-mono text-xs text-slate-500">{s.code}</span> {s.name}
              </li>
            ))}
          </ul>
        )}
        {d.changes.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="rg-reg-changes">
            <p className="font-medium text-amber-900">{t("rg.reg.changes")}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
              {d.changes.map((c) => (
                <li key={c.field}>
                  <b>{t.lbl(c.label)}:</b> {c.before || "—"} → {c.after || "—"}
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.missing.length > 0 && <p className="text-sm text-amber-700">{t("rg.reg.missing", { list: d.missing.join(", ") })}</p>}
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          <FormSection title={t("rg.reg.sec.provider")}>
            <div className="grid gap-4 sm:grid-cols-3">
              {field("statutoryBody", t("rg.reg.f.statutory"), { area: true, span: "sm:col-span-3", ph: t("rg.reg.f.statutoryPh") })}
              {field("dataBox", t("rg.reg.f.dataBox"))}
              {field("contactEmail", t("rg.reg.f.email"))}
              {field("contactPhone", t("rg.reg.f.phone"))}
            </div>
          </FormSection>
          <FormSection title={t("rg.reg.sec.officer")}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {field("kbName", t("rg.reg.f.kbName"))}
              {field("kbRole", t("rg.reg.f.kbRole"))}
              {field("kbEmail", t("rg.reg.f.kbEmail"))}
              {field("kbPhone", t("rg.reg.f.kbPhone"))}
            </div>
          </FormSection>
          <FormSection title={t("rg.reg.sec.extra")}>
            <div className="grid gap-4 sm:grid-cols-3">
              {field("ipRanges", t("rg.reg.f.ip"), { area: true, ph: "192.0.2.0/24" })}
              {field("domains", t("rg.reg.f.domains"), { area: true, ph: "example.cz" })}
              {field("memberStates", t("rg.reg.f.states"), { area: true })}
              <Field label={t("rg.reg.f.position")} hint={t("rg.reg.f.positionHint")}>
                <PositionSelect value={f.responsiblePositionId} onChange={(v) => set("responsiblePositionId", v)} ariaLabel={t("rg.reg.f.position")} />
              </Field>
              {field("note", t("rg.note"), { area: true, span: "sm:col-span-2" })}
            </div>
          </FormSection>
        </div>
        <ErrorBox error={save.error ?? notified.error} />
        <div className="flex flex-wrap items-end gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="rg-reg-save">
            {t("rg.reg.save")}
          </Button>
          {!mark ? (
            d.regime !== "none" && (
              <Button variant="secondary" onClick={() => setMark(true)} data-testid="rg-reg-mark">
                {d.notifiedAt ? t("rg.reg.markChange") : t("rg.reg.mark")}
              </Button>
            )
          ) : (
            <>
              <Field label={t("rg.reg.f.notifiedAt")}>
                <Input type="date" value={notifiedAt} onChange={(e) => setNotifiedAt(e.target.value)} />
              </Field>
              <Field label={t("rg.reg.f.ref")}>
                <Input value={notifiedRef} onChange={(e) => setNotifiedRef(e.target.value)} />
              </Field>
              <Button onClick={() => notified.mutate()} disabled={notified.isPending} data-testid="rg-reg-confirm">
                {t("rg.reg.confirm")}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-slate-500">{t("rg.reg.hint")}</p>
      </div>
    </Card>
  );
}

/** Karta s posledním posouzením a průvodcem nového. */
export function RegulationCard({ subjectKind, subjectId, ico, canEdit, canApply, className }: { subjectKind: "company" | "supplier"; subjectId: string; ico: string | null; canEdit: boolean; canApply?: boolean; className?: string }) {
  const t = useT();
  const list = useQuery({ queryKey: ["regulation", subjectKind, subjectId], queryFn: () => api.regulation.list(subjectKind, subjectId), enabled: !!subjectId });
  const [open, setOpen] = useState(false);
  const last = list.data?.[0] ?? null;
  useEffect(() => setOpen(false), [subjectId]);
  return (
    <Card className={className} data-testid="regulation-card">
      <CardHeader
        title={t("rg.title")}
        subtitle={subjectKind === "company" ? t("rg.subCompany") : t("rg.subSupplier")}
        action={
          canEdit && !open ? (
            <Button variant="secondary" onClick={() => setOpen(true)} data-testid="rg-new">
              <Scale size={14} /> <span className="whitespace-nowrap">{last ? t("rg.again") : t("rg.start")}</span>
            </Button>
          ) : undefined
        }
      />
      <ErrorBox error={list.error} />
      {!open && last && <Summary a={last} />}
      {!open && !last && !list.isLoading && <p className="px-5 pb-5 text-sm text-slate-500">{t("rg.none")}</p>}
      {open && <Wizard subjectKind={subjectKind} subjectId={subjectId} ico={ico} prev={last} canApply={!!canApply} onDone={() => setOpen(false)} />}
      {!open && (list.data?.length ?? 0) > 1 && (
        <details className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <summary className="cursor-pointer">{t("rg.history", { n: list.data!.length - 1 })}</summary>
          <ul className="mt-2 space-y-1">
            {list.data!.slice(1).map((a) => (
              <li key={a.id}>
                {fmtDate(a.assessedAt)} · {t(`rg.regime.${a.result.regime}`)} · {a.size ? t.lbl(SIZE_LABELS[a.size]) : "—"} · {a.assessedByName ?? "—"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Summary({ a }: { a: RegulationAssessmentDto }) {
  const t = useT();
  const regulated = a.result.services.filter((s) => s.regime);
  return (
    <div className="space-y-2 px-5 pb-5 text-sm" data-testid="rg-summary">
      <div className="flex flex-wrap items-center gap-2">
        <RegimeBadge regime={a.result.regime} />
        {a.size && <span className="text-slate-600">{t.lbl(SIZE_LABELS[a.size])}</span>}
        <span className="text-xs text-slate-400">
          {t(`rg.basis.${a.sizeBasis}`)} · {fmtDate(a.assessedAt)} · {a.assessedByName ?? "—"}
          {a.applied && ` · ${t("rg.applied")}`}
        </span>
      </div>
      {regulated.length ? (
        <ul className="space-y-0.5">
          {regulated.map((s) => (
            <li key={s.code} className="flex gap-2">
              <span className="w-12 shrink-0 font-mono text-xs text-slate-500">{s.code}</span>
              <span className="min-w-0 flex-1">{regulatedService(s.code)?.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{t(`rg.regime.${s.regime!}`)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500">{t("rg.noService")}</p>
      )}
      {a.note && <p className="whitespace-pre-wrap text-xs text-slate-500">{a.note}</p>}
    </div>
  );
}

function Wizard({ subjectKind, subjectId, ico: ico0, prev, canApply, onDone }: { subjectKind: "company" | "supplier"; subjectId: string; ico: string | null; prev: RegulationAssessmentDto | null; canApply: boolean; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [ico, setIco] = useState(prev?.ico ?? ico0 ?? "");
  const [res, setRes] = useState<ResLookupDto | null>((prev?.res as ResLookupDto | null) ?? null);
  const [staff, setStaff] = useState(prev?.staff != null ? String(prev.staff) : "");
  const [turnover, setTurnover] = useState(prev?.turnoverMCzk != null ? String(prev.turnoverMCzk) : "");
  const [balance, setBalance] = useState(prev?.balanceMCzk != null ? String(prev.balanceMCzk) : "");
  const [rate, setRate] = useState(prev?.eurRate != null ? String(prev.eurRate) : "");
  const [override, setOverride] = useState<EnterpriseSize | "">(prev?.sizeOverride ?? "");
  const [linked, setLinked] = useState(prev?.linkedNote ?? "");
  const [answers, setAnswers] = useState<RsAnswer[]>(prev?.services ?? []);
  const [note, setNote] = useState("");
  const [apply, setApply] = useState(canApply);
  const [browse, setBrowse] = useState(false);
  const lookup = useMutation({
    mutationFn: () => api.ares.res(ico.trim()),
    // návrhy se nezaškrtávají samy – CZ-NACE je jen vodítko (např. oddíl 62 odpovídá pěti službám)
    onSuccess: (d) => setRes(d),
  });
  const sz = sizeFromInput({ staff: num(staff), turnoverMCzk: num(turnover), balanceMCzk: num(balance), eurRate: num(rate), sizeOverride: override || null, resSize: res?.subject.sizeEstimate ?? null });
  const size = sz.size;
  const result = useMemo(() => evaluateRegulation(size, answers), [size, answers]);
  const selected = new Set(answers.map((a) => a.code));
  const toggle = (code: string, on: boolean) => setAnswers(on ? [...answers, { code, conds: {} }].sort((a, b) => cmp(a.code, b.code)) : answers.filter((a) => a.code !== code));
  const setCond = (code: string, id: string, v: boolean) => setAnswers(answers.map((a) => (a.code === code ? { ...a, conds: { ...a.conds, [id]: v } } : a)));
  const save = useMutation({
    mutationFn: () =>
      api.regulation.save({
        subjectKind,
        subjectId,
        ico: /^\d{8}$/.test(ico.trim()) ? ico.trim() : null,
        staff: num(staff),
        turnoverMCzk: num(turnover),
        balanceMCzk: num(balance),
        eurRate: num(rate),
        sizeOverride: override || null,
        resSize: res?.subject.sizeEstimate ?? null,
        linkedNote: linked,
        services: answers,
        note,
        apply: canApply && apply,
        res: res as unknown as Record<string, unknown> | null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["regulation", subjectKind, subjectId] });
      if (canApply && apply) qc.invalidateQueries({ queryKey: ["companies"] });
      onDone();
    },
  });
  const suggested = res?.suggestions ?? [];
  return (
    <div className="space-y-5 border-t border-slate-100 p-5" data-testid="rg-wizard">
      {/* 1. RES */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">{t("rg.step.res")}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("rg.ico")}>
            <Input value={ico} onChange={(e) => setIco(e.target.value)} className="w-36" inputMode="numeric" />
          </Field>
          <Button variant="secondary" disabled={!/^\d{6,8}$/.test(ico.trim()) || lookup.isPending} onClick={() => lookup.mutate()} data-testid="rg-res">
            <Database size={14} /> {t("rg.loadRes")}
          </Button>
        </div>
        <ErrorBox error={lookup.error} />
        {res && (
          <div className="grid gap-x-6 gap-y-1 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-2" data-testid="rg-res-data">
            <div className="sm:col-span-2 font-medium text-slate-800">
              {res.subject.name} <span className="font-normal text-slate-500">· {res.subject.ico}</span>
            </div>
            <div>
              {t("rg.res.primary")}: <b>{res.subject.primaryNace ?? "—"}</b>
            </div>
            <div>
              {t("rg.res.employees")}: <b>{res.subject.employeeClassLabel ?? "—"}</b>
              {res.subject.sizeEstimate && <span className="text-slate-500"> → {t.lbl(SIZE_LABELS[res.subject.sizeEstimate])}</span>}
            </div>
            <div>
              {t("rg.res.esa")}: <b>{res.subject.esaSector ?? "—"}</b>
            </div>
            <div>
              {t("rg.res.founded")}: <b>{res.subject.foundedAt ?? "—"}</b>
            </div>
            <div className="sm:col-span-2 text-xs text-slate-500">
              {t("rg.res.nace")}: {res.subject.nace.join(", ") || "—"}
            </div>
          </div>
        )}
      </section>

      {/* 2. Velikost */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">{t("rg.step.size")}</h3>
        <p className="text-xs text-slate-500">{t("rg.size.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t("rg.size.staff")}>
            <Input value={staff} onChange={(e) => setStaff(e.target.value)} inputMode="numeric" placeholder={res?.subject.employeeClassLabel ?? ""} />
          </Field>
          <Field label={t("rg.size.turnover")}>
            <Input value={turnover} onChange={(e) => setTurnover(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={t("rg.size.balance")}>
            <Input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={t("rg.size.rate")} hint={t("rg.size.rateHint")}>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="24,3" />
          </Field>
          <Field label={t("rg.size.override")}>
            <Select value={override} onChange={(e) => setOverride(e.target.value as EnterpriseSize | "")}>
              <option value="">{t("rg.size.auto")}</option>
              {(["micro", "small", "medium", "large"] as const).map((x) => (
                <option key={x} value={x}>
                  {t.lbl(SIZE_LABELS[x])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("rg.size.linked")} className="sm:col-span-3">
            <Input value={linked} onChange={(e) => setLinked(e.target.value)} placeholder={t("rg.size.linkedPh")} />
          </Field>
        </div>
        <p className="text-sm" data-testid="rg-size">
          {size ? (
            <>
              <b>{t.lbl(SIZE_LABELS[size])}</b> <span className="text-xs text-slate-500">({t(`rg.basis.${sz.basis}`)})</span>
            </>
          ) : (
            <span className="text-amber-700">{t("rg.size.unknown")}</span>
          )}
        </p>
      </section>

      {/* 3. Služby */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">{t("rg.step.services")}</h3>
        {suggested.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-slate-500">{t("rg.suggested")}</p>
            {suggested.map((x) => (
              <Checkbox
                key={x.code}
                checked={selected.has(x.code)}
                onChange={(v) => toggle(x.code, v)}
                label={
                  <span data-testid={`rg-sug-${x.code}`}>
                    <span className="font-mono text-xs text-slate-500">{x.code}</span> {regulatedService(x.code)?.name}
                    {x.primary && <span className="ml-1"><Badge tone="blue">{t("rg.primary")}</Badge></span>}
                  </span>
                }
                hint={x.via.join(", ")}
              />
            ))}
          </div>
        )}
        <button type="button" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" onClick={() => setBrowse(!browse)}>
          <ChevronRight size={14} className={browse ? "rotate-90" : ""} /> {t("rg.browse")}
        </button>
        {browse && (
          <div className="max-h-96 space-y-2 overflow-auto rounded-md border border-slate-200 p-3">
            {Object.entries(RS_SECTORS).map(([n, name]) => (
              <details key={n}>
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  {n}. {name}
                </summary>
                <div className="mt-1 space-y-1 pl-4">
                  {REGULATED_SERVICES.filter((d) => d.sector === Number(n)).map((d) => (
                    <Checkbox key={d.code} checked={selected.has(d.code)} onChange={(v) => toggle(d.code, v)} label={<span><span className="font-mono text-xs text-slate-500">{d.code}</span> {d.name}</span>} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
        {answers.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {answers.map((a) => {
              const d = regulatedService(a.code)!;
              const r = result.services.find((x) => x.code === a.code)!;
              return (
                <div key={a.code} className="space-y-1.5 p-3 text-sm" data-testid={`rg-svc-${a.code}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{a.code}</span>
                    <span className="min-w-0 flex-1 font-medium">{d.name}</span>
                    {r.regime ? <RegimeBadge regime={r.regime} /> : <Badge>{t("rg.notRegulated")}</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">
                    {t("rg.subject")}: {d.subject}
                  </p>
                  {(d.conds ?? []).map((cd) => (
                    <Checkbox key={cd.id} checked={!!a.conds[cd.id]} onChange={(v) => setCond(a.code, cd.id, v)} label={<span className="text-xs">{cd.text}</span>} />
                  ))}
                  <p className="text-xs text-slate-500">{r.reason}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Výsledek */}
      <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="rg-result">
          <span className="font-semibold">{t("rg.result")}</span> <RegimeBadge regime={result.regime} />
          {result.regime !== "none" && <span className="text-xs text-slate-500">{t(`rg.resultHint.${result.regime}`)}</span>}
        </div>
        <p className="text-xs text-slate-500">{t("rg.disclaimer")}</p>
        <Field label={t("rg.note")}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("rg.notePh")} />
        </Field>
        {canApply && <Checkbox checked={apply} onChange={setApply} label={t("rg.apply")} hint={t("rg.applyHint")} />}
        <ErrorBox error={save.error} />
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="rg-save">
            {t("rg.save")}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t("common.cancelAction")}
          </Button>
        </div>
      </section>
    </div>
  );
}

const cmp = (a: string, b: string) => {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return a1! - b1! || a2! - b2!;
};
