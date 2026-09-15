import { requireSession } from "../auth";
import { apiGet, apiPost } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/polls.html");

async function loadPolls() {
  const el = document.getElementById("polls-list")!;
  try {
    const data = await apiGet("/polls");
    if (data.polls.length === 0) {
      el.innerHTML = "No polls yet.";
      return;
    }
    el.innerHTML = "";
    for (const poll of data.polls) {
      const detail = await apiGet(`/polls/${poll.id}`);
      const card = document.createElement("div");
      card.className = "row";
      card.style.display = "block";

      let optionsHtml = "";
      if (poll.status === "open") {
        optionsHtml = detail.options
          .map((o: any) => `<button class="secondary" data-vote="${poll.id}:${o.id}">${o.label}</button>`)
          .join(" ");
      } else if (detail.results) {
        optionsHtml = detail.options
          .map((o: any) => `<div class="muted">${o.label}: ${detail.results[o.id] ?? 0}</div>`)
          .join("");
      }

      card.innerHTML = `
        <strong>${poll.title}</strong> <span class="muted">(${poll.status}, closes ${new Date(poll.closes_at).toLocaleString()})</span>
        <p class="muted">${poll.description ?? ""}</p>
        <div>${optionsHtml}</div>
      `;
      el.appendChild(card);
    }

    el.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [pollId, optionId] = (btn as HTMLElement).dataset.vote!.split(":");
        try {
          await apiPost(`/polls/${pollId}/vote`, { optionId });
          loadPolls();
        } catch (err: any) {
          alert(err.message);
        }
      });
    });
  } catch {
    el.textContent = "Couldn't load polls.";
  }
}

async function checkOpenPermission() {
  try {
    const me = await apiGet("/accounts/me");
    if (me.role === "admin" || me.role === "superadmin") {
      document.getElementById("open-poll-section")!.style.display = "block";
      return;
    }
    const council = await apiGet("/council");
    const onCouncil = council.seats.some((s: any) => s.occupant?.account_id === me.accountId);
    if (onCouncil) document.getElementById("open-poll-section")!.style.display = "block";
  } catch {
    // stays hidden
  }
}

document.getElementById("poll-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("poll-form-message")!;
  el.innerHTML = "";
  const options = (document.getElementById("poll-options") as HTMLTextAreaElement).value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    await apiPost("/polls", {
      title: (document.getElementById("poll-title") as HTMLInputElement).value,
      description: (document.getElementById("poll-description") as HTMLTextAreaElement).value,
      options,
      closesAt: new Date((document.getElementById("poll-closes-at") as HTMLInputElement).value).toISOString(),
    });
    el.innerHTML = `<div class="notice">Opened.</div>`;
    loadPolls();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadPolls();
checkOpenPermission();
