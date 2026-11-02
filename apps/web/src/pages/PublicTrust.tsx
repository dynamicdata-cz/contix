import { Button, ErrorBox, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { TRUST_PUBLIC_TEXT, type PublicTrustDto } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { BadgeCheck, CheckCircle2, Download, FileLock2, ShieldCheck } from "lucide-react";
import { useState } from "react";

/** Veřejná stránka Trust Center /t/<slug> – bez přihlášení; NDA dokumenty s tokenem z odkazu (?t=…). */
export function PublicTrustPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const params = new URLSearchParams(window.location.search);
  const token = params.get("t");
  const [lang, setLang] = useState<"cs" | "en">(params.get("lang") === "en" || (!params.get("lang") && !navigator.language.startsWith("cs")) ? "en" : "cs");
  const L = TRUST_PUBLIC_TEXT[lang];
  const q = useQuery({ queryKey: ["public-trust", slug, token], queryFn: () => api.publicTrust.get(slug, token), retry: false, refetchOnWindowFocus: false });
  const d = q.data;
  const [asking, setAsking] = useState(false);
  if (q.isLoading) return <div className="grid h-full place-items-center text-sm text-slate-500">…</div>;
  if (!d) return <div className="grid h-full place-items-center text-sm text-slate-600">{L.notFound}</div>;
  const day = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString(lang === "cs" ? "cs-CZ" : "en-GB") : "—");
  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-5">
          <ShieldCheck className="text-brand-600" size={28} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-slate-900">{d.title}</h1>
            <div className="text-sm text-slate-500">{d.organization}</div>
          </div>
          <button type="button" className="text-xs text-slate-500 hover:text-brand-700" onClick={() => setLang(lang === "cs" ? "en" : "cs")}>
            {lang === "cs" ? "English" : "Česky"}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {d.access && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{L.accessFor.replace("{name}", d.access.name).replace("{org}", d.access.organization).replace("{date}", day(d.access.expiresAt))}</div>
        )}
        {d.intro && <p className="whitespace-pre-line text-slate-700">{d.intro}</p>}
        {d.certifications.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{L.certifications}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.certifications.map((c, i) => (
                <div key={i} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    <BadgeCheck size={18} className={c.valid ? "text-emerald-600" : "text-slate-400"} /> {c.name}
                  </div>
                  {c.issuer && <div className="mt-1 text-xs text-slate-500">{c.issuer}</div>}
                  <div className="mt-1 text-xs text-slate-500">{c.validUntil ? `${L.validUntil} ${day(c.validUntil)}${c.valid ? "" : ` (${L.expired})`}` : ""}</div>
                  {c.scope && <div className="mt-1 text-xs text-slate-600">{c.scope}</div>}
                </div>
              ))}
            </div>
          </section>
        )}
        {d.monitoring && d.monitoring.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{L.monitoring}</h2>
            <div className="rounded-lg border border-slate-200 bg-white">
              {d.monitoring.map((m, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2 text-sm last:border-0">
                  <CheckCircle2 size={16} className={m.lastResult === "pass" ? "text-emerald-600" : "text-amber-500"} aria-hidden />
                  <span className="flex-1 text-slate-800">{m.label}</span>
                  <span className="tabular-nums text-slate-600">{m.passRate90 == null ? "—" : `${m.passRate90} % ${L.last90}`}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {d.controls && d.controls.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{L.controls}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {d.controls.map((c) => (
                <div key={c.category} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-sm text-slate-600">{c.category}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                    {c.implemented}
                    <span className="text-base font-normal text-slate-400"> / {c.total}</span>
                  </div>
                  <div className="text-xs text-slate-500">{L.implemented}</div>
                </div>
              ))}
            </div>
          </section>
        )}
        {d.documents.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{L.documents}</h2>
            <div className="rounded-lg border border-slate-200 bg-white" data-testid="trust-docs">
              {d.documents.map((x) => {
                const open = x.access === "public" || !!d.access;
                return (
                  <div key={x.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-0">
                    {open ? <Download size={16} className="text-slate-500" aria-hidden /> : <FileLock2 size={16} className="text-slate-400" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-900">{x.title}</div>
                      <div className="text-xs text-slate-500">
                        {x.version ? `${L.version} ${x.version}` : ""}
                        {x.effectiveFrom ? ` · ${L.effective} ${day(x.effectiveFrom)}` : ""}
                      </div>
                    </div>
                    {open && x.available ? (
                      <a className="text-brand-700 hover:underline" href={api.publicTrust.docUrl(d.slug, x.id, x.access === "nda" ? token : null)}>
                        {L.download}
                      </a>
                    ) : open ? (
                      <span className="text-xs text-slate-400">{L.unavailable}</span>
                    ) : (
                      <span className="text-xs text-slate-500">{L.ndaOnly}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {!d.access && d.documents.some((x) => x.access === "nda") && (
              <Button className="mt-3" onClick={() => setAsking(true)}>
                {L.requestAccess}
              </Button>
            )}
          </section>
        )}
        {asking && <RequestForm d={d} lang={lang} onClose={() => setAsking(false)} />}
        {d.subprocessors.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{L.subprocessors}</h2>
            <table className="w-full rounded-lg border border-slate-200 bg-white text-sm">
              <tbody>
                {d.subprocessors.map((s, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-800">{s.name}</td>
                    <td className="px-4 py-2 text-slate-600">{s.purpose ?? ""}</td>
                    <td className="px-4 py-2 text-slate-500">{s.country ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <footer className="pt-4 text-xs text-slate-400">
          {d.contactEmail && (
            <>
              {L.contact}{" "}
              <a className="text-brand-700 hover:underline" href={`mailto:${d.contactEmail}`}>
                {d.contactEmail}
              </a>{" "}
              ·{" "}
            </>
          )}
          {L.updated} {day(d.updatedAt)}
        </footer>
      </main>
    </div>
  );
}

function RequestForm({ d, lang, onClose }: { d: PublicTrustDto; lang: "cs" | "en"; onClose: () => void }) {
  const L = TRUST_PUBLIC_TEXT[lang];
  const [f, setF] = useState({ name: "", email: "", organization: "", reason: "", nda: false, website: "" });
  const send = useMutation({ mutationFn: () => api.publicTrust.request(d.slug, { name: f.name, email: f.email, organization: f.organization, reason: f.reason || null, ndaAccepted: true, website: f.website }) });
  if (send.isSuccess) return <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{L.requestSent}</div>;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" data-testid="trust-request">
      <h2 className="mb-3 font-medium text-slate-900">{L.requestAccess}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          {L.name}
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="text-sm">
          {L.email}
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </label>
        <label className="text-sm">
          {L.organization}
          <Input value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} />
        </label>
        <label className="text-sm sm:col-span-3">
          {L.reason}
          <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </label>
        {/* past na roboty – skryté pole */}
        <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} name="website" />
      </div>
      {d.ndaText && <div className="mt-3 max-h-40 overflow-y-auto whitespace-pre-line rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{d.ndaText}</div>}
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={f.nda} onChange={(e) => setF({ ...f, nda: e.target.checked })} /> {L.ndaAccept}
      </label>
      <div className="mt-3 flex gap-2">
        <Button disabled={!f.nda || !f.name || !f.email || !f.organization || send.isPending} onClick={() => send.mutate()}>
          {L.send}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {L.cancel}
        </Button>
      </div>
      <ErrorBox error={send.error} />
    </section>
  );
}
