import { askConfirm } from "@/components/ui/overlay";
import { useT, tt } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { ApiTokenDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";

const d = (v: string | null) => (v ? new Date(v).toLocaleDateString("cs-CZ") : "—");

function tokenState(tx: ApiTokenDto): { label: string; tone: "green" | "red" | "slate" } {
  if (tx.revokedAt) return { label: tt("con.zneplatnen"), tone: "red" };
  if (tx.expiresAt && new Date(tx.expiresAt) < new Date()) return { label: tt("con.prosly"), tone: "slate" };
  return { label: tt("con.platny"), tone: "green" };
}

/** Osobní API tokeny pro MCP klienty (Profil). Token se zobrazí jen jednou. */
export function ApiTokensCard() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["ai", "status"], queryFn: api.ai.status, staleTime: 60_000 });
  const list = useQuery({ queryKey: ["tokens"], queryFn: api.tokens.list });
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [company, setCompany] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const set = (d: ApiTokenDto[]) => qc.setQueryData(["tokens"], d);
  const create = useMutation({
    mutationFn: () => api.tokens.create({ name, expiresInDays: days === "none" ? null : Number(days), companyId: company || null }),
    onSuccess: (r) => {
      setCreated(r.token);
      setName("");
      qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({ mutationFn: api.tokens.revoke, onSuccess: set });
  const remove = useMutation({ mutationFn: api.tokens.remove, onSuccess: set });
  const url = `${window.location.origin}/api/mcp`;
  return (
    <Card>
      <CardHeader title={t("con.apiTokenyMcp")} subtitle={t("con.proPripojeniAiKlientaS")} />
      <div className="space-y-4 p-5">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("con.tokenNevkladejteDoCloudovychAi")}
        </p>
        {status.data && !status.data.mcpEnabled && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("con.mcpServerJeVypnutyZapne")}</p>}
        <form
          className="grid gap-2 sm:grid-cols-[1fr_8rem]"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t("con.nazevNaprClaudeCodeNotebook")}>
            <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("con.platnost")}>
            <Select value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="30">{t("con.30Dni")}</option>
              <option value="90">{t("con.90Dni")}</option>
              <option value="365">{t("con.1Rok")}</option>
              <option value="none">{t("con.bezExpirace")}</option>
            </Select>
          </Field>
          {me.companies.length > 1 && (
            <Field label={t("con.omezitNaSpolecnost")} className="sm:col-span-2">
              <Select value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">{t("con.vsechnyMojeSpolecnosti")}</option>
                {me.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              <KeyRound size={14} /> {t("con.vytvoritToken")}
            </Button>
          </div>
        </form>
        <ErrorBox error={create.error ?? revoke.error ?? remove.error} />
        {created && (
          <div className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm">
            <p className="font-medium text-green-900">{t("con.tokenZkopirujteHnedZnovuSe")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs">{created}</code>
              <button type="button" title={t("con.kopirovat")} className="text-slate-500 hover:text-brand-700" onClick={() => navigator.clipboard?.writeText(created)}>
                <Copy size={15} />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              {t("con.openWebuiNovejsiVerzeNastaveni")} <b>{t("con.mcpStreamableHttp")}</b>{t("con.url")} <code>{url}</code>{t("con.overeniBearerTentoTokenU")}
            </p>
          </div>
        )}
        {(list.data ?? []).length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {(list.data ?? []).map((tx) => {
              const st = tokenState(tx);
              return (
                <li key={tx.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {tx.name} <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div className="text-xs text-slate-500">
                      {tx.prefix}{t("con.vytvoren")} {d(tx.createdAt)} {t("con.platiDo")} {tx.expiresAt ? d(tx.expiresAt) : t("con.neomezene")} {t("con.naposledyPouzit")} {d(tx.lastUsedAt)}
                      {tx.lastUsedIp && ` ${t("con.zIp", { p: tx.lastUsedIp })}`}
                      {tx.companyName && ` · ${t("con.jenSpolecnost", { p: tx.companyName })}`}
                    </div>
                  </div>
                  {!tx.revokedAt && st.tone === "green" && (
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={async () => (await askConfirm(t("con.zneplatnitToken", { name: tx.name }))) && revoke.mutate(tx.id)}>
                      {t("con.zneplatnit")}
                    </Button>
                  )}
                  <button className="text-slate-400 hover:text-red-700" title={t("con.smazat")} onClick={async () => (await askConfirm(t("con.smazatToken", { name: tx.name }))) && remove.mutate(tx.id)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          {t("con.adresaMcpServeru")} <code>{url}</code> {t("con.transportStreamableHttpHlavicka")} <code>{t("con.authorizationBearerLtTokenGt")}</code>{t("con.kazdeVolaniNastrojeSeZapisuje")}
        </p>
      </div>
    </Card>
  );
}
