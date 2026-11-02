# ADR-019: Balíček pro auditora

**Stav:** přijato · 3. 10. 2026

## Rozhodnutí

1. Důkaz lze navázat **přímo na požadavek rámce** (`evidence_requirements`) vedle vazby přes opatření. Kritéria SOC 2
   často dokládají dokumenty, které nejsou „opatřením“ v katalogu (politika, organizační schéma). Počet důkazů
   na požadavek (přímo + přes opatření, bez duplicit) je v SoA (`evidenceCount`).
2. **Balíček pro auditora** je ZIP generovaný na požádání (nepersistuje se), za jednu společnost, rámec a období:
   `00_obsah.html` (požadavek → shoda → opatření → testy → důkazy), SoA v HTML i Wordu, protokoly testů
   (dokončené v období + otevřené), soubory důkazů a `manifest.csv` + `SHA256SUMS`. Vše čitelné offline,
   relativní odkazy, bez skriptů.
3. Soubory se přikládají do limitu 500 MB (`AUDIT_PACKAGE_MAX_BYTES`), nad limit jen se seznamem a kontrolním
   součtem. Při sestavení se kontrolní součet souboru ověřuje proti záznamu. Export se loguje
   (`evidence.package_exported`) se statistikou obsahu.
4. ZIP se sestavuje v paměti (`fflate`) – pro očekávané velikosti dostačující; při potřebě větších balíčků
   přejít na streamování.
