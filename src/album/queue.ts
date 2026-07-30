import { convert } from "../api";
import { blobToBase64 } from "../ui/image";
import { getCard, getCards, updateCard, type AlbumRecord, type CardRecord } from "./store";

// Client-driven fan-out: the server holds one conversion per request (with a
// hard 270 s deadline), so an album is a queue of single /api/convert calls.

/** Stage A free cap. */
export const ALBUM_MAX_CARDS = 10;

/** First card runs alone so its call writes the prompt cache; then 2 in flight. */
const RAMPED_CONCURRENCY = 2;
const AUTO_RETRIES = 1;
const RETRY_DELAY_MS = 5000;

export interface AlbumQueue {
  /** Resume after a 429 pause (or start converting newly added cards). */
  kick(): void;
  /** True while any conversion is in flight or queued. */
  readonly active: boolean;
  /** Set after a 429 — the server's message; cleared by kick(). */
  readonly pausedReason: string | null;
}

/** Base64 payload for a card's photo; one fresh-read retry covers WebKit's
    stale file-backed blobs in legacy (pre-inline-bytes) albums. */
async function imagePayload(card: CardRecord): Promise<string> {
  try {
    return await blobToBase64(card.image);
  } catch {
    const fresh = await getCard(card.id);
    return blobToBase64(fresh?.image ?? card.image);
  }
}

export function createAlbumQueue(
  album: AlbumRecord,
  onCardUpdate: (card: CardRecord, phaseText?: string) => void,
  onIdle: () => void,
): AlbumQueue {
  let inFlight = 0;
  let cachePrimed = false;
  let pausedReason: string | null = null;
  const attempts = new Map<string, number>();
  /** Cards already launched this session — fill() is async, so two overlapping
      calls could otherwise read the same "queued" state and double-convert. */
  const launched = new Set<string>();

  async function convertCard(card: CardRecord): Promise<void> {
    card.state = "converting";
    card.error = undefined;
    await updateCard(card);
    onCardUpdate(card, "Converting…");
    try {
      const recipe = await convert(
        { type: "image", payload: await imagePayload(card), mediaType: "image/jpeg" },
        () => onCardUpdate(card, "Reading the card…"),
      );
      card.recipe = recipe;
      card.state = "done";
      await updateCard(card);
      onCardUpdate(card);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/limit reached|busy/i.test(message)) {
        // Rate-limited: hold the whole queue instead of burning retries.
        pausedReason = message;
      }
      const attempt = (attempts.get(card.id) ?? 0) + 1;
      attempts.set(card.id, attempt);
      if (!pausedReason && attempt <= AUTO_RETRIES) {
        card.state = "queued";
        await updateCard(card);
        onCardUpdate(card, "Retrying shortly…");
        setTimeout(fill, RETRY_DELAY_MS);
      } else {
        card.state = pausedReason ? "queued" : "error";
        card.error = pausedReason ? undefined : message;
        await updateCard(card);
        onCardUpdate(card);
      }
    } finally {
      launched.delete(card.id);
      inFlight--;
      fill();
    }
  }

  function fill(): void {
    if (pausedReason) {
      if (inFlight === 0) onIdle();
      return;
    }
    void (async () => {
      const cards = await getCards(album);
      const queued = cards.filter((c) => c.state === "queued" && !launched.has(c.id));
      const limit = cachePrimed ? RAMPED_CONCURRENCY : 1;
      while (inFlight < limit && queued.length) {
        const card = queued.shift()!;
        launched.add(card.id);
        inFlight++;
        void convertCard(card).then(() => {
          cachePrimed = true;
        });
        if (!cachePrimed) break; // first card runs alone
      }
      if (inFlight === 0 && !queued.length) onIdle();
    })();
  }

  return {
    kick() {
      pausedReason = null;
      fill();
    },
    get active() {
      return inFlight > 0;
    },
    get pausedReason() {
      return pausedReason;
    },
  };
}
