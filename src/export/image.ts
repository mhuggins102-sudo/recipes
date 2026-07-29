import { toBlob } from "html-to-image";
import type { RecipeTree } from "../../shared/schema";
import { renderTable } from "../render/table";

// Export the rendered table as a PNG sized for sharing: probe several render
// widths and pick the one whose aspect ratio is closest to portrait, so the
// whole recipe fits one phone-friendly image without scrolling.

/** Ideal height/width ratio — roughly a phone photo in portrait. */
const TARGET_RATIO = 1.4;
const CANDIDATE_WIDTHS = [560, 640, 720, 800, 900, 1040, 1200, 1400];
const PADDING = 20;

export interface ExportedImage {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
}

export async function exportTableImage(
  recipe: RecipeTree,
  labelMode: "full" | "brief",
): Promise<ExportedImage> {
  const stage = document.createElement("div");
  stage.className = "export-stage";
  const table = renderTable(recipe, labelMode);
  stage.appendChild(table);
  document.body.appendChild(stage);

  try {
    // Probe layout-only (no rasterizing) for the most portrait-friendly width.
    let best = { width: CANDIDATE_WIDTHS[0], score: Infinity };
    for (const w of CANDIDATE_WIDTHS) {
      stage.style.width = `${w}px`;
      // Skip widths the table overflows (min column widths don't fit).
      if (table.scrollWidth > w - PADDING * 2 + 1) continue;
      const ratio = stage.offsetHeight / w;
      const score = Math.abs(Math.log(ratio / TARGET_RATIO));
      if (score < best.score) best = { width: w, score };
    }
    if (best.score === Infinity) {
      // Wider than every candidate — let it be landscape rather than clipped.
      stage.style.width = "";
      stage.style.width = `${stage.scrollWidth + PADDING * 2}px`;
    } else {
      stage.style.width = `${best.width}px`;
    }

    const width = stage.offsetWidth;
    const height = stage.offsetHeight;
    const blob = await toBlob(stage, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      // The live stage is parked off-viewport; the clone that gets rasterized
      // must not inherit that offset or the image comes out blank.
      style: { position: "static", left: "0", top: "0" },
    });
    if (!blob) throw new Error("Image rendering failed.");

    const slug =
      recipe.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "recipe";
    return { blob, width, height, filename: `${slug}.png` };
  } finally {
    stage.remove();
  }
}

/** Trigger a browser download of the exported image. */
export function downloadImage(image: ExportedImage): void {
  const url = URL.createObjectURL(image.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = image.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Share via the native share sheet (Messages, Save Image, …). Returns false
 * when the platform can't share files — caller should fall back to download.
 */
export async function shareImage(image: ExportedImage, title: string): Promise<boolean> {
  const file = new File([image.blob], image.filename, { type: "image/png" });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title });
  } catch (err) {
    // User closing the share sheet is not an error.
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return false;
  }
  return true;
}
