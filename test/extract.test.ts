import { describe, expect, it } from "vitest";
import { extractJsonLdRecipe, stripHtmlToText } from "../shared/extract";

function page(ldJson: unknown): string {
  return `<html><head>
    <script type="application/ld+json">${JSON.stringify(ldJson)}</script>
    </head><body><p>filler</p></body></html>`;
}

const BASE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Test Brownies",
  recipeYield: "16 brownies",
  recipeIngredient: ["1 cup sugar", "2 eggs"],
  recipeInstructions: ["Mix everything.", "Bake."],
};

describe("extractJsonLdRecipe", () => {
  it("extracts a plain Recipe object", () => {
    const digest = extractJsonLdRecipe(page(BASE));
    expect(digest).toContain("TITLE: Test Brownies");
    expect(digest).toContain("YIELD: 16 brownies");
    expect(digest).toContain("- 1 cup sugar");
    expect(digest).toContain("1. Mix everything.");
  });

  it("finds the Recipe inside @graph (AllRecipes style)", () => {
    const doc = {
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebPage", name: "nope" }, BASE],
    };
    expect(extractJsonLdRecipe(page(doc))).toContain("TITLE: Test Brownies");
  });

  it("handles a top-level array and @type arrays", () => {
    const doc = [{ "@type": "BreadcrumbList" }, { ...BASE, "@type": ["Recipe", "NewsArticle"] }];
    expect(extractJsonLdRecipe(page(doc))).toContain("TITLE: Test Brownies");
  });

  it("handles HowToStep instructions (Serious Eats style)", () => {
    const doc = {
      ...BASE,
      recipeInstructions: [
        { "@type": "HowToStep", text: "Cream the butter." },
        { "@type": "HowToStep", text: "Fold in flour." },
      ],
    };
    const digest = extractJsonLdRecipe(page(doc));
    expect(digest).toContain("1. Cream the butter.");
    expect(digest).toContain("2. Fold in flour.");
  });

  it("handles HowToSection with nested steps", () => {
    const doc = {
      ...BASE,
      recipeInstructions: [
        {
          "@type": "HowToSection",
          name: "Batter",
          itemListElement: [{ "@type": "HowToStep", text: "Whisk the eggs." }],
        },
      ],
    };
    const digest = extractJsonLdRecipe(page(doc));
    expect(digest).toContain("[Batter]");
    expect(digest).toContain("Whisk the eggs.");
  });

  it("handles a single instructions string and yield array", () => {
    const doc = { ...BASE, recipeInstructions: "Mix; bake.", recipeYield: ["16", "16 brownies"] };
    const digest = extractJsonLdRecipe(page(doc));
    expect(digest).toContain("1. Mix; bake.");
    expect(digest).toContain("YIELD: 16 / 16 brownies");
  });

  it("skips malformed JSON-LD blocks and keeps looking", () => {
    const html = `<script type="application/ld+json">{not json</script>${page(BASE)}`;
    expect(extractJsonLdRecipe(html)).toContain("TITLE: Test Brownies");
  });

  it("returns null when no Recipe exists", () => {
    expect(extractJsonLdRecipe(page({ "@type": "WebSite", name: "x" }))).toBeNull();
    expect(extractJsonLdRecipe("<html><body>no ld+json</body></html>")).toBeNull();
  });

  it("ignores Recipe objects with no usable content", () => {
    expect(extractJsonLdRecipe(page({ "@type": "Recipe", name: "Empty" }))).toBeNull();
  });
});

describe("stripHtmlToText", () => {
  it("drops scripts/styles, keeps text, decodes entities", () => {
    const html = `<html><head><style>.x{}</style><script>var a=1;</script></head>
      <body><h1>Grandma&#39;s Pie</h1><p>1&frac12; cups flour &amp; sugar</p>
      <li>350&deg;F</li></body></html>`;
    const text = stripHtmlToText(html);
    expect(text).toContain("Grandma's Pie");
    expect(text).not.toContain("var a=1");
    expect(text).toContain("& sugar");
    expect(text).toContain("350°F");
  });

  it("truncates very long input", () => {
    const text = stripHtmlToText(`<p>${"a".repeat(50_000)}</p>`);
    expect(text.length).toBeLessThan(31_000);
    expect(text).toContain("[...truncated]");
  });
});
