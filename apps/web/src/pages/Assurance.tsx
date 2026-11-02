import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import {
  AuditPackageModal,
  EvidenceModal,
  NewTestModal,
  TestList,
  ValidityBadge,
  useCanTest,
} from "@/components/assurance";
import { CompanyCell, useGroupView } from "@/components/company";
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Input,
  PageHeader,
  Select,
} from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDay, useDebounced } from "@/lib/utils";
import { ASSURANCE_LABELS } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Package, Plus } from "lucide-react";
import { useState } from "react";

/** Testování opatření a knihovna důkazů. */
export function AssurancePage() {
  const t = useT();
  const canTest = useCanTest();
  const group = useGroupView();
  const [tab, setTab] = useState<"tests" | "evidence">("tests");
  const [status, setStatus] = useState<"open" | "completed" | "all">("all");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [validity, setValidity] = useState("");
  const [newTest, setNewTest] = useState(false);
  const [newEv, setNewEv] = useState(false);
  const [pkg, setPkg] = useState(false);
  const ov = useQuery({
    queryKey: ["assurance", "overview"],
    queryFn: api.assurance.overview,
  });
  const tests = useQuery({
    queryKey: ["assurance", "tests", status, year],
    queryFn: () =>
      api.assurance.tests({ status, year: year ? Number(year) : undefined }),
    enabled: tab === "tests",
  });
  const ev = useQuery({
    queryKey: ["evidence", "list", dq, validity],
    queryFn: () => api.assurance.evidence({ q: dq, validity }),
    enabled: tab === "evidence",
  });
  const o = ov.data;
  const tiles = o
    ? [
        {
          label: t("asr.otevreneTesty"),
          value: o.testsOpen,
          warn: o.testsOverdue > 0 ? t("asr.poTerminu", { testsOverdue: o.testsOverdue }) : null,
        },
        {
          label: t("asr.testyZa12Mesicu"),
          value: Object.values(o.testsLastYear).reduce((a, b) => a + b, 0),
          warn: o.testsLastYear.ineffective
            ? t("asr.neucinne", { ineffective: o.testsLastYear.ineffective })
            : null,
        },
        {
          label: t("asr.zavedenaOpatreniBezTestu12"),
          value: o.implementedNotTested,
          warn: null,
          of: o.implementedControls,
        },
        {
          label: t("asr.zavedenaOpatreniBezDukazu"),
          value: o.implementedWithoutEvidence,
          warn: null,
          of: o.implementedControls,
        },
        {
          label: t("asr.dukazy2"),
          value: o.evidenceTotal,
          warn:
            o.evidenceExpired || o.evidenceExpiring
              ? t("asr.prosleBrzy", { evidenceExpired: o.evidenceExpired, evidenceExpiring: o.evidenceExpiring })
              : null,
        },
      ]
    : [];
  const years = Array.from({ length: 4 }, (_, i) =>
    String(new Date().getFullYear() + 1 - i),
  );
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/controls" className="hover:text-brand-700">
          {t("asr.opatreniAShoda")}
        </Link>
      </div>
      <PageHeader badge={<FrameworkBadge />}
        title={t("asr.testyADukazy")}
        subtitle={t("asr.overovaniUcinnostiOpatreniTestNavrhu")}
        actions={
          <>
            {!group && (
              <Button variant="secondary" onClick={() => setPkg(true)}>
                <Package size={16} /> {t("asr.balicekProAuditora")}
              </Button>
            )}
            {canTest && (
            <>
              <Button variant="secondary" onClick={() => setNewEv(true)}>
                <Plus size={16} /> {t("asr.dukaz")}
              </Button>
              <Button onClick={() => setNewTest(true)}>
                <Plus size={16} /> {t("asr.naplanovatTest")}
              </Button>
            </>
            )}
          </>
        }
      />
      <ErrorBox error={ov.error ?? tests.error ?? ev.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {tiles.map((tx) => (
          <Card key={tx.label} className="px-4 py-3">
            <div className="text-xs text-slate-500">{tx.label}</div>
            <div className="text-2xl font-semibold tabular-nums">
              {tx.value}
              {"of" in tx && tx.of != null && (
                <span className="text-sm font-normal text-slate-400">
                  {" "}
                  / {tx.of}
                </span>
              )}
            </div>
            {tx.warn && <div className="text-xs text-amber-800">{tx.warn}</div>}
          </Card>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-slate-300 p-0.5 text-sm">
          {(
            [
              ["tests", "Testy"],
              ["evidence", t("asr.dukazy2")],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded px-3 py-1 ${tab === k ? "bg-brand-50 text-brand-700" : "text-slate-600"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {tab === "tests" ? (
          <>
            <Select
              className="w-40"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="all">{t("asr.vsechny")}</option>
              <option value="open">{t("asr.otevrene")}</option>
              <option value="completed">{t("asr.dokoncene")}</option>
            </Select>
            <Select
              className="w-32"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="">{t("asr.vsechnyRoky")}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <Input
              className="w-64"
              placeholder={t("asr.hledatDukaz")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              className="w-44"
              value={validity}
              onChange={(e) => setValidity(e.target.value)}
            >
              <option value="">{t("asr.jakakoliPlatnost")}</option>
              <option value="expired">{t("asr.prosle2")}</option>
              <option value="expiring">{t("asr.brzyVyprsi2")}</option>
              <option value="valid">{t("asr.platne")}</option>
            </Select>
          </>
        )}
      </div>

      <Card className="overflow-hidden">
        {tab === "tests" ? (
          (tests.data ?? []).length === 0 ? (
            <EmptyState>
              {tests.isLoading ? t("common.loading") : t("asr.zadneTesty")}
            </EmptyState>
          ) : (
            <TestList tests={tests.data ?? []} />
          )
        ) : (ev.data ?? []).length === 0 ? (
          <EmptyState>{ev.isLoading ? t("common.loading") : t("asr.zadneDukazy")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("asr.dukaz")}</th>
                <th className="px-3 py-2">{t("asr.opatreni")}</th>
                <th className="px-3 py-2">{t("asr.porizeno")}</th>
                <th className="px-3 py-2">{t("asr.platnost")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(ev.data ?? []).map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2">
                    <Link
                      to="/controls/evidence/$evidenceId"
                      params={{ evidenceId: e.id }}
                      className="font-medium hover:text-brand-700"
                    >
                      {e.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {t("asr.souborU", { p: t.lbl(ASSURANCE_LABELS.evidenceKind[e.kind]), length: e.files.length, p2: " ", p3: e.url ? " · odkaz" : "" })}
                    </div>
                    {group && <CompanyCell id={e.companyId} />}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {e.controls.map((c) => c.code ?? c.name).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {e.collectedAt ? fmtDay(e.collectedAt) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <ValidityBadge e={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {newTest && <NewTestModal onClose={() => setNewTest(false)} />}
      {newEv && <EvidenceModal onClose={() => setNewEv(false)} />}
      {pkg && <AuditPackageModal onClose={() => setPkg(false)} />}
    </>
  );
}
