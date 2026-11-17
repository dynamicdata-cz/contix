# ADR-126: Nastavení členství skupin v AD podle schválených žádostí (v1.29)

## Kontext

Žádosti o přístup (ADR-123) končí ručním nastavením správcem; soulad (ADR-125) ukazuje rozdíly. Zákazníci chtějí
odstranit ruční krok, ale zápis do AD je citlivý – chyba nebo kompromitace CONTIXu nesmí vést k převzetí domény.

## Rozhodnutí

1. Tři režimy na společnost (`iam_provisioning`): `off` (výchozí), `script` (PowerShell `Add/Remove-ADGroupMember`
   pro vybrané žádosti, vyřízení až ověřením podle synchronizace – `verifyByDirectory`, i v plánovači), `ldap` (zápis).
2. Zápis jen **odděleným účtem** (heslo šifrované APP_SECRET), ne účtem pro čtení; doporučená delegace jen
   „Write Members“ na skupiny v jedné OU. Nastavení mění jen `admin:settings`.
3. Pojistky před každým zápisem: skupina zadaná DN uvnitř povolené OU, ne v seznamu privilegovaných
   (`PROVISIONING_FORBIDDEN` + vlastní), na serveru ne `adminCount=1` ani privilegovaný SID (`isPrivilegedAdGroup`);
   účet podle loginu / e-mailu s DN ze synchronizace; denní limit úspěšných zápisů; nikdo nenastavuje sám sobě.
4. Zápis jen z náhledu (`/provisioning/plan`) po výběru a potvrzení; úspěch → `fulfilRequest` (vyřízení),
   neúspěch → žádost zůstává schválená. Každý pokus v `iam_provisioning_log` a v auditu. „Už je členem“ / „není členem“
   = úspěch (idempotence).
5. LDAP zápis za rozhraním `AdWriter` (testy bez AD).

## Důsledky

- Kompromitace CONTIXu umožní nanejvýš změnit členství nepriviligovaných skupin v jedné OU, v denním limitu.
- Režim skript dovoluje nasazení i tam, kde CONTIX do AD zapisovat nesmí, a dává auditní stopu vyřízení podle AD.
- Entra ID (cloudové skupiny přes Graph) zatím ne – samostatné rozhodnutí.
