import type { ConvertRequest } from "../api";

const MAX_EDGE = 2000; // px — plenty for the model's high-res vision
const JPEG_QUALITY = 0.85;
const MAX_PDF_BYTES = 6 * 1024 * 1024;

export interface DownscaledImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Downscale an image to maxEdge and re-encode as JPEG on a canvas (keeps
 * payloads small and strips EXIF). Also used by the album flow, which stores
 * the resulting blob and later embeds those exact bytes in the cookbook PDF.
 */
export async function downscaleImage(source: Blob, maxEdge = MAX_EDGE): Promise<DownscaledImage> {
  const bitmap = await createImageBitmap(source).catch(() => {
    throw new Error("Couldn't read that image file.");
  });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Couldn't process that image.");
  return { blob, width: canvas.width, height: canvas.height };
}

/** Base64 without the data-URL prefix — the payload format /api/convert expects. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(blob);
  });
}

/** Turn an uploaded file into a ConvertRequest (single-recipe flow). */
export async function fileToRequest(file: File): Promise<ConvertRequest> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF too large (max 6 MB).");
    return { type: "pdf", payload: await blobToBase64(file), mediaType: file.type };
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload an image (photo of a recipe) or a PDF.");
  }
  const { blob } = await downscaleImage(file);
  return { type: "image", payload: await blobToBase64(blob), mediaType: "image/jpeg" };
}
