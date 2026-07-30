// Pure page-planning math for the cookbook PDF — no DOM, unit-tested.
// All sizes are in PDF points; coordinates are content-box-relative with y
// measured from the TOP (the orchestrator adds margins and flips to PDF's
// bottom-left origin).

/** 8 × 10 in trim — wide enough for the engineered table at readable sizes. */
export const PAGE = { w: 576, h: 720 };
/** Mirrored margins: 0.75 in binding gutter, 0.5 in elsewhere. */
export const MARGIN = { inner: 54, outer: 36, top: 36, bottom: 36 };
export const CONTENT = { w: PAGE.w - MARGIN.inner - MARGIN.outer, h: PAGE.h - MARGIN.top - MARGIN.bottom };

/** Stage width in CSS px for book blocks; rasterized at 2× → exactly 300 DPI. */
export const STAGE_WIDTH_PX = 1012;
export const PT_PER_PX = CONTENT.w / STAGE_WIDTH_PX;

/** Vertical gap between photo / table / instructions blocks. */
export const GAP = 18;
/** The card photo may take at most this fraction of the content height. */
const PHOTO_MAX_FRACTION = 0.45;

export type PlacementKind = "title" | "toc" | "heading" | "photo" | "table" | "instructions";

export interface PlannedPlacement {
  kind: PlacementKind;
  /** Index into inputs.recipes; absent for title/toc placements. */
  recipe?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** For "instructions"/"toc": item range [from, to) shown on this page. */
  from?: number;
  to?: number;
  /** For "heading": true on "«Title», continued" pages. */
  continued?: boolean;
}

export interface PagePlan {
  placements: PlannedPlacement[];
}

export interface RecipeMeasure {
  /** Stored photo pixel size (only the aspect ratio is used). */
  photo?: { w: number; h: number };
  /** Table block height at content width, pt. Must be ≤ CONTENT.h (orchestrator zooms). */
  tableH: number;
  /** Height of a "«Title»" / "«Title», continued" heading block, pt. */
  headingH: number;
  /** Height of the "Instructions" sub-heading, pt (0 when there are no items). */
  instrHeaderH: number;
  /** Per-item heights (including spacing), pt. */
  itemHeights: number[];
}

export interface BookInputs {
  toc: boolean;
  /** Height of one TOC line, pt. */
  tocEntryH: number;
  /** Height of the TOC heading, pt. */
  tocHeaderH: number;
  recipes: RecipeMeasure[];
}

export interface BookPlan {
  pages: PagePlan[];
  /** 1-based page number where each recipe starts (for the TOC text). */
  recipeStartPage: number[];
  tocPages: number;
}

/** Left edge of the content box for a 1-based page number (mirrored gutter). */
export function pageContentLeft(pageNumber: number): number {
  // Odd pages are recto (right-hand): the binding gutter is on their left.
  return pageNumber % 2 === 1 ? MARGIN.inner : MARGIN.outer;
}

/** Fit the photo into content-width × 45% content-height, centered, aspect kept. */
export function photoBox(photo: { w: number; h: number }): { x: number; w: number; h: number } {
  const maxH = CONTENT.h * PHOTO_MAX_FRACTION;
  const scale = Math.min(CONTENT.w / photo.w, maxH / photo.h);
  const w = photo.w * scale;
  const h = photo.h * scale;
  return { x: (CONTENT.w - w) / 2, w, h };
}

export function planBook(inputs: BookInputs): BookPlan {
  const pages: PagePlan[] = [];

  pages.push({ placements: [{ kind: "title", x: 0, y: 0, w: CONTENT.w, h: CONTENT.h }] });

  let tocPages = 0;
  if (inputs.toc && inputs.recipes.length) {
    const perPage = Math.max(1, Math.floor((CONTENT.h - inputs.tocHeaderH) / inputs.tocEntryH));
    tocPages = Math.ceil(inputs.recipes.length / perPage);
    for (let p = 0; p < tocPages; p++) {
      const from = p * perPage;
      const to = Math.min(inputs.recipes.length, from + perPage);
      pages.push({
        placements: [
          {
            kind: "toc",
            x: 0,
            y: 0,
            w: CONTENT.w,
            h: inputs.tocHeaderH + (to - from) * inputs.tocEntryH,
            from,
            to,
          },
        ],
      });
    }
  }

  const recipeStartPage: number[] = [];
  inputs.recipes.forEach((m, r) => {
    recipeStartPage.push(pages.length + 1);
    planRecipe(pages, m, r);
  });

  return { pages, recipeStartPage, tocPages };
}

function planRecipe(pages: PagePlan[], m: RecipeMeasure, r: number): void {
  const tableH = Math.min(m.tableH, CONTENT.h);
  let placements: PlannedPlacement[] = [];
  let y = 0;

  if (m.photo) {
    const box = photoBox(m.photo);
    const together = box.h + GAP + tableH <= CONTENT.h;
    if (together) {
      placements.push({ kind: "photo", recipe: r, x: box.x, y, w: box.w, h: box.h });
      y += box.h + GAP;
    } else {
      // Photo page (with a title heading, since the table carries the title
      // elsewhere), then the table starts fresh on the next page.
      pages.push({
        placements: [
          { kind: "heading", recipe: r, x: 0, y: 0, w: CONTENT.w, h: m.headingH },
          { kind: "photo", recipe: r, x: box.x, y: m.headingH + GAP, w: box.w, h: box.h },
        ],
      });
    }
  }

  placements.push({ kind: "table", recipe: r, x: 0, y, w: CONTENT.w, h: tableH });
  y += tableH + GAP;

  // Greedy instruction packing; spill to "continued" pages, never splitting an item.
  const items = m.itemHeights;
  let from = 0;
  let headerH = m.instrHeaderH;
  let freshPage = false;
  while (from < items.length) {
    let used = headerH;
    let to = from;
    while (to < items.length && y + used + items[to] <= CONTENT.h) {
      used += items[to];
      to++;
    }
    if (to === from && freshPage) {
      // A single item taller than a whole page — place it clamped rather
      // than looping forever (can't split an item).
      used += Math.min(items[to], CONTENT.h - y - used);
      to++;
    }
    if (to > from) {
      placements.push({ kind: "instructions", recipe: r, x: 0, y, w: CONTENT.w, h: used, from, to });
      from = to;
    }
    if (from < items.length) {
      // Flush the current page and continue on a fresh one under a
      // "«Title», continued" heading.
      pages.push({ placements });
      placements = [
        { kind: "heading", recipe: r, x: 0, y: 0, w: CONTENT.w, h: m.headingH, continued: true },
      ];
      y = m.headingH + GAP;
      headerH = 0; // the continued heading replaces the "Instructions" sub-heading
      freshPage = true;
    }
  }

  pages.push({ placements });
}
