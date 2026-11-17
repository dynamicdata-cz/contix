# ADR-170: Přihlašovací obrazovky v duchu loga (v1.77)

## Kontext

Přihlášení používalo barvu motivu (modrá / indigo) a obecnou kartu – vedle loga CONTIX (tmavý zaoblený rámeček,
dvoubarevné geometrické písmo, ADR-161) působilo nesourodě.

## Rozhodnutí

- `AuthShell` (`pages/auth/AuthScreens.tsx`): logo nad kartou na střed (značka, slovní značka, podtitul s prostrkáním),
  karta s tmavým zaobleným rámečkem jako značka, jemný vodoznak značky v pozadí.
- Hlavní tlačítka přihlášení, MFA a změny hesla inkoustem značky (`AUTH_PRIMARY`), zaměření polí inkoustem
  (`.auth-ink` ve `styles.css`) – nezávisle na barevném motivu. Jen škála slate, takže tmavý režim značku obrátí.
