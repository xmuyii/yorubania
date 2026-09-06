import { requireSession } from "../auth";
import { apiGet, apiPost } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/narrative.html");

async function loadNarrative() {
  const el = document.getElementById("narrative-display")!;
  try {
    const data = await apiGet("/founding-narrative");
    document.getElementById("narrative-title")!.textContent = data.title;
    el.innerHTML = `
      ${data.origin_story ? `<p>${data.origin_story}</p>` : ""}
      ${data.founding_principles ? `<h3>Founding principles</h3><p>${data.founding_principles}</p>` : ""}
      ${data.relationship_to_yoruba ? `<h3>Relationship to the Yoruba tribe</h3><p>${data.relationship_to_yoruba}</p>` : ""}
      ${data.founding_date_or_era ? `<p class="muted">Founded: ${data.founding_date_or_era}${data.founding_location ? ` — ${data.founding_location}` : ""}</p>` : ""}
    `;
    // Prefill the editor form with current content, in case the viewer is
    // council and wants to publish a revision rather than start blank.
    (document.getElementById("title") as HTMLInputElement).value = data.title ?? "";
    (document.getElementById("origin-story") as HTMLTextAreaElement).value = data.origin_story ?? "";
    (document.getElementById("founding-principles") as HTMLTextAreaElement).value = data.founding_principles ?? "";
    (document.getElementById("relationship-to-yoruba") as HTMLTextAreaElement).value = data.relationship_to_yoruba ?? "";
    (document.getElementById("founding-date-or-era") as HTMLInputElement).value = data.founding_date_or_era ?? "";
    (document.getElementById("founding-location") as HTMLInputElement).value = data.founding_location ?? "";
  } catch {
    el.innerHTML = "No founding narrative has been published yet.";
  }
}

async function checkCouncilAccess() {
  try {
    const [me, council] = await Promise.all([apiGet("/accounts/me"), apiGet("/council")]);
    const onCouncil = council.seats.some((s: any) => s.occupant?.account_id === me.accountId);
    if (onCouncil || me.role === "superadmin") {
      document.getElementById("editor-section")!.style.display = "block";
    }
  } catch {
    // If this check fails, the editor form just stays hidden — the
    // backend still enforces council membership regardless.
  }
}

document.getElementById("narrative-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("editor-message")!;
  el.innerHTML = "";

  try {
    await apiPost("/founding-narrative", {
      title: (document.getElementById("title") as HTMLInputElement).value,
      originStory: (document.getElementById("origin-story") as HTMLTextAreaElement).value,
      foundingPrinciples: (document.getElementById("founding-principles") as HTMLTextAreaElement).value,
      relationshipToYoruba: (document.getElementById("relationship-to-yoruba") as HTMLTextAreaElement).value,
      foundingDateOrEra: (document.getElementById("founding-date-or-era") as HTMLInputElement).value,
      foundingLocation: (document.getElementById("founding-location") as HTMLInputElement).value,
    });
    el.innerHTML = `<div class="notice">Published.</div>`;
    loadNarrative();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadNarrative();
checkCouncilAccess();
