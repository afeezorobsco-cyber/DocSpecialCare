# DocSpecialCare demo video script (≈ 2 minutes)

**Setup before recording**
- Use the hosted site https://docspecialcare.vercel.app/app. Browser at ~110% zoom, close other tabs.
- Screen recorder: macOS `Cmd + Shift + 5` → "Record Entire Screen" (or a window). Record the voice-over live or add it after.
- Open a second tab with the contract on NearBlocks: https://testnet.nearblocks.io/address/care.docspecialcare-33f312.testnet
- Have a small image or PDF on your desktop to use as the "lab report" (e.g. a photo of any printed lab result, under 3 MB).
- To switch persona: **Sign out** (top right) → pick the next demo persona.
- Each action takes ~3–6 s to confirm on NEAR. Keep talking, or cut the waits in editing.

---

| # | Time | On screen | Say (voice-over) |
|---|---|---|---|
| 1 | 0:00–0:10 | Landing page, slow scroll over the 5 steps. | "In many hospitals you queue for hours to see a doctor, then queue again for the specialist, the lab and the pharmacy. DocSpecialCare puts that whole journey online, on NEAR." |
| 2 | 0:10–0:25 | Click **Try the demo** → **Patient: Amaka** → **Book** on Dr. Tunde Bello → pick tomorrow + a time → **Pay 0.1 NEAR & book**. | "Amaka books a general physician for a time slot. No waiting room. Her fee goes into escrow in the smart contract; the doctor only gets paid when the consultation is done, and she's refunded if he doesn't show." |
| 3 | 0:25–0:35 | **Open consultation** → type "I get chest pains when climbing stairs" → **Send**. Point at **Join private video call**. | "Chat is end-to-end encrypted, and the video room name can only be derived by the two of them." |
| 4 | 0:35–0:50 | Sign out → **Dr. Tunde Bello** → **Clinical actions** → **Refer** → pick Dr. Ngozi Eze (Cardiology), type a short letter → **Send referral** → **Complete** tab → **Complete & get paid**. | "The physician refers her to a cardiologist. That referral lives on-chain: specialists can't be booked without one, and only Amaka can use it. Completing the visit releases his fee." |
| 5 | 0:50–1:00 | Sign out → **Patient** → **Specialist referrals** → **Book specialist** → pick a slot → pay. | "Amaka books the specialist with her referral." |
| 6 | 1:00–1:10 | Sign out → **Dr. Ngozi Eze** → **Clinical actions** → **Order test** → CityLab → **Order test**. Sign out → **Patient** → **Lab tests** → **Pay 0.15 NEAR**. | "The cardiologist orders blood tests. Amaka pays the lab into escrow." |
| 7 | 1:10–1:22 | Sign out → **CityLab Diagnostics** → **Upload result** → type a value line, attach your image/PDF → **Encrypt & submit**. | "The lab uploads the result. It's encrypted in the browser before it leaves the lab; NEAR only stores its fingerprint and who may open it. The lab gets paid." |
| 8 | 1:22–1:35 | Sign out → **Dr. Ngozi Eze** → **Lab orders you placed** → **🔒 Result** → show the green **Integrity verified** banner → close → **Clinical actions** → **Prescribe** → Atorvastatin, 20mg, once nightly, 30 → **Sign & issue prescription**. | "The specialist decrypts it, and can prove it wasn't altered since the lab signed it. Then she prescribes." |
| 9 | 1:35–1:45 | Sign out → **Patient** → **Prescriptions** → choose HealthPlus Pharmacy → **Send to pharmacy**. | "Amaka chooses where to collect it. Only that pharmacy can now read the prescription." |
| 10 | 1:45–1:58 | Sign out → **HealthPlus Pharmacy** → **🔒 View** (show medication) → price `0.05` → **Send quote**. Sign out → **Patient** → **Pay 0.05 NEAR**. Sign out → **Pharmacy** → **Dispense & receive**. | "The pharmacy quotes, she pays into escrow, and it's dispensed: exactly once." |
| 11 | 1:58–2:08 | In **Verify a prescription**, type `1` → **Check** → shows **Dispensed**. Then switch to the NearBlocks tab and scroll the transactions. | "Anyone can verify a prescription is real and already filled, so no forged or double-filled prescriptions. Every step you saw is a real NEAR transaction." |
| 12 | 2:08–2:15 | Back to landing page. | "DocSpecialCare. Care without the queue, built on NEAR." |

**Shorter cut (≈ 60 s):** keep steps 1, 2, 4, 7, 8, 10, 11 and cut the waits.

---

## Draft X post (you post it yourself)

> Built at NEAR HACKATHON: **DocSpecialCare** 🩺
>
> See a doctor online, get referred to a specialist, run lab tests and collect your prescription, without spending the day in a hospital queue.
>
> • Fees held in escrow until care is delivered
> • On-chain referrals & prescriptions that can't be forged or filled twice
> • Lab results end-to-end encrypted, patient controls access
>
> Try it: https://docspecialcare.vercel.app
> Code: https://github.com/afeezorobsco-cyber/DocSpecialCare
>
> Doctors & pharmacists: what would stop your clinic using this tomorrow?
>
> @NEARProtocol @NearBuilders @NearLegion #NEARHackathon

Attach the video. Then send the post link back so it can go in the submission form.
