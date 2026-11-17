# ADR-152: Detail serveru ze sběrače a historie změn (v1.55)

## Kontext

Inventář serveru (ADR-148) byl jen jedna karta u aktiva. Správce potřebuje rozkliknout nález (proč vadí, jak opravit),
účet s jeho klíči, kontejnery, porty a služby – a vidět, co se od minula změnilo (nový účet, klíč, port).

## Rozhodnutí

1. Stránka `/discovery/hosts/:id` (`GET /api/hosts/:id`, `assets:read`, rozsah společnosti inventáře).
2. Nálezy se počítají při čtení (`evaluateHost` nad `normalizeInventory`) – nová pravidla platí i pro starší data;
   vysvětlení a náprava v `HOST_FINDING_GUIDE` (cs, en přes popisky).
3. Sběrač 1.1 posílá navíc `sshd` (`sshd -T`) a `system` (aktualizace apt / dnf, bezpečnostní, automatické
   aktualizace, restart, doba běhu) a poslední přihlášení (`lastlog`). Pole jsou volitelná – sběrač 1.0 dál funguje.
   Nová pravidla: `sshd_root_login`, `sshd_password_auth`, `sshd_empty_passwords`, `updates_security`, `updates_pending`,
   `reboot_required`, `no_auto_updates`, `service_failed`.
4. Historie: `host_inventory_changes` (migrace 0111) – při novějším hlášení `diffHostInventory(minulý, nový)`; uloží se
   jen neprázdný rozdíl, nejvýš 200 záznamů na server. Porty se porovnávají podle protokolu a čísla (IPv4 / IPv6
   stejného portu nejsou dvě změny), služby jen přidané / odebrané (stav běhu se mění často).

## Důsledky

- Historie začíná až od 1.55; přeinstalace sběrače instalátorem doplní SSH a aktualizace.
- Výpis balíčků je omezen na 50 (bezpečnostní první) – inventář zůstává malý.
