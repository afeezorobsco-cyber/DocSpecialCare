"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type nacl from "tweetnacl";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { actionCreators } from "@near-js/transactions";
import { providers } from "near-api-js";
import { CONTRACT_ID, NETWORK } from "@/lib/config";
import { GAS } from "@/lib/near";
import { getKeypair } from "@/lib/crypto";
import { cleanError } from "@/lib/errors";

export type TxResult = { result: unknown; txHash?: string };
export type ActivityItem = { label: string; txHash?: string; error?: string; at: number };

type Session = {
  ready: boolean;
  account: string | null;
  mode: "wallet" | "demo" | null;
  kp: nacl.BoxKeyPair | null;
  activity: ActivityItem[];
  call: (label: string, method: string, args: Record<string, unknown>, depositYocto?: string) => Promise<TxResult>;
  connectWallet: () => void;
  startDemo: (account: string) => void;
  signOut: () => void;
};

const Ctx = createContext<Session | null>(null);

/** Contract methods the limited (function-call) key may call: none of them accept or move money. */
export const LIMITED_KEY_METHODS = [
  "set_encryption_key", "register_provider", "complete_consultation", "cancel_consultation",
  "refer_to_specialist", "order_lab_test", "submit_lab_result", "issue_prescription",
  "assign_pharmacy", "quote_prescription", "dispense_prescription", "add_record", "grant_access", "revoke_access",
];
const LS_DEMO = "dsc:demo-account";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [mode, setMode] = useState<"wallet" | "demo" | null>(null);
  const [kp, setKp] = useState<nacl.BoxKeyPair | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const selector = useRef<WalletSelector | null>(null);
  const modal = useRef<WalletSelectorModal | null>(null);

  // init wallet selector once
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
      ]);
      // Function-call access key: on sign-in the wallet adds a limited key to the user's account that can
      // ONLY call these non-payable methods on our contract (and can't move funds). Everyday clinical actions
      // are then signed locally, with no wallet pop-up; anything with a deposit (booking, paying the lab or
      // pharmacy) still requires explicit approval in the wallet.
      const sel = await setupWalletSelector({
        network: NETWORK,
        modules: [setupMeteorWallet(), setupMyNearWallet()],
        createAccessKeyFor: { contractId: CONTRACT_ID, methodNames: LIMITED_KEY_METHODS },
      });
      selector.current = sel;
      modal.current = setupModal(sel, { contractId: CONTRACT_ID, methodNames: LIMITED_KEY_METHODS });
      const sync = (accs: { accountId: string; active: boolean }[]) => {
        const active = accs.find((a) => a.active)?.accountId;
        if (active) {
          localStorage.removeItem(LS_DEMO);
          setAccount(active);
          setMode("wallet");
        }
      };
      sync(sel.store.getState().accounts);
      const sub = sel.store.observable.subscribe((s) => sync(s.accounts));
      unsub = () => sub.unsubscribe();
      if (!sel.store.getState().accounts.length) {
        const demo = localStorage.getItem(LS_DEMO);
        if (demo) {
          setAccount(demo);
          setMode("demo");
        }
      }
      setReady(true);
    })().catch((e) => {
      console.error(e);
      const demo = localStorage.getItem(LS_DEMO);
      if (demo) {
        setAccount(demo);
        setMode("demo");
      }
      setReady(true);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!account || !mode) return setKp(null);
    getKeypair(account, mode === "demo").then(setKp);
  }, [account, mode]);

  const log = (i: ActivityItem) => setActivity((a) => [i, ...a].slice(0, 30));

  const call = useCallback<Session["call"]>(
    async (label, method, args, depositYocto = "0") => {
      if (!account) throw new Error("Not signed in");
      try {
        let out: TxResult;
        if (mode === "demo") {
          const r = await fetch("/api/demo/call", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ as: account, method, args, deposit: depositYocto }),
          });
          const j = await r.json();
          if (!r.ok) {
            log({ label, error: j.error, txHash: j.txHash, at: Date.now() });
            throw new Error(j.error || "Transaction failed");
          }
          out = j;
        } else {
          const wallet = await selector.current!.wallet();
          const outcome = await wallet.signAndSendTransaction({
            receiverId: CONTRACT_ID,
            actions: [actionCreators.functionCall(method, args, GAS, BigInt(depositYocto))],
          });
          out = outcome
            ? { result: providers.getTransactionLastResult(outcome), txHash: outcome.transaction?.hash }
            : { result: null };
        }
        log({ label, txHash: out.txHash, at: Date.now() });
        return out;
      } catch (e) {
        const msg = mode === "demo" ? (e instanceof Error ? e.message : String(e)) : cleanError(e);
        if (mode !== "demo") log({ label, error: msg, at: Date.now() });
        throw new Error(msg);
      }
    },
    [account, mode]
  );

  const value: Session = {
    ready,
    account,
    mode,
    kp,
    activity,
    call,
    connectWallet: () => modal.current?.show(),
    startDemo: (acc) => {
      localStorage.setItem(LS_DEMO, acc);
      setActivity([]);
      setAccount(acc);
      setMode("demo");
    },
    signOut: async () => {
      if (mode === "wallet" && selector.current) {
        const w = await selector.current.wallet().catch(() => null);
        await w?.signOut().catch(() => {});
      }
      localStorage.removeItem(LS_DEMO);
      setAccount(null);
      setMode(null);
      setActivity([]);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside provider");
  return s;
}
