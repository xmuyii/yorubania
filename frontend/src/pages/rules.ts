import { requireSession } from "../auth";
import { apiGet, apiPost } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/rules.html");

async function loadSpiritual() {
  const el = document.getElementById("spiritual-list")!;
  try {
    const data = await apiGet("/rules/spiritual");
    if (data.rules.length === 0) {
      el.innerHTML = "None set yet.";
      return;
    }
    el.innerHTML = data.rules
      .map(
        (r: any) => `
      <div class="row" style="display:block;">
        <strong>${r.title}</strong>
        <p style="margin:4px 0 0;">${r.body}</p>
        <p class="muted" style="margin:4px 0 0; font-size:0.8rem;">Set ${new Date(r.created_at).toLocaleDateString()}</p>
      </div>`
      )
      .join("");
  } catch {
    el.textContent = "Couldn't load spiritual rules.";
  }
}

async function loadGeneral() {
  const el = document.getElementById("general-content")!;
  try {
    const data = await apiGet("/rules/general");
    el.innerHTML = `<h3>${data.title}</h3><p>${data.body.replace(/\n/g, "<br>")}</p>`;
    (document.getElementById("general-title") as HTMLInputElement).value = data.title;
    (document.getElementById("general-body") as HTMLTextAreaElement).value = data.body;
  } catch {
    el.innerHTML = "No general rules published yet.";
  }
}

async function checkPermissions() {
  try {
    const [me, council] = await Promise.all([apiGet("/accounts/me"), apiGet("/council")]);
    if (me.role === "superadmin") {
      document.getElementById("spiritual-form-section")!.style.display = "block";
    }
    const onCouncil = council.seats.some((s: any) => s.occupant?.account_id === me.accountId);
    if (onCouncil || me.role === "superadmin") {
      document.getElementById("general-form-section")!.style.display = "block";
    }
  } catch {
    // forms just stay hidden — backend still enforces regardless
  }
}

document.getElementById("spiritual-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("spiritual-message")!;
  el.innerHTML = "";
  const title = (document.getElementById("spiritual-title") as HTMLInputElement).value;
  const body = (document.getElementById("spiritual-body") as HTMLTextAreaElement).value;
  if (!confirm("This can never be changed or removed once set. Continue?")) return;
  try {
    await apiPost("/rules/spiritual", { title, body });
    el.innerHTML = `<div class="notice">Set permanently.</div>`;
    (document.getElementById("spiritual-form") as HTMLFormElement).reset();
    loadSpiritual();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("general-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("general-message")!;
  el.innerHTML = "";
  try {
    await apiPost("/rules/general", {
      title: (document.getElementById("general-title") as HTMLInputElement).value,
      body: (document.getElementById("general-body") as HTMLTextAreaElement).value,
    });
    el.innerHTML = `<div class="notice">Published.</div>`;
    loadGeneral();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadSpiritual();
loadGeneral();
checkPermissions();
