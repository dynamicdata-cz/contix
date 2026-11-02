# ADR-071: Portál externího auditora – požadavky na podklady (PBC)

- Stav: přijato (v0.76)

## Kontext
Externí audity (SOC 2, ISO 27001, kontrola NÚKIB) probíhají přes seznam požadavků na podklady (PBC). Organizace ho dosud vedla v Excelu a e-mailech; podklady se posílaly mimo evidenci a bez stopy. Balíček pro auditora (ADR-019) pokrývá jen hromadný export.

## Rozhodnutí
- Požadavky `audit_requests` k auditu (pořadí `PBC-001…`, odkaz na kritérium, vlastník = funkční místo, termín, stav open → submitted → accepted / returned, zrušení), soubory `audit_request_files` (SHA-256, typ podle přípony, stažení vždy jako příloha), komentáře `audit_request_comments` (příznak externí).
- Externí auditor je **běžný účet CONTIXu** (přihlášení, MFA dle nastavení) s rolí **Externí auditor** = jediné oprávnění `audits:external`; vidí jen audity, ke kterým ho správce auditu přidělí (`audit_auditors`). Odkazy s tokenem se nepoužívají – podklady bývají citlivé a potřebujeme identitu a audit stopu.
- Auditor vidí jen **odeslané** soubory (`shared` se nastaví při odeslání) a nevidí jména vlastníků ani nahrávajících; převzít / vrátit smí jen přidělený auditor. Odeslaný soubor nelze smazat. Převzatý požadavek je neměnný.
- Podklady nahrává a odesílá držitel funkčního místa vlastníka (s `audits:read`) nebo správce auditu (`audits:write`).
- Povinnost `audit_request` (otevřené a vrácené s termínem) vlastníkovi; každý krok včetně stažení do auditního logu; ZIP odeslaných podkladů s manifestem.
- UI: karta na detailu auditu; pro uživatele jen s `audits:external` položka **Portál auditora**, přesměrování z přehledu a bez úvodní prohlídky.

## Důsledky
- Účty externích auditorů zakládá správce; po skončení auditu je stačí deaktivovat nebo odebrat z auditu.
- Systémová role se doplní při aktualizaci (`PERMISSION_UPGRADES` 0.76).
