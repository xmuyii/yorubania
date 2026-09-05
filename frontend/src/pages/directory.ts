import { requireSession } from "../auth";
import { apiGet, apiPatch } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/directory.html");

const toggle = document.getElementById("visibility-toggle") as HTMLInputElement;
toggle.addEventListener("change", async () => {
  try {
    await apiPatch("/accounts/me/directory-visibility", { visible: toggle.checked });
  } catch (err: any) {
    alert(err.message);
    toggle.checked = !toggle.checked;
  }
});

let debounceTimer: number | undefined;
document.getElementById("search")!.addEventListener("input", (e) => {
  window.clearTimeout(debounceTimer);
  const value = (e.target as HTMLInputElement).value;
  debounceTimer = window.setTimeout(() => search(value), 300);
});

async function search(query: string) {
  const el = document.getElementById("results")!;
  if (!query.trim()) {
    el.innerHTML = "Search for someone to begin.";
    return;
  }
  try {
    const data = await apiGet(`/members/directory?search=${encodeURIComponent(query)}`);
    if (data.results.length === 0) {
      el.innerHTML = "No one found.";
      return;
    }
    el.innerHTML = data.results
      .map((r: any) => `<div class="row"><span>${r.fullName}</span></div>`)
      .join("");
  } catch {
    el.textContent = "Search failed.";
  }
}
