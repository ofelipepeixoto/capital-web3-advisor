/** Real, disposable local Auth/PostgREST COFRE integration.
 * Credentials remain in memory; only fixed assertion labels enter CI output.
 */
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { COFRE_CONTROL_IDS } from '../../supabase/functions/advisory-api/cofre.ts';
import { SIGNAL_IDS } from '../../supabase/functions/advisory-api/cofre-lite-rules.ts';

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
update capital_web3_private.cofre_partial_limits set partial_enabled=true where singleton=true;
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
 or has_table_privilege('authenticated','capital_web3_private.cofre_partial_intakes','SELECT')
 or has_table_privilege('authenticated','capital_web3_private.cofre_partial_intakes','INSERT')
 or has_table_privilege('authenticated','capital_web3_private.cofre_lite_signals','SELECT')
 or has_table_privilege('authenticated','capital_web3_private.cofre_lite_signals','INSERT')
 or has_table_privilege('authenticated','capital_web3_private.cofre_lite_signal_receipts','SELECT')
 or has_table_privilege('authenticated','capital_web3_private.cofre_partial_receipts','SELECT')
 or has_table_privilege('authenticated','capital_web3_private.cofre_partial_receipts','INSERT')
 or has_table_privilege('authenticated','capital_web3_private.cofre_partial_limits','UPDATE')
 or exists(select 1 from information_schema.columns where table_schema='capital_web3_private' and table_name='cofre_partial_receipts' and column_name='request')
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
  const journeyCatalog = await result('ana', '/cofre/journeys');
  pass('journey catalog available to staff only', journeyCatalog.status === 200 &&
    (await result('clientA', '/cofre/journeys')).status === 404);
  const journey = journeyCatalog.body.data.find(row => row.id === 'rastro');
  requireCondition(Array.isArray(journey?.stages), 'synthetic RASTRO stages available');
  const journeyInput = {schema_version:'journey-intake-0.1', synthetic:true, journey:'rastro',
    responses:Object.fromEntries(journey.stages.map(id => [id,{state:'not_assessed',evidence:'none'}]))};
  pass('journey preview denies client and returns incomplete to staff',
    (await result('clientA', '/cofre/journeys/preview', journeyInput)).status === 404 &&
    (await result('ana', '/cofre/journeys/preview', journeyInput)).body.data.status === 'needs_input');

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
  const litePath = '/cofre/cases/' + caseId + '/lite-signals';
  const liteDraft = {schema_version:'cofre-lite-signals-0.1', synthetic:true, consents:{assessment:true,storage:true},
    signals:Object.fromEntries(SIGNAL_IDS.map(id=>[id,'unknown']))};
  const liteSave = {intake:liteDraft,expected_revision:0,idempotency_key:randomUUID()};
  const directLite = {p_case_id:caseId,p_intake:liteDraft,p_expected_revision:0,p_idempotency_key:randomUUID()};
  pass('Lite 0.2 direct read default-off is denied', (await local('ana','/rest/v1/rpc/advisory_lite_intake_get',{p_case_id:caseId})).status===403);
  const offGet=await local('ana','/rest/v1/rpc/advisory_lite_signals_get',{p_case_id:caseId});
  const offSave=await local('ana','/rest/v1/rpc/advisory_lite_signals_save',directLite);
  pass('Lite default-off denies direct PostgREST read and write',offGet.status===403 && offSave.status===403);
  await sql(`insert into capital_web3_private.cofre_lite_features(workspace_id,enabled) values('${workspaceA}',true);`);
  const onGet=await local('ana','/rest/v1/rpc/advisory_lite_signals_get',{p_case_id:caseId});
  pass('Lite explicit workspace enable permits assigned analyst direct read',onGet.status===200 && onGet.body===null);
  pass('Lite denies client and foreign analyst', (await result('clientA',litePath,liteSave)).status===404 && (await result('authorB',litePath,liteSave)).status===404);
  const liteNoConsent=fresh(liteSave);liteNoConsent.intake.consents.storage=false;
  pass('Lite rejects absent consent before persistence', (await result('ana',litePath,liteNoConsent)).status===400);
  const liteSecret=fresh(liteSave);liteSecret.intake.seed='synthetic-secret-marker';
  const deniedSecret=await result('ana',litePath,liteSecret);
  pass('Lite rejects extra secret fields without echo', deniedSecret.status===400 && !JSON.stringify(deniedSecret.body).includes('synthetic-secret-marker'));
  const retryLite=await Promise.all([result('ana',litePath,liteSave),result('ana',litePath,liteSave)]);
  pass('Lite same key retry is idempotent', retryLite.every(r=>r.status===200 && r.body.data.revision===1));
  const liteA=fresh(liteSave); liteA.expected_revision=1; liteA.idempotency_key=randomUUID(); liteA.intake.signals.urgency='yes';
  const liteB=fresh(liteSave); liteB.expected_revision=1; liteB.idempotency_key=randomUUID(); liteB.intake.signals.secret_request='yes';
  const liteRace=await Promise.all([result('ana',litePath,liteA),result('ana',litePath,liteB)]);
  pass('Lite concurrent writes yield one revision and one conflict',liteRace.map(r=>r.status).sort().join(',')==='200,409');
  const liteRead=await result('ana',litePath);
  pass('Lite resumes latest case-bound signals',liteRead.status===200 && liteRead.body.data.revision===2 && liteRead.body.data.intake.signals.guaranteed_return==='unknown');
  pass('Lite hides raw signals from client and foreign staff', (await result('clientA',litePath)).status===404 && (await result('authorB',litePath)).status===404);
  // A write holding the feature's shared row lock must finish before an operator
  // can commit disabling it. Actual local psql sessions; no credentials logged.
  const claims = JSON.parse(Buffer.from(users.ana.token.split('.')[1], 'base64url').toString('utf8'));
  requireCondition(UUID.test(claims.session_id), 'Lite lock test session UUID is valid');
  const db = new URL(status.DB_URL);
  requireCondition(db.hostname === '127.0.0.1' && db.port === '54322', 'Lite lock test only uses disposable database');
  const pgEnv = { ...process.env, PGHOST:'127.0.0.1', PGPORT:'54322', PGDATABASE:'postgres', PGUSER:'postgres',
    PGPASSWORD:decodeURIComponent(db.password), PGCONNECT_TIMEOUT:'10' };
  const holder = spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:pgEnv,stdio:['pipe','pipe','pipe']});
  const finished = new Promise((resolve,reject) => { holder.on('error',reject); holder.on('close',code=>resolve(code)); });
  const ready = new Promise((resolve,reject) => {
    let output=''; const timeout=setTimeout(()=>reject(Error('Lite lock holder did not start')),10000);
    holder.stdout.on('data',chunk=>{ output+=chunk.toString(); if(output.includes('LITE_LOCK_READY')) {clearTimeout(timeout);resolve();} });
    holder.on('error',error=>{clearTimeout(timeout);reject(error);});
    holder.on('close',()=>{clearTimeout(timeout);if(!output.includes('LITE_LOCK_READY'))reject(Error('Lite lock holder stopped'));});
  });
  holder.stdin.end(`begin; set local role authenticated;
select set_config('request.jwt.claims','${JSON.stringify({sub:users.ana.id,role:'authenticated',session_id:claims.session_id,aal:'aal1',is_anonymous:false})}',true);
select capital_web3.advisory_lite_signals_save('${caseId}','${JSON.stringify(liteDraft)}'::jsonb,2,'${randomUUID()}');
reset role;
\\echo LITE_LOCK_READY
select pg_sleep(8); commit;`);
  try {
    await ready;
    const toggle = spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:5000,
      input:`begin; set local lock_timeout='500ms'; update capital_web3_private.cofre_lite_features set enabled=false where workspace_id='${workspaceA}'; commit;`});
    pass('Lite disable cannot commit before an in-flight write completes',toggle.status!==0 && /lock timeout/i.test(toggle.stderr));
    for (const [name, statement] of [
      ['membership', `update capital_web3_private.cofre_workspace_members set active=false where workspace_id='${workspaceA}' and user_id='${users.ana.id}' and member_role='analyst'`],
      ['assignment', `update capital_web3.advisory_case_staff set active=false where case_id='${caseId}' and user_id='${users.ana.id}' and staff_role='analyst'`],
      ['session', `delete from auth.sessions where id='${claims.session_id}'`],
    ]) {
      const revoke=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:5000,
        input:`begin; set local lock_timeout='500ms'; ${statement}; commit;`});
      pass(`Lite ${name} revocation cannot commit before in-flight write`,revoke.status!==0 && /lock timeout/i.test(revoke.stderr));
    }
    requireCondition(await finished === 0, 'Lite lock holder commits');
  } finally { if (holder.exitCode === null) holder.kill(); }
  // A smaller operator capacity blocks only new receipts; safe replay succeeds.
  await sql(`update capital_web3_private.cofre_lite_receipt_policy set max_receipts_per_actor=1, minimum_retention_days=30 where singleton=true;`);
  const quotaReplay=await result('ana',litePath,liteSave);
  const quotaNew=await result('ana',litePath,{...liteSave,expected_revision:3,idempotency_key:randomUUID()});
  pass('Lite capacity preserves same-key replay and rejects new writes',quotaReplay.status===200 && quotaReplay.body.data.revision===1 && quotaNew.status===429);
  await sql(`update capital_web3_private.cofre_lite_receipt_policy set max_receipts_per_actor=128, minimum_retention_days=30 where singleton=true;`);
  const retentionKey=randomUUID();
  const retentionWrite=await result('ana',litePath,{...liteSave,expected_revision:3,idempotency_key:retentionKey});
  pass('Lite configured retention records a new receipt',retentionWrite.status===200 && retentionWrite.body.data.revision===4);
  const retentionQuery=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:3000,
    input:`select (retain_until-created_at >= interval '30 days')::text from capital_web3_private.cofre_lite_signal_receipts where actor='${users.ana.id}' and key='${retentionKey}';`});
  pass('Lite minimum retention is recorded without a cleanup job',retentionQuery.status===0 && retentionQuery.stdout.trim()==='true');
  await sql(`update capital_web3_private.cofre_lite_features set enabled=false where workspace_id='${workspaceA}';`);
  pass('Lite confirmed disable denies new direct reads', (await local('ana','/rest/v1/rpc/advisory_lite_signals_get',{p_case_id:caseId})).status===403);
  await sql(`update capital_web3_private.cofre_lite_features set enabled=true where workspace_id='${workspaceA}';`);
  // Block the case row, wait until the authenticated writer is queued, revoke
  // analyst membership, and then release the row. No credentials are logged.
  const caseHolder = spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:pgEnv,stdio:['pipe','pipe','pipe']});
  const caseDone = new Promise((resolve,reject)=>{caseHolder.on('error',reject);caseHolder.on('close',code=>resolve(code));});
  const caseReady = new Promise((resolve,reject)=>{
    let output='';const timeout=setTimeout(()=>reject(Error('case lock did not start')),10000);
    caseHolder.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('CASE_LOCK_READY')){clearTimeout(timeout);resolve();}});
    caseHolder.on('error',error=>{clearTimeout(timeout);reject(error);});
    caseHolder.on('close',()=>{clearTimeout(timeout);if(!output.includes('CASE_LOCK_READY'))reject(Error('case lock stopped'));});
  });
  caseHolder.stdin.write(`begin; select id from capital_web3.advisory_cases where id='${caseId}' for update;\n\\echo CASE_LOCK_READY\n`);
  try {
    await caseReady;
    const waitingSave={intake:liteDraft,expected_revision:4,idempotency_key:randomUUID()};
    const delayed = result('ana',litePath,waitingSave);
    let waiting=false;
    for (let n=0;n<40 && !waiting;n++) {
      await new Promise(resolve=>setTimeout(resolve,100));
      const check = spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:3000,
        input:"select count(*) from pg_stat_activity where wait_event_type='Lock' and query ilike '%advisory_lite_signals_save%';"});
      requireCondition(check.status===0,'Lite lock waiter query succeeds');
      waiting=Number(check.stdout.trim())>0;
    }
    requireCondition(waiting,'Lite write is waiting for case lock before revocation');
    await sql(`update capital_web3_private.cofre_workspace_members set active=false where workspace_id='${workspaceA}' and user_id='${users.ana.id}' and member_role='analyst';`);
    caseHolder.stdin.end('commit;\n');
    requireCondition(await caseDone===0,'case lock transaction committed');
    pass('Lite rechecks analyst membership after waiting for the case lock',(await delayed).status===404);
  } finally { if(caseHolder.exitCode===null)caseHolder.kill(); }
  await sql(`update capital_web3_private.cofre_workspace_members set active=true where workspace_id='${workspaceA}' and user_id='${users.ana.id}' and member_role='analyst';`);
  await sql(`update capital_web3.advisory_case_staff set active=false where case_id='${caseId}' and user_id='${users.ana.id}' and staff_role='analyst';`);
  pass('Lite denies a write started after assignment revocation', (await result('ana',litePath,{...liteSave,expected_revision:4,idempotency_key:randomUUID()})).status===404);
  await sql(`update capital_web3.advisory_case_staff set active=true where case_id='${caseId}' and user_id='${users.ana.id}' and staff_role='analyst';`);

  // V0.2 does not overwrite earlier signals; migration requires explicit acknowledgment.
  const v02Path='/cofre/cases/'+caseId+'/lite-intake';
  const controlIds=['backup','vault','apps','spending','testing','watch','recovery','secret_exposure','source','permissions','payload','routine'];
  const draft02={schema_version:'cofre-lite-intake-0.2',synthetic:true,consents:{assessment:true,storage:true},profile:{experience:'unknown'},controls:Object.fromEntries(controlIds.map(id=>[id,'unknown'])),signals:Object.fromEntries(SIGNAL_IDS.map(id=>[id,'unknown']))};
  const legacyMarker=await result('ana',v02Path);
  pass('Lite 0.2 detects earlier signals without importing them',legacyMarker.status===200 && legacyMarker.body.data.legacy_available===true && legacyMarker.body.data.legacy_revision===4);
  const save02={intake:draft02,expected_revision:0,idempotency_key:randomUUID(),legacy_revision:null};
  pass('Lite 0.2 requires explicit acknowledgment of existing signals',(await result('ana',v02Path,save02)).status===409);
  const invalid02=fresh(save02);invalid02.intake.profile.experience=null;
  pass('Lite 0.2 rejects missing profile and denies direct invalid input', (await result('ana',v02Path,invalid02)).status===400 &&
    (await local('ana','/rest/v1/rpc/advisory_lite_intake_save',{p_case_id:caseId,p_intake:invalid02.intake,p_expected_revision:0,p_idempotency_key:randomUUID(),p_legacy_revision:4})).status===400);
  pass('Lite 0.2 denies client and foreign analyst',(await result('clientA',v02Path)).status===404 && (await result('authorB',v02Path)).status===404);
  save02.legacy_revision=4;
  const retry02=await Promise.all([result('ana',v02Path,save02),result('ana',v02Path,save02)]);
  pass('Lite 0.2 consented explicit transition retries safely',retry02.every(r=>r.status===200 && r.body.data.revision===1));
  const read02=await result('ana',v02Path), old01=await result('ana',litePath);
  pass('Lite 0.2 retains unknown and legacy signals are never overwritten',read02.status===200 && read02.body.data.intake.controls.vault==='unknown' && old01.status===200 && old01.body.data.revision===4);
  const staleLegacy={...liteSave,expected_revision:4,idempotency_key:randomUUID()};
  pass('Lite legacy is read-only after transition; exact old retries still work',(await result('ana',litePath,staleLegacy)).status===409 && (await result('ana',litePath,liteSave)).body.data.revision===1);
  const second02={...save02,expected_revision:1,legacy_revision:null,idempotency_key:randomUUID()};
  const rival02=fresh(second02);rival02.idempotency_key=randomUUID();rival02.intake.controls.backup='yes';
  const race02=await Promise.all([result('ana',v02Path,second02),result('ana',v02Path,rival02)]);
  pass('Lite 0.2 simultaneous edits have one conflict',race02.map(r=>r.status).sort().join(',')==='200,409');
  const liteReportPath='/cofre/cases/'+caseId+'/lite-report';
  const reportRequest={expected_revision:2,idempotency_key:randomUUID()};
  pass('Lite report endpoint rejects client and foreign analyst',
    (await result('clientA',liteReportPath,reportRequest)).status===404 && (await result('authorB',liteReportPath,reportRequest)).status===404);
  pass('Lite report endpoint rejects forged content',
    (await result('ana',liteReportPath,{...reportRequest,content:{status:'approved'}})).status===400);
  const reportRetry=await Promise.all([result('ana',liteReportPath,reportRequest),result('ana',liteReportPath,reportRequest)]);
  const liteReportVersion=reportRetry[0].body.data?.report_version_id;
  pass('Lite report endpoint retries return one server-generated version',
    reportRetry.every(r=>r.status===200 && r.body.data.intake_revision===2 && r.body.data.report_version_id===liteReportVersion) && UUID.test(liteReportVersion));
  pass('Lite report endpoint rejects stale revision',
    (await result('ana',liteReportPath,{expected_revision:1,idempotency_key:randomUUID()})).status===409);
  // An old tab and an explicit migration cannot commit conflicting sources.
  const otherCreated=await result('ana','/cofre/cases',{...create,idempotency_key:randomUUID()});
  const migrationCase=otherCreated.body.data?.case_id;
  requireCondition(UUID.test(migrationCase),'transition race case exists');
  const oldPath='/cofre/cases/'+migrationCase+'/lite-signals', newPath='/cofre/cases/'+migrationCase+'/lite-intake';
  const baselineLegacy={intake:liteDraft,expected_revision:0,idempotency_key:randomUUID()};
  requireCondition((await result('ana',oldPath,baselineLegacy)).status===200,'transition race has initial legacy signals');
  const legacyUpdate={intake:{...liteDraft,signals:{...liteDraft.signals,urgency:'yes'}},expected_revision:1,idempotency_key:randomUUID()};
  const newIntake={intake:draft02,expected_revision:0,idempotency_key:randomUUID(),legacy_revision:1};
  const transition=await Promise.all([result('ana',oldPath,legacyUpdate),result('ana',newPath,newIntake)]);
  pass('Lite concurrent legacy write and transition never both commit',transition.map(r=>r.status).sort().join(',')==='200,409');
  const checkTransition=await result('ana',newPath);
  pass('Lite transition race leaves visible version or updated legacy marker',checkTransition.status===200 &&
    (transition[1].status===200 ? checkTransition.body.data.revision===1 : checkTransition.body.data.legacy_revision===2));


  // Lite release gates, actual disposable Auth/PostgREST and two PostgreSQL sessions.
  const releaseCreated=await result('ana','/cofre/cases',{...create,idempotency_key:randomUUID()});
  const releaseCase=releaseCreated.body.data?.case_id;
  requireCondition(UUID.test(releaseCase),'Lite release case created');
  const releaseIntake=fresh(draft02); releaseIntake.profile.experience='beginner';
  for (const id of controlIds) releaseIntake.controls[id]=id==='secret_exposure'?'no':'yes';
  for (const id of SIGNAL_IDS) releaseIntake.signals[id]='no';
  const releasePath='/cofre/cases/'+releaseCase+'/lite-intake';
  const releaseSaved=await result('ana',releasePath,{intake:releaseIntake,expected_revision:0,legacy_revision:null,idempotency_key:randomUUID()});
  requireCondition(releaseSaved.status===200,'Lite release fixture saved');
  const generated=await local('ana','/rest/v1/rpc/advisory_lite_create_draft',{p_case_id:releaseCase,p_expected_revision:1,p_idempotency_key:randomUUID()});
  const releaseVersion=generated.body?.report_version_id;
  requireCondition(generated.status===200 && UUID.test(releaseVersion),'Lite canonical draft generated');
  const releasePkgResponse=await result('rui','/reports/'+releaseVersion+'/review-package');
  const releasePkg=releasePkgResponse.body.data;
  requireCondition(releasePkgResponse.status===200 && SHA.test(releasePkg?.content_sha256) && SHA.test(releasePkg?.manifest_sha256),'Lite review package available');
  const reviewArgs={p_report_version_id:releaseVersion,p_decision:'approved',p_expected_content_sha256:releasePkg.content_sha256,p_expected_manifest_sha256:releasePkg.manifest_sha256,p_private_notes:'',p_idempotency_key:randomUUID()};
  const publishArgs={p_report_version_id:releaseVersion,p_recipient_user_ids:[users.clientA.id],p_expected_content_sha256:releasePkg.content_sha256,p_expected_manifest_sha256:releasePkg.manifest_sha256,p_expires_at:null,p_idempotency_key:randomUUID()};
  pass('Lite direct review denies author and foreign staff',
    [401,403,404].includes((await local('ana','/rest/v1/rpc/advisory_review_report',reviewArgs)).status) &&
    [401,403,404].includes((await local('authorB','/rest/v1/rpc/advisory_review_report',reviewArgs)).status));
  pass('Lite unguarded review and publish are not callable directly',
    [401,403,404].includes((await local('rui','/rest/v1/rpc/advisory_review_report_unguarded',reviewArgs)).status) &&
    [401,403,404].includes((await local('rui','/rest/v1/rpc/advisory_publish_report_unguarded',publishArgs)).status));
  pass('Lite unpublished draft is invisible to its client',(await result('clientA','/reports/'+releaseVersion)).status===404);
  const reviewerClaims=JSON.parse(Buffer.from(users.rui.token.split('.')[1],'base64url').toString('utf8'));
  requireCondition(UUID.test(reviewerClaims.session_id),'Lite reviewer session is valid');
  async function holdSql(sqlText, marker) {
    const proc=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:pgEnv,stdio:['pipe','pipe','pipe']});
    const done=new Promise((resolve,reject)=>{proc.on('error',reject);proc.on('close',resolve);});
    const ready=new Promise((resolve,reject)=>{let output=''; const timer=setTimeout(()=>reject(Error('release lock did not start')),10000);
      proc.stdout.on('data',c=>{output+=c.toString();if(output.includes(marker)){clearTimeout(timer);resolve();}});
      proc.on('error',e=>{clearTimeout(timer);reject(e);});proc.on('close',()=>{clearTimeout(timer);if(!output.includes(marker))reject(Error('release lock failed'));});});
    proc.stdin.write(sqlText+'\n\\echo '+marker+'\n'); await ready; return {proc,done};
  }
  const ruiJwt=JSON.stringify({sub:users.rui.id,role:'authenticated',session_id:reviewerClaims.session_id,aal:'aal1',is_anonymous:false});
  const reviewHolder=await holdSql(`begin; set local role authenticated; select set_config('request.jwt.claims','${ruiJwt}',true);
    select capital_web3.advisory_review_report('${releaseVersion}','approved','${releasePkg.content_sha256}','${releasePkg.manifest_sha256}','','${reviewArgs.p_idempotency_key}'); reset role;`, 'REVIEW_HELD');
  try {
    for (const [label,statement] of [
      ['case',`update capital_web3.advisory_cases set client_safe_title=client_safe_title where id='${releaseCase}'`],
      ['feature',`update capital_web3_private.cofre_lite_features set enabled=false where workspace_id='${workspaceA}'`],
      ['reviewer membership',`update capital_web3_private.cofre_workspace_members set active=false where workspace_id='${workspaceA}' and user_id='${users.rui.id}' and member_role='reviewer'`],
      ['reviewer assignment',`update capital_web3.advisory_case_staff set active=false where case_id='${releaseCase}' and user_id='${users.rui.id}' and staff_role='reviewer'`],
      ['reviewer session',`delete from auth.sessions where id='${reviewerClaims.session_id}'`],
    ]) {
      const attempt=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:5000,input:`begin; set local lock_timeout='350ms'; ${statement}; commit;`});
      pass('Lite review serializes '+label,attempt.status!==0 && /lock timeout/i.test(attempt.stderr));
    }
    reviewHolder.proc.stdin.end('commit;\n'); requireCondition(await reviewHolder.done===0,'Lite review transaction commits');
  } finally { if(reviewHolder.proc.exitCode===null)reviewHolder.proc.kill(); }
  const unapprovedRecipient=await local('rui','/rest/v1/rpc/advisory_publish_report',{...publishArgs,p_recipient_user_ids:[users.clientB.id],p_idempotency_key:randomUUID()});
  pass('Lite publication denies unrelated client', [401,403,404].includes(unapprovedRecipient.status));
  const ownPublication=await local('ana','/rest/v1/rpc/advisory_publish_report',{...publishArgs,p_idempotency_key:randomUUID()});
  pass('Lite author cannot publish own report',[401,403,404].includes(ownPublication.status));
  const publishHolder=await holdSql(`begin; set local role authenticated; select set_config('request.jwt.claims','${ruiJwt}',true);
    select capital_web3.advisory_publish_report('${releaseVersion}',array['${users.clientA.id}'::uuid],'${releasePkg.content_sha256}','${releasePkg.manifest_sha256}',null,'${publishArgs.p_idempotency_key}'); reset role;`, 'PUBLISH_HELD');
  try {
    for (const [label,statement] of [
      ['case',`update capital_web3.advisory_cases set client_safe_title=client_safe_title where id='${releaseCase}'`],
      ['feature',`update capital_web3_private.cofre_lite_features set enabled=false where workspace_id='${workspaceA}'`],
      ['publisher membership',`update capital_web3_private.cofre_workspace_members set active=false where workspace_id='${workspaceA}' and user_id='${users.rui.id}' and member_role='publisher'`],
      ['publisher assignment',`update capital_web3.advisory_case_staff set active=false where case_id='${releaseCase}' and user_id='${users.rui.id}' and staff_role='publisher'`],
      ['publisher session',`delete from auth.sessions where id='${reviewerClaims.session_id}'`],
      ['recipient membership',`update capital_web3_private.cofre_workspace_members set active=false where workspace_id='${workspaceA}' and user_id='${users.clientA.id}' and member_role='client'`],
      ['recipient assignment',`update capital_web3.advisory_case_clients set active=false where case_id='${releaseCase}' and user_id='${users.clientA.id}'`],
    ]) {
      const attempt=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:5000,input:`begin; set local lock_timeout='350ms'; ${statement}; commit;`});
      pass('Lite publication serializes '+label,attempt.status!==0 && /lock timeout/i.test(attempt.stderr));
    }
    publishHolder.proc.stdin.end('commit;\n'); requireCondition(await publishHolder.done===0,'Lite publication transaction commits');
  } finally {if(publishHolder.proc.exitCode===null)publishHolder.proc.kill();}
  const litePublication=await local('rui','/rest/v1/rpc/advisory_publish_report',publishArgs);
  const litePublicationId=litePublication.body?.publication_id;
  pass('Lite current approved version is published and replayed idempotently',litePublication.status===200 && UUID.test(litePublicationId));
  pass('Lite delivery is visible only to intended recipient',
    (await result('clientA','/reports/'+releaseVersion)).status===200 &&
    (await result('clientB','/reports/'+releaseVersion)).status===404);
  const clientClaims=JSON.parse(Buffer.from(users.clientA.token.split('.')[1],'base64url').toString('utf8'));
  requireCondition(UUID.test(clientClaims.session_id),'Lite client session is valid');
  const clientJwt=JSON.stringify({sub:users.clientA.id,role:'authenticated',session_id:clientClaims.session_id,aal:'aal1',is_anonymous:false});
  pass('Lite unguarded receipt RPC is not directly callable',
    [401,403,404].includes((await local('clientA','/rest/v1/rpc/advisory_record_receipt_unguarded',{p_publication_id:litePublicationId})).status));
  const receiptHolder=await holdSql(`begin; set local role authenticated; select set_config('request.jwt.claims','${clientJwt}',true);
    select capital_web3.advisory_record_receipt('${litePublicationId}'); reset role;`, 'RECEIPT_HELD');
  try {
    for (const [label,statement] of [
      ['case',`update capital_web3.advisory_cases set client_safe_title=client_safe_title where id='${releaseCase}'`],
      ['feature',`update capital_web3_private.cofre_lite_features set enabled=false where workspace_id='${workspaceA}'`],
      ['client membership',`update capital_web3_private.cofre_workspace_members set active=false where workspace_id='${workspaceA}' and user_id='${users.clientA.id}' and member_role='client'`],
      ['client assignment',`update capital_web3.advisory_case_clients set active=false where case_id='${releaseCase}' and user_id='${users.clientA.id}'`],
      ['client session',`delete from auth.sessions where id='${clientClaims.session_id}'`],
      ['publication',`delete from capital_web3.advisory_publications where id='${litePublicationId}'`],
    ]) {
      const attempt=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:5000,input:`begin; set local lock_timeout='350ms'; ${statement}; commit;`});
      pass('Lite receipt serializes '+label,attempt.status!==0 && /lock timeout/i.test(attempt.stderr));
    }
    receiptHolder.proc.stdin.end('commit;\n'); requireCondition(await receiptHolder.done===0,'Lite receipt transaction commits');
  } finally {if(receiptHolder.proc.exitCode===null)receiptHolder.proc.kill();}
  // Update starts before review and holds the case; the waiting old review must fail after commit.
  const anaJwt=JSON.stringify({sub:users.ana.id,role:'authenticated',session_id:claims.session_id,aal:'aal1',is_anonymous:false});
  const updateHolder=await holdSql(`begin; set local role authenticated; select set_config('request.jwt.claims','${anaJwt}',true);
    select capital_web3.advisory_lite_intake_save('${releaseCase}','${JSON.stringify(releaseIntake)}'::jsonb,1,'${randomUUID()}',null); reset role;`, 'UPDATE_HELD');
  try {
    const pendingReview=local('rui','/rest/v1/rpc/advisory_review_report',{...reviewArgs,p_idempotency_key:randomUUID()});
    const pendingReceipt=local('clientA','/rest/v1/rpc/advisory_record_receipt',{p_publication_id:litePublicationId});
    let waiting=false;
    for(let n=0;n<50&&!waiting;n++){
      await new Promise(resolve=>setTimeout(resolve,100));
      const check=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:3000,input:"select count(*) from pg_stat_activity where wait_event_type='Lock' and query ilike '%advisory_review_report%';"});
      requireCondition(check.status===0,'Lite review waiter query succeeds'); waiting=Number(check.stdout.trim())>0;
    }
    requireCondition(waiting,'Lite review waits for intake update');
    let receiptWaiting=false;
    for(let n=0;n<50&&!receiptWaiting;n++){
      await new Promise(resolve=>setTimeout(resolve,100));
      const check=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:pgEnv,encoding:'utf8',timeout:3000,input:"select count(*) from pg_stat_activity where wait_event_type='Lock' and query ilike '%advisory_record_receipt%';"});
      requireCondition(check.status===0,'Lite receipt waiter query succeeds'); receiptWaiting=Number(check.stdout.trim())>0;
    }
    requireCondition(receiptWaiting,'Lite receipt waits for intake update');
    updateHolder.proc.stdin.end('commit;\n'); requireCondition(await updateHolder.done===0,'Lite intake update commits');
    const [staleReview,staleReceipt]=await Promise.all([pendingReview,pendingReceipt]);
    pass('Lite review waiting behind changed intake rejects stale snapshot',staleReview.body?.code==='23514');
    pass('Lite receipt waiting behind changed intake is denied',[401,403,404].includes(staleReceipt.status));
  } finally {if(updateHolder.proc.exitCode===null)updateHolder.proc.kill();}
  const stalePublication=await local('rui','/rest/v1/rpc/advisory_publish_report',{...publishArgs,p_idempotency_key:randomUUID()});
  pass('Lite old approved version cannot be published after intake changes',stalePublication.body?.code==='23514');
  pass('New Lite intake suspends earlier client access', (await result('clientA','/reports/'+releaseVersion)).status===404);
  const oldDataApi=await local('clientA','/rest/v1/advisory_report_versions?select=id&id=eq.'+releaseVersion);
  const oldPublication=await local('clientA','/rest/v1/advisory_publications?select=id&id=eq.'+litePublicationId);
  pass('Data API hides previous Lite version and publication',oldDataApi.status===200 && oldDataApi.body.length===0 && oldPublication.status===200 && oldPublication.body.length===0);
  const oldReceipt=await local('clientA','/rest/v1/rpc/advisory_record_receipt',{p_publication_id:litePublicationId});
  pass('Stale Lite delivery cannot register receipt',[401,403,404].includes(oldReceipt.status));
  const newDraft=await local('ana','/rest/v1/rpc/advisory_lite_create_draft',{p_case_id:releaseCase,p_expected_revision:2,p_idempotency_key:randomUUID()});
  const newVersion=newDraft.body?.report_version_id;
  requireCondition(newDraft.status===200 && UUID.test(newVersion) && newVersion!==releaseVersion,'new Lite draft created');
  const newPackage=(await result('rui','/reports/'+newVersion+'/review-package')).body.data;
  requireCondition(SHA.test(newPackage?.content_sha256) && SHA.test(newPackage?.manifest_sha256),'new Lite review package ready');
  const nextReview={p_report_version_id:newVersion,p_decision:'approved',p_expected_content_sha256:newPackage.content_sha256,p_expected_manifest_sha256:newPackage.manifest_sha256,p_private_notes:'',p_idempotency_key:randomUUID()};
  requireCondition((await local('rui','/rest/v1/rpc/advisory_review_report',nextReview)).status===200,'new Lite review approved');
  const nextPublish={p_report_version_id:newVersion,p_recipient_user_ids:[users.clientA.id],p_expected_content_sha256:newPackage.content_sha256,p_expected_manifest_sha256:newPackage.manifest_sha256,p_expires_at:null,p_idempotency_key:randomUUID()};
  const nextDelivery=await local('rui','/rest/v1/rpc/advisory_publish_report',nextPublish);
  requireCondition(nextDelivery.status===200,'new Lite delivery published');
  pass('Client sees new Lite revision, not the stale one',(await result('clientA','/reports/'+newVersion)).status===200 && (await result('clientA','/reports/'+releaseVersion)).status===404);
  const nextDeliveryId=nextDelivery.body?.publication_id;
  requireCondition(UUID.test(nextDeliveryId),'next Lite delivery id exists');
  await sql(`insert into capital_web3_private.cofre_workspace_members(workspace_id,user_id,display_name,member_role) values('${workspaceA}','${users.clientA.id}','Dual role synthetic','analyst');
    update capital_web3_private.cofre_workspace_members set active=false where workspace_id='${workspaceA}' and user_id='${users.clientA.id}' and member_role='client';`);
  const dualRoleReceipt=await local('clientA','/rest/v1/rpc/advisory_record_receipt',{p_publication_id:nextDeliveryId});
  pass('Lite receipt rejects inactive client membership even with another active role',[401,403,404].includes(dualRoleReceipt.status));
  const dualRoleData=await local('clientA','/rest/v1/advisory_report_versions?select=id&id=eq.'+newVersion);
  pass('Lite recipient path requires active client membership despite another role',dualRoleData.status===200 && dualRoleData.body.length===0);
  await sql(`update capital_web3_private.cofre_workspace_members set active=true where workspace_id='${workspaceA}' and user_id='${users.clientA.id}' and member_role='client';
    delete from capital_web3_private.cofre_workspace_members where workspace_id='${workspaceA}' and user_id='${users.clientA.id}' and member_role='analyst';`);
  await sql(`update capital_web3_private.cofre_lite_features set enabled=false where workspace_id='${workspaceA}';`);
  pass('Disabled Lite feature suspends client access',(await result('clientA','/reports/'+newVersion)).status===404);
  await sql(`update capital_web3_private.cofre_lite_features set enabled=true where workspace_id='${workspaceA}';`);
  pass('Re-enabled Lite feature never resurrects prior delivery',(await result('clientA','/reports/'+newVersion)).status===404);
  const liteRevoked=await local('rui','/rest/v1/rpc/advisory_revoke_publication',{
    p_publication_id:litePublicationId,p_recipient_user_id:null,p_reason:'synthetic test complete',
    p_expected_content_sha256:releasePkg.content_sha256,p_expected_manifest_sha256:releasePkg.manifest_sha256,p_idempotency_key:randomUUID()});
  pass('Lite explicitly revoked delivery is no longer readable',liteRevoked.status===200 && (await result('clientA','/reports/'+releaseVersion)).status===404);

  // A legacy non-COFRE case has direct draft privileges. It must not fabricate Lite provenance.
  const genericCase=randomUUID(), genericReport=randomUUID(), forgedVersion=randomUUID();
  await sql(`insert into capital_web3.advisory_cases(id,client_safe_title,created_by) values('${genericCase}','Synthetic legacy','${users.ana.id}');
    insert into capital_web3.advisory_case_staff(case_id,user_id,staff_role) values('${genericCase}','${users.ana.id}','analyst'),('${genericCase}','${users.rui.id}','reviewer'),('${genericCase}','${users.rui.id}','publisher');
    insert into capital_web3.advisory_case_clients(case_id,user_id) values('${genericCase}','${users.clientA.id}');
    insert into capital_web3.advisory_reports(id,case_id,created_by) values('${genericReport}','${genericCase}','${users.ana.id}');`);
  const forged=await fetch(status.API_URL+'/rest/v1/advisory_report_versions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+users.ana.token,'Content-Type':'application/json','Content-Profile':'capital_web3','Accept-Profile':'capital_web3','Prefer':'return=representation'},
    body:JSON.stringify({id:forgedVersion,report_id:genericReport,case_id:genericCase,version_number:1,content:{report_kind:'cofre_lite',status:'requires_review',summary:'synthetic forged'},created_by:users.ana.id})});
  pass('Legacy case cannot forge a Lite report without server provenance',[400,401,403,409].includes(forged.status));

  const intakePath = '/cofre/cases/' + caseId + '/intake';
  const blank = await result('ana', intakePath);
  pass('COFRE new case starts without an invented intake', blank.status === 200 && blank.body.data === null);
  const partialPath = '/cofre/cases/' + caseId + '/partial';
  const partialIntake = syntheticCofreIntake(); partialIntake.profile.objective = ''; partialIntake.profile.experience = '';
  partialIntake.inventory[0].category = '';
  const partialSave = { intake: partialIntake, expected_revision: 0, base_revision: 0, idempotency_key: randomUUID() };
  pass('COFRE partial denied for client', (await result('clientA', partialPath, partialSave)).status === 404);
  pass('COFRE partial denied for foreign analyst', (await result('authorB', partialPath, partialSave)).status === 404);
  pass('COFRE partial denied for reviewer', (await result('rui', partialPath, partialSave)).status === 404);
  const noConsent = fresh(partialSave); noConsent.intake.consents.storage = false;
  pass('COFRE partial requires explicit synthetic storage consent', (await result('ana', partialPath, noConsent)).status === 400);
  const secret = fresh(partialSave); secret.intake.seed = 'no-secrets';
  pass('COFRE partial rejects unknown secret fields', (await result('ana', partialPath, secret)).status === 400);
  const partialResults = await Promise.all([result('ana', partialPath, partialSave), result('ana', partialPath, partialSave)]);
  pass('COFRE partial retry is idempotent', partialResults.every(r => r.status === 200 && r.body.data.revision === 1));
  const altered = fresh(partialSave); altered.intake.profile.objective = 'protect_family';
  pass('COFRE partial changed input cannot reuse key', (await result('ana', partialPath, altered)).status === 409);
  const conflict = fresh(altered); conflict.idempotency_key = randomUUID();
  pass('COFRE partial stale revision is rejected', (await result('ana', partialPath, conflict)).status === 409);
  pass('COFRE partial read denied to client and foreign analyst', (await result('clientA', partialPath)).status === 404 && (await result('authorB', partialPath)).status === 404);
  const nextA = fresh(partialSave); nextA.expected_revision=1; nextA.idempotency_key=randomUUID(); nextA.intake.profile.liquidity='short_term';
  const nextB = fresh(partialSave); nextB.expected_revision=1; nextB.idempotency_key=randomUUID(); nextB.intake.profile.loss_capacity='essential';
  const racedPartial = await Promise.all([result('ana',partialPath,nextA),result('ana',partialPath,nextB)]);
  pass('COFRE concurrent partial edits preserve one winner and reject one stale revision', racedPartial.map(r=>r.status).sort().join(',')==='200,409');
  const fetchedPartial = await result('ana', partialPath);
  pass('COFRE partial can be resumed without filling empty fields', fetchedPartial.status === 200 && fetchedPartial.body.data.intake.profile.objective === '' && fetchedPartial.body.data.stale === false);
  await sql('update capital_web3_private.cofre_partial_limits set partial_enabled=false where singleton=true');
  const directDisabled=await local('ana','/rest/v1/rpc/advisory_cofre_partial_get',{p_case_id:caseId});
  pass('direct PostgREST partial RPC is denied while database switch is off', directDisabled.status===403);
  const guardedFinal={intake:syntheticCofreIntake(),expected_revision:0,idempotency_key:randomUUID()};
  pass('final report is blocked while hidden partial is preserved', (await result('ana',intakePath,guardedFinal)).status===409);
  await sql('update capital_web3_private.cofre_partial_limits set partial_enabled=true where singleton=true');

  // Two cases, same actor: quota must remain bounded under concurrent writes.
  const extraCases = await Promise.all([0,1].map(() => result('ana', '/cofre/cases', { ...create, idempotency_key: randomUUID() })));
  requireCondition(extraCases.every(row => row.status === 200 && UUID.test(row.body.data.case_id)), 'quota fixture cases created');
  await sql('update capital_web3_private.cofre_partial_limits set max_receipts_per_actor=3 where singleton=true');
  // Existing actor has exactly two receipts (initial save and successful concurrency winner).
  const quotaBodies = extraCases.map(() => ({ intake: partialIntake, expected_revision: 0, base_revision: 0, idempotency_key: randomUUID() }));
  const limited = await Promise.all(extraCases.map((row,index) => result('ana', '/cofre/cases/' + row.body.data.case_id + '/partial', quotaBodies[index])));
  pass('COFRE partial receipt quota serializes concurrent cross-case writes', limited.map(row => row.status).sort().join(',')==='200,429');
  pass('COFRE previous idempotent retry works at capacity', (await result('ana', partialPath, partialSave)).status === 200);
  await sql('update capital_web3_private.cofre_partial_limits set max_receipts_per_actor=1000 where singleton=true');
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
  const afterFinal = await result('ana', partialPath);
  pass('COFRE partial remains preserved and marked stale after final version', afterFinal.status === 200 && afterFinal.body.data.stale === true);
  const restorePath=partialPath+'/restore';
  const restore={expected_revision:afterFinal.body.data.revision,base_revision:1,idempotency_key:randomUUID()};
  pass('COFRE client cannot restore staff partial', (await result('clientA',restorePath,restore)).status===404);
  const racedRestore=await Promise.all([result('ana',restorePath,restore),result('ana',restorePath,restore)]);
  pass('COFRE restore retries preserve one explicit operation', racedRestore.every(row=>row.status===200 && row.body.data.revision===restore.expected_revision+1));
  const restored=await result('ana',partialPath);
  pass('COFRE restore preserves original answers without changing final version', restored.status===200 && restored.body.data.stale===false && restored.body.data.intake.profile.objective==='');
  pass('COFRE restore rejects stale revision with a new key', (await result('ana',restorePath,{...restore,idempotency_key:randomUUID()})).status===409);

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

