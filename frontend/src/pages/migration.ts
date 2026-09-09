import { requireSession } from "../auth";
import { apiGet, apiPost, apiDelete } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/migration.html");

let currentCycleId: string | null = null;

async function loadStatus() {
  const el = document.getElementById("cycle-status")!;
  try {
    const data = await apiGet("/tribe/migration-status");
    if (!data.cycle) {
      el.innerHTML = "No migration cycle currently scheduled.";
      return;
    }
    currentCycleId = data.cycle.id;
    el.innerHTML = `
      <strong>${data.daysRemaining} days</strong> until this cycle's migration executes.
      Status: ${data.cycle.status}. Your decision so far: <strong>${data.myDecision}</strong>.
    `;
    if (data.cycle.status === "decisions_open") {
      document.getElementById("decision-section")!.style.display = "block";
    }
  } catch {
    el.textContent = "Couldn't load migration status.";
  }
}

document.getElementById("decide-migrate")!.addEventListener("click", () => submitDecision("migrate"));
document.getElementById("decide-decline")!.addEventListener("click", () => submitDecision("decline"));

async function submitDecision(decision: "migrate" | "decline") {
  const el = document.getElementById("decision-message")!;
  el.innerHTML = "";
  if (!currentCycleId) return;
  try {
    await apiPost(`/migration-cycles/${currentCycleId}/decision`, { decision });
    el.innerHTML = `<div class="notice">Recorded: ${decision}.</div>`;
    loadStatus();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

document.getElementById("add-selection")!.addEventListener("click", async () => {
  const el = document.getElementById("selection-message")!;
  el.innerHTML = "";
  const itemType = (document.getElementById("item-type") as HTMLSelectElement).value;
  const itemId = (document.getElementById("item-id") as HTMLInputElement).value.trim();
  if (!itemId) {
    el.innerHTML = `<div class="error">Enter an item ID.</div>`;
    return;
  }
  try {
    await apiPost("/migration/selections", { cycleId: null, itemType, itemId });
    (document.getElementById("item-id") as HTMLInputElement).value = "";
    loadSelections();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

async function loadSelections() {
  const el = document.getElementById("selections-list")!;
  try {
    const data = await apiGet("/migration/selections");
    if (data.selections.length === 0) {
      el.innerHTML = "Nothing selected for individual migration yet.";
      return;
    }
    el.innerHTML = data.selections
      .map(
        (s: any) => `
      <div class="row">
        <span>${s.item_type} — <code>${s.item_id.slice(0, 8)}…</code></span>
        <button class="secondary" data-remove="${s.id}">Remove</button>
      </div>`
      )
      .join("");
    el.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await apiDelete(`/migration/selections/${(btn as HTMLElement).dataset.remove}`);
        loadSelections();
      })
    );
  } catch {
    el.textContent = "Couldn't load selections.";
  }
}

loadStatus();
loadSelections();
