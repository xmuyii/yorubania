import { requireSession } from "../auth";
import { apiGet, apiPut } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/life-goals.html");

async function init() {
  try {
    const data = await apiGet("/persons/me/life-goals");
    for (const g of data.goals) {
      (document.getElementById(`goal-${g.goal_number}`) as HTMLTextAreaElement).value = g.description;
      (document.getElementById(`goal-${g.goal_number}-achieved`) as HTMLInputElement).checked = g.achieved;
    }
  } catch {
    // no goals set yet — fine, form stays blank
  }
}

document.getElementById("goals-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("message")!;
  el.innerHTML = "";

  const goals = [1, 2, 3]
    .map((n) => ({
      goalNumber: n,
      description: (document.getElementById(`goal-${n}`) as HTMLTextAreaElement).value.trim(),
      achieved: (document.getElementById(`goal-${n}-achieved`) as HTMLInputElement).checked,
    }))
    .filter((g) => g.description.length > 0);

  if (goals.length === 0) {
    el.innerHTML = `<div class="error">Enter at least one goal.</div>`;
    return;
  }

  try {
    await apiPut("/persons/me/life-goals", { goals });
    el.innerHTML = `<div class="notice">Saved. Private to you.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

init();
