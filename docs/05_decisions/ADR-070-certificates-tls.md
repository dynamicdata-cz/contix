# ADR-070: Inventář certifikátů a TLS

- Stav: přijato (v0.75)

## Kontext
Vypršelé certifikáty a zastaralá kryptografie (SHA-1, krátké klíče, TLS 1.0/1.1) jsou častou příčinou výpadků i nálezů auditu; vyhláška požaduje používat aktuální kryptografické prostředky. CONTIX dosud neměl přehled certifikátů.

## Rozhodnutí
- Evidence `tls_endpoints` (host, port, SNI, vazba na aktivum, společnost); výsledek poslední kontroly `result` (jsonb) a `not_after` pro dotazy.
- Kontrola jen **čtecím TLS spojením** (`probeTls`, `node:tls` bez ověření, rozbor přes `X509Certificate`; podpisový algoritmus z DER `signatureAlgorithmOf`). Bun neumí vynutit starší verzi TLS, proto se TLS 1.0 / 1.1 zjišťuje přes `openssl s_client` (`legacyProbe`, argumenty bez shellu, host ověřen `HOST_RE`) – bez openssl se nezjišťuje a UI to říká.
- Nálezy se nepersistují – `certFindings` (`shared/certificates.ts`) při čtení podle `settings.tlsPolicy` (dny předem, min. RSA/EC, TLS 1.0/1.1, max. platnost).
- Plánovač `processTlsScans` (lease, dávka 50, co 24 h); ruční kontrola `POST /assets/certificates/:id/scan` a `/scan-all`.
- Návrh koncových bodů z aktiv (`/candidates`) se uloží jen na pokyn uživatele.
- Povinnost `cert_expiry` (`certExpiryItems`) – týmová, odkaz na přehled.

## Důsledky
- Kontrolovat lze jen to, kam má server CONTIXu síťový přístup; nedostupnost je nález „Nedostupné“.
- Pravidla jsou na organizaci; doporučení NÚKIB k algoritmům je třeba promítnout do nastavení ručně.
