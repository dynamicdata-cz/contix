# Pilotní nasazení u zákazníka – kontrolní seznam

Postup od instalace po předání pilotní instalace. Každý krok odkazuje na místo v aplikaci nebo na dokument.
Doporučená délka pilotu: 6–8 týdnů, jedna společnost (případně skupina), 3–10 uživatelů.

## 1. Před instalací

- [ ] Server podle [install.md](install.md) (Docker, 4 vCPU, 8 GB RAM, 50 GB disk), DNS záznam, způsob TLS (`CONTIX_TLS_MODE`).
- [ ] Kontakt pro hlášení zranitelností provozovatele: `SECURITY_CONTACT` v `.env` (zobrazí se v `/.well-known/security.txt`).
- [ ] Klíč pro šifrování záloh (`age-keygen`) – veřejná část do `.env`, privátní mimo server ([backup.md](backup.md)).
- [ ] Přihlašování: lokální účty s MFA, nebo OIDC (AD FS / Entra ID).

## 2. Instalace a ověření

- [ ] `sudo ./infra/scripts/install.sh`, potom `sudo ./infra/scripts/verify.sh` bez chyb.
- [ ] První záloha a **test obnovy**: `restore.sh --test` (výsledek se zapíše, Administrace → Provoz → Test obnovy).
- [ ] Administrace → Provoz: všechny kontroly zelené nebo vědomě vypnuté.
- [ ] Administrace → Provoz → **Stáhnout SBOM** – přiložit k dodavatelské dokumentaci, pokud ji zákazník požaduje.

## 3. Nastavení společnosti

- [ ] Administrace → **Průvodce nastavením**: regulatorní profil (vyšší / nižší povinnosti, NIS2, DORA), moduly, společnosti skupiny.
- [ ] Import → **Útvary a funkční místa** (šablona ke stažení): útvary, funkční místa, vedoucí místa a držitelé podle e-mailu.
  Uživatelé musí existovat dřív (OIDC je založí při prvním přihlášení, lokální účty Administrace → Uživatelé).
- [ ] Import v tomto pořadí: aktiva → procesy → dodavatelé → rizika → opatření (rizika a opatření odkazují na funkční místa).
- [ ] Cesta k souladu → Další → **Startovací balíček**: složky dokumentace, katalog opatření, koncept politiky s osnovou, cíle ISMS.
- [ ] Cesta k souladu → Další → **Importovat nastavení průvodců** – soubor z referenční instalace (garanti, profil hrozeb).
  Garanti se přiřadí jen tam, kde existuje funkční místo stejného názvu – proto až po importu organizace.

## 4. Průběh pilotu

- [ ] Úvodní školení (60–90 min): úvodní prohlídka manažera, Cesta k souladu, panel Jak postupovat, Moje práce.
- [ ] Týdně: Cesta k souladu – další kroky; garanti dostávají kroky do Moje práce a souhrnného e-mailu.
- [ ] V polovině pilotu: **Příprava na audit** pro hlavní předpis, seznam mezer s vlastníky.
- [ ] Zpětná vazba uživatelů (co chybí, co je navíc) – zapsat jako úkoly.

## 5. Předání

- [ ] Administrace → Průvodce nastavením → **Předávací protokol** (Word) – stav nastavení, uživatelé, moduly.
- [ ] Příprava na audit → **Balíček pro auditora** (ZIP) jako ukázka výstupu.
- [ ] Přehled skupiny → **Stáhnout do Excelu** (u skupiny) a Zpráva pro vedení (Word) za období pilotu.
- [ ] Domluvit provoz: kdo spouští `update.sh`, interval testu obnovy (nejméně čtvrtletně), kontakt na podporu.
- [ ] Rozhodnutí o pokračování; při ukončení předat poslední zálohu databáze (a dokumenty) a smazat instalaci podle smlouvy.
