import { login, getAccessToken } from "../auth";

const form = document.getElementById("login-form") as HTMLFormElement;
const message = document.getElementById("message")!;

// Already signed in? Skip straight to the dashboard.
getAccessToken().then((token) => {
  if (token) window.location.href = "/dashboard.html";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.innerHTML = "";

  const email = (document.getElementById("email") as HTMLInputElement).value;
  const password = (document.getElementById("password") as HTMLInputElement).value;

  const { error } = await login(email, password);
  if (error) {
    message.innerHTML = `<div class="error">${error}</div>`;
    return;
  }
  window.location.href = "/dashboard.html";
});
