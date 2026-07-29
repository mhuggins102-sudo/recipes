import type { RecipeTree } from "../shared/schema";

export interface ConvertRequest {
  type: "url" | "text" | "image" | "pdf";
  payload: string;
  mediaType?: string;
}

export async function convert(req: ConvertRequest, signal?: AbortSignal): Promise<RecipeTree> {
  let resp: Response;
  try {
    resp = await fetch("/api/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error("Network error — is the server running?");
  }
  const data = (await resp.json().catch(() => null)) as
    | { recipe?: RecipeTree; error?: string }
    | null;
  if (!resp.ok || !data?.recipe) {
    throw new Error(data?.error ?? `Conversion failed (HTTP ${resp.status}).`);
  }
  return data.recipe;
}
