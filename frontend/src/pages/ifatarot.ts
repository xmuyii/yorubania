import { requireSession } from "../auth";
import { apiGet, apiPut } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/ifatarot.html");

async function loadIfatarot() {
  const status = document.getElementById("ifatarot-status")!;
  const content = document.getElementById("ifatarot-content")!;
  try {
    const data = await apiGet("/ifatarot");
    if (!data.url) {
      status.textContent = "Not yet configured — ask the superadmin to set the Ifatarot app URL below.";
      return;
    }
    status.textContent = "";
    content.innerHTML = `
      <p><a class="btn" href="${data.url}" target="_blank" rel="noopener">Open Ifatarot in a new tab</a></p>
      <iframe id="ifatarot-frame" src="${data.url}"></iframe>
    `;
  } catch {
    status.textContent = "Couldn't load Ifatarot right now.";
  }
}

async function checkAdmin() {
  try {
    const me = await apiGet("/accounts/me");
    if (me.role === "superadmin") {
      document.getElementById("admin-config-section")!.style.display = "block";
    }
  } catch {
    // stays hidden
  }
}

document.getElementById("ifatarot-url-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("ifatarot-url-message")!;
  el.innerHTML = "";
  try {
    await apiPut("/admin/ifatarot-url", {
      url: (document.getElementById("ifatarot-url") as HTMLInputElement).value,
    });
    el.innerHTML = `<div class="notice">Saved.</div>`;
    loadIfatarot();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

loadIfatarot();
checkAdmin();
