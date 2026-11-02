import { TargetCompanyField, useTargetCompany } from "@/components/company";
import { Markdown } from "@/components/markdown";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { askConfirm, toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useFormGuard } from "@/lib/unsaved";
import { useUrlParam } from "@/lib/urlState";
import { fmtDate, useDebounced } from "@/lib/utils";
import { KNOWLEDGE_LABELS, KNOWLEDGE_STATUSES, type KnowledgeArticleDto, type KnowledgeStatus } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { BookOpenText, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

/** Znalostní báze (v1.07, ADR-103): vlastní postupy, FAQ a runbooky – zveřejněné články jsou podkladem hledání a AI. */
export function KnowledgePage() {
  const t = useT();
  const can = useCan();
  const [q, setQ] = useUrlParam("q");
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ["knowledge", dq], queryFn: () => api.knowledge.list(dq || undefined) });
  return (
    <>
      <PageHeader
        title={t("kb.title")}
        subtitle={t("kb.subtitle")}
        actions={
          can("knowledge:write") && (
            <Link to="/knowledge/$articleId" params={{ articleId: "new" }}>
              <Button>
                <Plus size={16} /> {t("kb.new")}
              </Button>
            </Link>
          )
        }
      />
      <Input className="mb-4 max-w-sm" placeholder={t("kb.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorBox error={list.error} />
      {list.data && !list.data.length ? (
        <Card>
          <EmptyState>{t("kb.empty")}</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(list.data ?? []).map((a) => (
            <Link key={a.id} to="/knowledge/$articleId" params={{ articleId: a.id }} className="group">
              <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                    <BookOpenText size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 group-hover:text-brand-700">{a.title}</div>
                    <div className="mt-1 line-clamp-2 text-sm text-slate-500">{a.body.replace(/[#*_`>-]/g, "").slice(0, 220)}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {a.status === "draft" && <Badge tone="amber">{t.lbl(KNOWLEDGE_LABELS.status.draft)}</Badge>}
                      {a.tags.map((x) => (
                        <Badge key={x} tone="slate">
                          {x}
                        </Badge>
                      ))}
                      <span className="ml-auto text-xs text-slate-400">{fmtDate(a.updatedAt)}</span>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function KnowledgeArticlePage() {
  const { articleId } = useParams({ strict: false }) as { articleId: string };
  const isNew = articleId === "new";
  const q = useQuery({ queryKey: ["knowledge", "detail", articleId], queryFn: () => api.knowledge.get(articleId), enabled: !isNew });
  if (!isNew && !q.data) return <ErrorBox error={q.error} />;
  return <ArticleEditor key={q.data?.id ?? "new"} a={q.data ?? null} />;
}

function ArticleEditor({ a }: { a: KnowledgeArticleDto | null }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const nav = useNavigate();
  const edit = a ? a.canEdit : can("knowledge:write");
  const [mode, setMode] = useState<"view" | "edit">(a ? "view" : "edit");
  const target = useTargetCompany();
  const [f, setF] = useState({ title: a?.title ?? "", body: a?.body ?? "", tags: (a?.tags ?? []).join(", "), status: (a?.status ?? "draft") as KnowledgeStatus });
  const body = () => ({ title: f.title, body: f.body, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean), status: f.status });
  const save = useMutation({
    mutationFn: () => (a ? api.knowledge.update(a.id, body()) : api.knowledge.create({ ...body(), companyId: target.companyId })),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      toast(t("kb.saved"));
      if (!a) nav({ to: "/knowledge/$articleId", params: { articleId: d.id } });
      else setMode("view");
    },
  });
  const guard = useFormGuard(save);
  const del = useMutation({
    mutationFn: () => api.knowledge.remove(a!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      nav({ to: "/knowledge" });
    },
  });
  return (
    <>
      <PageHeader
        title={a ? a.title : t("kb.new")}
        subtitle={a ? t("kb.meta", { date: fmtDate(a.updatedAt), who: a.updatedByName ?? "—" }) : t("kb.subtitle")}
        actions={
          <>
            {a && edit && mode === "view" && (
              <Button variant="secondary" onClick={() => setMode("edit")}>
                <Pencil size={15} /> {t("kb.edit")}
              </Button>
            )}
            {a && edit && mode === "edit" && (
              <Button variant="secondary" onClick={() => setMode("view")}>
                <Eye size={15} /> {t("kb.preview")}
              </Button>
            )}
            {a && edit && (
              <Button variant="danger" aria-label={t("common.delete")} onClick={async () => (await askConfirm(t("kb.deleteConfirm", { title: a.title }))) && del.mutate()}>
                <Trash2 size={15} />
              </Button>
            )}
            {edit && mode === "edit" && (
              <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
                {a ? t("cra.save") : t("common.create")}
              </Button>
            )}
          </>
        }
      />
      {mode === "view" && a ? (
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap gap-1.5">
            <Badge tone={a.status === "published" ? "green" : "amber"}>{t.lbl(KNOWLEDGE_LABELS.status[a.status])}</Badge>
            {a.tags.map((x) => (
              <Badge key={x} tone="slate">
                {x}
              </Badge>
            ))}
          </div>
          <div className="prose-contix max-w-3xl">{a.body.trim() ? <Markdown text={a.body} /> : <EmptyState>{t("kb.emptyBody")}</EmptyState>}</div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("kb.editor")} subtitle={t("kb.editorHint")} />
            <fieldset disabled={!edit} className="space-y-4 p-5" {...guard.bind}>
              {!a && <TargetCompanyField value={target.companyId} onChange={target.setCompanyId} />}
              <Field label={t("kb.fTitle")}>
                <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("kb.fTags")} hint={t("kb.fTagsHint")}>
                  <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
                </Field>
                <Field label={t("kb.fStatus")} hint={t("kb.fStatusHint")}>
                  <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as KnowledgeStatus })}>
                    {KNOWLEDGE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t.lbl(KNOWLEDGE_LABELS.status[s])}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label={t("kb.fBody")}>
                <Textarea rows={18} className="font-mono text-[13px]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
              </Field>
              <ErrorBox error={save.error ?? del.error} />
            </fieldset>
          </Card>
          <Card>
            <CardHeader title={t("kb.preview")} />
            <div className="prose-contix p-5">{f.body.trim() ? <Markdown text={f.body} /> : <EmptyState>{t("kb.emptyBody")}</EmptyState>}</div>
          </Card>
        </div>
      )}
    </>
  );
}
