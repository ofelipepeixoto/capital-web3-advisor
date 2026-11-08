export const SIGNAL_IDS = ["urgency", "guaranteed_return", "unsolicited_link", "different_domain",
  "unverified_contract", "unlimited_approval", "secret_request", "missing_team_docs",
  "unclear_tokenomics", "profit_screenshots"];
const CRITICAL_SIGNALS = ["guaranteed_return", "unsolicited_link", "different_domain", "secret_request"];
const has = (values, value) => typeof value === 'string' && values.includes(value);
function fail() { throw new Error('invalid_lite_input'); }
function exactObject(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const p = Object.getPrototypeOf(input);
  if (p !== Object.prototype && p !== null) return fail();
  const all = Reflect.ownKeys(input);
  if (all.length !== keys.length || all.some(key => typeof key !== 'string' || !keys.includes(key))) return fail();
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(input, key); if (!d || !('value' in d) || !d.enumerable) return fail(); }
  return input;
}
export function assessSignals(input) {
  const answers = exactObject(input, SIGNAL_IDS);
  let critical = 0, flagged = 0, unknown = 0, notApplicable = 0;
  for (const id of SIGNAL_IDS) {
    const a = answers[id];
    if (!has(['yes', 'no', 'unknown', 'not_applicable'], a)) return fail();
    if (a === 'yes') { flagged++; if (CRITICAL_SIGNALS.includes(id)) critical++; }
    if (a === 'unknown') unknown++;
    if (a === 'not_applicable') notApplicable++;
  }
  const applicable = SIGNAL_IDS.length - notApplicable;
  const status = critical ? 'blocked' : flagged >= 3 ? 'pause_and_investigate' : flagged ? 'review_signals' : unknown || !applicable ? 'incomplete' : 'no_signal_reported';
  return { status, critical_signals: critical, flagged_signals: flagged, unknown, not_applicable: notApplicable,
    applicable, assessed: applicable - unknown, scope: 'declared_only', safety_guarantee: false };
}
