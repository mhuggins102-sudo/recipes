import { describe, expect, it } from "vitest";
import { RecipeTreeZ } from "../shared/schema";
import { SAMPLE_RECIPE } from "../src/sample";

const MINIMAL = {
  title: "Toast",
  setup: [],
  tree: {
    kind: "step",
    label: "toast",
    children: [{ kind: "ingredient", quantity: "1 slice", name: "bread" }],
  },
};

describe("RecipeTreeZ instructions field", () => {
  it("accepts a recipe without instructions (pre-feature recipes)", () => {
    expect(RecipeTreeZ.safeParse(MINIMAL).success).toBe(true);
  });

  it("accepts a recipe with instructions", () => {
    const withInstructions = { ...MINIMAL, instructions: ["Toast the bread.", "Serve."] };
    const parsed = RecipeTreeZ.parse(withInstructions);
    expect(parsed.instructions).toEqual(["Toast the bread.", "Serve."]);
  });

  it("rejects empty-string instruction items", () => {
    const bad = { ...MINIMAL, instructions: ["Toast.", ""] };
    expect(RecipeTreeZ.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-array instructions value", () => {
    const bad = { ...MINIMAL, instructions: "Toast the bread." };
    expect(RecipeTreeZ.safeParse(bad).success).toBe(false);
  });

  it("still validates the bundled sample recipe", () => {
    expect(RecipeTreeZ.safeParse(SAMPLE_RECIPE).success).toBe(true);
  });
});
