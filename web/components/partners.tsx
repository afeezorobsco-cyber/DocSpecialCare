"use client";
import { useState } from "react";
import { useSession } from "./session";
import { useLoad, RecordButton } from "./shared";
import { Acc, Badge, Btn, Card, Empty, Field, Modal, inputCls, when } from "./ui";
import { view, fmtNear, toYocto } from "@/lib/near";
import { createRecord } from "@/lib/records";
import { fileToB64 } from "@/lib/crypto";
import type { LabOrder, Prescription, Provider, Role } from "@/lib/types";

export function LabDashboard({ me, providers }: { me: Provider; providers: Provider[] }) {
  const { account } = useSession();
  const name = (id: string) => providers.find((p) => p.account_id === id)?.name || id;
  const orders = useLoad(() => view<LabOrder[]>("lab_orders_for", { account_id: account }), [account]);
  const [upload, setUpload] = useState<LabOrder | null>(null);
  const groups: [string, LabOrder["status"]][] = [["Ready to test (paid)", "Paid"], ["Awaiting patient payment", "AwaitingPayment"], ["Results delivered", "ResultReady"]];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {groups.map(([title, st]) => {
        const list = orders.data?.filter((o) => o.status === st) || [];
        return (
          <Card key={st} title={`${title} (${list.length})`} action={st === "Paid" ? <Btn variant="ghost" onClick={orders.reload}>Refresh</Btn> : undefined}>
            {!list.length && <Empty>Nothing here.</Empty>}
            <div className="space-y-2">
              {list.map((o) => (
                <div key={o.id} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-medium">Order #{o.id} · {fmtNear(o.fee)} NEAR</p>
                  <p className="text-xs text-slate-500">
                    <Acc id={o.patient} /> · by {name(o.ordered_by)} · {when(o.created_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <RecordButton id={o.order_record_id} label="Tests" />
                    {st === "Paid" && <Btn onClick={() => setUpload(o)}>Upload result</Btn>}
                    {o.result_record_id && <RecordButton id={o.result_record_id} label="Result" />}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      {upload && <UploadResult o={upload} me={me} onClose={() => setUpload(null)} onDone={orders.reload} />}
    </div>
  );
}

function UploadResult({ o, me, onClose, onDone }: { o: LabOrder; me: Provider; onClose: () => void; onDone: () => void }) {
  const { account, call } = useSession();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  return (
    <Modal open onClose={onClose} title={`Result for order #${o.id}`}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Encrypted for the patient and the ordering doctor. Submitting releases {fmtNear(o.fee)} NEAR to you.</p>
        <Field label="Summary / values">
          <textarea className={inputCls} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Haemoglobin 13.2 g/dL (ref 12–16)…" />
        </Field>
        <Field label="Report file (PDF/image, max 8 MB)">
          <input type="file" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <Btn disabled={!text && !file} onClick={async () => {
          const attachment = file ? { name: file.name, mime: file.type || "application/octet-stream", dataB64: await fileToB64(file) } : undefined;
          const { id, hash } = await createRecord("res", { title: `Lab result · ${me.name}`, text, attachment }, [o.patient, o.ordered_by, account!]);
          await call(`Submitted result #${o.id}`, "submit_lab_result", { lab_order_id: o.id, record_id: id, content_hash: hash });
          onDone();
          onClose();
        }}>Encrypt & submit</Btn>
      </div>
    </Modal>
  );
}

export function PharmacyDashboard({ providers }: { providers: Provider[] }) {
  const { account, call } = useSession();
  const name = (id: string) => providers.find((p) => p.account_id === id)?.name || id;
  const rxs = useLoad(() => view<Prescription[]>("prescriptions_for", { account_id: account }), [account]);
  const mine = rxs.data?.filter((r) => r.pharmacy === account) || [];
  const [price, setPrice] = useState<Record<number, string>>({});
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={`Prescriptions sent to you (${mine.length})`} action={<Btn variant="ghost" onClick={rxs.reload}>Refresh</Btn>}>
        {!mine.length && <Empty>Patients send prescriptions here from their app.</Empty>}
        <div className="space-y-2">
          {mine.map((rx) => (
            <div key={rx.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Rx #{rx.id} · {name(rx.prescriber)}</p>
                <Badge status={rx.status} />
              </div>
              <p className="text-xs text-slate-500"><Acc id={rx.patient} /> · expires {when(rx.expires_at)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <RecordButton id={rx.record_id} />
                {(rx.status === "Issued" || rx.status === "Quoted") && (
                  <>
                    <input className={`${inputCls} w-28`} placeholder="Price NEAR" value={price[rx.id] ?? ""} onChange={(e) => setPrice({ ...price, [rx.id]: e.target.value })} />
                    <Btn disabled={!price[rx.id]} onClick={async () => {
                      await call(`Quoted Rx #${rx.id}`, "quote_prescription", { prescription_id: rx.id, price: toYocto(price[rx.id]) });
                      rxs.reload();
                    }}>{rx.status === "Quoted" ? "Update quote" : "Send quote"}</Btn>
                  </>
                )}
                {rx.status === "Quoted" && <span className="text-xs text-slate-500">Quoted {fmtNear(rx.price)} NEAR, waiting for patient.</span>}
                {rx.status === "Paid" && (
                  <Btn onClick={async () => { await call(`Dispensed Rx #${rx.id}`, "dispense_prescription", { prescription_id: rx.id }); rxs.reload(); }}>
                    Dispense & receive {fmtNear(rx.price)} NEAR
                  </Btn>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <VerifyRx />
    </div>
  );
}

/** Anyone can check a prescription is genuine and not already dispensed. */
function VerifyRx() {
  const [id, setId] = useState("");
  const [rx, setRx] = useState<Prescription | null | undefined>(undefined);
  return (
    <Card title="Verify a prescription">
      <p className="mb-3 text-sm text-slate-600">Check any prescription against NEAR: who issued it, whether it expired, and whether it was already dispensed.</p>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Prescription #" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} />
        <Btn disabled={!id} onClick={async () => setRx(await view<Prescription | null>("get_prescription", { id: Number(id) }))}>Check</Btn>
      </div>
      {rx === null && <p className="mt-3 text-sm text-rose-700">No such prescription on-chain. Possible forgery.</p>}
      {rx && (
        <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
          <dt className="text-slate-500">Status</dt><dd><Badge status={rx.status} /></dd>
          <dt className="text-slate-500">Prescriber</dt><dd><Acc id={rx.prescriber} /></dd>
          <dt className="text-slate-500">Issued</dt><dd>{when(rx.issued_at)}</dd>
          <dt className="text-slate-500">Expires</dt><dd className={Date.now() > rx.expires_at ? "text-rose-700" : ""}>{when(rx.expires_at)}</dd>
          <dt className="text-slate-500">Dispensed</dt><dd>{rx.dispensed_at ? when(rx.dispensed_at) : "No"}</dd>
        </dl>
      )}
    </Card>
  );
}

export function RegisterProvider({ existing, onDone }: { existing?: Provider | null; onDone: () => void }) {
  const { call } = useSession();
  const [role, setRole] = useState<Role>(existing?.role || "Physician");
  const [name, setName] = useState(existing?.name || "");
  const [specialty, setSpecialty] = useState(existing?.specialty || "");
  const [license, setLicense] = useState(existing?.license_id || "");
  const [fee, setFee] = useState(existing ? fmtNear(existing.fee) : "0.1");
  return (
    <div className="space-y-3">
      <Field label="I am a">
        <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="Physician">General physician</option>
          <option value="Specialist">Specialist / consultant</option>
          <option value="Laboratory">Laboratory</option>
          <option value="Pharmacy">Pharmacy</option>
        </select>
      </Field>
      <Field label="Display name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Ada Okafor / CityLab Diagnostics" /></Field>
      <Field label={role === "Specialist" ? "Specialty" : role === "Laboratory" ? "Services" : "Description"}>
        <input className={inputCls} value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder={role === "Specialist" ? "Cardiology" : "General practice"} />
      </Field>
      <Field label="License / registration number"><input className={inputCls} value={license} onChange={(e) => setLicense(e.target.value)} /></Field>
      {role !== "Pharmacy" && (
        <Field label={role === "Laboratory" ? "Test fee (NEAR)" : "Consultation fee (NEAR)"}>
          <input className={inputCls} value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
      )}
      <Btn disabled={!name} onClick={async () => {
        await call("Registered as provider", "register_provider", { role, name, specialty, license_id: license, fee: toYocto(role === "Pharmacy" ? "0" : fee || "0") });
        onDone();
      }}>Save profile</Btn>
      <p className="text-xs text-slate-500">Providers must be verified (license check by the DocSpecialCare admin) before patients can book them.</p>
    </div>
  );
}
