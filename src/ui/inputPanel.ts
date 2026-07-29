import type { ConvertRequest } from "../api";
import { fileToRequest } from "./image";

export interface InputPanel {
  el: HTMLElement;
  setBusy(busy: boolean, statusText?: string): void;
  /** Reset whichever input produced a table (URL, pasted text, or upload). */
  clearSubmitted(type: ConvertRequest["type"]): void;
}

type TabId = "url" | "paste" | "upload";

/** The URL / Paste / Upload tab panel. Calls onSubmit with a ready request. */
export function createInputPanel(
  onSubmit: (req: ConvertRequest) => void,
  onError: (message: string) => void,
): InputPanel {
  const panel = document.createElement("section");
  panel.className = "panel";

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  tabs.setAttribute("role", "tablist");
  const bodies = new Map<TabId, HTMLElement>();
  let active: TabId = "url";

  function addTab(id: TabId, label: string, body: HTMLElement) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.setAttribute("role", "tab");
    btn.dataset.tab = id;
    btn.addEventListener("click", () => select(id));
    tabs.appendChild(btn);
    bodies.set(id, body);
    body.classList.add("tab-body");
    panel.appendChild(body);
  }

  function select(id: TabId) {
    active = id;
    for (const btn of tabs.querySelectorAll("button")) {
      btn.setAttribute("aria-selected", String(btn.dataset.tab === id));
    }
    for (const [bodyId, body] of bodies) {
      body.style.display = bodyId === id ? "" : "none";
    }
  }

  // --- URL tab
  const urlBody = document.createElement("div");
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.placeholder = "https://example.com/best-brownies";
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  urlBody.appendChild(urlInput);

  // --- Paste tab
  const pasteBody = document.createElement("div");
  const textarea = document.createElement("textarea");
  textarea.placeholder = "Paste the whole recipe here — ingredients and instructions.";
  pasteBody.appendChild(textarea);

  // --- Upload tab
  const DROP_PROMPT =
    "Drop a photo of a recipe here (cookbook page, handwritten card) or a PDF — or click to choose. You can also paste an image from the clipboard.";
  const uploadBody = document.createElement("div");
  const drop = document.createElement("div");
  drop.className = "dropzone";
  drop.textContent = DROP_PROMPT;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*,application/pdf";
  fileInput.style.display = "none";
  let pendingFile: File | null = null;
  let previewUrl: string | null = null;

  function dropPreviewUrl() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  function showPreview(file: File) {
    pendingFile = file;
    dropPreviewUrl();
    drop.textContent = `Ready: ${file.name || "pasted image"} (${Math.round(file.size / 1024)} kB)`;
    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "preview";
      img.alt = "preview";
      previewUrl = URL.createObjectURL(file);
      img.src = previewUrl;
      drop.appendChild(img);
    }
  }

  function clearUpload() {
    pendingFile = null;
    fileInput.value = "";
    dropPreviewUrl();
    drop.textContent = DROP_PROMPT;
  }

  drop.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) showPreview(fileInput.files[0]);
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) showPreview(file);
  });
  document.addEventListener("paste", (e) => {
    if (active !== "upload") return;
    const file = Array.from(e.clipboardData?.files ?? []).find(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf",
    );
    if (file) showPreview(file);
  });
  uploadBody.append(drop, fileInput);

  addTab("url", "Web link", urlBody);
  addTab("paste", "Paste text", pasteBody);
  addTab("upload", "Photo / PDF", uploadBody);

  // --- Submit row
  const actions = document.createElement("div");
  actions.className = "actions";
  const go = document.createElement("button");
  go.className = "primary";
  go.textContent = "Engineer it";
  const status = document.createElement("span");
  status.className = "status";
  actions.append(go, status);
  panel.append(tabs, ...bodies.values(), actions);
  // (tabs must precede bodies visually)
  panel.insertBefore(tabs, panel.firstChild);

  async function submit() {
    try {
      if (active === "url") {
        const value = urlInput.value.trim();
        if (!value) return onError("Enter a recipe URL first.");
        onSubmit({ type: "url", payload: value });
      } else if (active === "paste") {
        const value = textarea.value.trim();
        if (!value) return onError("Paste a recipe first.");
        onSubmit({ type: "text", payload: value });
      } else {
        if (!pendingFile) return onError("Choose a photo or PDF first.");
        onSubmit(await fileToRequest(pendingFile));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }
  go.addEventListener("click", submit);

  select("url");

  return {
    el: panel,
    clearSubmitted(type) {
      if (type === "url") urlInput.value = "";
      else if (type === "text") textarea.value = "";
      else clearUpload();
    },
    setBusy(busy, statusText) {
      go.disabled = busy;
      status.innerHTML = "";
      if (busy) {
        const spin = document.createElement("span");
        spin.className = "spinner";
        status.append(spin, statusText ?? "Working…");
      }
    },
  };
}
