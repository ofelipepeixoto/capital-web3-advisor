/**
 * Synthetic journey structure. Pure functions only; NOT an endpoint or a report.
 * Source references and scope are in docs/journeys-synthetic.md.
 * No network, free text, balances, addresses, secrets, score or approval.
 */
const CATALOG = Object.freeze({
  cofre6_individual: Object.freeze([
    'threat_model', 'wallet_roles', 'keys_and_recovery', 'hygiene', 'evidence', 'continuity',
  ]),
  advanced_investor: Object.freeze([
    'objectives_and_liquidity', 'wallet_roles', 'assets_and_liabilities',
    'sources_and_evidence', 'permissions_and_exposure', 'risk_and_action_plan',
  ]),
  rastro: Object.freeze([
    'mandate', 'universe', 'maturity', 'minimal_stack', 'taxonomy_and_owners', 'rituals_and_alerts', 'plan_90_days',
  ]),
  organization_dao: Object.freeze([
    'mandate_and_structure', 'roles_and_delegation', 'treasury_policy',
    'multisig_and_modules', 'review_and_decision', 'reconciliation_and_continuity',
  ]),
});
const STATES = Object.freeze(['not_assessed', 'unknown', 'declared', 'human_reviewed', 'gap', 'not_applicable']);
const EVIDENCE = Object.freeze(['none', 'declared', 'human_reviewed']);

export class JourneyValidationError extends Error {
  constructor() { super('invalid_journey_intake'); this.name = 'JourneyValidationError'; this.code = 'invalid_journey_intake'; }
}
const invalid = () => { throw new JourneyValidationError(); };
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) return invalid();
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) return invalid();
  }
  return value;
}
function choice(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) return invalid();
  return value;
}

/** Detached descriptions, not a promise of an integrated or automated journey. */
export function listSyntheticJourneys() {
  return Object.entries(CATALOG).map(([id, stages]) => ({ id, stages: [...stages] }));
}

/** Validate a closed envelope. No user-supplied IDs, strings, attachments or extra fields. */
export function validateJourneyIntake(value) {
  const body = record(value, ['schema_version', 'synthetic', 'journey', 'responses']);
  if (body.schema_version !== 'journey-intake-0.1' || body.synthetic !== true) return invalid();
  const journey = choice(body.journey, Object.keys(CATALOG));
  const entries = record(body.responses, CATALOG[journey]);
  const responses = Object.create(null);
  for (const id of CATALOG[journey]) {
    const entry = record(entries[id], ['state', 'evidence']);
    const state = choice(entry.state, STATES), evidence = choice(entry.evidence, EVIDENCE);
    // A claim of review must be explicit. Unanswered and NA do not imply evidence.
    if (['not_assessed', 'unknown', 'not_applicable'].includes(state) && evidence !== 'none') return invalid();
    if (state === 'declared' && evidence !== 'declared') return invalid();
    if (state === 'human_reviewed' && evidence !== 'human_reviewed') return invalid();
    if (state === 'gap' && evidence === 'none') return invalid();
    responses[id] = { state, evidence };
  }
  return { schema_version: 'journey-intake-0.1', synthetic: true, journey, responses };
}

/** Describe remaining review work, never a certification or financial recommendation. */
export function summarizeJourney(value) {
  const intake = validateJourneyIntake(value);
  const stages = CATALOG[intake.journey].map(id => ({ id, ...intake.responses[id] }));
  const open = stages.filter(item => ['not_assessed', 'unknown'].includes(item.state));
  const gaps = stages.filter(item => item.state === 'gap');
  const na = stages.filter(item => item.state === 'not_applicable');
  return {
    journey: intake.journey, status: open.length ? 'needs_input' : gaps.length ? 'has_gaps' : 'awaits_human_review',
    stages, counts: { total: stages.length, unassessed: stages.filter(item => item.state === 'not_assessed').length,
      unknown: stages.filter(item => item.state === 'unknown').length, gaps: gaps.length, not_applicable: na.length },
    limitations: ['synthetic_only', 'no_independent_verification', 'no_score', 'no_automatic_approval'],
  };
}
