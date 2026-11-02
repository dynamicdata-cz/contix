import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Modal, Textarea, toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { PERMISSION_GROUPS, PERMISSIONS, type Permission, type RoleDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { useState } from "react";

export function AdminRolesPage() {
  const t = useT();
  const can = useCan();
  const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: api.admin.roles });
  const [editing, setEditing] = useState<RoleDto | "new" | null>(null);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          {t("usr.roleJsouSadyOpravneniSystemove")}
        </p>
        {can("admin:roles") && (
          <Button onClick={() => setEditing("new")}>
            <Plus size={16} /> {t("usr.novaRole")}
          </Button>
        )}
      </div>
      <ErrorBox error={roles.error} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.data?.map((r) => (
          <Card
            key={r.id}
            className={can("admin:roles") ? "cursor-pointer p-5 transition hover:border-brand-500" : "p-5"}
            onClick={() => can("admin:roles") && setEditing(r)}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{r.name}</h3>
                <p className="font-mono text-xs text-slate-400">{r.key}</p>
              </div>
              {r.isSystem ? <Badge>{t("usr.systemova")}</Badge> : <Badge tone="violet">{t("usr.vlastni")}</Badge>}
            </div>
            {r.description && <p className="mt-2 text-sm text-slate-600">{r.description}</p>}
            <div className="mt-3 flex flex-wrap gap-1">
              {r.permissions.map((p) => (
                <Badge key={p} tone="blue">
                  {p}
                </Badge>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Users size={13} /> {r.userCount ?? 0} {t("usr.primoPrirazenych")}
              </span>
              {!!r.externalGroups.length && <span>{t("usr.skupinIdp", { length: r.externalGroups.length })}</span>}
            </div>
          </Card>
        ))}
      </div>
      {editing && <RoleModal role={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoleModal({ role, onClose }: { role: RoleDto | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [key, setKey] = useState(role?.key ?? "");
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? ["assets:read"]);
  const [ext, setExt] = useState((role?.externalGroups ?? []).join("\n"));
  const isAdmin = role?.key === "admin";
  const done = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
    onClose();
  };
  const externalGroups = ext
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const save = useMutation({
    mutationFn: () =>
      role
        ? api.admin.updateRole(role.id, { name, description: description || null, externalGroups, ...(isAdmin ? {} : { permissions }) })
        : api.admin.createRole({ key, name, description: description || null, permissions, externalGroups }),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api.admin.deleteRole(role!.id), onSuccess: done });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={role ? `Role: ${role.name}` : t("usr.novaRole")}
      footer={
        <>
          {role && !role.isSystem && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("usr.smazatRoli"))) && remove.mutate()}>
              {t("usr.smazat")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name || (!role && !key)}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("usr.nazev")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("usr.naprPoverenecProOchranuOu")} />
        </Field>
        <Field label={t("usr.klic")} hint={t("usr.technickyIdentifikatorNelzePozdejiZmenit")}>
          <Input value={key} disabled={!!role} onChange={(e) => setKey(e.target.value)} placeholder={t("usr.dpo")} className="font-mono" />
        </Field>
        <Field label={t("usr.popis")} className="sm:col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">{t("usr.opravneni")}</p>
        {isAdmin && <p className="mb-2 text-xs text-slate-500">{t("usr.administratorMaVzdyVsechnaOpravneni")}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.label} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
              {g.permissions.map((p) => (
                <Checkbox
                  key={p}
                  disabled={isAdmin}
                  checked={isAdmin || permissions.includes(p)}
                  onChange={(v) => setPermissions(toggle(permissions, p, v))}
                  label={PERMISSIONS[p]}
                  hint={p}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <Field
        label={t("usr.skupinyVEntraIdAd")}
        hint={t("usr.kazdaNaNovyRadekEntra")}
      >
        <Textarea value={ext} onChange={(e) => setExt(e.target.value)} className="font-mono text-xs" placeholder="3f2a…-group-object-id&#10;GG-CONTIX-Auditori" />
      </Field>
      <ErrorBox error={save.error ?? remove.error} />
    </Modal>
  );
}
