# Recipe Tabulator 📐

Turn any recipe — a web link, pasted text, a photo of a cookbook page, even a
handwritten card — into the ["Cooking for Engineers"](https://www.cookingforengineers.com/)
tabular notation: ingredients down the left, each action (melt, mix, fold in,
bake…) as a cell spanning everything that goes into it.

## How it works

1. **Ingest** — URLs are fetched server-side; pages with `schema.org/Recipe`
   JSON-LD are digested directly, otherwise the visible text is used. Photos
   and PDFs go straight to the model (handwriting works).
2. **Structure** — one Anthropic Messages API call turns the recipe into a
   tree: ingredients are leaves, every action is a node combining its children.
   The JSON shape is specified in the prompt and enforced with Zod plus one
   repair round-trip (not structured outputs — the tree type is recursive,
   which its schemas can't express).
3. **Render** — a deterministic layout algorithm turns the tree into the
   nested table (column = node height, rowspan = leaf count). No AI involved.

Every cell is editable in place, structural changes go through the Edit JSON
panel, results are kept in localStorage, and printing is styled.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars   # add your Anthropic API key
npm run dev                       # wrangler (functions, :8788) + vite (app, :5173)
```

Open http://localhost:5173. Run tests with `npm test`, typecheck with
`npm run typecheck`.

## Deploy (Cloudflare Pages)

1. Create a Pages project connected to this repo — build command
   `npm run build`, output directory `dist` (also declared in `wrangler.toml`).
2. Check that the **Production branch** (Settings → Build → Branch control)
   is `main`. Pages copies the repo's default branch at connection time — if
   another branch was default back then, every push to `main` builds only as
   a Preview and the production URL keeps serving old code. Changing the
   setting doesn't redeploy anything; the next push to `main` does.
3. Add `ANTHROPIC_API_KEY` as an **encrypted secret** in the Pages project
   (Settings → Environment variables). It's only ever used server-side in
   `functions/api/convert.ts`. Scope it to **Production** (or both
   environments) — a variable added only to Preview doesn't exist in
   production.
4. Alternatively deploy from your machine: `npm run deploy`.

## Cost & model

The model is a single constant in `shared/schema.ts` (`MODEL`). Default is
`claude-sonnet-5` (~1–3¢ per conversion); switch to `claude-opus-5` (~2.5x the
price) if you ever hit a recipe Sonnet structures poorly. Everything else —
URL parsing, rendering, editing — costs nothing, and conversions that fail
before reaching the model (bad URL, blocked site) aren't billed.

## Troubleshooting

- **A URL won't convert.** Some recipe sites block all server-side readers.
  The app retries via the page's latest Internet Archive snapshot; if the site
  is blocked *and* unarchived, copy the page text into the Paste tab or
  screenshot it for the Photo/PDF tab — those paths always work.

## Layout of the code

```
shared/schema.ts        recipe-tree types, Zod validator, system prompt
shared/extract.ts       JSON-LD digest + HTML-to-text fallback (pure, unit-tested)
functions/api/convert.ts  POST /api/convert — ingestion, model call, validation
src/render/layout.ts    tree → grid (the format's correctness lives here)
src/render/table.ts     grid → <table> with data-path attrs for editing
src/ui/…                input tabs, image downscale, inline editor, recents
test/                   golden tests for layout + JSON-LD variants
```
