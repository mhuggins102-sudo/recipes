import { describe, expect, it } from "vitest";
import type { RecipeTree, StepNode } from "../shared/schema";
import { layout, nodeAtPath } from "../src/render/layout";

function recipe(tree: StepNode): RecipeTree {
  return { title: "T", setup: [], tree };
}

function ing(name: string) {
  return { kind: "ingredient", quantity: "", name } as const;
}

/** Flatten to comparable tuples: [path, row, col, colspan, rowspan]. */
function tuples(r: RecipeTree) {
  return layout(r)
    .rows.flat()
    .map((c) => [c.path, c.row, c.col, c.colspan, c.rowspan]);
}

describe("layout", () => {
  it("single ingredient under one step", () => {
    const r = recipe({ kind: "step", label: "bake", children: [ing("dough")] });
    const g = layout(r);
    expect(g.totalCols).toBe(2);
    expect(g.totalRows).toBe(1);
    expect(tuples(r)).toEqual([
      ["t.0", 0, 0, 1, 1],
      ["t", 0, 1, 1, 1],
    ]);
  });

  it("pure chain (melt -> mix -> bake) stacks columns", () => {
    const r = recipe({
      kind: "step",
      label: "bake",
      children: [
        {
          kind: "step",
          label: "mix",
          children: [{ kind: "step", label: "melt", children: [ing("butter")] }],
        },
      ],
    });
    const g = layout(r);
    expect(g.totalCols).toBe(4);
    expect(g.totalRows).toBe(1);
    expect(tuples(r)).toEqual([
      ["t.0.0.0", 0, 0, 1, 1],
      ["t.0.0", 0, 1, 1, 1],
      ["t.0", 0, 2, 1, 1],
      ["t", 0, 3, 1, 1],
    ]);
  });

  it("balanced 2x2 tree", () => {
    const r = recipe({
      kind: "step",
      label: "combine",
      children: [
        { kind: "step", label: "mix", children: [ing("a"), ing("b")] },
        { kind: "step", label: "whisk", children: [ing("c"), ing("d")] },
      ],
    });
    const g = layout(r);
    expect(g.totalCols).toBe(3);
    expect(g.totalRows).toBe(4);
    expect(tuples(r)).toEqual([
      ["t.0.0", 0, 0, 1, 1],
      ["t.0", 0, 1, 1, 2],
      ["t", 0, 2, 1, 4],
      ["t.0.1", 1, 0, 1, 1],
      ["t.1.0", 2, 0, 1, 1],
      ["t.1", 2, 1, 1, 2],
      ["t.1.1", 3, 0, 1, 1],
    ]);
  });

  it("unbalanced tree: shallow children stretch to the parent's column", () => {
    // combine( mix(melt(butter), sugar), eggs )
    const r = recipe({
      kind: "step",
      label: "combine",
      children: [
        {
          kind: "step",
          label: "mix",
          children: [
            { kind: "step", label: "melt", children: [ing("butter")] },
            ing("sugar"),
          ],
        },
        ing("eggs"),
      ],
    });
    const g = layout(r);
    expect(g.totalCols).toBe(4);
    expect(g.totalRows).toBe(3);
    expect(tuples(r)).toEqual([
      ["t.0.0.0", 0, 0, 1, 1],
      ["t.0.0", 0, 1, 1, 1],
      ["t.0", 0, 2, 1, 2],
      ["t", 0, 3, 1, 3],
      ["t.0.1", 1, 0, 2, 1], // sugar spans cols 0-1 up to "mix"
      ["t.1", 2, 0, 3, 1], // eggs spans cols 0-2 up to "combine"
    ]);
  });

  it("every row's cells tile the full width exactly", () => {
    const r = recipe({
      kind: "step",
      label: "bake",
      children: [
        {
          kind: "step",
          label: "fold in",
          children: [
            {
              kind: "step",
              label: "mix",
              children: [
                { kind: "step", label: "melt", children: [ing("butter")] },
                ing("sugar"),
                ing("vanilla"),
                ing("espresso"),
                ing("eggs"),
              ],
            },
            ing("flour"),
            ing("cocoa"),
            ing("baking soda"),
            ing("salt"),
          ],
        },
      ],
    });
    const g = layout(r);
    // Occupancy check: expand rowspans/colspans into a boolean grid.
    const occupied = Array.from({ length: g.totalRows }, () =>
      Array<number>(g.totalCols).fill(0),
    );
    for (const cell of g.rows.flat()) {
      for (let r2 = cell.row; r2 < cell.row + cell.rowspan; r2++) {
        for (let c2 = cell.col; c2 < cell.col + cell.colspan; c2++) {
          occupied[r2][c2] += 1;
        }
      }
    }
    expect(occupied.flat().every((n) => n === 1)).toBe(true);
  });

  it("divided ingredients are ordinary leaves in different branches", () => {
    const r = recipe({
      kind: "step",
      label: "assemble",
      children: [
        {
          kind: "step",
          label: "cream",
          children: [
            { kind: "ingredient", quantity: "3/4 cup", name: "sugar", note: "divided" },
            ing("butter"),
          ],
        },
        {
          kind: "step",
          label: "whip",
          children: [
            { kind: "ingredient", quantity: "1/4 cup", name: "sugar", note: "divided" },
            ing("egg whites"),
          ],
        },
      ],
    });
    const g = layout(r);
    expect(g.totalRows).toBe(4);
    expect(g.totalCols).toBe(3);
  });
});

describe("nodeAtPath", () => {
  it("resolves paths and rejects bad ones", () => {
    const tree: StepNode = {
      kind: "step",
      label: "combine",
      children: [{ kind: "step", label: "mix", children: [ing("a"), ing("b")] }],
    };
    const r = recipe(tree);
    expect(nodeAtPath(r, "t")).toBe(tree);
    expect(nodeAtPath(r, "t.0")).toBe(tree.children[0]);
    expect(nodeAtPath(r, "t.0.1")).toMatchObject({ name: "b" });
    expect(nodeAtPath(r, "t.5")).toBeUndefined();
    expect(nodeAtPath(r, "x.0")).toBeUndefined();
    expect(nodeAtPath(r, "t.0.1.0")).toBeUndefined();
  });
});
