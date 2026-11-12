"use client";
import type nacl from "tweetnacl";
import { view } from "./near";
import { newRecordId, open, rewrap, seal, type WrappedKey } from "./crypto";
import type { ChainRecord, RecordBody } from "./types";

export async function pubKeyOf(account: string): Promise<string> {
  const k = await view<string | null>("get_encryption_key", { account_id: account });
  if (!k) throw new Error(`${account} has not activated secure records yet (no encryption key on-chain).`);
  return k;
}

/** Encrypts `body` for the given readers and uploads the ciphertext. Returns the id + hash to put on-chain. */
export async function createRecord(prefix: string, body: RecordBody, readers: string[]) {
  const uniq = Array.from(new Set(readers));
  const pubs: Record<string, string> = {};
  for (const r of uniq) pubs[r] = await pubKeyOf(r);
  const { sealed, hash } = await seal(body, pubs);
  const id = newRecordId(prefix);
  const res = await fetch("/api/records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...sealed }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
  return { id, hash };
}

export async function readRecord(id: string, account: string, kp: nacl.BoxKeyPair) {
  const chain = await view<ChainRecord | null>("get_record", { record_id: id });
  const res = await fetch(`/api/records/${encodeURIComponent(id)}?account=${encodeURIComponent(account)}`);
  const j = await res.json();
  if (!res.ok) throw new Error(j.error);
  if (!j.key) throw new Error("Access granted on-chain; waiting for the patient's app to share the key.");
  const { body, verified } = await open<RecordBody>(j, kp, chain?.content_hash);
  return { body, verified, chain };
}

/**
 * Patient-side: for every record the patient owns, make sure each on-chain
 * viewer has a wrapped key. Runs after grant_access / assign_pharmacy, and on
 * page load (covers wallets that redirect away mid-flow).
 */
export async function syncShares(account: string, kp: nacl.BoxKeyPair): Promise<number> {
  const recs = await view<ChainRecord[]>("records_for", { account_id: account });
  let shared = 0;
  for (const r of recs.filter((x) => x.patient === account)) {
    const res = await fetch(`/api/records/${encodeURIComponent(r.id)}?account=${encodeURIComponent(account)}`);
    if (!res.ok) continue;
    const j: { key: WrappedKey | null; holders: string[] } = await res.json();
    if (!j.key) continue;
    for (const v of r.viewers.filter((v) => !j.holders.includes(v))) {
      const pub = await view<string | null>("get_encryption_key", { account_id: v });
      if (!pub) continue;
      const key = rewrap(j.key, kp, pub);
      const up = await fetch(`/api/records/${encodeURIComponent(r.id)}/keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: v, key }),
      });
      if (up.ok) shared++;
    }
  }
  return shared;
}
