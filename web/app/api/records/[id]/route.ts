import { NextResponse } from "next/server";
import { getRecord } from "@/lib/store";
import { canAccess } from "@/lib/near";

export const runtime = "nodejs";

// Returns the ciphertext plus the wrapped key for `account`, but only if the
// smart contract lists that account as a viewer of the record.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const account = new URL(req.url).searchParams.get("account");
  if (!account) return NextResponse.json({ error: "account required" }, { status: 400 });
  let allowed = false;
  try {
    allowed = await canAccess(params.id, account);
  } catch (e) {
    return NextResponse.json({ error: "Chain lookup failed: " + String(e) }, { status: 502 });
  }
  if (!allowed) return NextResponse.json({ error: "Not on this record's access list" }, { status: 403 });
  const rec = await getRecord(params.id).catch(() => null);
  if (!rec) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  return NextResponse.json({
    id: rec.id,
    ciphertext: rec.ciphertext,
    nonce: rec.nonce,
    key: rec.keys[account] || null,
    holders: Object.keys(rec.keys),
  });
}
