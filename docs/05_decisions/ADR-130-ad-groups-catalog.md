# ADR-130: Skupiny z AD do katalogu oprávnění a zakládání nových skupin (v1.33)

## Kontext

Ruční zakládání oprávnění s DN skupin bylo pracné a náchylné k chybám (neúplné DN povolené OU, vestavěný účet
správce jako zapisovací účet). U zákazníků většinou skupiny v AD už existují a nové vznikají až s novými aplikacemi.

## Rozhodnutí

1. Synchronizace zdroje identit AD ukládá skupiny do `identity_groups` (DN, CN, popis, privilegovaná podle SID / názvu,
   chráněná `adminCount`, počet přímých členů z načtených uživatelů); chybějící se označí `removed_at`. Jen čtení AD.
2. Katalog: `GET /access/ad-groups` (skupiny + seznam OU včetně nadřazených) a `POST /access/resources/import-ad`
   (hromadné založení oprávnění typu skupina AD; privilegované / chráněné se označí; volitelné převzetí stávajících členů
   jen přes vyhodnocení `reconcileCompany`).
3. Nová skupina: `iam_resources.ad_create` + DN `CN=<název>,<OU>`; `provisioningGroupPlan` kontroluje OU a název;
   skript `New-ADGroup` (idempotentně s `Get-ADGroup`), zápis `AdWriter.createGroup` (globální bezpečnostní skupina)
   vždy před členstvím; příznak zmizí po úspěšném zápisu nebo když synchronizace skupinu najde. Delegace „Create group
   objects“ jen na povolenou OU.
4. Nastavení zápisu: povolená OU výběrem ze seznamu OU, serverová kontrola `allowedOuError` (úplné DN s doménou, ne celá
   doména) a `bindAccountError` (ne Administrator / admin, formát UPN / DOMÉNA\účet / DN). Migrace 0100.

## Důsledky

- Katalog se naplní během minut z existujícího AD; nové skupiny vznikají řízeně a auditovaně.
- Entra ID skupiny zatím ne (jen AD).
