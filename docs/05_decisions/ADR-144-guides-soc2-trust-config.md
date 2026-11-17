# ADR-144: Průvodci SOC 2 a Trust Center, osnova politiky, přenos nastavení průvodců (v1.47)

## Kontext

Moduly Zprávy SOC 2 a Dotazníky zákazníků / Trust Center neměly panel „Jak postupovat“. Koncept politiky ze
startovacího balíčku (ADR-143) byl prázdný záznam bez textu. Pilotní nasazení u více zákazníků vyžadovalo ruční
nastavování garantů průvodců a profilu hrozeb v každé instalaci.

## Rozhodnutí

1. Průvodci `soc2` (zakázka → popis systému → opatření ke kritériím → testy za 12 měsíců → výjimky → zpráva) a
   `trust` (knihovna odpovědí → termíny dotazníků → rozpracované → Trust Center → žádosti o přístup / NDA) jen jako
   data `GUIDES` a fakta v jednom dotazu `guideFacts`; fáze ověření v doporučeném pořadí zavádění.
2. Startovací koncept politiky dostane přes existující `POST /policies/:id/versions` verzi 0.1 s osnovou kapitol
   (Markdown, i18n `gd.starter.policyContent`) s názvem hlavního předpisu společnosti (`profileOf().defaultFramework`).
   Text je osnova k doplnění, ne hotová politika; schvaluje ji člověk běžným workflow.
3. `GET /guides/config/export` → JSON `GuideConfig` (`format: "contix-guides"`, `version: 1`): garanti podle **názvu**
   funkčního místa a útvaru (ne podle id – ta se mezi instalacemi liší) a profil hrozeb (odvětví, ruční rozhodnutí).
   `POST /guides/config/import`: místo se hledá podle názvu a útvaru (bez ohledu na velikost písmen), jinak podle
   jediného místa toho názvu; jen u průvodců, k nimž má uživatel zápis; profil hrozeb jen s `risks:write`.
   Nic se nemaže; výsledek po položkách (`applied` / `unmatched` / `unknown_guide`); audit `guide.config_exported`
   a `guide.config_imported`.
4. Úvodní prohlídka manažera má krok Cesta k souladu. Školicí video se negeneruje (není z čeho ho udržovat
   v souladu s verzí); nápověda a prohlídka jsou zdrojem pravdy.
5. Stabilizace: `bun audit fix` (seroval, zod, nodemailer v rámci rozsahů); zbývá jen esbuild ve vývojových
   nástrojích (drizzle-kit, tsx), mimo produkční běh.

## Důsledky

Bez migrace. Formát exportu je verzovaný; budoucí verze musí import starší verze buď podporovat, nebo odmítnout 400.
