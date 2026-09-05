/**
 * Vault encryption — runs entirely client-side (browser).
 *
 * Zero-knowledge guarantee: the vault master key is derived from the user's
 * passphrase on their own device. The server NEVER receives the passphrase
 * or the derived key — only ciphertext, the KDF salt, and (for Standard
 * mode only) a key sealed to the platform's offline recovery public key.
 *
 * Dependencies:
 *   npm install hash-wasm libsodium-wrappers
 */

import { argon2id } from "hash-wasm";
import sodium from "libsodium-wrappers";

export type KdfParams = {
  memorySizeKb: number;
  iterations: number;
  parallelism: number;
};

// Reasonable interactive Argon2id defaults (OWASP-recommended range).
// Tune based on real device testing before launch — mobile devices in
// particular may need lower memory cost.
export const DEFAULT_KDF_PARAMS: KdfParams = {
  memorySizeKb: 65536, // 64 MB
  iterations: 3,
  parallelism: 1,
};

export type WrappedForUser = {
  ciphertext: Uint8Array; // AES-GCM ciphertext of the master key
  iv: Uint8Array;
  salt: Uint8Array;
  kdfParams: KdfParams;
};

export type WrappedForRecovery = {
  sealedKey: Uint8Array; // libsodium crypto_box_seal output
  recoveryKeyId: string;
};

/** Generates a fresh random 256-bit vault master key. Never leaves the device unencrypted. */
export function generateMasterKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Derives a 256-bit key from a passphrase + salt using Argon2id. */
async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams
): Promise<Uint8Array> {
  const hash = await argon2id({
    password: passphrase,
    salt,
    memorySize: params.memorySizeKb,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return new Uint8Array(hash as Uint8Array);
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  plaintext: Uint8Array
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const key = await importAesKey(keyBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  return { ciphertext: new Uint8Array(ciphertextBuf), iv };
}

async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  ciphertext: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const key = await importAesKey(keyBytes);
  const plaintextBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new Uint8Array(plaintextBuf);
}

/**
 * Wraps the vault master key under a key derived from the user's passphrase.
 * This is present for BOTH Extra Safe and Standard vaults — it's the primary
 * unlock path either way.
 */
export async function wrapMasterKeyForUser(
  masterKey: Uint8Array,
  passphrase: string,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS
): Promise<WrappedForUser> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derivedKey = await deriveKeyFromPassphrase(passphrase, salt, kdfParams);
  const { ciphertext, iv } = await aesGcmEncrypt(derivedKey, masterKey);
  return { ciphertext, iv, salt, kdfParams };
}

/** Recovers the master key from the user's passphrase. Fails (throws) on wrong passphrase. */
export async function unwrapMasterKeyForUser(
  passphrase: string,
  wrapped: WrappedForUser
): Promise<Uint8Array> {
  const derivedKey = await deriveKeyFromPassphrase(
    passphrase,
    wrapped.salt,
    wrapped.kdfParams
  );
  return aesGcmDecrypt(derivedKey, wrapped.ciphertext, wrapped.iv);
}

/**
 * STANDARD MODE ONLY. Seals the master key to the platform's public recovery
 * key using libsodium's crypto_box_seal (anonymous public-key encryption —
 * the client needs only the public key, never any private key material).
 * The result can only be opened by whoever holds the matching offline
 * private key (see recovery-admin.ts), never by the running application.
 */
export async function wrapMasterKeyForRecovery(
  masterKey: Uint8Array,
  recoveryPublicKeyBase64: string,
  recoveryKeyId: string
): Promise<WrappedForRecovery> {
  await sodium.ready;
  const publicKey = sodium.from_base64(recoveryPublicKeyBase64);
  const sealedKey = sodium.crypto_box_seal(masterKey, publicKey);
  return { sealedKey, recoveryKeyId };
}

/** Encrypts a vault item (file bytes) under the already-unlocked master key. */
export async function encryptVaultItem(
  masterKey: Uint8Array,
  fileBytes: Uint8Array
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  return aesGcmEncrypt(masterKey, fileBytes);
}

/** Decrypts a vault item under the already-unlocked master key. */
export async function decryptVaultItem(
  masterKey: Uint8Array,
  ciphertext: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  return aesGcmDecrypt(masterKey, ciphertext, iv);
}
