import type { ConvertRequest } from "../api";

const MAX_EDGE = 2000; // px — plenty for the model's high-res vision
const JPEG_QUALITY = 0.85;
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/**
 * Turn an uploaded file into a ConvertRequest: images are downscaled and
 * re-encoded as JPEG on a canvas (keeps payloads small and strips EXIF);
 * PDFs are passed through as base64.
 */
export async function fileToRequest(file: File): Promise<ConvertRequest> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF too large (max 6 MB).");
    return { type: "pdf", payload: await toBase64(file), mediaType: file.type };
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload an image (photo of a recipe) or a PDF.");
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Couldn't read that image file.");
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return {
    type: "image",
    payload: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mediaType: "image/jpeg",
  };
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}
