import { logout } from "./auth";
import { apiGet } from "./api";

export function renderNav(current: string) {
  const el = document.getElementById("nav-root");
  if (!el) return;

  document.body.classList.add("has-sidebar");

  const links = [
    { href: "/dashboard.html", label: "Dashboard" },
    { href: "/profile.html", label: "Profile" },
    { href: "/family-tree.html", label: "Family Tree" },
    { href: "/vault.html", label: "Vault" },
    { href: "/family-media.html", label: "Family Media" },
    { href: "/book.html", label: "Our History" },
    { href: "/life-goals.html", label: "Life Goals" },
    { href: "/narrative.html", label: "Narrative" },
    { href: "/rules.html", label: "Rules" },
    { href: "/documents.html", label: "Documents" },
    { href: "/education.html", label: "Education" },
    { href: "/projects.html", label: "Projects" },
    { href: "/ifatarot.html", label: "Ifatarot" },
    { href: "/polls.html", label: "Polls" },
    { href: "/access-control.html", label: "Access Control" },
    { href: "/council.html", label: "Council" },
    { href: "/families.html", label: "Families" },
    { href: "/directory.html", label: "Directory" },
    { href: "/migration.html", label: "Migration" },
    { href: "/settings.html", label: "Settings" },
  ];

  el.innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="/dashboard.html">Yorubania</a>
      <nav id="nav-links">
        ${links
          .map(
            (l) =>
              `<a href="${l.href}" class="${l.href === current ? "current" : ""}">${l.label}</a>`
          )
          .join("")}
        <a href="#" id="logout-link">Sign out</a>
      </nav>
    </aside>
  `;

  document.getElementById("logout-link")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await logout();
    window.location.href = "/index.html";
  });

  // Admin link only shown to admin/superadmin accounts. This is purely a
  // UI convenience — every admin-only route is enforced server-side
  // regardless of whether this link is visible.
  apiGet("/accounts/me")
    .then((me) => {
      if (me.role === "admin" || me.role === "superadmin") {
        const navLinks = document.getElementById("nav-links")!;
        const adminLink = document.createElement("a");
        adminLink.href = "/admin.html";
        adminLink.textContent = "Admin";
        if ("/admin.html" === current) adminLink.className = "current";
        navLinks.insertBefore(adminLink, document.getElementById("logout-link"));
      }
    })
    .catch(() => {
      // Not fatal — just means the admin link doesn't appear.
    });
}
