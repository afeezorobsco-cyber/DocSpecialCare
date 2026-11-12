import { NextResponse } from "next/server";
import { getRecord, putRecord } from "@/lib/store";

export const runtime = "nodejs";
const MAX_BYTES = 12 * 1024 * 1024;

// Upload a sealed (encrypted) record. The on-chain record that points to it is
// created by the uploader's transaction right after this call.
export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Record too large (max ~8MB file)" }, { status: 413 });
  let body: { id: string; ciphertext: string; nonce: string; keys: Record<string, { box: string; nonce: string; eph: string }> };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id || !body.ciphertext || !body.nonce || !body.keys) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  try {
    if (await getRecord(body.id)) return NextResponse.json({ error: "Record exists" }, { status: 409 });
    await putRecord({ id: body.id, ciphertext: body.ciphertext, nonce: body.nonce, keys: body.keys, created_at: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
