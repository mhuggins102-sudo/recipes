import type { RecipeTree } from "../../shared/schema";
import { briefLabel } from "../labels";
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

export function renderTable(
  recipe: RecipeTree,
  labelMode: "full" | "brief" = "full",
): HTMLTableElement {
  const grid = layout(recipe);
  const table = el("table", "recipe-table");
  const tbody = el("tbody");
  table.appendChild(tbody);

  // Brief mode is a lossy display of the label, so the span is read-only
  // (an edit would overwrite the full text) and shows the full label on hover.
  const labelSpan = (text: string): HTMLSpanElement => {
    const brief = labelMode === "brief" ? briefLabel(text) : text;
    const span = el("span", "label", brief);
    span.dataset.field = "label";
    if (brief !== text) {
      span.title = `${text} — switch Steps to Full to edit`;
      span.dataset.readonly = "1";
    }
    return span;
  };

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
        td.appendChild(labelSpan(cell.node.label));
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
    td.appendChild(labelSpan(finish.node.label));
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
