import { requireSession } from "../auth";
import { apiGet, apiPost } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/families.html");

async function loadFamilies() {
  const el = document.getElementById("families-list")!;
  try {
    const data = await apiGet("/families");
    if (data.families.length === 0) {
      el.innerHTML = "No family branches recorded yet.";
      return;
    }
    el.innerHTML = data.families
      .map(
        (f: any) => `
      <div class="row">
        <span>${f.name} ${f.parent_family_branch_id ? `<span class="muted">(split from another branch)</span>` : ""}</span>
        <span class="muted">${f.memberCount} member${f.memberCount === 1 ? "" : "s"} · <code>${f.id.slice(0, 8)}…</code></span>
      </div>`
      )
      .join("");
  } catch {
    el.textContent = "Couldn't load families.";
  }
}

document.getElementById("branch-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("branch-message")!;
  el.innerHTML = "";

  const name = (document.getElementById("branch-name") as HTMLInputElement).value;
  const parentFamilyBranchId = (document.getElementById("parent-branch-id") as HTMLInputElement).value || undefined;
  const originNote = (document.getElementById("origin-note") as HTMLInputElement).value || undefined;

  try {
    await apiPost("/families/branch", { name, parentFamilyBranchId, originNote });
    el.innerHTML = `<div class="notice">Branch founded.</div>`;
    loadFamilies();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadFamilies();
