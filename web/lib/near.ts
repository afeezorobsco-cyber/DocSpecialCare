import { providers, utils } from "near-api-js";
import { CONTRACT_ID, RPC_URLS } from "./config";

const _providers = RPC_URLS.map((url) => new providers.JsonRpcProvider({ url }));
let _preferred = 0;

/** Provider used for signing transactions (fails over between endpoints). */
export function rpc() {
  return new providers.FailoverRpcProvider([..._providers.slice(_preferred), ..._providers.slice(0, _preferred)]);
}

const isTransient = (e: unknown) => /429|rate limit|timeout|fetch failed|ECONN|503|502/i.test(String((e as Error)?.message || e));

/** Read-only contract call with endpoint failover and backoff. Works in the browser and in API routes. */
export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const idx = (_preferred + attempt) % _providers.length;
    try {
      const r = (await _providers[idx].callFunction(CONTRACT_ID, method, args, { finality: "optimistic" })) as T;
      _preferred = idx;
      return r;
    } catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
    }
  }
  throw last;
}

export const GAS = BigInt("100000000000000"); // 100 Tgas

export function toYocto(near: string | number): string {
  const v = utils.format.parseNearAmount(String(near));
  if (v === null) throw new Error("Invalid NEAR amount");
  return v;
}

export function fmtNear(yocto: string | null | undefined, digits = 3): string {
  if (!yocto) return "0";
  const s = utils.format.formatNearAmount(yocto, digits);
  return s.replace(/\.?0+$/, "") || "0";
}

const _accessCache = new Map<string, { v: boolean; at: number }>();
/** can_access with a short cache (positive answers only) to spare the RPC. Server-side use. */
export async function canAccess(recordId: string, account: string): Promise<boolean> {
  const k = `${recordId}|${account}`;
  const hit = _accessCache.get(k);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const v = await view<boolean>("can_access", { record_id: recordId, account_id: account });
  if (v) _accessCache.set(k, { v, at: Date.now() });
  return v;
}
