# ADR-135: Klíčové údaje detailu a řídicí panel pro vedení (v1.38)

## Kontext

Třetí krok nového vzhledu (ADR-133, 134). Detail záznamu ukazoval vlastníka, stav a termíny až ve formuláři;
zpráva pro vedení byla mřížka stejně důležitých ukazatelů bez shrnutí a bez toho, co má vedení rozhodnout.

## Rozhodnutí

1. `Facts` / `PageHeader.facts` (`components/ui`): řádek klíčových údajů pod nadpisem (popisek – hodnota, tón
   červená / oranžová). Použito u rizika (vlastník, stav, ošetření, hodnoceno, podněty, ALE), aktiva (vlastník,
   kritičnost, C/I/A, umístění, IP), incidentu (druh, stav, kategorie, odpovídá, nejbližší lhůta) a projektu
   (semafor, manažer, sponzor, termín, rozpočet). Zdvojené odkazy zpět nad nadpisem odstraněny (je drobečková navigace).
2. Řídicí panel ve zprávě pro vedení: celkový stav jen `managementHealthScore` (shared, z úrovní ukazatelů zprávy,
   nepersistuje se), karty „K rozhodnutí“ = ukazatele s úrovní vyžaduje rozhodnutí / pozor, „Čeká na vaše schválení“ =
   `WorkQueue` s filtrem schválení (ADR-134). Žádné nové API.
3. Sticky záhlaví detailu rizika a opatření pod horní lištou (`top-14`).

## Důsledky

- Nový detail záznamu: klíčové údaje do `facts`, ne do podnadpisu.
