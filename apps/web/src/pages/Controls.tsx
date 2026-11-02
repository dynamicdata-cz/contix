import { useUrlBatch, useUrlSort } from "@/lib/urlState";
import { SavedViews, SortTh } from "@/components/listTools";
import { useDebounced } from "@/lib/utils";
import { useUrlFlag, useUrlParam } from "@/lib/urlState";
import { FrameworkOptions } from "@/components/frameworkOptions";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import { useDecree } from "@/lib/regime";
import { NeedsCompany, useGroupView } from "@/components/company";
import { ComplianceBar, ComplianceLegend, ControlStatusBadge, ScoreValue } from "@/components/compliance";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import { CONTROL_LABELS, CONTROL_STATUSES, FRAMEWORKS, sortRows, type FrameworkId } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, ClipboardCheck, Library, FileCheck2, Link2, Plus, ShieldCheck, Wand2 } from "lucide-react";
import { useState } from "react";

export const fwShort = (id: FrameworkId) => FRAMEWORKS.find((f) => f.id === id)?.shortName ?? id;

export function ControlsPage() {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const group = useGroupView();
  const fws = useQuery({ queryKey: ["controls", "frameworks"], queryFn: api.controls.frameworks, enabled: !group });
  const [q, setQ] = useUrlParam("q");
  const [status, setStatus] = useUrlParam("status");
  const [framework, setFramework] = useUrlParam("framework");
  const dq = useDebounced(q);
  const [sort, setSort] = useUrlSort<"name" | "category" | "status" | "effectiveness" | "owner" | "reqs" | "risks">();
  const batch = useUrlBatch();
  const list = useQuery({ queryKey: ["controls", "list", dq, status, framework], queryFn: () => api.controls.list({ q: dq, status, framework }) });
  const decree = useDecree();
  const [selected, setSelected] = useState<FrameworkId>(decree);
  const [gen, setGen] = useState(false);
  const [cross, setCross] = useState(false);
  const cur = fws.data?.find((f) => f.id === selected);

  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("ctl.opatreniAShoda")}
        subtitle={t("ctl.katalogBezpecnostnichOpatreniOrganizaceN")}
        actions={
          <>
            <Link to="/controls/assurance">
              <Button variant="secondary">
                <ClipboardCheck size={16} /> {t("ctl.testyADukazy")}
              </Button>
            </Link>
            <Link to="/controls/library">
              <Button variant="secondary">
                <Library size={16} /> {t("fwl.title")}
              </Button>
            </Link>
            <Link to="/controls/monitoring">
              <Button variant="secondary">
                <Activity size={16} /> {t("mon.title")}
              </Button>
            </Link>
            <Link to="/controls/sca">
              <Button variant="secondary">
                <ShieldCheck size={16} /> {t("sca.title")}
              </Button>
            </Link>
            <Link to="/controls/soa" search={{ framework: selected }}>
              <Button variant="secondary">
                <FileCheck2 size={16} /> {t("ctl.prohlaseniOAplikovatelnosti")}
              </Button>
            </Link>
            {can("controls:write") && (
              <>
                <Button variant="secondary" onClick={() => setGen(true)}>
                  <Wand2 size={16} /> {t("ctl.vychoziKatalog")}
                </Button>
                {!group && (
                  <Button variant="secondary" onClick={() => setCross(true)}>
                    <Link2 size={16} /> {t("ctl.doplnitMapovani")}
                  </Button>
                )}
                <Button onClick={() => nav({ to: "/controls/new" })}>
                  <Plus size={16} /> {t("ctl.noveOpatreni")}
                </Button>
              </>
            )}
          </>
        }
      />
      <ErrorBox error={fws.error ?? list.error} />
      {group && <NeedsCompany what={t("ctl.miraShodyAProhlaseniO")}>{null}</NeedsCompany>}

      <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {[...(fws.data ?? [])].sort((a, b) => Number(b.inScope) - Number(a.inScope)).map((f) => (
          <button
            key={f.id}
            onClick={() => setSelected(f.id)}
            className={cn(
              "rounded-lg border bg-white p-4 text-left shadow-sm transition",
              selected === f.id ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300",
              !f.inScope && selected !== f.id && "opacity-50",
            )}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
              {f.shortName}
              {!f.inScope && <span className="font-normal text-slate-400">{t("ctl.outOfScope")}</span>}
            </div>
            <ScoreValue score={f.summary.score} className="text-2xl" />
            <div className="mb-2 text-xs text-slate-500">
              {t("ctl.zAplikovatelnych", { applicable: f.summary.applicable, total: f.summary.total })}
            </div>
            <ComplianceBar counts={f.summary.byCompliance} />
          </button>
        ))}
      </div>

      {cur && (
        <Card className="mb-6">
          <CardHeader
            title={t("ctl.miraShody", { name: cur.name })}
            subtitle={t("ctl.splneno100Castecne50Neaplikovane", { description: cur.description })}
            action={
              <Link to="/controls/soa" search={{ framework: cur.id }} className="text-sm text-brand-600 hover:underline">
                {t("ctl.detailPozadavku")}
              </Link>
            }
          />
          <div className="space-y-2 p-5">
            <ComplianceLegend counts={cur.summary.byCompliance} />
            <div className="mt-3 space-y-1.5">
              {cur.summary.sections.map((s) => (
                <Link
                  key={s.section}
                  to="/controls/soa"
                  search={{ framework: cur.id, section: s.section }}
                  className="grid grid-cols-[minmax(0,16rem)_1fr_4rem] items-center gap-3 rounded px-1 py-0.5 text-sm hover:bg-slate-50"
                >
                  <span className="truncate text-slate-700" title={`${s.section} ${s.title}`}>
                    <span className="text-slate-400">{s.section}</span> {s.title}
                  </span>
                  <ComplianceBar counts={s.byCompliance} height={8} />
                  <ScoreValue score={s.score} className="text-right text-xs" />
                </Link>
              ))}
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader title={t("ctl.katalogOpatreni")} />
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input className="max-w-xs" placeholder={t("ctl.hledatKodNeboNazev")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("ctl.vsechnyStavy")}</option>
            {CONTROL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(CONTROL_LABELS.status[s])}
              </option>
            ))}
          </Select>
          <Select className="w-44" value={framework} onChange={(e) => setFramework(e.target.value)}>
            <option value="">{t("ctl.vsechnyRamce")}</option>
            <FrameworkOptions label="short" />
          </Select>
          <SavedViews
            page="controls"
            state={{ q, status, framework, sort: sort ? `${sort.key}:${sort.dir}` : "" }}
            onApply={(v) => batch({ q: String(v.q ?? ""), status: String(v.status ?? ""), framework: String(v.framework ?? ""), sort: String(v.sort ?? "") })}
            onReset={() => batch({ q: "", status: "", framework: "", sort: "" })}
          />
          <span className="ml-auto self-center text-sm text-slate-500">{t("ctl.opatreni", { p: list.data?.length ?? 0 })}</span>
        </div>
        {list.data?.length === 0 ? (
          <EmptyState>
            {t("ctl.zatimZadnaOpatreniNejrychlejsiStart")} <b>{t("ctl.vychoziKatalog")}</b> {t("ctl.vytvoriOpatreniProKazdyVyhlasky")}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <SortTh k="name" label={t("ctl.opatreni2")} sort={sort} onSort={setSort} className="pl-5" />
                  <SortTh k="category" label={t("ctl.druh")} sort={sort} onSort={setSort} />
                  <SortTh k="status" label={t("ctl.stav")} sort={sort} onSort={setSort} />
                  <SortTh k="effectiveness" label={t("ctl.ucinnost")} sort={sort} onSort={setSort} />
                  <SortTh k="owner" label={t("ctl.vlastnik")} sort={sort} onSort={setSort} />
                  <th className="px-3 py-2">{t("ctl.ramce")}</th>
                  <SortTh k="reqs" label={t("ctl.pozad")} sort={sort} onSort={setSort} className="text-right" firstDir="desc" />
                  <SortTh k="risks" label={t("ctl.rizika")} sort={sort} onSort={setSort} className="text-right" firstDir="desc" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(sort ? sortRows(list.data ?? [], (c) => (sort.key === "name" ? `${c.code ?? ""} ${c.name}` : sort.key === "category" ? c.category : sort.key === "status" ? CONTROL_STATUSES.indexOf(c.status) : sort.key === "effectiveness" ? c.effectiveness : sort.key === "owner" ? c.ownerPositionName : sort.key === "reqs" ? c.requirementCount : c.riskCount), sort.dir) : (list.data ?? [])).map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <Link to="/controls/$controlId" params={{ controlId: c.id }} className="font-medium text-slate-900 hover:text-brand-700">
                        {c.code && <span className="mr-1.5 text-slate-500">{c.code}</span>}
                        {c.name}
                      </Link>
                      {c.plannedDate && c.status !== "implemented" && <div className="text-xs text-slate-500">{t("ctl.plan", { p: fmtDay(c.plannedDate) })}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{t.lbl(CONTROL_LABELS.category[c.category])}</td>
                    <td className="px-3 py-2.5">
                      <ControlStatusBadge s={c.status} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{t.lbl(CONTROL_LABELS.effectiveness[c.effectiveness])}</td>
                    <td className="px-3 py-2.5 text-slate-600">{c.ownerPositionName ?? <span className="text-amber-700">{t("ctl.neurcen")}</span>}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {c.frameworks.map((f) => (
                          <Badge key={f}>{fwShort(f)}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.requirementCount}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.riskCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {gen && <GenerateModal onClose={() => setGen(false)} />}
      {cross && <CrosswalkModal onClose={() => setCross(false)} />}
    </>
  );
}

function GenerateModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [regime, setRegime] = useState<"higher" | "lower">("higher");
  const [cross, setCross] = useState(true);
  const g = useMutation({
    mutationFn: () => api.controls.generate(regime, cross),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["controls"] }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("ctl.vytvoritVychoziKatalogOpatreni")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {!g.data && (
            <Button disabled={g.isPending} onClick={() => g.mutate()}>
              {t("ctl.vytvorit")}
            </Button>
          )}
        </>
      }
    >
      <ErrorBox error={g.error} />
      {g.data ? (
        <SuccessBox>
          {t("ctl.vytvoreno")} {g.data.created} {t("ctl.opatreni3")}{g.data.skipped ? t("ctl.jizExistovaloPodleKodu", { skipped: g.data.skipped }) : ""}{t("ctl.doplnteVlastnikyStavAZpusob")}
        </SuccessBox>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {t("ctl.proKazdyVyhlaskySeZalozi")} <i>{t("ctl.v08RizeniRizik")}</i>{t("ctl.navazaneNaVsechnyJehoPozadavky")}
          </p>
          <Field label={t("ctl.rezimPovinnosti")}>
            <Select value={regime} onChange={(e) => setRegime(e.target.value as "higher" | "lower")}>
              <option value="higher">{t("ctl.vyssiPovinnostiVyhlaskaC409")}</option>
              <option value="lower">{t("ctl.nizsiPovinnostiVyhlaskaC410")}</option>
            </Select>
          </Field>
          <Checkbox
            checked={cross}
            onChange={setCross}
            label={t("ctl.namapovatINaPribuznePozadavky")}
            hint={t("ctl.orientacniMapovaniContixOvertePro")}
          />
        </>
      )}
    </Modal>
  );
}

/** Rámce, které lze doplnit k opatřením výchozího katalogu (V-xx / N-xx) podle mapování z vyhlášky 409. */
const CROSS_FRAMEWORKS: FrameworkId[] = ["nis2", "iso27001", "dora", "soc2", "cis8", "zkb", "cz410"];

function CrosswalkModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [sel, setSel] = useState<FrameworkId[]>(["nis2"]);
  const preview = useMutation({ mutationFn: () => api.controls.crosswalk({ frameworks: sel, apply: false }) });
  const apply = useMutation({
    mutationFn: () => api.controls.crosswalk({ frameworks: sel, apply: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["controls"] }),
  });
  const toggle = (f: FrameworkId, on: boolean) => {
    setSel((x) => (on ? [...x, f] : x.filter((y) => y !== f)));
    preview.reset();
  };
  const p = preview.data;
  return (
    <Modal
      open
      onClose={onClose}
      title={t("ctl.doplnitMapovaniOpatreni")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {!apply.data &&
            (p && p.total > 0 ? (
              <Button disabled={apply.isPending} onClick={() => apply.mutate()}>
                {t("ctl.doplnitVazeb", { total: p.total })}
              </Button>
            ) : (
              <Button disabled={!sel.length || preview.isPending} onClick={() => preview.mutate()}>
                {t("ctl.zobrazitNahled")}
              </Button>
            ))}
        </>
      }
    >
      <ErrorBox error={preview.error ?? apply.error} />
      {apply.data ? (
        <SuccessBox>
          {t("ctl.doplnenoVazebUOpatreniMira", { total: apply.data.total, length: apply.data.items.length })}
        </SuccessBox>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {t("ctl.kOpatrenimVychozihoKataloguKody")} <i>{t("ctl.vXx")}</i> {t("ctl.podleVyhlasky409A")} <i>{t("ctl.nXx")}</i> {t("ctl.podleVyhlasky410SePridaji")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...CROSS_FRAMEWORKS, ...FRAMEWORKS.filter((x) => x.custom).map((x) => x.id)].map((f) => (
              <Checkbox key={f} checked={sel.includes(f)} onChange={(on) => toggle(f, on)} label={FRAMEWORKS.find((x) => x.id === f)?.name ?? f} />
            ))}
          </div>
          {p &&
            (p.total === 0 ? (
              <SuccessBox>{t("ctl.neniCoDoplnitOpatreniKatalogu")}</SuccessBox>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">{t("ctl.opatreni2")}</th>
                      <th className="px-3 py-2">{t("ctl.pribude")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {p.items.map((i) => (
                      <tr key={i.controlId} className="align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium">{i.code}</div>
                          <div className="text-xs text-slate-500">{i.name}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {i.add.map((r) => (
                              <span key={r.id} title={r.text}>
                                <Badge tone="slate">
                                  {fwShort(r.framework)} {r.ref}
                                </Badge>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </>
      )}
    </Modal>
  );
}
