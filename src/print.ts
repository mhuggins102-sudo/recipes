// Scale the table to fit one printed page. beforeprint measures the table
// against the printable area, sets a zoom factor, and flips the page to
// landscape only when portrait would shrink the text too far.

// Conservative printable areas in CSS px (96dpi) — covers Letter and A4
// with typical browser margins.
const PORTRAIT = { w: 700, h: 950 };
const LANDSCAPE = { w: 950, h: 700 };
/** Below this zoom the text is too small to cook from; allow a second page. */
const MIN_ZOOM = 0.45;
/** Landscape must beat portrait by this factor to override the preference. */
const LANDSCAPE_GAIN = 1.2;

function fit(w: number, h: number, page: { w: number; h: number }): number {
  return Math.min(1, page.w / w, page.h / h);
}

export function setupPrintFit(getTable: () => HTMLElement | null): void {
  const pageStyle = document.createElement("style");
  document.head.appendChild(pageStyle);

  window.addEventListener("beforeprint", () => {
    const table = getTable();
    if (!table) return;
    const { width, height } = { width: table.offsetWidth, height: table.offsetHeight };
    if (!width || !height) return;

    const portraitZoom = fit(width, height, PORTRAIT);
    const landscapeZoom = fit(width, height, LANDSCAPE);
    const useLandscape =
      portraitZoom < 1 && landscapeZoom > portraitZoom * LANDSCAPE_GAIN;
    const zoom = Math.max(useLandscape ? landscapeZoom : portraitZoom, MIN_ZOOM);

    pageStyle.textContent = useLandscape ? "@page { size: landscape }" : "";
    document.documentElement.style.setProperty("--print-zoom", String(zoom));
  });

  window.addEventListener("afterprint", () => {
    pageStyle.textContent = "";
    document.documentElement.style.removeProperty("--print-zoom");
  });
}
