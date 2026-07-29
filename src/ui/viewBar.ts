import type { ViewOptions } from "../quantity";

// Segmented controls for the display-time view options. Every recipe starts
// at INITIAL_VIEW; when the user changes a control, the caller stores the
// choice on that recipe's recents entry, so each recipe keeps its own view.

/** What every recipe shows until its own settings are changed. */
export const INITIAL_VIEW: ViewOptions = {
  units: "imperial",
  numbers: "fractions",
  scale: 1,
  labels: "brief",
};

export interface ViewBar {
  el: HTMLElement;
  view: ViewOptions;
  /** Replace all four controls (recipe shown with its saved or default view);
      does not fire onChange. */
  setView(v: ViewOptions): void;
}

export function createViewBar(onChange: () => void): ViewBar {
  const view: ViewOptions = { ...INITIAL_VIEW };

  const el = document.createElement("div");
  el.className = "view-bar";

  const units = segmented<ViewOptions["units"]>(
    "Units",
    [
      ["original", "As written"],
      ["metric", "Metric"],
      ["imperial", "Imperial"],
    ],
    view.units,
    (v) => {
      view.units = v;
      onChange();
    },
  );

  const numbers = segmented<ViewOptions["numbers"]>(
    "Numbers",
    [
      ["original", "As written"],
      ["fractions", "Fractions"],
      ["decimals", "Decimals"],
    ],
    view.numbers,
    (v) => {
      view.numbers = v;
      onChange();
    },
  );

  const labels = segmented<ViewOptions["labels"]>(
    "Steps",
    [
      ["full", "Full"],
      ["brief", "Brief"],
    ],
    view.labels,
    (v) => {
      view.labels = v;
      onChange();
    },
  );

  const scale = segmented<string>(
    "Scale",
    [
      ["0.5", "½×"],
      ["1", "1×"],
      ["1.5", "1½×"],
      ["2", "2×"],
      ["3", "3×"],
    ],
    String(view.scale),
    (v) => {
      view.scale = Number(v);
      onChange();
    },
  );

  el.append(units.group, numbers.group, labels.group, scale.group);

  return {
    el,
    view,
    setView(v) {
      Object.assign(view, v);
      units.set(view.units);
      numbers.set(view.numbers);
      labels.set(view.labels);
      scale.set(String(view.scale));
    },
  };
}

function segmented<T extends string>(
  label: string,
  options: [T, string][],
  initial: T,
  pick: (v: T) => void,
): { group: HTMLElement; set(v: T): void } {
  const group = document.createElement("span");
  group.className = "seg-group";
  const name = document.createElement("span");
  name.className = "seg-label";
  name.textContent = label;
  const seg = document.createElement("span");
  seg.className = "seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", label);

  const buttons = new Map<T, HTMLButtonElement>();
  const set = (v: T) => {
    for (const [value, b] of buttons) {
      b.classList.toggle("active", value === v);
      b.setAttribute("aria-pressed", String(value === v));
    }
  };

  for (const [value, text] of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.addEventListener("click", () => {
      if (buttons.get(value)?.classList.contains("active")) return;
      set(value);
      pick(value);
    });
    buttons.set(value, b);
    seg.appendChild(b);
  }
  set(initial);

  group.append(name, seg);
  return { group, set };
}
