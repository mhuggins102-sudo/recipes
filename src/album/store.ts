import type { RecipeTree } from "../../shared/schema";
import type { ViewOptions } from "../quantity";

// IndexedDB persistence for cookbook albums. localStorage (recents) can't
// hold an album's worth of photos; IDB stores the downscaled JPEGs as Blobs.
// Card rows are written at intake, before any conversion runs, so a refresh
// never loses photos.

export type CardState = "queued" | "converting" | "done" | "error";

export interface AlbumRecord {
  id: string;
  /** Cookbook title. */
  title: string;
  author?: string;
  /** Book design theme id (see export/bookThemes.ts); absent = standard. */
  theme?: string;
  includeToc: boolean;
  createdAt: number;
  updatedAt: number;
  /** Page order for the book; card ids. */
  cardOrder: string[];
}

export interface CardRecord {
  id: string;
  albumId: string;
  /** Downscaled JPEG — the same bytes later embedded in the cookbook PDF. */
  image: Blob;
  imageW: number;
  imageH: number;
  /** ~320px JPEG for grids, so lists don't decode full-size photos. */
  thumb: Blob;
  state: CardState;
  /** Last failure message, for the retry UI. */
  error?: string;
  /** Set on conversion success; edited in place during review. */
  recipe?: RecipeTree;
  /** Per-card view options, same semantics as RecentEntry.view. */
  view?: ViewOptions;
  reviewed: boolean;
  /** Included in the generated book (default true). */
  included: boolean;
  updatedAt: number;
}

// Photos are persisted as INLINE bytes, not Blobs: Safari stores large IDB
// blobs as file references whose handles go stale under memory pressure
// ("The object can not be found here." — broken review photos, failed book
// generation). ArrayBuffers are structured-cloned by value, so a Blob
// reconstructed from them at read time can never go stale.
interface PackedBlob {
  packed: true;
  type: string;
  bytes: ArrayBuffer;
}

type StoredMedia = Blob | PackedBlob;

type StoredCard = Omit<CardRecord, "image" | "thumb"> & {
  image: StoredMedia;
  thumb: StoredMedia;
};

function isPacked(value: StoredMedia): value is PackedBlob {
  return (value as PackedBlob)?.packed === true;
}

async function packMedia(blob: Blob): Promise<StoredMedia> {
  try {
    return { packed: true, type: blob.type, bytes: await blob.arrayBuffer() };
  } catch {
    // Reading a legacy stale blob mid-migration failed — keep it as-is
    // (no worse than before; a later update retries).
    return blob;
  }
}

function unpackMedia(value: StoredMedia): Blob {
  return isPacked(value) ? new Blob([value.bytes], { type: value.type }) : value;
}

async function packCard(card: CardRecord): Promise<StoredCard> {
  return { ...card, image: await packMedia(card.image), thumb: await packMedia(card.thumb) };
}

function unpackCard(stored: StoredCard): CardRecord {
  return { ...stored, image: unpackMedia(stored.image), thumb: unpackMedia(stored.thumb) };
}

const DB_NAME = "recipe-tabulator";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("albums", { keyPath: "id" });
      const cards = db.createObjectStore("cards", { keyPath: "id" });
      cards.createIndex("byAlbum", "albumId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wait<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function createAlbum(title = "Family Recipes"): Promise<AlbumRecord> {
  const album: AlbumRecord = {
    id: newId("a"),
    title,
    includeToc: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cardOrder: [],
  };
  const db = await openDb();
  const tx = db.transaction("albums", "readwrite");
  tx.objectStore("albums").add(album);
  await done(tx);
  // Best-effort: ask the browser not to evict an in-progress album.
  void navigator.storage?.persist?.();
  return album;
}

export async function getAlbum(id: string): Promise<AlbumRecord | undefined> {
  const db = await openDb();
  return wait(db.transaction("albums").objectStore("albums").get(id));
}

export async function listAlbums(): Promise<AlbumRecord[]> {
  const db = await openDb();
  const all = await wait<AlbumRecord[]>(db.transaction("albums").objectStore("albums").getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateAlbum(album: AlbumRecord): Promise<void> {
  album.updatedAt = Date.now();
  const db = await openDb();
  const tx = db.transaction("albums", "readwrite");
  tx.objectStore("albums").put(album);
  await done(tx);
}

export async function deleteAlbum(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["albums", "cards"], "readwrite");
  tx.objectStore("albums").delete(id);
  const index = tx.objectStore("cards").index("byAlbum");
  const cards = await wait<StoredCard[]>(index.getAll(id));
  for (const card of cards) tx.objectStore("cards").delete(card.id);
  await done(tx);
}

/** Persist a photo as a queued card and append it to the album's page order. */
export async function addCard(
  album: AlbumRecord,
  image: { blob: Blob; width: number; height: number },
  thumb: Blob,
): Promise<CardRecord> {
  const card: CardRecord = {
    id: newId("c"),
    albumId: album.id,
    image: image.blob,
    imageW: image.width,
    imageH: image.height,
    thumb,
    state: "queued",
    reviewed: false,
    included: true,
    updatedAt: Date.now(),
  };
  album.cardOrder.push(card.id);
  album.updatedAt = Date.now();
  const stored = await packCard(card);
  const db = await openDb();
  const tx = db.transaction(["albums", "cards"], "readwrite");
  tx.objectStore("cards").add(stored);
  tx.objectStore("albums").put(album);
  await done(tx);
  return card;
}

export async function getCard(id: string): Promise<CardRecord | undefined> {
  const db = await openDb();
  const stored = await wait<StoredCard | undefined>(
    db.transaction("cards").objectStore("cards").get(id),
  );
  return stored && unpackCard(stored);
}

/** All cards of an album, in the album's cardOrder. */
export async function getCards(album: AlbumRecord): Promise<CardRecord[]> {
  const db = await openDb();
  const rows = await wait<StoredCard[]>(
    db.transaction("cards").objectStore("cards").index("byAlbum").getAll(album.id),
  );
  const byId = new Map(rows.map((c) => [c.id, unpackCard(c)]));
  return album.cardOrder.map((id) => byId.get(id)).filter((c): c is CardRecord => !!c);
}

export async function updateCard(card: CardRecord): Promise<void> {
  card.updatedAt = Date.now();
  // Packing here also migrates legacy Blob-format cards on their next update.
  const stored = await packCard(card);
  const db = await openDb();
  const tx = db.transaction("cards", "readwrite");
  tx.objectStore("cards").put(stored);
  await done(tx);
}

export async function deleteCard(album: AlbumRecord, cardId: string): Promise<void> {
  album.cardOrder = album.cardOrder.filter((id) => id !== cardId);
  album.updatedAt = Date.now();
  const db = await openDb();
  const tx = db.transaction(["albums", "cards"], "readwrite");
  tx.objectStore("cards").delete(cardId);
  tx.objectStore("albums").put(album);
  await done(tx);
}
