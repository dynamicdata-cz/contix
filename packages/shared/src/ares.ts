/* ============================================================
 * ARES (Administrativní registr ekonomických subjektů, MF ČR) – načtení údajů o firmě podle IČO nebo názvu (ADR-041).
 * Dotaz jde ze serveru CONTIXu (veřejné REST API bez registrace), do ARES se posílá jen IČO nebo hledaný název.
 * ============================================================ */

export interface AresSubject {
  ico: string;
  name: string;
  /** Sídlo jako jeden řádek (textová adresa ARES). */
  address: string | null;
  country: string | null;
  dic: string | null;
  /** Kód právní formy (číselník ČSÚ), např. 112 = s.r.o. */
  legalForm: string | null;
  /** Datum zániku – subjekt už neexistuje. */
  dissolvedAt: string | null;
}

/** Kontrolní číslice IČO (modulo 11) – překlep se odhalí bez dotazu do ARES. */
export function validIco(v: string): boolean {
  if (!/^\d{8}$/.test(v)) return false;
  const sum = [...v.slice(0, 7)].reduce((s, d, i) => s + Number(d) * (8 - i), 0);
  const r = sum % 11;
  const check = r === 0 ? 1 : r === 1 ? 0 : 11 - r;
  return check === Number(v[7]);
}

/** Dotaz: 8 číslic = IČO (doplní se nuly zleva u 6–7 číslic), jinak hledání podle obchodního jména (min. 3 znaky). */
export function aresQueryKind(q: string): { kind: "ico"; ico: string } | { kind: "name"; name: string } | null {
  const t = q.trim();
  const digits = t.replace(/\s/g, "");
  if (/^\d{6,8}$/.test(digits)) return { kind: "ico", ico: digits.padStart(8, "0") };
  if (t.length >= 3) return { kind: "name", name: t.slice(0, 200) };
  return null;
}
