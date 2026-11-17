-- v1.74 (ADR-167): odpovědný útvar aktiva z dosavadního volného textu – jen jednoznačná shoda názvu útvaru
-- ve stejné společnosti (bez ohledu na velikost písmen a mezery na krajích); text owner_name zůstává.
UPDATE "assets" a
SET "owner_unit_id" = u."id"
FROM "org_units" u
WHERE a."owner_unit_id" IS NULL
  AND a."owner_name" IS NOT NULL
  AND u."company_id" = a."company_id"
  AND lower(trim(u."name")) = lower(trim(a."owner_name"))
  AND (SELECT count(*) FROM "org_units" u2 WHERE u2."company_id" = a."company_id" AND lower(trim(u2."name")) = lower(trim(a."owner_name"))) = 1;
