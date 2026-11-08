/** Synthetic COFRE Lite candidate rules. Pure functions; not wired to API or release.
 * Answers are declarations, not verified evidence or a safety guarantee.
 * Source models are deliberately separate and require explicit methodological approval.
 */
export const SIGNAL_IDS = ["urgency", "guaranteed_return", "unsolicited_link", "different_domain",
  "unverified_contract", "unlimited_approval", "secret_request", "missing_team_docs",
  "unclear_tokenomics", "profit_screenshots"] as const;
export type SignalId = typeof SIGNAL_IDS[number];
export type SignalAnswer = "yes" | "no" | "unknown" | "not_applicable";
const CRITICAL_SIGNALS: readonly SignalId[] = ["guaranteed_return", "unsolicited_link", "different_domain", "secret_request"];
const has = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && values.includes(value as T);
function fail(): never { throw new Error("invalid_lite_input"); }
function exactObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const p = Object.getPrototypeOf(input);
  if (p !== Object.prototype && p !== null) return fail();
  const all = Reflect.ownKeys(input);
  if (all.length !== keys.length || all.some(key => typeof key !== "string" || !keys.includes(key))) return fail();
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(input, key); if (!d || !("value" in d) || !d.enumerable) return fail(); }
  return input as Record<string, unknown>;
}

/** Higher risk cannot be overridden by coverage or a score. No positive safety verdict. */
export function assessSignals(input: unknown) {
  const answers = exactObject(input, SIGNAL_IDS);
  let critical = 0, flagged = 0, unknown = 0, notApplicable = 0;
  for (const id of SIGNAL_IDS) {
    const a = answers[id];
    if (!has(["yes", "no", "unknown", "not_applicable"] as const, a)) return fail();
    if (a === "yes") { flagged++; if (CRITICAL_SIGNALS.includes(id)) critical++; }
    if (a === "unknown") unknown++;
    if (a === "not_applicable") notApplicable++;
  }
  const applicable = SIGNAL_IDS.length - notApplicable;
  const status = critical ? "blocked" : flagged >= 3 ? "pause_and_investigate" : flagged ? "review_signals" : unknown || !applicable ? "incomplete" : "no_signal_reported";
  return { status, critical_signals: critical, flagged_signals: flagged, unknown, not_applicable: notApplicable,
    applicable, assessed: applicable - unknown, scope: "declared_only", safety_guarantee: false } as const;
}

export const ROUTINE_TASK_IDS = ["wallet_roles", "vault_dapp", "approvals", "unusual_movements", "inventory", "protocols", "backup", "recovery_drill", "incident_response"] as const;
export type RoutineTaskId = typeof ROUTINE_TASK_IDS[number];
export type RoutineItem = { applicability: "applicable" | "not_applicable" | "unknown"; due: "due" | "not_due" | "unknown"; state: "done" | "not_done" | "unknown" };
/** Caller must establish due dates externally. Missing due or applicability is disclosed, never silently excluded. */
export function assessRoutine(input: unknown) {
  const rows = exactObject(input, ROUTINE_TASK_IDS);
  let due = 0, completed = 0, pending = 0, unassessed = 0, excluded = 0, unknownApplicability = 0, unknownDue = 0;
  for (const id of ROUTINE_TASK_IDS) {
    const item = exactObject(rows[id], ["applicability", "due", "state"]);
    if (!has(["applicable", "not_applicable", "unknown"] as const, item.applicability) ||
        !has(["due", "not_due", "unknown"] as const, item.due) ||
        !has(["done", "not_done", "unknown"] as const, item.state)) return fail();
    if (item.applicability === "not_applicable") { excluded++; continue; }
    if (item.applicability === "unknown") { unknownApplicability++; continue; }
    if (item.due === "unknown") { unknownDue++; continue; }
    if (item.due === "not_due") { excluded++; continue; }
    due++;
    if (item.state === "done") completed++; else if (item.state === "not_done") pending++; else unassessed++;
  }
  // Even with due items completed, outstanding scope/due unknowns suppress an overall ratio.
  const coverage = due && !unknownApplicability && !unknownDue ? completed / due : null;
  return { due, completed, pending, unassessed, excluded, unknown_applicability: unknownApplicability,
    unknown_due: unknownDue, coverage, complete: due > 0 && completed === due && !unknownApplicability && !unknownDue,
    scope: "declared_only" } as const;
}

const SHEET_KEYS = ["separation", "vault_isolation", "offline_backup", "test_transfer", "approval_review", "official_links", "contract_validation", "strong_mfa", "inventory", "monthly_review"] as const;
const DOCUMENT_OPTIONS = {
  wallet_separation: [0, 10, 20], backup: [0, 10, 20], permissions: [0, 8, 15],
  verification: [0, 8, 15], antifraud: [0, 8, 15], routine: [0, 8, 15],
} as const;
type Method = "lite_sheet_10_v1" | "lite_document_6_v1";
/** Explicit model selection is mandatory. Missing answers never become 0 or a classification. */
export function assessCandidateScore(method: unknown, values: unknown) {
  if (!has(["lite_sheet_10_v1", "lite_document_6_v1"] as const, method)) return fail();
  const keys = method === "lite_sheet_10_v1" ? SHEET_KEYS : Object.keys(DOCUMENT_OPTIONS);
  const answers = exactObject(values, keys);
  let assessed = 0;
  for (const k of keys) {
    const a = answers[k];
    if (a === "unknown") continue;
    if (method === "lite_sheet_10_v1") {
      if (!has(["yes", "no"] as const, a)) return fail();
    } else {
      const choices = DOCUMENT_OPTIONS[k as keyof typeof DOCUMENT_OPTIONS] as readonly number[];
      if (typeof a !== "number" || !choices.includes(a)) return fail();
    }
    assessed++;
  }
  // No caller-provided finding or approval can unlock a score. A future server
  // release must derive critical risks from the authorized, persisted case and
  // check an auditable, version-bound methodology approval before calculating.
  return { method: method as Method, status: "methodology_unapproved", assessed,
    total_items: keys.length, score: null, safety_guarantee: false,
    approved_methodology: false } as const;
}
export const LITE_SHEET_SCORE_KEYS = SHEET_KEYS;
export const LITE_DOCUMENT_SCORE_KEYS = Object.keys(DOCUMENT_OPTIONS);
