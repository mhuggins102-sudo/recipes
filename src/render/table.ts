import type { RecipeTree } from "../../shared/schema";
import { layout } from "./layout";

// Grid -> DOM. Every editable region carries a data-path attribute:
//   "title", "servings", "setup.N", "notes.N" and tree paths "t", "t.0.2", ...
// Ingredient cells expose quantity/name/note as separate editable spans via
// data-field, so the editor can write each back independently.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderTable(recipe: RecipeTree): HTMLTableElement {
  const grid = layout(recipe);
  const table = el("table", "recipe-table");
  const tbody = el("tbody");
  table.appendChild(tbody);

  const titleRow = el("tr", "title-row");
  const titleCell = el("th");
  titleCell.colSpan = grid.totalCols;
  const titleSpan = el("span", "title-text", recipe.title);
  titleSpan.dataset.path = "title";
  titleCell.appendChild(titleSpan);
  if (recipe.servings) {
    const servings = el("span", "servings", recipe.servings);
    servings.dataset.path = "servings";
    titleCell.append(" — ", servings);
  }
  titleRow.appendChild(titleCell);
  tbody.appendChild(titleRow);

  recipe.setup.forEach((step, i) => {
    const tr = el("tr", "setup-row");
    const td = el("td", "setup", step);
    td.colSpan = grid.totalCols;
    td.dataset.path = `setup.${i}`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  });

  for (const rowCells of grid.rows) {
    const tr = el("tr");
    for (const cell of rowCells) {
      const td = el("td");
      td.colSpan = cell.colspan;
      td.rowSpan = cell.rowspan;
      td.dataset.path = cell.path;
      if (cell.node.kind === "ingredient") {
        td.className = "ingredient";
        const qty = el("span", "qty", cell.node.quantity);
        qty.dataset.field = "quantity";
        const name = el("span", "name", cell.node.name);
        name.dataset.field = "name";
        td.append(qty, " ", name);
        if (cell.node.note) {
          const note = el("span", "note", `(${cell.node.note})`);
          note.dataset.field = "note";
          td.append(" ", note);
        }
      } else {
        td.className = "step";
        const label = el("span", "label", cell.node.label);
        label.dataset.field = "label";
        td.appendChild(label);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  for (const finish of grid.finishing) {
    const tr = el("tr", "finish-row");
    const td = el("td", "finish");
    td.colSpan = grid.totalCols;
    td.dataset.path = finish.path;
    const label = el("span", "label", finish.node.label);
    label.dataset.field = "label";
    td.appendChild(label);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  recipe.notes?.forEach((note, i) => {
    const tr = el("tr", "notes-row");
    const td = el("td", "notes", note);
    td.colSpan = grid.totalCols;
    td.dataset.path = `notes.${i}`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  });

  return table;
}
