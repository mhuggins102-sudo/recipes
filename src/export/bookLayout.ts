// Pure page-planning math for the cookbook PDF — no DOM, unit-tested.
// All sizes are in PDF points; coordinates are content-box-relative with y
// measured from the TOP (the orchestrator adds margins and flips to PDF's
// bottom-left origin).
//
// Page composition (owner-reviewed): the engineered table sits at the TOP of
// the page (its title row leads the page), instructions follow — beside the
// table when it's narrow enough, below it otherwise — and the original card
// photo fills the remaining space at the BOTTOM.

/** 8 × 10 in trim — wide enough for the engineered table at readable sizes. */
export const PAGE = { w: 576, h: 720 };
/** Mirrored margins: 0.75 in binding gutter, 0.5 in elsewhere. */
export const MARGIN = { inner: 54, outer: 36, top: 36, bottom: 36 };
export const CONTENT = { w: PAGE.w - MARGIN.inner - MARGIN.outer, h: PAGE.h - MARGIN.top - MARGIN.bottom };

/** Stage width in CSS px for book blocks; rasterized at 2× → exactly 300 DPI. */
export const STAGE_WIDTH_PX = 1012;
export const PT_PER_PX = CONTENT.w / STAGE_WIDTH_PX;

/** Vertical gap between table / instructions / photo blocks. */
export const GAP = 18;
/** The card photo may take at most this fraction of the content height. */
const PHOTO_MAX_FRACTION = 0.45;
/** Never magnify a photo below this print resolution — small source photos
    render smaller (and therefore sharper) instead of huge and soft. */
export const PHOTO_TARGET_DPI = 150;
/** Smallest photo height worth printing; below this, move to the next page. */
export const PHOTO_MIN_H = 90; // 1.25 in

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

export interface InstrMeasure {
  /** Height of the "Instructions" sub-heading, pt (0 when there are no items). */
  headerH: number;
  /** Per-item heights (including spacing), pt. */
  itemHeights: number[];
}

export interface RecipeMeasure {
  /** Stored photo pixel size (aspect ratio + DPI cap). */
  photo?: { w: number; h: number };
  /** Placed table size in pt — natural width, already aspect-fit by the
      orchestrator so tableW ≤ CONTENT.w and tableH ≤ CONTENT.h. */
  tableW: number;
  tableH: number;
  /** Height of a "«Title»" / "«Title», continued" heading block, pt. */
  headingH: number;
  /** Instructions measured at full content width (stacked layout). */
  stacked: InstrMeasure;
  /** Instructions measured at the side-column width; present only when the
      orchestrator judged a side-by-side layout viable for this recipe. */
  side?: InstrMeasure;
  /** Width of the side instructions column, pt. */
  sideColW?: number;
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

/**
 * Fit the photo (source size in px) under maxH, centered, aspect kept.
 * Width is capped by the content box AND by PHOTO_TARGET_DPI, and height by
 * the 45% ceiling, so a low-res photo is never blown up past the point of
 * printing soft.
 */
export function photoBox(
  photo: { w: number; h: number },
  maxH = CONTENT.h * PHOTO_MAX_FRACTION,
): { x: number; w: number; h: number } {
  const cappedH = Math.min(maxH, CONTENT.h * PHOTO_MAX_FRACTION);
  const maxW = Math.min(CONTENT.w, (photo.w * 72) / PHOTO_TARGET_DPI);
  const scale = Math.min(maxW / photo.w, cappedH / photo.h);
  const w = photo.w * scale;
  const h = photo.h * scale;
  return { x: (CONTENT.w - w) / 2, w, h };
}

function instrTotal(im: InstrMeasure): number {
  return im.itemHeights.length
    ? im.headerH + im.itemHeights.reduce((a, b) => a + b, 0)
    : 0;
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
  const tableW = Math.min(m.tableW, CONTENT.w);
  let placements: PlannedPlacement[] = [];
  let y = 0;

  // Side-by-side when the orchestrator measured a side column AND the whole
  // instructions list fits beside the table on one page.
  const sideH = m.side && m.sideColW ? instrTotal(m.side) : Infinity;
  const useSide =
    !!m.side && !!m.sideColW && m.side.itemHeights.length > 0 && Math.max(tableH, sideH) <= CONTENT.h;

  if (useSide) {
    placements.push({ kind: "table", recipe: r, x: 0, y: 0, w: tableW, h: tableH });
    placements.push({
      kind: "instructions",
      recipe: r,
      x: CONTENT.w - m.sideColW!,
      y: 0,
      w: m.sideColW!,
      h: sideH,
      from: 0,
      to: m.side!.itemHeights.length,
    });
    y = Math.max(tableH, sideH) + GAP;
  } else {
    // Stacked: centered table on top, then greedy instruction packing that
    // spills to "continued" pages, never splitting an item.
    placements.push({
      kind: "table",
      recipe: r,
      x: (CONTENT.w - tableW) / 2,
      y: 0,
      w: tableW,
      h: tableH,
    });
    y = tableH + GAP;

    const items = m.stacked.itemHeights;
    let from = 0;
    let headerH = m.stacked.headerH;
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
        y += used + GAP;
        from = to;
      }
      if (from < items.length) {
        pages.push({ placements });
        placements = [
          { kind: "heading", recipe: r, x: 0, y: 0, w: CONTENT.w, h: m.headingH, continued: true },
        ];
        y = m.headingH + GAP;
        headerH = 0; // the continued heading replaces the "Instructions" sub-heading
        freshPage = true;
      }
    }
  }

  // The original card photo anchors the bottom of the last page — or gets a
  // page of its own when there isn't a printable amount of room left.
  if (m.photo) {
    const remaining = CONTENT.h - y;
    if (remaining >= PHOTO_MIN_H) {
      const box = photoBox(m.photo, remaining);
      placements.push({ kind: "photo", recipe: r, x: box.x, y, w: box.w, h: box.h });
    } else {
      pages.push({ placements });
      const full = photoBox(m.photo);
      placements = [
        { kind: "heading", recipe: r, x: 0, y: 0, w: CONTENT.w, h: m.headingH, continued: true },
        { kind: "photo", recipe: r, x: full.x, y: m.headingH + GAP, w: full.w, h: full.h },
      ];
    }
  }

  pages.push({ placements });
}
