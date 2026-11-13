"use client";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/session";
import { useLoad } from "@/components/shared";
import { PatientDashboard } from "@/components/patient";
import { ClinicianDashboard } from "@/components/clinician";
import { LabDashboard, PharmacyDashboard, RegisterProvider } from "@/components/partners";
import { Acc, Btn, Card, Modal, TxLink } from "@/components/ui";
import { view } from "@/lib/near";
import { pubB64 } from "@/lib/crypto";
import { CONTRACT_ID, DEMO_PERSONAS, NETWORK, accountLink } from "@/lib/config";
import type { Provider } from "@/lib/types";

export default function AppPage() {
  const s = useSession();
  if (!s.ready) return <Shell><p className="py-20 text-center text-slate-500">Loading…</p></Shell>;
  if (!s.account) return <Shell><Login /></Shell>;
  return <Shell><Dashboard /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { account, signOut } = useSession();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-white">✚</span>
            DocSpecialCare
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200 sm:inline">{NETWORK}</span>
            {account && <span className="hidden max-w-[200px] truncate font-mono text-xs text-slate-600 sm:inline">{account}</span>}
            {account && <Btn variant="ghost" onClick={signOut}>Sign out</Btn>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

function Login() {
  const { connectWallet, startDemo } = useSession();
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Sign in to DocSpecialCare</h1>
        <p className="mt-2 text-sm text-slate-600">Patients, doctors, labs and pharmacies all use the same NEAR account login.</p>
      </div>
      <Card>
        <div className="flex flex-col items-center gap-3 py-2">
          <Btn onClick={connectWallet}>Connect NEAR wallet</Btn>
          <p className="text-xs text-slate-500">Meteor Wallet or MyNearWallet ({NETWORK}). New here? Create a free testnet account in the wallet.</p>
          <p className="max-w-md text-center text-xs text-slate-500">
            Signing in adds a <b>limited NEAR access key</b> that can only perform everyday clinical actions on DocSpecialCare and can&apos;t move funds,
            so those are one click. Every payment still asks for your wallet&apos;s approval.
          </p>
        </div>
      </Card>
      {DEMO_PERSONAS.length > 0 && (
        <Card title="Or try the demo as…">
          <p className="mb-3 text-sm text-slate-600">
            Pre-funded testnet personas. Every action is a real transaction on NEAR {NETWORK}; the demo server signs for you so you don&apos;t need a wallet.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {DEMO_PERSONAS.map((p) => (
              <button key={p.account} onClick={() => startDemo(p.account)} className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-teal-600 hover:bg-teal-50">
                <p className="font-medium text-slate-900">{p.label}</p>
                <p className="text-xs text-slate-500">{p.blurb}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">{p.account}</p>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Dashboard() {
  const { account, kp, call, activity, mode } = useSession();
  const me = useLoad(() => view<Provider | null>("get_provider", { account_id: account }), [account]);
  const providers = useLoad(() => view<Provider[]>("list_providers", { role: null, verified_only: true, from_index: 0, limit: 100 }), [account]);
  const key = useLoad(() => view<string | null>("get_encryption_key", { account_id: account }), [account]);
  const [reg, setReg] = useState(false);

  if (me.error || providers.error) {
    return (
      <Card title="Can't reach the contract">
        <p className="text-sm text-rose-700">{me.error || providers.error}</p>
        <p className="mt-2 text-sm text-slate-600">Contract: <span className="font-mono">{CONTRACT_ID}</span>. Check NEXT_PUBLIC_CONTRACT_ID in web/.env.local.</p>
      </Card>
    );
  }
  if (providers.data === null || key.data === undefined) return <p className="py-20 text-center text-slate-500">Loading from NEAR…</p>;

  const myPub = kp ? pubB64(kp) : null;
  const keyOk = !!myPub && key.data === myPub;
  const p = me.data;
  const role = p?.verified ? p.role : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{p?.name || "My care"} <span className="text-base font-normal text-slate-500">· {role || "Patient"}</span></h1>
          <p className="text-xs text-slate-500">
            <Acc id={account!} /> · contract <a className="font-mono text-teal-700 hover:underline" href={accountLink(CONTRACT_ID)} target="_blank" rel="noreferrer">{CONTRACT_ID}</a>
          </p>
        </div>
        {!role && <Btn variant="ghost" onClick={() => setReg(true)}>{p ? "Edit provider profile" : "I'm a healthcare provider"}</Btn>}
      </div>

      {p && !p.verified && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Your {p.role.toLowerCase()} profile is waiting for license verification. Until then you can use DocSpecialCare as a patient.
        </p>
      )}

      {!keyOk && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-teal-50 px-4 py-3 ring-1 ring-teal-200">
          <p className="text-sm text-teal-900">
            <b>Activate secure records.</b> Publishes your public encryption key on NEAR so doctors, labs and pharmacies can share encrypted records with you.
            {key.data && " (This browser has a different key than the one on-chain.)"}
          </p>
          <Btn onClick={async () => { await call("Activated secure records", "set_encryption_key", { public_key: myPub }); key.reload(); }}>Activate</Btn>
        </div>
      )}

      {role === "Physician" || role === "Specialist" ? (
        <ClinicianDashboard me={p!} providers={providers.data} />
      ) : role === "Laboratory" ? (
        <LabDashboard me={p!} providers={providers.data} />
      ) : role === "Pharmacy" ? (
        <PharmacyDashboard providers={providers.data} />
      ) : (
        <PatientDashboard providers={providers.data} />
      )}

      {activity.length > 0 && (
        <Card title="On-chain activity (this session)">
          <ul className="space-y-1 text-sm">
            {activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className={a.error ? "text-rose-700" : "text-slate-700"}>{a.error ? `✕ ${a.label}: ${a.error}` : `✓ ${a.label}`}</span>
                <TxLink hash={a.txHash} />
              </li>
            ))}
          </ul>
          {mode === "wallet" && <p className="mt-2 text-xs text-slate-400">Redirect-based wallets may not report transaction hashes.</p>}
        </Card>
      )}

      <Modal open={reg} onClose={() => setReg(false)} title="Provider profile">
        <RegisterProvider existing={p} onDone={() => { setReg(false); me.reload(); }} />
      </Modal>
    </div>
  );
}
