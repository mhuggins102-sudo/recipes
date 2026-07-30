import { describe, expect, it } from "vitest";
import {
  CONTENT,
  GAP,
  MARGIN,
  PHOTO_MIN_H,
  pageContentLeft,
  photoBox,
  planBook,
  type InstrMeasure,
  type RecipeMeasure,
} from "../src/export/bookLayout";

const instr = (n: number, itemH = 20, headerH = 24): InstrMeasure => ({
  headerH: n ? headerH : 0,
  itemHeights: Array.from({ length: n }, () => itemH),
});

const total = (im: InstrMeasure) =>
  im.itemHeights.length ? im.headerH + im.itemHeights.reduce((a, b) => a + b, 0) : 0;

const recipe = (over: Partial<RecipeMeasure> = {}): RecipeMeasure => ({
  photo: { w: 1500, h: 1000 },
  tableW: CONTENT.w,
  tableH: 200,
  headingH: 30,
  stacked: instr(3),
  ...over,
});

const plan1 = (r: RecipeMeasure) =>
  planBook({ toc: false, tocEntryH: 30, tocHeaderH: 48, recipes: [r] });

const kinds = (placements: { kind: string }[]) => placements.map((p) => p.kind);

describe("photoBox", () => {
  it("caps photo height at 45% of the content box, left-aligned", () => {
    const box = photoBox({ w: 1000, h: 1000 });
    expect(box.h).toBeCloseTo(CONTENT.h * 0.45);
    expect(box.w).toBeCloseTo(box.h);
    expect(box.x).toBe(0);
  });

  it("caps wide photos at content width", () => {
    const box = photoBox({ w: 4000, h: 1000 });
    expect(box.w).toBeCloseTo(CONTENT.w);
  });

  it("never magnifies a low-res photo below the target print DPI (110)", () => {
    // A 443 px-wide card (real case from the first printed book) must not be
    // blown up to full content width — cap it at PHOTO_TARGET_DPI.
    const box = photoBox({ w: 443, h: 266 });
    expect(box.w).toBeCloseTo((443 * 72) / 110);
    const effectiveDpi = 443 / (box.w / 72);
    expect(effectiveDpi).toBeCloseTo(110);
  });

  it("keeps the 45% ceiling even when offered more room", () => {
    const box = photoBox({ w: 1000, h: 2000 }, CONTENT.h);
    expect(box.h).toBeCloseTo(CONTENT.h * 0.45);
  });

  it("respects an explicit width limit (photo-right column)", () => {
    const box = photoBox({ w: 4000, h: 1000 }, CONTENT.h, 200);
    expect(box.w).toBeCloseTo(200);
    expect(box.h).toBeCloseTo(50);
  });
});

describe("pageContentLeft", () => {
  it("mirrors the binding gutter by page parity", () => {
    expect(pageContentLeft(1)).toBe(MARGIN.inner); // recto: gutter left
    expect(pageContentLeft(2)).toBe(MARGIN.outer); // verso: gutter right
    expect(pageContentLeft(3)).toBe(MARGIN.inner);
  });
});

describe("planBook — stacked layout", () => {
  it("orders the page table → instructions → photo, all left-aligned", () => {
    const m = recipe({ tableW: 300 });
    const plan = plan1(m);
    expect(plan.pages).toHaveLength(2);
    const page = plan.pages[1].placements;
    expect(kinds(page)).toEqual(["table", "instructions", "photo"]);
    const [table, instrs, photo] = page;
    expect(table.y).toBe(0);
    expect(table.x).toBe(0); // left-justified with the instructions
    expect(instrs.x).toBe(0);
    expect(photo.x).toBe(0);
    expect(instrs.y).toBeCloseTo(table.h + GAP);
    expect(photo.y).toBeCloseTo(instrs.y + total(m.stacked) + GAP);
    for (const p of page) expect(p.y + p.h).toBeLessThanOrEqual(CONTENT.h + 0.001);
  });

  it("shrinks the photo into the space left below the instructions", () => {
    const m = recipe({ stacked: instr(8, 30) });
    const plan = plan1(m);
    expect(plan.pages).toHaveLength(2);
    const photo = plan.pages[1].placements.at(-1)!;
    expect(photo.kind).toBe("photo");
    const photoTop = 200 + GAP + total(m.stacked) + GAP;
    expect(photo.h).toBeLessThanOrEqual(CONTENT.h - photoTop + 0.001);
    expect(photo.y + photo.h).toBeLessThanOrEqual(CONTENT.h + 0.001);
  });

  it("gives the photo its own page when no printable room remains", () => {
    const m = recipe({ tableH: 600, stacked: instr(0) });
    const plan = plan1(m); // 600 + GAP leaves < PHOTO_MIN_H
    expect(plan.pages).toHaveLength(3);
    expect(kinds(plan.pages[1].placements)).toEqual(["table"]);
    const photoPage = plan.pages[2].placements;
    expect(kinds(photoPage)).toEqual(["heading", "photo"]);
    expect(photoPage[0].continued).toBe(true);
    expect(photoPage[1].h).toBeCloseTo(CONTENT.h * 0.45); // ceiling size
  });

  it("spills long instructions to continued pages, photo at the very end", () => {
    const m = recipe({ stacked: instr(40, 30) });
    const plan = plan1(m);
    expect(plan.pages.length).toBeGreaterThan(3);
    const cont = plan.pages[2].placements;
    expect(cont[0].kind).toBe("heading");
    expect(cont[0].continued).toBe(true);
    // Slices cover every item exactly once, in order.
    const slices = plan.pages.flatMap((p) => p.placements).filter((p) => p.kind === "instructions");
    expect(slices[0].from).toBe(0);
    for (let i = 1; i < slices.length; i++) expect(slices[i].from).toBe(slices[i - 1].to);
    expect(slices.at(-1)!.to).toBe(40);
    // The photo is the last placement of the recipe's final page.
    const lastPage = plan.pages.at(-1)!.placements;
    expect(lastPage.at(-1)!.kind).toBe("photo");
  });

  it("clamps a table taller than the page", () => {
    const plan = plan1(recipe({ photo: undefined, tableH: 2000, stacked: instr(0) }));
    const table = plan.pages[1].placements.find((p) => p.kind === "table")!;
    expect(table.h).toBeLessThanOrEqual(CONTENT.h);
  });
});

describe("planBook — photo-right spill layout", () => {
  const NARROW = CONTENT.w * 0.55;
  const spillRecipe = (over: Partial<RecipeMeasure> = {}): RecipeMeasure =>
    recipe({
      stacked: instr(20, 30), // 624pt — overflows below a 200pt table
      narrow: instr(20, 34),
      narrowColW: NARROW,
      ...over,
    });

  it("puts the photo right of width-capped instructions when stacking spills", () => {
    const m = spillRecipe();
    const plan = plan1(m);
    const page1 = plan.pages[1].placements;
    expect(kinds(page1)).toEqual(["table", "photo", "instructions"]);
    const [table, photo, instrs] = page1;
    expect(table.x).toBe(0);
    // Photo hugs the right edge inside its column, top-aligned with the text.
    expect(photo.x).toBeCloseTo(CONTENT.w - photo.w);
    expect(photo.w).toBeLessThanOrEqual(CONTENT.w - NARROW - GAP + 0.001);
    expect(photo.y).toBeCloseTo(table.h + GAP);
    // Instructions flow in the capped column, spilling at the same width.
    expect(instrs.w).toBeCloseTo(NARROW);
    const slices = plan.pages.flatMap((p) => p.placements).filter((p) => p.kind === "instructions");
    for (const s of slices) expect(s.w).toBeCloseTo(NARROW);
    expect(slices.at(-1)!.to).toBe(20);
    // No second photo placement anywhere.
    const photos = plan.pages.flatMap((p) => p.placements).filter((p) => p.kind === "photo");
    expect(photos).toHaveLength(1);
  });

  it("falls back to stacked + photo-own-page when the table fills the page", () => {
    // Region below a 600pt table is 30pt — no room for a photo column, and
    // the 20 spilled items exactly fill the continuation page too.
    const m = spillRecipe({ tableH: 600 });
    const plan = plan1(m);
    const lastPage = plan.pages.at(-1)!.placements;
    expect(kinds(lastPage)).toEqual(["heading", "photo"]);
    expect(lastPage[0].continued).toBe(true);
    // Stacked fallback means full-width instruction slices, not the capped column.
    const slices = plan.pages.flatMap((p) => p.placements).filter((p) => p.kind === "instructions");
    for (const s of slices) expect(s.w).toBeCloseTo(CONTENT.w);
  });
});

describe("planBook — side-by-side layout", () => {
  const sideRecipe = (over: Partial<RecipeMeasure> = {}): RecipeMeasure =>
    recipe({
      tableW: 220,
      tableH: 300,
      stacked: instr(5),
      side: instr(5, 26),
      sideColW: CONTENT.w - 220 - GAP,
      ...over,
    });

  it("puts instructions beside a narrow table, photo below both", () => {
    const m = sideRecipe();
    const plan = plan1(m);
    expect(plan.pages).toHaveLength(2);
    const page = plan.pages[1].placements;
    expect(kinds(page)).toEqual(["table", "instructions", "photo"]);
    const [table, instrs, photo] = page;
    expect(table.x).toBe(0); // left column
    expect(table.y).toBe(0);
    expect(instrs.y).toBe(0); // top-aligned beside the table
    expect(instrs.x).toBeCloseTo(CONTENT.w - m.sideColW!);
    expect(instrs.w).toBeCloseTo(m.sideColW!);
    expect(instrs.to).toBe(5); // the whole list sits in the column
    expect(photo.y).toBeCloseTo(Math.max(300, total(m.side!)) + GAP);
  });

  it("falls back to stacked when the side column would overflow the page", () => {
    const m = sideRecipe({ side: instr(40, 30) });
    const plan = plan1(m);
    const page = plan.pages[1].placements;
    expect(page[0].kind).toBe("table");
    // Stacked mode: full-width instructions below the table (no side column).
    const instrs = page.find((p) => p.kind === "instructions")!;
    expect(instrs.w).toBeCloseTo(CONTENT.w);
    expect(instrs.y).toBeGreaterThan(0);
  });
});

describe("planBook — front matter", () => {
  it("paginates the TOC and offsets recipe start pages", () => {
    const recipes = Array.from({ length: 100 }, () => recipe());
    const plan = planBook({ toc: true, tocEntryH: 30, tocHeaderH: 48, recipes });
    const perPage = Math.floor((CONTENT.h - 48) / 30);
    const tocPages = Math.ceil(100 / perPage);
    expect(plan.tocPages).toBe(tocPages);
    expect(plan.recipeStartPage[0]).toBe(1 + tocPages + 1);
    const slices = plan.pages.flatMap((p) => p.placements).filter((p) => p.kind === "toc");
    expect(slices[0].from).toBe(0);
    expect(slices.at(-1)!.to).toBe(100);
  });

  it("keeps a printable floor constant sane", () => {
    expect(PHOTO_MIN_H).toBeGreaterThan(0);
    expect(PHOTO_MIN_H).toBeLessThan(CONTENT.h);
  });
});
