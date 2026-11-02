# ADR-078: Přihlášení účty Active Directory (LDAPS) a SSO z administrace

**Stav:** přijato (v0.82)

## Kontext
Zákazníci s on-prem AD nemají AD FS a SSO šlo nastavit jen v `server.env` (správce serveru). Uživatelé založení synchronizací z adresáře (ADR-031) neměli heslo a bez SSO se nepřihlásili.

## Rozhodnutí
- **Přihlášení účty AD** využívá připojení AD z Identit (`identity_sources`, nový sloupec `login` – `AdLoginConfig`). Administrace → Přihlášení umí připojení založit (bez synchronizace účtů, `syncHours = 0`) a nastavit, kdo se smí přihlásit (skupiny), zakládání uživatelů a výchozí roli.
- Ověření `authenticateAd`: bind účtem pro čtení → hledání uživatele (sAMAccountName / UPN / mail, hodnota přes `ldapEscape`, max. 2 výsledky) → bind pod DN uživatele zadaným heslem → vnořené skupiny přes `LDAP_MATCHING_RULE_IN_CHAIN`. Prázdné heslo se odmítá vždy (neautentizovaný bind). Heslo CONTIX neukládá.
- `POST /auth/login` zkusí AD jen u uživatele bez hesla CONTIXu nebo u jména, které není e-mail uživatele. Lokální účet s heslem se s účtem AD **nikdy nepropojí** (ochrana proti převzetí změnou atributu mail v AD); správce může účet převést (`authProvider`, heslo se odebere).
- Identita `users.external_id = ad:<objectGUID>`, `auth_provider = 'ad'`. Role ze skupin (`roles.external_groups`, CN i DN) se obnovují při každém přihlášení jako `source = idp` – stejně jako u OIDC (`syncIdpRoles`). MFA CONTIXu platí jako u lokálních účtů.
- Zkouška přihlášení (`/admin/login/ad/:id/test`) jen rozhoduje (`decideAdLogin`), nic nezakládá; je v auditu bez hesla.
- **SSO z administrace**: tabulka `sso_providers` (Entra ID / Google / obecný OIDC), tajemství jen `secretEnc`; poskytovatelé = `server.env` + DB (`providersFor`), ID v adrese `sso-<uuid>`.

## Důsledky
LDAPS musí být na řadiči dostupné a důvěryhodné (CA v konfiguraci). Neúspěchy se počítají do omezení podle IP a zámku účtu CONTIXu; uzamčení řeší primárně AD.
