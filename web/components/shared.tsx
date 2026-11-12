"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./session";
import { Btn, Modal, inputCls, when } from "./ui";
import { readRecord, pubKeyOf } from "@/lib/records";
import { openMessage, roomName, sealMessage } from "@/lib/crypto";
import type { Consultation, RecordBody } from "@/lib/types";

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [run]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

/** Decrypts and shows a record the current user is allowed to read. */
export function RecordButton({ id, label = "View" }: { id: string; label?: string }) {
  const { account, kp } = useSession();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ body?: RecordBody; verified?: boolean; err?: string }>({});
  const show = async () => {
    setOpen(true);
    setState({});
    try {
      const r = await readRecord(id, account!, kp!);
      setState({ body: r.body, verified: r.verified });
    } catch (e) {
      setState({ err: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <>
      <Btn variant="ghost" onClick={show}>
        🔒 {label}
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={state.body?.title || "Encrypted record"}>
        {!state.body && !state.err && <p className="text-sm text-slate-500">Decrypting in your browser…</p>}
        {state.err && <p className="text-sm text-rose-700">{state.err}</p>}
        {state.body && <RecordBodyView body={state.body} verified={state.verified!} id={id} />}
      </Modal>
    </>
  );
}

function RecordBodyView({ body, verified, id }: { body: RecordBody; verified: boolean; id: string }) {
  return (
    <div className="space-y-3 text-sm text-slate-800">
      <p className={`rounded-lg px-3 py-2 text-xs ${verified ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
        {verified
          ? "✓ Integrity verified: the ciphertext matches the sha-256 hash stored on NEAR."
          : "⚠ Hash does not match the on-chain record."}{" "}
        <span className="font-mono">{id}</span>
      </p>
      {body.text && <p className="whitespace-pre-wrap">{body.text}</p>}
      {body.tests && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Tests ordered</p>
          <ul className="list-inside list-disc">{body.tests.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      {body.medications && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1">Medication</th>
              <th>Dose</th>
              <th>Frequency</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            {body.medications.map((m, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-1 font-medium">{m.name}</td>
                <td>{m.dose}</td>
                <td>{m.frequency}</td>
                <td>{m.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {body.attachment && (
        <div className="space-y-2">
          {body.attachment.mime.startsWith("image/") && (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={body.attachment.name} className="max-h-72 rounded-lg border" src={`data:${body.attachment.mime};base64,${body.attachment.dataB64}`} />
          )}
          <a
            className="inline-block text-teal-700 underline"
            download={body.attachment.name}
            href={`data:${body.attachment.mime};base64,${body.attachment.dataB64}`}
          >
            Download {body.attachment.name}
          </a>
        </div>
      )}
    </div>
  );
}

/** Encrypted chat + private video room for one consultation. */
export function ConsultRoom({ c, open, onClose }: { c: Consultation; open: boolean; onClose: () => void }) {
  const { account, kp } = useSession();
  const other = account === c.patient ? c.provider : c.patient;
  const [otherPub, setOtherPub] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<{ from: string; text: string; at: number }[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !kp) return;
    pubKeyOf(other)
      .then(async (p) => {
        setOtherPub(p);
        setRoom(await roomName(c.id, kp, p));
      })
      .catch((e) => setErr(e.message));
  }, [open, other, kp, c.id]);

  useEffect(() => {
    if (!open || !otherPub || !kp) return;
    let alive = true;
    const poll = async () => {
      const list: { from: string; box: string; nonce: string; at: number }[] = await fetch(`/api/chat/${c.id}`).then((r) => r.json());
      if (alive) setMsgs(list.map((m) => ({ from: m.from, at: m.at, text: openMessage(m, kp, otherPub) })));
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, otherPub, kp, c.id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const send = async () => {
    if (!text.trim() || !otherPub || !kp) return;
    const m = sealMessage(text.trim(), kp, otherPub);
    await fetch(`/api/chat/${c.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: account, ...m }),
    });
    setText("");
    setMsgs((l) => [...l, { from: account!, text: text.trim(), at: Date.now() }]);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Consultation #${c.id} · ${when(c.slot_start)}`}>
      {err && <p className="mb-3 text-sm text-rose-700">{err}</p>}
      {room && (
        <a
          href={`https://meet.jit.si/${room}`}
          target="_blank"
          rel="noreferrer"
          className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          🎥 Join private video call
        </a>
      )}
      <p className="mb-2 text-xs text-slate-500">Messages are end-to-end encrypted between you and {other}.</p>
      <div className="mb-3 h-64 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
        {msgs.length === 0 && <p className="text-center text-xs text-slate-400">No messages yet.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.from === account ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === account ? "bg-teal-700 text-white" : "bg-white text-slate-800 ring-1 ring-slate-200"}`}>
              {m.text}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" />
        <Btn type="submit">Send</Btn>
      </form>
    </Modal>
  );
}
