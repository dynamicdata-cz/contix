# Bezpečnostní politika a dokumentace (§ 6 vyhl. 409, § 3 odst. 3 vyhl. 410)

Registr dokumentů (politika, směrnice, postupy, standardy, plány, pokyny, záznamy) s verzemi a schvalováním.

| Požadavek | Jak ho CONTIX pokrývá |
| --- | --- |
| odst. 1 – dokumentace k opatřením § 3–27 | dokument nese oddíly vyhlášky a vazby na opatření; záložka „Pokrytí oddílů“ ukazuje oddíly bez dokumentu |
| odst. 3 – pravidelný přezkum | interval přezkumu, „Přezkoumáno beze změny“, termín dalšího přezkumu, upozornění |
| odst. 4 – odpovědná osoba | funkční místo odpovědné za přezkum a aktualizaci |
| odst. 5 písm. a, c – dostupnost | text verze (Markdown) nebo umístění (DMS, SharePoint, listinná podoba) |
| odst. 5 písm. b – informování dotčených osob | okruh dotčených osob (útvary vč. podřízených, funkční místa, bezpečnostní role, vedení, všichni) a prokazatelné seznámení s každou schválenou verzí |
| odst. 5 písm. d – ochrana CIA | klasifikace dokumentu, oprávnění `policies:read/write` |

Verze: jeden rozpracovaný návrh; schválení (`documents:approve`) nahradí předchozí platnou verzi (ta se uchová jako
„nahrazená“). Dokument se schválenou verzí nelze smazat – ruší se stavem „Zrušený“.

Uživatel vidí dokumenty k seznámení v části **Moje povinnosti** (oprávnění `obligations:self`) a potvrzuje seznámení.

## DMS – schvalovací oběh a portál (v0.22)

**Role dokumentu** jsou funkční místa (odpovědnost zůstává při změně obsazení):

| Role | Co dělá |
| --- | --- |
| Gestor | připravuje verzi (text v Markdownu a/nebo soubory Word/PDF), předkládá ji, vyřizuje připomínky; nemusí mít `policies:write` |
| Vlastník procesu | věcná kontrola předložené verze („Věcně v pořádku“ / „Vrátit“); není-li určen, krok se přeskočí |
| Schvalovatel | schválí verzi, nebo ji vrátí; není-li určen, schvaluje kdokoli s `documents:approve` |

Stavy verze: **Návrh → Kontrola → Schvalování → Platná → Nahrazená**. Vrácení vyžaduje odůvodnění a vrací verzi
gestorovi do návrhu. Každý krok se zapisuje do historie verze a auditního logu. Uživatel s `documents:approve`
může verzi schválit i mimo oběh („Schválit přímo“ – v historii označeno). Úkoly oběhu se zobrazí v **Moje povinnosti**
(„Kontrola / schválení dokumentu“) a v upozorněních.

**Portál Dokumenty** (`/docs`) je pro všechny uživatele s `obligations:self` – typicky nová systémová role
**Zaměstnanec**. Zobrazuje jen platné verze dokumentů ve stavu „Platný“: veřejné a interní všem, důvěrné jen dotčeným
osobám. Uživatel může dokument číst a stáhnout, potvrdit seznámení, poslat připomínku (gestor ji přijme / nepřijme
s vyjádřením) a absolvovat test porozumění.

**Povědomí a školení (§ 10):**

- Test porozumění: otázky s jednou či více správnými odpověďmi, hranice úspěšnosti (výchozí 80 %); bez úspěšného
  testu nelze potvrdit seznámení. Pokusy se ukládají jako doklad.
- Kurz formy „Seznámení s dokumentem“ navázaný na dokument se splní potvrzením seznámení (se skóre testu).
- „Nová verze vyžaduje opakování školení“ – absolvování navázaných kurzů před schválením nové verze přestane platit,
  lhůta = lhůta na seznámení (výchozí 14 dní od schválení).

## DMS II – struktura a řízení (v0.23)

**Složky a číslování.** Dokumentace se třídí do stromu složek (Správa dokumentace → panel Složky). Složka může mít
prefix označení (např. `SM-ISMS`); nový dokument bez vyplněného označení dostane další číslo v řadě – prefix nejbližší
nadřazené složky s prefixem, jinak podle druhu (`PO` politika, `SM` směrnice, `PP` postup, `ST` standard, `PL` plán,
`PK` pokyn, `ZA` záznam). Smazat lze jen prázdnou složku. Zaměstnanci v portálu Dokumenty filtrují podle složek.

**Šablony.** Na záložce Šablony správce nahraje šablonu Wordu (.docx / .dotx) s hlavičkou a značkami
`{{kod}} {{nazev}} {{druh}} {{verze}} {{gestor}} {{vlastnik}} {{schvalovatel}} {{klasifikace}} {{spolecnost}} {{datum}}`.
U návrhu verze gestor zvolí „Ze šablony…“ a CONTIX vytvoří soubor `KÓD Název vX.Y.docx` s doplněnými údaji.
Značky mohou být v textu, záhlaví i zápatí; Word je smí rozdělit do více formátovacích úseků.

**Check-out / check-in.** „Rezervovat k úpravě“ zamkne návrh: ostatní ho nemohou měnit (text, soubory, předložení,
přímé schválení) a vidí, kdo a od kdy ho upravuje. „Vrátit po úpravě“ nahraje upravený soubor jako **novou revizi**
(původní zůstává ve „Starších revizích“) s poznámkou a rezervaci uvolní. Předložení ke kontrole rezervaci uvolní
automaticky. Cizí rezervaci může zrušit správce dokumentace (zapíše se do historie). Rezervace je volitelná – bez ní
lze návrh upravovat jako dosud.

**Skartace (vyhl. č. 259/2012 Sb.).** Každý dokument má skartační znak (A archiválie / S skartovat / V výběr) a lhůtu;
výchozí hodnoty podle druhu lze u dokumentu změnit. Lhůta začíná 1. ledna roku následujícího po zrušení dokumentu
(stav Zrušený). Záložka Skartace ukazuje zrušené dokumenty a stav lhůty; po uplynutí přijde úkol „Skartace / archivace
dokumentu“. Správce stáhne balíček (ZIP – všechny verze, revize souborů, texty, historie a `dokument.json`) a provede
skartaci nebo předání do archivu s číslem protokolu. Tím se odstraní soubory a texty verzí; záznam o dokumentu,
verzích, schválení a seznámení zůstává jako doklad. Dokument se znakem A nelze skartovat, jen předat do archivu.
Nic se nemaže automaticky.

## DMS III – PDF, vyhledávání a porovnání verzí (v0.24)

**Originál zůstává beze změny.** Gestor dál pracuje ve Wordu / Excelu (desktop i M365) a nahrává .docx/.xlsx/.pptx.
CONTIX z něj vytváří jen odvozené výstupy:

- **PDF pro čtení a tisk** – převodní služba (LibreOffice) převede Word / Excel / PowerPoint do PDF. Při otevření se do
  každé stránky doplní **doložka** (označení, verze, stav, kdo a kdy schválil, účinnost, kdo a kdy stáhl – „vytištěná
  kopie je neřízená“) a u neplatné verze **vodoznak NEPLATNÉ**, u návrhu **NÁVRH**. Razítko se tvoří vždy při stažení,
  takže odpovídá aktuálnímu stavu (po schválení nové verze je stará okamžitě „NEPLATNÉ“). Nahraje-li gestor vlastní PDF
  exportované z Wordu, má přednost (stejný vzhled jako ve Wordu, jen s doložkou).
- **Vyhledávání v obsahu** – text z Wordu, Excelu, PowerPointu a ODF čte CONTIX sám, text z PDF převodní služba.
  Hledá se bez ohledu na diakritiku a velikost písmen; v portálu i ve Správě dokumentace se zobrazí úryvek.
- **Porovnání verzí** – po odstavcích a v nich po slovech (přidané / odebrané / upravené). Ve Správě u každé verze
  „Porovnat s …“, zaměstnanci v portálu „Co se změnilo oproti verzi …“ (před potvrzením seznámení).

Kontrola převodů: ikona PDF u souboru, „PDF se připravuje…“, „převod do PDF selhal“ (s možností zkusit znovu);
souhrnně v Administrace → Provoz.

## DMS IV – úpravy v desktopovém Word / Excel / PowerPoint (v0.25)

U souboru Word / Excel / PowerPoint v návrhu verze je tlačítko **Upravit ve Wordu** (v Excelu, v PowerPointu):

1. CONTIX verzi automaticky **rezervuje** (check-out) a otevře soubor v desktopové aplikaci (Microsoft 365 / Office).
2. Uživatel upravuje a ukládá běžně (**Ctrl+S**). Uložení se zapíše přímo do CONTIXu: první uložení vytvoří
   **novou revizi** souboru, další uložení v rámci téže úpravy ji přepisují (vznikne jedna revize za úpravu).
   PDF a text pro vyhledávání se obnoví na pozadí. V CONTIXu je vidět „uloženo N×, naposledy …“.
3. Po zavření dokumentu uživatel klikne na **Vrátit po úpravě** – rezervace se uvolní a odkaz pro Office přestane platit.

U schválených verzí lze soubor otevřít v Office **jen pro čtení** (pro tisk a čtení je určeno PDF s doložkou).

Bezpečnost: Office se k CONTIXu připojuje přes HTTPS (WebDAV) s osobním odkazem, který obsahuje náhodný token
vázaný na uživatele, soubor a rezervaci; platí jen po dobu úpravy (nejdéle 24 h) a v CONTIXu se ukládá jen jeho otisk.
Odkaz nikomu neposílejte. Požadavky na klienty (důvěra certifikátu, zóna Místní intranet) viz
[instalační příručka](../../04_operations/install.md#5-klienti--adresa-a-důvěra-certifikátu).

## Zeptej se dokumentace (v0.27)

Zaměstnanec se v **Dokumentech** zeptá běžnou řečí a dostane odpověď s citacemi [1], [2] odkazujícími na konkrétní
dokument a článek. Odpověď připraví lokální model (Open WebUI / Ollama v síti organizace):

1. Platné verze dokumentů (text v CONTIXu i texty souborů Word / PDF) se rozdělí na úseky po odstavcích s nejbližším
   nadpisem / článkem a k úsekům se spočítá vektor (model **bge-m3**). Ukládá se v PostgreSQL (pgvector).
2. Otázka se vyhledá podle významu i podle slov (přesné termíny, čísla článků); vybere se nejvýše 6 úseků –
   **jen z dokumentů, které uživatel smí číst** (pravidla portálu; správce dokumentace vidí všechny).
3. Model odpovídá výhradně z vybraných úseků; když odpověď v dokumentaci není, řekne to.

Nastavení: Administrace → AI asistent → „Zeptej se dokumentace“ + model pro embedding (na serveru s Ollamou
`ollama pull bge-m3`). Indexace běží po schválení verze a v plánovači (každých 15 minut – nové texty z převodní služby,
změna modelu, zrušené dokumenty). Návrhy verzí se nikdy neindexují. Každý dotaz se zapisuje do auditního záznamu.
