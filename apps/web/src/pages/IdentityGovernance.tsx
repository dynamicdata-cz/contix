import { askConfirm } from "@/components/ui/overlay";
import { useT, tt } from "@/lib/i18n";
import { CompanyCell, TargetCompanyField, useTargetCompany } from "@/components/company";
import { SeverityBadge } from "@/components/health";
import { IdMultiSelect, PositionSelect, flattenUnits, useOrg, type IdOption } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, fmtDate, fmtDay } from "@/lib/utils";
import {
  AUTOMATION_LABELS,
  IDENTITY_RULES,
  IDENTITY_RULE_INFO,
  type AutomationFrequency,
  type ControlAutomationDto,
  type ControlAutomationKind,
  ACCESS_REVIEW_LABELS,
  IDENTITY_LABELS,
  IDENTITY_SEVERITIES,
  type AccessReviewDetail,
  type AccessReviewItemDto,
  type AccessReviewerMode,
  type IdentitySeverity,
  type IdentitySourceDto,
  type SodRuleDto,
  type SodSide,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { CheckCircle2, Clock, Download, Plus, Printer, ShieldOff, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

/* ============================================================
 * Identity a přístupy II (v0.29) – toxické kombinace (SoD) a přezkum přístupů.
 * ============================================================ */

function usePositionOptions(): IdOption[] {
  const org = useOrg();
  return useMemo(
    () => flattenUnits(org.data ?? []).flatMap(({ unit }) => unit.positions.map((p) => ({ id: p.id, label: `${p.name} (${unit.name})`, hint: p.holders.map((h) => h.displayName).join(", ") || "neobsazeno" }))),
    [org.data],
  );
}
function useGroupOptions(): IdOption[] {
  const g = useQuery({ queryKey: ["identity", "groups"], queryFn: api.identity.groups });
  return useMemo(() => (g.data ?? []).map((x) => ({ id: x.name, label: x.name, hint: tt("idg.uctuSkupiny", { n: x.accounts, priv: x.privileged ? tt("idg.privilegovana") : "" }) })), [g.data]);
}

/** Výjimka s odůvodněním a termínem (společná pro porušení SoD). */
function ExceptionModal({ title, onSubmit, onClose }: { title: string; onSubmit: (d: { reason: string; until: string }) => Promise<unknown>; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(() => new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
  const m = useMutation({ mutationFn: () => onSubmit({ reason, until }), onSuccess: onClose });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("idg.vyjimka")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={reason.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
            {t("idg.udelitVyjimku")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("idg.vyjimkaJeVedomePrijetiRizika", { title: title })}</p>
      <Field label={t("idg.oduvodneniAKompenzacniOpatreni")}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t("idg.platiDo")} hint={t("idg.nejdele2Roky")}>
        <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/* ---------------- toxické kombinace ---------------- */

export function SodTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "accepted" | "resolved">(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("status") === "accepted" ? "accepted" : "open"));
  const [editing, setEditing] = useState<SodRuleDto | "new" | null>(null);
  const [accepting, setAccepting] = useState<{ id: string; title: string } | null>(null);
  const rules = useQuery({ queryKey: ["identity", "sod", "rules"], queryFn: api.identity.sodRules });
  const viol = useQuery({ queryKey: ["identity", "sod", "violations", status], queryFn: () => api.identity.sodViolations(status) });
  const evaluate = useMutation({ mutationFn: api.identity.evaluateSod, onSuccess: () => qc.invalidateQueries({ queryKey: ["identity", "sod"] }) });
  const reopen = useMutation({ mutationFn: api.identity.reopenSod, onSuccess: () => qc.invalidateQueries({ queryKey: ["identity", "sod"] }) });
  const side = (s: SodSide, names: Record<string, string>) => [...s.groups, ...s.positionIds.map((id) => t("idg.misto", { p: names[id] ?? "?" }))].join(", ");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {can("identity:write") && (
          <>
            <Button onClick={() => setEditing("new")}>
              <Plus size={15} /> {t("idg.novePravidlo")}
            </Button>
            <Button variant="secondary" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>
              {t("idg.vyhodnotitNyni")}
            </Button>
          </>
        )}
        <p className="text-sm text-slate-500">{t("idg.pravidlaSeVyhodnocujiPoKazde")}</p>
      </div>
      <ErrorBox error={rules.error ?? evaluate.error ?? reopen.error} />
      <Card className="mb-6">
        <CardHeader title={t("idg.pravidlaOddeleniPovinnosti")} subtitle={t("idg.osobaNesmiMitSoucasnePristup")} />
        {rules.data && !rules.data.length && <EmptyState>{t("idg.zatimZadnaPravidlaPrikladSpravce")}</EmptyState>}
        <div className="divide-y divide-slate-100">
          {rules.data?.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-5 py-3">
              <SeverityBadge severity={r.severity} />
              <div className="flex-1 text-sm">
                <div className="font-medium">
                  {r.name} {!r.enabled && <Badge tone="slate">{t("idg.vypnuto")}</Badge>}
                </div>
                <div className="text-xs text-slate-500">
                  <b>A:</b> {side(r.sideA, r.positionNames)} · <b>B:</b> {side(r.sideB, r.positionNames)}
                </div>
                {r.description && <div className="mt-0.5 text-xs text-slate-500">{r.description}</div>}
              </div>
              <span className={cn("text-sm font-semibold tabular-nums", r.open ? "text-red-700" : "text-slate-400")}>{t("idg.poruseni", { open: r.open })}</span>
              {can("identity:write") && (
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(r)}>
                  {t("idg.upravit")}
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-semibold">{t("idg.poruseni2")}</h2>
        <Select className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t("idg.stavPoruseni")}>
          <option value="open">{t("idg.otevrena")}</option>
          <option value="accepted">{t("idg.sVyjimkou")}</option>
          <option value="resolved">{t("idg.vyresena")}</option>
        </Select>
      </div>
      <Card>
        {viol.data && !viol.data.length ? (
          <EmptyState>{status === "open" ? t("idg.zadnaOtevrenaPoruseni") : t("common.nothingToShow")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t("idg.zavaznost")}</th>
                  <th className="px-3 py-2">{t("idg.pravidlo")}</th>
                  <th className="px-3 py-2">{t("idg.osobaUcty")}</th>
                  <th className="px-3 py-2">{t("idg.stranaA")}</th>
                  <th className="px-3 py-2">{t("idg.stranaB")}</th>
                  <th className="px-3 py-2">{status === "resolved" ? t("idg.vyreseno") : "Od"}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {viol.data?.map((v) => (
                  <tr key={v.id} className="align-top">
                    <td className="px-4 py-2">
                      <SeverityBadge severity={v.severity} />
                    </td>
                    <td className="px-3 py-2">{v.ruleName}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{v.person}</span>
                      <span className="block text-xs text-slate-500">{v.accounts.map((a) => `${a.login} (${a.sourceName})`).join(", ") || (v.contixUserId ? t("idg.uzivatelContixu") : "")}</span>
                      {v.status === "accepted" && (
                        <span className="mt-1 block text-xs text-amber-800">
                          {t("idg.vyjimkaDo", { p: fmtDay(v.acceptedUntil), p2: v.acceptedByName ?? "?", acceptedReason: v.acceptedReason })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{v.matchA.join(", ")}</td>
                    <td className="px-3 py-2 text-xs">{v.matchB.join(", ")}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtDate(status === "resolved" ? v.resolvedAt : v.firstSeenAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {can("identity:write") && v.status === "open" && (
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setAccepting({ id: v.id, title: `${v.ruleName}: ${v.person}` })}>
                          {t("idg.vyjimka")}
                        </Button>
                      )}
                      {can("identity:write") && v.status === "accepted" && (
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => reopen.mutate(v.id)}>
                          {t("idg.zrusitVyjimku")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <SodRuleModal initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {accepting && (
        <ExceptionModal
          title={accepting.title}
          onClose={() => setAccepting(null)}
          onSubmit={async (d) => {
            await api.identity.acceptSod(accepting.id, d);
            await qc.invalidateQueries({ queryKey: ["identity", "sod"] });
          }}
        />
      )}
    </>
  );
}

function SideEditor({ label, value, onChange, groups, positions }: { label: string; value: SodSide; onChange: (v: SodSide) => void; groups: IdOption[]; positions: IdOption[] }) {
  const t = useT();
  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-semibold">{label}</p>
      <Field label={t("idg.skupinyAdRoleEntraId")}>
        <IdMultiSelect value={value.groups} onChange={(g) => onChange({ ...value, groups: g })} options={groups} known={value.groups.map((g) => ({ id: g, label: g }))} placeholder={t("idg.pridatSkupinu")} emptyLabel={t("idg.zadnaSkupina")} />
      </Field>
      <Field label={t("idg.funkcniMistaVContixu")}>
        <IdMultiSelect value={value.positionIds} onChange={(p) => onChange({ ...value, positionIds: p })} options={positions} placeholder={t("idg.pridatFunkcniMisto")} emptyLabel={t("idg.zadneFunkcniMisto")} />
      </Field>
    </Card>
  );
}

function SodRuleModal({ initial, onClose }: { initial: SodRuleDto | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const target = useTargetCompany();
  const groups = useGroupOptions();
  const positions = usePositionOptions();
  const [companyId, setCompanyId] = useState(initial?.companyId ?? target.companyId);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [severity, setSeverity] = useState<IdentitySeverity>(initial?.severity ?? "high");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [a, setA] = useState<SodSide>(initial?.sideA ?? { groups: [], positionIds: [] });
  const [b, setB] = useState<SodSide>(initial?.sideB ?? { groups: [], positionIds: [] });
  const data = { name, description, severity, enabled, sideA: a, sideB: b, companyId };
  const save = useMutation({
    mutationFn: () => (initial ? api.identity.updateSodRule(initial.id, data) : api.identity.createSodRule(data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity", "sod"] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.identity.removeSodRule(initial!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity", "sod"] });
      onClose();
    },
  });
  const valid = name.trim().length >= 3 && (a.groups.length || a.positionIds.length) && (b.groups.length || b.positionIds.length);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={initial ? t("idg.upravitPravidlo") : t("idg.novePravidloOddeleniPovinnosti")}
      footer={
        <>
          {initial && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("idg.smazatPravidloIJehoPoruseni"))) && remove.mutate()}>
              {t("idg.smazat")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {t("idg.ulozitAVyhodnotit")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
        <Field label={t("idg.nazev")}>
          <Input value={name} placeholder={t("idg.spravceDomenyNesmiSchvalovatPlatby")} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("idg.zavaznost")}>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as IdentitySeverity)}>
            {IDENTITY_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(IDENTITY_LABELS.severity[s])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("idg.procJeKombinaceRizikovaVolitelne")}>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {!initial && <TargetCompanyField value={companyId} onChange={setCompanyId} />}
      <p className="text-xs text-slate-500">{t("idg.poruseniOsobaMaNecoZe")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <SideEditor label={t("idg.stranaA")} value={a} onChange={setA} groups={groups} positions={positions} />
        <SideEditor label={t("idg.stranaB")} value={b} onChange={setB} groups={groups} positions={positions} />
      </div>
      <Checkbox checked={enabled} onChange={setEnabled} label={t("idg.pravidloZapnute")} />
      <ErrorBox error={save.error ?? remove.error} />
    </Modal>
  );
}

/* ---------------- přezkum přístupů ---------------- */

export function ReviewsTab({ sources }: { sources: IdentitySourceDto[] }) {
  const t = useT();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ["identity", "reviews"], queryFn: api.identity.reviews });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {can("identity:write") && (
          <Button onClick={() => setCreating(true)} disabled={!sources.length}>
            <Plus size={15} /> {t("idg.novyPrezkumPristupu")}
          </Button>
        )}
        <p className="text-sm text-slate-500">{t("idg.recenzentiVlastnikSystemuNeboVedouci")}</p>
      </div>
      <ErrorBox error={list.error} />
      <Card>
        {list.data && !list.data.length ? (
          <EmptyState>{t("idg.zatimZadnyPrezkumDoporuceniPrivilegovane")}</EmptyState>
        ) : (
          <div className="divide-y divide-slate-100">
            {list.data?.map((r) => (
              <Link key={r.id} to="/identity/reviews/$reviewId" params={{ reviewId: r.id }} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                <div className="flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-slate-500">
                    {t.lbl(ACCESS_REVIEW_LABELS.status[r.status])} {t("idg.termin")} {fmtDay(r.dueDate)} · <CompanyCell id={r.companyId} />
                  </div>
                </div>
                <Progress c={r.counts} />
              </Link>
            ))}
          </div>
        )}
      </Card>
      {creating && <ReviewModal sources={sources} onClose={() => setCreating(false)} />}
    </>
  );
}

function Progress({ c }: { c: { total: number; pending: number; keep: number; revoke: number } }) {
  const t = useT();
  const done = c.total - c.pending;
  return (
    <div className="w-56 text-right text-xs text-slate-600">
      <div className="mb-1 h-2 overflow-hidden rounded bg-slate-100">
        <div className="h-full bg-brand-600" style={{ width: `${c.total ? (done / c.total) * 100 : 0}%` }} />
      </div>
      {t("idg.rozhodnuto")} {done}/{c.total} {t("idg.ponechat")} {c.keep} {t("idg.odebrat")} {c.revoke}
    </div>
  );
}

function ReviewModal({ sources, onClose }: { sources: IdentitySourceDto[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const target = useTargetCompany();
  const groups = useGroupOptions();
  const [companyId, setCompanyId] = useState(target.companyId);
  const [name, setName] = useState(t("idg.prezkumPrivilegovanychUctu", { p: new Date().getFullYear() }));
  const [description, setDescription] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [privilegedOnly, setPrivilegedOnly] = useState(true);
  const [grp, setGrp] = useState<string[]>([]);
  const [reviewerMode, setMode] = useState<AccessReviewerMode>("position");
  const [reviewerPositionId, setPos] = useState<string | null>(null);
  const [dueDate, setDue] = useState(() => new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10));
  const m = useMutation({
    mutationFn: () => api.identity.createReview({ name, description, companyId, sourceIds, privilegedOnly, groups: grp, reviewerMode, reviewerPositionId: reviewerPositionId!, dueDate }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity", "reviews"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("idg.novyPrezkumPristupu")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!reviewerPositionId || name.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            {t("idg.zahajitPrezkum")}
          </Button>
        </>
      }
    >
      <Field label={t("idg.nazev")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("idg.pokynyProRecenzentyVolitelne")}>
        <Textarea rows={2} value={description} placeholder={t("idg.overteZdaDrzitelUctuPristup")} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <TargetCompanyField value={companyId} onChange={setCompanyId} />
      <div>
        <p className="mb-1 text-sm font-medium">{t("idg.rozsah")}</p>
        <div className="flex flex-wrap gap-4">
          {sources.map((s) => (
            <Checkbox key={s.id} checked={sourceIds.includes(s.id)} onChange={(v) => setSourceIds(v ? [...sourceIds, s.id] : sourceIds.filter((x) => x !== s.id))} label={s.name} />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("idg.bezZaskrtnutiVsechnyZdrojeSpolecnosti")}</p>
        <div className="mt-3">
          <Checkbox checked={privilegedOnly} onChange={setPrivilegedOnly} label={t("idg.jenPrivilegovaneUcty")} />
        </div>
        <Field label={t("idg.jenUctyVTechtoSkupinach")} className="mt-3">
          <IdMultiSelect value={grp} onChange={setGrp} options={groups} placeholder={t("idg.pridatSkupinu")} emptyLabel={t("idg.vsechnySkupiny")} />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("idg.kdoRozhoduje")}>
          <Select value={reviewerMode} onChange={(e) => setMode(e.target.value as AccessReviewerMode)}>
            {(["position", "manager"] as const).map((k) => (
              <option key={k} value={k}>
                {t.lbl(ACCESS_REVIEW_LABELS.reviewerMode[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={reviewerMode === "manager" ? t("idg.nahradniRecenzentUctyBezVedouciho") : t("idg.recenzentFunkcniMisto")}>
          <PositionSelect value={reviewerPositionId} onChange={setPos} emptyLabel="— vyberte —" />
        </Field>
        <Field label={t("idg.termin2")}>
          <Input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">{t("idg.seznamUctuAJejichPristupu")}</p>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/* ---------------- stránka přezkumu ---------------- */

export function AccessReviewPage() {
  const t = useT();
  const { reviewId } = useParams({ strict: false }) as { reviewId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["identity", "review", reviewId], queryFn: () => api.identity.review(reviewId) });
  const [onlyPending, setOnlyPending] = useState(false);
  const [revoking, setRevoking] = useState<AccessReviewItemDto | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["identity"] });
  const decide = useMutation({ mutationFn: (v: { item: string; decision: "keep" | "revoke"; note?: string }) => api.identity.decide(reviewId, v.item, { decision: v.decision, note: v.note ?? "" }), onSuccess: refresh });
  const remediated = useMutation({ mutationFn: (v: { item: string; done: boolean }) => api.identity.remediated(reviewId, v.item, v.done), onSuccess: refresh });
  const reassign = useMutation({ mutationFn: (v: { item: string; pos: string }) => api.identity.reassign(reviewId, v.item, v.pos), onSuccess: refresh });
  const close = useMutation({ mutationFn: () => api.identity.closeReview(reviewId), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => api.identity.cancelReview(reviewId), onSuccess: refresh });
  const d = q.data;
  const active = d?.status === "active";
  const canDecide = (i: AccessReviewItemDto) => !!d && active && (d.canDecideAll || d.myPositionIds.includes(i.reviewerPositionId));
  const items = (d?.items ?? []).filter((i) => !onlyPending || i.decision === "pending");

  return (
    <>
      <PageHeader
        title={d?.name ?? t("idg.prezkumPristupu")}
        subtitle={d ? `${t.lbl(ACCESS_REVIEW_LABELS.status[d.status])} · ${t("idg.terminDne", { date: fmtDay(d.dueDate) })}${d.closedAt ? (" " + t("idg.uzavreno", { p: fmtDate(d.closedAt) })) : ""}` : undefined}
        actions={
          d?.canDecideAll && (
            <>
              <a href={api.identity.reviewReportUrl(reviewId, "html")} target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <Printer size={15} /> {t("idg.protokol")}
                </Button>
              </a>
              <a href={api.identity.reviewReportUrl(reviewId, "docx")} download>
                <Button variant="secondary">
                  <Download size={15} /> {t("idg.word")}
                </Button>
              </a>
              {active && (
                <>
                  <Button variant="secondary" disabled={cancel.isPending} onClick={async () => (await askConfirm(t("idg.zrusitPrezkumRozhodnutiZustanouV"))) && cancel.mutate()}>
                    {t("idg.zrusitPrezkum")}
                  </Button>
                  <Button disabled={close.isPending || (d?.counts.pending ?? 1) > 0} title={d && d.counts.pending ? t("idg.zbyvaRozhodnout", { pending: d.counts.pending }) : undefined} onClick={async () => (await askConfirm(t("idg.uzavritPrezkumVysledekSeZmrazi"))) && close.mutate()}>
                    {t("idg.uzavritPrezkum")}
                  </Button>
                </>
              )}
            </>
          )
        }
      />
      {d?.canDecideAll && (
        <a href="/identity?tab=reviews" className="mb-3 inline-block text-sm text-brand-700 hover:underline">
          {t("idg.vsechnyPrezkumy")}
        </a>
      )}
      <ErrorBox error={q.error ?? decide.error ?? remediated.error ?? reassign.error ?? close.error ?? cancel.error} />
      {d && (
        <>
          {d.description && <Card className="mb-4 px-5 py-3 text-sm text-slate-700">{d.description}</Card>}
          <Card className="mb-4 flex flex-wrap items-center gap-6 px-5 py-4">
            <Progress c={d.canDecideAll ? d.counts : { total: d.items.length, pending: d.items.filter((i) => i.decision === "pending").length, keep: d.items.filter((i) => i.decision === "keep").length, revoke: d.items.filter((i) => i.decision === "revoke").length }} />
            {d.canDecideAll && d.counts.revoke > 0 && (
              <span className="text-sm text-slate-600">
                {t("idg.odebraniProvedeno", { remediated: d.counts.remediated, revoke: d.counts.revoke })}
              </span>
            )}
            <Checkbox checked={onlyPending} onChange={setOnlyPending} label={t("idg.jenNerozhodnute")} />
          </Card>
          {!d.canDecideAll && active && (
            <p className="mb-3 text-sm text-slate-600">
              {t("idg.uKazdehoUctuRozhodneteZda")}<b>{t("idg.ponechat2")}</b>{t("idg.neboSeMaOdebrat")}<b>{t("idg.odebrat2")}</b> {t("idg.uvedteCoOdebraniProvedeSpravce")}
            </p>
          )}
          <Card>
            {!items.length ? (
              <EmptyState>{onlyPending ? t("idg.vseRozhodnuto") : t("idg.zadnePolozky")}</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">{t("idg.ucet")}</th>
                      <th className="px-3 py-2">{t("idg.pristupy")}</th>
                      <th className="px-3 py-2">{t("idg.posledniPrihlaseni")}</th>
                      <th className="px-3 py-2">{t("idg.recenzent")}</th>
                      <th className="px-3 py-2">{t("idg.rozhodnuti")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((i) => (
                      <ItemRow
                        key={i.id}
                        i={i}
                        d={d}
                        canDecide={canDecide(i)}
                        busy={decide.isPending}
                        onKeep={() => decide.mutate({ item: i.id, decision: "keep" })}
                        onRevoke={() => setRevoking(i)}
                        onRemediated={(done) => remediated.mutate({ item: i.id, done })}
                        onReassign={(pos) => reassign.mutate({ item: i.id, pos })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {revoking && <RevokeModal item={revoking} onClose={() => setRevoking(null)} onSubmit={(note) => decide.mutateAsync({ item: revoking.id, decision: "revoke", note })} />}
    </>
  );
}

function ItemRow({
  i,
  d,
  canDecide,
  busy,
  onKeep,
  onRevoke,
  onRemediated,
  onReassign,
}: {
  i: AccessReviewItemDto;
  d: AccessReviewDetail;
  canDecide: boolean;
  busy: boolean;
  onKeep: () => void;
  onRevoke: () => void;
  onRemediated: (done: boolean) => void;
  onReassign: (pos: string) => void;
}) {
  const t = useT();
  const [moving, setMoving] = useState(false);
  return (
    <tr className="align-top">
      <td className="px-4 py-2">
        <span className="font-medium">{i.login}</span>
        <span className="block text-xs text-slate-500">
          {i.displayName} · {i.sourceName} · {t.lbl(IDENTITY_LABELS.accountKind[i.kind])}
        </span>
      </td>
      <td className="px-3 py-2 text-xs">
        {i.access.length ? (
          <div className="flex max-w-md flex-wrap gap-1">
            {i.access.map((g) => (
              <Badge key={g} tone={i.privilegedVia.includes(g) ? "red" : "slate"}>
                {g}
              </Badge>
            ))}
          </div>
        ) : (
          t("idg.ucet2")
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs">{i.lastLogonAt ? fmtDate(i.lastLogonAt) : "—"}</td>
      <td className="px-3 py-2 text-xs">
        {moving ? (
          <PositionSelect
            value={i.reviewerPositionId}
            onChange={(v) => {
              if (v) onReassign(v);
              setMoving(false);
            }}
          />
        ) : (
          <>
            {i.reviewerName}
            {d.canDecideAll && d.status === "active" && i.decision === "pending" && (
              <button type="button" className="ml-1 text-brand-700 hover:underline" onClick={() => setMoving(true)}>
                {t("idg.zmenit")}
              </button>
            )}
          </>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {i.decision === "pending" ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
              <Clock size={14} /> {t("idg.ceka")}
            </span>
          ) : i.decision === "keep" ? (
            <span className="inline-flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 size={14} /> {t("idg.ponechat3")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-red-700">
              <XCircle size={14} /> {t("idg.odebrat3")}
            </span>
          )}
          {canDecide && (
            <>
              <Button variant={i.decision === "keep" ? "primary" : "secondary"} className="px-2 py-1 text-xs" disabled={busy} onClick={onKeep}>
                {t("idg.ponechat2")}
              </Button>
              <Button variant={i.decision === "revoke" ? "danger" : "secondary"} className="px-2 py-1 text-xs" disabled={busy} onClick={onRevoke}>
                <ShieldOff size={13} /> {t("idg.odebrat2")}
              </Button>
            </>
          )}
        </div>
        {i.note && <div className="mt-1 text-xs text-slate-600">{i.note}</div>}
        {i.decidedByName && (
          <div className="text-xs text-slate-400">
            {i.decidedByName}, {fmtDate(i.decidedAt)}
          </div>
        )}
        {i.decision === "revoke" && (
          <div className="mt-1 flex items-center gap-2 text-xs">
            {i.remediated ? <Badge tone="green">{t("idg.odebraniProvedeno2")}</Badge> : <Badge tone="amber">{t("idg.cekaNaProvedeniVAdresari")}</Badge>}
            {d.canDecideAll && !(i.remediated && !i.remediatedManually) && (
              <button type="button" className="text-brand-700 hover:underline" onClick={() => onRemediated(!i.remediatedManually)}>
                {i.remediatedManually ? t("idg.zrusitPotvrzeni") : t("idg.potvrditRucne")}
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function RevokeModal({ item, onClose, onSubmit }: { item: AccessReviewItemDto; onClose: () => void; onSubmit: (note: string) => Promise<unknown> }) {
  const t = useT();
  const [note, setNote] = useState(item.note);
  const m = useMutation({ mutationFn: () => onSubmit(note), onSuccess: onClose });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("idg.odebratPristup", { login: item.login })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button variant="danger" disabled={note.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            {t("idg.odebrat2")}
          </Button>
        </>
      }
    >
      <Field label={t("idg.coOdebrat")} hint={t("idg.naprZakazatUcetOdebratZe")}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/* ---------------- automatické testy opatření ---------------- */

export function AutomationsTab({ sources }: { sources: IdentitySourceDto[] }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ControlAutomationDto | "new" | null>(null);
  const list = useQuery({ queryKey: ["identity", "automations"], queryFn: api.identity.automations });
  const run = useMutation({ mutationFn: api.identity.runAutomation, onSettled: () => qc.invalidateQueries({ queryKey: ["identity", "automations"] }) });
  const resultLabel: Record<string, string> = { effective: t("idg.ucinne"), effective_with_exceptions: t("idg.ucinneSVyjimkami"), ineffective: t("idg.neucinne") };
  const resultTone: Record<string, "green" | "amber" | "red"> = { effective: "green", effective_with_exceptions: "amber", ineffective: "red" };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {can("identity:write") && (
          <Button onClick={() => setEditing("new")}>
            <Plus size={15} /> {t("idg.automatickyTestOpatreni")}
          </Button>
        )}
        <p className="text-sm text-slate-500">{t("idg.vysledekKontrolyUctuPravidelneA")}</p>
      </div>
      <ErrorBox error={list.error ?? run.error} />
      <Card>
        {list.data && !list.data.length ? (
          <EmptyState>{t("idg.zatimZadnyAutomatickyTestTypicky")}</EmptyState>
        ) : (
          <div className="divide-y divide-slate-100">
            {list.data?.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <div className="min-w-64 flex-1">
                  <Link to="/controls/$controlId" params={{ controlId: a.controlId }} className="font-medium text-brand-700 hover:underline">
                    {a.controlName}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {t.lbl(AUTOMATION_LABELS.kind[a.kind])}
                    {a.kind === "identity_checks" && (" " + t("idg.toleranceKritickeVysoke", { p: AUTOMATION_LABELS.frequency[a.frequency].toLowerCase(), maxCritical: a.maxCritical, maxHigh: a.maxHigh }))}
                    {a.applyEffectiveness && t("idg.nastavujeUcinnost")}
                    {!a.enabled && " · vypnuto"}
                  </div>
                  {a.lastError && <div className="mt-1 text-xs text-red-700">{a.lastError}</div>}
                </div>
                <div className="text-right text-xs text-slate-600">
                  {a.lastRunAt ? (
                    <>
                      {a.lastResult && <Badge tone={resultTone[a.lastResult] ?? "slate"}>{resultLabel[a.lastResult] ?? a.lastResult}</Badge>}
                      <div className="mt-1">{fmtDate(a.lastRunAt)}</div>
                    </>
                  ) : (
                    t("idg.zatimNeprobehlo")
                  )}
                </div>
                {can("identity:write") && (
                  <div className="flex gap-1">
                    {a.kind === "identity_checks" && (
                      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={run.isPending} onClick={() => run.mutate(a.id)}>
                        {t("idg.spustitNyni")}
                      </Button>
                    )}
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(a)}>
                      {t("idg.upravit")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {editing && <AutomationModal initial={editing === "new" ? null : editing} sources={sources} onClose={() => setEditing(null)} />}
    </>
  );
}

function AutomationModal({ initial, sources, onClose }: { initial: ControlAutomationDto | null; sources: IdentitySourceDto[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const controls = useQuery({ queryKey: ["controls", "list-for-automation"], queryFn: () => api.controls.list({}) });
  const [f, setF] = useState({
    controlId: initial?.controlId ?? "",
    kind: initial?.kind ?? ("identity_checks" as ControlAutomationKind),
    frequency: initial?.frequency ?? ("monthly" as AutomationFrequency),
    sourceIds: initial?.sourceIds ?? [],
    rules: initial?.rules ?? [],
    maxCritical: initial?.maxCritical ?? 0,
    maxHigh: initial?.maxHigh ?? 0,
    applyEffectiveness: initial?.applyEffectiveness ?? false,
    enabled: initial?.enabled ?? true,
  });
  const save = useMutation({
    mutationFn: () => (initial ? api.identity.updateAutomation(initial.id, f) : api.identity.createAutomation(f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity", "automations"] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.identity.removeAutomation(initial!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity", "automations"] });
      onClose();
    },
  });
  const ruleOptions: IdOption[] = IDENTITY_RULES.map((r) => ({ id: r, label: t.lbl(IDENTITY_RULE_INFO[r].title) }));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={initial ? t("idg.upravitAutomatickyTest") : t("idg.automatickyTestOpatreni")}
      footer={
        <>
          {initial && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("idg.smazatAutomatizaciDosavadniTestyA"))) && remove.mutate()}>
              {t("idg.smazat")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!f.controlId || save.isPending} onClick={() => save.mutate()}>
            {t("idg.ulozit")}
          </Button>
        </>
      }
    >
      <Field label={t("idg.opatreni")}>
        <Select value={f.controlId} onChange={(e) => setF({ ...f, controlId: e.target.value })}>
          <option value="">{t("idg.vyberteOpatreni")}</option>
          {controls.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} ` : ""}
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("idg.zdrojVysledku")}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ControlAutomationKind })}>
            {(["identity_checks", "access_review"] as const).map((k) => (
              <option key={k} value={k}>
                {t.lbl(AUTOMATION_LABELS.kind[k])}
              </option>
            ))}
          </Select>
        </Field>
        {f.kind === "identity_checks" && (
          <Field label={t("idg.jakCasto")}>
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as AutomationFrequency })}>
              {(["weekly", "monthly", "quarterly"] as const).map((k) => (
                <option key={k} value={k}>
                  {t.lbl(AUTOMATION_LABELS.frequency[k])}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">{t("idg.zdroje")}</p>
        <div className="flex flex-wrap gap-4">
          {sources.map((s) => (
            <Checkbox key={s.id} checked={f.sourceIds.includes(s.id)} onChange={(v) => setF({ ...f, sourceIds: v ? [...f.sourceIds, s.id] : f.sourceIds.filter((x) => x !== s.id) })} label={s.name} />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("idg.bezZaskrtnutiVsechnyZdrojeSpolecnosti2")}</p>
      </div>
      {f.kind === "identity_checks" && (
        <>
          <Field label={t("idg.pravidlaVRozsahu")}>
            <IdMultiSelect value={f.rules} onChange={(v) => setF({ ...f, rules: v as typeof f.rules })} options={ruleOptions} placeholder={t("idg.omezitNaPravidlo")} emptyLabel={t("idg.vsechnaPravidla")} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("idg.toleranceKritickychNalezu")} hint={t("idg.viceTestNeucinny")}>
              <Input type="number" min={0} value={f.maxCritical} onChange={(e) => setF({ ...f, maxCritical: Number(e.target.value) })} />
            </Field>
            <Field label={t("idg.toleranceVysokychNalezu")}>
              <Input type="number" min={0} value={f.maxHigh} onChange={(e) => setF({ ...f, maxHigh: Number(e.target.value) })} />
            </Field>
          </div>
        </>
      )}
      <Checkbox
        checked={f.applyEffectiveness}
        onChange={(v) => setF({ ...f, applyEffectiveness: v })}
        label={t("idg.poTestuNastavitUcinnostOpatreni")}
        hint={t("idg.jinakSeJenZapiseTest")}
      />
      <Checkbox checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={t("idg.zapnuto")} />
      <ErrorBox error={save.error ?? remove.error ?? controls.error} />
    </Modal>
  );
}
