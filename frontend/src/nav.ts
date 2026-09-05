import { logout } from "./auth";

export function renderNav(current: string) {
  const el = document.getElementById("nav-root");
  if (!el) return;

  const links = [
    { href: "/dashboard.html", label: "Dashboard" },
    { href: "/vault.html", label: "Vault" },
    { href: "/council.html", label: "Council" },
    { href: "/families.html", label: "Families" },
    { href: "/directory.html", label: "Directory" },
  ];

  el.innerHTML = `
    <header class="topbar">
      <div class="bar-inner">
        <a class="brand" href="/dashboard.html">Yorubania</a>
        <nav>
          ${links
            .map(
              (l) =>
                `<a href="${l.href}" class="${l.href === current ? "current" : ""}">${l.label}</a>`
            )
            .join("")}
          <a href="#" id="logout-link">Sign out</a>
        </nav>
      </div>
      <div class="rule"></div>
    </header>
  `;

  document.getElementById("logout-link")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await logout();
    window.location.href = "/index.html";
  });
}
