import { toCanvas } from "html-to-image";
import type { RecipeTree } from "../../shared/schema";
import { RASTER_OPTIONS, slugify, stageTable } from "./image";
import { PdfWriter } from "./pdfWriter";

// Single-recipe "Save PDF": the staged table as one lossless image on a page
// sized to the table (CSS px at 96dpi mapped to PDF points at 72dpi).

export interface ExportedPdf {
  blob: Blob;
  filename: string;
}

export async function exportTablePdf(
  recipe: RecipeTree,
  labelMode: "full" | "brief",
): Promise<ExportedPdf> {
  const staged = stageTable(recipe, labelMode);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await toCanvas(staged.stage, RASTER_OPTIONS);
  } finally {
    staged.dispose();
  }

  // Points are 1/72", CSS px are 1/96".
  const ptW = (staged.width * 72) / 96;
  const ptH = (staged.height * 72) / 96;
  const writer = new PdfWriter();
  const image = await writer.addRgb(canvasRgb(canvas), canvas.width, canvas.height);
  writer.addPage(ptW, ptH, [{ image, x: 0, y: 0, w: ptW, h: ptH }]);
  return { blob: writer.finish(recipe.title), filename: `${slugify(recipe.title)}.pdf` };
}

/** Strip the alpha channel — PDF DeviceRGB wants packed 24-bit pixels. */
export function canvasRgb(canvas: HTMLCanvasElement): Uint8Array<ArrayBuffer> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF rendering failed.");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4) {
    rgb[j++] = data[i];
    rgb[j++] = data[i + 1];
    rgb[j++] = data[i + 2];
  }
  return rgb;
}
