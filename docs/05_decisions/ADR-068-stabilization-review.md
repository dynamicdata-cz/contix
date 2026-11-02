# ADR-068: Stabilizace a bezpečnostní revize (v0.73)

- Stav: přijato

## Kontext
Po deseti funkčních verzích (v0.63–v0.72) bylo potřeba ověřit, že nové routy dodržují pravidla (oprávnění, tajemství), že přehledy zvládají realistický objem dat a že anglická verze je úplná.

## Rozhodnutí
- **Oprávnění rout** – test `apps/api/test/review.test.ts` projde všechny routery a selže, když routa nemá v řetězci `requirePerm` (nebo jinou guard funkci). Výjimky (`INLINE_GUARDED`) kontrolují oprávnění v handleru (druh záznamu, společnost, vlastník) nebo jde o veřejné rozhraní s tokenem; seznam nesmí obsahovat zastaralé položky. Revize výjimek: všechny kontrolují oprávnění v handleru, routerem (`.use("*", requirePerm)`), nebo tokenem.
- **Tajemství** – integrační testy kontrolují každou JSON odpověď API: nesmí obsahovat hash hesla, hash tokenu ani žádné pole `…Enc` / `…_enc` s hodnotou; stejně auditní log. Nález: žádný.
- **Výkon** – `load-test.ts` rozšířen o technické závislosti aktiv a přehledy graf, odolnost, plán oprav, výjimky, akce, hostitelé SOC. Při 5 000 aktivech, 40 000 zranitelnostech a 10 000 závislostech odpovídají všechny přehledy do 320 ms.
- **Anglická nápověda** – přeložena všechna témata (`help.en.ts`); test hlídá, že každé téma má překlad se stejnými oddíly a že každá statická hláška `HTTPException` má anglický popisek.
- **Závislosti** – `nodemailer` 7 → 10 (vysoké zranitelnosti: DoS v parseru adres, ověření TLS u OAuth2); `source-map-js` přes `overrides` ≥ 1.2.2. Zbývá `esbuild` ≤ 0.24 v `drizzle-kit` – jen vývojový nástroj, na serveru neběží jako dev server.

## Důsledky
- Nová routa bez `requirePerm` neprojde testy; výjimku je nutné vědomě zapsat.
- Nové téma nápovědy nebo hláška API musí mít anglický text.
