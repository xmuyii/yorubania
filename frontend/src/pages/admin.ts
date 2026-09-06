import { requireSession } from "../auth";
import { apiGet, apiPost, apiDelete, apiPut } from "../api";
import { renderNav } from "../nav";

await requireSession();
renderNav("/admin.html");

const message = document.getElementById("message")!;

async function checkAccess() {
  try {
    const me = await apiGet("/accounts/me");
    if (me.role !== "admin" && me.role !== "superadmin") {
      document.getElementById("access-check")!.textContent =
        "This page is for admins only. If you believe you should have access, contact a superadmin.";
      return;
    }
    document.getElementById("access-check")!.textContent = `Signed in as ${me.role}.`;
    document.getElementById("admin-content")!.style.display = "block";

    if (me.role === "superadmin") {
      document.getElementById("superadmin-only")!.style.display = "block";
      loadAdmins();
    }
    loadBackupStatus();
  } catch {
    document.getElementById("access-check")!.textContent = "Couldn't verify access.";
  }
}

// --- Register a person ------------------------------------------------------
document.getElementById("register-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("register-result")!;
  const fullName = (document.getElementById("register-name") as HTMLInputElement).value;
  try {
    const data = await apiPost("/admin/register-person", { fullName });
    const claimLink = `${window.location.origin}/claim.html?token=${data.inviteToken}`;
    el.innerHTML = `<div class="notice">Invite created for ${fullName}: <br><code>${claimLink}</code></div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Council elections --------------------------------------------------------
document.getElementById("open-election-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("election-result")!;
  const seatNumber = Number((document.getElementById("seat-number") as HTMLInputElement).value);
  const opensAt = new Date((document.getElementById("opens-at") as HTMLInputElement).value).toISOString();
  const closesAt = new Date((document.getElementById("closes-at") as HTMLInputElement).value).toISOString();
  try {
    const data = await apiPost("/council/elections", { seatNumber, opensAt, closesAt });
    el.innerHTML = `<div class="notice">Election opened. ID: <code>${data.id}</code></div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("resolve-election-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("election-result")!;
  const electionId = (document.getElementById("resolve-election-id") as HTMLInputElement).value;
  try {
    const data = await apiPost(`/council/elections/${electionId}/resolve`, {});
    el.innerHTML = `<div class="notice">Resolved. Winner: <code>${data.winnerAccountId}</code>, term ends ${data.termExpectedEnd}.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Log an achievement (admin-only, on a member's behalf) ---------------------
document.getElementById("achievement-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("achievement-result")!;
  const accountId = (document.getElementById("achievement-account-id") as HTMLInputElement).value;
  const title = (document.getElementById("achievement-title") as HTMLInputElement).value;
  const description = (document.getElementById("achievement-description") as HTMLTextAreaElement).value;
  try {
    await apiPost("/tribe/achievements", { accountId, title, description });
    el.innerHTML = `<div class="notice">Logged.</div>`;
    (document.getElementById("achievement-form") as HTMLFormElement).reset();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Backups -------------------------------------------------------------------
async function loadBackupStatus() {
  const el = document.getElementById("backup-status")!;
  try {
    const data = await apiGet("/admin/backups/status");
    el.innerHTML = data.overdue
      ? `<strong style="color: var(--alert)">Overdue.</strong> Last backup: ${
          data.lastBackupAt ? new Date(data.lastBackupAt).toLocaleString() : "never"
        }.`
      : `Last backup: ${new Date(data.lastBackupAt).toLocaleString()} — within the ${data.staleThresholdDays}-day window.`;
  } catch {
    el.textContent = "Couldn't load backup status.";
  }
}

document.getElementById("trigger-backup")!.addEventListener("click", async () => {
  const el = document.getElementById("backup-result")!;
  el.innerHTML = "Running backup — this may take a moment…";
  try {
    const data = await apiPost("/admin/backups/system");
    el.innerHTML = `<div class="notice">Backup complete: ${(data.sizeBytes / 1024).toFixed(1)} KB.</div>`;
    loadBackupStatus();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Superadmin: manage admins & recovery custodian -----------------------------
async function loadAdmins() {
  const el = document.getElementById("admins-list")!;
  try {
    const data = await apiGet("/admin/admins");
    el.innerHTML = data.admins
      .map(
        (a: any) => `
      <div class="row">
        <span><code>${a.id}</code> — ${a.role}</span>
        ${
          a.role === "admin"
            ? `<button class="secondary" data-revoke="${a.id}">Revoke</button>`
            : ""
        }
      </div>`
      )
      .join("");

    el.querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.revoke!;
        if (!confirm("Revoke admin access for this account?")) return;
        await apiDelete(`/admin/admins/${id}`);
        loadAdmins();
      });
    });
  } catch {
    el.textContent = "Couldn't load admins.";
  }
}

document.getElementById("grant-admin-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("admin-mgmt-result")!;
  const accountId = (document.getElementById("grant-account-id") as HTMLInputElement).value;
  try {
    await apiPost("/admin/admins", { accountId });
    el.innerHTML = `<div class="notice">Admin role granted.</div>`;
    loadAdmins();
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("custodian-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("custodian-result")!;
  const accountId = (document.getElementById("custodian-account-id") as HTMLInputElement).value;
  try {
    await apiPut("/admin/vault-recovery-custodian", { accountId });
    el.innerHTML = `<div class="notice">Recovery custodian updated.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

checkAccess();
