import { describe, expect, it } from "vitest";
import {
  CONTENT,
  GAP,
  MARGIN,
  pageContentLeft,
  photoBox,
  planBook,
  type RecipeMeasure,
} from "../src/export/bookLayout";

const recipe = (over: Partial<RecipeMeasure> = {}): RecipeMeasure => ({
  photo: { w: 1500, h: 1000 },
  tableH: 200,
  headingH: 30,
  instrHeaderH: 24,
  itemHeights: [20, 20, 20],
  ...over,
});

const kinds = (placements: { kind: string }[]) => placements.map((p) => p.kind);

describe("photoBox", () => {
  it("caps photo height at 45% of the content box, centered", () => {
    const box = photoBox({ w: 1000, h: 1000 });
    expect(box.h).toBeCloseTo(CONTENT.h * 0.45);
    expect(box.w).toBeCloseTo(box.h);
    expect(box.x).toBeCloseTo((CONTENT.w - box.w) / 2);
  });

  it("caps wide photos at content width", () => {
    const box = photoBox({ w: 4000, h: 1000 });
    expect(box.w).toBeCloseTo(CONTENT.w);
  });

  it("never magnifies a low-res photo below the target print DPI", () => {
    // A 443 px-wide card (real case from the first printed book) must not be
    // blown up to full content width — cap it at PHOTO_TARGET_DPI.
    const box = photoBox({ w: 443, h: 266 });
    expect(box.w).toBeCloseTo((443 * 72) / 150);
    const effectiveDpi = 443 / (box.w / 72);
    expect(effectiveDpi).toBeCloseTo(150);
  });
});

describe("pageContentLeft", () => {
  it("mirrors the binding gutter by page parity", () => {
    expect(pageContentLeft(1)).toBe(MARGIN.inner); // recto: gutter left
    expect(pageContentLeft(2)).toBe(MARGIN.outer); // verso: gutter right
    expect(pageContentLeft(3)).toBe(MARGIN.inner);
  });
});

describe("planBook", () => {
  it("fits a typical recipe on one page after the title page", () => {
    const plan = planBook({ toc: false, tocEntryH: 30, tocHeaderH: 48, recipes: [recipe()] });
    expect(plan.pages).toHaveLength(2);
    expect(kinds(plan.pages[0].placements)).toEqual(["title"]);
    expect(kinds(plan.pages[1].placements)).toEqual(["photo", "table", "instructions"]);
    expect(plan.recipeStartPage).toEqual([2]);
    // Everything stays inside the content box.
    for (const p of plan.pages[1].placements) {
      expect(p.y + p.h).toBeLessThanOrEqual(CONTENT.h + 0.001);
    }
  });

  it("spills long instructions to a continued page, never splitting an item", () => {
    const items = Array.from({ length: 40 }, () => 30);
    const plan = planBook({
      toc: false,
      tocEntryH: 30,
      tocHeaderH: 48,
      recipes: [recipe({ itemHeights: items })],
    });
    expect(plan.pages.length).toBeGreaterThan(2);
    const cont = plan.pages[2].placements;
    expect(cont[0].kind).toBe("heading");
    expect(cont[0].continued).toBe(true);
    // The two instruction slices cover all items exactly once, in order.
    const slices = plan.pages
      .flatMap((p) => p.placements)
      .filter((p) => p.kind === "instructions");
    expect(slices[0].from).toBe(0);
    for (let i = 1; i < slices.length; i++) expect(slices[i].from).toBe(slices[i - 1].to);
    expect(slices[slices.length - 1].to).toBe(items.length);
  });

  it("shrinks the photo so photo + table + instructions share one page", () => {
    // Ceiling-size photo (291.6pt) would overflow; the fit leaves 148pt.
    const plan = planBook({
      toc: false,
      tocEntryH: 30,
      tocHeaderH: 48,
      recipes: [recipe({ itemHeights: Array.from({ length: 8 }, () => 30) })],
    });
    expect(plan.pages).toHaveLength(2);
    const page = plan.pages[1].placements;
    expect(kinds(page)).toEqual(["photo", "table", "instructions"]);
    const expectedPhotoH = CONTENT.h - (GAP + 200 + GAP + (24 + 8 * 30));
    expect(page[0].h).toBeCloseTo(expectedPhotoH);
    expect(page[2].to).toBe(8); // every instruction made it onto the page
    for (const p of page) expect(p.y + p.h).toBeLessThanOrEqual(CONTENT.h + 0.001);
  });

  it("floors the photo beside a tall table and spills instructions", () => {
    const plan = planBook({
      toc: false,
      tocEntryH: 30,
      tocHeaderH: 48,
      recipes: [recipe({ tableH: 500, itemHeights: Array.from({ length: 10 }, () => 30) })],
    });
    const page1 = plan.pages[1].placements;
    expect(page1[0].kind).toBe("photo");
    expect(page1[0].h).toBeCloseTo(90); // PHOTO_MIN_H floor
    expect(page1[1].kind).toBe("table");
    const cont = plan.pages[2].placements;
    expect(cont[0].kind).toBe("heading");
    expect(cont[0].continued).toBe(true);
  });

  it("moves a very tall table to its own page, leaving the photo with a heading", () => {
    const plan = planBook({
      toc: false,
      tocEntryH: 30,
      tocHeaderH: 48,
      recipes: [recipe({ photo: { w: 1000, h: 1000 }, tableH: 600 })],
    });
    expect(kinds(plan.pages[1].placements)).toEqual(["heading", "photo"]);
    expect(plan.pages[1].placements[0].continued).toBeUndefined();
    // The photo-only page uses the ceiling size, not the fit-shrunk one.
    expect(plan.pages[1].placements[1].h).toBeCloseTo(CONTENT.h * 0.45);
    const tablePage = plan.pages[2].placements;
    expect(tablePage[0].kind).toBe("table");
    expect(tablePage[0].y).toBe(0);
  });

  it("clamps a table taller than the page", () => {
    const plan = planBook({
      toc: false,
      tocEntryH: 30,
      tocHeaderH: 48,
      recipes: [recipe({ photo: undefined, tableH: 2000, itemHeights: [] })],
    });
    const table = plan.pages[1].placements.find((p) => p.kind === "table")!;
    expect(table.h).toBeLessThanOrEqual(CONTENT.h);
  });

  it("paginates the TOC and offsets recipe start pages", () => {
    const recipes = Array.from({ length: 100 }, () => recipe());
    const plan = planBook({ toc: true, tocEntryH: 30, tocHeaderH: 48, recipes });
    const perPage = Math.floor((CONTENT.h - 48) / 30);
    const tocPages = Math.ceil(100 / perPage);
    expect(plan.tocPages).toBe(tocPages);
    expect(plan.recipeStartPage[0]).toBe(1 + tocPages + 1);
    // TOC slices cover every entry exactly once.
    const slices = plan.pages.flatMap((p) => p.placements).filter((p) => p.kind === "toc");
    expect(slices[0].from).toBe(0);
    expect(slices[slices.length - 1].to).toBe(100);
  });

  it("keeps the photo/table gap explicit", () => {
    const plan = planBook({ toc: false, tocEntryH: 30, tocHeaderH: 48, recipes: [recipe()] });
    const [photo, table] = plan.pages[1].placements;
    expect(table.y).toBeCloseTo(photo.y + photo.h + GAP);
  });
});
