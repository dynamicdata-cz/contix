# Autentizace, autorizace a administrace

> Stav: implementováno ve v0.2. Rozhodnutí: [ADR-004](../05_decisions/ADR-004-identity-access.md).

## Přehled

| Způsob přihlášení | Pro koho | MFA |
|---|---|---|
| **Lokální účet** (e-mail + heslo) | malé organizace, servisní/nouzový admin | TOTP v CONTIXu (Microsoft/Google Authenticator) + záložní kódy |
| **Microsoft Entra ID** (OIDC) | organizace v M365 / hybridní AD (Entra Connect) | řídí Entra ID (Conditional Access) |
| **AD FS** (obecné OIDC) | čistě on-prem Active Directory | řídí AD FS (např. Azure MFA adapter) |
| **Google Workspace** (OIDC) | organizace na Google | řídí Google |

Obecné OIDC funguje i s Keycloak, Authentik apod.
Přímé LDAP přihlášení proti AD **není** implementováno záměrně – heslo by procházelo aplikací a nešlo by vynutit MFA.
Doporučená cesta pro AD je Entra ID (přes Entra Connect) nebo AD FS.

## Relace a ochrany

- Session cookie `contix_session`: HttpOnly, SameSite=Lax, Secure v produkci. V DB se ukládá jen SHA-256 hash tokenu.
- Odhlášení při nečinnosti (výchozí 60 min) a maximální délka relace (výchozí 12 h) – nastavitelné v Administraci.
- Zamčení účtu po N neúspěšných pokusech (výchozí 5 / 15 min), obecná chybová hláška (nevyzrazuje existenci účtu).
- Hesla: Argon2id (Bun.password), min. 12 znaků; dočasné heslo od admina → vynucená změna.
- Změna hesla odhlásí ostatní relace; deaktivace uživatele ukončí všechny jeho relace.
- CSRF: kontrola hlavičky `Origin` (hono/csrf) + SameSite cookie.
- TOTP tajemství šifrováno AES-256-GCM klíčem odvozeným z `APP_SECRET`; ochrana proti opakovanému použití kódu; záložní kódy uložené jako hash.
- Nelze odebrat posledního aktivního administrátora; MFA pro všechny nelze vynutit, dokud ho nemá sám administrátor.
- Vše podstatné se zapisuje do **auditního logu** (přihlášení, chyby, MFA, změny uživatelů/rolí/nastavení, změny aktiv).

## Role a oprávnění (RBAC)

Oprávnění jsou v katalogu `packages/shared/src/auth.ts`. Role = sada oprávnění. Uživatel získá role:

1. **přímo** (přidělí administrátor),
2. **ze skupiny** CONTIXu (Administrace → Skupiny),
3. **z IdP** – při SSO přihlášení podle skupin v Entra ID / AD (pole *Skupiny v Entra ID / AD* u role). Tyto role se při každém přihlášení přepočítají.

Systémové role (lze upravit oprávnění, nelze smazat):

| Role | Oprávnění |
|---|---|
| Administrátor | vše |
| CISO | aktiva čtení/zápis/mazání, discovery, audit log |
| Manažer kybernetické bezpečnosti | aktiva čtení/zápis, discovery, audit log |
| Architekt kybernetické bezpečnosti | aktiva čtení/zápis, discovery |
| Auditor kybernetické bezpečnosti | aktiva čtení, audit log |
| Garant / vlastník aktiva | aktiva čtení + úprava **vlastních** aktiv |
| Čtenář | aktiva čtení |

Vlastní role (např. Pověřenec GDPR, Správce IT) vytvoří administrátor.

## První administrátor

- `bun run admin:create admin@firma.cz "Jméno Příjmení"` → vypíše dočasné heslo, nebo
- `.env`: `ADMIN_EMAIL=…` (+ volitelně `ADMIN_PASSWORD`) → vytvoří se při prvním startu, když je DB prázdná, nebo
- `bun run db:seed` (jen vývoj) → `admin@contix.local` + demo uživatelé.

## Nastavení Microsoft Entra ID

1. **Entra admin center → App registrations → New registration**
   - Název: CONTIX, účty: *pouze tento tenant*.
   - Redirect URI (Web): `https://contix.firma.cz/api/auth/oidc/entra/callback` (lokálně `http://localhost:5173/api/auth/oidc/entra/callback`). Přesnou hodnotu ukazuje Administrace → Nastavení.
2. **Certificates & secrets → New client secret** – zkopírujte hodnotu.
3. **Token configuration → Add groups claim** → *Security groups* (nebo *Groups assigned to the application*). Do ID tokenu se pak dostanou **Object ID skupin**.
   - Uživatel ve více než ~200 skupinách: Entra místo seznamu pošle odkaz na Graph – použijte variantu *Groups assigned to the application* nebo **App roles** (hodnota app role se také mapuje).
4. `.env`:
   ```
   APP_URL=https://contix.firma.cz
   ENTRA_TENANT_ID=<Directory (tenant) ID>
   ENTRA_CLIENT_ID=<Application (client) ID>
   ENTRA_CLIENT_SECRET=<secret>
   ```
5. V CONTIXu: u rolí vyplňte Object ID skupin (např. skupina *GG-CONTIX-CISO* → role CISO). Uživatele buď předem založte (typ *Firemní účet*), nebo zapněte *Automaticky zakládat uživatele*.
6. MFA vynuťte v Entra ID přes **Conditional Access** (aplikace CONTIX → Require MFA).

## Nastavení AD FS (on-prem Active Directory)

1. AD FS Management → **Application Groups → Add** → *Server application* (confidential client), redirect URI `https://contix.firma.cz/api/auth/oidc/oidc/callback`, vygenerujte **secret**.
2. Přidejte *Web API* se stejným identifikátorem (client ID) a povolte scope `openid`, `profile`, `email`, `allatclaims`.
3. Issuance Transform Rules: *Send LDAP Attributes as Claims* – `E-Mail-Addresses → email`, `Display-Name → name`, `Token-Groups – Unqualified Names → group`.
4. `.env`:
   ```
   OIDC_ISSUER=https://adfs.firma.cz/adfs
   OIDC_CLIENT_ID=<client id>
   OIDC_CLIENT_SECRET=<secret>
   OIDC_LABEL=Firemní účet (AD)
   OIDC_SCOPES=openid profile email allatclaims
   ```
5. U rolí v CONTIXu zadejte **názvy AD skupin** (např. `GG-CONTIX-Auditori`).

## Tabulky

`users`, `roles`, `user_roles` (source: manual | idp), `groups`, `group_members`, `group_roles`, `sessions`,
`mfa_recovery_codes`, `auth_flows` (OIDC state/nonce/PKCE), `audit_log`, `app_settings`.

## Další kroky

- WebAuthn / passkeys jako druhý faktor (phishing-resistant).
- SCIM provisioning z Entra ID (automatické zakládání/rušení účtů).
- Omezení IP rozsahů pro administraci, notifikace bezpečnostních událostí.
- Export auditního logu do SIEM (Wazuh) – syslog / webhook.
