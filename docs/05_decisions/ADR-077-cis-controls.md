# ADR-077: CIS Critical Security Controls v8.1 a výběr rámců v okně společnosti

**Stav:** přijato (v0.81)

## Kontext
Zákazníci kombinují vyhlášku 409/410 s dalšími standardy; častým požadavkem je CIS Controls v8.1 s odstupňováním podle implementačních skupin (IG1–IG3). Výběr sledovaných rámců byl dosud jen v Administrace → Nastavení, v okně kořenové společnosti chyběl.

## Rozhodnutí
- Nový rámec `cis8` (`shared/frameworks/data/cis.ts`): 18 opatření, 153 dílčích opatření, ID `cis8:<n.m>`, oddíl `CIS <n>`. Ukládají se jen čísla, IG a vlastní stručné české popisky CONTIX – text CIS (CC BY-NC-ND 4.0) se nevkládá (`fullText: false`).
- Implementační skupina `settings.cisIg` (1–3, výchozí 1), u dceřiné společnosti `overrides.cisIg`. Dílčí opatření s vyšší IG jsou bez výslovného posouzení neaplikovatelná s odůvodněním (stejně jako kategorie SOC 2 mimo rozsah).
- Mapování `CROSSWALK_409_CIS` (§ → celé opatření nebo dílčí opatření) je součástí `relatedRequirements`; při vytvoření výchozího katalogu se CIS mapuje jen, když ho společnost sleduje (jinak by se rámec „automaticky“ stal sledovaným). Doplnění k existujícímu katalogu přes `/controls/crosswalk`.
- Okno společnosti: kořenová společnost ukazuje výběr sledovaných rámců skupiny (zapisuje `settings.frameworks` / `cisIg`), dceřiná vlastní výběr hned pod režimem (ne skrytý mezi vlastními nastaveními).

## Důsledky
Mapování je orientační (obsahová příbuznost) a má se ověřit pro kontext organizace. Při nové verzi CIS se ID nemění bez migrace posouzení.
