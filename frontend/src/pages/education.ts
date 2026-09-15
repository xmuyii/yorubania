import { requireSession } from "../auth";
import { apiGet, apiPost, apiGetBinary } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/education.html");

async function loadMaterials() {
  const el = document.getElementById("materials-list")!;
  try {
    const data = await apiGet("/education");
    if (data.materials.length === 0) {
      el.innerHTML = "Nothing here yet.";
      return;
    }
    el.innerHTML = data.materials
      .map(
        (m: any) => `
      <div class="row">
        <span><strong>${m.title}</strong>${m.description ? ` — ${m.description}` : ""}</span>
        <button class="secondary" data-open="${m.media_asset_id}">Open</button>
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
    el.textContent = "Couldn't load education materials.";
  }
}

async function checkPermissions() {
  try {
    const [me, council] = await Promise.all([apiGet("/accounts/me"), apiGet("/council")]);
    const onCouncil = council.seats.some((s: any) => s.occupant?.account_id === me.accountId);
    if (me.role === "admin" || me.role === "superadmin" || onCouncil) {
      document.getElementById("upload-section")!.style.display = "block";
    }
  } catch {
    // stays hidden
  }
}

document.getElementById("material-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("material-message")!;
  el.innerHTML = "";
  try {
    await apiPost("/education", {
      title: (document.getElementById("material-title") as HTMLInputElement).value,
      description: (document.getElementById("material-description") as HTMLTextAreaElement).value,
      mediaAssetId: (document.getElementById("material-media-id") as HTMLInputElement).value,
    });
    el.innerHTML = `<div class="notice">Added.</div>`;
    (document.getElementById("material-form") as HTMLFormElement).reset();
    loadMaterials();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadMaterials();
checkPermissions();
