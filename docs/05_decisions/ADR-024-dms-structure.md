# ADR-024: DMS II – složky, šablony, check-out a skartace

**Stav:** přijato · 4. 10. 2026

1. **Složky jako samostatná tabulka** (`policy_folders`, strom přes `parent_id`, firma přes `company_id`), dokument
   odkazuje `folder_id` (při smazání složky by zůstal nezařazený, ale mazat lze jen prázdnou). Cesty se počítají
   (`folderTree`), nepersistují. Přesun dokumentu do jiné společnosti zařazení zruší.
2. **Číslování bez sekvencí**: další číslo = max. číslo v řadě `PREFIX-n` ve společnosti + 1 (`nextDocCode`). Ruční
   označení zůstává možné; mezery v řadě se nedoplňují. Souběh dvou založení může výjimečně dát stejné číslo – označení
   není unikátní klíč, uživatel ho opraví (preferována jednoduchost před zámky).
3. **Šablony Wordu bez knihovny**: .docx/.dotx je ZIP; značky se nahrazují v `document.xml`, záhlavích a zápatích
   regulárním výrazem, který toleruje XML tagy mezi znaky (Word dělí text do „runs“) a zachovává je, takže XML zůstane
   vyvážené. `.dotx` se převede na dokument změnou content type. Jiné formáty se kopírují beze změny.
4. **Check-out je zámek v řádku verze** (`locked_by_id`, `locked_at`), získaný podmíněným UPDATE (bez souběhu). Zámek
   je volitelný a platí jen pro návrh; všechny zápisy do návrhu jdou přes `draftFor`. Revize souborů se nikdy
   nepřepisují: nová revize odkazuje `replaces_id` a stará dostane `superseded_at` (historie, není v portálu).
5. **Skartace podle vyhl. č. 259/2012 Sb.**: znak A/S/V a lhůta v letech, spouštěcí událost = zrušení dokumentu
   (`retired_at`), lhůta od 1. 1. následujícího roku. Stav se počítá (`retentionOf`). Vyřazení je ruční akce správce
   s protokolem; smaže obsah (soubory, texty), metadata a historie zůstávají jako doklad. Před vyřazením je k dispozici
   ZIP balíček pro archiv. Archiválie (A) nelze skartovat.
