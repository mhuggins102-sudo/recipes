import type { RecipeTree } from "../shared/schema";

export interface ConvertRequest {
  type: "url" | "text" | "image" | "pdf";
  payload: string;
  mediaType?: string;
}

export type ConvertPhase = "fetching" | "archive" | "model" | "revalidating";

const STALL_MS = 30_000; // server pings every 10 s; silence means a dead link
const OVERALL_MS = 300_000;

/**
 * Run a conversion. The endpoint streams NDJSON progress events (phases and
 * keepalive pings) and ends with a single result or error event; early
 * validation failures arrive as ordinary JSON error responses instead.
 */
export async function convert(
  req: ConvertRequest,
  onPhase?: (phase: ConvertPhase) => void,
): Promise<RecipeTree> {
  const controller = new AbortController();
  const abortWith = (message: string) => controller.abort(new Error(message));
  const overall = setTimeout(
    () => abortWith("Conversion took more than 5 minutes — try the Paste text tab instead."),
    OVERALL_MS,
  );
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => abortWith("Lost contact with the converter — try again."), STALL_MS);
  };

  try {
    const resp = await fetch("/api/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!(resp.headers.get("content-type") ?? "").includes("ndjson")) {
      const data = (await resp.json().catch(() => null)) as
        | { recipe?: RecipeTree; error?: string }
        | null;
      if (!resp.ok || !data?.recipe) {
        throw new Error(data?.error ?? `Conversion failed (HTTP ${resp.status}).`);
      }
      return data.recipe;
    }

    kick();
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      kick();
      buf += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, newline).trim();
        buf = buf.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line) as
          | { type: "phase"; phase: ConvertPhase }
          | { type: "ping"; t: number }
          | { type: "result"; recipe: RecipeTree }
          | { type: "error"; status: number; message: string };
        if (event.type === "phase") onPhase?.(event.phase);
        else if (event.type === "result") return event.recipe;
        else if (event.type === "error") throw new Error(event.message);
      }
    }
    throw new Error("The converter closed the connection unexpectedly — try again.");
  } catch (err) {
    if (controller.signal.aborted) {
      const reason: unknown = controller.signal.reason;
      throw reason instanceof Error ? reason : new Error("Conversion timed out — try again.");
    }
    if (err instanceof TypeError) {
      throw new Error("Network error — is the server running?");
    }
    throw err;
  } finally {
    clearTimeout(overall);
    clearTimeout(watchdog);
  }
}
