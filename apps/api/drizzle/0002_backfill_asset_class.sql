-- Existující aktiva: třída podle typu (primární = informace, služby, procesy).
-- Porovnání přes ::text – nové hodnoty enumu nelze použít ve stejné transakci, ve které vznikly.
UPDATE "assets" SET "asset_class" = 'primary'
WHERE "asset_type"::text IN ('information_asset', 'business_service', 'business_process');
