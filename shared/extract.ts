// Runtime-agnostic helpers for turning a fetched recipe web page into compact
// text for the model: schema.org/Recipe JSON-LD when present, stripped page
// text otherwise. Pure functions — unit-tested in Node, executed in Workers.

export const MAX_TEXT_CHARS = 30_000;

// --- JSON-LD extraction --------------------------------------------------

const LD_JSON_RE =
  /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

type Json = unknown;

function asArray(v: Json): Json[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function isRecipeObject(obj: Json): obj is Record<string, Json> {
  if (typeof obj !== "object" || obj === null) return false;
  const type = (obj as Record<string, Json>)["@type"];
  return asArray(type).some((t) => typeof t === "string" && t.toLowerCase() === "recipe");
}

/** Flatten JSON-LD shapes (top-level arrays, @graph) into candidate objects. */
function candidates(doc: Json): Json[] {
  const out: Json[] = [];
  for (const item of asArray(doc)) {
    out.push(item);
    if (typeof item === "object" && item !== null && "@graph" in item) {
      out.push(...asArray((item as Record<string, Json>)["@graph"]));
    }
  }
  return out;
}

function instructionLines(v: Json): string[] {
  const lines: string[] = [];
  for (const item of asArray(v)) {
    if (typeof item === "string") {
      lines.push(item);
    } else if (typeof item === "object" && item !== null) {
      const o = item as Record<string, Json>;
      const type = asArray(o["@type"]).find((t): t is string => typeof t === "string");
      if (type?.toLowerCase() === "howtosection") {
        if (typeof o.name === "string") lines.push(`[${o.name}]`);
        lines.push(...instructionLines(o.itemListElement));
      } else if (typeof o.text === "string") {
        lines.push(o.text);
      } else if (typeof o.name === "string") {
        lines.push(o.name);
      }
    }
  }
  return lines;
}

function textOf(v: Json): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(textOf).filter(Boolean);
    return parts.length ? parts.join(" / ") : undefined;
  }
  return undefined;
}

/**
 * Find a schema.org Recipe in the page's JSON-LD and format it as a compact
 * text digest for the model. Returns null when no Recipe object is found.
 */
export function extractJsonLdRecipe(html: string): string | null {
  for (const match of html.matchAll(LD_JSON_RE)) {
    let doc: Json;
    try {
      doc = JSON.parse(decodeEntities(match[1].trim()));
    } catch {
      try {
        doc = JSON.parse(match[1].trim());
      } catch {
        continue;
      }
    }
    for (const cand of candidates(doc)) {
      if (!isRecipeObject(cand)) continue;
      const title = textOf(cand.name) ?? "Untitled recipe";
      const yield_ = textOf(cand.recipeYield);
      const ingredients = asArray(cand.recipeIngredient ?? cand.ingredients)
        .map(textOf)
        .filter((s): s is string => Boolean(s));
      const instructions = instructionLines(cand.recipeInstructions);
      if (ingredients.length === 0 && instructions.length === 0) continue;
      const parts = [
        `TITLE: ${title}`,
        yield_ ? `YIELD: ${yield_}` : null,
        "INGREDIENTS:",
        ...ingredients.map((s) => `- ${s}`),
        "INSTRUCTIONS:",
        ...instructions.map((s, i) => `${i + 1}. ${s}`),
      ].filter((s): s is string => s !== null);
      return truncate(parts.join("\n"));
    }
  }
  return null;
}

// --- Fallback: strip HTML to visible-ish text ----------------------------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&deg;": "°",
  "&frac12;": "1/2",
  "&frac14;": "1/4",
  "&frac34;": "3/4",
  "&ndash;": "-",
  "&mdash;": "-",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&rdquo;": '"',
  "&ldquo;": '"',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+\d*;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

export function stripHtmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return truncate(
    decodeEntities(text)
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim(),
  );
}

export function truncate(s: string, max = MAX_TEXT_CHARS): string {
  return s.length > max ? `${s.slice(0, max)}\n[...truncated]` : s;
}

// --- Model output parsing -------------------------------------------------

/**
 * Pull the JSON object out of model output that may wrap it in markdown
 * fences or stray prose: the substring from the first "{" to the last "}".
 * Returns null when the text contains no object.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
