import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);
const MODE_KEY = "lifeos-theme";
const ACCENT_KEY = "lifeos-accent";     // preset id OR "custom"
const CUSTOM_HSL_KEY = "lifeos-accent-hsl"; // "h,s,l" when accentId === "custom"

/**
 * Preset palette (quick picks). Each entry has base/dark/hover/soft/softFg for
 * both themes, hand-tuned. Custom colors get all of these derived from any HSL.
 */
export const ACCENTS = [
  { id: "maroon",  label: "Maroon", swatch: "#c0152a",
    base: "353 79% 42%",  dark: "353 79% 52%",  hover: "353 79% 36%",
    soft: "353 79% 95%",  softFg: "353 79% 30%",  darkSoft: "353 79% 18%", darkSoftFg: "353 79% 80%" },
  { id: "ember",   label: "Ember",  swatch: "#e65a12",
    base: "20 88% 48%",   dark: "20 88% 55%",   hover: "20 88% 42%",
    soft: "20 90% 95%",   softFg: "20 88% 36%",   darkSoft: "20 88% 20%",  darkSoftFg: "20 90% 80%" },
  { id: "ocean",   label: "Ocean",  swatch: "#0f8fa8",
    base: "191 82% 36%",  dark: "191 82% 46%",  hover: "191 82% 30%",
    soft: "191 82% 94%",  softFg: "191 82% 26%",  darkSoft: "191 82% 18%", darkSoftFg: "191 82% 80%" },
  { id: "forest",  label: "Forest", swatch: "#2a7a4b",
    base: "146 50% 32%",  dark: "146 50% 42%",  hover: "146 50% 26%",
    soft: "146 50% 92%",  softFg: "146 50% 22%",  darkSoft: "146 50% 18%", darkSoftFg: "146 50% 80%" },
  { id: "iris",    label: "Iris",   swatch: "#6b4dcf",
    base: "255 55% 55%",  dark: "255 65% 62%",  hover: "255 55% 46%",
    soft: "255 65% 95%",  softFg: "255 55% 36%",  darkSoft: "255 55% 20%", darkSoftFg: "255 65% 82%" },
  { id: "slate",   label: "Slate",  swatch: "#4a6076",
    base: "215 25% 38%",  dark: "215 20% 55%",  hover: "215 25% 30%",
    soft: "215 25% 92%",  softFg: "215 25% 24%",  darkSoft: "215 25% 20%", darkSoftFg: "215 20% 82%" },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Derive a full accent palette from any HSL. Rules chosen so:
 * - the picked color stays perceptually close to the user's choice
 * - contrast on both light and dark backgrounds is preserved
 * - hover shade is always meaningfully darker than base
 */
export function deriveAccent(h, s, l) {
  const H = Math.round(h);
  const S = clamp(Math.round(s), 20, 100); // ensure some chroma
  const L = clamp(Math.round(l), 25, 75);   // avoid near-black / near-white accents
  const base = `${H} ${S}% ${L}%`;
  // Dark-mode base: lift slightly for contrast on dark bg.
  const darkL = clamp(L + (L < 45 ? 12 : 8), 40, 72);
  const dark = `${H} ${S}% ${darkL}%`;
  // Hover: darker than base but never invisible.
  const hoverL = clamp(L - 6, 18, 60);
  const hover = `${H} ${S}% ${hoverL}%`;
  // Soft accent tints (used as chip backgrounds behind accent-foreground text).
  const soft = `${H} ${clamp(S, 40, 90)}% 94%`;
  const softFg = `${H} ${clamp(S, 40, 90)}% 28%`;
  const darkSoft = `${H} ${clamp(S, 40, 90)}% 20%`;
  const darkSoftFg = `${H} ${clamp(S, 40, 90)}% 82%`;
  return {
    id: "custom",
    label: "Custom",
    swatch: `hsl(${H} ${S}% ${L}%)`,
    base, dark, hover, soft, softFg, darkSoft, darkSoftFg,
    hsl: { h: H, s: S, l: L },
  };
}

function findAccent(id, customHsl) {
  if (id === "custom" && customHsl) {
    return deriveAccent(customHsl.h, customHsl.s, customHsl.l);
  }
  return ACCENTS.find((a) => a.id === id) || ACCENTS[0];
}

function applyAccent(root, accent, mode) {
  const isDark = mode === "dark";
  root.style.setProperty("--maroon",           isDark ? accent.dark    : accent.base);
  root.style.setProperty("--maroon-hover",     accent.hover);
  root.style.setProperty("--primary",          isDark ? accent.dark    : accent.base);
  root.style.setProperty("--ring",             isDark ? accent.dark    : accent.base);
  root.style.setProperty("--accent",           isDark ? accent.darkSoft   : accent.soft);
  root.style.setProperty("--accent-foreground",isDark ? accent.darkSoftFg : accent.softFg);
  root.style.setProperty("--chart-1",          isDark ? accent.dark    : accent.base);
}

function readCustomHsl() {
  try {
    const raw = localStorage.getItem(CUSTOM_HSL_KEY);
    if (!raw) return null;
    const [h, s, l] = raw.split(",").map(Number);
    if ([h, s, l].some((n) => !Number.isFinite(n))) return null;
    return { h, s, l };
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem(MODE_KEY) || "light";
  });
  const [accentId, setAccentId] = useState(() => {
    if (typeof window === "undefined") return ACCENTS[0].id;
    return localStorage.getItem(ACCENT_KEY) || ACCENTS[0].id;
  });
  const [customHsl, setCustomHsl] = useState(() => readCustomHsl() || { h: 210, s: 80, l: 50 });

  const accent = useMemo(() => findAccent(accentId, customHsl), [accentId, customHsl]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem(MODE_KEY, theme);
    applyAccent(root, accent, theme);
  }, [theme, accent]);

  useEffect(() => {
    localStorage.setItem(ACCENT_KEY, accentId);
  }, [accentId]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_HSL_KEY, `${customHsl.h},${customHsl.s},${customHsl.l}`);
  }, [customHsl]);

  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  /** Set a custom color from HSL. Automatically switches to the "custom" preset. */
  const setCustomColor = (hsl) => {
    setCustomHsl(hsl);
    setAccentId("custom");
  };

  return (
    <ThemeContext.Provider
      value={{
        theme, setTheme, toggle,
        accent, accentId, setAccentId, accents: ACCENTS,
        customHsl, setCustomColor,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
