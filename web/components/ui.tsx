"use client";
import { useState, type ReactNode } from "react";
import { accountLink, txLink } from "@/lib/config";

export function Card({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const tones: Record<string, string> = {
  Booked: "bg-sky-50 text-sky-700 ring-sky-200",
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
  AwaitingPayment: "bg-amber-50 text-amber-700 ring-amber-200",
  Paid: "bg-sky-50 text-sky-700 ring-sky-200",
  ResultReady: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Issued: "bg-violet-50 text-violet-700 ring-violet-200",
  Quoted: "bg-amber-50 text-amber-700 ring-amber-200",
  Dispensed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

const labels: Record<string, string> = { AwaitingPayment: "Awaiting payment", ResultReady: "Result ready" };

export function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[status] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>
      {labels[status] || status}
    </span>
  );
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => unknown | Promise<unknown>;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const [busy, setBusy] = useState(false);
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-300",
    ghost: "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    danger: "bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled || busy}
      onClick={async () => {
        if (!onClick) return;
        setBusy(true);
        try {
          await onClick();
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${styles}`}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function Acc({ id }: { id: string }) {
  return (
    <a href={accountLink(id)} target="_blank" rel="noreferrer" className="font-mono text-xs text-teal-700 hover:underline">
      {id}
    </a>
  );
}

export function TxLink({ hash }: { hash?: string }) {
  if (!hash) return null;
  return (
    <a href={txLink(hash)} target="_blank" rel="noreferrer" className="font-mono text-xs text-teal-700 hover:underline">
      {hash.slice(0, 8)}…
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">{children}</p>;
}

export const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
