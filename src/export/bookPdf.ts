import { toCanvas } from "html-to-image";
import type { RecipeTree } from "../../shared/schema";
import type { AlbumRecord, CardRecord } from "../album/store";
import { applyView, type ViewOptions } from "../quantity";
import { renderInstructions } from "../render/instructions";
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
  /** Natural table size in CSS px (width may exceed the stage for wide tables). */
  tableW: number;
  tableHNatural: number;
  /** Placed size in pt (aspect-fit to the content box). */
  tableWpt: number;
  tableHpt: number;
  measure: RecipeMeasure;
}

const TOC_TITLE = "Contents";

function mountStage(widthPx: number): HTMLDivElement {
  const stage = document.createElement("div");
  stage.className = "book-stage";
  stage.style.width = `${widthPx}px`;
  document.body.appendChild(stage);
  return stage;
}

async function rasterize(writer: PdfWriter, el: HTMLElement): Promise<number> {
  const canvas = await toCanvas(el, RASTER_OPTIONS);
  const index = await writer.addRgb(canvasRgb(canvas), canvas.width, canvas.height);
  canvas.width = 0; // release the bitmap eagerly — books rasterize many blocks
  return index;
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

function instructionsEl(m: MeasuredRecipe, from: number, to: number): HTMLElement {
  const section = document.createElement("section");
  section.className = "instructions";
  if (from === 0) {
    const h3 = document.createElement("h3");
    h3.textContent = "Instructions";
    section.appendChild(h3);
  }
  const ol = document.createElement("ol");
  ol.start = from + 1;
  for (const step of (m.recipe.instructions ?? []).slice(from, to)) {
    const li = document.createElement("li");
    li.textContent = step;
    ol.appendChild(li);
  }
  section.appendChild(ol);
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

/** Measure one recipe's blocks on a live offscreen stage. */
function measureRecipe(card: CardRecord): MeasuredRecipe {
  const recipe = card.recipe!;
  const view = card.view ?? { ...INITIAL_VIEW };
  const stage = mountStage(STAGE_WIDTH_PX);
  try {
    const table = renderTable(applyView(recipe, view), view.labels);
    const heading = headingEl(recipe, true);
    const instr = renderInstructions(recipe);
    stage.append(heading, table);
    if (instr) stage.appendChild(instr);

    const tableRect = table.getBoundingClientRect();
    const tableW = Math.max(tableRect.width, table.scrollWidth);
    const tableHNatural = tableRect.height;
    // Aspect-fit the table into the content box (wide tables shrink).
    let tableWpt = CONTENT.w;
    let tableHpt = (tableHNatural / Math.max(tableW, STAGE_WIDTH_PX)) * CONTENT.w;
    if (tableHpt > CONTENT.h) {
      tableWpt = (CONTENT.h / tableHpt) * CONTENT.w;
      tableHpt = CONTENT.h;
    }

    const itemHpts: number[] = [];
    let instrHeaderHpt = 0;
    if (instr) {
      const h3 = instr.querySelector("h3");
      instrHeaderHpt = (h3?.getBoundingClientRect().height ?? 0) * PT_PER_PX;
      for (const li of instr.querySelectorAll("li")) {
        itemHpts.push(li.getBoundingClientRect().height * PT_PER_PX);
      }
    }

    return {
      card,
      recipe,
      view,
      tableW,
      tableHNatural,
      tableWpt,
      tableHpt,
      measure: {
        photo: { w: card.imageW, h: card.imageH },
        tableH: tableHpt,
        headingH: heading.getBoundingClientRect().height * PT_PER_PX,
        instrHeaderH: instrHeaderHpt,
        itemHeights: itemHpts.map((h) => h + 6), // + item spacing in pt
      },
    };
  } finally {
    stage.remove();
  }
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
      let x = placed.x;
      if (placed.kind === "photo" && m) {
        image = photoIndex.get(m.card.id)!;
        const box = photoBox({ w: m.card.imageW, h: m.card.imageH });
        w = box.w;
        h = box.h;
        x = box.x;
      } else {
        // Rasterize the block on a fresh stage (memory-friendly: one at a time).
        const stage = mountStage(
          placed.kind === "table" && m ? Math.ceil(Math.max(m.tableW, STAGE_WIDTH_PX)) : STAGE_WIDTH_PX,
        );
        try {
          if (placed.kind === "title") stage.appendChild(titlePageEl(album));
          else if (placed.kind === "toc") stage.appendChild(tocEl(tocEntries, placed.from!, placed.to!));
          else if (placed.kind === "heading" && m)
            stage.appendChild(headingEl(m.recipe, placed.continued ?? false));
          else if (placed.kind === "table" && m) stage.appendChild(tableEl(m));
          else if (placed.kind === "instructions" && m)
            stage.appendChild(instructionsEl(m, placed.from!, placed.to!));
          image = await rasterize(writer, stage);
        } finally {
          stage.remove();
        }
        if (placed.kind === "table" && m) {
          w = m.tableWpt;
          h = m.tableHpt;
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

/** Table shrink factor for the book page — warn when small (dense recipes). */
export function tableShrink(m: { tableW: number }): number {
  return Math.min(1, STAGE_WIDTH_PX / Math.max(m.tableW, STAGE_WIDTH_PX));
}
