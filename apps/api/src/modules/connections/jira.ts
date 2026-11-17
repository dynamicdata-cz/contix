import { connectionCovers, type ExternalIssueDto, type JiraConnectionDto, type JiraConnectionInput } from "@contix/shared";
import { and, asc, count, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { decrypt, encrypt } from "../../auth/crypto";
import { audit } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { connections, externalIssues, tasks } from "../../db/schema";
import { describeFetchError, type FetchLike } from "../discovery/connectors/wazuh";

/* ============================================================
 * JIRA (v1.53, ADR-150): úkol CONTIXu → issue v projektu; stav issue se čte zpět a „hotovo“ uzavře úkol.
 * Cloud: Basic e-mail + API token; Data Center: Bearer osobní přístupový token. Token jen šifrovaně.
 * ============================================================ */

export interface JiraConn {
  id: string;
  name: string;
  enabled: boolean;
  url: string;
  deployment: "cloud" | "datacenter";
  user: string;
  token: string | null;
  verifyTls: boolean;
  projectKey: string;
  issueType: string;
  doneStatuses: string[];
  companyId: string | null;
}

type Row = typeof connections.$inferSelect;
function toConn(r: Row, config: Config): JiraConn {
  const c = r.config as Partial<JiraConn>;
  let token: string | null = null;
  try {
    token = r.secrets.token ? decrypt(r.secrets.token, appSecret(config)) : null;
  } catch {
    token = null;
  }
  return { id: r.id, name: r.name, enabled: r.enabled, url: c.url ?? "", deployment: c.deployment ?? "cloud", user: c.user ?? "", token, verifyTls: c.verifyTls ?? true, projectKey: c.projectKey ?? "", issueType: c.issueType ?? "Task", doneStatuses: c.doneStatuses ?? ["Done"], companyId: r.companyId };
}

export async function listJira(db: Db, config: Config): Promise<JiraConn[]> {
  return (await db.select().from(connections).where(eq(connections.kind, "jira")).orderBy(asc(connections.createdAt))).map((r) => toConn(r, config));
}

export async function saveJira(db: Db, config: Config, id: string | null, i: JiraConnectionInput): Promise<string> {
  const prev = id ? (await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.kind, "jira"))))[0] : undefined;
  const token = i.token ? encrypt(i.token, appSecret(config)) : prev?.secrets.token;
  const values = {
    kind: "jira",
    name: i.name,
    enabled: i.enabled ?? true,
    companyId: i.companyId ?? null,
    config: { url: i.url.replace(/\/+$/, ""), deployment: i.deployment ?? "cloud", user: i.user ?? "", verifyTls: i.verifyTls ?? true, projectKey: i.projectKey, issueType: i.issueType ?? "Task", doneStatuses: i.doneStatuses ?? ["Done", "Hotovo"] },
    secrets: (token ? { token } : {}) as Record<string, string>,
    updatedAt: new Date(),
  };
  if (prev) {
    await db.update(connections).set(values).where(eq(connections.id, prev.id));
    return prev.id;
  }
  const [r] = await db.insert(connections).values(values).returning({ id: connections.id });
  return r!.id;
}

export async function jiraDtos(db: Db, config: Config): Promise<JiraConnectionDto[]> {
  const list = await listJira(db, config);
  if (!list.length) return [];
  const n = await db.select({ id: externalIssues.connectionId, n: count() }).from(externalIssues).where(inArray(externalIssues.connectionId, list.map((x) => x.id))).groupBy(externalIssues.connectionId);
  return list.map((c) => ({ id: c.id, kind: "jira", name: c.name, enabled: c.enabled, url: c.url, deployment: c.deployment, user: c.user, hasToken: !!c.token, verifyTls: c.verifyTls, projectKey: c.projectKey, issueType: c.issueType, doneStatuses: c.doneStatuses, companyId: c.companyId, issues: n.find((x) => x.id === c.id)?.n ?? 0 }));
}

export function jiraClient(c: Pick<JiraConn, "url" | "deployment" | "user" | "token" | "verifyTls">, fetchImpl: FetchLike = fetch as FetchLike) {
  const tls = c.verifyTls === false ? { rejectUnauthorized: false } : undefined;
  const auth = c.deployment === "cloud" ? `Basic ${btoa(`${c.user}:${c.token}`)}` : `Bearer ${c.token}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const url = `${c.url}${path}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, tls, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(describeFetchError(e, url).replace("Wazuh API", "JIRA"));
    }
    if (res.status === 401 || res.status === 403) throw new Error("JIRA odmítla přihlášení nebo účet nemá oprávnění k projektu.");
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new Error(`JIRA ${path.split("?")[0]}: HTTP ${res.status} ${JSON.stringify(json?.errors ?? json?.errorMessages ?? "").slice(0, 200)}`);
    return json;
  };
  return {
    myself: () => call("GET", "/rest/api/2/myself"),
    project: (key: string) => call("GET", `/rest/api/2/project/${encodeURIComponent(key)}`),
    create: (fields: Record<string, unknown>) => call("POST", "/rest/api/2/issue", { fields }) as Promise<{ id: string; key: string }>,
    status: async (key: string) => ((await call("GET", `/rest/api/2/issue/${encodeURIComponent(key)}?fields=status`)) as any)?.fields?.status?.name as string | undefined,
  };
}

export async function testJira(c: JiraConn | (JiraConnectionInput & { token: string }), fetchImpl?: FetchLike) {
  const cl = jiraClient({ url: c.url.replace(/\/+$/, ""), deployment: c.deployment ?? "cloud", user: c.user ?? "", token: c.token ?? null, verifyTls: c.verifyTls ?? true }, fetchImpl);
  const me = await cl.myself();
  const p = await cl.project(c.projectKey);
  return { user: (me?.displayName as string) ?? null, project: (p?.name as string) ?? c.projectKey };
}

/** Připojení JIRA pro společnost (vybrané, jinak první pokrývající). */
export async function jiraFor(db: Db, config: Config, companyId: string, connectionId?: string | null) {
  const all = (await listJira(db, config)).filter((c) => c.enabled && c.token);
  return (connectionId ? all.find((c) => c.id === connectionId) : all.find((c) => connectionCovers({ companyId: c.companyId, groupMap: [] }, companyId))) ?? null;
}

export async function issueDtos(db: Db, entityType: string, entityId: string): Promise<ExternalIssueDto[]> {
  const rows = await db.select({ i: externalIssues, name: connections.name }).from(externalIssues).innerJoin(connections, eq(connections.id, externalIssues.connectionId)).where(and(eq(externalIssues.entityType, entityType), eq(externalIssues.entityId, entityId)));
  return rows.map(({ i, name }) => ({ id: i.id, connectionId: i.connectionId, connectionName: name, entityType: "task", entityId: i.entityId, issueKey: i.issueKey, issueUrl: i.issueUrl, status: i.status, lastSyncAt: i.lastSyncAt?.toISOString() ?? null }));
}

/** Stav issue zpět (plánovač, nejvýš jednou za hodinu na issue): hotovo v JIRA → úkol v CONTIXu hotový. */
export async function syncJiraIssues(db: Db, config: Config, now = new Date(), fetchImpl?: FetchLike) {
  const conns = new Map((await listJira(db, config)).filter((c) => c.enabled && c.token).map((c) => [c.id, c]));
  if (!conns.size) return { checked: 0, closed: 0 };
  const due = await db
    .select({ i: externalIssues, taskStatus: tasks.status })
    .from(externalIssues)
    .innerJoin(tasks, eq(tasks.id, externalIssues.entityId))
    .where(and(eq(externalIssues.entityType, "task"), inArray(tasks.status, ["open", "in_progress"]), or(isNull(externalIssues.lastSyncAt), lt(externalIssues.lastSyncAt, new Date(now.getTime() - 3600_000)))))
    .limit(200);
  let closed = 0;
  for (const { i } of due) {
    const c = conns.get(i.connectionId);
    if (!c) continue;
    try {
      const st = (await jiraClient(c, fetchImpl).status(i.issueKey)) ?? null;
      await db.update(externalIssues).set({ status: st, lastSyncAt: now, updatedAt: now }).where(eq(externalIssues.id, i.id));
      if (st && c.doneStatuses.some((d) => d.toLowerCase() === st.toLowerCase())) {
        await db.update(tasks).set({ status: "done", completedAt: now, updatedAt: now }).where(eq(tasks.id, i.entityId));
        await audit(db, { action: "jira.task_closed", entityType: "task", entityId: i.entityId, details: { issue: i.issueKey, status: st } });
        closed++;
      }
    } catch {
      await db.update(externalIssues).set({ lastSyncAt: now }).where(eq(externalIssues.id, i.id));
    }
  }
  return { checked: due.length, closed };
}
