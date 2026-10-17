/** Real, disposable local Auth/PostgREST COFRE integration.
 * Credentials remain in memory; only fixed assertion labels enter CI output.
 */
import { randomUUID } from 'node:crypto';
import { COFRE_CONTROL_IDS } from '../../supabase/functions/advisory-api/cofre.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const fresh = value => JSON.parse(JSON.stringify(value));
export function syntheticCofreIntake() {
  return { schema_version: 'cofre-intake-0.1', synthetic: true,
    profile: { objective: 'organize', experience: 'beginner', liquidity: 'long_term', loss_capacity: 'limited' },
    consents: { assessment: true, storage: true, external_sources: false, notifications: false },
    controls: Object.fromEntries(COFRE_CONTROL_IDS.map(id => [id,
      { answer: id === 'secret_exposure' ? 'no' : id === 'recovery_tested' ? 'unknown' : 'yes',
        evidence: id === 'recovery_tested' ? 'unknown' : 'declared' }])),
    inventory: [{ category: 'vault', network: 'bitcoin', custody: 'self' }] };
}

export async function runCofreIntegration({ status, users, result, sql, pass, requireCondition, handler, origin }) {
  requireCondition(status.API_URL === 'http://127.0.0.1:54321', 'COFRE only runs against disposable local stack');
  for (const role of ['ana', 'rui', 'clientA', 'clientB', 'authorB']) {
    requireCondition(UUID.test(users[role]?.id), 'COFRE synthetic identity is a server-issued UUID');
  }
  const workspaceA = randomUUID(), workspaceB = randomUUID();
  // Only crypto/server UUIDs and constant fictitious labels enter controlled SQL.
  await sql(`begin;
insert into capital_web3_private.cofre_workspaces(id,label,staff_mfa_required) values
('${workspaceA}','COFRE synthetic primary',false),('${workspaceB}','COFRE synthetic foreign',false);
insert into capital_web3_private.cofre_workspace_members(workspace_id,user_id,display_name,member_role) values
('${workspaceA}','${users.ana.id}','Analista fictícia','analyst'),
('${workspaceA}','${users.rui.id}','Revisor fictício','reviewer'),
('${workspaceA}','${users.rui.id}','Revisor fictício','publisher'),
('${workspaceA}','${users.clientA.id}','Pessoa fictícia A','client'),
('${workspaceB}','${users.authorB.id}','Analista fictício B','analyst'),
('${workspaceB}','${users.clientB.id}','Pessoa fictícia B','client');
do $$ begin
 if has_table_privilege('authenticated','capital_web3.cofre_intakes','INSERT')
 or has_table_privilege('authenticated','capital_web3_private.cofre_workspace_members','SELECT')
 or has_column_privilege('authenticated','capital_web3.cofre_intakes','created_by','SELECT') then
 raise exception 'unexpected COFRE privileges'; end if;
end $$;
commit;`);
  pass('COFRE fixtures use isolated workspaces with no direct intake/roster write privilege', true);

  const local = async (role, path, body) => {
    requireCondition(/^\/(auth|rest)\/v1\//.test(path), 'COFRE upstream path is fixed');
    let response;
    try { response = await fetch(status.API_URL + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + users[role].token,
        ...(path.startsWith('/rest/v1/') ? { 'Accept-Profile': 'capital_web3', 'Content-Profile': 'capital_web3' } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }); } catch { requireCondition(false, 'COFRE local upstream responds'); }
    let bodyValue = null;
    if (response.status !== 204) { try { bodyValue = await response.json(); } catch { requireCondition(false, 'COFRE local upstream JSON is valid'); } }
    return { status: response.status, body: bodyValue };
  };
  const aRoster = await result('ana', '/cofre/workspaces');
  pass('COFRE staff roster contains only its active workspace', aRoster.status === 200 &&
    aRoster.body.data.length === 4 && aRoster.body.data.every(row => row.workspace_id === workspaceA) &&
    !JSON.stringify(aRoster.body.data).includes(users.clientB.id));
  const bRoster = await result('authorB', '/cofre/workspaces');
  pass('COFRE foreign staff sees only the foreign roster', bRoster.status === 200 &&
    bRoster.body.data.length === 2 && bRoster.body.data.every(row => row.workspace_id === workspaceB));
  const clientRoster = await result('clientA', '/cofre/workspaces');
  pass('COFRE client receives no staff roster', clientRoster.status === 200 && clientRoster.body.data.length === 0);

  const create = { workspace_id: workspaceA, client_user_id: users.clientA.id, idempotency_key: randomUUID() };
  pass('COFRE foreign analyst cannot create in another workspace',
    (await result('authorB', '/cofre/cases', create)).status === 404);
  pass('COFRE client cannot create its own case', (await result('clientA', '/cofre/cases', create)).status === 404);
  pass('COFRE cannot attach a foreign client to a case',
    (await result('ana', '/cofre/cases', { ...create, client_user_id: users.clientB.id })).status === 404);
  const created = await Promise.all([result('ana', '/cofre/cases', create), result('ana', '/cofre/cases', create)]);
  const caseId = created[0].body.data?.case_id;
  requireCondition(UUID.test(caseId), 'COFRE case RPC returned an actual UUID');
  pass('COFRE concurrent creation retries return one case', created.every(row => row.status === 200 && row.body.data.case_id === caseId));
  const intakePath = '/cofre/cases/' + caseId + '/intake';
  const blank = await result('ana', intakePath);
  pass('COFRE new case starts without an invented intake', blank.status === 200 && blank.body.data === null);
  const save = { intake: syntheticCofreIntake(), expected_revision: 0, idempotency_key: randomUUID() };
  const marker = 'fictional_secret_marker_do_not_echo';
  for (const mutate of [
    body => { body.intake.profile.objective = null; },
    body => { body.intake.controls.secret_exposure.answer = null; },
    body => { body.intake.inventory[0].custody = null; },
    body => { body.intake.synthetic = null; },
    body => { body.intake.seed = marker; },
    body => { body.intake.inventory[0].private_key = marker; },
    body => { body.content = { human_review: { approved: true }, summary: marker }; },
  ]) {
    const body = fresh(save); mutate(body);
    const denied = await result('ana', intakePath, body);
    pass('COFRE rejects NULL, secret or caller-authored report fields without echo',
      denied.status === 400 && !JSON.stringify(denied.body).includes(marker));
  }
  pass('COFRE foreign staff cannot save an assigned intake', (await result('authorB', intakePath, save)).status === 404);
  pass('COFRE reviewer cannot impersonate the analyst', (await result('rui', intakePath, save)).status === 404);
  const initial = await result('ana', intakePath, save);
  const versionId = initial.body.data?.report_version_id;
  requireCondition(initial.status === 200 && initial.body.data?.revision === 1 && UUID.test(versionId), 'COFRE server generated first draft');
  const retry = await result('ana', intakePath, save);
  pass('COFRE same save retry returns the exact immutable revision', retry.status === 200 &&
    retry.body.data.report_version_id === versionId && retry.body.data.revision === 1);
  const changed = fresh(save); changed.intake.profile.objective = 'protect_family';
  pass('COFRE changed payload cannot reuse its saved idempotency key', (await result('ana', intakePath, changed)).status === 409);
  const concurrent = ['protect_family', 'learn_defi'].map(objective => {
    const body = fresh(save); body.expected_revision = 1; body.idempotency_key = randomUUID(); body.intake.profile.objective = objective; return body;
  });
  const raced = await Promise.all(concurrent.map(body => result('ana', intakePath, body)));
  pass('COFRE concurrent different writes yield one new revision and one conflict',
    raced.filter(row => row.status === 200 && row.body.data?.revision === 2).length === 1 && raced.filter(row => row.status === 409).length === 1);
  const newerVersion = raced.find(row => row.status === 200).body.data.report_version_id;
  const persisted = await result('ana', intakePath);
  pass('COFRE intake read returns the persisted latest revision', persisted.status === 200 &&
    persisted.body.data.revision === 2 && persisted.body.data.report_version_id === newerVersion);
  const clientIntake = await result('clientA', intakePath), foreignIntake = await result('authorB', intakePath);
  pass('COFRE raw answers stay hidden from clients and foreign staff',
    clientIntake.status === 200 && clientIntake.body.data === null && foreignIntake.status === 200 && foreignIntake.body.data === null);
  const directIntakes = await local('clientA', '/rest/v1/cofre_intakes?select=case_id,revision,intake&case_id=eq.' + caseId);
  pass('COFRE direct Data API does not bypass intake RLS', directIntakes.status === 200 && directIntakes.body.length === 0);
  const directInsert = await local('ana', '/rest/v1/cofre_intakes', { case_id: caseId, revision: 99, intake: save.intake, report_version_id: randomUUID(), created_by: users.ana.id });
  pass('COFRE direct Data API cannot insert an intake', directInsert.status === 403 && directInsert.body.code === '42501');
  const creator = await local('ana', '/rest/v1/advisory_report_versions?select=created_by&id=eq.' + versionId);
  pass('COFRE direct report projection cannot expose the staff creator column', creator.status === 403 && creator.body.code === '42501');

  const path = '/reports/' + versionId;
  pass('COFRE draft is unreadable by its assigned client', (await result('clientA', path)).status === 404);
  const observed = await result('rui', path + '/review-package');
  const pkg = observed.body.data;
  requireCondition(observed.status === 200 && SHA.test(pkg?.content_sha256) && SHA.test(pkg?.manifest_sha256), 'COFRE reviewer package has actual digests');
  pass('COFRE server report is synthetic and remains pending human review', pkg.content.report_kind === 'cofre_individual' &&
    pkg.content.mode === 'synthetic' && pkg.content.human_review.approved === false && pkg.content.human_review.status === 'pending' && pkg.assets.length === 0);
  const digests = { expected_content_sha256: pkg.content_sha256, expected_manifest_sha256: pkg.manifest_sha256 };
  const review = { decision: 'approved', ...digests, private_notes: 'Synthetic COFRE independent review', idempotency_key: randomUUID() };
  pass('COFRE author cannot approve its own report', (await result('ana', path + '/review', review)).status === 404);
  pass('COFRE foreign staff cannot open its review package', (await result('authorB', path + '/review-package')).status === 404);
  pass('COFRE stale content hash cannot be approved',
    (await result('rui', path + '/review', { ...review, expected_content_sha256: '0'.repeat(64) })).status === 409);
  const approved = await result('rui', path + '/review', review);
  pass('COFRE independent reviewer approves the exact observed draft', approved.status === 200 && UUID.test(approved.body.data?.review_id));
  const publish = { ...digests, recipient_user_ids: [users.clientA.id], expires_at: null, idempotency_key: randomUUID() };
  pass('COFRE author cannot publish its own report', (await result('ana', path + '/publish', publish)).status === 404);
  pass('COFRE approved hash cannot be transplanted onto a different version',
    (await result('rui', '/reports/' + newerVersion + '/publish', publish)).status === 409);
  const publication = await result('rui', path + '/publish', publish);
  const publicationId = publication.body.data?.publication_id;
  pass('COFRE exact approved draft is published only to its chosen recipient', publication.status === 200 && UUID.test(publicationId));
  const visible = await result('clientA', '/reports');
  pass('COFRE client sees the published version and no newer unreviewed draft', visible.status === 200 &&
    visible.body.data.some(row => row.id === versionId) && !visible.body.data.some(row => row.id === newerVersion));
  const clientReport = await result('clientA', path);
  pass('COFRE published report is legible structured content for its client', clientReport.status === 200 &&
    clientReport.body.data.content.report_kind === 'cofre_individual' && Array.isArray(clientReport.body.data.content.plan));
  pass('COFRE foreign client cannot read the published report', (await result('clientB', path)).status === 404);
  const receipts = await Promise.all([result('clientA', '/publications/' + publicationId + '/receipt', {}),
    result('clientA', '/publications/' + publicationId + '/receipt', {})]);
  pass('COFRE receipt retries identify one acknowledgement', receipts.every(row => row.status === 200) &&
    receipts[0].body.data.receipt_id === receipts[1].body.data.receipt_id);
  await sql(`update capital_web3.advisory_case_clients set active=false where case_id='${caseId}' and user_id='${users.clientA.id}';`);
  pass('COFRE removed case assignment immediately blocks a previously published report', (await result('clientA', path)).status === 404);
  await sql(`update capital_web3.advisory_case_clients set active=true where case_id='${caseId}' and user_id='${users.clientA.id}';`);
  pass('COFRE restored assignment uses the same reviewed publication', (await result('clientA', path)).status === 200);
  const revoked = await result('rui', '/publications/' + publicationId + '/revoke', {
    ...digests, recipient_user_id: null, reason: 'Synthetic COFRE revocation', idempotency_key: randomUUID(),
  });
  pass('COFRE publication revocation denies report, download and receipt retry', revoked.status === 200 &&
    (await result('clientA', path)).status === 404 && (await result('clientA', path + '/download')).status === 404 &&
    (await result('clientA', '/publications/' + publicationId + '/receipt', {})).status === 404);

  if (process.env.CAPITAL_STAGING_BROWSER === '1') {
    const { runCofreBrowser } = await import('../browser/cofre_supabase.mjs');
    await runCofreBrowser({ status, users, workspaceA, handler, origin });
  }
  pass('COFRE staff can still review a revoked delivery before session logout', (await result('rui', path + '/review-package')).status === 200);
  const logout = await local('rui', '/auth/v1/logout?scope=local', {});
  pass('COFRE real Auth logout terminates the session', logout.status === 204);
  const oldPackage = await result('rui', path + '/review-package'), oldRead = await result('rui', path);
  pass('COFRE old JWT cannot read a report or review package after logout',
    [401, 404].includes(oldPackage.status) && [401, 404].includes(oldRead.status));
  const oldDirect = await local('rui', '/rest/v1/advisory_report_versions?select=id,content&id=eq.' + versionId);
  pass('COFRE direct PostgREST rechecks the revoked session behind its old JWT',
    [401, 403].includes(oldDirect.status) || oldDirect.status === 200 && oldDirect.body.length === 0);
  return { workspaceA, workspaceB, caseId, versionId, newerVersion, publicationId };
}
