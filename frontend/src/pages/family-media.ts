import { requireSession } from "../auth";
import { apiGet, apiPostBinary, apiGetBinary } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/family-media.html");

const message = document.getElementById("message")!;
const subjectInput = document.getElementById("subject-person-id") as HTMLInputElement;
let myPersonId: string | null = null;

async function init() {
  try {
    const me = await apiGet("/accounts/me");
    if (me.person) {
      myPersonId = me.person.id;
      subjectInput.value = me.person.id;
      document.getElementById("self-hint")!.textContent = `Defaulted to you (${me.person.fullName}). Change this to a child's person ID if uploading on their behalf.`;
    }
  } catch {
    // ignore — subject field just stays empty, user can type an ID manually
  }
  loadMedia();
}

document.getElementById("media-submit")!.addEventListener("click", async () => {
  message.innerHTML = "";
  const fileInput = document.getElementById("media-file") as HTMLInputElement;
  const file = fileInput.files?.[0];
  const subjectPersonId = subjectInput.value.trim();

  if (!file || !subjectPersonId) {
    message.innerHTML = `<div class="error">Choose a file and a person ID first.</div>`;
    return;
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await apiPostBinary("/media", bytes, {
      "x-subject-person-id": subjectPersonId,
      "x-original-format": file.type || "application/octet-stream",
      "Content-Type": "application/octet-stream",
    });
    fileInput.value = "";
    loadMedia();
  } catch (err: any) {
    message.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

async function loadMedia() {
  const el = document.getElementById("media-list")!;
  const subjectPersonId = subjectInput.value.trim() || myPersonId;
  if (!subjectPersonId) {
    el.innerHTML = "Enter a person ID above to see their media.";
    return;
  }
  try {
    const data = await apiGet(`/persons/${subjectPersonId}/media`);
    if (data.media.length === 0) {
      el.innerHTML = "No media uploaded yet.";
      return;
    }
    el.innerHTML = data.media
      .map(
        (m: any) => `
      <div class="row">
        <span>${m.original_format} — ${(m.size_bytes / 1024).toFixed(1)} KB</span>
        <button class="secondary" data-download="${m.id}" data-format="${m.original_format}">Download</button>
      </div>`
      )
      .join("");

    el.querySelectorAll("[data-download]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.download!;
        const { bytes } = await apiGetBinary(`/media/${id}/download`);
        const blob = new Blob([bytes as unknown as BlobPart]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `media-${id.slice(0, 8)}`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  } catch {
    el.textContent = "Couldn't load media (do you have access to this person's page?).";
  }
}

subjectInput.addEventListener("change", loadMedia);
init();
