import { describe, expect, it } from "vitest";
import { briefLabel } from "../src/labels";

describe("briefLabel", () => {
  it("shortens the chocolate-chip-cookie labels from the report", () => {
    expect(briefLabel("cream together until combined")).toBe("cream");
    expect(briefLabel("beat in eggs and vanilla until light, about 1 min")).toBe("beat 1 min");
    expect(briefLabel("mix in dry ingredients until combined")).toBe("mix");
    expect(briefLabel("add chocolate chips and mix well")).toBe("mix");
    expect(briefLabel("mix dry ingredients, set aside")).toBe("mix");
    expect(briefLabel("roll into balls and space on prepared sheets")).toBe("roll");
  });

  it("keeps temperatures and durations, in order of appearance", () => {
    expect(briefLabel("bake 375°F (190°C) 8 to 10 min")).toBe("bake 375°F (190°C) 8 to 10 min");
    expect(briefLabel("bake 10 min at 375°F")).toBe("bake 10 min 375°F");
    expect(briefLabel("chill at least 2 hours or overnight")).toBe("chill 2 hours overnight");
  });

  it("prefers a strong verb over a weak one anywhere in the label", () => {
    expect(briefLabel("let sit on pan 2 min then move to cooling rack")).toBe("sit 2 min");
    expect(briefLabel("add wet to dry and stir gently")).toBe("stir");
  });

  it("falls back to a weak verb, then the first word", () => {
    expect(briefLabel("add toppings")).toBe("add");
    expect(briefLabel("fluff with a fork")).toBe("fluff");
  });

  it("handles fold and other one-word labels", () => {
    expect(briefLabel("fold in")).toBe("fold");
    expect(briefLabel("mix")).toBe("mix");
  });
});
