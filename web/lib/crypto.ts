"use client";
// End-to-end encryption for medical records.
//
// Each user has an x25519 keypair generated in the browser. The public half is
// published on-chain (set_encryption_key). A record is sealed with a random
// symmetric key (XSalsa20-Poly1305 secretbox); that key is then wrapped for each
// allowed reader with an ephemeral nacl.box. The server only ever sees ciphertext.
import nacl from "tweetnacl";
import { decodeBase64, encodeBase64, decodeUTF8, encodeUTF8 } from "tweetnacl-util";

export type WrappedKey = { box: string; nonce: string; eph: string };
export type SealedRecord = {
  ciphertext: string;
  nonce: string;
  keys: Record<string, WrappedKey>;
};

const LS_PREFIX = "dsc:enc:";

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(await sha256(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Real users: random key kept in this browser (exportable).
 * Demo personas: derived from the account name so the demo works on any machine.
 * Demo keys are public by design and must never be used for real data.
 */
export async function getKeypair(account: string, demo: boolean): Promise<nacl.BoxKeyPair> {
  if (demo) {
    const seed = await sha256(decodeUTF8(`docspecialcare-demo-only:${account}`));
    return nacl.box.keyPair.fromSecretKey(seed);
  }
  const stored = localStorage.getItem(LS_PREFIX + account);
  if (stored) return nacl.box.keyPair.fromSecretKey(decodeBase64(stored));
  const kp = nacl.box.keyPair();
  localStorage.setItem(LS_PREFIX + account, encodeBase64(kp.secretKey));
  return kp;
}

export function exportSecret(account: string): string | null {
  return localStorage.getItem(LS_PREFIX + account);
}
export function importSecret(account: string, secretB64: string) {
  nacl.box.keyPair.fromSecretKey(decodeBase64(secretB64)); // validates
  localStorage.setItem(LS_PREFIX + account, secretB64);
}

export const pubB64 = (kp: nacl.BoxKeyPair) => encodeBase64(kp.publicKey);

function wrap(contentKey: Uint8Array, recipientPubB64: string): WrappedKey {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(contentKey, nonce, decodeBase64(recipientPubB64), eph.secretKey);
  return { box: encodeBase64(box), nonce: encodeBase64(nonce), eph: encodeBase64(eph.publicKey) };
}

function unwrap(k: WrappedKey, kp: nacl.BoxKeyPair): Uint8Array {
  const key = nacl.box.open(decodeBase64(k.box), decodeBase64(k.nonce), decodeBase64(k.eph), kp.secretKey);
  if (!key) throw new Error("Cannot unlock this record with your key");
  return key;
}

export async function seal(
  plaintext: object,
  recipients: Record<string, string>
): Promise<{ sealed: SealedRecord; hash: string }> {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ct = nacl.secretbox(decodeUTF8(JSON.stringify(plaintext)), nonce, key);
  const keys: Record<string, WrappedKey> = {};
  for (const [acc, pub] of Object.entries(recipients)) keys[acc] = wrap(key, pub);
  return {
    sealed: { ciphertext: encodeBase64(ct), nonce: encodeBase64(nonce), keys },
    hash: await sha256Hex(ct),
  };
}

export async function open<T>(
  rec: { ciphertext: string; nonce: string; key: WrappedKey },
  kp: nacl.BoxKeyPair,
  expectedHash?: string
): Promise<{ body: T; verified: boolean }> {
  const ct = decodeBase64(rec.ciphertext);
  const verified = expectedHash ? (await sha256Hex(ct)) === expectedHash : false;
  const key = unwrap(rec.key, kp);
  const pt = nacl.secretbox.open(ct, decodeBase64(rec.nonce), key);
  if (!pt) throw new Error("Decryption failed");
  return { body: JSON.parse(encodeUTF8(pt)) as T, verified };
}

/** Re-wrap a record's key for a new reader (used after the patient grants access). */
export function rewrap(myKey: WrappedKey, kp: nacl.BoxKeyPair, recipientPubB64: string): WrappedKey {
  return wrap(unwrap(myKey, kp), recipientPubB64);
}

// ---- consultation chat: nacl.box between patient and provider ----

export function sealMessage(text: string, kp: nacl.BoxKeyPair, otherPubB64: string) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(decodeUTF8(text), nonce, decodeBase64(otherPubB64), kp.secretKey);
  return { box: encodeBase64(box), nonce: encodeBase64(nonce) };
}

export function openMessage(m: { box: string; nonce: string }, kp: nacl.BoxKeyPair, otherPubB64: string) {
  const pt = nacl.box.open(decodeBase64(m.box), decodeBase64(m.nonce), decodeBase64(otherPubB64), kp.secretKey);
  return pt ? encodeUTF8(pt) : "[unable to decrypt]";
}

/** Private video room name only the two parties can derive. */
export async function roomName(consultationId: number, kp: nacl.BoxKeyPair, otherPubB64: string) {
  const shared = nacl.box.before(decodeBase64(otherPubB64), kp.secretKey);
  const tag = decodeUTF8(`room:${consultationId}`);
  const buf = new Uint8Array(shared.length + tag.length);
  buf.set(shared);
  buf.set(tag, shared.length);
  return "DocSpecialCare-" + (await sha256Hex(buf)).slice(0, 24);
}

export function fileToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export const newRecordId = (prefix: string) =>
  `${prefix}-${Array.from(nacl.randomBytes(8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
