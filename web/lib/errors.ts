/** Turns a NEAR execution error into the contract's human-readable panic message. */
export function cleanError(e: unknown): string {
  const raw =
    typeof e === "string" ? e : e instanceof Error ? `${e.message} ${e.stack || ""}` : JSON.stringify(e, Object.getOwnPropertyNames(e as object));
  const s = raw.replace(/\\\\n|\\n/g, "\n");
  const m = s.match(/Smart contract panicked: (?:panicked at [^\n]*?:\d+:\d+:\n)?([^"\\\n]+)/);
  if (m) return m[1].trim();
  const n = s.match(/"ExecutionError":"([^"]+)"/);
  return (n ? n[1] : e instanceof Error ? e.message : s).slice(0, 300);
}
