import { NextResponse } from "next/server";
import { appendChat, getChat } from "@/lib/store";
import { view } from "@/lib/near";
import type { Consultation } from "@/lib/types";

export const runtime = "nodejs";

async function parties(cid: string) {
  const c = await view<Consultation | null>("get_consultation", { id: Number(cid) });
  return c ? [c.patient, c.provider] : null;
}

// Messages are end-to-end encrypted between patient and provider; the server
// stores ciphertext only.
export async function GET(_req: Request, { params }: { params: { cid: string } }) {
  return NextResponse.json(await getChat(params.cid).catch(() => []));
}

export async function POST(req: Request, { params }: { params: { cid: string } }) {
  const { from, box, nonce } = await req.json();
  const p = await parties(params.cid).catch(() => null);
  if (!p) return NextResponse.json({ error: "Consultation not found" }, { status: 404 });
  if (!p.includes(from)) return NextResponse.json({ error: "Not a party to this consultation" }, { status: 403 });
  if (typeof box !== "string" || box.length > 20000) return NextResponse.json({ error: "Bad message" }, { status: 400 });
  await appendChat(params.cid, { from, box, nonce, at: Date.now() });
  return NextResponse.json({ ok: true });
}
