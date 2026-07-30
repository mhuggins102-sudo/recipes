import type { RecipeTree } from "../../shared/schema";

/**
 * The classic numbered directions, for step-by-step readers. Each item carries
 * data-path so the inline editor can write edits back (see ui/editor.ts).
 * Returns null when the recipe has no instructions (pre-feature conversions).
 */
export function renderInstructions(recipe: RecipeTree): HTMLElement | null {
  if (!recipe.instructions?.length) return null;
  const section = document.createElement("section");
  section.className = "instructions";
  const heading = document.createElement("h3");
  heading.textContent = "Instructions";
  const ol = document.createElement("ol");
  recipe.instructions.forEach((step, i) => {
    const li = document.createElement("li");
    li.textContent = step;
    li.dataset.path = `instructions.${i}`;
    ol.appendChild(li);
  });
  section.append(heading, ol);
  return section;
}
