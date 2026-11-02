import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, SuccessBox, toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";
import { PASSWORD_MIN, ROOT_COMPANY_ID, type UserDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

export function AdminUsersPage() {
  const t = useT();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: api.admin.users });
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [creating, setCreating] = useState(false);
  const multi = useMe().companies.length > 1;

  const filtered = useMemo(
    () =>
      (users.data ?? []).filter((u) => !q || `${u.displayName} ${u.email} ${u.jobTitle ?? ""}`.toLowerCase().includes(q.toLowerCase())),
    [users.data, q],
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <Input className="pl-9" placeholder={t("usr.hledatJmenoEMail")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> {t("usr.novyUzivatel")}
        </Button>
      </div>
      <ErrorBox error={users.error} />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("usr.uzivatel")}</th>
              <th className="px-4 py-3">{t("usr.role")}</th>
              <th className="px-4 py-3">{t("usr.prihlaseni")}</th>
              <th className="px-4 py-3">{t("usr.stav")}</th>
              <th className="px-4 py-3">{t("usr.posledniPrihlaseni")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
              return (
                <tr key={u.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setEditing(u)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{u.displayName}</div>
                    <div className="text-xs text-slate-500">
                      {u.email}
                      {u.jobTitle && ` · ${u.jobTitle}`}
                      {multi && ` · ${u.companyName}`}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r.id + r.source + r.companyId} tone={r.source === "idp" ? "violet" : "blue"}>
                          {r.name}
                          {multi && r.companyId !== ROOT_COMPANY_ID && <span className="ml-1 opacity-70">· {r.companyName}</span>}
                        </Badge>
                      ))}
                      {!!u.groupIds.length && <Badge>{t("usr.skup", { length: u.groupIds.length })}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {u.authProvider === "local" ? t("usr.lokalni") : u.authProvider === "ad" ? "AD" : "SSO"}
                    {u.mfaEnabled && (
                      <span className="ml-2 inline-flex items-center gap-1 text-emerald-700">
                        <ShieldCheck size={14} /> {t("usr.mfa")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!u.isActive ? <Badge tone="slate">{t("usr.neaktivni")}</Badge> : locked ? <Badge tone="red">{t("usr.zamceny")}</Badge> : <Badge tone="green">{t("usr.aktivni")}</Badge>}
                    {u.mustChangePassword && (
                      <span className="ml-1">
                        <Badge tone="amber">{t("usr.zmenaHesla")}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(u.lastLoginAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {users.data && !filtered.length && <EmptyState>{t("usr.zadniUzivatele")}</EmptyState>}
      </Card>
      {creating && <UserCreateModal onClose={() => setCreating(false)} />}
      {editing && <UserEditModal user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

type Assignment = { roleId: string; companyId: string };

/** Role po společnostech (role u holdingu platí pro celou skupinu) + skupiny + domovská společnost. */
function RolesAndGroups({
  assignments,
  groupIds,
  setAssignments,
  setGroupIds,
  companyId,
  setCompanyId,
}: {
  assignments: Assignment[];
  groupIds: string[];
  setAssignments: (v: Assignment[]) => void;
  setGroupIds: (v: string[]) => void;
  companyId: string;
  setCompanyId: (v: string) => void;
}) {
  const t = useT();
  const can = useCan();
  const me = useMe();
  const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: api.admin.roles });
  const groups = useQuery({ queryKey: ["admin", "groups"], queryFn: api.admin.groups });
  const canRoles = can("admin:roles");
  const root = me.companies.find((c) => c.depth === 0)?.id ?? ROOT_COMPANY_ID;
  const [newRole, setNewRole] = useState("");
  const [newCo, setNewCo] = useState(root);
  const multi = me.companies.length > 1;
  const coName = (id: string) => me.companies.find((c) => c.id === id)?.name ?? "—";
  const companyOptions = me.companies.map((c) => (
    <option key={c.id} value={c.id}>
      {"\u00a0\u00a0".repeat(c.depth)}
      {c.name}
      {c.depth === 0 && multi ? t("usr.celaSkupina") : ""}
    </option>
  ));
  return (
    <div className="space-y-4">
      {multi && (
        <Field label={t("usr.domovskaSpolecnost")} hint={t("usr.holdingNeboSpolecnostSkupinyVychozi")}>
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companyOptions}
          </Select>
        </Field>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{t("usr.role")}</p>
          {!canRoles && <p className="text-xs text-amber-700">{t("usr.roleMuzePridelovatJenSpravce")}</p>}
          {assignments.length === 0 && <p className="text-xs text-slate-500">{t("usr.bezRole")}</p>}
          {assignments.map((a, i) => (
            <div key={`${a.roleId}:${a.companyId}`} className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm">
              <span className="flex-1">
                {roles.data?.find((r) => r.id === a.roleId)?.name ?? "…"}
                {multi && <span className="ml-1 text-xs text-slate-500">· {a.companyId === root ? t("usr.celaSkupina2") : coName(a.companyId)}</span>}
              </span>
              {canRoles && (
                <button type="button" className="text-slate-400 hover:text-red-700" onClick={() => setAssignments(assignments.filter((_, j) => j !== i))} aria-label={t("usr.odebratRoli")}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {canRoles && (
            <div className="flex gap-2">
              <Select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="flex-1">
                <option value="">{t("usr.pridatRoli")}</option>
                {roles.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
              {multi && (
                <Select value={newCo} onChange={(e) => setNewCo(e.target.value)} className="w-44">
                  {companyOptions}
                </Select>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={!newRole}
                onClick={() => {
                  if (!assignments.some((a) => a.roleId === newRole && a.companyId === newCo)) setAssignments([...assignments, { roleId: newRole, companyId: newCo }]);
                  setNewRole("");
                }}
              >
                {t("usr.pridat")}
              </Button>
            </div>
          )}
          {multi && <p className="text-xs text-slate-500">{t("usr.rolePridelenaSpolecnostiPlatiI")}</p>}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{t("usr.skupiny")}</p>
          {groups.data?.map((g) => (
            <Checkbox key={g.id} checked={groupIds.includes(g.id)} onChange={(v) => setGroupIds(toggle(groupIds, g.id, v))} label={g.name} />
          ))}
          {groups.data && !groups.data.length && <p className="text-xs text-slate-500">{t("usr.zatimZadneSkupiny")}</p>}
        </div>
      </div>
    </div>
  );
}

function UserCreateModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ email: "", displayName: "", jobTitle: "", authProvider: "local" as "local" | "oidc" | "ad", password: "" });
  const me = useMe();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState(me.activeCompanyId ?? me.homeCompanyId);
  const create = useMutation({
    mutationFn: () =>
      api.admin.createUser({
        ...f,
        jobTitle: f.jobTitle || null,
        password: f.authProvider === "local" ? f.password : undefined,
        roleAssignments: assignments,
        groupIds,
        companyId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });
  const genPw = () => {
    const a = crypto.getRandomValues(new Uint8Array(12));
    setF({ ...f, password: `${btoa(String.fromCharCode(...a)).replace(/[+/=]/g, "")}-Aa1` });
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("usr.novyUzivatel")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !f.email || !f.displayName}>
            {t("usr.vytvorit")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("usr.jmenoAPrijmeni")}>
          <Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
        </Field>
        <Field label={t("usr.eMail")}>
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label={t("usr.funkce")}>
          <Input value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} placeholder={t("usr.naprManazerKb")} />
        </Field>
        <Field label={t("usr.zpusobPrihlaseni")}>
          <AuthProviderSelect value={f.authProvider} onChange={(v) => setF({ ...f, authProvider: v })} />
        </Field>
        {f.authProvider === "local" ? (
          <Field label={t("usr.docasneHeslo")} hint={t("usr.minZnakuUzivatelSiHo", { PASSWORD_MIN: PASSWORD_MIN })} className="sm:col-span-2">
            <div className="flex gap-2">
              <Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="font-mono" />
              <Button type="button" variant="secondary" onClick={genPw}>
                {t("usr.vygenerovat")}
              </Button>
            </div>
          </Field>
        ) : (
          <p className="text-xs text-slate-500 sm:col-span-2">
            {t("usr.uzivatelSePrihlasiFiremnimUctem")}
          </p>
        )}
      </div>
      <RolesAndGroups
        assignments={assignments}
        groupIds={groupIds}
        setAssignments={setAssignments}
        setGroupIds={setGroupIds}
        companyId={companyId}
        setCompanyId={setCompanyId}
      />
      <ErrorBox error={create.error} />
    </Modal>
  );
}

function UserEditModal({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe();
  const [displayName, setName] = useState(user.displayName);
  const [jobTitle, setJob] = useState(user.jobTitle ?? "");
  const [isActive, setActive] = useState(user.isActive);
  const [assignments, setAssignments] = useState<Assignment[]>(user.roles.filter((r) => r.source === "manual").map((r) => ({ roleId: r.id, companyId: r.companyId })));
  const [groupIds, setGroupIds] = useState(user.groupIds);
  const [companyId, setCompanyId] = useState(user.companyId);
  const [authProvider, setAuthProvider] = useState(user.authProvider);
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const can = useCan();

  const save = useMutation({
    mutationFn: () =>
      api.admin.updateUser(user.id, {
        displayName,
        jobTitle: jobTitle || null,
        isActive,
        groupIds,
        companyId,
        ...(authProvider !== user.authProvider ? { authProvider } : {}),
        ...(can("admin:roles") ? { roleAssignments: assignments } : {}),
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const action = useMutation({
    mutationFn: async (kind: "pw" | "mfa" | "unlock") => {
      if (kind === "pw") await api.admin.resetPassword(user.id, newPw);
      if (kind === "mfa") await api.admin.resetMfa(user.id);
      if (kind === "unlock") await api.admin.unlock(user.id);
      return kind;
    },
    onSuccess: (k) => {
      invalidate();
      setMsg({ pw: t("usr.hesloNastavenoUzivatelSiHo"), mfa: t("usr.mfaResetovano"), unlock: t("usr.ucetOdemcen") }[k]);
    },
  });
  const idpRoles = user.roles.filter((r) => r.source === "idp");
  const locked = user.lockedUntil && new Date(user.lockedUntil) > new Date();

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={user.displayName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-500">
        {user.email} · {user.authProvider === "local" ? t("usr.lokalniUcet") : user.authProvider === "ad" ? "AD" : "SSO"} {t("usr.vytvoren")} {fmtDate(user.createdAt)}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("usr.jmenoAPrijmeni2")}>
          <Input value={displayName} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("usr.funkce")}>
          <Input value={jobTitle} onChange={(e) => setJob(e.target.value)} />
        </Field>
        <Field label={t("usr.zpusobPrihlaseni")} hint={user.authProvider === "local" && authProvider !== "local" ? t("usr.authConvertHint") : authProvider === "local" && user.authProvider !== "local" ? t("usr.authToLocalHint") : undefined}>
          <AuthProviderSelect value={authProvider} onChange={setAuthProvider} disabled={user.id === me.user.id} />
        </Field>
      </div>
      <Checkbox
        checked={isActive}
        disabled={user.id === me.user.id}
        onChange={setActive}
        label={t("usr.ucetJeAktivni")}
        hint={t("usr.deaktivovanyUzivatelSeNeprihlasiA")}
      />
      <RolesAndGroups
        assignments={assignments}
        groupIds={groupIds}
        setAssignments={setAssignments}
        setGroupIds={setGroupIds}
        companyId={companyId}
        setCompanyId={setCompanyId}
      />
      {!!idpRoles.length && (
        <p className="text-xs text-slate-500">
          {t("usr.roleZeSkupinEntraId", { p: idpRoles.map((r) => r.name).join(", ") })}
        </p>
      )}
      <ErrorBox error={save.error} />

      <div className="space-y-3 rounded-md border border-slate-200 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Lock size={15} /> {t("usr.zabezpeceniUctu")}
        </p>
        {msg && <SuccessBox>{msg}</SuccessBox>}
        <ErrorBox error={action.error} />
        {user.authProvider === "local" && (
          <div className="flex items-end gap-2">
            <Field label={t("usr.nastavitDocasneHeslo")} className="flex-1">
              <Input value={newPw} onChange={(e) => setNewPw(e.target.value)} className="font-mono" placeholder={t("usr.minZnaku", { PASSWORD_MIN: PASSWORD_MIN })} />
            </Field>
            <Button variant="secondary" disabled={newPw.length < PASSWORD_MIN} onClick={() => action.mutate("pw")}>
              {t("usr.nastavit")}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {user.mfaEnabled && (
            <Button variant="secondary" onClick={async () => (await askConfirm(t("usr.resetovatMfaUzivatelSiHo"))) && action.mutate("mfa")}>
              {t("usr.resetovatMfa")}
            </Button>
          )}
          {locked && (
            <Button variant="secondary" onClick={() => action.mutate("unlock")}>
              {t("usr.odemknoutUcet")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AuthProviderSelect({ value, onChange, disabled }: { value: "local" | "oidc" | "ad"; onChange: (v: "local" | "oidc" | "ad") => void; disabled?: boolean }) {
  const t = useT();
  return (
    <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as "local" | "oidc" | "ad")}>
      <option value="local">{t("usr.lokalniUcetHesloMfa")}</option>
      <option value="ad">{t("usr.authAd")}</option>
      <option value="oidc">{t("usr.firemniUcetEntraIdAd")}</option>
    </Select>
  );
}
