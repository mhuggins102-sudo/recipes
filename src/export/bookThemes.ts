// Cookbook design themes. A theme is (a) a CSS class scoped under .book-stage
// (fonts, colors, table borders — see the theme blocks in styles/main.css) and
// (b) a page background + optional photo frame painted by PdfWriter as cheap
// vector ops. Fonts are system stacks: pages are all-raster, so nothing is
// embedded — the stack just needs decent coverage on the generating device.

export interface PhotoFrame {
  color: string;
  /** Stroke width in pt. */
  width: number;
}

export interface BookTheme {
  id: string;
  label: string;
  /** One line for the picker. */
  description: string;
  /** Extra class on .book-stage; "" = the base look. */
  className: string;
  /** Page background — PDF page fill AND raster background, so blocks blend. */
  pageBg: string;
  /** Accent color, used for the picker chip. */
  accent: string;
  /** Body ink, used for the picker chip. */
  ink: string;
  /** Font stack, used for the picker chip (the stage CSS declares its own). */
  fontFamily: string;
  photoFrame?: PhotoFrame;
}

export const BOOK_THEMES: BookTheme[] = [
  {
    id: "standard",
    label: "Standard",
    description: "Clean white pages, the classic green table",
    className: "",
    pageBg: "#ffffff",
    accent: "#2f6b31",
    ink: "#1a1a1a",
    fontFamily: '"Trebuchet MS", Verdana, sans-serif',
  },
  {
    id: "heirloom",
    label: "Heirloom",
    description: "Cream pages, warm sepia serif — vintage family cookbook",
    className: "theme-heirloom",
    pageBg: "#faf5e9",
    accent: "#6b4f2e",
    ink: "#4a3a2a",
    fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    photoFrame: { color: "#8a6a4f", width: 1 },
  },
  {
    id: "botanical",
    label: "Botanical",
    description: "Soft sage tones, airy small-caps headings",
    className: "theme-botanical",
    pageBg: "#f4f7f1",
    accent: "#5f7355",
    ink: "#2e352b",
    fontFamily: 'Optima, Candara, "Segoe UI", Verdana, sans-serif',
  },
  {
    id: "modern",
    label: "Modern",
    description: "Minimal black and white with a terracotta accent",
    className: "theme-modern",
    pageBg: "#ffffff",
    accent: "#c05b3f",
    ink: "#24292e",
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    photoFrame: { color: "#24292e", width: 0.75 },
  },
];

export function getTheme(id?: string): BookTheme {
  return BOOK_THEMES.find((t) => t.id === id) ?? BOOK_THEMES[0];
}

/** "#rrggbb" → [r, g, b] floats 0–1 for PDF color operators. */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
