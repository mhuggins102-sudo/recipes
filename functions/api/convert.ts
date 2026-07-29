import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL,
  RecipeTreeZ,
  SYSTEM_PROMPT,
  recipeJsonSchema,
  type RecipeTree,
} from "../../shared/schema";
import { extractJsonLdRecipe, stripHtmlToText, truncate } from "../../shared/extract";

interface Env {
  ANTHROPIC_API_KEY?: string;
  /** Optional override, e.g. a mock server in tests. */
  ANTHROPIC_BASE_URL?: string;
}

interface ConvertRequest {
  type: "url" | "text" | "image" | "pdf";
  /** URL, pasted text, or base64 data (no data-URL prefix). */
  payload: string;
  mediaType?: string;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API per-image cap
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error, ...extra }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError(500, "Server is not configured with an ANTHROPIC_API_KEY.");
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return jsonError(413, "Request too large (max 8 MB).");
  }

  let body: ConvertRequest;
  try {
    body = (await request.json()) as ConvertRequest;
  } catch {
    return jsonError(400, "Body must be JSON.");
  }
  if (!body || typeof body.payload !== "string" || body.payload.trim() === "") {
    return jsonError(400, "Missing payload.");
  }

  try {
    const content = await buildUserContent(body);
    const recipe = await convertWithModel(env, content);
    return Response.json({ recipe });
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.status, err.message);
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) {
        const retryAfter = err.headers?.get?.("retry-after") ?? undefined;
        return jsonError(429, "The converter is busy right now — try again in a minute.", {
          retryAfter,
        });
      }
      return jsonError(502, "The conversion model is temporarily unavailable. Try again shortly.");
    }
    console.error("convert failed", err);
    return jsonError(500, "Unexpected server error.");
  }
};

type ContentBlock = Anthropic.Messages.ContentBlockParam;

const TASK =
  "Convert the following recipe into the JSON recipe tree format described in your instructions.";

async function buildUserContent(body: ConvertRequest): Promise<ContentBlock[]> {
  switch (body.type) {
    case "text":
      return [{ type: "text", text: `${TASK}\n\n${truncate(body.payload)}` }];
    case "url": {
      const digest = await ingestUrl(body.payload);
      return [{ type: "text", text: `${TASK}\n\n${digest}` }];
    }
    case "image": {
      const mediaType = body.mediaType ?? "";
      if (!IMAGE_TYPES.has(mediaType)) {
        throw new HttpError(400, "Unsupported image type; use JPEG, PNG, WebP, or GIF.");
      }
      if (base64Bytes(body.payload) > MAX_IMAGE_BYTES) {
        throw new HttpError(413, "Image too large (max 5 MB).");
      }
      return [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
            data: body.payload,
          },
        },
        {
          type: "text",
          text: `${TASK} The image may be a photographed cookbook page or a handwritten recipe card — read it carefully, including handwriting.`,
        },
      ];
    }
    case "pdf":
      return [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: body.payload },
        },
        { type: "text", text: TASK },
      ];
    default:
      throw new HttpError(400, "type must be one of: url, text, image, pdf.");
  }
}

// --- URL ingestion --------------------------------------------------------

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\]|\[fc|\[fd|\[fe80)|^172\.(1[6-9]|2\d|3[01])\./i;

function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Only http(s) URLs are supported.");
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host) || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    throw new HttpError(400, "That host isn't reachable from here.");
  }
  return url;
}

async function ingestUrl(raw: string): Promise<string> {
  const url = assertPublicHttpUrl(raw);
  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; RecipeTabulator/0.1; +https://github.com/mhuggins102-sudo/recipes)",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    throw new HttpError(502, "Couldn't fetch that URL — paste the recipe text instead.");
  }
  if (!resp.ok) {
    throw new HttpError(
      502,
      `That site answered with ${resp.status} — it may block robots. Paste the recipe text instead.`,
    );
  }
  const html = await readCapped(resp, MAX_PAGE_BYTES);
  const jsonLd = extractJsonLdRecipe(html);
  if (jsonLd) return jsonLd;
  const text = stripHtmlToText(html);
  if (text.length < 100) {
    throw new HttpError(
      422,
      "Couldn't find recipe content on that page — paste the recipe text instead.",
    );
  }
  return `The following is unstructured text extracted from a web page; find the recipe in it.\n\n${text}`;
}

async function readCapped(resp: Response, maxBytes: number): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return out + decoder.decode();
}

function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

// --- Model call -----------------------------------------------------------

async function convertWithModel(env: Env, content: ContentBlock[]): Promise<RecipeTree> {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
  });

  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content }];
  let lastValidationError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: recipeJsonSchema },
      },
      messages,
    } as Anthropic.Messages.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") {
      throw new HttpError(422, "The model declined to process this input.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new HttpError(502, "Conversion output was truncated — try a shorter recipe.");
    }

    const text = response.content.find(
      (b): b is Anthropic.Messages.TextBlock => b.type === "text",
    )?.text;
    if (!text) throw new HttpError(502, "The model returned no output.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastValidationError = "output was not valid JSON";
      messages.push(
        { role: "assistant", content: text },
        { role: "user", content: "That was not valid JSON. Return only the corrected JSON object." },
      );
      continue;
    }

    const result = RecipeTreeZ.safeParse(parsed);
    if (result.success) return result.data;

    lastValidationError = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    messages.push(
      { role: "assistant", content: text },
      {
        role: "user",
        content: `That JSON failed validation: ${lastValidationError}. Return the corrected JSON object only.`,
      },
    );
  }

  throw new HttpError(422, `Couldn't produce a valid recipe tree (${lastValidationError}).`);
}
