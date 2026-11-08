import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listSyntheticJourneys, validateJourneyIntake, summarizeJourney } from '../supabase/functions/advisory-api/journeys.mjs';

const empty = journey => ({ schema_version: 'journey-intake-0.1', synthetic: true, journey: journey.id,
  responses: Object.fromEntries(journey.stages.map(id => [id, { state: 'not_assessed', evidence: 'none' }])) });
const all = listSyntheticJourneys();
const invalid = value => assert.throws(() => validateJourneyIntake(value), error => error.code === 'invalid_journey_intake' && error.message === 'invalid_journey_intake');

test('each journey has distinct closed stages and returns no score or approval', () => {
  assert.deepEqual(all.map(item => item.id), ['cofre6_individual', 'advanced_investor', 'rastro', 'organization_dao']);
  for (const journey of all) {
    const result = summarizeJourney(empty(journey));
    assert.equal(result.status, 'needs_input'); assert.equal(result.counts.unassessed, journey.stages.length);
    assert.equal(result.stages.length, new Set(journey.stages).size);
    assert.ok(result.limitations.includes('no_score')); assert.equal('score' in result, false);
  }
});

test('unknown, gaps, declared, reviewed and not-applicable stay distinct', () => {
  const value = empty(all[0]), keys = all[0].stages;
  value.responses[keys[0]] = { state: 'unknown', evidence: 'none' };
  value.responses[keys[1]] = { state: 'gap', evidence: 'declared' };
  value.responses[keys[2]] = { state: 'human_reviewed', evidence: 'human_reviewed' };
  value.responses[keys[3]] = { state: 'not_applicable', evidence: 'none' };
  value.responses[keys[4]] = { state: 'declared', evidence: 'declared' };
  const result = summarizeJourney(value);
  assert.equal(result.status, 'needs_input'); assert.equal(result.counts.gaps, 1);
  assert.equal(result.counts.unassessed, 1); assert.equal(result.counts.unknown, 1); assert.equal(result.counts.not_applicable, 1);
  value.responses[keys[0]] = { state: 'declared', evidence: 'declared' };
  value.responses[keys[5]] = { state: 'declared', evidence: 'declared' };
  assert.equal(summarizeJourney(value).status, 'has_gaps');
  value.responses[keys[1]] = { state: 'human_reviewed', evidence: 'human_reviewed' };
  assert.equal(summarizeJourney(value).status, 'awaits_human_review');
});

test('rejects free text, non-synthetic inputs, spoofed evidence and unrelated stages', () => {
  for (const journey of all) {
    const value = empty(journey), first = journey.stages[0];
    for (const bad of [ { ...value, synthetic: false }, { ...value, secret: 'sensitive' },
      { ...value, journey: '__proto__' }, { ...value, responses: { ...value.responses, surprise: {} } },
      { ...value, responses: { ...value.responses, [first]: { state: 'declared', evidence: 'human_reviewed' } } },
      { ...value, responses: { ...value.responses, [first]: { state: 'human_reviewed', evidence: 'none' } } },
      { ...value, responses: { ...value.responses, [first]: { state: 'not_assessed', evidence: 'declared' } } } ]) invalid(bad);
  }
});

test('returns detached catalog and intake; getters never run', () => {
  const original = listSyntheticJourneys(); original[0].stages.length = 0;
  assert.equal(listSyntheticJourneys()[0].stages.length, 6);
  const v = empty(all[0]), clean = validateJourneyIntake(v), key = all[0].stages[0];
  clean.responses[key].state = 'gap'; assert.equal(v.responses[key].state, 'not_assessed');
  let invoked = false; const attack = empty(all[0]);
  Object.defineProperty(attack.responses, key, { enumerable: true, get() { invoked = true; return {}; } });
  invalid(attack); assert.equal(invoked, false);
});
