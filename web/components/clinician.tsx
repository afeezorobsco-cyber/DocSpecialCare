"use client";
import { useState } from "react";
import { useSession } from "./session";
import { useLoad, RecordButton, ConsultRoom } from "./shared";
import { Acc, Badge, Btn, Card, Empty, Field, Modal, inputCls, when } from "./ui";
import { view, fmtNear } from "@/lib/near";
import { createRecord } from "@/lib/records";
import type { Consultation, LabOrder, Prescription, Provider, Referral } from "@/lib/types";

type Med = { name: string; dose: string; frequency: string; days: string };

/** Dashboard for physicians and specialists. */
export function ClinicianDashboard({ me, providers }: { me: Provider; providers: Provider[] }) {
  const { account } = useSession();
  const byId = Object.fromEntries(providers.map((p) => [p.account_id, p]));
  const name = (id: string) => byId[id]?.name || id;
  const consults = useLoad(() => view<Consultation[]>("consultations_for", { account_id: account }), [account]);
  const labs = useLoad(() => view<LabOrder[]>("lab_orders_for", { account_id: account }), [account]);
  const refs = useLoad(() => view<Referral[]>("referrals_for", { account_id: account }), [account]);
  const rxs = useLoad(() => view<Prescription[]>("prescriptions_for", { account_id: account }), [account]);
  const reloadAll = () => Promise.all([consults.reload(), labs.reload(), refs.reload(), rxs.reload()]);
  const [room, setRoom] = useState<Consultation | null>(null);
  const [act, setAct] = useState<Consultation | null>(null);

  const open = consults.data?.filter((c) => c.status === "Booked") || [];
  const past = consults.data?.filter((c) => c.status !== "Booked") || [];
  const earned = past.filter((c) => c.status === "Completed").reduce((s, c) => s + BigInt(c.fee), BigInt(0));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={`Upcoming patients (${open.length})`} action={<Btn variant="ghost" onClick={reloadAll}>Refresh</Btn>}>
        {!open.length && <Empty>No booked consultations. Patients book your free slots and pay into escrow.</Empty>}
        <div className="space-y-2">
          {open.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">#{c.id} · <Acc id={c.patient} /></p>
                  <p className="text-xs text-slate-500">
                    {when(c.slot_start)} · {fmtNear(c.fee)} NEAR in escrow{c.referral_id ? ` · referral #${c.referral_id}` : ""}
                  </p>
                </div>
                <Badge status={c.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn onClick={() => setRoom(c)}>Open consultation</Btn>
                <Btn variant="ghost" onClick={() => setAct(c)}>Clinical actions</Btn>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Lab orders you placed">
        {!labs.data?.length && <Empty>No lab orders yet.</Empty>}
        <div className="space-y-2">
          {labs.data?.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <p className="text-sm">
                #{o.id} · {name(o.lab)} · <Acc id={o.patient} />
              </p>
              <div className="flex items-center gap-2">
                <Badge status={o.status} />
                {o.result_record_id && <RecordButton id={o.result_record_id} label="Result" />}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Referrals">
        {!refs.data?.length && <Empty>No referrals yet.</Empty>}
        <div className="space-y-2">
          {refs.data?.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <p className="text-sm">
                {r.from_provider === account ? <>To <b>{name(r.to_specialist)}</b></> : <>From <b>{name(r.from_provider)}</b></>} · <Acc id={r.patient} />
              </p>
              <div className="flex items-center gap-2">
                {r.used_by_consultation ? <Badge status="Booked" /> : <Badge status="Issued" />}
                <RecordButton id={r.note_record_id} label="Letter" />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Prescriptions issued">
        {!rxs.data?.length && <Empty>No prescriptions yet.</Empty>}
        <div className="space-y-2">
          {rxs.data?.map((rx) => (
            <div key={rx.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <p className="text-sm">
                Rx #{rx.id} · <Acc id={rx.patient} />
              </p>
              <div className="flex items-center gap-2">
                <Badge status={rx.status} />
                <RecordButton id={rx.record_id} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Completed">
        <p className="mb-3 text-sm text-slate-600">
          Earned via escrow: <b>{fmtNear(earned.toString())} NEAR</b> across {past.filter((c) => c.status === "Completed").length} consultations.
        </p>
        <div className="space-y-1">
          {past.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span>#{c.id} · <Acc id={c.patient} /> · {when(c.slot_start)}</span>
              <span className="flex items-center gap-2">
                {c.status === "Completed" && (
                  <button className="text-xs text-teal-700 hover:underline" onClick={() => setAct(c)}>Follow-up</button>
                )}
                <Badge status={c.status} />
              </span>
            </div>
          ))}
        </div>
      </Card>

      {room && <ConsultRoom c={room} open onClose={() => setRoom(null)} />}
      {act && <ActionsModal c={act} me={me} providers={providers} onClose={() => setAct(null)} onDone={reloadAll} />}
    </div>
  );
}

function ActionsModal({ c, me, providers, onClose, onDone }: { c: Consultation; me: Provider; providers: Provider[]; onClose: () => void; onDone: () => void }) {
  const { account, call } = useSession();
  const [tab, setTab] = useState<"note" | "refer" | "lab" | "rx" | "close">("note");
  const specialists = providers.filter((p) => p.role === "Specialist" && p.account_id !== account);
  const labs = providers.filter((p) => p.role === "Laboratory");
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [tests, setTests] = useState("Full blood count\nLipid profile");
  const [meds, setMeds] = useState<Med[]>([{ name: "", dose: "", frequency: "", days: "" }]);
  const [days, setDays] = useState(30);
  const done = () => {
    onDone();
    onClose();
  };

  const tabs = [
    ["note", "Note"],
    ["refer", "Refer"],
    ["lab", "Order test"],
    ["rx", "Prescribe"],
    ["close", "Complete"],
  ] as const;

  return (
    <Modal open onClose={onClose} title={`Consultation #${c.id} · ${c.patient}`}>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); setTarget(""); }} className={`shrink-0 rounded-md px-3 py-1 text-sm ${tab === k ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "note" && (
        <div className="space-y-3">
          <Field label="Consultation note (encrypted, visible to you and the patient)">
            <textarea className={inputCls} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Presenting complaint, findings, plan…" />
          </Field>
          <Btn disabled={!text} onClick={async () => {
            const { id, hash } = await createRecord("note", { title: `Consultation note · ${me.name}`, text }, [c.patient, account!]);
            await call(`Saved note for #${c.id}`, "add_record", { record_id: id, patient: c.patient, kind: "ConsultNote", content_hash: hash, consultation_id: c.id });
            setText("");
            done();
          }}>Encrypt & save note</Btn>
        </div>
      )}

      {tab === "refer" && (
        <div className="space-y-3">
          <Field label="Specialist">
            <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a verified specialist…</option>
              {specialists.map((s) => <option key={s.account_id} value={s.account_id}>{s.name} · {s.specialty} · {fmtNear(s.fee)} NEAR</option>)}
            </select>
          </Field>
          <Field label="Referral letter (encrypted for patient + specialist)">
            <textarea className={inputCls} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason for referral, history, current medication…" />
          </Field>
          <Btn disabled={!target || !text} onClick={async () => {
            const { id, hash } = await createRecord("ref", { title: `Referral from ${me.name}`, text }, [c.patient, account!, target]);
            await call(`Referred #${c.id} to ${target}`, "refer_to_specialist", { consultation_id: c.id, specialist_id: target, record_id: id, content_hash: hash });
            done();
          }}>Send referral</Btn>
        </div>
      )}

      {tab === "lab" && (
        <div className="space-y-3">
          <Field label="Laboratory">
            <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a verified lab…</option>
              {labs.map((s) => <option key={s.account_id} value={s.account_id}>{s.name} · {fmtNear(s.fee)} NEAR</option>)}
            </select>
          </Field>
          <Field label="Tests (one per line, encrypted for patient + lab)">
            <textarea className={inputCls} rows={4} value={tests} onChange={(e) => setTests(e.target.value)} />
          </Field>
          <Btn disabled={!target || !tests.trim()} onClick={async () => {
            const list = tests.split("\n").map((t) => t.trim()).filter(Boolean);
            const { id, hash } = await createRecord("lab", { title: `Lab request from ${me.name}`, tests: list, text }, [c.patient, account!, target]);
            await call(`Ordered tests for #${c.id}`, "order_lab_test", { consultation_id: c.id, lab_id: target, record_id: id, content_hash: hash });
            done();
          }}>Order test</Btn>
        </div>
      )}

      {tab === "rx" && (
        <div className="space-y-3">
          {meds.map((m, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2">
              {(["name", "dose", "frequency", "days"] as const).map((k) => (
                <input key={k} className={inputCls} placeholder={{ name: "Medication", dose: "Dose e.g. 500mg", frequency: "e.g. twice daily", days: "Days" }[k]}
                  value={m[k]} onChange={(e) => setMeds(meds.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
              ))}
            </div>
          ))}
          <button className="text-sm text-teal-700 hover:underline" onClick={() => setMeds([...meds, { name: "", dose: "", frequency: "", days: "" }])}>+ Add medication</button>
          <Field label="Instructions">
            <textarea className={inputCls} rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label="Valid for (days)">
            <input type="number" min={1} max={365} className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </Field>
          <Btn disabled={!meds.some((m) => m.name)} onClick={async () => {
            const { id, hash } = await createRecord("rx", { title: `Prescription · ${me.name}`, medications: meds.filter((m) => m.name), text }, [c.patient, account!]);
            await call(`Prescribed for #${c.id}`, "issue_prescription", { consultation_id: c.id, record_id: id, details_hash: hash, valid_days: days });
            done();
          }}>Sign & issue prescription</Btn>
        </div>
      )}

      {tab === "close" && c.status !== "Booked" && <p className="text-sm text-slate-600">This consultation is already {c.status.toLowerCase()}.</p>}
      {tab === "close" && c.status === "Booked" && (
        <div className="space-y-3 text-sm text-slate-600">
          <p>Completing releases <b>{fmtNear(c.fee)} NEAR</b> from escrow to you. Referrals, test orders and prescriptions can still be issued afterwards.</p>
          <div className="flex gap-2">
            <Btn onClick={async () => { await call(`Completed #${c.id}`, "complete_consultation", { consultation_id: c.id }); done(); }}>Complete & get paid</Btn>
            <Btn variant="danger" onClick={async () => {
              if (!confirm("Cancel and refund the patient?")) return;
              await call(`Cancelled #${c.id}`, "cancel_consultation", { consultation_id: c.id });
              done();
            }}>Cancel & refund patient</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
