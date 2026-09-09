import { requireSession } from "../auth";
import { apiGet, apiPost, apiPatch } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/book.html");

let myPersonId: string | null = null;

async function init() {
  try {
    const me = await apiGet("/accounts/me");
    myPersonId = me.person?.id ?? null;
    (document.getElementById("book-person-id") as HTMLInputElement).value = myPersonId ?? "";
  } catch {
    // ignore
  }
  loadMyChapters();
}

document.getElementById("new-chapter-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("chapter-message")!;
  el.innerHTML = "";
  try {
    await apiPost("/persons/me/chapters", {
      title: (document.getElementById("chapter-title") as HTMLInputElement).value,
      body: (document.getElementById("chapter-body") as HTMLTextAreaElement).value,
    });
    (document.getElementById("new-chapter-form") as HTMLFormElement).reset();
    loadMyChapters();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

async function loadMyChapters() {
  const el = document.getElementById("my-chapters")!;
  if (!myPersonId) {
    el.innerHTML = "No linked person record yet.";
    return;
  }
  try {
    const data = await apiGet(`/persons/${myPersonId}/chapters`);
    if (data.chapters.length === 0) {
      el.innerHTML = "No chapters yet — write your first one above.";
      return;
    }
    el.innerHTML = data.chapters
      .map((c: any) => {
        const sealed = c.status === "sealed";
        const canUnseal = sealed && c.sealed_via === "manual";
        return `
        <div class="chapter-card ${sealed ? "sealed" : ""}">
          <h3>${c.title}${c.chapter_type === "life_goals" ? " · Life Goals" : ""}</h3>
          <div class="chapter-meta">
            ${sealed ? `Sealed ${new Date(c.sealed_at).toLocaleDateString()} (${c.sealed_via === "death_confirmed" ? "on death — permanent" : "manually"})` : "Draft — editable"}
          </div>
          <p>${c.body.replace(/\n/g, "<br>")}</p>
          ${
            !sealed
              ? `<button class="secondary" data-seal="${c.id}">Seal this chapter</button>`
              : canUnseal
              ? `<button class="secondary" data-unseal="${c.id}">Unseal (you sealed this — you may reopen it)</button>`
              : ""
          }
        </div>`;
      })
      .join("");

    el.querySelectorAll("[data-seal]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Seal this chapter? You can unseal it again later, since you're the one sealing it now.")) return;
        await apiPost(`/chapters/${(btn as HTMLElement).dataset.seal}/seal`);
        loadMyChapters();
      })
    );
    el.querySelectorAll("[data-unseal]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await apiPost(`/chapters/${(btn as HTMLElement).dataset.unseal}/unseal`);
        loadMyChapters();
      })
    );
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

document.getElementById("load-book")!.addEventListener("click", async () => {
  const el = document.getElementById("book-content")!;
  const personId = (document.getElementById("book-person-id") as HTMLInputElement).value.trim() || myPersonId;
  if (!personId) return;
  el.innerHTML = "Loading…";
  try {
    const data = await apiGet(`/persons/${personId}/book`);
    if (data.sections.length === 0) {
      el.innerHTML = "No sealed chapters visible to you yet.";
      return;
    }
    el.innerHTML = data.sections
      .map(
        (section: any) => `
      <div class="book-section">
        <div class="book-author">${section.authorFullName}</div>
        ${section.chapters
          .map(
            (c: any) => `
          <div class="book-chapter">
            <h4>${c.title}</h4>
            <p>${c.body.replace(/\n/g, "<br>")}</p>
          </div>`
          )
          .join("")}
      </div>`
      )
      .join("");
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

init();
