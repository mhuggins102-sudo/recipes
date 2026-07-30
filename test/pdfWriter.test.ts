import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PdfWriter } from "../src/export/pdfWriter";

// Byte-level validation of the hand-rolled writer: header, xref offsets,
// stream lengths, page tree, and filter passthrough. The writer is DOM-free
// on purpose so this suite runs in plain Node.

async function build() {
  const writer = new PdfWriter();
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
  const jpeg = writer.addJpeg(jpegBytes, 10, 8);
  const rgb = new Uint8Array(4 * 4 * 3).fill(200);
  const raw = await writer.addRgb(rgb, 4, 4);
  writer.addPage(576, 720, [
    { image: jpeg, x: 54, y: 400, w: 300, h: 240 },
    { image: raw, x: 54, y: 100, w: 486, h: 200 },
  ]);
  writer.addPage(576, 720, [{ image: raw, x: 36, y: 36, w: 486, h: 648 }]);
  writer.addPage(576, 720, [{ image: jpeg, x: 36, y: 36, w: 200, h: 160 }]);
  const blob = writer.finish("Test Book ½ 📐");
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { buf, text: Buffer.from(buf).toString("latin1"), jpegBytes, rgb };
}

describe("PdfWriter", () => {
  it("emits a structurally valid 3-page document", async () => {
    const { buf, text } = await build();

    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(buf[9]).toBe(0x25); // binary marker comment follows the header
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("/Count 3");
    expect(text).toContain("/MediaBox [0 0 576 720]");

    // startxref points at the xref table…
    const sx = text.match(/startxref\n(\d+)\n%%EOF\n$/);
    expect(sx).toBeTruthy();
    expect(text.slice(Number(sx![1]), Number(sx![1]) + 5)).toBe("xref\n");

    // …and every in-use entry points at its numbered object.
    const entries = text.slice(Number(sx![1])).match(/^\d{10} 00000 n $/gm)!;
    entries.forEach((entry, i) => {
      const offset = parseInt(entry, 10);
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });

    // Trailer resolves the catalog and info objects.
    const trailer = text.match(/trailer\n<< \/Size (\d+) \/Root 1 0 R \/Info (\d+) 0 R >>/)!;
    expect(Number(trailer[1])).toBe(entries.length + 1);
    expect(text).toContain(`${trailer[2]} 0 obj\n<< /Title <FEFF`);
  });

  it("passes JPEG bytes through DCTDecode unmodified", async () => {
    const { buf, text, jpegBytes } = await build();
    const m = text.match(
      /<< \/Type \/XObject \/Subtype \/Image \/Width 10 \/Height 8 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Interpolate true \/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/,
    )!;
    expect(Number(m[1])).toBe(jpegBytes.length);
    const start = m.index! + m[0].length;
    expect(Array.from(buf.slice(start, start + jpegBytes.length))).toEqual(Array.from(jpegBytes));
    expect(text.slice(start + jpegBytes.length, start + jpegBytes.length + 11)).toBe("\nendstream\n");
  });

  it("deflates RGB rasters losslessly (FlateDecode)", async () => {
    const { buf, text, rgb } = await build();
    const m = text.match(
      /\/Width 4 \/Height 4 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/,
    )!;
    const start = m.index! + m[0].length;
    const inflated = inflateSync(buf.slice(start, start + Number(m[1])));
    expect(Array.from(inflated)).toEqual(Array.from(rgb));
  });

  it("paints page backgrounds and photo frames as vector ops", async () => {
    const writer = new PdfWriter();
    const img = writer.addJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 4, 4);
    writer.addPage(576, 720, [{ image: img, x: 100, y: 100, w: 200, h: 150 }], {
      background: [0.98, 0.96, 0.91],
      frames: [{ x: 100, y: 100, w: 200, h: 150, color: [0.42, 0.35, 0.25], width: 1 }],
    });
    const blob = writer.finish("Themed");
    const text = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    expect(text).toContain("q\n0.98 0.96 0.91 rg\n0 0 576 720 re\nf\nQ\n");
    expect(text).toContain("q\n0.42 0.35 0.25 RG\n1 w\n100 100 200 150 re\nS\nQ\n");
    // Background paints before the image, the frame after it.
    expect(text.indexOf(" rg\n")).toBeLessThan(text.indexOf(" cm\n"));
    expect(text.indexOf(" RG\n")).toBeGreaterThan(text.indexOf(" cm\n"));
  });

  it("emits no paint ops when a page has no options", async () => {
    const { text } = await build();
    expect(text).not.toContain(" re\nf\n");
    expect(text).not.toContain(" re\nS\n");
  });

  it("declares per-page image resources and placements", async () => {
    const { text } = await build();
    // Page 1 uses both images; pages 2 and 3 one each.
    const resources = [...text.matchAll(/\/XObject << ([^>]*) >>/g)].map((m) => m[1].trim());
    expect(resources).toHaveLength(3);
    expect(resources[0]).toContain("/Im0");
    expect(resources[0]).toContain("/Im1");
    expect(resources[1]).not.toContain("/Im0");
    // Content streams place with a cm matrix then Do.
    expect(text).toContain("q\n300 0 0 240 54 400 cm\n/Im0 Do\nQ\n");
  });
});
