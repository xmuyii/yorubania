import { requireSession } from "../auth";
import { apiGet, apiPostBinary, apiPatch } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/profile.html");

async function init() {
  try {
    const me = await apiGet("/accounts/me");
    if (me.person) {
      document.getElementById("greeting")!.textContent = `Hello, ${me.person.fullName}`;
      if (me.person.dateOfBirth) {
        (document.getElementById("dob") as HTMLInputElement).value = me.person.dateOfBirth;
      }
    }
  } catch {
    // ignore
  }
}

document.getElementById("photo-submit")!.addEventListener("click", async () => {
  const el = document.getElementById("photo-message")!;
  el.innerHTML = "";
  const fileInput = document.getElementById("photo-file") as HTMLInputElement;
  const file = fileInput.files?.[0];
  if (!file) {
    el.innerHTML = `<div class="error">Choose an image first.</div>`;
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await apiPostBinary("/persons/me/profile-photo", bytes, {
      "x-original-format": file.type || "image/jpeg",
      "Content-Type": "application/octet-stream",
    });
    el.innerHTML = `<div class="notice">Profile photo updated.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("dob-submit")!.addEventListener("click", async () => {
  const el = document.getElementById("dob-message")!;
  el.innerHTML = "";
  const dob = (document.getElementById("dob") as HTMLInputElement).value;
  if (!dob) {
    el.innerHTML = `<div class="error">Choose a date first.</div>`;
    return;
  }
  try {
    await apiPatch("/persons/me/date-of-birth", { dateOfBirth: dob });
    el.innerHTML = `<div class="notice">Saved.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

init();
