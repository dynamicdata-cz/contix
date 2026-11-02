# ADR-029: Identity a přístupy – kontrola účtů v AD a Entra ID

**Stav:** přijato · 5. 10. 2026

## Kontext

Zákazníci mají on-premise Active Directory i Microsoft Entra ID (hybrid). Řízení přístupu a jeho pravidelný přezkum
vyžaduje vyhláška i auditoři; dnes se dělá ručně v Excelu. CONTIX už eviduje funkční místa, opatření, testy a důkazy –
chybí mu pohled na skutečné účty.

## Rozhodnutí

1. **Jen čtení.** Konektory adresář nikdy nemění (žádné zakázání účtu, odebrání ze skupiny). Nález je úkol pro správce
   adresáře; vyřeší se sám, když ho další synchronizace už nevidí. AD: běžný doménový účet bez správcovských práv přes
   **LDAPS** (`ldapts`); Entra ID: registrace aplikace s oprávněními typu Application `User.Read.All`,
   `RoleManagement.Read.Directory`, volitelně `AuditLog.Read.All` (P1 – poslední přihlášení, registrace MFA).
2. **Zdroj = adresář ve společnosti** (`identity_sources.company_id`). Hybridní organizace připojí AD i Entra ID zvlášť;
   účty se mezi zdroji nepárují (stejná osoba může mít nálezy v obou). Tajemství šifrovaně (AES-256-GCM z `APP_SECRET`),
   do UI ani auditu se nevrací. Zdroje se nepřesouvají přes `transferRecords` – změnou společnosti zdroje se přenesou
   i jeho účty, nálezy a snímky.
3. **Normalizace + čistá pravidla.** Konektor vrací `DirAccount` (sdílený typ); nálezy počítají `evaluateAccount` /
   `evaluateGroups` ve `shared/identity.ts` (stejné v API, testech i dokumentaci). Závažnost se zvyšuje u privilegovaných účtů.
4. **Privilegované skupiny podle SID**, ne podle názvu (lokalizované servery): RID 512, 518, 519, 520, 526, 527 domény
   a vestavěné S-1-5-32-544/548/549/550/551, plus DnsAdmins a vlastní seznam. Vnořené členství a primární skupina se
   rozvinou v paměti z jednoho stránkovaného dotazu na skupiny (bez dotazů na člena). Entra: aktivní přiřazení
   privilegovaných rolí (ID šablon rolí); oprávněná přiřazení PIM zatím ne.
5. **Životní cyklus nálezu** podle klíče (zdroj, pravidlo, předmět): nový → otevřený; zmizí → vyřešený; vrátí se → znovu
   otevřený; výjimka s odůvodněním a termínem (max. 2 roky, audit) – po termínu se při synchronizaci znovu otevře.
   Účet, který z adresáře zmizí, dostane `removed_at` (historie zůstává). **Prázdná odpověď adresáře nic nemění**
   (ochrana proti chybné Base DN).
6. **Chybějící licence není chyba.** Bez `signInActivity` / registrací MFA se příslušná pravidla nevyhodnotí a zdroj
   dostane poznámku – raději méně nálezů než falešné „neaktivní“ účty.
7. **Osobní údaje.** Ukládá se jen nezbytné (přihlašovací jméno, jméno, e-mail, útvar, funkce, časy přihlášení a změny
   hesla, skupiny). Přístup jen s `identity:read` (CISO, manažer KB, auditor). AI nástroj `identity_findings` vrací jen
   počty podle pravidla – žádná jména účtů.
8. **Provoz.** Synchronizace v plánovači (interval u zdroje, pod `acquireLease`), kontrola `identity` v Provozu,
   dlaždice na přehledu, krok průvodce nastavením, snímky po synchronizaci pro trend a doklad.

## Důsledky

- Další kroky stojí na stejných datech: toxické kombinace (SoD) nad `identity_accounts.groups` a funkčními místy,
  kampaně přezkumu přístupů (recertifikace), průběžné testy opatření z výsledků kontrol, synchronizace uživatelů a útvarů.
- Server CONTIXu potřebuje síťový přístup na řadiče domény (636) a na `login.microsoftonline.com` / `graph.microsoft.com`
  (národní cloudy: `ENTRA_LOGIN_URL`, `GRAPH_URL`).
