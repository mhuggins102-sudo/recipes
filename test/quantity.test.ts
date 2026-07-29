import { describe, expect, it } from "vitest";
import type { RecipeTree } from "../shared/schema";
import {
  DEFAULT_VIEW,
  applyView,
  preferUnits,
  transformNumbers,
  transformQuantity,
  unscaleQuantity,
} from "../src/quantity";

describe("transformNumbers", () => {
  it("is the identity at 1x with original style", () => {
    expect(transformNumbers("1 cup (200 g)", 1, "original")).toBe("1 cup (200 g)");
    expect(transformNumbers("weird ½ text", 1, "original")).toBe("weird ½ text");
  });

  it("scales integers, fractions, mixed numbers, and decimals", () => {
    expect(transformNumbers("2 lb (900 g)", 2, "original")).toBe("4 lb (1800 g)");
    expect(transformNumbers("3/4 cup (150 g)", 2, "original")).toBe("1 1/2 cup (300 g)");
    expect(transformNumbers("1 1/2 tsp", 2, "original")).toBe("3 tsp");
    expect(transformNumbers("0.25 tbsp", 2, "original")).toBe("1/2 tbsp");
  });

  it("halves quantities", () => {
    expect(transformNumbers("1 cup (200 g)", 0.5, "original")).toBe("1/2 cup (100 g)");
    expect(transformNumbers("1/4 cup (50 g)", 0.5, "original")).toBe("1/8 cup (25 g)");
  });

  it("understands unicode fractions", () => {
    expect(transformNumbers("1½ cups", 2, "original")).toBe("3 cups");
    expect(transformNumbers("¾ cup", 2, "original")).toBe("1 1/2 cup");
  });

  it("converts styles without scaling", () => {
    expect(transformNumbers("3/4 cup (150 g)", 1, "decimals")).toBe("0.75 cup (150 g)");
    expect(transformNumbers("0.25 tbsp", 1, "fractions")).toBe("1/4 tbsp");
    expect(transformNumbers("1 1/2 tsp", 1, "decimals")).toBe("1.5 tsp");
  });

  it("falls back to decimals when no kitchen fraction fits", () => {
    expect(transformNumbers("1/3 cup", 0.5, "fractions")).toBe("1/6 cup");
    expect(transformNumbers("0.96 oz", 1, "fractions")).toBe("0.96 oz");
  });

  it("scales ranges", () => {
    expect(transformNumbers("2 to 3 tbsp", 2, "original")).toBe("4 to 6 tbsp");
  });
});

describe("preferUnits", () => {
  it("shows only the metric side when metric is preferred", () => {
    expect(preferUnits("1 cup (200 g)", "metric")).toBe("200 g");
    expect(preferUnits("2 lb (900 g)", "metric")).toBe("900 g");
    expect(preferUnits("2 large (100 g)", "metric")).toBe("100 g");
  });

  it("shows only the imperial side when imperial is preferred", () => {
    expect(preferUnits("200 g (1 cup)", "imperial")).toBe("1 cup");
    expect(preferUnits("1 cup (200 g)", "imperial")).toBe("1 cup");
  });

  it("keeps a countable primary when only the opposite system exists", () => {
    expect(preferUnits("2 large (100 g)", "imperial")).toBe("2 large");
  });

  it("leaves single-sided or unclassifiable strings alone", () => {
    expect(preferUnits("1 tsp", "metric")).toBe("1 tsp");
    expect(preferUnits("a pinch", "metric")).toBe("a pinch");
    expect(preferUnits("1 cup (a splash)", "metric")).toBe("1 cup (a splash)");
    expect(preferUnits("", "metric")).toBe("");
  });
});

describe("transformQuantity + unscaleQuantity", () => {
  it("composes units, scale, and style", () => {
    expect(
      transformQuantity("3/4 cup (150 g)", {
        units: "metric",
        numbers: "decimals",
        scale: 2,
        labels: "full",
      }),
    ).toBe("300 g");
  });

  it("unscale inverts the multiplier for edit write-back", () => {
    const view = { ...DEFAULT_VIEW, scale: 2 };
    expect(unscaleQuantity("4 lb (1800 g)", view)).toBe("2 lb (900 g)");
    expect(unscaleQuantity("1 cup", { ...DEFAULT_VIEW, scale: 0.5 })).toBe("2 cup");
    expect(unscaleQuantity("1 cup", DEFAULT_VIEW)).toBe("1 cup");
  });
});

describe("applyView", () => {
  const recipe: RecipeTree = {
    title: "T",
    servings: "makes 16",
    setup: ["Preheat oven to 350°F (175°C)."],
    tree: {
      kind: "step",
      label: "bake 350°F (175°C) 30 to 40 min",
      children: [
        { kind: "ingredient", quantity: "1 cup (200 g)", name: "sugar" },
        {
          kind: "step",
          label: "melt",
          children: [{ kind: "ingredient", quantity: "4 oz (115 g)", name: "butter" }],
        },
      ],
    },
  };

  it("returns the same object untouched for the default view", () => {
    expect(applyView(recipe, DEFAULT_VIEW)).toBe(recipe);
  });

  it("scales quantities and servings but not labels or setup", () => {
    const out = applyView(recipe, { ...DEFAULT_VIEW, scale: 2 });
    expect(out.servings).toBe("makes 32");
    const [sugar, melt] = out.tree.children;
    expect(sugar).toMatchObject({ quantity: "2 cup (400 g)" });
    expect(melt).toMatchObject({ label: "melt" });
    expect(out.tree.label).toBe("bake 350°F (175°C) 30 to 40 min");
    expect(out.setup[0]).toBe("Preheat oven to 350°F (175°C).");
    // base untouched
    expect(recipe.tree.children[0]).toMatchObject({ quantity: "1 cup (200 g)" });
  });

  it("applies the unit preference across the tree", () => {
    const out = applyView(recipe, { ...DEFAULT_VIEW, units: "metric" });
    expect(out.tree.children[0]).toMatchObject({ quantity: "200 g" });
  });
});
