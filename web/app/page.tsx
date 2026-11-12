import Link from "next/link";

const steps = [
  { n: "1", t: "Book a physician", d: "Pick a slot and pay into escrow. No waiting room: join the video call at your time." },
  { n: "2", t: "Get referred", d: "Your physician issues an on-chain referral. Only you can use it to book the specialist." },
  { n: "3", t: "Run lab tests", d: "Pay the lab into escrow. The lab is paid when it uploads your encrypted result." },
  { n: "4", t: "Specialist review", d: "The specialist decrypts the result in their browser, then prescribes." },
  { n: "5", t: "Collect medication", d: "Send the prescription to a pharmacy. It can be dispensed exactly once." },
];

const why = [
  ["Payment after care", "Fees sit in a NEAR smart contract and release only when the consultation is completed, the result delivered, or the medication dispensed. No-shows are refunded."],
  ["Records you control", "Notes, results and prescriptions are encrypted in the browser. NEAR stores only a fingerprint and the list of who may open each one. Grant or revoke access any time."],
  ["Prescriptions that can't be forged", "Every prescription is signed on-chain by a verified prescriber, expires automatically, and can't be filled twice."],
  ["No more queues", "Time-slot booking replaces hours in a hospital corridor. Double-booking is impossible."],
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-white">✚</span>
          DocSpecialCare
        </div>
        <Link href="/app" className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
          Open app
        </Link>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-20">
        <p className="mb-4 inline-block rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 ring-1 ring-teal-200">Built on NEAR</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          See a doctor, then a specialist, then the pharmacy, without spending the day in a queue.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          DocSpecialCare connects patients, physicians, specialists, laboratories and pharmacies in one care pathway.
          Every hand-off and payment is enforced by a NEAR smart contract, and your medical data stays encrypted and under your control.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/app" className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800">Try the demo</Link>
          <a href="https://github.com/afeezorobsco-cyber/DocSpecialCare" className="rounded-lg px-5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">View source</a>
        </div>
      </section>

      <section className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-xl font-semibold text-slate-900">One patient journey, end to end</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((s) => (
              <li key={s.n} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-teal-700 text-sm font-semibold text-white">{s.n}</span>
                <p className="mt-3 font-medium text-slate-900">{s.t}</p>
                <p className="mt-1 text-sm text-slate-600">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-2">
        {why.map(([t, d]) => (
          <div key={t}>
            <h3 className="font-semibold text-slate-900">{t}</h3>
            <p className="mt-1 text-sm text-slate-600">{d}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-slate-100 py-8 text-center text-xs text-slate-500">
        DocSpecialCare · NEAR Hackathon 2026 · testnet prototype, not for real medical use yet
      </footer>
    </div>
  );
}
