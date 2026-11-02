import { useT, tt } from "@/lib/i18n";
import { STATUS_COLORS } from "@/components/health";
import { Card, CardHeader, EmptyState, ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";
import { BACKUP_MAX_AGE_HOURS, fmtBytes, type OpsLevel } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleMinus, OctagonX } from "lucide-react";

const LEVEL: Record<OpsLevel, { color: string; Icon: typeof CheckCircle2; label: string }> = {
  ok: { color: STATUS_COLORS.good, Icon: CheckCircle2, label: "V pořádku" },
  warning: { color: STATUS_COLORS.serious, Icon: AlertTriangle, label: "Varování" },
  error: { color: STATUS_COLORS.critical, Icon: OctagonX, label: "Chyba" },
  off: { color: STATUS_COLORS.neutral, Icon: CircleMinus, label: "Vypnuto" },
};

const dt = (v: string | null) => (v ? new Date(v).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" }) : "—");
const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86_400 ? `${(s / 3600).toFixed(1)} h` : tt("adt.dni", { n: (s / 86_400).toFixed(1) }));

const COUNT_LABELS: Record<string, string> = {
  users: "Aktivní uživatelé",
  companies: "Společnosti",
  assets: "Aktiva",
  risks: "Rizika",
  openIncidents: "Otevřené události",
  aiRequests30d: "Dotazy na AI (30 dní)",
};

/** Provoz: stav komponent, zálohy, plánovač, monitoring. */
export function AdminOpsPage() {
  const t = useT();
  const st = useQuery({ queryKey: ["ops", "status"], queryFn: api.ops.status, refetchInterval: 60_000 });
  const backups = useQuery({ queryKey: ["ops", "backups"], queryFn: api.ops.backups });
  const s = st.data;
  return (
    <div className="space-y-6">
      <ErrorBox error={st.error ?? backups.error} />
      {s && (
        <>
          <Card>
            <CardHeader
              title={t("adt.stavSystemu")}
              subtitle={t("adt.contixInstanceBeziDatabazeMigraci", { version: s.version, nodeEnv: s.nodeEnv, p: uptime(s.uptimeSec), p2: s.database.version ?? "?", p3: fmtBytes(s.database.sizeBytes), p4: s.database.migrations ?? "?" })}
            />
            <ul className="divide-y divide-slate-100">
              {s.checks.map((c) => {
                const l = LEVEL[c.level];
                return (
                  <li key={c.key} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <l.Icon size={18} style={{ color: l.color }} className="mt-0.5 shrink-0" aria-hidden />
                    <div className="w-56 shrink-0">
                      <div className="font-medium">{c.label}</div>
                      <div className="text-xs text-slate-500">{t.lbl(l.label)}</div>
                    </div>
                    <div className="text-slate-600">{c.detail}</div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Object.entries(s.counts).map(([k, v]) => (
              <Card key={k} className="px-4 py-3">
                <div className="text-xs text-slate-500">{t.lbl(COUNT_LABELS[k]) ?? k}</div>
                <div className="text-2xl font-semibold tabular-nums">{v.toLocaleString("cs-CZ")}</div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title={t("adt.planovac")} subtitle={t("adt.kazdych15MinutNacteniWazuh")} />
            <dl className="grid gap-x-6 gap-y-2 p-5 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">{t("adt.posledniBeh")}</dt>
                <dd>{dt(s.scheduler.lastRunAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t("adt.instanceSeZamkem")}</dt>
                <dd className="break-all">
                  {s.scheduler.holder ?? "—"} {s.scheduler.thisInstance && <span className="text-xs text-slate-500">{t("adt.tato")}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t("adt.posledniChyba")}</dt>
                <dd>{s.scheduler.lastError ?? "—"}</dd>
              </div>
            </dl>
          </Card>
        </>
      )}

      <Card className="overflow-hidden">
        <CardHeader
          title={t("adt.zalohyDatabaze")}
          subtitle={t("adt.zapisujeSluzbaBackupInfraScripts", { BACKUP_MAX_AGE_HOURS: BACKUP_MAX_AGE_HOURS })}
        />
        {(backups.data ?? []).length === 0 ? (
          <EmptyState>{t("adt.zadnaEvidovanaZalohaSpustteSluzbu")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("adt.zacatek")}</th>
                <th className="px-3 py-2">{t("adt.stav")}</th>
                <th className="px-3 py-2">{t("adt.soubor")}</th>
                <th className="px-3 py-2 text-right">{t("adt.velikost")}</th>
                <th className="px-3 py-2">{t("adt.poznamka")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(backups.data ?? []).map((b) => {
                const l = LEVEL[b.status === "ok" ? "ok" : "error"];
                return (
                  <tr key={b.id}>
                    <td className="px-5 py-2 whitespace-nowrap text-xs text-slate-600">{dt(b.startedAt)}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <l.Icon size={14} style={{ color: l.color }} aria-hidden /> {b.status === "ok" ? "OK" : "Chyba"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {b.file ?? "—"}
                      {b.encrypted && <span className="ml-1.5 font-sans text-slate-500">{t("adt.sifrovano")}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtBytes(b.sizeBytes)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{b.message ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {s && (
        <Card>
          <CardHeader title={t("adt.monitoring")} />
          <div className="space-y-1 p-5 text-sm text-slate-700">
            <p>
              <code className="rounded bg-slate-100 px-1">{t("adt.getApiHealth")}</code> {t("adt.kontrolaDostupnostiBezPrihlaseniVraci")}
            </p>
            <p>
              <code className="rounded bg-slate-100 px-1">{t("adt.getApiMetrics")}</code> {t("adt.metrikyProPrometheus")}{" "}
              {s.metricsEnabled ? <strong>{t("adt.zapnuto")}</strong> : <>{t("adt.vypnutoNastavtePromennouMetricsToken")}</>}{t("adt.pristupSHlavickou")} <code className="rounded bg-slate-100 px-1">{t("adt.authorizationBearer")}</code>.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
