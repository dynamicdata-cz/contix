-- v1.102.1: úkoly z nálezů identit nesly v názvu vnitřní ID účtu / počítače – nahradit přihlašovacím jménem nebo názvem počítače
UPDATE "tasks" t
SET "title" = left(regexp_replace(t."title", ': (computer:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', ': ' || coalesce(ia."login", ic."name")), 500)
FROM "identity_findings" f
LEFT JOIN "identity_accounts" ia ON ia."id" = f."account_id"
LEFT JOIN "identity_computers" ic ON ic."id" = f."computer_id"
WHERE t."source_kind" = 'identity_finding'
  AND t."source_id" = f."id"
  AND coalesce(ia."login", ic."name") IS NOT NULL
  AND t."title" ~ ': (computer:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
