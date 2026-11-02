/** Barevné motivy CONTIX – volba uživatele, uložená jen v prohlížeči (vzhled není citlivý ani sdílený). */
export const THEMES = [
  { key: "blue", label: "Modrá", hint: "Svěží modrá, chladné šedé tóny", swatch: ["#2c54d6", "#f6f8fb", "#ffffff"] },
  { key: "petrol", label: "Petrolej", hint: "Klidná zelenomodrá, teplé neutrální tóny", swatch: ["#157266", "#f7f6f3", "#ffffff"] },
  { key: "night", label: "Noc", hint: "Indigo a tmavý boční panel", swatch: ["#5148e5", "#161931", "#f5f6fa"] },
] as const;
export type ThemeKey = (typeof THEMES)[number]["key"];
const KEY = "contix.theme";

export function getTheme(): ThemeKey {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.some((t) => t.key === v) ? (v as ThemeKey) : "blue";
  } catch {
    return "blue";
  }
}
export function applyTheme(t: ThemeKey) {
  if (t === "blue") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
export function setTheme(t: ThemeKey) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* úložiště nedostupné – motiv platí jen do obnovení stránky */
  }
  applyTheme(t);
}

/* ---------- světlý / tmavý režim (v1.08, ADR-104) ---------- */
export const MODES = ["system", "light", "dark"] as const;
export type ModeKey = (typeof MODES)[number];
const MODE_KEY = "contix.mode";

export function getMode(): ModeKey {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return (MODES as readonly string[]).includes(v ?? "") ? (v as ModeKey) : "system";
  } catch {
    return "system";
  }
}
const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
/** Nastaví `html[data-mode]` podle volby (u „podle systému“ sleduje změnu nastavení systému). */
export function applyMode(m: ModeKey = getMode()) {
  const dark = m === "dark" || (m === "system" && !!media?.matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
media?.addEventListener?.("change", () => getMode() === "system" && applyMode("system"));
export function setMode(m: ModeKey) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* úložiště nedostupné */
  }
  applyMode(m);
}
