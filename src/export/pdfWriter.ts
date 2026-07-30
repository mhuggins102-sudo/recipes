// Minimal multi-page PDF writer — image-only pages, no fonts, no library.
// Photos embed as pass-through JPEG (DCTDecode); rendered canvases embed as
// lossless zlib-deflated RGB (FlateDecode). Deliberately DOM-free so it runs
// (and is byte-tested) in Node as well as the browser.

export interface Placement {
  /** Index returned by addJpeg/addRgb. */
  image: number;
  /** PDF-native coordinates: x/y is the BOTTOM-LEFT corner of the image box, in points. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ImageEntry {
  data: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  /** PDF stream filter; raw RGB with no CompressionStream support has none. */
  filter: "DCTDecode" | "FlateDecode" | null;
}

interface PageEntry {
  width: number;
  height: number;
  placements: Placement[];
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

export class PdfWriter {
  private images: ImageEntry[] = [];
  private pages: PageEntry[] = [];

  /** Embed a JPEG's bytes as-is (no recompression). Returns the image index. */
  addJpeg(data: Uint8Array<ArrayBuffer>, width: number, height: number): number {
    this.images.push({ data, width, height, filter: "DCTDecode" });
    return this.images.length - 1;
  }

  /** Embed packed 24-bit RGB pixels losslessly. Returns the image index. */
  async addRgb(rgb: Uint8Array<ArrayBuffer>, width: number, height: number): Promise<number> {
    const deflated = await deflate(rgb);
    this.images.push({
      data: deflated ?? rgb,
      width,
      height,
      filter: deflated ? "FlateDecode" : null,
    });
    return this.images.length - 1;
  }

  addPage(width: number, height: number, placements: Placement[]): void {
    this.pages.push({ width, height, placements });
  }

  /**
   * Assemble the document. Object layout: 1 Catalog, 2 Pages, then per page a
   * Page + Contents pair, then one XObject per image, then Info; xref last.
   */
  finish(title: string): Blob {
    const P = this.pages.length;
    const I = this.images.length;
    const pageObj = (i: number) => 3 + i * 2;
    const contentsObj = (i: number) => 4 + i * 2;
    const imageObj = (i: number) => 3 + P * 2 + i;
    const infoObj = 3 + P * 2 + I;
    const totalObjs = infoObj;

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
    const kids = this.pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ");
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${P} >>`);

    this.pages.forEach((page, i) => {
      const used = [...new Set(page.placements.map((p) => p.image))];
      const xobjects = used.map((n) => `/Im${n} ${imageObj(n)} 0 R`).join(" ");
      obj(
        pageObj(i),
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round2(page.width)} ${round2(page.height)}] ` +
          `/Resources << /XObject << ${xobjects} >> >> /Contents ${contentsObj(i)} 0 R >>`,
      );
      const content = page.placements
        .map(
          (p) =>
            `q\n${round2(p.w)} 0 0 ${round2(p.h)} ${round2(p.x)} ${round2(p.y)} cm\n/Im${p.image} Do\nQ\n`,
        )
        .join("");
      obj(contentsObj(i), `<< /Length ${content.length} >>\nstream\n${content}endstream`);
    });

    this.images.forEach((image, i) => {
      const n = imageObj(i);
      offsets[n] = offset;
      push(
        `${n} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
          "/ColorSpace /DeviceRGB /BitsPerComponent 8 " +
          // Photos get scaled at print time; ask viewers/printers to smooth.
          `${image.filter === "DCTDecode" ? "/Interpolate true " : ""}` +
          `${image.filter ? `/Filter /${image.filter} ` : ""}/Length ${image.data.length} >>\nstream\n`,
      );
      push(image.data);
      push("\nendstream\nendobj\n");
    });

    obj(infoObj, `<< /Title ${pdfTextString(title)} /Producer (Recipe Tabulator) >>`);

    const xrefOffset = offset;
    push(`xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`);
    for (let n = 1; n <= totalObjs; n++) {
      push(`${offsets[n].toString().padStart(10, "0")} 00000 n \n`);
    }
    push(
      `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`,
    );

    return new Blob(chunks, { type: "application/pdf" });
  }
}
