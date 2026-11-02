import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Textarea, toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import type { GroupDto } from "@contix/shared";
import { ROOT_COMPANY_ID } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

export function AdminGroupsPage() {
  const t = useT();
  const groups = useQuery({ queryKey: ["admin", "groups"], queryFn: api.admin.groups });
  const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: api.admin.roles });
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: api.admin.users });
  const [editing, setEditing] = useState<GroupDto | "new" | null>(null);
  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? "…";

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          {t("usr.skupinySdruzujiUzivateleNaprBezpecnostni")}
        </p>
        <Button onClick={() => setEditing("new")}>
          <Plus size={16} /> {t("usr.novaSkupina")}
        </Button>
      </div>
      <ErrorBox error={groups.error} />
      <Card>
        <ul className="divide-y divide-slate-100">
          {groups.data?.map((g) => (
            <li key={g.id} className="cursor-pointer px-5 py-4 hover:bg-slate-50" onClick={() => setEditing(g)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{g.name}</div>
                  {g.description && <div className="text-sm text-slate-500">{g.description}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {g.roleIds.map((id) => (
                    <Badge key={id} tone="blue">
                      {roleName(id)}
                    </Badge>
                  ))}
                  <span className="ml-2 text-sm text-slate-500">{t("usr.clenu", { length: g.memberIds.length })}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {groups.data && !groups.data.length && <EmptyState>{t("usr.zatimZadneSkupiny")}</EmptyState>}
      </Card>
      {editing && (
        <GroupModal group={editing === "new" ? null : editing} users={users.data ?? []} roles={roles.data ?? []} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function GroupModal({
  group,
  users,
  roles,
  onClose,
}: {
  group: GroupDto | null;
  users: { id: string; displayName: string; email: string }[];
  roles: { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [roleIds, setRoleIds] = useState(group?.roleIds ?? []);
  const [memberIds, setMemberIds] = useState(group?.memberIds ?? []);
  const [q, setQ] = useState("");
  const done = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      // role skupiny pro celou skupinu (kořen); role skupiny přidělené konkrétním společnostem se zachovají
      const roleAssignments = [
        ...(group?.roleAssignments ?? []).filter((a) => a.companyId !== ROOT_COMPANY_ID),
        ...roleIds.map((roleId) => ({ roleId, companyId: ROOT_COMPANY_ID })),
      ];
      const data = { name, description: description || null, memberIds, ...(can("admin:roles") ? { roleAssignments } : {}) };
      return group ? api.admin.updateGroup(group.id, data) : api.admin.createGroup(data);
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api.admin.deleteGroup(group!.id), onSuccess: done });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={group ? `Skupina: ${group.name}` : t("usr.novaSkupina")}
      footer={
        <>
          {group && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("usr.smazatSkupinu"))) && remove.mutate()}>
              {t("usr.smazat")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <Field label={t("usr.nazev")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("usr.popis")}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{t("usr.roleSkupiny")}</p>
          {roles.map((r) => (
            <Checkbox key={r.id} disabled={!can("admin:roles")} checked={roleIds.includes(r.id)} onChange={(v) => setRoleIds(toggle(roleIds, r.id, v))} label={r.name} />
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{t("usr.clenove", { length: memberIds.length })}</p>
          <Input placeholder={t("usr.filtrovat")} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {users
              .filter((u) => !q || `${u.displayName} ${u.email}`.toLowerCase().includes(q.toLowerCase()))
              .map((u) => (
                <Checkbox key={u.id} checked={memberIds.includes(u.id)} onChange={(v) => setMemberIds(toggle(memberIds, u.id, v))} label={u.displayName} hint={u.email} />
              ))}
          </div>
        </div>
      </div>
      <ErrorBox error={save.error ?? remove.error} />
    </Modal>
  );
}
