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
      document.getElementById("superadmin-only-2")!.style.display = "block";
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

// --- Death verification ---------------------------------------------------
document.getElementById("load-overdue")!.addEventListener("click", async () => {
  const el = document.getElementById("overdue-list")!;
  el.innerHTML = "Loading…";
  try {
    const data = await apiGet("/admin/death-checkins/overdue");
    if (data.overdue.length === 0) {
      el.innerHTML = "No overdue check-ins.";
      return;
    }
    el.innerHTML = data.overdue
      .map(
        (a: any) =>
          `<div class="row"><span><code>${a.id}</code></span><span class="muted">last check-in ${new Date(a.last_check_in_at).toLocaleDateString()}</span></div>`
      )
      .join("");
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("open-case-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("death-message")!;
  el.innerHTML = "";
  try {
    const data = await apiPost("/admin/death-verification-cases", {
      accountId: (document.getElementById("case-account-id") as HTMLInputElement).value,
    });
    el.innerHTML = `<div class="notice">Case opened: <code>${data.id}</code></div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("resolve-case-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("death-message")!;
  el.innerHTML = "";
  const caseId = (document.getElementById("resolve-case-id") as HTMLInputElement).value;
  const outcome = (document.getElementById("resolve-outcome") as HTMLSelectElement).value;
  const note = (document.getElementById("resolve-note") as HTMLTextAreaElement).value;
  const extendedPresumptionNote = (document.getElementById("presumption-note") as HTMLTextAreaElement).value;
  if (!confirm(`Resolve this case as "${outcome}"? This may trigger irreversible actions (vault destruction, succession).`)) return;
  try {
    const data = await apiPost(`/admin/death-verification-cases/${caseId}/resolve`, {
      outcome,
      note,
      extendedPresumptionNote: outcome === "presumed_death" ? extendedPresumptionNote : undefined,
    });
    el.innerHTML = `<div class="notice">Resolved: ${JSON.stringify(data.succession ?? {})}</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Succession -------------------------------------------------------------
document.getElementById("resolve-succession-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("succession-message")!;
  el.innerHTML = "";
  const caseId = (document.getElementById("succession-case-id") as HTMLInputElement).value;
  try {
    const data = await apiPost(`/succession-cases/${caseId}/resolve`);
    el.innerHTML = `<div class="notice">Winner: <code>${data.winnerAccountId}</code> (${data.method})</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Migration cycles ---------------------------------------------------------
document.getElementById("schedule-cycle-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("migration-admin-message")!;
  el.innerHTML = "";
  const opensAt = new Date((document.getElementById("cycle-opens-at") as HTMLInputElement).value).toISOString();
  const decisionDeadline = new Date(
    (document.getElementById("cycle-deadline") as HTMLInputElement).value
  ).toISOString();
  try {
    const data = await apiPost("/admin/migration-cycles", { opensAt, decisionDeadline });
    el.innerHTML = `<div class="notice">Scheduled: <code>${data.id}</code></div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("open-cycle-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("migration-admin-message")!;
  el.innerHTML = "";
  const cycleId = (document.getElementById("open-cycle-id") as HTMLInputElement).value;
  try {
    await apiPost(`/admin/migration-cycles/${cycleId}/open`);
    el.innerHTML = `<div class="notice">Decision window opened.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Registrations (one-click grant admin for a newly claimed account) ------
document.getElementById("load-registrations")!.addEventListener("click", async () => {
  const el = document.getElementById("registrations-list")!;
  el.innerHTML = "Loading…";
  try {
    const data = await apiGet("/admin/registrations");
    if (data.registrations.length === 0) {
      el.innerHTML = "No registrations yet.";
      return;
    }
    el.innerHTML = data.registrations
      .map(
        (r: any) => `
      <div class="row">
        <span>${r.full_name} — <span class="muted">${r.status}${r.relationship_to_inviter ? ` · ${r.relationship_to_inviter}` : " · unrelated"}</span></span>
        ${
          r.status === "claimed" && r.claimed_by_account_id
            ? `<button class="secondary" data-grant-admin="${r.claimed_by_account_id}">Make admin</button>`
            : r.status === "pending"
            ? `<button class="secondary" data-reject="${r.id}">Reject invite</button>`
            : ""
        }
      </div>`
      )
      .join("");

    el.querySelectorAll("[data-grant-admin]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await apiPost("/admin/admins", { accountId: (btn as HTMLElement).dataset.grantAdmin });
          alert("Granted admin.");
        } catch (err: any) {
          alert(err.message);
        }
      })
    );
    el.querySelectorAll("[data-reject]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await apiPost(`/admin/registrations/${(btn as HTMLElement).dataset.reject}/reject`);
        (document.getElementById("load-registrations") as HTMLButtonElement).click();
      })
    );
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

// --- Superadmin transfer -----------------------------------------------------
document.getElementById("transfer-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const el = document.getElementById("transfer-message")!;
  el.innerHTML = "";
  const newSuperadminAccountId = (document.getElementById("transfer-account-id") as HTMLInputElement).value;
  if (!confirm("This permanently transfers superadmin. You will become an admin, not superadmin. Continue?")) return;
  try {
    await apiPost("/admin/superadmin/transfer", {
      newSuperadminAccountId,
      note: (document.getElementById("transfer-note") as HTMLInputElement).value,
    });
    el.innerHTML = `<div class="notice">Transferred. Reload to see your updated role.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

checkAccess();
