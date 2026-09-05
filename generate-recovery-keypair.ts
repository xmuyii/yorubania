/**
 * Run this ONCE, on a computer that is disconnected from the internet
 * (or at minimum one you trust completely and will wipe/reboot after).
 *
 * How to actually run it:
 *   1. Copy this whole `yorubania/` project folder onto that offline machine.
 *   2. `npm install` (do this BEFORE disconnecting from the internet, since
 *      installing packages needs network access — then disconnect).
 *   3. Run:  npx tsx scripts/generate-recovery-keypair.ts
 *      (or `npm install -g tsx` first if `npx tsx` doesn't work)
 *   4. Two long strings print to your terminal: a public key and a private
 *      key.
 *   5. Copy the PUBLIC key. On your normal (online) machine, run this SQL
 *      against Supabase, pasting the public key in:
 *
 *        insert into platform_recovery_keys (public_key)
 *        values ('PASTE_PUBLIC_KEY_HERE');
 *
 *   6. Write the PRIVATE key down on paper, or save it to a USB drive that
 *      goes in a safe/lockbox — never type it into any online service, file
 *      that syncs to the cloud, password manager connected to the internet,
 *      or anywhere else digital-and-connected. This key is what lets a
 *      Standard-mode vault be recovered later; if it's ever copied
 *      somewhere reachable online, the "admin can't casually see vault
 *      contents" guarantee is broken.
 *   7. Close the terminal. If this was a temporary offline machine, wipe it
 *      or don't reconnect it to the internet with the key still on disk —
 *      delete the terminal scrollback / clear history.
 */

import { generateRecoveryKeypair } from "../src/vault/recovery-admin";

async function main() {
  const { publicKeyBase64, privateKeyBase64 } = await generateRecoveryKeypair();

  console.log("\n=== PLATFORM RECOVERY KEYPAIR — GENERATED ONCE, HANDLE WITH CARE ===\n");
  console.log("PUBLIC KEY (paste into platform_recovery_keys table):");
  console.log(publicKeyBase64);
  console.log("\nPRIVATE KEY (write down physically, do NOT save digitally):");
  console.log(privateKeyBase64);
  console.log("\n=== Close this terminal when done. Clear scrollback/history. ===\n");
}

main();
