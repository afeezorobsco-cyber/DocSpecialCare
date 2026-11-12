import { NextResponse } from "next/server";
import { addKey, recordExists } from "@/lib/store";
import { canAccess } from "@/lib/near";

export const runtime = "nodejs";

// Add a wrapped key for a new reader. Only accepted once the contract already
// lists that reader (i.e. after the patient's grant_access / assign_pharmacy tx),
// and never overwrites an existing key.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { account, key } = await req.json();
  if (!account || !key?.box || !key?.nonce || !key?.eph) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const allowed = await canAccess(params.id, account).catch(() => false);
  if (!allowed) return NextResponse.json({ error: "Grant access on-chain first" }, { status: 403 });
  if (!(await recordExists(params.id).catch(() => false))) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  const added = await addKey(params.id, account, { box: key.box, nonce: key.nonce, eph: key.eph });
  return NextResponse.json({ ok: true, existed: !added });
}
