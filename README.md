# DocSpecialCare

**See a doctor online, get referred to a specialist, run lab tests and collect your prescription, without spending the day in a hospital queue.**
Every hand-off and every payment is enforced by a NEAR smart contract, and all medical data is end-to-end encrypted and controlled by the patient.

Built for the **NEAR Hackathon 2026** (tracks: *Real-World Money*, *Privacy & Private AI*, *Open Innovation*).

- **Live demo: https://docspecialcare.vercel.app** (open `/app`, pick a demo persona)
- Live contract (testnet): [`care.docspecialcare-33f312.testnet`](https://testnet.nearblocks.io/address/care.docspecialcare-33f312.testnet)
- Stack: Rust smart contract (near-sdk 5) · Next.js 14 web app · NEAR Wallet Selector · TweetNaCl (x25519 / XSalsa20-Poly1305)

---

## The problem

In many hospitals, especially across Nigeria and much of Africa, a patient can queue for hours to see a general physician for ten minutes, then queue again for a specialist, again at the lab, and again at the pharmacy. Paper referrals get lost, lab results are handed around on paper, prescriptions can be forged or filled twice, and patients pay up front with no recourse if the doctor never shows up.

## What DocSpecialCare does

One care pathway, five parties, one contract:

```
 Patient ──book + pay (escrow)──▶ Physician ──complete──▶ fee released
                                     │
                                     └─refer (on-chain)──▶ Specialist ◀──book with referral── Patient
                                                             │
                                  order test ◀───────────────┤
                                     ▼                       │
 Patient ──pay (escrow)──▶ Laboratory ──encrypted result──▶  │ (specialist decrypts, reviews)
                                     fee released            │
                                                             └─prescribe──▶ Patient ──send to──▶ Pharmacy
                                                                                 └─pay (escrow)──▶ dispense once ──▶ paid
```

| Step | What happens on NEAR |
|---|---|
| **Book a physician** | Patient picks a time slot; the fee is held by the contract. Double-booking is impossible. No hospital queue. |
| **Consult** | End-to-end encrypted chat + a private video room (Jitsi) whose name only the two parties can derive. |
| **Complete** | Doctor marks it complete → fee released. Patient can reclaim if cancelled before the slot, or if the doctor doesn't show within 24 h. |
| **Refer** | Physician issues an on-chain referral to a *verified* specialist. Specialists **cannot** be booked without one, and a referral can't be used by anyone else or twice. |
| **Lab test** | Doctor orders tests at a verified lab; patient pays into escrow; lab uploads the encrypted result → lab is paid and the patient, ordering doctor and lab get access. |
| **Specialist review** | The specialist decrypts the result in their browser; the contract's sha-256 hash proves it wasn't altered. |
| **Prescribe** | Signed on-chain by the verified prescriber, with an expiry date. |
| **Pharmacy** | Patient chooses a pharmacy (which then gains access), the pharmacy quotes, the patient pays into escrow, and the pharmacy dispenses **exactly once** → paid. Anyone can verify a prescription by ID. |
| **Records** | Patient can upload their own records and grant/revoke access to any provider. |

### Privacy model (no plaintext medical data on-chain)

- Each user has an **x25519 keypair generated in the browser**; only the public key is published on-chain (`set_encryption_key`).
- A record (note, referral letter, lab order, lab result, prescription, upload) is sealed with a random symmetric key (**XSalsa20-Poly1305**). That key is wrapped separately for each permitted reader with `nacl.box`.
- The off-chain store (`web/app/api/records`) only ever sees **ciphertext**. It hands a wrapped key to an account **only if the contract's `can_access` says that account is on the record's access list**.
- On-chain the contract stores just the record id, the **sha-256 of the ciphertext** and the viewer list, so anyone can check integrity and see who was given access, but not *what* the record says.
- Granting access is a contract call by the patient. The patient's browser then re-wraps the key for the new reader (automatically, even after a wallet redirect).

### Why NEAR, and not a normal database?

A hospital database works when everyone trusts the hospital. DocSpecialCare connects **independent** parties (a patient, a GP, a specialist, a lab and a pharmacy) who don't share a system and have reasons not to trust each other's records. The contract replaces that missing trust:

| Problem between independent parties | What the contract enforces |
|---|---|
| Patient pays upfront and the provider doesn't deliver | Fee is held by the contract; released on completion, refunded on cancellation or no-show (24 h) |
| Specialist referrals get lost or forged | Referral is a contract record: only a verified physician can issue it, only that patient can use it, once |
| Lab results get altered or go to the wrong person | sha-256 of the ciphertext is on-chain; the access list decides who gets a decryption key |
| Prescriptions are forged or filled at several pharmacies | Signed by a verified prescriber, expires, and `dispense_prescription` can succeed exactly once; any pharmacy can verify |
| No shared, neutral record of who did what | Every step is a public transaction with an `EVENT_JSON` log |

NEAR specifically: ~1 s finality and fees of a fraction of a cent make per-consultation payments practical; **named accounts and sub-accounts** (`gp.…`, `lab.…`) make roles readable; and **function-call access keys** keep the UX simple (below).

### Wallet UX: limited access keys

When a user signs in with a wallet, DocSpecialCare asks the wallet to add a **function-call access key** that can only call the contract's non-payable methods (`refer_to_specialist`, `order_lab_test`, `submit_lab_result`, `issue_prescription`, `dispense_prescription`, `grant_access`, …; see `LIMITED_KEY_METHODS` in `web/components/session.tsx`). Day-to-day clinical actions are then signed in the browser without a wallet pop-up, and the key **cannot move funds**. Anything with a deposit (`book_consultation`, `pay_lab_order`, `pay_prescription`) always goes to the wallet for explicit approval.

## Try it

### Option A: hosted demo (no install)

Open **https://docspecialcare.vercel.app/app** and click a **demo persona** (patient, physician, cardiologist, lab, pharmacy). Personas are pre-funded testnet accounts; the server signs for them so no wallet is needed, and every click is a real testnet transaction on [`care.docspecialcare-33f312.testnet`](https://testnet.nearblocks.io/address/care.docspecialcare-33f312.testnet). You can also connect your own testnet wallet (Meteor / MyNearWallet).

### Option B: reproduce everything from a fresh clone (≈ 3 min, Node 20 + Rust)

Verified on a clean clone. Each step says what you should see.

```bash
cd contract && cargo test          # see: "test result: ok. 12 passed"
cd ../web && npm ci
npm run setup:testnet              # see: "✓ Done. Contract: https://testnet.nearblocks.io/address/contract.docspecialcare-<random>.testnet"
npm run journey                    # see: 14 "✓" lines with NearBlocks links, then
                                   #      "✓ Second dispense rejected by the contract (no double filling)"
npm run dev                        # open http://localhost:3000/app, see 5 demo personas
```

- `setup:testnet` creates a free testnet account through the NEAR faucet, then a contract account and five persona accounts as NEAR **sub-accounts** of it; deploys the prebuilt `contract/res/docspecialcare.wasm`; registers and verifies the providers; and writes `web/.env.local` + `web/.demo-keys.json` (gitignored, testnet only).
- `journey` books → completes → refers → books specialist → orders test → pays lab → submits result → prescribes → assigns pharmacy → quotes → pays → dispenses, then shows a **second dispense is rejected**.
- Without `setup:testnet`, `npm run dev` still works: it reads the hosted demo contract and you can sign in with your own testnet wallet, but the demo personas are hidden (their keys aren't in the repo).

### Suggested walkthrough in the web app (≈ 5 min)

1. **Patient: Amaka** → *See a doctor online* → book Dr. Tunde Bello → *Open consultation* (chat / video).
2. **Dr. Tunde Bello** → *Clinical actions* → *Refer* to Dr. Ngozi Eze (Cardiology) → *Complete & get paid*.
3. **Patient** → *Specialist referrals* → *Book specialist*.
4. **Dr. Ngozi Eze** → *Clinical actions* → *Order test* at CityLab.
5. **Patient** → *Lab tests* → *Pay*.
6. **CityLab Diagnostics** → *Upload result* (attach any PDF/image under 3 MB).
7. **Dr. Ngozi Eze** → *Lab orders* → *Result* → see "✓ Integrity verified" (decrypted in the browser) → *Prescribe*.
8. **Patient** → *Prescriptions* → send to HealthPlus Pharmacy.
9. **HealthPlus Pharmacy** → *Send quote*; **Patient** → *Pay*; **Pharmacy** → *Dispense*. Then *Verify a prescription* with the Rx number → see "Dispensed".

### Contract tests

```bash
cd contract
cargo test           # 12 unit tests: full journey + abuse cases
```

Covered: full journey; specialist requires referral; referral not transferable; underpayment rejected; no double booking; unverified providers can't be booked; prescription dispensed only once; expired prescriptions rejected; cancellation/no-show refunds; patient can't cancel mid-consultation; only the assigned lab can submit; only the patient can grant access.

## Rebuild the contract from source

`setup:testnet` deploys the committed `contract/res/docspecialcare.wasm`. To build it yourself (requires [`cargo-near`](https://github.com/near/cargo-near)):

```bash
cd contract && cargo near build non-reproducible-wasm     # → target/near/docspecialcare.wasm
cd ../web && npm run setup:testnet                         # uses target/near/… when it exists
```

### Hosting

The web app deploys to Vercel as-is. Set the same variables as `web/.env.local` plus a **Vercel Blob** store (`BLOB_READ_WRITE_TOKEN`); records, wrapped keys and chat messages are then stored as private, write-once blobs (still ciphertext only). Without the token the app uses local files in `web/data/`.

## Repository layout

```
contract/            Rust smart contract
  src/lib.rs         care pathway, escrow, referrals, lab orders, prescriptions, record ACL
  src/tests.rs       unit tests
web/                 Next.js app
  app/page.tsx       landing page
  app/app/page.tsx   app shell: login, role detection, activity feed
  components/        patient / clinician / lab / pharmacy dashboards, booking, chat
  lib/crypto.ts      browser-side encryption (x25519 + secretbox), chat, private room names
  lib/records.ts     seal/upload, decrypt+verify, patient-side key re-sharing
  app/api/records    ciphertext store gated by on-chain can_access
  app/api/chat       encrypted consultation chat
  app/api/demo       testnet-only demo signer for personas
  scripts/           setup-testnet.mjs, demo-journey.mjs
```

## Contract API (summary)

| Method | Who | Notes |
|---|---|---|
| `register_provider(role, name, specialty, license_id, fee)` | provider | Physician / Specialist / Laboratory / Pharmacy |
| `verify_provider(account_id, verified)` | owner | license check |
| `set_encryption_key(public_key)` | anyone | x25519 public key, base64 |
| `book_consultation(provider_id, slot_start, referral_id?)` 💰 | patient | fee escrowed; specialists need a referral |
| `complete_consultation(id)` / `cancel_consultation(id)` | provider / both | release / refund |
| `refer_to_specialist(consultation_id, specialist_id, record_id, content_hash)` | consulting provider | |
| `order_lab_test(consultation_id, lab_id, record_id, content_hash)` | consulting provider | |
| `pay_lab_order(id)` 💰 → `submit_lab_result(id, record_id, content_hash)` | patient → lab | |
| `issue_prescription(consultation_id, record_id, details_hash, valid_days)` | consulting provider | |
| `assign_pharmacy` → `quote_prescription` → `pay_prescription` 💰 → `dispense_prescription` | patient / pharmacy | dispense once |
| `add_record`, `grant_access`, `revoke_access` | patient (or provider for consult notes) | |
| views: `list_providers`, `consultations_for`, `referrals_for`, `lab_orders_for`, `prescriptions_for`, `records_for`, `can_access`, `get_*`, `is_slot_booked` | anyone | |

All state changes emit `EVENT_JSON` logs (`standard: "docspecialcare"`).

## Limitations & roadmap (honest list)

- **Testnet prototype, not a medical device.** Not yet assessed against health-data law (e.g. Nigeria's NDPA, HIPAA).
- **Payments are in NEAR**, whose price moves. A clinic would want a stable unit: next step is USDC (NEP-141, `ft_transfer_call` into the same escrow).
- **Metadata is public.** Medical *content* is never on-chain, but the access lists and referrals show *which* accounts interacted (e.g. that a patient account was referred to a cardiologist account). Mitigation planned: a fresh pseudonymous sub-account per care episode, so on-chain records can't be linked to a person's main account.
- **Some trust is still centralised:** provider verification is a single admin key (next: a licensing-body oracle or a Sputnik DAO of verifiers); ciphertext is stored on Vercel Blob (next: IPFS/Filecoin, since the API only handles ciphertext); demo personas are signed by the demo server (testnet only; real users sign with their own wallet).
- Revoking access stops future key delivery, but can't un-share a record someone already decrypted (true of any end-to-end encrypted system).
- Chat sender identity isn't signature-checked yet (content is still encrypted). Files are limited to 3 MB by the hosting body limit.
- Demo personas use **publicly derivable** encryption keys by design; real users get random keys kept in their browser.
- Contract storage is paid by the contract account; next step is per-user storage deposits.
- Also next: meta-transactions so patients don't need NEAR for gas, NEAR AI Cloud (TEE) for private symptom triage before booking, insurer/HMO payouts.

## Hackathon notes

- Code written from scratch during the hackathon window (Oct 19 – Nov 14, 2026).
- Solo project. The author has no other submission.

MIT licensed.
