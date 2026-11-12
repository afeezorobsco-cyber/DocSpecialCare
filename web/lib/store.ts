// Off-chain ciphertext store. Holds only encrypted blobs and wrapped keys.
// Two backends behind one API:
//   - Vercel Blob (private) when BLOB_READ_WRITE_TOKEN is set (production)
//   - local files under ./data otherwise (dev)
// Everything is write-once (data, each wrapped key, each chat message is its own
// object), so there are no overwrite/consistency races.
import { promises as fs } from "fs";
import path from "path";
import { get, list, put } from "@vercel/blob";

export type WrappedKey = { box: string; nonce: string; eph: string };
export type StoredRecord = {
  id: string;
  ciphertext: string;
  nonce: string;
  keys: Record<string, WrappedKey>;
  created_at: number;
};
export type ChatMessage = { from: string; box: string; nonce: string; at: number };

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const ROOT = process.env.DATA_DIR || path.join(process.cwd(), "data");

const safe = (s: string) => {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(s)) throw new Error("bad id");
  return s;
};

// ---------------------------------------------------------------- primitives

async function readObj<T>(p: string): Promise<T | null> {
  if (USE_BLOB) {
    const r = await get(p, { access: "private", useCache: false }).catch(() => null);
    if (!r || !r.stream) return null;
    return JSON.parse(await new Response(r.stream).text()) as T;
  }
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, p), "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeObj(p: string, data: unknown) {
  const body = JSON.stringify(data);
  if (USE_BLOB) {
    await put(p, body, { access: "private", addRandomSuffix: false, contentType: "application/json" });
    return;
  }
  const f = path.join(ROOT, p);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, body, { flag: "wx" }); // write-once
}

async function listNames(prefix: string): Promise<string[]> {
  if (USE_BLOB) {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await list({ prefix, cursor, limit: 1000 });
      out.push(...r.blobs.map((b) => b.pathname));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  }
  try {
    return (await fs.readdir(path.join(ROOT, prefix))).map((f) => prefix + f);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- records

const recBase = (id: string) => `records/${safe(id)}/`;
const accFile = (a: string) => safe(a.replace(/[^A-Za-z0-9_.-]/g, "_")) + ".json";

export async function recordExists(id: string) {
  return (await readObj(recBase(id) + "data.json")) !== null;
}

export async function putRecord(r: StoredRecord) {
  await writeObj(recBase(r.id) + "data.json", { id: r.id, ciphertext: r.ciphertext, nonce: r.nonce, created_at: r.created_at });
  for (const [acc, k] of Object.entries(r.keys)) await writeObj(recBase(r.id) + "keys/" + accFile(acc), { account: acc, ...k });
}

export async function getRecord(id: string): Promise<StoredRecord | null> {
  const data = await readObj<Omit<StoredRecord, "keys">>(recBase(id) + "data.json");
  if (!data) return null;
  const keys: Record<string, WrappedKey> = {};
  const names = await listNames(recBase(id) + "keys/");
  await Promise.all(
    names.map(async (n) => {
      const k = await readObj<WrappedKey & { account: string }>(n);
      if (k) keys[k.account] = { box: k.box, nonce: k.nonce, eph: k.eph };
    })
  );
  return { ...data, keys };
}

/** Adds a wrapped key for a new reader. Returns false if one already exists. */
export async function addKey(id: string, account: string, k: WrappedKey): Promise<boolean> {
  const p = recBase(id) + "keys/" + accFile(account);
  if (await readObj(p)) return false;
  await writeObj(p, { account, ...k }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------- chat

export async function getChat(cid: string): Promise<ChatMessage[]> {
  const names = (await listNames(`chat/${safe(cid)}/`)).sort().slice(-300);
  const msgs = await Promise.all(names.map((n) => readObj<ChatMessage>(n)));
  return msgs.filter((m): m is ChatMessage => !!m).sort((a, b) => a.at - b.at);
}

export async function appendChat(cid: string, m: ChatMessage) {
  const name = `${String(m.at).padStart(15, "0")}-${Math.random().toString(36).slice(2, 10)}.json`;
  await writeObj(`chat/${safe(cid)}/${name}`, m);
}
