# ADR-188: Podněty z pilotního provozu – kontrola organizace, ohlášení, rozhodnutí o registraci, test obnovy

Stav: **přijato** (v1.94.0) – navazuje na [ADR-157](ADR-157-testy-zprava-overeni-ohlaseni.md) a [ADR-145](ADR-145-ops-cra-pilot.md).

## Kontext

Podněty uživatelů z prvních nasazení:

1. Průvodce nastavením hlásil u kroku *Organizace* chybějící údaje, i když byly vyplněné – četl globální nastavení,
   kam se identita organizace od zavedení profilů společností už nezapisuje.
2. Ohlášení regulované služby podané před rokem šlo zaznamenat jen s „nějakým“ datem; doplněním údajů pak vznikla
   změna k ohlášení, kterou nešlo opravit ani zrušit.
3. Rozhodnutí NÚKIB o registraci (od jeho doručení běží 1 rok na zavedení bezpečnostních opatření) nešlo v CONTIXu
   evidovat.
4. Test obnovy vyžadoval název souboru zálohy a hlášení neříkalo, kde a jak ho spustit.
5. Návod instalace Dockeru používal repozitář pro Ubuntu i na Debianu (Debian 13 nefunkční).

## Rozhodnutí

1. Krok *Organizace* čte profil **aktivní společnosti** (kořenová → odkaz na Nastavení, ostatní → Společnosti);
   regulované služby vyžaduje jen v režimu zákona a uzná je i ze zapsaného posouzení.
2. Záznam o ohlášení lze **opravit** (datum, číslo; volitelně „ohlášení obsahovalo aktuální údaje“ = nový základ
   pro změny, bez ohlášení změny) a **zrušit**. Na Portálu NÚKIB se nic nemění – CONTIX nic neodesílá.
3. **Rozhodnutí o registraci**: datum doručení, číslo jednací a PDF (jen PDF, max. 25 MB, uložené u záznamu
   ohlášení). Termín zavedení bezpečnostních opatření = doručení + 12 měsíců; do uplynutí je povinností
   odpovědného funkčního místa v Moje práce.
4. `restore.sh --test` bez souboru testuje **nejnovější zálohu**; hlášení v Provozu a dokumentace uvádějí celý
   příkaz ze složky instalace.
5. Návod instalace bere repozitář Dockeru podle distribuce (`$ID` z `/etc/os-release`).

## Důsledky

- Migrace `0131_registration_decision` (sloupce rozhodnutí v `regulation_registrations`).
