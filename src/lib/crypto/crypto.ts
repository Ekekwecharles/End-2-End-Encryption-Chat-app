export const PBKDF2_ITERATIONS = 200_000;
export const PBKDF2_HASH: AlgorithmIdentifier = "SHA-256";

function requireWebCrypto() {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto API is not available in this environment.");
  }
  return crypto.subtle;
}

export function randomBytes(length: number) {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export function bytesToBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function abToBytes(ab: ArrayBuffer) {
  return new Uint8Array(ab);
}

export function bytesToAb(bytes: Uint8Array) {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

export async function generateRsaOaepKeyPair(modulusLength: 2048 | 3072 = 2048) {
  const subtle = requireWebCrypto();
  return subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  ) as Promise<CryptoKeyPair>;
}

export async function exportPublicKeySpkiBase64(publicKey: CryptoKey) {
  const subtle = requireWebCrypto();
  const spki = await subtle.exportKey("spki", publicKey);
  return bytesToBase64(abToBytes(spki));
}

export async function importPublicKeySpkiBase64(publicKeyB64: string) {
  const subtle = requireWebCrypto();
  const spki = bytesToAb(base64ToBytes(publicKeyB64));
  return subtle.importKey(
    "spki",
    spki,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt"],
  );
}

async function deriveAesWrapKey(password: string, salt: Uint8Array) {
  const subtle = requireWebCrypto();
  const enc = new TextEncoder();

  const baseKey = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: bytesToAb(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapPrivateKeyPkcs8Base64(privateKey: CryptoKey, password: string) {
  const subtle = requireWebCrypto();
  const salt = randomBytes(16);
  const wrapKey = await deriveAesWrapKey(password, salt);
  const iv = randomBytes(12);
  const pkcs8 = await subtle.exportKey("pkcs8", privateKey);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: bytesToAb(iv) },
    wrapKey,
    pkcs8,
  );

  // Format: gcmv1.<base64(iv)>.<base64(ciphertext)>
  const wrapped_private_key = `gcmv1.${bytesToBase64(iv)}.${bytesToBase64(abToBytes(ciphertext))}`;

  return {
    wrapped_private_key,
    pbkdf2_salt: bytesToBase64(salt),
  };
}

export async function unwrapPrivateKeyPkcs8Base64(
  wrappedPrivateKeyB64: string,
  saltB64: string,
  password: string,
) {
  const subtle = requireWebCrypto();
  const salt = base64ToBytes(saltB64);
  const wrapKey = await deriveAesWrapKey(password, salt);

  // Preferred format for this client.
  if (wrappedPrivateKeyB64.startsWith("gcmv1.")) {
    const parts = wrappedPrivateKeyB64.split(".");
    if (parts.length !== 3) throw new Error("Invalid wrapped private key format.");
    const iv = bytesToAb(base64ToBytes(parts[1]));
    const ciphertext = bytesToAb(base64ToBytes(parts[2]));
    const pkcs8 = await subtle.decrypt({ name: "AES-GCM", iv }, wrapKey, ciphertext);
    return subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    );
  }

  // Backward compatibility for old AES-KW wrapped keys (if any exist).
  try {
    const legacyKwKey = await subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: bytesToAb(salt),
        iterations: PBKDF2_ITERATIONS,
        hash: PBKDF2_HASH,
      },
      await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]),
      { name: "AES-KW", length: 256 },
      false,
      ["unwrapKey"],
    );
    const wrapped = bytesToAb(base64ToBytes(wrappedPrivateKeyB64));
    return await subtle.unwrapKey(
      "pkcs8",
      wrapped,
      legacyKwKey,
      "AES-KW",
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    );
  } catch {
    throw new Error("Unable to unwrap private key. Check password or key format.");
  }
}

export async function rsaOaepEncryptBase64(publicKey: CryptoKey, data: ArrayBuffer) {
  const subtle = requireWebCrypto();
  const ct = await subtle.encrypt({ name: "RSA-OAEP" }, publicKey, data);
  return bytesToBase64(abToBytes(ct));
}

export async function rsaOaepDecryptBase64(privateKey: CryptoKey, dataB64: string) {
  const subtle = requireWebCrypto();
  const ct = bytesToAb(base64ToBytes(dataB64));
  return subtle.decrypt({ name: "RSA-OAEP" }, privateKey, ct);
}

export async function aesGcmEncryptBase64(
  key: CryptoKey,
  plaintext: Uint8Array,
  iv: Uint8Array,
) {
  const subtle = requireWebCrypto();
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: bytesToAb(iv) },
    key,
    bytesToAb(plaintext),
  );
  return bytesToBase64(abToBytes(ct));
}

export async function aesGcmDecryptBase64(
  key: CryptoKey,
  ciphertextB64: string,
  ivB64: string,
) {
  const subtle = requireWebCrypto();
  const iv = base64ToBytes(ivB64);
  const ct = bytesToAb(base64ToBytes(ciphertextB64));
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: bytesToAb(iv) }, key, ct);
  return abToBytes(pt);
}

export async function importAesGcmKeyRaw(raw: ArrayBuffer) {
  const subtle = requireWebCrypto();
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function exportAesKeyRaw(key: CryptoKey) {
  const subtle = requireWebCrypto();
  return subtle.exportKey("raw", key);
}

