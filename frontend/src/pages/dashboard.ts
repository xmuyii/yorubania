import { requireSession } from "../auth";
import { apiGet, apiPost, apiGetBinary } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/dashboard.html");

const imageCache = new Map<string, string>();
async function imageObjectUrl(mediaAssetId: string): Promise<string | null> {
  if (imageCache.has(mediaAssetId)) return imageCache.get(mediaAssetId)!;
  try {
    const { bytes } = await apiGetBinary(`/media/${mediaAssetId}/download`);
    const blob = new Blob([bytes as unknown as BlobPart]);
    const url = URL.createObjectURL(blob);
    imageCache.set(mediaAssetId, url);
    return url;
  } catch {
    return null;
  }
}

async function loadBadge() {
  try {
    const me = await apiGet("/accounts/me");
    const parts = [me.person?.fullName ?? "Member"];
    if (me.councilSeat) parts.push(`Council Seat ${me.councilSeat.seatNumber}`);
    if (me.role === "superadmin") parts.push("Superadmin");
    else if (me.role === "admin") parts.push("Admin");
    document.getElementById("user-badge")!.textContent = parts.join(" · ");
  } catch {
    // non-fatal
  }
}

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

async function loadLeadership() {
  const el = document.getElementById("leadership-seals")!;
  try {
    const data = await apiGet("/tribe/leadership");
    el.innerHTML = "";
    el.appendChild(await sealElement(data.founder, "Founder"));
    for (const seat of data.councilSeats) {
      el.appendChild(
        await sealElement(
          seat.occupant
            ? { fullName: seat.occupant.fullName, profileImageMediaId: seat.occupant.profileImageMediaId }
            : null,
          seat.occupant ? `Seat ${seat.seat_number}` : `Seat ${seat.seat_number} · vacant`
        )
      );
    }
  } catch {
    el.innerHTML = `<p class="muted">Leadership information isn't available yet.</p>`;
  }
}

async function sealElement(
  person: { fullName: string; profileImageMediaId?: string | null } | null,
  caption: string
): Promise<HTMLElement> {
  const wrap = document.createElement("div");
  wrap.className = "seal";

  const ring = document.createElement("div");
  ring.className = `ring ${person ? "" : "vacant"}`;

  if (person?.profileImageMediaId) {
    const url = await imageObjectUrl(person.profileImageMediaId);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = person.fullName;
      ring.appendChild(img);
    } else {
      ring.textContent = initials(person.fullName);
    }
  } else if (person) {
    ring.textContent = initials(person.fullName);
  }

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = person ? person.fullName : caption;

  wrap.appendChild(ring);
  wrap.appendChild(name);
  if (person) {
    const captionEl = document.createElement("div");
    captionEl.className = "name muted";
    captionEl.textContent = caption;
    wrap.appendChild(captionEl);
  }
  return wrap;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
}

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

async function loadAchievements() {
  const el = document.getElementById("achievements-list")!;
  try {
    const data = await apiGet("/tribe/achievements");
    if (data.achievements.length === 0) {
      el.innerHTML = "Nothing logged yet.";
      return;
    }
    el.innerHTML = data.achievements
      .map(
        (a: any) => `
      <div class="row" style="display:block;">
        <strong>${a.subjectFullName ?? "A member"}</strong> — ${a.title}
        ${a.description ? `<p class="muted" style="margin:4px 0 0;">${a.description}</p>` : ""}
      </div>`
      )
      .join("");
  } catch {
    el.textContent = "Couldn't load achievements.";
  }
}

async function loadTicker() {
  const el = document.getElementById("news-ticker-track");
  if (!el) return;
  try {
    const data = await apiGet("/tribe/announcements");
    if (data.announcements.length === 0) {
      el.innerHTML = `<span>No news yet.</span>`;
      return;
    }
    el.innerHTML = data.announcements.map((a: any) => `<span>${a.title}</span>`).join("");
  } catch {
    el.innerHTML = "";
  }
}

loadBadge();
loadOverview();
loadLeadership();
loadAnnouncements();
loadAchievements();
loadTicker();
