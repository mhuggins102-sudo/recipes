import type { RecipeTree } from "../../shared/schema";
import { nodeAtPath } from "../render/layout";

// Inline editing: every editable region rendered by table.ts carries
// data-path (and data-field for ingredient/step sub-fields). Text edits are
// written straight back into the recipe object on input — the table is never
// re-rendered during typing, so the caret is preserved.

const EDITABLE_SELECTOR = "[data-field], [data-path='title'], [data-path='servings'], td.setup, td.notes";

/** Which kind of value an edit touched — lets the caller normalize scaled quantities. */
export type EditKind = "quantity" | "servings" | "other";

export function enableInlineEditing(
  container: HTMLElement,
  getRecipe: () => RecipeTree,
  onChange: (recipe: RecipeTree) => void,
  mapText: (text: string, kind: EditKind) => string = (text) => text,
): void {
  for (const el of container.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR)) {
    // Firefox doesn't support "plaintext-only"; fall back to true there.
    el.setAttribute("contenteditable", "plaintext-only");
    if (!el.isContentEditable) el.setAttribute("contenteditable", "true");
    el.spellcheck = false;
  }

  container.addEventListener("input", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[contenteditable]");
    if (!target) return;
    const recipe = getRecipe();
    if (writeBack(recipe, target, mapText)) onChange(recipe);
  });

  // Keep pasted content plain even where "plaintext-only" isn't supported.
  container.addEventListener("paste", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[contenteditable]");
    if (!target) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text);
  });
}

function writeBack(
  recipe: RecipeTree,
  el: HTMLElement,
  mapText: (text: string, kind: EditKind) => string,
): boolean {
  const text = (el.textContent ?? "").trim();
  const field = el.dataset.field;
  if (field) {
    const path = el.closest<HTMLElement>("[data-path]")?.dataset.path;
    if (!path) return false;
    const node = nodeAtPath(recipe, path);
    if (!node) return false;
    if (node.kind === "ingredient") {
      if (field === "quantity") node.quantity = mapText(text, "quantity");
      else if (field === "name") node.name = text;
      else if (field === "note") node.note = text.replace(/^\(/, "").replace(/\)$/, "");
      else return false;
    } else {
      if (field !== "label") return false;
      node.label = text;
    }
    return true;
  }

  const path = el.dataset.path;
  if (!path) return false;
  if (path === "title") {
    recipe.title = text;
    return true;
  }
  if (path === "servings") {
    recipe.servings = mapText(text, "servings");
    return true;
  }
  const setupMatch = /^setup\.(\d+)$/.exec(path);
  if (setupMatch) {
    recipe.setup[Number(setupMatch[1])] = text;
    return true;
  }
  const notesMatch = /^notes\.(\d+)$/.exec(path);
  if (notesMatch && recipe.notes) {
    recipe.notes[Number(notesMatch[1])] = text;
    return true;
  }
  return false;
}
