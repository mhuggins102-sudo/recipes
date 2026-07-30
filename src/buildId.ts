// Build identifier stamped into generated PDFs (Producer metadata), so a
// PDF always reveals which deployment produced it. Cloudflare Pages sets
// CF_PAGES_COMMIT_SHA at build time; vite.config.ts injects it here.
declare const __BUILD_ID__: string | undefined;

export const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
