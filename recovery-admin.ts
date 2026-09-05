/**
 * ADMIN RECOVERY TOOL — Standard-mode vaults only.
 *
 * This file is deliberately NOT part of the running server or client
 * application. It is a standalone script an admin runs manually, on a
 * trusted offline machine, with the platform recovery PRIVATE key supplied
 * as a one-time input (e.g. typed from a printed backup, or read from a
 * hardware security key) — never stored in any environment variable,
 * database, or deployed codebase.
 *
 * Running this against an Extra Safe vault is impossible — those vaults
 * have no admin_recovery_sealed_key at all (enforced by the DB constraint
 * in migration 002), so there is nothing here to unseal.
 *
 * Usage is intentionally manual and a little inconvenient — that friction
 * is the point. Every invocation should be preceded by writing a row to
 * vault_recovery_events (via the normal app/admin API, before this script
 * is run) documenting who authorized it and why.
 */

import sodium from "libsodium-wrappers";

/**
 * Unseals a Standard-mode vault's master key using the offline recovery
 * private key. This is the ONLY function in the entire codebase capable of
 * recovering a vault without the user's passphrase — and it requires key
 * material that the running application never has access to.
 */
export async function unsealRecoveryKey(
  sealedKeyBase64: string,
  recoveryPublicKeyBase64: string,
  recoveryPrivateKeyBase64: string // supplied manually at runtime, never persisted
): Promise<Uint8Array> {
  await sodium.ready;
  const sealedKey = sodium.from_base64(sealedKeyBase64);
  const publicKey = sodium.from_base64(recoveryPublicKeyBase64);
  const privateKey = sodium.from_base64(recoveryPrivateKeyBase64);

  const masterKey = sodium.crypto_box_seal_open(sealedKey, publicKey, privateKey);
  if (!masterKey) {
    throw new Error(
      "Failed to unseal — wrong keypair, or this vault's sealed key does not match."
    );
  }
  return masterKey;
}

/**
 * One-time setup: generates a new platform recovery keypair.
 * Run this ONCE, offline. Store the PRIVATE key output somewhere physically
 * secure and never digitally persist it. Only the public key gets inserted
 * into platform_recovery_keys.
 */
export async function generateRecoveryKeypair(): Promise<{
  publicKeyBase64: string;
  privateKeyBase64: string;
}> {
  await sodium.ready;
  const keypair = sodium.crypto_box_keypair();
  return {
    publicKeyBase64: sodium.to_base64(keypair.publicKey),
    privateKeyBase64: sodium.to_base64(keypair.privateKey),
  };
}
