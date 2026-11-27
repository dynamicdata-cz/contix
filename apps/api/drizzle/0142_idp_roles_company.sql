-- v1.115.1: role ze skupin AD / IdP patří ke společnosti uživatele, ne ke kořenové společnosti.
-- Dřív zapsané role (source = idp) u uživatelů jiné než kořenové společnosti se přesunou k jejich společnosti;
-- při dalším přihlášení se role ze skupin stejně znovu nastaví správně.
DELETE FROM "user_roles" ur
USING "users" u
WHERE ur."user_id" = u."id"
  AND ur."source" = 'idp'
  AND ur."company_id" = '00000000-0000-4000-8000-000000000001'
  AND u."company_id" <> '00000000-0000-4000-8000-000000000001'
  AND EXISTS (
    SELECT 1 FROM "user_roles" x
    WHERE x."user_id" = ur."user_id" AND x."role_id" = ur."role_id" AND x."source" = 'idp' AND x."company_id" = u."company_id"
  );
--> statement-breakpoint
UPDATE "user_roles" ur
SET "company_id" = u."company_id"
FROM "users" u
WHERE ur."user_id" = u."id"
  AND ur."source" = 'idp'
  AND ur."company_id" = '00000000-0000-4000-8000-000000000001'
  AND u."company_id" <> '00000000-0000-4000-8000-000000000001';
