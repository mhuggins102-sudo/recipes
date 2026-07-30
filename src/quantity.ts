// Pure display-time transforms for quantity strings. The model emits dual
// units ("1 cup (200 g)"), so unit preference, fraction/decimal style, and
// recipe scaling are all client-side string rewrites — no model calls.

import type { RecipeNode, RecipeTree } from "../shared/schema";

export interface ViewOptions {
  /** Which measurement system leads in "primary (other)" pairs. */
  units: "original" | "metric" | "imperial";
  /** How numbers are written. "original" keeps the source style. */
  numbers: "original" | "fractions" | "decimals";
  /** Recipe multiplier; 1 leaves quantities untouched. */
  scale: number;
  /** Step-label style: "brief" shortens to key verb + time/temp (see labels.ts). */
  labels: "full" | "brief";
}

/** The identity transform — source text untouched. (The UI's starting view
    for new recipes is INITIAL_VIEW in ui/viewBar.ts.) */
export const IDENTITY_VIEW: ViewOptions = {
  units: "original",
  numbers: "original",
  scale: 1,
  labels: "full",
};

// --- Number tokens ---------------------------------------------------------

const VULGAR: Record<string, number> = {
  "¼": 1 / 4,
  "½": 1 / 2,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 1 / 5,
  "⅖": 2 / 5,
  "⅗": 3 / 5,
  "⅘": 4 / 5,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};

// Longest-match-first: mixed fraction, plain fraction, int+vulgar, decimal.
const NUMBER_RE =
  /\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\s*[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d+(?:\.\d+)?/g;

function tokenValue(token: string): number {
  const vulgar = token.match(/[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/);
  if (vulgar) {
    const whole = token.replace(vulgar[0], "").trim();
    return (whole ? Number(whole) : 0) + VULGAR[vulgar[0]];
  }
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(token);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(token);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(token);
}

const DENOMINATORS = [2, 3, 4, 5, 6, 8, 16];
const SNAP = 1 / 64;

/** "1 1/2" when v snaps to a kitchen fraction, else a trimmed decimal. */
function toFraction(v: number): string | null {
  const whole = Math.floor(v + SNAP);
  const rest = v - whole;
  if (rest < SNAP) return String(whole);
  for (const d of DENOMINATORS) {
    const n = Math.round(rest * d);
    if (n > 0 && n < d && Math.abs(rest - n / d) <= SNAP) {
      const frac = `${n}/${d}`;
      return whole ? `${whole} ${frac}` : frac;
    }
  }
  return null;
}

function toDecimal(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  return String(rounded);
}

export type NumberStyle = "fractions" | "decimals" | "auto";

export function formatNumber(v: number, style: NumberStyle): string {
  if (style === "decimals") return toDecimal(v);
  const frac = toFraction(v);
  if (frac !== null) return frac;
  return toDecimal(v);
}

/**
 * Scale and/or restyle every number in a free-form quantity string.
 * factor 1 + style "original" is the identity (source text untouched).
 */
export function transformNumbers(
  text: string,
  factor: number,
  style: ViewOptions["numbers"],
): string {
  if (factor === 1 && style === "original") return text;
  const effective: NumberStyle = style === "original" ? "auto" : style;
  return text.replace(NUMBER_RE, (token) => formatNumber(tokenValue(token) * factor, effective));
}

// --- Unit preference -------------------------------------------------------

const METRIC_RE =
  /(^|[\s\d(])(g|kg|mg|ml|cl|dl|l|grams?|kilograms?|millilitres?|milliliters?|litres?|liters?|cm|mm)\b|°C\b/i;
const IMPERIAL_RE =
  /(^|[\s\d(])(cups?|tsp|tbsp|teaspoons?|tablespoons?|oz|ounces?|lbs?|pounds?|pints?|quarts?|gallons?|sticks?|inch(?:es)?|in|fl\s*oz)\b|°F\b/i;

function system(side: string): "metric" | "imperial" | "unknown" {
  if (METRIC_RE.test(side)) return "metric";
  if (IMPERIAL_RE.test(side)) return "imperial";
  return "unknown";
}

const DUAL_RE = /^(.*?)\s*\(([^()]+)\)$/;

/**
 * Show only the preferred measurement system in "primary (other)" pairs:
 * "1 cup (200 g)" under metric displays as just "200 g". A countable primary
 * ("2 large") survives when the parenthetical is the opposite system. Strings
 * that aren't a dual pair, or where neither side is classifiable, pass
 * through unchanged — this is display-only, the stored value keeps both.
 */
export function preferUnits(text: string, units: ViewOptions["units"]): string {
  if (units === "original") return text;
  const dual = DUAL_RE.exec(text);
  if (!dual) return text;
  const [, primary, paren] = dual;
  if (system(paren) === units) return paren;
  if (system(primary) === units) return primary;
  if (system(primary) === "unknown" && system(paren) !== "unknown") return primary;
  return text;
}

// --- Unit abbreviation -----------------------------------------------------

// Applied only when a units preference (metric/imperial) is selected — that's
// already a "normalize it for me" gesture. "As written" stays verbatim.
// Ordered longest-first; word boundaries keep "kilograms"→kg and
// "milliliters"→ml intact. Single letters (T, t, C) are never touched.
// An optional trailing period is absorbed; abbreviations don't pluralize.
const UNIT_ABBREVIATIONS: [RegExp, string][] = [
  [/\bfluid\s+ounces?\b\.?/gi, "fl oz"],
  [/\btablespoons?\b\.?/gi, "tbsp"],
  [/\btb(?:s|l|ls|lsp)\b\.?/gi, "tbsp"],
  [/\bteaspoons?\b\.?/gi, "tsp"],
  [/\bteas\b\.?/gi, "tsp"],
  [/\bcups?\b\.?/gi, "c"],
  [/\bounces?\b\.?/gi, "oz"],
  [/\bpounds?\b\.?/gi, "lb"],
  [/\bkilograms?\b\.?/gi, "kg"],
  [/\bgrams?\b\.?/gi, "g"],
  [/\bmillilit(?:er|re)s?\b\.?/gi, "ml"],
  [/\blit(?:er|re)s?\b\.?/gi, "L"],
  [/\bquarts?\b\.?/gi, "qt"],
  [/\bpints?\b\.?/gi, "pt"],
  [/\bgallons?\b\.?/gi, "gal"],
  // Already-short forms just lose a trailing period ("tsp." → "tsp").
  [/\b(tbsp|tsp|oz|lb|kg|g|ml|qt|pt|gal|c)\b\./gi, "$1"],
];

/** "2 tablespoons" → "2 tbsp", "300 milliliters" → "300 ml", … */
export function abbreviateUnits(text: string): string {
  let out = text;
  for (const [re, short] of UNIT_ABBREVIATIONS) out = out.replace(re, short);
  return out;
}

// --- Composition -----------------------------------------------------------

export function transformQuantity(text: string, view: ViewOptions): string {
  const preferred = preferUnits(text, view.units);
  const display = view.units === "original" ? preferred : abbreviateUnits(preferred);
  return transformNumbers(display, view.scale, view.numbers);
}

/** Undo the scale on an edited display string so the base recipe stays 1×. */
export function unscaleQuantity(text: string, view: ViewOptions): string {
  if (view.scale === 1) return text;
  return transformNumbers(text, 1 / view.scale, "original");
}

/**
 * Derive the display tree for the current view options. The stored recipe is
 * never mutated — it stays at 1× in the source's own units and number style.
 * Only ingredient quantities and the servings line are rewritten; step labels,
 * setup, and notes keep their text (times and temperatures don't scale).
 */
export function applyView(recipe: RecipeTree, view: ViewOptions): RecipeTree {
  if (view.units === "original" && view.numbers === "original" && view.scale === 1) {
    return recipe;
  }
  const clone = structuredClone(recipe);
  const walk = (node: RecipeNode): void => {
    if (node.kind === "ingredient") {
      node.quantity = transformQuantity(node.quantity, view);
    } else {
      node.children.forEach(walk);
    }
  };
  walk(clone.tree);
  if (clone.servings) {
    clone.servings = transformNumbers(clone.servings, view.scale, "original");
  }
  return clone;
}
