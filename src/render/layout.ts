import type { RecipeNode, RecipeTree, StepNode } from "../../shared/schema";

// Pure tree -> grid layout for the "Cooking for Engineers" table.
//
// Column index = node height (ingredients at 0, root rightmost). A node's
// cell spans the rows of all its leaf descendants; its colspan stretches to
// its parent's column so unbalanced subtrees still tile the grid exactly.

export interface Cell {
  node: RecipeNode;
  /** Child-index path from the root, e.g. "t", "t.0", "t.0.2". */
  path: string;
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
}

export interface Layout {
  totalCols: number;
  totalRows: number;
  /** Indexed by row; each row's cells sorted by col. Every cell appears once, at the row of its first leaf. */
  rows: Cell[][];
}

function height(node: RecipeNode): number {
  if (node.kind === "ingredient") return 0;
  return 1 + Math.max(...node.children.map(height));
}

function leafCount(node: RecipeNode): number {
  if (node.kind === "ingredient") return 1;
  return node.children.reduce((sum, c) => sum + leafCount(c), 0);
}

export function layout(recipe: RecipeTree): Layout {
  const root: StepNode = recipe.tree;
  const totalCols = height(root) + 1;
  const totalRows = leafCount(root);
  const rows: Cell[][] = Array.from({ length: totalRows }, () => []);

  function place(node: RecipeNode, row: number, parentCol: number, path: string): void {
    const col = height(node);
    rows[row].push({
      node,
      path,
      row,
      col,
      colspan: parentCol - col,
      rowspan: leafCount(node),
    });
    if (node.kind === "step") {
      let r = row;
      node.children.forEach((child, i) => {
        place(child, r, col, `${path}.${i}`);
        r += leafCount(child);
      });
    }
  }

  place(root, 0, totalCols, "t");
  for (const row of rows) row.sort((a, b) => a.col - b.col);
  return { totalCols, totalRows, rows };
}

/** Resolve a data-path (e.g. "t.0.2") back to its node in the tree. */
export function nodeAtPath(recipe: RecipeTree, path: string): RecipeNode | undefined {
  const parts = path.split(".");
  if (parts[0] !== "t") return undefined;
  let node: RecipeNode = recipe.tree;
  for (const part of parts.slice(1)) {
    if (node.kind !== "step") return undefined;
    const child: RecipeNode | undefined = node.children[Number(part)];
    if (!child) return undefined;
    node = child;
  }
  return node;
}
