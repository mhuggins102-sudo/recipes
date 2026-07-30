import { RecipeTreeZ, type RecipeTree } from "../../shared/schema";
import { createAlbumQueue, ALBUM_MAX_CARDS, type AlbumQueue } from "../album/queue";
import {
  addCard,
  deleteCard,
  getCard,
  getCards,
  updateAlbum,
  updateCard,
  type AlbumRecord,
  type CardRecord,
} from "../album/store";
import { exportCookbookPdf, photoPrintDpi } from "../export/bookPdf";
import { BOOK_THEMES } from "../export/bookThemes";
import { downloadFile } from "../export/image";
import { applyView, unscaleQuantity, type ViewOptions } from "../quantity";
import { renderInstructions } from "../render/instructions";
import { renderTable } from "../render/table";
import { enableInlineEditing } from "./editor";
import { downscaleImage } from "./image";
import { createViewBar, INITIAL_VIEW } from "./viewBar";

// The cookbook album flow: photo intake + conversion progress, a per-card
// review pass (photo beside the engineered table), and the book builder.

const THUMB_EDGE = 320;
const LOW_DPI = 300;

export interface AlbumView {
  el: HTMLElement;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, label: string): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  return b;
}

const STATE_BADGE: Record<CardRecord["state"], string> = {
  queued: "queued",
  converting: "converting…",
  done: "✓",
  error: "failed",
};

export function createAlbumView(album: AlbumRecord): AlbumView {
  const root = el("section", "album");
  let cards: CardRecord[] = [];
  let selectedId: string | null = null;
  const phaseText = new Map<string, string>();
  // One object URL per photo, reused across re-renders — minting fresh URLs
  // on every render leaked hundreds of live blob URLs per album, and under
  // memory pressure Safari evicts their decoded images (broken-image flash).
  const blobUrls = new Map<string, string>();

  const queue: AlbumQueue = createAlbumQueue(
    album,
    (card, phase) => {
      const i = cards.findIndex((c) => c.id === card.id);
      if (i >= 0) cards[i] = card;
      if (phase) phaseText.set(card.id, phase);
      else phaseText.delete(card.id);
      renderGrid();
      renderQueueState();
      if (selectedId === card.id && card.state === "done") renderReview();
      renderBuilder();
      if (card.state === "done") autoSelectUnreviewed();
    },
    () => renderQueueState(),
  );

  /** Land the user in review as soon as there's something to check. */
  function autoSelectUnreviewed(): void {
    if (selectedId) return;
    const next = cards.find((c) => c.state === "done" && c.recipe && !c.reviewed);
    if (next) {
      selectedId = next.id;
      renderGrid();
      renderReview();
    }
  }

  function cachedUrl(key: string, blob: Blob): string {
    let url = blobUrls.get(key);
    if (!url) {
      url = URL.createObjectURL(blob);
      blobUrls.set(key, url);
    }
    return url;
  }

  /** A photo <img> that heals itself if the browser drops its blob. The
      retry re-READS the card from IndexedDB — a fresh read returns a fresh
      handle, the working workaround for WebKit's stale file-backed blobs
      in legacy (pre-inline-bytes) albums. */
  function photoImg(card: CardRecord, kind: "thumb" | "image", className?: string): HTMLImageElement {
    const key = `${card.id}:${kind}`;
    const img = el("img", className) as HTMLImageElement;
    img.decoding = "async";
    let retried = false;
    img.addEventListener("error", () => {
      if (retried) return;
      retried = true;
      const old = blobUrls.get(key);
      if (old) {
        URL.revokeObjectURL(old);
        blobUrls.delete(key);
      }
      void getCard(card.id).then((fresh) => {
        const blob = fresh?.[kind] ?? card[kind];
        setTimeout(() => {
          img.src = cachedUrl(key, blob);
        }, 300);
      });
    });
    img.src = cachedUrl(key, card[kind]);
    return img;
  }

  // --- Header ---------------------------------------------------------------

  const header = el("div", "album-header");
  const back = el("a", "album-back", "← Home");
  back.href = "#";
  const titleInput = el("input", "album-title") as HTMLInputElement;
  titleInput.value = album.title;
  titleInput.placeholder = "Cookbook title";
  titleInput.addEventListener("change", () => {
    album.title = titleInput.value.trim() || "Family Recipes";
    void updateAlbum(album);
  });
  header.append(back, titleInput);

  // --- Intake + progress ----------------------------------------------------

  const intake = el("div", "album-intake");
  const drop = el("div", "dropzone");
  const dropLabel = () =>
    `Add photos of recipe cards — up to ${ALBUM_MAX_CARDS} per album for now. ` +
    "Drop them here or click to choose (you can select many at once).";
  drop.textContent = dropLabel();
  const fileInput = el("input") as HTMLInputElement;
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    void addFiles(Array.from(e.dataTransfer?.files ?? []));
  });
  fileInput.addEventListener("change", () => {
    void addFiles(Array.from(fileInput.files ?? []));
    fileInput.value = "";
  });

  const intakeError = el("p", "hint album-error");
  const progress = el("p", "album-progress");
  const resume = button("primary", "Resume");
  resume.style.display = "none";
  resume.addEventListener("click", () => {
    resume.style.display = "none";
    queue.kick();
  });
  const grid = el("div", "album-grid");
  const gridHint = el(
    "p",
    "hint",
    "Click a card to check its conversion against the photo — every card in the book needs a quick review before the cookbook can be generated.",
  );
  gridHint.style.display = "none";
  intake.append(drop, fileInput, intakeError, progress, resume, grid, gridHint);

  async function addFiles(files: File[]): Promise<void> {
    intakeError.textContent = "";
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length < files.length) {
      intakeError.textContent = "Only photos go in an album — PDFs were skipped.";
    }
    const room = ALBUM_MAX_CARDS - cards.length;
    if (images.length > room) {
      intakeError.textContent = `Album limit is ${ALBUM_MAX_CARDS} cards — added the first ${room}.`;
    }
    for (const file of images.slice(0, Math.max(0, room))) {
      try {
        const image = await downscaleImage(file);
        const thumb = (await downscaleImage(image.blob, THUMB_EDGE)).blob;
        const card = await addCard(album, image, thumb);
        cards.push(card);
      } catch (err) {
        intakeError.textContent = err instanceof Error ? err.message : String(err);
      }
    }
    renderGrid();
    renderBuilder();
    queue.kick();
  }

  function renderQueueState(): void {
    const doneCount = cards.filter((c) => c.state === "done").length;
    progress.textContent = cards.length
      ? `${doneCount} of ${cards.length} converted`
      : "";
    if (queue.pausedReason) {
      progress.textContent += ` — paused: ${queue.pausedReason}`;
      resume.style.display = "";
    }
  }

  function renderGrid(): void {
    grid.innerHTML = "";
    gridHint.style.display = cards.length ? "" : "none";
    for (const card of cards) {
      const cell = el("figure", "album-card");
      if (card.id === selectedId) cell.classList.add("selected");
      const img = photoImg(card, "thumb");
      img.alt = card.recipe?.title ?? "recipe card";
      const badge = el(
        "figcaption",
        `badge ${card.state}`,
        phaseText.get(card.id) ?? STATE_BADGE[card.state],
      );
      if (card.state === "done") {
        badge.textContent = card.reviewed ? "✓ reviewed" : "needs review";
        badge.classList.toggle("review", !card.reviewed);
      }
      cell.append(img, badge);
      if (card.state === "error") {
        const retry = button("ghost", "Retry");
        retry.addEventListener("click", (e) => {
          e.stopPropagation();
          card.state = "queued";
          card.error = undefined;
          void updateCard(card).then(() => queue.kick());
          renderGrid();
        });
        cell.appendChild(retry);
        cell.title = card.error ?? "";
      }
      const del = button("del", "✕");
      del.title = "Remove this card";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm("Remove this card from the album?")) return;
        void deleteCard(album, card.id).then(() => {
          cards = cards.filter((c) => c.id !== card.id);
          if (selectedId === card.id) selectedId = null;
          renderGrid();
          renderReview();
          renderBuilder();
          renderQueueState();
        });
      });
      cell.appendChild(del);
      cell.addEventListener("click", () => {
        selectedId = card.id;
        renderGrid();
        renderReview();
        review.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      grid.appendChild(cell);
    }
  }

  // --- Review pass ----------------------------------------------------------

  const review = el("div", "album-review");
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  function renderReview(): void {
    review.innerHTML = "";
    const found = cards.find((c) => c.id === selectedId);
    if (!found) return;
    if (found.state !== "done" || !found.recipe) {
      review.appendChild(
        el("p", "hint", found.state === "error" ? `Conversion failed: ${found.error}` : "Converting…"),
      );
      return;
    }
    // Non-undefined alias — TS narrowing doesn't survive into the closures below.
    const card: CardRecord = found;

    const heading = el("h2", undefined, "Review against the card");
    const pane = el("div", "review-pane");
    const photo = photoImg(card, "image", "review-photo");
    photo.alt = "original recipe card";
    const work = el("div", "review-work");

    const view: ViewOptions = card.view ? { ...card.view } : { ...INITIAL_VIEW };
    const viewBar = createViewBar(() => {
      Object.assign(view, viewBar.view);
      card.view = { ...viewBar.view };
      void updateCard(card);
      renderTableAndInstructions();
    });
    viewBar.setView(view);

    const tableWrap = el("div", "table-wrap");
    const instrWrap = el("div", "instr-wrap");

    const persistSoon = () => {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => void updateCard(card), 800);
    };

    function renderTableAndInstructions(): void {
      tableWrap.innerHTML = "";
      instrWrap.innerHTML = "";
      const derived = applyView(card.recipe!, viewBar.view);
      tableWrap.appendChild(renderTable(derived, viewBar.view.labels));
      const instructions = renderInstructions(derived);
      if (instructions) instrWrap.appendChild(instructions);
      for (const container of [tableWrap, instrWrap]) {
        enableInlineEditing(container, () => card.recipe!, persistSoon, (text, kind) =>
          kind === "quantity" || kind === "servings" ? unscaleQuantity(text, viewBar.view) : text,
        );
      }
    }
    renderTableAndInstructions();

    const jsonBtn = button("ghost", "Edit JSON");
    const jsonEditor = el("textarea", "json-editor") as HTMLTextAreaElement;
    jsonEditor.style.display = "none";
    const jsonApply = button("primary", "Apply JSON");
    jsonApply.style.display = "none";
    const jsonError = el("p", "hint");
    jsonBtn.addEventListener("click", () => {
      const open = jsonEditor.style.display === "none";
      jsonEditor.style.display = open ? "" : "none";
      jsonApply.style.display = open ? "" : "none";
      jsonBtn.textContent = open ? "Hide JSON" : "Edit JSON";
      if (open) jsonEditor.value = JSON.stringify(card.recipe, null, 2);
      jsonError.textContent = "";
    });
    jsonApply.addEventListener("click", () => {
      try {
        card.recipe = RecipeTreeZ.parse(JSON.parse(jsonEditor.value)) as RecipeTree;
        void updateCard(card);
        jsonError.textContent = "Applied.";
        renderTableAndInstructions();
      } catch (err) {
        jsonError.textContent = `Invalid: ${err instanceof Error ? err.message : String(err)}`;
      }
    });

    const approve = button("primary", card.reviewed ? "Reviewed ✓" : "Looks good →");
    approve.addEventListener("click", () => {
      card.reviewed = true;
      void updateCard(card);
      const next = cards.find((c) => c.state === "done" && !c.reviewed && c.id !== card.id);
      selectedId = next?.id ?? null;
      renderGrid();
      renderReview();
      renderBuilder();
      if (!next) review.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    work.append(viewBar.el, tableWrap, instrWrap, jsonBtn, jsonEditor, jsonApply, jsonError, approve);
    pane.append(photo, work);
    review.append(heading, pane);
  }

  // --- Book builder ---------------------------------------------------------

  const builder = el("div", "album-builder");

  function renderBuilder(): void {
    builder.innerHTML = "";
    const done = cards.filter((c) => c.state === "done" && c.recipe);
    if (!done.length) return;

    builder.appendChild(el("h2", undefined, "Build the cookbook"));

    // Design picker — the theme is stored on the album, so regenerating in a
    // different look is just another Generate click.
    const themeRow = el("div", "theme-picker");
    for (const theme of BOOK_THEMES) {
      const card = button("theme-card", "");
      if ((album.theme ?? "standard") === theme.id) card.classList.add("selected");
      const chip = el("span", "theme-chip", "Aa");
      chip.style.background = theme.pageBg;
      chip.style.color = theme.accent;
      chip.style.fontFamily = theme.fontFamily;
      chip.style.borderBottom = `4px solid ${theme.accent}`;
      const label = el("span", "theme-label", theme.label);
      const desc = el("span", "theme-desc", theme.description);
      card.append(chip, label, desc);
      card.addEventListener("click", () => {
        album.theme = theme.id;
        void updateAlbum(album);
        renderBuilder();
      });
      themeRow.appendChild(card);
    }
    builder.appendChild(themeRow);

    const authorInput = el("input", "album-author") as HTMLInputElement;
    authorInput.placeholder = "Author (optional, for the title page)";
    authorInput.value = album.author ?? "";
    authorInput.addEventListener("change", () => {
      album.author = authorInput.value.trim() || undefined;
      void updateAlbum(album);
    });

    const tocLabel = el("label", "album-toc");
    const tocBox = el("input") as HTMLInputElement;
    tocBox.type = "checkbox";
    tocBox.checked = album.includeToc;
    tocBox.addEventListener("change", () => {
      album.includeToc = tocBox.checked;
      void updateAlbum(album);
    });
    tocLabel.append(tocBox, " Include a table of contents");

    const list = el("ul", "builder-list");
    cards.forEach((card, i) => {
      if (card.state !== "done" || !card.recipe) return;
      const li = el("li");
      const include = el("input") as HTMLInputElement;
      include.type = "checkbox";
      include.checked = card.included;
      include.title = "Include in the book";
      include.addEventListener("change", () => {
        card.included = include.checked;
        void updateCard(card);
        renderBuilder(); // review gating depends on which cards are included
      });
      const title = el("span", "builder-title", card.recipe.title);
      const warnings: string[] = [];
      if (photoPrintDpi(card) < LOW_DPI) warnings.push("photo may print soft");
      if (!card.reviewed) warnings.push("not reviewed");
      const warn = el("span", "builder-warn", warnings.join(" · "));
      const up = button("ghost move", "↑");
      up.disabled = i === 0;
      const down = button("ghost move", "↓");
      down.disabled = i === cards.length - 1;
      const move = (delta: number) => {
        const order = album.cardOrder;
        const at = order.indexOf(card.id);
        const to = at + delta;
        if (to < 0 || to >= order.length) return;
        [order[at], order[to]] = [order[to], order[at]];
        void updateAlbum(album).then(async () => {
          cards = await getCards(album);
          renderGrid();
          renderBuilder();
        });
      };
      up.addEventListener("click", () => move(-1));
      down.addEventListener("click", () => move(1));
      li.append(include, title, warn, up, down);
      list.appendChild(li);
    });

    // Every included card must be reviewed before the book can be generated —
    // an unchecked conversion in a printed book is the costly kind of mistake.
    const needingReview = cards.filter(
      (c) => c.state === "done" && c.recipe && c.included && !c.reviewed,
    );

    const generate = button("primary", "Generate cookbook PDF");
    generate.disabled = needingReview.length > 0;
    if (needingReview.length) {
      generate.title = "Review every included card first";
    }
    const status = el("span", "status");
    if (needingReview.length) {
      status.textContent = `${needingReview.length} card${needingReview.length === 1 ? "" : "s"} still need${needingReview.length === 1 ? "s" : ""} review.`;
    }
    generate.addEventListener("click", async () => {
      generate.disabled = true;
      status.textContent = "Building the book — this can take a minute…";
      try {
        const pdf = await exportCookbookPdf(album, await getCards(album));
        downloadFile(pdf.blob, pdf.filename);
        status.textContent = "Done — check your downloads.";
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
      } finally {
        generate.disabled = false;
      }
    });

    const actions = el("div", "actions");
    if (needingReview.length) {
      const reviewNext = button("primary", `Review next — ${needingReview.length} to go →`);
      reviewNext.addEventListener("click", () => {
        selectedId = needingReview[0].id;
        renderGrid();
        renderReview();
        review.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      actions.append(reviewNext);
    }
    actions.append(generate, status);
    builder.append(authorInput, tocLabel, list, actions);
  }

  // --- Assemble & load ------------------------------------------------------

  root.append(header, intake, review, builder);

  void getCards(album).then((loaded) => {
    cards = loaded;
    renderGrid();
    renderQueueState();
    renderBuilder();
    autoSelectUnreviewed();
    queue.kick(); // resume any queued cards from a previous visit
  });

  return {
    el: root,
    dispose() {
      clearTimeout(persistTimer);
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
      blobUrls.clear();
    },
  };
}
