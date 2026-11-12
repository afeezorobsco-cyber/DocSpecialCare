# DocSpecialCare

**See a doctor online, get referred to a specialist, run lab tests and collect your prescription, without spending the day in a hospital queue.**
Every hand-off and every payment is enforced by a NEAR smart contract, and all medical data is end-to-end encrypted and controlled by the patient.

Built for the **NEAR Hackathon 2026** (tracks: *Real-World Money*, *Privacy & Private AI*, *Open Innovation*).

- Live contract (testnet): [`contract.docspecialcare-33f312.testnet`](https://testnet.nearblocks.io/address/contract.docspecialcare-33f312.testnet)
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

## Try it

### Option A: one command, full journey on testnet (no browser)

```bash
cd web
npm install
npm run journey      # needs web/.demo-keys.json, see "Deploy your own" below
```

It books → completes → refers → books specialist → orders test → pays lab → submits result → prescribes → assigns pharmacy → quotes → pays → dispenses, then shows a **second dispense is rejected**, printing a NearBlocks link for each transaction.

### Option B: the web app

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

Open **/app** and either connect a NEAR testnet wallet (Meteor / MyNearWallet) or click one of the **demo personas** (patient, physician, cardiologist, lab, pharmacy). Demo personas are pre-funded testnet accounts; the local server signs for them so you don't need a wallet, and every click is still a real testnet transaction.

Suggested walkthrough (≈5 min):
1. **Patient: Amaka** → *See a doctor online* → book Dr. Tunde Bello → *Open consultation* (chat / video).
2. **Dr. Tunde Bello** → *Clinical actions* → *Refer* to Dr. Ngozi Eze (Cardiology) → *Complete & get paid*.
3. **Patient** → *Specialist referrals* → *Book specialist*.
4. **Dr. Ngozi Eze** → *Clinical actions* → *Order test* at CityLab.
5. **Patient** → *Lab tests* → *Pay*.
6. **CityLab Diagnostics** → *Upload result* (attach any PDF/image).
7. **Dr. Ngozi Eze** → *Lab orders* → *Result* (decrypts in browser, shows "integrity verified") → *Prescribe*.
8. **Patient** → *Prescriptions* → send to HealthPlus Pharmacy.
9. **HealthPlus Pharmacy** → *Send quote*; **Patient** → *Pay*; **Pharmacy** → *Dispense*. Try *Verify a prescription* with the Rx number.

### Contract tests

```bash
cd contract
cargo test           # 12 unit tests: full journey + abuse cases
```

Covered: full journey; specialist requires referral; referral not transferable; underpayment rejected; no double booking; unverified providers can't be booked; prescription dispensed only once; expired prescriptions rejected; cancellation/no-show refunds; patient can't cancel mid-consultation; only the assigned lab can submit; only the patient can grant access.

## Deploy your own (testnet)

Requires Rust + [`cargo-near`](https://github.com/near/cargo-near) and Node 20.

```bash
cd contract && cargo near build non-reproducible-wasm     # → target/near/docspecialcare.wasm
cd ../web && npm install && npm run setup:testnet
```

`setup:testnet` creates a faucet-funded master account and, as NEAR **sub-accounts** of it, the contract plus five demo personas. It then deploys and initialises the contract, registers and verifies the providers, publishes demo encryption keys and writes `web/.env.local`. Re-running it is safe.

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

- **Testnet prototype, not a medical device.** Provider verification is a single admin key; production needs a licensing-body oracle or DAO.
- Off-chain ciphertext store is a local file store for the hackathon; swap for IPFS/S3 (the API already only handles ciphertext).
- Revoking access stops future key delivery, but can't un-share a record someone already decrypted (true of any E2E system).
- Chat sender identity isn't signature-checked yet (content is still encrypted).
- Demo personas use **publicly derivable** encryption keys by design; real users get random keys stored in their browser.
- Contract storage is paid by the contract account; next step is per-user storage deposits.
- Next: stablecoin (USDC) payments via NEP-141, meta-transactions so patients don't need NEAR for gas, NEAR AI Cloud (TEE) for private symptom triage before booking, insurer/HMO payouts.

## Hackathon notes

- Code written from scratch during the hackathon window (Oct 19 – Nov 14, 2026).
- Solo project. The author has no other submission.

MIT licensed.
