# ADR-148: Sběrač ze serverů jako typ připojení (v1.51)

## Kontext

Náměty 1, 2, 3, 5, 7, 8 z analýzy: účty a autorizované SSH klíče na linuxových serverech, Docker kontejnery
a image, samostatné služby, iptables / nftables a jejich přežití restartu. Wazuh syscollector tyto údaje
(kromě balíčků a portů) nesbírá; přidávat vlastní moduly do agentů zákazníků je obtížné.

## Rozhodnutí

1. Připojení typu `collector` (ADR-146): název, rozsah (společnost), token `ctxh_…` – v DB jen SHA-256,
   zobrazí se jednou, lze obnovit; vypnuté připojení hlášení odmítá.
2. Skript `contix-collect.py` (Python 3, standardní knihovna, jen čte) – posílá `HostInventoryInput`
   na `POST /api/public/hosts/inventory` (Bearer token připojení, limit 4 MB). Ze SSH klíčů jen otisk SHA256,
   typ, délka, komentář a omezení; hesla ani celé klíče nikdy.
3. Server → aktivum přes `ingestDiscovered` (zdroj `collector`, ref = machine-id, jinak hostname, s id připojení;
   párování se stávajícím aktivem z Wazuhu podle názvu). Poslední inventář v `host_inventories`
   (jedinečně připojení + hostitel), nálezy z čisté funkce `evaluateHost` (shared).
4. Nálezy v1: další účet s UID 0, slabý klíč (DSA, RSA < 3072), klíč roota, klíč bez komentáře, privilegovaný
   kontejner, kontejner jako root, žádný firewall, výchozí ACCEPT, neuložená pravidla.
5. Zobrazení: karta u aktiva, přehled v Discovery; správa v Administrace → Konektory.

## Důsledky

Migrace 0108 (`host_inventories`, hodnota `collector` v `source_type`). Další krok: vazba SSH klíčů na osoby
(Identity – klíč osoby, která odešla), schválené porty podle role serveru, zranitelnosti image (Trivy).
