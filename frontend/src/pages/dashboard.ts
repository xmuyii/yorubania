import { requireSession } from "../auth";
import { apiGet, apiPost } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/dashboard.html");

// --- Mission / timeline ---------------------------------------------------
async function loadOverview() {
  try {
    const data = await apiGet("/tribe/overview");
    document.getElementById("mission-statement")!.textContent = data.statement;
    document.getElementById("era-label")!.textContent = data.currentPhase
      ? data.currentPhase.name
      : "Era not yet named";
    document.getElementById("timeline-caption")!.textContent =
      `Year ${data.yearsElapsed} of ${data.milestoneYears} — ${data.percentComplete.toFixed(2)}% of the way to the millennium.`;
    requestAnimationFrame(() => {
      (document.getElementById("timeline-fill") as HTMLElement).style.width = `${Math.min(
        100,
        data.percentComplete
      )}%`;
    });
  } catch {
    document.getElementById("mission-statement")!.textContent =
      "No mission statement has been published yet.";
  }
}

// --- Leadership ------------------------------------------------------------
async function loadLeadership() {
  const el = document.getElementById("leadership-seals")!;
  try {
    const data = await apiGet("/tribe/leadership");
    const founderSeal = data.founder
      ? sealHtml(data.founder.fullName, "Founder")
      : sealHtml(null, "Founder");

    const seatSeals = data.councilSeats
      .map((seat: any) =>
        seat.occupant
          ? sealHtml(seat.occupant.fullName, `Seat ${seat.seatNumber}`)
          : sealHtml(null, `Seat ${seat.seatNumber} · vacant`)
      )
      .join("");

    el.innerHTML = founderSeal + seatSeals;
  } catch {
    el.innerHTML = `<p class="muted">Leadership information isn't available yet.</p>`;
  }
}

function sealHtml(name: string | null, caption: string): string {
  const initials = name
    ? name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
    : "";
  return `
    <div class="seal">
      <div class="ring ${name ? "" : "vacant"}">${initials}</div>
      <div class="name">${name ?? caption}</div>
      ${name ? `<div class="name muted">${caption}</div>` : ""}
    </div>
  `;
}

// --- Invite a relative -------------------------------------------------------
const relationshipSelect = document.getElementById("relationship-type") as HTMLSelectElement;
const inviterRoleWrap = document.getElementById("inviter-role-wrap")!;
function syncInviterRoleVisibility() {
  inviterRoleWrap.style.display = relationshipSelect.value === "parent_child" ? "block" : "none";
}
relationshipSelect.addEventListener("change", syncInviterRoleVisibility);
syncInviterRoleVisibility();

document.getElementById("invite-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("invite-result")!;
  resultEl.innerHTML = "";

  const fullName = (document.getElementById("full-name") as HTMLInputElement).value;
  const relationshipType = relationshipSelect.value;
  const inviterRole = (document.getElementById("inviter-role") as HTMLSelectElement).value;

  try {
    const data = await apiPost("/members/invite-relative", {
      fullName,
      relationshipType,
      ...(relationshipType === "parent_child" ? { inviterRole } : {}),
    });
    const claimLink = `${window.location.origin}/claim.html?token=${data.inviteToken}`;
    resultEl.innerHTML = `<div class="notice">Invite created. Share this link with ${fullName}:<br><code>${claimLink}</code></div>`;
  } catch (err: any) {
    resultEl.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Announcements -----------------------------------------------------------
async function loadAnnouncements() {
  const el = document.getElementById("announcements-list")!;
  try {
    const data = await apiGet("/tribe/announcements");
    if (data.announcements.length === 0) {
      el.innerHTML = "No announcements yet.";
      return;
    }
    el.innerHTML = data.announcements
      .map(
        (a: any) => `
      <div class="row" style="display:block;">
        <strong>${a.title}</strong>
        <p class="muted" style="margin: 4px 0 0;">${a.body}</p>
        <p class="muted" style="margin: 4px 0 0; font-size:0.8rem;">${new Date(a.posted_at).toLocaleDateString()}</p>
      </div>`
      )
      .join("");
  } catch {
    el.textContent = "Couldn't load announcements.";
  }
}

// --- Achievements --------------------------------------------------------------
async function loadAchievements() {
  const el = document.getElementById("achievements-list")!;
  try {
    const data = await apiGet("/tribe/achievements");
    if (data.achievements.length === 0) {
      el.innerHTML = "Nothing shared yet — be the first.";
      return;
    }
    el.innerHTML = data.achievements
      .map(
        (a: any) => `
      <div class="row" style="display:block;">
        <strong>${a.title}</strong>
        ${a.description ? `<p class="muted" style="margin:4px 0 0;">${a.description}</p>` : ""}
      </div>`
      )
      .join("");
  } catch {
    el.textContent = "Couldn't load achievements.";
  }
}

document.getElementById("achievement-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = (document.getElementById("achievement-title") as HTMLInputElement).value;
  const description = (document.getElementById("achievement-description") as HTMLTextAreaElement).value;
  try {
    await apiPost("/tribe/achievements", { title, description });
    (document.getElementById("achievement-title") as HTMLInputElement).value = "";
    (document.getElementById("achievement-description") as HTMLTextAreaElement).value = "";
    loadAchievements();
  } catch (err: any) {
    alert(err.message);
  }
});

loadOverview();
loadLeadership();
loadAnnouncements();
loadAchievements();
