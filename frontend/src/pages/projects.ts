import { requireSession } from "../auth";
import { apiGet, apiPost } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/projects.html");

async function loadProjects() {
  const el = document.getElementById("projects-list")!;
  try {
    const data = await apiGet("/projects");
    if (data.projects.length === 0) {
      el.innerHTML = "Nothing listed yet.";
      return;
    }
    el.innerHTML = data.projects
      .map(
        (p: any) => `
      <div class="row" style="display:block;">
        <strong>${p.title}</strong> <span class="muted">(${p.status})</span>
        ${p.description ? `<p class="muted" style="margin:4px 0 0;">${p.description}</p>` : ""}
      </div>`
      )
      .join("");
  } catch {
    el.textContent = "Couldn't load projects.";
  }
}

async function checkPermissions() {
  try {
    const [me, council] = await Promise.all([apiGet("/accounts/me"), apiGet("/council")]);
    const onCouncil = council.seats.some((s: any) => s.occupant?.account_id === me.accountId);
    if (me.role === "admin" || me.role === "superadmin" || onCouncil) {
      document.getElementById("new-project-section")!.style.display = "block";
    }
  } catch {
    // stays hidden
  }
}

document.getElementById("project-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("project-message")!;
  el.innerHTML = "";
  try {
    await apiPost("/projects", {
      title: (document.getElementById("project-title") as HTMLInputElement).value,
      description: (document.getElementById("project-description") as HTMLTextAreaElement).value,
      status: (document.getElementById("project-status") as HTMLSelectElement).value,
    });
    el.innerHTML = `<div class="notice">Added.</div>`;
    (document.getElementById("project-form") as HTMLFormElement).reset();
    loadProjects();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadProjects();
checkPermissions();
