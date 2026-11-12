// Off-chain ciphertext store. Holds only encrypted blobs and wrapped keys.
// File-backed for the hackathon; swap for IPFS/S3 without changing the API.
import { promises as fs } from "fs";
import path from "path";

const ROOT = process.env.DATA_DIR || path.join(process.cwd(), "data");

const safe = (s: string) => {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(s)) throw new Error("bad id");
  return s;
};

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
}

export type StoredRecord = {
  id: string;
  ciphertext: string;
  nonce: string;
  keys: Record<string, { box: string; nonce: string; eph: string }>;
  created_at: number;
};

const recFile = (id: string) => path.join(ROOT, "records", safe(id) + ".json");

export const getRecord = (id: string) => readJson<StoredRecord>(recFile(id));
export const putRecord = (r: StoredRecord) => writeJson(recFile(r.id), r);

export type ChatMessage = { from: string; box: string; nonce: string; at: number };
const chatFile = (cid: string) => path.join(ROOT, "chat", safe(cid) + ".json");

export async function getChat(cid: string): Promise<ChatMessage[]> {
  return (await readJson<ChatMessage[]>(chatFile(cid))) || [];
}
export async function appendChat(cid: string, m: ChatMessage) {
  const list = await getChat(cid);
  list.push(m);
  await writeJson(chatFile(cid), list.slice(-500));
}
