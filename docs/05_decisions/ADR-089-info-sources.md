# ADR-089: Zdroje informačního servisu v dalších jazycích, stránky bez RSS, hromadné PDF

**Stav:** přijato (v0.94)

## Rozhodnutí
- `classifyFeedItem` rozpoznává i slovenské, německé a anglické výrazy; kanál může mít `defaultKind` pro nerozpoznané položky (`feedItemKind`).
- Kanál `format: "html"` + `linkPrefix`: výpis novinek z webové stránky jen přes `parseHtmlListing` (`modules/infoservice/html.ts`) – odkazy na téže doméně pod prefixem, bez parametrů; nadpis z textu odkazu, datum nejbližší k odkazu; bez data = datum prvního výskytu. Jen čtení stránky, nic dalšího se nestahuje.
- Hromadné doplnění měsíců: web volá `/stats/suggest` pro každý soubor postupně a ukládá jen vybrané přes `/stats/manual` – server beze změny, nic se neukládá bez potvrzení.
