## Co a proč

<!-- Odkaz na issue, stručný popis změny -->

## Kontrola

- [ ] test ke změně, `bun run typecheck` a testy prošly
- [ ] oprávnění u nových rout (`requirePerm`), audit změn dat
- [ ] texty UI v `cs.ts` i `en.ts`, nápověda u nové funkce
- [ ] migrace jen přes `bun run db:generate`, žádná tajemství v kódu
- [ ] commity podepsané (`git commit -s`)
