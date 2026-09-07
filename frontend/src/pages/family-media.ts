import { requireSession } from "../auth";
import { apiGet, apiPostBinaryWithProgress, apiGetBinary } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/family-media.html");

const message = document.getElementById("message")!;
const subjectInput = document.getElementById("subject-person-id") as HTMLInputElement;
let myPersonId: string | null = null;
const thumbCache = new Map<string, string>();

async function init() {
  // A tree click or a shared link can specify whose album to open.
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("person");

  try {
    const me = await apiGet("/accounts/me");
    if (me.person) {
      myPersonId = me.person.id;
      if (!requested) {
        subjectInput.value = me.person.id;
        document.getElementById("self-hint")!.textContent = `Defaulted to you (${me.person.fullName}).`;
      }
    }
  } catch {
    // ignore — subject field just stays empty, user can type an ID manually
  }

  if (requested) {
    subjectInput.value = requested;
    try {
      const info = await apiGet(`/persons/${requested}/basic-info`);
      document.getElementById("album-heading")!.textContent = `${info.fullName}'s album`;
      document.getElementById("self-hint")!.textContent =
        requested === myPersonId ? "This is you." : `Viewing ${info.fullName}'s shared album.`;
    } catch {
      document.getElementById("album-heading")!.textContent = "Album";
    }
  }

  loadMedia();
}

document.getElementById("media-submit")!.addEventListener("click", async () => {
  message.innerHTML = "";
  const fileInput = document.getElementById("media-file") as HTMLInputElement;
  const file = fileInput.files?.[0];
  const subjectPersonId = subjectInput.value.trim();
  const button = document.getElementById("media-submit") as HTMLButtonElement;
  const track = document.getElementById("media-progress-track")!;
  const fill = document.getElementById("media-progress-fill") as HTMLElement;
  const status = document.getElementById("media-status")!;

  if (!file || !subjectPersonId) {
    message.innerHTML = `<div class="error">Choose a file and a person ID first.</div>`;
    return;
  }

  button.disabled = true;
  track.classList.add("active");
  fill.style.width = "0%";
  status.textContent = "Uploading…";

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await apiPostBinaryWithProgress(
      "/media",
      bytes,
      {
        "x-subject-person-id": subjectPersonId,
        "x-original-format": file.type || "application/octet-stream",
      },
      (percent) => {
        fill.style.width = `${percent}%`;
        status.textContent = `Uploading… ${percent}%`;
      }
    );
    status.textContent = "Done.";
    fileInput.value = "";
    loadMedia();
  } catch (err: any) {
    status.textContent = "";
    message.innerHTML = `<div class="error">${err.message}</div>`;
  } finally {
    button.disabled = false;
    track.classList.remove("active");
  }
});

async function thumbUrl(mediaId: string): Promise<string | null> {
  if (thumbCache.has(mediaId)) return thumbCache.get(mediaId)!;
  try {
    const { bytes } = await apiGetBinary(`/media/${mediaId}/download`);
    const blob = new Blob([bytes as unknown as BlobPart]);
    const url = URL.createObjectURL(blob);
    thumbCache.set(mediaId, url);
    return url;
  } catch {
    return null;
  }
}

async function loadMedia() {
  const el = document.getElementById("media-list")!;
  const subjectPersonId = subjectInput.value.trim() || myPersonId;
  if (!subjectPersonId) {
    el.innerHTML = "Enter a person ID above to see their album.";
    return;
  }
  try {
    const data = await apiGet(`/persons/${subjectPersonId}/media`);
    if (data.media.length === 0) {
      el.innerHTML = "No photos or documents yet.";
      return;
    }

    const grid = document.createElement("div");
    grid.className = "album-grid";

    for (const m of data.media) {
      const item = document.createElement("div");
      item.className = "album-item";

      if (m.original_format?.startsWith("image/")) {
        const img = document.createElement("img");
        img.className = "thumb";
        img.alt = "";
        thumbUrl(m.id).then((url) => {
          if (url) img.src = url;
        });
        item.appendChild(img);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "thumb-placeholder";
        placeholder.textContent = fileLabel(m.original_format);
        item.appendChild(placeholder);
      }

      const caption = document.createElement("div");
      caption.className = "caption";
      caption.textContent = `${(m.size_bytes / 1024).toFixed(0)} KB`;
      item.appendChild(caption);

      item.addEventListener("click", async () => {
        const url = await thumbUrl(m.id);
        if (url) {
          const a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.click();
        }
      });

      grid.appendChild(item);
    }

    el.innerHTML = "";
    el.appendChild(grid);
  } catch {
    el.textContent = "Couldn't load this album (do you have access?).";
  }
}

function fileLabel(format: string | null): string {
  if (!format) return "File";
  if (format.includes("pdf")) return "PDF";
  if (format.startsWith("video/")) return "Video";
  if (format.startsWith("audio/")) return "Audio";
  return "Document";
}

subjectInput.addEventListener("change", loadMedia);
init();
