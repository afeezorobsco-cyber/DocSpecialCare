"use client";
import { useEffect, useState } from "react";
import { useSession } from "./session";
import { useLoad, RecordButton, ConsultRoom } from "./shared";
import { BookModal } from "./booking";
import { Badge, Btn, Card, Empty, Field, Modal, inputCls, when } from "./ui";
import { view, fmtNear } from "@/lib/near";
import { createRecord, syncShares } from "@/lib/records";
import { fileToB64 } from "@/lib/crypto";
import type { ChainRecord, Consultation, LabOrder, Prescription, Provider, Referral } from "@/lib/types";

const KIND_LABEL: Record<string, string> = {
  ConsultNote: "Consultation note",
  ReferralLetter: "Referral letter",
  LabOrder: "Lab test order",
  LabResult: "Lab result",
  Prescription: "Prescription",
  PatientUpload: "My upload",
};

export function PatientDashboard({ providers }: { providers: Provider[] }) {
  const { account, kp } = useSession();
  const byId = Object.fromEntries(providers.map((p) => [p.account_id, p]));
  const name = (id: string) => byId[id]?.name || id;

  const consults = useLoad(() => view<Consultation[]>("consultations_for", { account_id: account }), [account]);
  const referrals = useLoad(() => view<Referral[]>("referrals_for", { account_id: account }), [account]);
  const labs = useLoad(() => view<LabOrder[]>("lab_orders_for", { account_id: account }), [account]);
  const rxs = useLoad(() => view<Prescription[]>("prescriptions_for", { account_id: account }), [account]);
  const records = useLoad(() => view<ChainRecord[]>("records_for", { account_id: account }), [account]);
  const reloadAll = () => Promise.all([consults.reload(), referrals.reload(), labs.reload(), rxs.reload(), records.reload()]);

  // share decryption keys with anyone the patient has granted on-chain
  const sync = async () => {
    if (account && kp) await syncShares(account, kp).catch(() => 0);
  };
  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, kp, records.data?.length]);

  const [booking, setBooking] = useState<{ p: Provider; referral?: number } | null>(null);
  const [room, setRoom] = useState<Consultation | null>(null);
  const physicians = providers.filter((p) => p.role === "Physician");
  const pharmacies = providers.filter((p) => p.role === "Pharmacy");

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="1 · See a doctor online">
        <p className="mb-3 text-sm text-slate-600">Pick a general physician and a time slot. No queue: you join the video call at your slot.</p>
        <div className="space-y-2">
          {physicians.length === 0 && <Empty>No verified physicians yet.</Empty>}
          {physicians.map((p) => (
            <div key={p.account_id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
              <div>
                <p className="font-medium text-slate-900">{p.name}</p>
                <p className="text-xs text-slate-500">
                  {p.specialty} · {fmtNear(p.fee)} NEAR
                </p>
              </div>
              <Btn onClick={() => setBooking({ p })}>Book</Btn>
            </div>
          ))}
        </div>
      </Card>

      <Card title="2 · Specialist referrals">
        {!referrals.data?.length && <Empty>When a doctor refers you to a specialist, the referral appears here.</Empty>}
        <div className="space-y-2">
          {referrals.data?.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm">
                  <b>{name(r.from_provider)}</b> → <b>{name(r.to_specialist)}</b>
                  <span className="text-slate-500"> ({byId[r.to_specialist]?.specialty})</span>
                </p>
                {r.used_by_consultation ? <Badge status="Booked" /> : <Badge status="Issued" />}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <RecordButton id={r.note_record_id} label="Referral letter" />
                {!r.used_by_consultation && byId[r.to_specialist] && (
                  <Btn onClick={() => setBooking({ p: byId[r.to_specialist], referral: r.id })}>
                    Book specialist ({fmtNear(byId[r.to_specialist].fee)} NEAR)
                  </Btn>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="My consultations" action={<Btn variant="ghost" onClick={reloadAll}>Refresh</Btn>}>
        {!consults.data?.length && <Empty>No consultations yet.</Empty>}
        <div className="space-y-2">
          {consults.data?.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    #{c.id} · {name(c.provider)} <span className="font-normal text-slate-500">({c.provider_role})</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {when(c.slot_start)} · {fmtNear(c.fee)} NEAR {c.status === "Booked" ? "in escrow" : c.status === "Completed" ? "paid" : "refunded"}
                  </p>
                </div>
                <Badge status={c.status} />
              </div>
              {c.status === "Booked" && (
                <div className="mt-2 flex gap-2">
                  <Btn onClick={() => setRoom(c)}>Open consultation</Btn>
                  <CancelBtn c={c} onDone={reloadAll} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="3 · Lab tests">
        {!labs.data?.length && <Empty>Tests your doctor orders appear here.</Empty>}
        <div className="space-y-2">
          {labs.data?.map((o) => (
            <LabRow key={o.id} o={o} name={name} onDone={reloadAll} providers={providers} />
          ))}
        </div>
      </Card>

      <Card title="4 · Prescriptions">
        {!rxs.data?.length && <Empty>Prescriptions from your doctor appear here.</Empty>}
        <div className="space-y-2">
          {rxs.data?.map((rx) => (
            <RxRow key={rx.id} rx={rx} name={name} pharmacies={pharmacies} onDone={async () => { await reloadAll(); await sync(); }} />
          ))}
        </div>
      </Card>

      <Card title="My health records" action={<UploadBtn onDone={reloadAll} />}>
        <p className="mb-3 text-xs text-slate-500">
          Encrypted in your browser. NEAR stores only a fingerprint (sha-256) and who may open each record. You decide who sees what.
        </p>
        {!records.data?.length && <Empty>No records yet.</Empty>}
        <div className="space-y-2">
          {records.data
            ?.filter((r) => r.patient === account)
            .map((r) => (
              <RecordRow key={r.id} r={r} name={name} providers={providers} onDone={async () => { await records.reload(); await sync(); }} />
            ))}
        </div>
      </Card>

      {booking && (
        <BookModal
          open
          provider={booking.p}
          referralId={booking.referral}
          onClose={() => setBooking(null)}
          onBooked={reloadAll}
        />
      )}
      {room && <ConsultRoom c={room} open onClose={() => setRoom(null)} />}
    </div>
  );
}

function CancelBtn({ c, onDone }: { c: Consultation; onDone: () => void }) {
  const { call } = useSession();
  const now = Date.now();
  if (now >= c.slot_start && now < c.slot_start + 24 * 3600_000) return null;
  return (
    <Btn
      variant="danger"
      onClick={async () => {
        if (!confirm("Cancel and get your fee refunded?")) return;
        await call(`Cancelled consultation #${c.id}`, "cancel_consultation", { consultation_id: c.id });
        onDone();
      }}
    >
      {now < c.slot_start ? "Cancel & refund" : "Doctor no-show: refund"}
    </Btn>
  );
}

function LabRow({ o, name, onDone, providers }: { o: LabOrder; name: (s: string) => string; onDone: () => void; providers: Provider[] }) {
  const { call } = useSession();
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm">
          <b>{name(o.lab)}</b> <span className="text-slate-500">ordered by {name(o.ordered_by)}</span>
        </p>
        <Badge status={o.status} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <RecordButton id={o.order_record_id} label="Tests" />
        {o.status === "AwaitingPayment" && (
          <Btn onClick={async () => { await call(`Paid lab order #${o.id}`, "pay_lab_order", { lab_order_id: o.id }, o.fee); onDone(); }}>
            Pay {fmtNear(o.fee)} NEAR
          </Btn>
        )}
        {o.result_record_id && (
          <>
            <RecordButton id={o.result_record_id} label="Result" />
            <ShareBtn recordId={o.result_record_id} providers={providers} onDone={onDone} />
          </>
        )}
      </div>
      {o.status === "Paid" && <p className="mt-2 text-xs text-slate-500">Paid into escrow. Visit the lab; the lab is paid when it uploads your result.</p>}
    </div>
  );
}

function RxRow({ rx, name, pharmacies, onDone }: { rx: Prescription; name: (s: string) => string; pharmacies: Provider[]; onDone: () => void }) {
  const { call } = useSession();
  const [ph, setPh] = useState("");
  const expired = Date.now() > rx.expires_at;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm">
          Rx #{rx.id} from <b>{name(rx.prescriber)}</b>
          <span className="block text-xs text-slate-500">valid until {when(rx.expires_at)}{rx.pharmacy && ` · pharmacy: ${name(rx.pharmacy)}`}</span>
        </p>
        <Badge status={expired && rx.status !== "Dispensed" ? "Expired" : rx.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <RecordButton id={rx.record_id} label="Prescription" />
        {(rx.status === "Issued" || rx.status === "Quoted") && !expired && (
          <>
            <select className={`${inputCls} w-auto`} value={ph} onChange={(e) => setPh(e.target.value)}>
              <option value="">{rx.pharmacy ? "Change pharmacy…" : "Choose pharmacy…"}</option>
              {pharmacies.map((p) => (
                <option key={p.account_id} value={p.account_id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Btn
              disabled={!ph}
              onClick={async () => {
                await call(`Sent Rx #${rx.id} to ${name(ph)}`, "assign_pharmacy", { prescription_id: rx.id, pharmacy_id: ph });
                setPh("");
                onDone();
              }}
            >
              Send to pharmacy
            </Btn>
          </>
        )}
        {rx.status === "Quoted" && rx.price && !expired && (
          <Btn onClick={async () => { await call(`Paid Rx #${rx.id}`, "pay_prescription", { prescription_id: rx.id }, rx.price!); onDone(); }}>
            Pay {fmtNear(rx.price)} NEAR
          </Btn>
        )}
      </div>
      {rx.status === "Paid" && <p className="mt-2 text-xs text-slate-500">Paid into escrow. Collect your medication; the pharmacy is paid on dispensing.</p>}
    </div>
  );
}

function ShareBtn({ recordId, providers, onDone }: { recordId: string; providers: Provider[]; onDone: () => void }) {
  const { call } = useSession();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Share
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Share this record">
        <p className="mb-3 text-sm text-slate-600">
          The contract adds them to the record&apos;s access list, then your browser re-encrypts the key for them. Nobody else, including us, can read it.
        </p>
        <Field label="Share with">
          <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a provider…</option>
            {providers.map((p) => (
              <option key={p.account_id} value={p.account_id}>
                {p.name} ({p.role})
              </option>
            ))}
          </select>
        </Field>
        <div className="mt-4">
          <Btn
            disabled={!to}
            onClick={async () => {
              await call(`Shared record with ${to}`, "grant_access", { record_id: recordId, account_id: to });
              setOpen(false);
              onDone();
            }}
          >
            Grant access
          </Btn>
        </div>
      </Modal>
    </>
  );
}

function RecordRow({ r, name, providers, onDone }: { r: ChainRecord; name: (s: string) => string; providers: Provider[]; onDone: () => void }) {
  const { account, call } = useSession();
  const others = r.viewers.filter((v) => v !== account);
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900">{KIND_LABEL[r.kind]}</p>
        <span className="text-xs text-slate-500">{when(r.created_at)}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Can open: {others.length ? others.map((o) => (
          <span key={o} className="mr-2 inline-flex items-center gap-1">
            {name(o)}
            <button
              title="Revoke"
              className="text-rose-600 hover:underline"
              onClick={async () => {
                if (!confirm(`Revoke ${name(o)}'s access?`)) return;
                await call(`Revoked ${o}`, "revoke_access", { record_id: r.id, account_id: o }).catch((e) => alert(e.message));
                onDone();
              }}
            >
              ×
            </button>
          </span>
        )) : "only you"}
      </p>
      <div className="mt-2 flex gap-2">
        <RecordButton id={r.id} />
        <ShareBtn recordId={r.id} providers={providers} onDone={onDone} />
      </div>
    </div>
  );
}

function UploadBtn({ onDone }: { onDone: () => void }) {
  const { account, call } = useSession();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        + Upload
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload a health record">
        <div className="space-y-3">
          <Field label="Title">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Previous blood test, allergy list" />
          </Field>
          <Field label="Notes">
            <textarea className={inputCls} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label="File (optional, max 3 MB)">
            <input type="file" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          <Btn
            disabled={!title}
            onClick={async () => {
              const attachment = file ? { name: file.name, mime: file.type || "application/octet-stream", dataB64: await fileToB64(file) } : undefined;
              const { id, hash } = await createRecord("up", { title, text, attachment }, [account!]);
              await call("Uploaded health record", "add_record", { record_id: id, patient: account, kind: "PatientUpload", content_hash: hash, consultation_id: null });
              setOpen(false);
              setTitle("");
              setText("");
              setFile(null);
              onDone();
            }}
          >
            Encrypt & save
          </Btn>
        </div>
      </Modal>
    </>
  );
}

