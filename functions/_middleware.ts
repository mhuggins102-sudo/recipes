// Per-IP daily cap on conversions. /api/convert spends real money per call
// (a model conversion), so an uncapped public endpoint is an open proxy to
// the site's Anthropic account. This bounds worst-case abuse to
// DAILY_CAP × a few cents per IP per day.
//
// KV is eventually consistent, so the counter is approximate by design —
// the goal is killing the economics of scripted abuse, not exact quotas.
// Requires a KV namespace bound as RATE_KV (see wrangler.toml / README);
// when unbound (e.g. plain local dev), the guard is skipped entirely.

interface Env {
  RATE_KV?: KVNamespace;
}

/** One 10-card album + retries + a day of normal single conversions. */
const DAILY_CAP = 40;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (
    request.method !== "POST" ||
    new URL(request.url).pathname !== "/api/convert" ||
    !env.RATE_KV
  ) {
    return context.next();
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${ip}:${day}`;
  const count = Number((await env.RATE_KV.get(key)) ?? "0");
  if (count >= DAILY_CAP) {
    // Same shape as convert.ts's jsonError; the client renders 429 sanely.
    return Response.json(
      { error: "Daily free conversion limit reached — please try again tomorrow." },
      { status: 429 },
    );
  }
  await env.RATE_KV.put(key, String(count + 1), { expirationTtl: 2 * 86400 });
  return context.next();
};
