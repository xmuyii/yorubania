import { requireSession } from "../auth";
import { apiPost, apiPatch } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/settings.html");

document.getElementById("check-in-btn")!.addEventListener("click", async () => {
  const el = document.getElementById("check-in-message")!;
  el.innerHTML = "";
  try {
    await apiPost("/accounts/me/check-in");
    el.innerHTML = `<div class="notice">Checked in — clock reset.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("contact-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("contact-message")!;
  el.innerHTML = "";
  try {
    await apiPatch("/persons/me/verification-contact", {
      phone: (document.getElementById("phone") as HTMLInputElement).value,
      address: (document.getElementById("address") as HTMLInputElement).value,
      email: (document.getElementById("email") as HTMLInputElement).value,
      guarantorName: (document.getElementById("guarantor-name") as HTMLInputElement).value,
      guarantorPhone: (document.getElementById("guarantor-phone") as HTMLInputElement).value,
      deathVerificationNotes: (document.getElementById("notes") as HTMLTextAreaElement).value,
    });
    el.innerHTML = `<div class="notice">Saved.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("successor-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("successor-message")!;
  el.innerHTML = "";
  try {
    await apiPatch("/accounts/me/designated-successor", {
      successorAccountId: (document.getElementById("successor-account-id") as HTMLInputElement).value,
    });
    el.innerHTML = `<div class="notice">Successor set.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});
