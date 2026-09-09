import { requireSession } from "../auth";
import { apiGet, apiPost, apiPostBinaryWithProgress, apiGetBinary, apiPut } from "../api";
import { renderNav } from "../nav";
import { bytesToBase64, base64ToBytes } from "../base64";
import {
  generateMasterKey,
  wrapMasterKeyForUser,
  unwrapMasterKeyForUser,
  encryptVaultItem,
  decryptVaultItem,
  DEFAULT_KDF_PARAMS,
  type WrappedForUser,
} from "../vault/crypto";

await requireSession();
renderNav("/vault.html");

const initSection = document.getElementById("init-section")!;
const decoySection = document.getElementById("decoy-section")!;
const unlockSection = document.getElementById("unlock-section")!;
const itemsSection = document.getElementById("items-section")!;
const message = document.getElementById("message")!;

// The unwrapped master key lives ONLY in memory, for this tab session.
// Never persisted to localStorage/sessionStorage — a page refresh means
// unlocking again with the passphrase, which is the correct tradeoff for
// a zero-knowledge vault.
let masterKey: Uint8Array | null = null;

function showError(err: unknown) {
  message.innerHTML = `<div class="error">${(err as Error).message}</div>`;
}

async function init() {
  try {
    const vault = await apiGet("/vaults/me");
    if (!vault.decoyCompleted) {
      decoySection.style.display = "block";
    } else {
      unlockSection.style.display = "block";
    }
  } catch {
    // No vault yet.
    initSection.style.display = "block";
  }
}

document.getElementById("init-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.innerHTML = "";

  const passphrase = (document.getElementById("passphrase") as HTMLInputElement).value;
  const securityMode = (document.getElementById("security-mode") as HTMLSelectElement).value;

  try {
    const key = generateMasterKey();
    const wrapped: WrappedForUser = await wrapMasterKeyForUser(key, passphrase, DEFAULT_KDF_PARAMS);

    if (securityMode === "standard") {
      message.innerHTML = `<div class="notice">Standard mode requires a platform recovery public key to be configured first — ask an admin. Falling back to Extra Safe for now.</div>`;
    }

    await apiPost("/vaults/me/init", {
      kdfSalt: bytesToBase64(wrapped.salt),
      kdfAlgorithm: "argon2id",
      kdfParams: wrapped.kdfParams,
      securityMode: "extra_safe",
      wrappedMasterKeyCiphertext: bytesToBase64(wrapped.ciphertext),
      wrappedMasterKeyIv: bytesToBase64(wrapped.iv),
    });

    masterKey = key;
    initSection.style.display = "none";
    decoySection.style.display = "block";
  } catch (err) {
    showError(err);
  }
});

document.getElementById("decoy-submit")!.addEventListener("click", async () => {
  message.innerHTML = "";
  const fileInput = document.getElementById("decoy-file") as HTMLInputElement;
  const file = fileInput.files?.[0];
  const button = document.getElementById("decoy-submit") as HTMLButtonElement;
  const track = document.getElementById("decoy-progress-track")!;
  const fill = document.getElementById("decoy-progress-fill") as HTMLElement;
  const status = document.getElementById("decoy-status")!;

  if (!file || !masterKey) {
    showError(new Error("Choose a file first (and make sure your vault is unlocked)."));
    return;
  }

  button.disabled = true;
  track.classList.add("active");
  fill.style.width = "0%";
  status.textContent = "Encrypting…";

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { ciphertext, iv } = await encryptVaultItem(masterKey, bytes);
    status.textContent = "Uploading…";
    await apiPostBinaryWithProgress(
      "/vaults/me/decoy",
      ciphertext,
      { "x-iv": bytesToBase64(iv), "x-original-format": file.type || "application/octet-stream" },
      (percent) => {
        fill.style.width = `${percent}%`;
        status.textContent = `Uploading… ${percent}%`;
      }
    );
    status.textContent = "Done.";
    decoySection.style.display = "none";
    itemsSection.style.display = "block";
    loadItems();
  } catch (err) {
    status.textContent = "";
    showError(err);
  } finally {
    button.disabled = false;
    track.classList.remove("active");
  }
});

document.getElementById("unlock-submit")!.addEventListener("click", async () => {
  message.innerHTML = "";
  const passphrase = (document.getElementById("unlock-passphrase") as HTMLInputElement).value;

  try {
    const vault = await apiGet("/vaults/me");
    const wrapped: WrappedForUser = {
      ciphertext: base64ToBytes(vault.wrappedMasterKeyCiphertext),
      iv: base64ToBytes(vault.wrappedMasterKeyIv),
      salt: base64ToBytes(vault.kdfSalt),
      kdfParams: vault.kdfParams,
    };
    masterKey = await unwrapMasterKeyForUser(passphrase, wrapped);
    unlockSection.style.display = "none";
    itemsSection.style.display = "block";
    loadItems();
  } catch (err) {
    showError(new Error("Couldn't unlock — check your passphrase."));
  }
});

document.getElementById("item-submit")!.addEventListener("click", async () => {
  message.innerHTML = "";
  const fileInput = document.getElementById("item-file") as HTMLInputElement;
  const file = fileInput.files?.[0];
  const button = document.getElementById("item-submit") as HTMLButtonElement;
  const track = document.getElementById("item-progress-track")!;
  const fill = document.getElementById("item-progress-fill") as HTMLElement;
  const status = document.getElementById("item-status")!;

  if (!file || !masterKey) {
    showError(new Error("Choose a file first."));
    return;
  }

  button.disabled = true;
  track.classList.add("active");
  fill.style.width = "0%";
  status.textContent = "Encrypting…";

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { ciphertext, iv } = await encryptVaultItem(masterKey, bytes);
    status.textContent = "Uploading…";
    await apiPostBinaryWithProgress(
      "/vaults/me/items",
      ciphertext,
      { "x-iv": bytesToBase64(iv), "x-original-format": file.type || "application/octet-stream" },
      (percent) => {
        fill.style.width = `${percent}%`;
        status.textContent = `Uploading… ${percent}%`;
      }
    );
    status.textContent = "Done.";
    fileInput.value = "";
    loadItems();
  } catch (err) {
    status.textContent = "";
    showError(err);
  } finally {
    button.disabled = false;
    track.classList.remove("active");
  }
});

async function loadItems() {
  const el = document.getElementById("items-list")!;
  try {
    const data = await apiGet("/vaults/me/items");
    const realItems = data.items.filter((i: any) => !i.is_decoy);
    if (realItems.length === 0) {
      el.innerHTML = "No items stored yet.";
      return;
    }
    el.innerHTML = realItems
      .map(
        (item: any) => `
      <div class="row">
        <span>Item ${item.id.slice(0, 8)}… — ${(item.size_bytes / 1024).toFixed(1)} KB</span>
        <span>
          <button class="secondary" data-download="${item.id}">Download &amp; decrypt</button>
          <button class="secondary" data-distribute="${item.id}">Inheritance</button>
        </span>
      </div>`
      )
      .join("");

    el.querySelectorAll("[data-download]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const itemId = (btn as HTMLElement).dataset.download!;
        await downloadItem(itemId);
      });
    });
    el.querySelectorAll("[data-distribute]").forEach((btn) => {
      btn.addEventListener("click", () => openDistributionPanel((btn as HTMLElement).dataset.distribute!));
    });
  } catch (err) {
    showError(err);
  }
}

async function downloadItem(itemId: string) {
  if (!masterKey) return;
  try {
    const { bytes, headers } = await apiGetBinary(`/vaults/me/items/${itemId}/download`);
    const iv = base64ToBytes(headers.get("x-iv") ?? "");
    const originalFormat = headers.get("x-original-format") || "application/octet-stream";
    const plaintext = await decryptVaultItem(masterKey, bytes, iv);
    const blob = new Blob([plaintext as unknown as BlobPart], { type: originalFormat });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vault-item-${itemId.slice(0, 8)}${extensionFor(originalFormat)}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err);
  }
}

/** Best-effort mime-type → file extension, so downloads open correctly. */
function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
  };
  return map[mimeType] ?? "";
}

// --- Vault item inheritance rule configuration -----------------------------
let currentDistributionItemId: string | null = null;
let pendingRecipients: { personId: string; cascadeToLineage: boolean }[] = [];

async function openDistributionPanel(itemId: string) {
  currentDistributionItemId = itemId;
  pendingRecipients = [];
  document.getElementById("distribution-item-label")!.textContent = `Item ${itemId.slice(0, 8)}…`;
  document.getElementById("distribution-section")!.style.display = "block";

  try {
    const current = await apiGet(`/vaults/me/items/${itemId}/distribution`);
    (document.getElementById("rule-type") as HTMLSelectElement).value = current.ruleType;
    pendingRecipients = (current.recipients ?? []).map((r: any) => ({
      personId: r.recipient_person_id,
      cascadeToLineage: r.cascade_to_lineage,
    }));
  } catch {
    (document.getElementById("rule-type") as HTMLSelectElement).value = "destroy";
  }
  syncRecipientsVisibility();
  renderRecipients();
}

function syncRecipientsVisibility() {
  const ruleType = (document.getElementById("rule-type") as HTMLSelectElement).value;
  document.getElementById("recipients-wrap")!.style.display = ruleType === "specific_recipients" ? "block" : "none";
}
document.getElementById("rule-type")!.addEventListener("change", syncRecipientsVisibility);

function renderRecipients() {
  const el = document.getElementById("recipients-list")!;
  if (pendingRecipients.length === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = pendingRecipients
    .map(
      (r, i) =>
        `<div class="row"><span><code>${r.personId.slice(0, 8)}…</code> ${r.cascadeToLineage ? "(+ their line)" : ""}</span><button class="secondary" data-remove-recipient="${i}">Remove</button></div>`
    )
    .join("");
  el.querySelectorAll("[data-remove-recipient]").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingRecipients.splice(Number((btn as HTMLElement).dataset.removeRecipient), 1);
      renderRecipients();
    });
  });
}

document.getElementById("add-recipient")!.addEventListener("click", () => {
  const personId = (document.getElementById("recipient-person-id") as HTMLInputElement).value.trim();
  const cascadeToLineage = (document.getElementById("recipient-cascade") as HTMLInputElement).checked;
  if (!personId) return;
  pendingRecipients.push({ personId, cascadeToLineage });
  (document.getElementById("recipient-person-id") as HTMLInputElement).value = "";
  (document.getElementById("recipient-cascade") as HTMLInputElement).checked = false;
  renderRecipients();
});

document.getElementById("save-distribution")!.addEventListener("click", async () => {
  const el = document.getElementById("distribution-message")!;
  el.innerHTML = "";
  if (!currentDistributionItemId) return;
  const ruleType = (document.getElementById("rule-type") as HTMLSelectElement).value;
  try {
    await apiPut(`/vaults/me/items/${currentDistributionItemId}/distribution`, {
      ruleType,
      recipients: ruleType === "specific_recipients" ? pendingRecipients : undefined,
    });
    el.innerHTML = `<div class="notice">Saved.</div>`;
  } catch (err: any) {
    el.innerHTML = `<div class="error">${err.message}</div>`;
  }
});

document.getElementById("close-distribution")!.addEventListener("click", () => {
  document.getElementById("distribution-section")!.style.display = "none";
  currentDistributionItemId = null;
});

init();
