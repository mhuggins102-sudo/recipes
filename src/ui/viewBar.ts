import { DEFAULT_VIEW, type ViewOptions } from "../quantity";

// Segmented controls for the display-time view options. Units and number
// style are user preferences (persisted); scale is per-recipe intent and
// resets to 1× whenever a different recipe is shown.

const KEY = "recipe-tabulator:view";

export interface ViewBar {
  el: HTMLElement;
  view: ViewOptions;
  /** Reset the multiplier to 1× without firing onChange (new recipe shown). */
  resetScale(): void;
}

interface Prefs {
  units: ViewOptions["units"];
  numbers: ViewOptions["numbers"];
}

function loadPrefs(): Partial<Prefs> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

function storePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode etc. — preferences just don't stick */
  }
}

export function createViewBar(onChange: () => void): ViewBar {
  const view: ViewOptions = { ...DEFAULT_VIEW, ...loadPrefs(), scale: 1 };

  const el = document.createElement("div");
  el.className = "view-bar";

  const persist = () => storePrefs({ units: view.units, numbers: view.numbers });

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
      persist();
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
      persist();
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
    "1",
    (v) => {
      view.scale = Number(v);
      onChange();
    },
  );

  el.append(units.group, numbers.group, scale.group);

  return {
    el,
    view,
    resetScale() {
      view.scale = 1;
      scale.set("1");
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
