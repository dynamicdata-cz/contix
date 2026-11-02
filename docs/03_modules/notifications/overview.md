# Povinnosti a upozornění na lhůty

`collectObligations` (`modules/notifications/obligations.ts`) sbírá termíny z evidence – nic se nepersistuje:
lhůty hlášení incidentů, akce plánu zvládání rizik, pravidelné přehodnocení rizik, nápravná opatření z auditů,
plánované audity, přezkoumání ISMS, významné změny s nesplněnými kroky § 11, přezkum dokumentů, testy plánů
kontinuity a konec smluv s dodavateli. Osobní povinnosti navíc: seznámení s dokumenty a školení.

Kanály (Administrace → Upozornění):
- **E-mail (SMTP)** – heslo šifrovaně (APP_SECRET); denní souhrn bezpečnostnímu týmu (oprávnění `isms:write` ve společnosti)
  a osobní souhrn vlastníkům úkolů (držitelé funkčních míst) a osobám k seznámení / školení.
- **Microsoft Teams** – webhook (Workflows / Power Automate nebo příchozí webhook), jen HTTPS na doménách Microsoftu,
  adresa šifrovaně; zpráva jako Adaptive Card.
- **V aplikaci** – „Moje povinnosti“ (s počtem v menu) a „Lhůty týmu“.

Plánovač běží v procesu API každých 15 minut: okamžité výstrahy u lhůt hlášení incidentů (dnes / po termínu),
denní souhrn v nastavenou hodinu (volitelně jen pracovní dny). Deduplikace přes `notification_log`
(klíč povinnosti + kanál + příjemce + naléhavost); při chybě odeslání se záznam smaže a příště se zkusí znovu.
