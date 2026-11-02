# Modul Organizace

Organizační struktura jako strom **útvarů** (organizace → sekce/úsek → odbor → oddělení → tým) a v nich
**funkční místa** (pracovní pozice). Modul `organization`.

- Funkční místo: název, kód, popis, příznak vedoucího, **bezpečnostní role dle ZKB** (výbor pro řízení KB, manažer KB,
  architekt KB, garant aktiva, auditor KB, pověřenec GDPR – lze doplnit vlastní) a **obsazení** (0..n uživatelů CONTIX).
- Na funkční místa (a útvary) se odkazují: vlastník procesu, vlastník rizika, RACI v krocích procesu.
  Personální změna = změna obsazení, vazby zůstávají platné.
- Ochrany: útvar nesmí být svým předkem (cyklus); nelze smazat útvar s podřízenými útvary nebo garantovanými procesy;
  nelze smazat funkční místo, které vlastní procesy nebo rizika (`GET /api/org/positions/:id/usage` ukáže, kde je použito).
- Oprávnění: `org:read`, `org:write`.
- Pozn.: bezpečnostní role na funkčním místě jsou **evidenční** (kdo je kdo dle ZKB); oprávnění v aplikaci
  řídí role v Administraci. Propojení (např. automatické přidělení role „Manažer KB“ držiteli místa) je možné rozšíření.
