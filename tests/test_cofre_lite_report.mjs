import test from 'node:test';
import assert from 'node:assert/strict';
import { LITE_CONTROL_IDS, validateLiteReportIntake, buildLiteReport } from '../supabase/functions/advisory-api/cofre-lite-report.mjs';
import { SIGNAL_IDS } from '../supabase/functions/advisory-api/cofre-lite-signals.mjs';
const input = () => ({ schema_version: 'cofre-lite-intake-0.2', synthetic: true,
  consents: { assessment: true, storage: true }, profile: { experience: 'unknown' },
  controls: Object.fromEntries(LITE_CONTROL_IDS.map(k => [k, 'unknown'])),
  signals: Object.fromEntries(SIGNAL_IDS.map(k => [k, 'unknown'])) });

test('unknown answers remain gaps, never become a safe result or score', () => {
  const r = buildLiteReport(input());
  assert.equal(r.status, 'incomplete'); assert.equal(r.score, null);
  assert.equal(r.human_review.approved, false); assert.equal(r.gaps.length, 23);
  assert.equal(r.signals.assessment.status, 'incomplete');
  assert.ok(r.controls.every(c => c.evidence === 'unknown'));
});

test('critical risks take precedence over all missing responses', () => {
  const v = input(); v.signals.secret_request = 'yes';
  const r = buildLiteReport(v); assert.equal(r.status, 'blocked');
  assert.equal(r.findings.find(f => f.id === 'signal.secret_request').severity, 'critical');
  assert.ok(r.gaps.length > 0); assert.match(r.plan[0].action, /Interrompa/);
  v.signals.secret_request = 'unknown'; v.controls.secret_exposure = 'yes';
  assert.equal(buildLiteReport(v).status, 'blocked');
});

test('complete answers still require independent human review and no score', () => {
  const v = input(); v.profile.experience = 'beginner';
  for (const k of LITE_CONTROL_IDS) v.controls[k] = k === 'secret_exposure' ? 'no' : 'yes';
  for (const k of SIGNAL_IDS) v.signals[k] = 'no';
  const r = buildLiteReport(v); assert.equal(r.status, 'requires_review'); assert.deepEqual(r.gaps, []);
  assert.equal(r.score, null); assert.equal(r.human_review.status, 'pending');
  assert.ok(r.controls.every(c => c.evidence === 'declared'));
});

test('not applicable remains distinct; all signals not applicable is an explicit gap', () => {
  const v = input(); v.controls.testing = 'not_applicable';
  for (const id of SIGNAL_IDS) v.signals[id] = 'not_applicable';
  const r = buildLiteReport(v);
  assert.equal(r.controls.find(c => c.id === 'testing').evidence, 'not_applicable');
  assert.ok(r.gaps.includes('signals.applicability')); assert.equal(r.signals.assessment.status, 'incomplete');
});

test('strict validation rejects secrets, unsupported evidence and missing consent', () => {
  for (const mutate of [
    v => { v.seed = 'secret'; }, v => { v.controls.backup = 'verified'; },
    v => { v.consents.storage = false; }, v => { v.synthetic = false; },
    v => { v.controls.secret_exposure = 'not_applicable'; }, v => { delete v.signals.urgency; },
    v => { v.profile.experience = { text: 'secret' }; },
  ]) { const v = input(); mutate(v); assert.throws(() => validateLiteReportIntake(v), /invalid_lite_intake/); }
});

test('identical inputs produce identical reports without modifying the input', () => {
  const v = input(); v.controls.permissions = 'no'; v.signals.unlimited_approval = 'yes';
  const before = structuredClone(v); assert.deepEqual(buildLiteReport(v), buildLiteReport(structuredClone(v)));
  assert.deepEqual(v, before); assert.ok(buildLiteReport(v).findings.some(f => f.id === 'control.permissions'));
});
