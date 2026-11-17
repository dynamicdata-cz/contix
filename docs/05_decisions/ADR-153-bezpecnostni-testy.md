# ADR-153: Bezpečnostní testy se sondou na Kali Linuxu (v1.56)

## Kontext

DynamicData dělá penetrační testy a chce v CONTIXu základní sadu opakovatelných testů (porty, TLS, SSH, web,
Windows / AD), která se bude rozšiřovat, s nálezy, historií a AI rozborem. Nástroje běží na Kali Linuxu, ne na
serveru CONTIXu. Testování cizích systémů vyžaduje prokazatelné oprávnění.

## Rozhodnutí

1. **Modul `sectests`**, oprávnění `sectests:read`, `sectests:run`, `sectests:approve` (oddělené schvalování rozsahu).
2. **Rozsah** (`sec_test_scopes`): cíle (IP, CIDR od /16, název, *.doména, URL), výjimky, platnost, podklad
   (objednávka / souhlas), povolené kategorie. Schválení zaznamená kdo a kdy; každá úprava ho zruší. Běh i import
   projde `scopeProblem` (schválen, platný dnes, kategorie, každý cíl v rozsahu a mimo výjimky) – při zařazení
   i znovu při převzetí sondou.
3. **Sonda** = připojení `probe` (ADR-146) s tokenem `ctxp_` (otisk pro ověření, šifrovaná kopie pro instalátor).
   `contix-probe.py` (Python 3 stdlib) se ptá `POST /api/public/probe/poll`, dostane **jen ID testu, cíle a porty**,
   příkaz sestaví z **vlastního** katalogu (bez shellu, cíle ověřené regulárním výrazem, bez voleb začínajících `-`)
   a výstup pošle `POST /api/public/probe/result`. Kompromitace CONTIXu tak nedá libovolné spuštění příkazu na Kali.
   Instalátor: uživatel `contix-probe`, služba systemd se `NoNewPrivileges`, `ProtectSystem=strict`; nmap jen `-sT`
   (bez raw socketů). Úloha převzatá a nevrácená do 3 h selže.
4. **Parsery** v API (`parseSecTest`, čisté funkce) pro výstup ze sondy i ruční import: nmap XML (rizikové porty,
   SMB skripty), testssl JSON, ssh-audit JSON, kontrola hlaviček (JSON sondy), nikto JSON, netexec text.
   Surové výstupy se ukládají zkrácené (512 kB na běh) jako důkaz.
5. **Nálezy** (`sec_test_findings`): klíč test + pravidlo + hostitel + port; opakovaný běh aktualizuje, chybějící nálezy
   otestovaných hostitelů označí jako opravené, opravený nález se při znovuobjevení otevře. Párování na aktiva
   stejně jako import skenů (`hostMatcher`).
6. **AI** (lokální model, `ai:use`): rozbor nálezu (shrnutí, dopad, náprava, ověření, navazující testy z katalogu,
   ID opatření organizace ověřená proti katalogu) a shrnutí běhu (vedení / technici / priority). Do modelu nejde
   název ani IP serveru (v rozboru `<server>`, ve shrnutí H1, H2…).

## Důsledky

- Nový test = položka `SECURITY_TESTS` + funkce v `contix-probe.py` + větev parseru + test; sondy se aktualizují
  instalátorem.
- Agresivní testy (hádání hesel, exploity) katalog záměrně neobsahuje.
- Migrace 0112 (tři tabulky); modul se při aktualizaci zapne a oprávnění se doplní systémovým rolím.

## Doplněk v1.56.1 – sady, navazující testy, automatická AI

7. **Sada** (`sec_test_batches`, migrace 0113): víc testů na stejné cíle, každý test vlastní běh (`batch_id`). Cíle se
   převedou podle typu testu (`targetFor`: hostitel → https://hostitel pro web, URL → hostitel pro test serveru);
   celá sada projde `scopeProblem`, jinak se nezaloží nic. Porty zadané u sady platí jen pro verze služeb.
8. **Navazující testy** (`autoFollow`): po dokončení průzkumu portů v sadě `followUpsFromFacts` (deterministicky
   podle portu / služby) zařadí další testy na stejnou sondu, jen v rozsahu a bez duplicit v sadě; jen jedna úroveň
   (`parent_run_id`), navazující testy dál nenavazují.
9. **Automatická AI** (`autoAi`): po výsledku sondy na pozadí rozbor až 10 závažných nálezů bez rozboru, shrnutí běhu
   a po posledním běhu sady shrnutí sady (jazyk organizace cs). Chyba AI jde do auditu (`sectest.auto_ai_failed`),
   výsledek testu neovlivní. **Spustit navržené testy** z rozboru nálezu (cíl a port nálezu) nebo ze shrnutí sady
   (původní cíle sady) vytvoří novou sadu – testy z AI jsou jen ID z katalogu.
10. **Ruční přiřazení k aktivu**: `PATCH /findings/:id/asset` (stejná společnost), volitelně všechny nálezy cíle;
    s oprávněním `assets:write` se IP / FQDN doplní k aktivu, aby další běhy párovaly samy. Upsert nálezu ruční
    přiřazení neprázdní.
