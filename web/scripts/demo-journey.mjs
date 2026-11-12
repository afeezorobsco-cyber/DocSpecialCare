#!/usr/bin/env node
// Runs the complete DocSpecialCare patient journey on NEAR testnet from the
// command line and prints an explorer link for every transaction.
//
//   npm run journey
//
// Requires web/.demo-keys.json (created by `npm run setup:testnet`).
// Record payloads here are random bytes; the web app does real encryption.
import { Account, KeyPairSigner, providers } from "near-api-js";
import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(path.resolve(here, "../.demo-keys.json"), "utf8"));
const provider = new providers.JsonRpcProvider({ url: process.env.RPC_URL || "https://test.rpc.fastnear.com" });
const CONTRACT = keys.contract.id;
const EXPLORER = "https://testnet.nearblocks.io/txns/";
const as = (k) => new Account(keys[k].id, provider, KeyPairSigner.fromSecretKey(keys[k].secret));
const view = (m, a = {}) => provider.callFunction(CONTRACT, m, a);
const rec = (p) => ({ record_id: `cli-${p}-${randomBytes(6).toString("hex")}`, content_hash: createHash("sha256").update(randomBytes(32)).digest("hex") });

async function step(label, who, methodName, args, depositYocto = "0") {
  const out = await as(who).callFunctionRaw({ contractId: CONTRACT, methodName, args, deposit: BigInt(depositYocto), gas: 100_000_000_000_000n });
  if (out.status?.Failure) throw new Error(`${label} failed: ${JSON.stringify(out.status.Failure)}`);
  const result = providers.getTransactionLastResult(out);
  console.log(`✓ ${label.padEnd(46)} ${EXPLORER}${out.transaction.hash}`);
  return result;
}

const gp = await view("get_provider", { account_id: keys.gp.id });
const cardio = await view("get_provider", { account_id: keys.cardio.id });
const lab = await view("get_provider", { account_id: keys.lab.id });
const slot = () => Date.now() + 3600_000 + Math.floor(Math.random() * 1e6) * 1000;

console.log(`DocSpecialCare journey on ${CONTRACT}\n`);
const c1 = await step(`Patient books ${gp.name}`, "patient", "book_consultation", { provider_id: keys.gp.id, slot_start: slot(), referral_id: null }, gp.fee);
await step("GP completes consultation (fee released)", "gp", "complete_consultation", { consultation_id: c1 });
const r = rec("ref");
const ref = await step(`GP refers patient to ${cardio.name}`, "gp", "refer_to_specialist", { consultation_id: c1, specialist_id: keys.cardio.id, ...r });
const c2 = await step("Patient books specialist with referral", "patient", "book_consultation", { provider_id: keys.cardio.id, slot_start: slot(), referral_id: ref }, cardio.fee);
const lo = rec("lab");
const order = await step(`Specialist orders tests at ${lab.name}`, "cardio", "order_lab_test", { consultation_id: c2, lab_id: keys.lab.id, ...lo });
await step("Patient pays lab into escrow", "patient", "pay_lab_order", { lab_order_id: order }, lab.fee);
const res = rec("res");
await step("Lab submits encrypted result (fee released)", "lab", "submit_lab_result", { lab_order_id: order, ...res });
console.log(`  specialist can open result: ${await view("can_access", { record_id: res.record_id, account_id: keys.cardio.id })}`);
const rx = rec("rx");
const rxId = await step("Specialist issues prescription", "cardio", "issue_prescription", { consultation_id: c2, record_id: rx.record_id, details_hash: rx.content_hash, valid_days: 30 });
await step("Specialist completes consultation", "cardio", "complete_consultation", { consultation_id: c2 });
await step("Patient sends Rx to pharmacy", "patient", "assign_pharmacy", { prescription_id: rxId, pharmacy_id: keys.pharmacy.id });
const price = (5n * 10n ** 22n).toString(); // 0.05 NEAR
await step("Pharmacy quotes 0.05 NEAR", "pharmacy", "quote_prescription", { prescription_id: rxId, price });
await step("Patient pays pharmacy into escrow", "patient", "pay_prescription", { prescription_id: rxId }, price);
await step("Pharmacy dispenses (payment released)", "pharmacy", "dispense_prescription", { prescription_id: rxId });

try {
  await step("Pharmacy tries to dispense AGAIN", "pharmacy", "dispense_prescription", { prescription_id: rxId });
  console.log("✕ double dispensing was not blocked!");
  process.exit(1);
} catch {
  console.log("✓ Second dispense rejected by the contract (no double filling)");
}
const final = await view("get_prescription", { id: rxId });
console.log(`\nPrescription #${rxId}: ${final.status}. Journey complete.`);
