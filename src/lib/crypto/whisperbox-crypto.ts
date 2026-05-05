import type { EncryptedPayload } from "@/lib/api/whisperbox";
import {
  aesGcmDecryptBase64,
  aesGcmEncryptBase64,
  exportAesKeyRaw,
  importAesGcmKeyRaw,
  importPublicKeySpkiBase64,
  randomBytes,
  rsaOaepDecryptBase64,
  rsaOaepEncryptBase64,
  bytesToBase64,
} from "@/lib/crypto/crypto";

export async function encryptMessageForWhisperBox(params: {
  plaintext: string;
  recipientPublicKeyBase64: string;
  senderPublicKeyBase64: string;
}): Promise<EncryptedPayload> {
  const recipientPublicKey = await importPublicKeySpkiBase64(params.recipientPublicKeyBase64);
  const senderPublicKey = await importPublicKeySpkiBase64(params.senderPublicKeyBase64);

  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  const iv = randomBytes(12);
  const ptBytes = new TextEncoder().encode(params.plaintext);
  const ciphertext = await aesGcmEncryptBase64(aesKey, ptBytes, iv);

  const aesRaw = await exportAesKeyRaw(aesKey);
  const encryptedKey = await rsaOaepEncryptBase64(recipientPublicKey, aesRaw);
  const encryptedKeyForSelf = await rsaOaepEncryptBase64(senderPublicKey, aesRaw);

  return {
    ciphertext,
    iv: bytesToBase64(iv),
    encryptedKey,
    encryptedKeyForSelf,
  };
}

export async function decryptWhisperBoxPayload(params: {
  payload: EncryptedPayload;
  privateKey: CryptoKey;
  preferSelfKey?: boolean;
}): Promise<string> {
  const wrappedKey = params.preferSelfKey
    ? params.payload.encryptedKeyForSelf
    : params.payload.encryptedKey;

  const aesRaw = await rsaOaepDecryptBase64(params.privateKey, wrappedKey);
  const aesKey = await importAesGcmKeyRaw(aesRaw);

  const pt = await aesGcmDecryptBase64(aesKey, params.payload.ciphertext, params.payload.iv);
  return new TextDecoder().decode(pt);
}

export async function decryptWhisperBoxPayloadTryBoth(params: {
  payload: EncryptedPayload;
  privateKey: CryptoKey;
}): Promise<{ plaintext: string; used: "recipient" | "self" }> {
  try {
    const plaintext = await decryptWhisperBoxPayload({
      payload: params.payload,
      privateKey: params.privateKey,
      preferSelfKey: false,
    });
    return { plaintext, used: "recipient" };
  } catch {
    const plaintext = await decryptWhisperBoxPayload({
      payload: params.payload,
      privateKey: params.privateKey,
      preferSelfKey: true,
    });
    return { plaintext, used: "self" };
  }
}

