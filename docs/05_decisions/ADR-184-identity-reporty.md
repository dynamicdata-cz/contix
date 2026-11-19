# ADR-184: Identity a přístupy – počty u filtru, exporty, reporty a měsíční rozesílání

Stav: **přijato** (v1.89.0) – navazuje na [ADR-029](ADR-029-identity-access-review.md), [ADR-141](ADR-141-guide-owners-trend.md)
a [ADR-183](ADR-183-vazby-a-slepa-mista.md).

## Kontext

Nálezy identit se dosud filtrovaly bez počtů, export CSV bral jen stav a zdroj a výstup pro vedoucí útvarů nebo vedení
se skládal ručně z exportu. Přezkum neaktivních účtů v praxi probíhá tak, že vedoucí útvaru dostane seznam svých
účtů a u každého rozhodne; vedení chce jednou měsíčně stručný stav.

## Rozhodnutí

1. **Jeden filtr pro všechno** (`identity/query.ts`, `findingWhere`): seznam, počty u voleb, export CSV / XLSX
   i reporty používají stejné podmínky. Počty u voleb filtru se počítají „bez sebe sama“ (počty pravidel s filtrem
   závažnosti a naopak), aby šlo vidět, co výběr přinese.
2. **Reporty jsou HTML** vykreslené jednou funkcí a převedené do Wordu (`htmlToDocx`) nebo do PDF tiskem stránky;
   je-li nastavená převodní služba, i přímo do PDF (Word → PDF). Žádná nová knihovna.
   - *Neaktivní a nikdy nepřihlášené účty*: pravidla `stale` a `never_logged_in`, seskupení podle útvaru (atribut
     `department`, jinak OU z DN) nebo podle OU; útvary s privilegovanými účty a privilegované účty nahoře; sloupec
     rozhodnutí (ponechat / zakázat / odstranit) a podpis – podklad pro přezkum, ne náhrada recertifikace.
   - *Privilegované účty*: účty ve stavu privilegovaný (bez odstraněných), skupiny, stáří hesla, SPN, neomezená
     delegace, MFA a otevřené nálezy.
   - *Souhrn pro vedení*: stav, otevřené nálezy podle pravidel, vývoj za 6 měsíců ze snímků zdrojů (konec měsíce),
     10 největších rizik (kritické a vysoké, privilegované účty první), otevřená porušení SoD.
3. **Měsíční rozesílání** (`identity_report_schedules`, jeden plán na společnost): příjemci jsou držitelé
   funkčního místa **garanta průvodce „identity“** (`guide_owners`) – jedno místo pro „kdo za modul odpovídá“.
   Plánovač upozornění pošle reporty jednou za kalendářní měsíc od nastaveného dne (hlídá `last_sent_at`); bez
   garanta se nic nepošle a stav to řekne. Příloha Word, PDF jen s převodní službou.
4. **Hromadné akce**: hromadná výjimka (stejná pravidla jako jednotlivá – odůvodnění, nejdéle 2 roky, jen otevřené
   nálezy v rozsahu uživatele) a úkoly přes společný endpoint úkolů z nálezů (ADR-183).

## Důsledky

- Migrace `0129_identity_report_schedules`.
- E-mail upozornění umí přílohy (`Mailer.attachments`).
- Report obsahuje osobní údaje (jména, útvary) – stažení a odeslání se zapisuje do auditního záznamu.
