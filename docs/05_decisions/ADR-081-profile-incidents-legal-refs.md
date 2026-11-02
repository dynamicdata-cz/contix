# ADR-081: Profil – hlášení incidentů, právní odkazy a výstupy

**Stav:** přijato (v0.85)

## Kontext
ADR-080 zavedl regulatorní profil pro rámce, audity a rizika. Hlášení incidentů, kontroly dokumentace (§ 6) a významných změn (§ 11), zpráva pro vedení a průvodce nastavením zůstaly vázané na český zákon.

## Rozhodnutí
- Profil nese `incidentRegime`: balíček CZ = režim zákona (vyšší / nižší / mimo), obecný balíček = **NIS2 čl. 23** – hlásí se významný incident (stejné posouzení jako v nižším režimu CZ: únosná míra újmy + oblasti), včasné varování 24 h, oznámení 72 h (24 h u služeb vytvářejících důvěru), závěrečná zpráva do 1 měsíce od oznámení, při trvání zpráva o pokroku a závěrečná zpráva do měsíce od vyřešení. Adresát `incidentRecipient` (NÚKIB / národní CERT / jiný – CSIRT nebo příslušný orgán). GDPR 72 h platí vždy.
- Mezery kontrol (dokumentace, významné změny) jsou obecné dobré praxe; odkazy „(§ …)“ se mimo balíček CZ odstraní (`withLegalRefs`). Profily všech společností hromadně `profilesByCompany`.
- Zpráva pro vedení a průvodce ukazují popisek profilu (`profileLabelKey`).

## Důsledky
Texty nápovědy a části popisků UI stále odkazují na český zákon; terminologie a balíčky států (SK, PL, DE/AT) s vlastními pravidly hlášení přijdou ve verzi 0.86 jako data balíčku.
