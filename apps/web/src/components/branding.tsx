import { Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { BRAND_LOGO_MAX_BYTES, type CompanyDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

/** Vzhled výstupů (v1.59, ADR-154): logo, barva a zápatí ve všech PDF / tiskových výstupech a ve Wordu. */
export function BrandingCard({ companies }: { companies: CompanyDto[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const q = useQuery({ queryKey: ["branding", companyId], queryFn: () => api.branding.get(companyId), enabled: !!companyId });
  const d = q.data;
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [accent, setAccent] = useState("");
  const [footer, setFooter] = useState("");
  const [showName, setShowName] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** Načítání souboru loga (FileReader je asynchronní) – uložit až po načtení. */
  const [reading, setReading] = useState(false);
  /**
   * Formulář se naplní z uložených dat jen jednou pro každou společnost – pozdější odpověď serveru
   * (pomalé načtení, obnovení dotazu) nesmí přepsat rozpracované změny, např. právě vybrané logo.
   * Logo se vrací na uložené jen při přepnutí společnosti a po obnovení výchozího vzhledu.
   */
  const [initFor, setInitFor] = useState<string | null>(null);
  useEffect(() => {
    if (!d || initFor === companyId) return;
    setInitFor(companyId);
    setAccent(d.own ? (d.accentColor ?? "") : "");
    setFooter(d.own ? d.footerText : "");
    setShowName(d.own ? d.showName : true);
  }, [d, companyId, initFor]);
  const done = () => qc.invalidateQueries({ queryKey: ["branding"] });
  const save = useMutation({ mutationFn: () => api.branding.save(companyId, { logo, accentColor: accent || null, footerText: footer, showName }), onSuccess: done });
  const reset = useMutation({
    mutationFn: () => api.branding.remove(companyId),
    onSuccess: () => {
      setLogo(undefined);
      setInitFor(null);
      return done();
    },
  });
  const shown = logo === undefined ? d?.logo : logo;
  const name = companies.find((c) => c.id === companyId)?.name ?? "";
  const color = accent || (!d?.own && d?.accentColor) || "#cbd5e1";
  return (
    <Card className="mt-6" data-testid="branding-card">
      <CardHeader title={t("br.title")} subtitle={t("br.subtitle")} />
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label={t("br.company")}>
            <Select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setLogo(undefined);
              }}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {" ".repeat(c.depth * 3)}
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {d && !d.own && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{d.sourceCompanyName ? t("br.inherited", { name: d.sourceCompanyName }) : t("br.none")}</p>}
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">{t("br.logo")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
                <ImagePlus size={16} /> {t("br.upload")}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  aria-label={t("br.upload")}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > BRAND_LOGO_MAX_BYTES) return setErr(t("br.tooBig"));
                    if (!/^image\/(png|jpeg)$/.test(f.type)) return setErr(t("br.badType"));
                    setErr(null);
                    setReading(true);
                    const r = new FileReader();
                    r.onload = () => {
                      setLogo(String(r.result));
                      setReading(false);
                    };
                    r.onerror = () => {
                      setErr(t("br.badType"));
                      setReading(false);
                    };
                    r.readAsDataURL(f);
                  }}
                />
              </label>
              {shown && (
                <Button variant="ghost" className="text-red-700" onClick={() => setLogo(null)}>
                  <Trash2 size={14} /> {t("br.removeLogo")}
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">{t("br.logoHint")}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("br.accent")} className="w-48">
              <div className="flex items-center gap-2">
                <input type="color" value={accent || "#1d4ed8"} onChange={(e) => setAccent(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white" aria-label={t("br.accent")} />
                <Input value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#1d4ed8" className="w-28" />
              </div>
            </Field>
            {accent && (
              <Button variant="ghost" onClick={() => setAccent("")}>
                {t("br.defaultColor")}
              </Button>
            )}
          </div>
          <Field label={t("br.footer")} hint={t("br.footerHint")}>
            <Input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder={t("br.footerPh")} maxLength={200} />
          </Field>
          <Checkbox checked={showName} onChange={setShowName} label={t("br.showName")} />
          <div className="flex gap-2 pt-1">
            <Button disabled={save.isPending || reading || !companyId} onClick={() => save.mutate()} data-testid="branding-save">
              {t("br.save")}
            </Button>
            {d?.own && (
              <Button variant="ghost" onClick={() => reset.mutate()}>
                {t("br.reset")}
              </Button>
            )}
          </div>
          {err && <p className="text-sm text-red-700">{err}</p>}
          <ErrorBox error={q.error ?? save.error ?? reset.error} />
          {save.isSuccess && <p className="text-sm text-emerald-700">{t("br.saved")}</p>}
        </div>
        {/* náhled záhlaví a zápatí stránky */}
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">{t("br.preview")}</p>
          <div className="rounded-lg border border-slate-200 p-5 shadow-sm" data-testid="branding-preview" style={{ color: "#1e293b", backgroundColor: "#ffffff" }}>
            <div className="flex items-center justify-between gap-4 pb-2" style={{ borderBottom: `2px solid ${color}` }}>
              {shown ? <img src={shown} alt="" className="max-h-10 max-w-[180px] object-contain" /> : <span className="text-xs" style={{ color: "#64748b" }}>{t("br.noLogo")}</span>}
              {showName && <span className="text-xs" style={{ color: "#64748b" }}>{name}</span>}
            </div>
            <div className="mt-4 text-lg font-bold" style={{ color: accent || "#0f172a" }}>
              {t("br.sampleTitle")}
            </div>
            <div className="mt-3 border-b pb-1 text-sm font-semibold" style={{ color: accent || "#1e293b", borderColor: color }}>
              {t("br.sampleH2")}
            </div>
            <div className="mt-2 h-2 w-3/4 rounded bg-slate-100" />
            <div className="mt-1.5 h-2 w-2/3 rounded bg-slate-100" />
            <div className="mt-6 border-t pt-1 text-center text-[11px]" style={{ color: "#64748b", borderColor: "#e2e8f0" }}>{[footer, t("br.samplePage")].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
