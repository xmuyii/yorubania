import { requireSession } from "../auth";
import { apiGet, apiPost, apiGetBinary } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/documents.html");

async function loadDocuments() {
  const el = document.getElementById("documents-list")!;
  try {
    const data = await apiGet("/documents");
    if (data.documents.length === 0) {
      el.innerHTML = "No documents yet.";
      return;
    }
    el.innerHTML = data.documents
      .map(
        (d: any) => `
      <div class="row">
        <span><strong>${d.title}</strong>${d.description ? ` — ${d.description}` : ""}</span>
        <button class="secondary" data-open="${d.media_asset_id}">Open</button>
      </div>`
      )
      .join("");
    el.querySelectorAll("[data-open]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const mediaId = (btn as HTMLElement).dataset.open!;
        try {
          const { bytes } = await apiGetBinary(`/media/${mediaId}/download`);
          const blob = new Blob([bytes as unknown as BlobPart]);
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        } catch (err: any) {
          alert(err.message);
        }
      })
    );
  } catch {
    el.textContent = "Couldn't load documents.";
  }
}

async function checkPermissions() {
  try {
    const me = await apiGet("/accounts/me");
    if (me.role === "admin" || me.role === "superadmin") {
      document.getElementById("upload-section")!.style.display = "block";
    }
  } catch {
    // stays hidden
  }
}

document.getElementById("document-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("document-message")!;
  el.innerHTML = "";
  try {
    await apiPost("/documents", {
      title: (document.getElementById("doc-title") as HTMLInputElement).value,
      description: (document.getElementById("doc-description") as HTMLTextAreaElement).value,
      mediaAssetId: (document.getElementById("doc-media-id") as HTMLInputElement).value,
    });
    el.innerHTML = `<div class="notice">Added.</div>`;
    (document.getElementById("document-form") as HTMLFormElement).reset();
    loadDocuments();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadDocuments();
checkPermissions();
