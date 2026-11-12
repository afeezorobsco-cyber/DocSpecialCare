"use client";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "./session";
import { Btn, Modal } from "./ui";
import { view, fmtNear } from "@/lib/near";
import type { Provider } from "@/lib/types";

const SLOT_MIN = 30;

function daySlots(day: Date): number[] {
  const out: number[] = [];
  for (let h = 9; h < 17; h++)
    for (let m = 0; m < 60; m += SLOT_MIN) {
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      out.push(d.getTime());
    }
  return out;
}

/** Pick a time slot and pay the fee into escrow. Replaces the hospital queue. */
export function BookModal({
  provider,
  referralId,
  open,
  onClose,
  onBooked,
}: {
  provider: Provider;
  referralId?: number;
  open: boolean;
  onClose: () => void;
  onBooked: () => void;
}) {
  const { call } = useSession();
  const days = useMemo(() => {
    const d0 = new Date();
    d0.setHours(0, 0, 0, 0);
    return Array.from({ length: 5 }, (_, i) => new Date(d0.getTime() + i * 86400000));
  }, []);
  const [day, setDay] = useState(0);
  const [taken, setTaken] = useState<Set<number>>(new Set());
  const [slot, setSlot] = useState<number | null>(null);
  const slots = useMemo(() => daySlots(days[day]).filter((t) => t > Date.now() + 60_000), [days, day]);

  useEffect(() => {
    if (!open) return;
    setSlot(null);
    view<number[]>("booked_slots", { provider_id: provider.account_id })
      .then((r) => setTaken(new Set(r)))
      .catch(() => setTaken(new Set()));
  }, [open, provider.account_id]);

  return (
    <Modal open={open} onClose={onClose} title={`Book ${provider.name}`}>
      <p className="mb-3 text-sm text-slate-600">
        {provider.specialty} · fee <b>{fmtNear(provider.fee)} NEAR</b>, held in escrow by the contract until the consultation is completed.
        Refunded if cancelled before the slot or if the doctor doesn&apos;t show.
      </p>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {days.map((d, i) => (
          <button
            key={i}
            onClick={() => setDay(i)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ring-1 ${i === day ? "bg-teal-700 text-white ring-teal-700" : "bg-white text-slate-700 ring-slate-300"}`}
          >
            {i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
          </button>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-4 gap-2">
        {slots.length === 0 && <p className="col-span-4 text-sm text-slate-500">No more slots today.</p>}
        {slots.map((s) => (
          <button
            key={s}
            disabled={taken.has(s)}
            onClick={() => setSlot(s)}
            className={`rounded-lg px-2 py-1.5 text-sm ring-1 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:line-through ${
              slot === s ? "bg-teal-700 text-white ring-teal-700" : "bg-white text-slate-700 ring-slate-300 hover:bg-teal-50"
            }`}
          >
            {new Date(s).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </button>
        ))}
      </div>
      <Btn
        disabled={!slot}
        onClick={async () => {
          await call(
            `Booked ${provider.name}`,
            "book_consultation",
            { provider_id: provider.account_id, slot_start: slot, referral_id: referralId ?? null },
            provider.fee
          );
          onBooked();
          onClose();
        }}
      >
        Pay {fmtNear(provider.fee)} NEAR & book
      </Btn>
    </Modal>
  );
}
