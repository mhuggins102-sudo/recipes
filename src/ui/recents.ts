import type { RecipeTree } from "../../shared/schema";

export interface RecentEntry {
  id: string;
  title: string;
  ts: number;
  recipe: RecipeTree;
}

const KEY = "recipe-tabulator:recents";
const MAX_ENTRIES = 20;

function load(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

function store(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Quota exceeded — drop the oldest half and retry once.
    try {
      localStorage.setItem(KEY, JSON.stringify(entries.slice(0, Math.ceil(MAX_ENTRIES / 2))));
    } catch {
      /* give up quietly */
    }
  }
}

export function listRecents(): RecentEntry[] {
  return load();
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
