import { requireSession } from "../auth";
import { apiGet, apiPost, apiDelete } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/access-control.html");

document.getElementById("grant-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("grant-message")!;
  el.innerHTML = "";
  const granteeAccountId = (document.getElementById("grantee-account-id") as HTMLInputElement).value;
  const scope = (document.getElementById("scope") as HTMLSelectElement).value;
  const isDenial = (document.getElementById("grant-type") as HTMLSelectElement).value === "blacklist";

  try {
    await apiPost("/persons/me/access-grants", { granteeAccountId, scope, isDenial });
    el.innerHTML = `<div class="notice">Added.</div>`;
    (document.getElementById("grant-form") as HTMLFormElement).reset();
    loadGrants();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

async function loadGrants() {
  const el = document.getElementById("grants-list")!;
  try {
    const data = await apiGet("/persons/me/access-grants");
    if (data.grants.length === 0) {
      el.innerHTML = "No explicit whitelist or blacklist entries yet — everyone else follows the default family-sharing rules.";
      return;
    }
    el.innerHTML = data.grants
      .filter((g: any) => g.status === "active")
      .map(
        (g: any) => `
      <div class="row">
        <span>
          <strong>${g.is_denial ? "Blacklist" : "Whitelist"}</strong> —
          <code>${g.grantee_account_id.slice(0, 8)}…</code> — ${g.scope}
        </span>
        <button class="secondary" data-revoke="${g.id}">Revoke</button>
      </div>`
      )
      .join("");
    el.querySelectorAll("[data-revoke]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await apiDelete(`/access-grants/${(btn as HTMLElement).dataset.revoke}`);
        loadGrants();
      })
    );
  } catch {
    el.textContent = "Couldn't load access grants.";
  }
}

loadGrants();
