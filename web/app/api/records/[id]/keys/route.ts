import { NextResponse } from "next/server";
import { getRecord, putRecord } from "@/lib/store";
import { view } from "@/lib/near";

export const runtime = "nodejs";

// Add a wrapped key for a new reader. Only accepted once the contract already
// lists that reader (i.e. after the patient's grant_access / assign_pharmacy tx),
// and never overwrites an existing key.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { account, key } = await req.json();
  if (!account || !key?.box || !key?.nonce || !key?.eph) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const allowed = await view<boolean>("can_access", { record_id: params.id, account_id: account }).catch(() => false);
  if (!allowed) return NextResponse.json({ error: "Grant access on-chain first" }, { status: 403 });
  const rec = await getRecord(params.id).catch(() => null);
  if (!rec) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  if (rec.keys[account]) return NextResponse.json({ ok: true, existed: true });
  rec.keys[account] = { box: key.box, nonce: key.nonce, eph: key.eph };
  await putRecord(rec);
  return NextResponse.json({ ok: true });
}
