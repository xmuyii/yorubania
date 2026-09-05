const BASE_URL: string = import.meta.env.VITE_API_BASE_URL;

const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const heading = document.getElementById("welcome-heading")!;
const sub = document.getElementById("welcome-sub")!;
const form = document.getElementById("claim-form") as HTMLFormElement;
const message = document.getElementById("message")!;

async function init() {
  if (!token) {
    sub.textContent = "No invite token found in this link. Ask whoever invited you for the correct link.";
    return;
  }

  try {
    const res = await fetch(`${BASE_URL}/invite/${token}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    heading.textContent = `Welcome, ${data.fullName}`;
    sub.textContent = "Set an email and password to activate your account.";
    form.style.display = "block";
  } catch {
    sub.textContent =
      "This invite link is invalid or has already been used. Ask whoever invited you for a new link.";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.innerHTML = "";

  const email = (document.getElementById("email") as HTMLInputElement).value;
  const password = (document.getElementById("password") as HTMLInputElement).value;

  try {
    const res = await fetch(`${BASE_URL}/invite/${token}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Failed to claim account");
    }
    message.innerHTML = `<div class="notice">Account created. You can now <a href="/index.html">sign in</a>.</div>`;
    form.style.display = "none";
  } catch (err: any) {
    message.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

init();
