import { useT } from "@/lib/i18n";
import { Button, Card, EmptyState, ErrorBox, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, useDebounced } from "@/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";

const PAGE = 100;

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Přihlášení",
  "auth.logout": "Odhlášení",
  "auth.login_failed": "Neúspěšné přihlášení",
  "auth.login_locked": "Pokus o přihlášení k zamčenému účtu",
  "auth.mfa_verified": "Ověření MFA",
  "auth.mfa_failed": "Neúspěšné ověření MFA",
  "auth.mfa_enabled": "Zapnutí MFA",
  "auth.mfa_disabled": "Vypnutí MFA",
  "auth.password_changed": "Změna hesla",
  "auth.sso_failed": "Chyba SSO",
  "auth.sso_not_provisioned": "SSO – účet neexistuje",
  "auth.sso_domain_denied": "SSO – nepovolená doména",
  "user.sso_linked": "SSO – propojení účtu",
  "user.created": "Založení uživatele",
  "user.updated": "Úprava uživatele",
  "user.provisioned": "Automatické založení (SSO)",
  "user.password_reset": "Reset hesla",
  "user.mfa_reset": "Reset MFA",
  "user.unlocked": "Odemčení účtu",
  "role.created": "Založení role",
  "role.updated": "Úprava role",
  "role.deleted": "Smazání role",
  "group.created": "Založení skupiny",
  "group.updated": "Úprava skupiny",
  "group.deleted": "Smazání skupiny",
  "settings.updated": "Změna nastavení",
  "asset.created": "Založení aktiva",
  "asset.updated": "Úprava aktiva",
  "asset.deleted": "Smazání aktiva",
  "asset.linked": "Propojení aktiv",
  "asset.unlinked": "Zrušení vazby aktiv",
  "discovery.started": "Spuštění discovery",
  "discovery.import": "Import",
  "connector.updated": "Změna nastavení konektoru",
  "connector.tested": "Test konektoru",
};

export function AdminAuditPage() {
  const t = useT();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [offset, setOffset] = useState(0);
  const log = useQuery({
    queryKey: ["admin", "audit", dq, offset],
    queryFn: () => api.admin.auditLog({ q: dq || undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
        <Input
          className="pl-9"
          placeholder={t("adt.filtrovatAkciNeboEMail")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <ErrorBox error={log.error} />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("adt.cas")}</th>
              <th className="px-4 py-3">{t("adt.uzivatel")}</th>
              <th className="px-4 py-3">{t("adt.akce")}</th>
              <th className="px-4 py-3">{t("adt.detail")}</th>
              <th className="px-4 py-3">{t("adt.ip")}</th>
            </tr>
          </thead>
          <tbody>
            {log.data?.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 align-top">
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{fmtDate(l.at)}</td>
                <td className="px-4 py-2.5">{l.userEmail ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span className={l.action.includes("failed") || l.action.includes("locked") ? "text-red-700" : ""}>
                    {t.lbl(ACTION_LABELS[l.action]) ?? l.action}
                  </span>
                </td>
                <td className="max-w-md px-4 py-2.5 font-mono text-xs text-slate-500">
                  {l.entityType && `${l.entityType}:${l.entityId?.slice(0, 8)} `}
                  {Object.keys(l.details).length > 0 && JSON.stringify(l.details).slice(0, 160)}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{l.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.data && !log.data.length && <EmptyState>{t("adt.zadneZaznamy")}</EmptyState>}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            {t("adt.novejsi")}
          </Button>
          <Button variant="secondary" disabled={(log.data?.length ?? 0) < PAGE} onClick={() => setOffset(offset + PAGE)}>
            {t("adt.starsi")}
          </Button>
        </div>
      </Card>
    </>
  );
}
