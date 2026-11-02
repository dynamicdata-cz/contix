# ADR-026: Úpravy v desktopovém Office přes WebDAV

**Stav:** přijato · 4. 10. 2026

**Kontext:** Zákazníci používají desktopový Word / Excel (Microsoft 365 Apps). Úpravy přímo ve Word Online z vlastní
aplikace Microsoft umožňuje jen partnerům programu CSPP (WOPI host) – pro instalaci u zákazníka nepoužitelné.
Úpravy v prohlížeči (OnlyOffice / Collabora) by znamenaly další těžkou službu a jiné prostředí, než na které jsou
uživatelé zvyklí.

**Rozhodnutí:**

1. **Office URI + WebDAV** – prohlížeč otevře `ms-word:ofe|u|https://<CONTIX>/dav/<token>/<soubor>`; Office soubor načte
   a ukládá standardním WebDAV (OPTIONS, PROPFIND, LOCK/UNLOCK, GET, PUT). Stejný mechanismus používají běžné DMS.
2. **Autentizace tokenem v cestě** – Office neposílá cookies prohlížeče ani neumí SSO přihlášení CONTIXu; token je
   náhodných 256 bitů, vázaný na uživatele, soubor a verzi, ukládá se jen SHA-256, platí 10 h od poslední aktivity
   (max. 24 h) a ruší se při check-inu, zrušení rezervace, předložení i schválení. Neplatný token = 404 (Office se
   nepokouší o přihlášení jménem a heslem). Cesta `/dav/` se nezapisuje do logů API ani Caddy.
3. **Úprava = rezervace verze** – otevření pro úpravu automaticky provede check-out (ADR-024); zápis z Office je možný
   jen, dokud je návrh rezervovaný stejným uživatelem. WebDAV zámek (LOCK) je jen pro Office – zdrojem pravdy je
   rezervace v CONTIXu.
4. **Revize** – první uložení v relaci vytvoří novou revizi (předchozí zůstává v historii), další uložení ji přepisují:
   desktopový Office ukládá často a historie by jinak obsahovala desítky téměř shodných revizí. Uložení beze změny
   obsahu (stejný SHA-256) se ignoruje.
5. **Jen čtení** (`ofv`) pro schválené verze – bez zámku a bez zápisu.
6. WebDAV **nemaže ani nepřesouvá** soubory (DELETE / MOVE / COPY / MKCOL = 403); PROPPATCH se potvrdí bez uložení.

**Důsledky:** klienti musí důvěřovat certifikátu CONTIXu v systémovém úložišti a adresa by měla být v zóně Místní
intranet (jinak chráněné zobrazení). Úpravy v prohlížeči zůstávají jako volitelné rozšíření (OnlyOffice / WOPI).
