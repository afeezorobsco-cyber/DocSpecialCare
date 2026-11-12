import { providers, utils } from "near-api-js";
import { CONTRACT_ID, RPC_URL } from "./config";

let _provider: InstanceType<typeof providers.JsonRpcProvider> | null = null;
export function rpc() {
  if (!_provider) _provider = new providers.JsonRpcProvider({ url: RPC_URL });
  return _provider;
}

/** Read-only contract call. Works in the browser and in API routes. */
export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await rpc().callFunction(CONTRACT_ID, method, args)) as T;
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
