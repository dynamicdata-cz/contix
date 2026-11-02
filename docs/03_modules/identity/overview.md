# Modul Identity a přístupy (v0.28)

## Účel

Pravidelná kontrola účtů v **Active Directory** a **Microsoft Entra ID**: neaktivní a privilegované účty, rizikové nastavení
účtů a chybějící MFA. Výsledkem jsou nálezy s vysvětlením a doporučením, výjimky s termínem a export pro auditora.
CONTIX v adresáři **nic nemění** (ADR-029).

## Připojení

| Zdroj | Přístup | Co je potřeba |
|---|---|---|
| Active Directory | LDAPS (`ldaps://dc:636`) | běžný doménový účet jen pro čtení, Base DN, případně kořenový certifikát interní CA |
| Entra ID | Microsoft Graph | registrace aplikace + tajný klíč; Application: `User.Read.All`, `RoleManagement.Read.Directory`, volitelně `AuditLog.Read.All` (Entra ID P1) |

Nastavení: **Identity a přístupy → Zdroje** (oprávnění `admin:settings`). Interval synchronizace u zdroje (výchozí 24 h, 0 = ručně).

## Pravidla

| Pravidlo | Zdroj | Závažnost (privilegovaný účet) |
|---|---|---|
| Neaktivní účet (bez přihlášení > N dní; hosté vlastní limit) | AD, Entra* | střední (kritická) |
| Nikdy se nepřihlásil (založen před > N dny) | AD, Entra* | nízká (vysoká) |
| Účet odešlého uživatele (v CONTIXu deaktivovaný, v adresáři povolený) | AD, Entra | vysoká (kritická) |
| Heslo bez expirace | AD, Entra (jen cloudové účty) | nízká / servisní střední (vysoká) |
| Nevyžaduje heslo (PASSWD_NOTREQD) | AD | vysoká (kritická) |
| Bez předautentizace Kerberos (AS-REP roasting) | AD | vysoká (kritická) |
| Uživatelský účet se SPN (Kerberoasting) | AD | střední (kritická) |
| Neomezená delegace | AD | vysoká |
| Staré heslo privilegovaného účtu | AD, Entra | vysoká |
| Bez MFA | Entra* | střední (kritická) |
| Příliš mnoho členů privilegované skupiny / role | AD, Entra | střední / vysoká |

\* vyžaduje `AuditLog.Read.All` a licenci P1; bez ní se pravidlo nevyhodnotí a zdroj má poznámku.

Zakázané účty se nehodnotí. Privilegované skupiny AD se určují podle SID (nezávisle na jazyku), včetně vnořených skupin a primární skupiny.

## Toxické kombinace (SoD) – v0.29

Pravidlo má stranu A a B (skupiny AD / role Entra ID podle názvu, funkční místa CONTIXu). Porušení = osoba splňuje obě
strany; osobou je uživatel CONTIXu (jeho účty ze všech adresářů + funkční místa), jinak samostatný účet. Vyhodnocení po
synchronizaci, po změně pravidla a plánovačem; výjimky jako u nálezů (ADR-030).

## Přezkum přístupů (recertifikace) – v0.29

Kampaň: rozsah (zdroje, jen privilegované, skupiny), recenzent (funkční místo / vedoucí útvaru držitele účtu), termín.
Položky se zmrazí; recenzenti mají úkol v Moje povinnosti a rozhodují Ponechat / Odebrat (s popisem). Odebrání se ověří
podle aktuálního stavu adresáře, případně ručně. Uzavřený přezkum + protokol (tisk / Word) = doklad pro audit.

## Data

`identity_sources` (zdroj, šifrované tajemství, pravidla, stav) · `identity_accounts` (normalizovaný účet, skupiny včetně vnořených,
příznaky, vazba na uživatele CONTIXu podle e-mailu, `removed_at`) · `identity_findings` (zdroj + pravidlo + předmět, stav, výjimka) ·
`identity_snapshots` (souhrn po synchronizaci – trend a doklad) · `sod_rules`, `sod_violations` · `access_reviews`,
`access_review_items` (snímek účtu, recenzent = funkční místo, rozhodnutí).

## API

`GET /api/identity/overview|findings|findings.csv|accounts|accounts/:id|sources` (identity:read) ·
`POST /findings/:id/accept|reopen`, `POST /sources/:id/sync` (identity:write) ·
`POST|PUT|DELETE /sources`, `POST /sources/test` (admin:settings) ·
`/sod/rules|violations|evaluate` · `/reviews` (seznam a detail i pro recenzenty s `obligations:self`), `/reviews/:id/items/:itemId/decide|remediated|reassign`,
`/reviews/:id/close|cancel|report.html|report.docx`.
