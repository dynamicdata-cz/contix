# ADR-004: Identita a přístup – lokální účty + OIDC (Entra ID / AD FS), RBAC, MFA

- **Stav:** přijato
- **Datum:** 2026-09-28

## Kontext

CONTIX potřebuje administraci uživatelů, role dle ZKB (CISO, Manažer KB, Architekt, Auditor, Garant aktiva…),
skupiny, podporu firemního přihlášení (Entra ID, Active Directory) a MFA.

## Rozhodnutí

1. **Vlastní implementace** nad Hono + Drizzle (bez externí auth knihovny): session v DB, cookie HttpOnly, Argon2id.
   Důvod: plná kontrola nad auditní stopou a chováním (GRC produkt je sám předmětem auditu), málo kódu, žádná závislost navíc.
2. **SSO přes OIDC** (Authorization Code + PKCE, ověření id_tokenu přes JWKS – knihovna `jose`):
   Entra ID, Google a obecný OIDC (AD FS, Keycloak). **Bez přímého LDAP bindu** – AD přes Entra Connect nebo AD FS.
3. **MFA:** lokální účty TOTP (RFC 6238) + záložní kódy; SSO účty – MFA vynucuje IdP.
4. **RBAC:** katalog oprávnění v kódu, role v DB (systémové + vlastní), role přímo / přes skupinu / mapováním skupin IdP.
   Vlastnictví aktiva (`assets.owner_user_id`) + oprávnění `assets:write_own` = úpravy jen vlastních aktiv.
5. **Auditní log** všech bezpečnostně relevantních událostí v tabulce `audit_log`.

## Alternativy

- *Better Auth / Lucia* – méně kódu na OAuth, ale další závislost a méně kontroly nad auditem; lze přejít později.
- *oauth2-proxy / Authentik před aplikací* – jednoduché, ale bez lokálních účtů a bez jemného mapování rolí v aplikaci.
- *LDAP bind do AD* – heslo prochází aplikací, nelze vynutit moderní MFA → zamítnuto.

## Důsledky

- (+) Jedna aplikace zvládne malé organizace (lokální účty + TOTP) i velké (Entra ID + Conditional Access).
- (+) Role a skupiny lze řídit centrálně v Entra ID / AD.
- (−) Vlastní kód autentizace vyžaduje pečlivé testy (pokryto integračními testy vč. mock IdP) a pravidelné review.
- `APP_SECRET` je v produkci povinný; jeho změna zneplatní uložená MFA tajemství.
