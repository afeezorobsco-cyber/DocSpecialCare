// Demo mode (testnet only): lets judges walk the full flow as five personas
// without installing a wallet. The server signs with testnet keys from DEMO_KEYS.
import { NextResponse } from "next/server";
import { Account, KeyPairSigner, providers } from "near-api-js";
import { CONTRACT_ID, NETWORK } from "@/lib/config";
import { rpc, GAS } from "@/lib/near";
import { cleanError as extractError } from "@/lib/errors";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "set_encryption_key", "register_provider", "book_consultation", "complete_consultation",
  "cancel_consultation", "refer_to_specialist", "order_lab_test", "pay_lab_order",
  "submit_lab_result", "issue_prescription", "assign_pharmacy", "quote_prescription",
  "pay_prescription", "dispense_prescription", "add_record", "grant_access", "revoke_access",
]);

function keys(): Record<string, string> {
  try {
    return JSON.parse(process.env.DEMO_KEYS || "{}");
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  if (NETWORK !== "testnet") return NextResponse.json({ error: "Demo mode is testnet only" }, { status: 403 });
  const { as, method, args, deposit } = await req.json();
  const secret = keys()[as];
  if (!secret) return NextResponse.json({ error: `No demo key for ${as}` }, { status: 403 });
  if (!ALLOWED.has(method)) return NextResponse.json({ error: "Method not allowed" }, { status: 400 });
  try {
    const account = new Account(as, rpc(), KeyPairSigner.fromSecretKey(secret as `ed25519:${string}`));
    const outcome = await account.callFunctionRaw({
      contractId: CONTRACT_ID,
      methodName: method,
      args: args || {},
      deposit: BigInt(deposit || "0"),
      gas: GAS,
    });
    const status = outcome.status as { Failure?: unknown };
    if (status && typeof status === "object" && "Failure" in status) {
      return NextResponse.json({ error: extractError(status.Failure), txHash: outcome.transaction.hash }, { status: 400 });
    }
    return NextResponse.json({
      result: providers.getTransactionLastResult(outcome) ?? null,
      txHash: outcome.transaction.hash,
    });
  } catch (e) {
    return NextResponse.json({ error: extractError(e) }, { status: 400 });
  }
}
