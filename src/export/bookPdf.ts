import { toCanvas } from "html-to-image";
import type { RecipeTree } from "../../shared/schema";
import { getCard, type AlbumRecord, type CardRecord } from "../album/store";
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
import { BUILD_ID } from "../buildId";
import { getTheme, hexRgb, type BookTheme } from "./bookThemes";
import { RASTER_OPTIONS, slugify } from "./image";
import { canvasRgb, type ExportedPdf } from "./pdf";
import { PdfWriter, type PageOptions } from "./pdfWriter";

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
/** Instructions column width when the photo sits to their right (spill layout). */
const NARROW_COL_FRACTION = 0.55;

const TOC_TITLE = "Contents";

function mountStage(widthPx: number, themeClass = ""): HTMLDivElement {
  const stage = document.createElement("div");
  stage.className = themeClass ? `book-stage ${themeClass}` : "book-stage";
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

async function rasterize(
  writer: PdfWriter,
  el: HTMLElement,
  options: typeof RASTER_OPTIONS,
): Promise<Rasterized> {
  const canvas = await toCanvas(el, options);
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
function measureInstructions(
  recipe: RecipeTree,
  stageWidthPx: number,
  themeClass: string,
): InstrMeasure {
  if (!recipe.instructions?.length) return { headerH: 0, itemHeights: [] };
  const stage = mountStage(stageWidthPx, themeClass);
  try {
    const instr = instructionsEl(recipe, 0, recipe.instructions.length);
    stage.appendChild(instr);
    // Bare rect heights: item spacing lives in the DOM (li padding-bottom in
    // .book-stage CSS), so the reserved slot matches the rendered raster and
    // the photo lands exactly GAP below the last line.
    const headerH = (instr.querySelector("h3")?.getBoundingClientRect().height ?? 0) * PT_PER_PX;
    const itemHeights = [...instr.querySelectorAll("li")].map(
      (li) => li.getBoundingClientRect().height * PT_PER_PX,
    );
    return { headerH, itemHeights };
  } finally {
    stage.remove();
  }
}

/** Measure one recipe's blocks on live offscreen stages (theme-styled — fonts
    change metrics, so measurement and rasterization share the same class). */
function measureRecipe(card: CardRecord, theme: BookTheme): MeasuredRecipe {
  const recipe = card.recipe!;
  const view = card.view ?? { ...INITIAL_VIEW };
  const stage = mountStage(STAGE_WIDTH_PX, theme.className);
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

  const stacked = measureInstructions(recipe, STAGE_WIDTH_PX, theme.className);

  // Side-by-side instructions: only for narrow tables with a readable column.
  let side: InstrMeasure | undefined;
  let sideColW: number | undefined;
  if (stacked.itemHeights.length && tableWpt <= CONTENT.w * SIDE_TABLE_MAX_FRACTION) {
    const colW = CONTENT.w - tableWpt - GAP;
    if (colW >= SIDE_MIN_COL_PT) {
      sideColW = colW;
      side = measureInstructions(recipe, Math.round(colW / PT_PER_PX), theme.className);
    }
  }

  // Capped-width instructions for the photo-right spill layout.
  let narrow: InstrMeasure | undefined;
  let narrowColW: number | undefined;
  if (stacked.itemHeights.length) {
    narrowColW = CONTENT.w * NARROW_COL_FRACTION;
    narrow = measureInstructions(recipe, Math.round(narrowColW / PT_PER_PX), theme.className);
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
      narrow,
      narrowColW,
    },
  };
}

/** Measure one TOC row and the TOC heading, from a representative sample. */
function measureToc(theme: BookTheme): { entryH: number; headerH: number } {
  const stage = mountStage(STAGE_WIDTH_PX, theme.className);
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

  const theme = getTheme(album.theme);
  const rasterOptions = { ...RASTER_OPTIONS, backgroundColor: theme.pageBg };
  const measured = included.map((card) => measureRecipe(card, theme));
  const toc = measureToc(theme);
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
    const bytes = await photoBytes(m.card);
    photoIndex.set(m.card.id, writer.addJpeg(bytes, m.card.imageW, m.card.imageH));
  }

  for (let p = 0; p < plan.pages.length; p++) {
    const pageNo = p + 1;
    const left = pageContentLeft(pageNo);
    const placements = [];
    const pageOptions: PageOptions = {};
    if (theme.pageBg !== "#ffffff") pageOptions.background = hexRgb(theme.pageBg);
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
        // Table stages get padding so nothing the capture might clip touches
        // the canvas edge: collapsed borders straddle the border box (their
        // outer half renders outside the element), and WebKit can lay out
        // the html-to-image clone slightly taller than the live element —
        // drift that grows with table height. The padding must be ADDED to
        // the explicit width (global border-box sizing would otherwise carve
        // it out and re-wrap cells narrower than the measurement pass saw).
        const TABLE_PAD_X = 4;
        const TABLE_PAD_BOTTOM = 16;
        const stage = mountStage(
          placed.kind === "table" && m
            ? Math.ceil(m.tableWpx) + TABLE_PAD_X * 2
            : placed.kind === "instructions"
              ? Math.round(placed.w / PT_PER_PX)
              : STAGE_WIDTH_PX,
          theme.className,
        );
        let raster: Rasterized;
        try {
          if (placed.kind === "table" && m) {
            stage.style.padding = `${TABLE_PAD_X}px ${TABLE_PAD_X}px ${TABLE_PAD_BOTTOM}px`;
          } else {
            // Text blocks can also end in a rule at the exact canvas edge
            // (e.g. the TOC's last underline) — same clip risk, same guard.
            // Vertical only, so the explicit width (border-box) is untouched.
            stage.style.paddingBottom = "12px";
          }
          if (placed.kind === "title") stage.appendChild(titlePageEl(album));
          else if (placed.kind === "toc") stage.appendChild(tocEl(tocEntries, placed.from!, placed.to!));
          else if (placed.kind === "heading" && m)
            stage.appendChild(headingEl(m.recipe, placed.continued ?? false));
          else if (placed.kind === "table" && m) stage.appendChild(tableEl(m));
          else if (placed.kind === "instructions" && m)
            stage.appendChild(instructionsEl(m.recipe, placed.from!, placed.to!));
          raster = await rasterize(writer, stage, rasterOptions);
        } finally {
          stage.remove();
        }
        image = raster.image;
        if (placed.kind === "table" && m) {
          // Aspect-true: derive the height from the ACTUAL canvas rather
          // than assuming capture height == measured height (WebKit drift).
          // The blank padding bleeds a few pt into the following gap —
          // background-colored, invisible — instead of squeezing the table.
          const scale = m.tableWpt / (raster.wPx * PT_PER_PX);
          w = m.tableWpt;
          h = raster.hPx * PT_PER_PX * scale;
        } else {
          // Aspect-true, top-anchored: never stretch or crop the raster.
          // It may run slightly past the reserved slot (blank guard padding
          // and any clone-layout drift) — the inter-block gaps absorb it.
          const scale = Math.min(1, placed.w / (raster.wPx * PT_PER_PX));
          w = raster.wPx * PT_PER_PX * scale;
          h = Math.min(raster.hPx * PT_PER_PX * scale, placed.h + 16);
        }
      }
      const pdfX = left + x;
      // Flip from top-based content coordinates to PDF's bottom-left origin.
      const pdfY = PAGE.h - MARGIN.top - placed.y - h;
      if (placed.kind === "photo" && theme.photoFrame) {
        (pageOptions.frames ??= []).push({
          x: pdfX,
          y: pdfY,
          w,
          h,
          color: hexRgb(theme.photoFrame.color),
          width: theme.photoFrame.width,
        });
      }
      placements.push({ image, x: pdfX, y: pdfY, w, h });
    }
    writer.addPage(PAGE.w, PAGE.h, placements, pageOptions);
  }

  return {
    blob: writer.finish(album.title, `Recipe Tabulator ${BUILD_ID} (${theme.id})`),
    filename: `${slugify(album.title)}.pdf`,
  };
}

/** Read a card photo's bytes. On failure, re-read the card from the store —
    a fresh IndexedDB read returns a fresh handle, the workaround for
    WebKit's stale file-backed blobs ("The object can not be found here."
    in legacy albums); new albums store bytes inline and can't go stale. */
async function photoBytes(card: CardRecord): Promise<Uint8Array<ArrayBuffer>> {
  let blob = card.image;
  for (let attempt = 0; ; attempt++) {
    try {
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      if (attempt >= 2) {
        throw new Error(
          `Couldn't read the photo for "${card.recipe?.title ?? "a recipe"}" — close and reopen the album, then try again.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      blob = (await getCard(card.id))?.image ?? blob;
    }
  }
}

/** Effective print DPI of a card photo at its placed size — warn below ~300. */
export function photoPrintDpi(card: CardRecord): number {
  const box = photoBox({ w: card.imageW, h: card.imageH });
  return Math.round(card.imageW / (box.w / 72));
}
