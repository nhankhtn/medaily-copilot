/**
 * API key storage with optional passphrase encryption.
 *
 * Plain mode: apiKey in storage.sync, BYOK keys in storage.local (see defaults.js).
 * Encrypted mode: all keys in one AES-GCM blob in storage.local; the AES key is
 * derived from the passphrase with PBKDF2. Unlocking puts the keys (and the
 * derived AES key, so Save can re-encrypt) in storage.session — memory only,
 * not readable by content scripts, wiped on browser restart / extension reload.
 */
import { DEFAULT_LOCAL_SECRETS } from "./defaults.js";

export const SECRET_FIELDS = ["apiKey", ...Object.keys(DEFAULT_LOCAL_SECRETS)];

const BLOB_KEY = "encryptedSecrets";
const SESSION_KEY = "unlockedSecrets";
const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 8;

function emptySecrets() {
  return Object.fromEntries(SECRET_FIELDS.map((f) => [f, ""]));
}

function pickSecrets(source) {
  return Object.fromEntries(
    SECRET_FIELDS.map((f) => [f, String(source?.[f] || "").trim()])
  );
}

/**
 * @returns {Promise<{encrypted: boolean, locked: boolean, secrets: Record<string, string>}>}
 */
export async function getSecretsState() {
  const { [BLOB_KEY]: blob } = await chrome.storage.local.get(BLOB_KEY);
  if (blob) {
    const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
    if (session?.secrets) {
      return { encrypted: true, locked: false, secrets: pickSecrets(session.secrets) };
    }
    return { encrypted: true, locked: true, secrets: emptySecrets() };
  }
  return { encrypted: false, locked: false, secrets: await readPlainSecrets() };
}

/** Save keys in whichever mode is active. Encrypted mode must be unlocked. */
export async function saveSecrets(secrets) {
  const next = pickSecrets(secrets);
  const { [BLOB_KEY]: blob } = await chrome.storage.local.get(BLOB_KEY);
  if (!blob) {
    await writePlainSecrets(next);
    return;
  }
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  if (!session?.keyB64) {
    throw new Error("Keys are locked — unlock with your passphrase first.");
  }
  const key = await importAesKey(session.keyB64);
  await chrome.storage.local.set({
    [BLOB_KEY]: await encryptWithKey(next, key, blob.salt),
  });
  await chrome.storage.session.set({
    [SESSION_KEY]: { secrets: next, keyB64: session.keyB64 },
  });
}

/** Move the current plaintext keys into an encrypted blob. */
export async function enableEncryption(passphrase) {
  assertPassphrase(passphrase);
  const { [BLOB_KEY]: existing } = await chrome.storage.local.get(BLOB_KEY);
  // Plain fields are empty in encrypted mode — re-running would wipe the keys.
  if (existing) throw new Error("Keys are already encrypted.");
  const secrets = await readPlainSecrets();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(passphrase, salt);
  await chrome.storage.local.set({
    [BLOB_KEY]: await encryptWithKey(secrets, key, toB64(salt)),
  });
  await chrome.storage.session.set({
    [SESSION_KEY]: { secrets, keyB64: await exportAesKey(key) },
  });
  await removePlainSecrets();
}

export async function unlockSecrets(passphrase) {
  const { [BLOB_KEY]: blob } = await chrome.storage.local.get(BLOB_KEY);
  if (!blob) throw new Error("Encryption is not enabled.");
  const key = await deriveAesKey(passphrase, fromB64(blob.salt));
  let secrets;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(blob.iv) },
      key,
      fromB64(blob.ct)
    );
    secrets = pickSecrets(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    throw new Error("Wrong passphrase.");
  }
  await chrome.storage.session.set({
    [SESSION_KEY]: { secrets, keyB64: await exportAesKey(key) },
  });
}

export async function lockSecrets() {
  await chrome.storage.session.remove(SESSION_KEY);
}

/** Write the unlocked keys back as plaintext and drop the blob. */
export async function disableEncryption() {
  const state = await getSecretsState();
  if (!state.encrypted) return;
  if (state.locked) {
    throw new Error("Unlock with your passphrase before turning encryption off.");
  }
  await writePlainSecrets(state.secrets);
  await chrome.storage.local.remove(BLOB_KEY);
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function deleteAllSecrets() {
  await removePlainSecrets();
  await chrome.storage.local.remove(BLOB_KEY);
  await chrome.storage.session.remove(SESSION_KEY);
}

async function readPlainSecrets() {
  const sync = await chrome.storage.sync.get({ apiKey: "" });
  const local = await chrome.storage.local.get(DEFAULT_LOCAL_SECRETS);
  return pickSecrets({ ...local, apiKey: sync.apiKey });
}

async function writePlainSecrets(secrets) {
  const { apiKey, ...local } = secrets;
  await chrome.storage.sync.set({ apiKey });
  await chrome.storage.local.set(local);
}

async function removePlainSecrets() {
  await chrome.storage.sync.remove("apiKey");
  await chrome.storage.local.remove(Object.keys(DEFAULT_LOCAL_SECRETS));
}

function assertPassphrase(passphrase) {
  if (String(passphrase || "").length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
}

async function deriveAesKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function encryptWithKey(secrets, key, saltB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(secrets))
  );
  return { v: 1, salt: saltB64, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

async function exportAesKey(key) {
  return toB64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

function importAesKey(keyB64) {
  return crypto.subtle.importKey("raw", fromB64(keyB64), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function toB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
