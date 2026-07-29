import { toCanvas } from "html-to-image";
import type { RecipeTree } from "../../shared/schema";
import { RASTER_OPTIONS, slugify, stageTable } from "./image";

// Hand-assembled single-page PDF: the rendered table as one lossless
// FlateDecode RGB image, on a page sized to the table (CSS px at 96dpi
// mapped to PDF points at 72dpi). No PDF library needed.

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
  const blob = await pdfFromCanvas(canvas, staged.width, staged.height, recipe.title);
  return { blob, filename: `${slugify(recipe.title)}.pdf` };
}

/** Strip the alpha channel — PDF DeviceRGB wants packed 24-bit pixels. */
function canvasRgb(canvas: HTMLCanvasElement): Uint8Array<ArrayBuffer> {
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

/** zlib-deflate via the built-in CompressionStream; null when unsupported. */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** PDF text string as UTF-16BE hex — safe for any title (quotes, emoji, …). */
function pdfTextString(text: string): string {
  let hex = "FEFF";
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(4, "0");
  }
  return `<${hex}>`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function pdfFromCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  title: string,
): Promise<Blob> {
  const rgb = canvasRgb(canvas);
  const deflated = await deflate(rgb);
  const image = deflated ?? rgb;
  // Points are 1/72", CSS px are 1/96".
  const ptW = round2((cssWidth * 72) / 96);
  const ptH = round2((cssHeight * 72) / 96);

  const enc = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const push = (part: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    offset += bytes.length;
  };
  const offsets: number[] = [];
  const obj = (n: number, body: string) => {
    offsets[n] = offset;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary-file marker comment

  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] ` +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  );

  offsets[4] = offset;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
      "/ColorSpace /DeviceRGB /BitsPerComponent 8 " +
      `${deflated ? "/Filter /FlateDecode " : ""}/Length ${image.length} >>\nstream\n`,
  );
  push(image);
  push("\nendstream\nendobj\n");

  // Scale the unit-square image to fill the page.
  const content = `q\n${ptW} 0 0 ${ptH} 0 0 cm\n/Im0 Do\nQ\n`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}endstream`);
  obj(6, `<< /Title ${pdfTextString(title)} /Producer (Recipe Tabulator) >>`);

  const xrefOffset = offset;
  push("xref\n0 7\n0000000000 65535 f \n");
  for (let n = 1; n <= 6; n++) push(`${offsets[n].toString().padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}
