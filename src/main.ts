import "./styles/main.css";
import "./styles/print.css";
import { RecipeTreeZ, type RecipeTree } from "../shared/schema";
import { convert, type ConvertRequest } from "./api";
import { downloadFile, exportTableImage, shareImage } from "./export/image";
import { exportTablePdf } from "./export/pdf";
import { setupPrintFit } from "./print";
import { applyView, unscaleQuantity } from "./quantity";
import { renderTable } from "./render/table";
import { SAMPLE_RECIPE } from "./sample";
import { enableInlineEditing } from "./ui/editor";
import { createInputPanel } from "./ui/inputPanel";
import {
  getRecent,
  listRecents,
  removeRecent,
  saveRecent,
  toggleFavorite,
  touchRecent,
  updateRecent,
} from "./ui/recents";
import { createViewBar } from "./ui/viewBar";

const app = document.getElementById("app")!;

// --- Static chrome ---------------------------------------------------------

const header = document.createElement("header");
header.className = "site";
header.innerHTML = `<h1>📐 Recipe Tabulator</h1>
  <span class="tagline">any recipe → the "Cooking for Engineers" table</span>`;

const errorBox = document.createElement("div");
errorBox.className = "error-box";
errorBox.style.display = "none";

const panel = createInputPanel(startConversion, showError);

const resultSection = document.createElement("section");
resultSection.style.display = "none";

const toolbar = document.createElement("div");
toolbar.className = "toolbar";
const saveImgBtn = button("ghost", "Save image");
const savePdfBtn = button("ghost", "Save PDF");
const shareBtn = button("ghost", "Share");
const printBtn = button("ghost", "Print");
const resetBtn = button("ghost", "Start over");
toolbar.append(saveImgBtn, savePdfBtn, shareBtn, printBtn, resetBtn);

// Edit JSON lives below the table — it's a restructuring tool, not a daily action.
const belowToolbar = document.createElement("div");
belowToolbar.className = "toolbar";
const jsonBtn = button("ghost", "Edit JSON");
belowToolbar.append(jsonBtn);

const viewBar = createViewBar(() => rerenderTable());

const tableWrap = document.createElement("div");
tableWrap.className = "table-wrap";

const jsonEditor = document.createElement("textarea");
jsonEditor.className = "json-editor";
jsonEditor.style.display = "none";
const jsonApply = button("primary", "Apply JSON");
jsonApply.style.display = "none";
const jsonError = document.createElement("p");
jsonError.className = "hint";

const hint = document.createElement("p");
hint.className = "hint";
hint.textContent =
  "Every cell is editable — click into it and type. Use Edit JSON to restructure the tree (move ingredients between steps, add branches).";

resultSection.append(toolbar, viewBar.el, tableWrap, hint, belowToolbar, jsonEditor, jsonApply, jsonError);

const recentsSection = document.createElement("section");
recentsSection.className = "recents";

app.append(header, errorBox, panel.el, resultSection, recentsSection);

// --- State -----------------------------------------------------------------

let current: RecipeTree | null = null;
let currentId: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function button(cls: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  return b;
}

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.style.display = "";
}

function clearError() {
  errorBox.style.display = "none";
}

const PHASE_TEXT: Record<string, string> = {
  fetching: "Fetching the page…",
  archive: "Site blocks robots — trying the Internet Archive…",
  print: "Busy page — reading its print version instead…",
  model: "Reading the recipe and building the tree…",
  revalidating: "Double-checking the structure…",
};

async function startConversion(req: ConvertRequest) {
  clearError();
  const started = Date.now();
  let phaseText = req.type === "url" ? PHASE_TEXT.fetching : PHASE_TEXT.model;
  const showStatus = () =>
    panel.setBusy(true, `${phaseText} ${Math.round((Date.now() - started) / 1000)}s`);
  showStatus();
  const ticker = setInterval(showStatus, 1000);
  try {
    const recipe = await convert(req, (phase) => {
      phaseText = PHASE_TEXT[phase] ?? phaseText;
      showStatus();
    });
    currentId = saveRecent(recipe);
    show(recipe);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    clearInterval(ticker);
    panel.setBusy(false);
    renderRecents();
  }
}

function show(recipe: RecipeTree) {
  current = recipe;
  viewBar.resetScale();
  resultSection.style.display = "";
  jsonEditor.style.display = "none";
  jsonApply.style.display = "none";
  jsonError.textContent = "";
  jsonBtn.textContent = "Edit JSON";
  rerenderTable();
}

function rerenderTable() {
  if (!current) return;
  tableWrap.innerHTML = "";
  // Render a derived view; `current` stays at 1× in the source's own style.
  tableWrap.appendChild(renderTable(applyView(current, viewBar.view), viewBar.view.labels));
  enableInlineEditing(tableWrap, () => current!, persistSoon, (text, kind) =>
    kind === "quantity" || kind === "servings" ? unscaleQuantity(text, viewBar.view) : text,
  );
}

function persistSoon(recipe: RecipeTree) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (currentId) updateRecent(currentId, recipe);
  }, 800);
}

// --- Toolbar ---------------------------------------------------------------

jsonBtn.addEventListener("click", () => {
  if (!current) return;
  const open = jsonEditor.style.display === "none";
  if (open) {
    jsonEditor.value = JSON.stringify(current, null, 2);
    jsonEditor.style.display = "";
    jsonApply.style.display = "";
    jsonBtn.textContent = "Hide JSON";
  } else {
    jsonEditor.style.display = "none";
    jsonApply.style.display = "none";
    jsonBtn.textContent = "Edit JSON";
    jsonError.textContent = "";
  }
});

jsonApply.addEventListener("click", () => {
  try {
    const parsed = RecipeTreeZ.parse(JSON.parse(jsonEditor.value));
    current = parsed;
    if (currentId) updateRecent(currentId, parsed);
    jsonError.textContent = "Applied.";
    rerenderTable();
  } catch (err) {
    jsonError.textContent = `Invalid: ${err instanceof Error ? err.message : String(err)}`;
  }
});

async function exportCurrent(): Promise<ReturnType<typeof exportTableImage> | null> {
  if (!current) return null;
  // Export what's on screen: same derived view (units, scale, brief labels).
  return exportTableImage(applyView(current, viewBar.view), viewBar.view.labels);
}

/** Wrap an export action with the busy label / disable / error plumbing. */
function busyWhile(btn: HTMLButtonElement, action: () => Promise<void>): () => Promise<void> {
  return async () => {
    const label = btn.textContent;
    btn.textContent = "Rendering…";
    btn.disabled = true;
    try {
      await action();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      btn.textContent = label;
      btn.disabled = false;
    }
  };
}

saveImgBtn.addEventListener(
  "click",
  busyWhile(saveImgBtn, async () => {
    const image = await exportCurrent();
    if (image) downloadFile(image.blob, image.filename);
  }),
);

savePdfBtn.addEventListener(
  "click",
  busyWhile(savePdfBtn, async () => {
    if (!current) return;
    const pdf = await exportTablePdf(applyView(current, viewBar.view), viewBar.view.labels);
    downloadFile(pdf.blob, pdf.filename);
  }),
);

shareBtn.addEventListener(
  "click",
  busyWhile(shareBtn, async () => {
    const image = await exportCurrent();
    if (image && !(await shareImage(image, current?.title ?? "Recipe"))) {
      // No native share sheet on this device/browser — download instead.
      downloadFile(image.blob, image.filename);
    }
  }),
);

printBtn.addEventListener("click", () => window.print());

setupPrintFit(() => tableWrap.querySelector("table.recipe-table"));

resetBtn.addEventListener("click", () => {
  current = null;
  currentId = null;
  resultSection.style.display = "none";
  clearError();
  renderRecents();
  window.scrollTo({ top: 0 });
});

// --- Recents / demo --------------------------------------------------------

const RECENTS_COLLAPSED_COUNT = 10;
let recentsExpanded = false;

function renderRecents() {
  const entries = listRecents();
  recentsSection.innerHTML = "";
  const h2 = document.createElement("h2");
  h2.textContent = entries.length ? "Recent conversions" : "Example";
  recentsSection.appendChild(h2);
  const ul = document.createElement("ul");

  if (!entries.length) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Espresso Brownies (the table that inspired this site)";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      currentId = null;
      show(structuredClone(SAMPLE_RECIPE));
    });
    li.appendChild(a);
    ul.appendChild(li);
  }

  // Favorites pin to the top; within each group, most recently added or
  // viewed first (stored order — viewing an entry moves it to the front).
  const ordered = [...entries.filter((e) => e.fav), ...entries.filter((e) => !e.fav)];
  const visible = recentsExpanded ? ordered : ordered.slice(0, RECENTS_COLLAPSED_COUNT);

  for (const entry of visible) {
    const li = document.createElement("li");
    const star = document.createElement("button");
    star.className = entry.fav ? "star faved" : "star";
    star.textContent = entry.fav ? "★" : "☆";
    star.title = entry.fav ? "Unpin from the top of this list" : "Pin to the top of this list";
    star.addEventListener("click", () => {
      toggleFavorite(entry.id);
      renderRecents();
    });
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = entry.title;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const recipe = getRecent(entry.id);
      if (recipe) {
        currentId = entry.id;
        touchRecent(entry.id);
        show(recipe);
        renderRecents();
      }
    });
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = new Date(entry.ts).toLocaleDateString();
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.title = "Delete this recipe";
    del.addEventListener("click", () => {
      if (!confirm(`Delete "${entry.title}"? This can't be undone.`)) return;
      removeRecent(entry.id);
      if (currentId === entry.id) currentId = null;
      renderRecents();
    });
    li.append(star, a, when, del);
    ul.appendChild(li);
  }
  recentsSection.appendChild(ul);

  if (ordered.length > RECENTS_COLLAPSED_COUNT) {
    const more = document.createElement("button");
    more.className = "linkish";
    more.textContent = recentsExpanded
      ? "Show fewer"
      : `Show all (${ordered.length})`;
    more.addEventListener("click", () => {
      recentsExpanded = !recentsExpanded;
      renderRecents();
    });
    recentsSection.appendChild(more);
  }
}

renderRecents();
