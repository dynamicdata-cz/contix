# ADR-185: Počítače a servery z Active Directory

Stav: **přijato** (v1.90.0) – navazuje na [ADR-029](ADR-029-identity-access-review.md), [ADR-181](ADR-181-mapa-propojeni.md)
a [ADR-184](ADR-184-identity-reporty.md).

## Kontext

Zdroj AD v modulu Identity a přístupy četl jen uživatelské účty a skupiny. Doména ale zná i všechny počítače:
jejich systém, poslední přihlášení, správu hesla místního správce (LAPS) a delegaci Kerberos. To je nejlevnější
úplný seznam serverů a stanic – a porovnáním s aktivy a se sběrem dat (agent, sběrač, Wazuh) ukáže slepá místa:
servery, o kterých CONTIX nic neví nebo je nikdo nesleduje.

## Rozhodnutí

1. **Čtení jen pro čtení** stejným účtem jako uživatele: dotaz `(objectCategory=computer)` s atributy systému,
   UAC, primární skupiny, posledního přihlášení, SPN, `msDS-AllowedToDelegateTo` a expirace hesla LAPS (Microsoft
   LAPS i Windows LAPS – jen existence atributu, heslo samotné se nečte). Volba zdroje `computers` (výchozí zapnuto).
   Chyba dotazu na počítače synchronizaci účtů nezastaví – jen poznámka; nálezy počítačů se pak nemění.
2. **Role** z adresáře: řadič domény (UAC `SERVER_TRUST_ACCOUNT` nebo primární skupina 516 / 521), server
   (systém obsahuje „Server“), stanice (Windows), jiné.
3. **Inventář** v tabulce `identity_computers` (zdroj + objectGUID), zmizelé počítače se označí jako odstraněné.
4. **Párování s aktivy** ve společnosti zdroje podle krátkého jména (hostname), názvu nebo FQDN – **jen jednoznačná
   shoda**. Údaje aktiva se nepřepisují (správce může mít přesnější), doplní se jen prázdné FQDN a systém; aktivum
   dostane zdroj „Active Directory“ (`asset_sources`). Počítače bez aktiva lze hromadně založit jako aktiva
   (server / stanice) – vyžaduje i `assets:write`.
5. **Nálezy** (stejný mechanismus jako u účtů, subjekt `computer:<id>`): neaktivní počítač (výchozí 90 dní, nastavitelné
   `computerStaleDays`; ne řadiče), systém bez podpory výrobce (`osSupport`), neomezená delegace (mimo řadiče),
   počítač bez LAPS (jen když je LAPS v doméně nasazen jinde), LAPS v doméně nenasazen (jeden nález za doménu),
   počítač ve výchozím kontejneru `CN=Computers` a **server bez sběru dat** – aktivní server nebo řadič, jehož aktivum
   nemá agenta, sběrač ani Wazuh (nebo aktivum nemá vůbec).
6. **Pokrytí** v mapě propojení doplňuje počet aktivních serverů z AD a kolik z nich nemá aktivum.
7. Automatický test opatření „kontrola účtů“ bere pravidla počítačů jen u zdrojů, které počítače načítají.

## Důsledky

- Migrace `0130_identity_computers` (tabulka, `identity_findings.computer_id`, typ zdroje aktiva `ad`).
- Nové API `/api/identity/computers` (seznam se souhrnem, export CSV / XLSX, založení aktiv).
- Reporty k počítačům (Word / PDF) jsou další krok.
