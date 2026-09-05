import { requireSession } from "../auth";
import { apiGet, apiPost } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/council.html");

async function loadSeats() {
  const el = document.getElementById("seats-list")!;
  try {
    const data = await apiGet("/council");
    el.innerHTML = data.seats
      .map((seat: any) => {
        const term = seat.occupant
          ? `holds seat since ${new Date(seat.occupant.term_start).toLocaleDateString()}, term expected to end ${
              seat.occupant.term_expected_end
                ? new Date(seat.occupant.term_expected_end).toLocaleDateString()
                : "—"
            }`
          : "vacant — no election run yet";
        return `
        <div class="row">
          <span>Seat ${seat.seat_number} <span class="muted">(${seat.cohort}, ${seat.term_length_years}-year term)</span></span>
          <span class="muted">${term}</span>
        </div>`;
      })
      .join("");
  } catch {
    el.textContent = "Couldn't load the council.";
  }
}

document.getElementById("vote-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("vote-message")!;
  el.innerHTML = "";

  const electionId = (document.getElementById("election-id") as HTMLInputElement).value;
  const candidateAccountId = (document.getElementById("candidate-id") as HTMLInputElement).value;

  try {
    await apiPost(`/council/elections/${electionId}/vote`, { candidateAccountId });
    el.innerHTML = `<div class="notice">Vote recorded.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadSeats();
