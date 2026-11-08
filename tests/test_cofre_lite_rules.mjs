import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIGNAL_IDS, ROUTINE_TASK_IDS, LITE_SHEET_SCORE_KEYS, LITE_DOCUMENT_SCORE_KEYS,
  assessSignals, assessRoutine, assessCandidateScore } from '../supabase/functions/advisory-api/cofre-lite-rules.ts';
const signals = value => Object.fromEntries(SIGNAL_IDS.map(id => [id, value]));
const routine = (a='applicable', d='due', state='unknown') => Object.fromEntries(ROUTINE_TASK_IDS.map(id => [id, { applicability:a, due:d, state }]));
const sheet = value => Object.fromEntries(LITE_SHEET_SCORE_KEYS.map(id => [id, value]));
const doc = value => Object.fromEntries(LITE_DOCUMENT_SCORE_KEYS.map(id => [id, value]));

test('unanswered anti-fraud cannot give a favorable verdict', () => {
  const r = assessSignals(signals('unknown')); assert.equal(r.status, 'incomplete'); assert.equal(r.unknown, 10); assert.equal(r.safety_guarantee, false);
  assert.equal(assessSignals(signals('not_applicable')).status, 'incomplete');
  assert.equal(assessSignals(signals('no')).status, 'no_signal_reported');
});
test('critical overrides unknown and noncritical flags, and three noncritical pause', () => {
  const a = signals('unknown'); a.secret_request = 'yes'; assert.equal(assessSignals(a).status, 'blocked');
  const b = signals('no'); b.urgency = 'yes'; assert.equal(assessSignals(b).status, 'review_signals');
  b.unlimited_approval = 'yes'; b.unclear_tokenomics = 'yes'; assert.equal(assessSignals(b).status, 'pause_and_investigate');
  for (const critical of ['guaranteed_return','unsolicited_link','different_domain','secret_request']) { const c=signals('unknown');c[critical]='yes';assert.equal(assessSignals(c).status,'blocked'); }
});
test('routine coverage includes due unanswered tasks and does not silently drop unknown applicability or due dates', () => {
  const a=routine(); a.wallet_roles.state='done'; const r=assessRoutine(a); assert.equal(r.coverage,1/9); assert.equal(r.unassessed,8); assert.equal(r.complete,false);
  a.vault_dapp.applicability='unknown'; assert.equal(assessRoutine(a).coverage,null);
  a.vault_dapp.applicability='applicable'; a.vault_dapp.due='unknown'; assert.equal(assessRoutine(a).coverage,null);
  assert.equal(assessRoutine(routine('not_applicable')).coverage,null);
  assert.equal(assessRoutine(routine('applicable','due','done')).coverage,1);
});
test('source models remain explicit and partial does not become a score', () => {
  const a=sheet('unknown'); a.separation='yes'; const r=assessCandidateScore('lite_sheet_10_v1',a,'no');assert.equal(r.candidate_score,null);assert.equal(r.assessed,1);assert.equal(r.points_observed,10);
  assert.equal(assessCandidateScore('lite_sheet_10_v1',sheet('yes'),'no').candidate_score,100);
  const b=doc('unknown');b.backup=10;assert.equal(assessCandidateScore('lite_document_6_v1',b,'no').candidate_score,null);
  const c={wallet_separation:20,backup:20,permissions:15,verification:15,antifraud:15,routine:15};
  assert.equal(assessCandidateScore('lite_document_6_v1',c,'no').candidate_score,100);
  assert.equal(assessCandidateScore('lite_document_6_v1',c,'yes').status,'blocked');
  assert.equal(assessCandidateScore('lite_document_6_v1',c,'yes').candidate_score,null);
  assert.equal(assessCandidateScore('lite_document_6_v1',c,'unknown').candidate_score,null);
});
test('closed contracts reject omitted, invented, malformed, accessor and cross-model answers without echoing input', () => {
  const checks=[() => assessSignals({...signals('no'),seed:'sensitive'}), () => assessSignals({}),
    () => assessRoutine({...routine(),extra:'sensitive'}), () => assessCandidateScore('unknown',sheet('yes'),'no'),
    () => assessCandidateScore('lite_sheet_10_v1',doc(0),'no'), () => assessCandidateScore('lite_document_6_v1',{...doc(0),backup:99},'no')];
  const b=signals('no'); Object.defineProperty(b,'urgency',{get(){throw Error('getter invoked')},enumerable:true}); checks.push(()=>assessSignals(b));
  for(const c of checks) assert.throws(c,/invalid_lite_input/);
});
