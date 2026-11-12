export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || "testnet") as "testnet" | "mainnet";
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "docspecialcare.testnet";
/** RPC endpoints, tried in order (free endpoints rate-limit; we fail over). */
export const RPC_URLS: string[] = (
  process.env.NEXT_PUBLIC_RPC_URLS ||
  (NETWORK === "mainnet"
    ? "https://free.rpc.fastnear.com,https://rpc.mainnet.near.org"
    : "https://test.rpc.fastnear.com,https://rpc.testnet.near.org")
).split(",");
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

/** Demo personas (testnet only). Keys live server-side in DEMO_KEYS. */
export type Persona = { label: string; account: string; blurb: string };
export const DEMO_PERSONAS: Persona[] = (() => {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_DEMO_PERSONAS || "[]");
  } catch {
    return [];
  }
})();

export const txLink = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const accountLink = (id: string) => `${EXPLORER}/address/${id}`;
