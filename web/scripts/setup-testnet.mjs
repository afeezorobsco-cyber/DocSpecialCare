#!/usr/bin/env node
// One-shot testnet setup for DocSpecialCare.
//
//   node scripts/setup-testnet.mjs [path/to/docspecialcare.wasm]
//
// 1. Creates (or reuses) a master testnet account funded by the NEAR faucet.
// 2. Creates sub-accounts: the contract + 6 demo personas.
// 3. Deploys and initialises the contract, registers + verifies providers.
// 4. Publishes each persona's demo encryption key.
// 5. Writes web/.env.local so `npm run dev` just works.
//
// Keys are stored in web/.demo-keys.json (gitignored). Testnet only.
import { Account, KeyPair, KeyPairSigner, providers } from "near-api-js";
import nacl from "tweetnacl";
import { createHash, randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "..");
const KEYS_FILE = path.join(WEB, ".demo-keys.json");
const BUILT = path.resolve(WEB, "../contract/target/near/docspecialcare.wasm");
const PREBUILT = path.resolve(WEB, "../contract/res/docspecialcare.wasm");
const WASM = process.argv[2] || (existsSync(BUILT) ? BUILT : PREBUILT);
const RPC = process.env.RPC_URL || "https://test.rpc.fastnear.com";
const FAUCET = "https://helper.nearprotocol.com/account";
const NEAR = (n) => BigInt(Math.round(n * 1000)) * 10n ** 21n;
const provider = new providers.JsonRpcProvider({ url: RPC });

const PERSONAS = [
  { key: "patient", label: "Patient: Amaka", blurb: "Books doctors, pays fees, owns her records", fund: 2.2 },
  { key: "gp", label: "Dr. Tunde Bello (Physician)", blurb: "General practice, first consultation", fund: 0.35,
    role: "Physician", name: "Dr. Tunde Bello", specialty: "General practice", license: "MDCN-GP-20431", fee: 0.1 },
  { key: "cardio", label: "Dr. Ngozi Eze (Cardiologist)", blurb: "Specialist, needs a referral", fund: 0.35,
    role: "Specialist", name: "Dr. Ngozi Eze", specialty: "Cardiology", license: "MDCN-SP-11872", fee: 0.25 },
  { key: "lab", label: "CityLab Diagnostics", blurb: "Runs tests, uploads encrypted results", fund: 0.35,
    role: "Laboratory", name: "CityLab Diagnostics", specialty: "Haematology & chemistry", license: "MLSCN-L-3391", fee: 0.15 },
  { key: "pharmacy", label: "HealthPlus Pharmacy", blurb: "Verifies & dispenses prescriptions", fund: 0.35,
    role: "Pharmacy", name: "HealthPlus Pharmacy", specialty: "Retail pharmacy", license: "PCN-R-77810", fee: 0 },
];

const load = () => (existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, "utf8")) : {});
const save = (k) => writeFileSync(KEYS_FILE, JSON.stringify(k, null, 2));
const acct = (id, secret) => new Account(id, provider, KeyPairSigner.fromSecretKey(secret));

async function exists(id) {
  try {
    await provider.query({ request_type: "view_account", account_id: id, finality: "final" });
    return true;
  } catch {
    return false;
  }
}

async function faucetAccount() {
  const id = `docspecialcare-${randomBytes(3).toString("hex")}.testnet`;
  const kp = KeyPair.fromRandom("ed25519");
  console.log(`→ creating ${id} via faucet…`);
  const r = await fetch(FAUCET, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!r.ok) throw new Error(`Faucet failed: ${r.status} ${await r.text()}`);
  for (let i = 0; i < 20 && !(await exists(id)); i++) await new Promise((s) => setTimeout(s, 1500));
  return { id, secret: kp.toString() };
}

function demoEncryptionPub(accountId) {
  const seed = createHash("sha256").update(`docspecialcare-demo-only:${accountId}`).digest();
  return Buffer.from(nacl.box.keyPair.fromSecretKey(new Uint8Array(seed)).publicKey).toString("base64");
}

async function main() {
  const keys = load();

  if (!keys.master) {
    keys.master = process.env.MASTER_ACCOUNT
      ? { id: process.env.MASTER_ACCOUNT, secret: process.env.MASTER_KEY }
      : await faucetAccount();
    save(keys);
  }
  const master = acct(keys.master.id, keys.master.secret);
  console.log(`master: ${keys.master.id}  balance ${(Number(await master.getBalance()) / 1e24).toFixed(2)} NEAR`);

  // contract + personas as NEAR sub-accounts of master
  const subs = [{ key: "contract", fund: 3.5 }, ...PERSONAS];
  for (const s of subs) {
    if (keys[s.key] && (await exists(keys[s.key].id))) continue;
    const kp = KeyPair.fromRandom("ed25519");
    const id = `${s.key}.${keys.master.id}`;
    console.log(`→ sub-account ${id} (${s.fund} NEAR)`);
    await master.createSubAccount(s.key, kp.getPublicKey().toString(), NEAR(s.fund));
    keys[s.key] = { id, secret: kp.toString() };
    save(keys);
  }

  // deploy + init
  const contractId = keys.contract.id;
  const contract = acct(contractId, keys.contract.secret);
  if (!existsSync(WASM)) throw new Error(`WASM not found at ${WASM}. Run: cd contract && cargo near build non-reproducible-wasm`);
  console.log(`→ deploying ${path.basename(WASM)} to ${contractId}`);
  await contract.deployContract(new Uint8Array(readFileSync(WASM)));
  const initialised = await provider.callFunction(contractId, "get_owner", {}).then(() => true).catch(() => false);
  if (!initialised) {
    await contract.callFunction({ contractId, methodName: "new", args: { owner: keys.master.id, auto_verify: false } });
    console.log("→ initialised");
  }

  // providers + encryption keys
  for (const p of PERSONAS) {
    const a = acct(keys[p.key].id, keys[p.key].secret);
    if (p.role) {
      await a.callFunction({
        contractId,
        methodName: "register_provider",
        args: { role: p.role, name: p.name, specialty: p.specialty, license_id: p.license, fee: NEAR(p.fee).toString() },
      });
      await master.callFunction({ contractId, methodName: "verify_provider", args: { account_id: keys[p.key].id, verified: true } });
      console.log(`→ ${p.name} registered & verified`);
    }
    await a.callFunction({ contractId, methodName: "set_encryption_key", args: { public_key: demoEncryptionPub(keys[p.key].id) } });
  }

  const personas = PERSONAS.map((p) => ({ label: p.label, account: keys[p.key].id, blurb: p.blurb }));
  const demoKeys = Object.fromEntries(PERSONAS.map((p) => [keys[p.key].id, keys[p.key].secret]));
  writeFileSync(
    path.join(WEB, ".env.local"),
    [
      "NEXT_PUBLIC_NETWORK=testnet",
      `NEXT_PUBLIC_CONTRACT_ID=${contractId}`,
      `NEXT_PUBLIC_DEMO_PERSONAS=${JSON.stringify(personas)}`,
      `DEMO_KEYS=${JSON.stringify(demoKeys)}`,
      "",
    ].join("\n")
  );
  console.log(`\n✓ Done. Contract: https://testnet.nearblocks.io/address/${contractId}\n  web/.env.local written. Run: npm run dev`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
