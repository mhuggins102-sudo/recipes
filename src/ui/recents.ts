import type { RecipeTree } from "../../shared/schema";
import type { ViewOptions } from "../quantity";

export interface RecentEntry {
  id: string;
  title: string;
  ts: number;
  /** Favorited entries pin to the top of the list and are never auto-evicted. */
  fav?: boolean;
  /** View options the user chose for this recipe; absent = the defaults. */
  view?: ViewOptions;
  recipe: RecipeTree;
}

const KEY = "recipe-tabulator:recents";
const MAX_ENTRIES = 40;

function load(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

/** Enforce the cap, evicting least-recently-used non-favorites first (entries are MRU-first). */
function capped(entries: RecentEntry[], max: number): RecentEntry[] {
  if (entries.length <= max) return entries;
  const favs = entries.filter((e) => e.fav);
  const rest = entries.filter((e) => !e.fav).slice(0, Math.max(0, max - favs.length));
  const keep = new Set([...favs, ...rest].map((e) => e.id));
  return entries.filter((e) => keep.has(e.id)).slice(0, max);
}

function store(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(capped(entries, MAX_ENTRIES)));
  } catch {
    // Quota exceeded — drop to half capacity and retry once.
    try {
      localStorage.setItem(KEY, JSON.stringify(capped(entries, Math.ceil(MAX_ENTRIES / 2))));
    } catch {
      /* give up quietly */
    }
  }
}

/** Most recently added/viewed first, as stored; favorites are not reordered here — that's display policy. */
export function listRecents(): RecentEntry[] {
  return load();
}

/** Move an entry to the front — viewing counts as recency for display and eviction. */
export function touchRecent(id: string): void {
  const entries = load();
  const i = entries.findIndex((e) => e.id === id);
  if (i <= 0) return; // absent, or already first
  const [entry] = entries.splice(i, 1);
  entries.unshift(entry);
  store(entries);
}

export function saveRecent(recipe: RecipeTree): string {
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  store([{ id, title: recipe.title, ts: Date.now(), recipe }, ...load()]);
  return id;
}

export function updateRecent(id: string, recipe: RecipeTree): void {
  const entries = load();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.recipe = recipe;
  entry.title = recipe.title;
  store(entries);
}

export function getRecent(id: string): RecipeTree | undefined {
  return load().find((e) => e.id === id)?.recipe;
}

export function getRecentView(id: string): ViewOptions | undefined {
  return load().find((e) => e.id === id)?.view;
}

/** Remember the view options (units/numbers/steps/scale) chosen for one recipe. */
export function updateRecentView(id: string, view: ViewOptions): void {
  const entries = load();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.view = view;
  store(entries);
}

export function toggleFavorite(id: string): void {
  const entries = load();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.fav = !entry.fav;
  store(entries);
}

export function removeRecent(id: string): void {
  store(load().filter((e) => e.id !== id));
}
