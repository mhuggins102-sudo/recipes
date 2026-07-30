import { toCanvas } from "html-to-image";
import type { RecipeTree } from "../../shared/schema";
import type { AlbumRecord, CardRecord } from "../album/store";
import { applyView, type ViewOptions } from "../quantity";
import { renderTable } from "../render/table";
import { INITIAL_VIEW } from "../ui/viewBar";
import {
  CONTENT,
  GAP,
  MARGIN,
  PAGE,
  PT_PER_PX,
  STAGE_WIDTH_PX,
  pageContentLeft,
  photoBox,
  planBook,
  type InstrMeasure,
  type RecipeMeasure,
} from "./bookLayout";
import { RASTER_OPTIONS, slugify } from "./image";
import { canvasRgb, type ExportedPdf } from "./pdf";
import { PdfWriter } from "./pdfWriter";

// Cookbook generator: measure every recipe's blocks, plan pages (pure math in
// bookLayout.ts), then rasterize block-by-block and assemble with PdfWriter.
// Photos embed as their stored JPEG bytes — never re-rasterized.

interface MeasuredRecipe {
  card: CardRecord;
  recipe: RecipeTree;
  view: ViewOptions;
  /** Natural table width in CSS px (raster stage width). */
  tableWpx: number;
  /** Placed size in pt (aspect-fit to the content box). */
  tableWpt: number;
  tableHpt: number;
  measure: RecipeMeasure;
}

/** Side-by-side instructions become an option below this table width. */
const SIDE_TABLE_MAX_FRACTION = 0.58;
/** …and only when the instructions column keeps a readable width. */
const SIDE_MIN_COL_PT = 150;
/** Extra breathing room added per measured instruction item, pt. */
const ITEM_SPACING_PT = 6;

const TOC_TITLE = "Contents";

function mountStage(widthPx: number): HTMLDivElement {
  const stage = document.createElement("div");
  stage.className = "book-stage";
  stage.style.width = `${widthPx}px`;
  document.body.appendChild(stage);
  return stage;
}

interface Rasterized {
  image: number;
  /** Natural raster size in CSS px (canvas px / pixelRatio). */
  wPx: number;
  hPx: number;
}

async function rasterize(writer: PdfWriter, el: HTMLElement): Promise<Rasterized> {
  const canvas = await toCanvas(el, RASTER_OPTIONS);
  const image = await writer.addRgb(canvasRgb(canvas), canvas.width, canvas.height);
  const result = {
    image,
    wPx: canvas.width / RASTER_OPTIONS.pixelRatio,
    hPx: canvas.height / RASTER_OPTIONS.pixelRatio,
  };
  canvas.width = 0; // release the bitmap eagerly — books rasterize many blocks
  return result;
}

function headingEl(recipe: RecipeTree, continued: boolean): HTMLElement {
  const h = document.createElement("h2");
  h.className = "book-heading";
  h.textContent = continued ? `${recipe.title}, continued` : recipe.title;
  return h;
}

function tableEl(m: MeasuredRecipe): HTMLElement {
  return renderTable(applyView(m.recipe, m.view), m.view.labels);
}

/**
 * Book-stage instructions with EXPLICIT number spans instead of native <ol>
 * markers: Safari mispositions list markers inside html-to-image's SVG
 * foreignObject rendering (numbers came out clipped at the left edge of the
 * page), and plain text nodes rasterize identically in every browser.
 */
function instructionsEl(recipe: RecipeTree, from: number, to: number): HTMLElement {
  const section = document.createElement("section");
  section.className = "instructions";
  if (from === 0) {
    const h3 = document.createElement("h3");
    h3.textContent = "Instructions";
    section.appendChild(h3);
  }
  const ul = document.createElement("ul");
  (recipe.instructions ?? []).slice(from, to).forEach((step, i) => {
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `${from + i + 1}.`;
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = step;
    li.append(num, txt);
    ul.appendChild(li);
  });
  section.appendChild(ul);
  return section;
}

function titlePageEl(album: AlbumRecord): HTMLElement {
  const div = document.createElement("div");
  div.className = "book-title-page";
  div.style.height = `${Math.round(CONTENT.h / PT_PER_PX)}px`;
  const h1 = document.createElement("h1");
  h1.textContent = album.title;
  div.appendChild(h1);
  if (album.author) {
    const by = document.createElement("p");
    by.className = "book-author";
    by.textContent = album.author;
    div.appendChild(by);
  }
  const brand = document.createElement("p");
  brand.className = "book-brand";
  brand.textContent = "📐 Recipe Tabulator";
  div.appendChild(brand);
  return div;
}

function tocEl(
  entries: { title: string; page: number }[],
  from: number,
  to: number,
): HTMLElement {
  const div = document.createElement("div");
  div.className = "book-toc";
  const h2 = document.createElement("h2");
  h2.className = "book-heading";
  h2.textContent = TOC_TITLE;
  div.appendChild(h2);
  const ul = document.createElement("ul");
  for (const entry of entries.slice(from, to)) {
    const li = document.createElement("li");
    const title = document.createElement("span");
    title.className = "toc-title";
    title.textContent = entry.title;
    const page = document.createElement("span");
    page.className = "toc-page";
    page.textContent = String(entry.page);
    li.append(title, page);
    ul.appendChild(li);
  }
  div.appendChild(ul);
  return div;
}

/** Measure an instructions block rendered at the given stage width. */
function measureInstructions(recipe: RecipeTree, stageWidthPx: number): InstrMeasure {
  if (!recipe.instructions?.length) return { headerH: 0, itemHeights: [] };
  const stage = mountStage(stageWidthPx);
  try {
    const instr = instructionsEl(recipe, 0, recipe.instructions.length);
    stage.appendChild(instr);
    const headerH = (instr.querySelector("h3")?.getBoundingClientRect().height ?? 0) * PT_PER_PX;
    const itemHeights = [...instr.querySelectorAll("li")].map(
      (li) => li.getBoundingClientRect().height * PT_PER_PX + ITEM_SPACING_PT,
    );
    return { headerH, itemHeights };
  } finally {
    stage.remove();
  }
}

/** Measure one recipe's blocks on live offscreen stages. */
function measureRecipe(card: CardRecord): MeasuredRecipe {
  const recipe = card.recipe!;
  const view = card.view ?? { ...INITIAL_VIEW };
  const stage = mountStage(STAGE_WIDTH_PX);
  let tableWpx: number;
  let tableWpt: number;
  let tableHpt: number;
  let headingHpt: number;
  try {
    // The book table renders at its natural width (width:auto in .book-stage),
    // so narrow recipes get narrow tables instead of full-page ones.
    const table = renderTable(applyView(recipe, view), view.labels);
    const heading = headingEl(recipe, true);
    stage.append(heading, table);

    const tableRect = table.getBoundingClientRect();
    tableWpx = Math.max(tableRect.width, table.scrollWidth);
    // Aspect-fit into the content box (wide tables shrink to fit).
    tableWpt = Math.min(CONTENT.w, tableWpx * PT_PER_PX);
    tableHpt = tableRect.height * PT_PER_PX * (tableWpt / (tableWpx * PT_PER_PX));
    if (tableHpt > CONTENT.h) {
      tableWpt = (CONTENT.h / tableHpt) * tableWpt;
      tableHpt = CONTENT.h;
    }
    headingHpt = heading.getBoundingClientRect().height * PT_PER_PX;
  } finally {
    stage.remove();
  }

  const stacked = measureInstructions(recipe, STAGE_WIDTH_PX);

  // Side-by-side instructions: only for narrow tables with a readable column.
  let side: InstrMeasure | undefined;
  let sideColW: number | undefined;
  if (stacked.itemHeights.length && tableWpt <= CONTENT.w * SIDE_TABLE_MAX_FRACTION) {
    const colW = CONTENT.w - tableWpt - GAP;
    if (colW >= SIDE_MIN_COL_PT) {
      sideColW = colW;
      side = measureInstructions(recipe, Math.round(colW / PT_PER_PX));
    }
  }

  return {
    card,
    recipe,
    view,
    tableWpx,
    tableWpt,
    tableHpt,
    measure: {
      photo: { w: card.imageW, h: card.imageH },
      tableW: tableWpt,
      tableH: tableHpt,
      headingH: headingHpt,
      stacked,
      side,
      sideColW,
    },
  };
}

/** Measure one TOC row and the TOC heading, from a representative sample. */
function measureToc(): { entryH: number; headerH: number } {
  const stage = mountStage(STAGE_WIDTH_PX);
  try {
    const sample = tocEl([{ title: "Sample recipe title", page: 100 }], 0, 1);
    stage.appendChild(sample);
    const headerH = sample.querySelector("h2")!.getBoundingClientRect().height * PT_PER_PX;
    const entryH = sample.querySelector("li")!.getBoundingClientRect().height * PT_PER_PX + 4;
    return { entryH, headerH: headerH + GAP };
  } finally {
    stage.remove();
  }
}

export async function exportCookbookPdf(
  album: AlbumRecord,
  cards: CardRecord[],
): Promise<ExportedPdf> {
  const included = cards.filter((c) => c.included && c.state === "done" && c.recipe);
  if (!included.length) throw new Error("No converted recipes are included in the book.");

  const measured = included.map(measureRecipe);
  const toc = measureToc();
  const plan = planBook({
    toc: album.includeToc,
    tocEntryH: toc.entryH,
    tocHeaderH: toc.headerH,
    recipes: measured.map((m) => m.measure),
  });

  const tocEntries = measured.map((m, i) => ({
    title: m.recipe.title,
    page: plan.recipeStartPage[i],
  }));

  const writer = new PdfWriter();
  // One JPEG XObject per card, shared across pages that show it.
  const photoIndex = new Map<string, number>();
  for (const m of measured) {
    const bytes = new Uint8Array(await m.card.image.arrayBuffer());
    photoIndex.set(m.card.id, writer.addJpeg(bytes, m.card.imageW, m.card.imageH));
  }

  for (let p = 0; p < plan.pages.length; p++) {
    const pageNo = p + 1;
    const left = pageContentLeft(pageNo);
    const placements = [];
    for (const placed of plan.pages[p].placements) {
      const m = placed.recipe !== undefined ? measured[placed.recipe] : undefined;
      let image: number;
      let w = placed.w;
      let h = placed.h;
      const x = placed.x;
      if (placed.kind === "photo" && m) {
        // Draw at the PLAN's box — it may be smaller than the ceiling size
        // (fit-to-page); drawing bigger is how photos once overlapped tables.
        image = photoIndex.get(m.card.id)!;
      } else {
        // Rasterize the block on a fresh stage (memory-friendly: one at a
        // time) at the width the plan reserved for it — instructions may be
        // a side column, tables their natural width.
        const stage = mountStage(
          placed.kind === "table" && m
            ? Math.ceil(m.tableWpx)
            : placed.kind === "instructions"
              ? Math.round(placed.w / PT_PER_PX)
              : STAGE_WIDTH_PX,
        );
        let raster: Rasterized;
        try {
          if (placed.kind === "title") stage.appendChild(titlePageEl(album));
          else if (placed.kind === "toc") stage.appendChild(tocEl(tocEntries, placed.from!, placed.to!));
          else if (placed.kind === "heading" && m)
            stage.appendChild(headingEl(m.recipe, placed.continued ?? false));
          else if (placed.kind === "table" && m) stage.appendChild(tableEl(m));
          else if (placed.kind === "instructions" && m)
            stage.appendChild(instructionsEl(m.recipe, placed.from!, placed.to!));
          raster = await rasterize(writer, stage);
        } finally {
          stage.remove();
        }
        image = raster.image;
        if (placed.kind === "table" && m) {
          w = m.tableWpt;
          h = m.tableHpt;
        } else {
          // Draw at the raster's natural size (top-anchored in its slot) —
          // the reserved slot includes inter-item spacing the DOM doesn't,
          // and drawing into it verbatim would stretch the text vertically.
          const scale = Math.min(1, placed.w / (raster.wPx * PT_PER_PX));
          w = raster.wPx * PT_PER_PX * scale;
          h = Math.min(placed.h, raster.hPx * PT_PER_PX * scale);
        }
      }
      placements.push({
        image,
        x: left + x,
        // Flip from top-based content coordinates to PDF's bottom-left origin.
        y: PAGE.h - MARGIN.top - placed.y - h,
        w,
        h,
      });
    }
    writer.addPage(PAGE.w, PAGE.h, placements);
  }

  return { blob: writer.finish(album.title), filename: `${slugify(album.title)}.pdf` };
}

/** Effective print DPI of a card photo at its placed size — warn below ~300. */
export function photoPrintDpi(card: CardRecord): number {
  const box = photoBox({ w: card.imageW, h: card.imageH });
  return Math.round(card.imageW / (box.w / 72));
}
