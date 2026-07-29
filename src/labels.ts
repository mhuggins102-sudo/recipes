// Display-time step-label shortening: "beat in eggs and vanilla until light,
// about 1 min" -> "beat 1 min". Pure heuristics, no model calls: find the key
// cooking verb, drop the prose, keep temperatures and durations (they can't
// be recovered from the ingredient list).

// Real cooking actions — the first one found names the step.
const STRONG_VERBS = new Set([
  "mix", "stir", "beat", "cream", "fold", "whisk", "whip", "knead", "blend",
  "combine", "melt", "bake", "boil", "simmer", "saute", "sauté", "fry",
  "roast", "broil", "grill", "toast", "sear", "brown", "caramelize", "reduce",
  "steam", "poach", "cook", "heat", "warm", "cool", "chill", "freeze",
  "refrigerate", "rest", "sit", "stand", "proof", "rise", "marinate", "brine",
  "cure", "soak", "bloom", "steep", "infuse", "scald", "temper", "dissolve",
  "roll", "shape", "form", "press", "flatten", "cut", "chop", "dice", "mince",
  "slice", "grate", "shred", "zest", "peel", "core", "mash", "puree", "crush",
  "sift", "strain", "drain", "rinse", "glaze", "brush", "drizzle", "sprinkle",
  "season", "toss", "coat", "dredge", "stuff", "fill", "layer", "spread",
  "pour", "scoop", "pipe", "garnish", "serve", "divide", "portion", "wrap",
  "seal", "crimp", "score", "flip", "baste", "skim", "microwave", "halve",
  "assemble", "cover", "split", "measure", "crack", "separate", "reserve",
]);

// Weak verbs name the step only when nothing stronger appears: "add chocolate
// chips and mix well" is a mix step, but "add toppings" stays "add".
const WEAK_VERBS = new Set([
  "add", "put", "place", "transfer", "set", "return", "arrange", "remove",
  "use", "let", "allow", "make", "top", "work", "bring", "move",
]);

const TEMP_RE = /\d+\s*°\s*[CF](?:\s*\(\s*\d+\s*°\s*[CF]\s*\))?|\d+\s*degrees\s*[CF]?(?:\s*\(\s*\d+\s*°?\s*[CF]?\s*\))?/gi;
const TIME_RE =
  /\b\d+(?:\s*(?:to|–|-)\s*\d+)?\s*(?:minutes?|mins?|min|hours?|hrs?|hr|seconds?|secs?|sec|days?)\b|\bovernight\b/gi;

/**
 * Shorten a step label to its key verb plus any temperatures/durations,
 * preserving their order of appearance. Falls back to the first word when no
 * known verb is present, and never returns an empty string.
 */
export function briefLabel(label: string): string {
  const words = label.toLowerCase().match(/[a-zà-ü'-]+/g) ?? [];
  const verb =
    words.find((w) => STRONG_VERBS.has(w)) ??
    words.find((w) => WEAK_VERBS.has(w)) ??
    label.trim().split(/\s+/)[0] ??
    label;

  // Collect temp/time fragments in the order they appear in the label.
  const extras: { index: number; text: string }[] = [];
  for (const re of [TEMP_RE, TIME_RE]) {
    for (const m of label.matchAll(re)) {
      extras.push({ index: m.index ?? 0, text: m[0].trim() });
    }
  }
  extras.sort((a, b) => a.index - b.index);

  return [verb, ...extras.map((e) => e.text)].join(" ");
}
