import { IntegrationMap } from "@/components/integrationMap";
import { EmptyState, PageHeader } from "@/components/ui";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";

/** Mapa propojení jako samostatná stránka (v1.86) – pro správu, discovery i SOC; odkaz z Přehledu. */
export function IntegrationMapPage() {
  const t = useT();
  const can = useCan();
  if (!can("admin:settings", "discovery:run", "soc:read")) return <EmptyState>{t("imap.empty")}</EmptyState>;
  return (
    <>
      <PageHeader title={t("imap.title")} subtitle={t("imap.dash.sub")} />
      <IntegrationMap testId="integration-map-page" />
    </>
  );
}
