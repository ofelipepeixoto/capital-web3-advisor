/** Real disposable Auth tests: TOTP AAL upgrade, RLS, invite and recovery.
 * No email delivery or cloud requests. Admin key, TOTP secret, credentials,
 * token hashes and sessions remain in memory and never enter CI output.
 * REST shapes verified against supabase/auth-js GoTrueClient/GoTrueAdminApi,
 * and official Supabase MFA / generateLink / verifyOtp documentation.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { syntheticCofreIntake } from './cofre_e2e.mjs';
import { createAuthControls } from '../../apps/staging/auth-controls.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const claims = token => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };

/** RFC 6238 helper; only used with a real test factor secret held in memory. */
export function totpCode(secret, at = Date.now()) {
  if (typeof secret !== 'string' || !/^[A-Z2-7]+=*$/i.test(secret) || secret.length > 256) throw new Error('invalid test factor');
  let bits = 0, value = 0; const bytes = [];
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export async function runAuthControlsIntegration({ status, sql, pass, requireCondition, handler, origin }) {
  requireCondition(status.API_URL === 'http://127.0.0.1:54321', 'Auth controls only target the disposable local stack');
  requireCondition(typeof status.SERVICE_ROLE_KEY === 'string' && typeof status.ANON_KEY === 'string', 'Auth controls require private local keys');
  requireCondition(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000) === '287082', 'TOTP computation matches RFC 6238 test vector');
  let gate = 'initialize';
  const logoutTokens = new Set();
  const local = async (path, { method = 'GET', body, token, admin = false, profile = false } = {}) => {
    requireCondition(/^\/(auth|rest)\/v1\//.test(path), 'Auth controls use fixed local paths');
    let response;
    try { response = await fetch(status.API_URL + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: admin ? status.SERVICE_ROLE_KEY : status.ANON_KEY,
        ...(admin || token ? { Authorization: 'Bearer ' + (admin ? status.SERVICE_ROLE_KEY : token) } : {}),
        ...(profile ? { 'Accept-Profile': 'capital_web3' } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }); } catch { requireCondition(false, 'Auth controls local request available at ' + gate); }
    if (response.status === 204) return { status: 204, body: null };
    let data; try { data = await response.json(); } catch { requireCondition(false, 'Auth controls local JSON valid at ' + gate); }
    return { status: response.status, body: data };
  };
  const api = async (token, path, body) => {
    let response;
    try { response = await handler(new Request(status.API_URL + '/functions/v1/advisory-api' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + token, origin,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })); } catch { requireCondition(false, 'Auth controls actual API handler responds at ' + gate); }
    let data; try { data = await response.json(); } catch { requireCondition(false, 'Auth controls API JSON valid at ' + gate); }
    return { status: response.status, body: data };
  };
  const tag = randomBytes(8).toString('hex');
  const fixture = async role => {
    const email = 'capital-auth-' + tag + '-' + role + '@example.invalid', password = randomBytes(36).toString('base64url');
    const created = await local('/auth/v1/admin/users', { method: 'POST', admin: true,
      body: { email, password, email_confirm: true } });
    requireCondition(created.status === 200 && UUID.test(created.body.id), 'Auth controls synthetic account provisioned at ' + gate);
    return { email, password, id: created.body.id };
  };
  const login = async account => {
    const signed = await local('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: account.email, password: account.password } });
    if (JWT.test(signed.body?.access_token)) logoutTokens.add(signed.body.access_token);
    requireCondition(signed.status === 200 && signed.body.user?.id === account.id && JWT.test(signed.body.access_token), 'Auth controls password login succeeds at ' + gate);
    return signed.body.access_token;
  };
  try {
    gate = 'MFA synthetic staff creation'; const staff = await fixture('staff');
    const reviewer = await fixture('reviewer'), client = await fixture('client');
    const workspaceId = randomUUID();
    await sql(`begin;
insert into capital_web3_private.cofre_workspaces(id,label,staff_mfa_required) values('${workspaceId}','Auth MFA synthetic workspace',true);
insert into capital_web3_private.cofre_workspace_members(workspace_id,user_id,display_name,member_role) values
('${workspaceId}','${staff.id}','Auth fictitious analyst','analyst'),
('${workspaceId}','${reviewer.id}','Auth fictitious reviewer','reviewer'),
('${workspaceId}','${reviewer.id}','Auth fictitious reviewer','publisher'),
('${workspaceId}','${client.id}','Auth fictitious client','client');
commit;`);
    gate = 'AAL1 authorization'; const aal1 = await login(staff);
    pass('real password Auth session starts at AAL1', claims(aal1).aal === 'aal1' && claims(aal1).sub === staff.id);
    const requirements = await api(aal1, '/access-requirements');
    pass('AAL1 access requirements reveal only the MFA requirement', requirements.status === 200 &&
      requirements.body.mfa_required === true && requirements.body.assurance_level === 'aal1' &&
      Object.keys(requirements.body).every(key => ['mfa_required', 'assurance_level', 'request_id'].includes(key)));
    const before = await api(aal1, '/cofre/workspaces');
    pass('required MFA withholds the roster from real AAL1 session', before.status === 200 && Array.isArray(before.body.data) && before.body.data.length === 0);
    const create = { workspace_id: workspaceId, client_user_id: client.id, idempotency_key: randomUUID() };
    pass('required MFA blocks case creation at AAL1', (await api(aal1, '/cofre/cases', create)).status === 404);

    let currentToken = aal1, upgradedToken = null;
    const auth = createAuthControls({
      request: async (path, options = {}) => {
        const response = await local(path, { ...options, token: options.token === undefined ? currentToken : options.token });
        if (response.status < 200 || response.status >= 300) throw Object.assign(new Error('local Auth denied'), { status: response.status });
        return response.body;
      },
      onSession: session => { currentToken = session.access_token; upgradedToken = session.access_token; logoutTokens.add(session.access_token); },
    });
    gate = 'TOTP factor enrollment';
    const emptyFactors = await auth.listFactors();
    pass('production Auth helper sees no invented factors for a new account', emptyFactors.all.length === 0 && emptyFactors.totp.length === 0);
    const enrolled = await auth.enrollTOTP();
    requireCondition(UUID.test(enrolled.id) && typeof enrolled.totp?.secret === 'string', 'real Auth TOTP factor enrollment succeeds');
    const factorId = enrolled.id, secret = enrolled.totp.secret;
    const uri = new URL(enrolled.totp.uri);
    requireCondition(uri.protocol === 'otpauth:' && uri.searchParams.get('secret') === secret &&
      (!uri.searchParams.has('digits') || uri.searchParams.get('digits') === '6') &&
      (!uri.searchParams.has('period') || uri.searchParams.get('period') === '30') &&
      (!uri.searchParams.has('algorithm') || uri.searchParams.get('algorithm').toUpperCase() === 'SHA1'), 'TOTP returned parameters match the CI authenticator');
    gate = 'incorrect TOTP rejection';
    const forbiddenCodes = new Set([-30000, 0, 30000].map(offset => totpCode(secret, Date.now() + offset)));
    let wrong = '000000'; while (forbiddenCodes.has(wrong)) wrong = String(Number(wrong) + 1).padStart(6, '0');
    let wrongStatus = null;
    try { await auth.verifyTOTP(factorId, wrong); } catch (failure) { wrongStatus = failure.status; }
    pass('real Auth rejects an incorrect TOTP without issuing a session',
      [400, 401, 403, 422].includes(wrongStatus) && upgradedToken === null);
    gate = 'valid TOTP verification';
    const verified = await auth.verifyTOTP(factorId, totpCode(secret));
    requireCondition(verified.aal === 'aal2' && JWT.test(upgradedToken), 'real Auth issues the upgraded TOTP session');
    const aal2 = upgradedToken;
    const authenticated = await local('/auth/v1/user', { token: aal2 });
    pass('real TOTP verification yields an Auth-verified AAL2 session', claims(aal2).aal === 'aal2' &&
      claims(aal2).sub === staff.id && authenticated.status === 200 && authenticated.body.id === staff.id);
    const factors = authenticated.body.factors;
    pass('real Auth marks the enrolled TOTP factor verified', Array.isArray(factors) &&
      factors.some(factor => factor.id === factorId && factor.factor_type === 'totp' && factor.status === 'verified'));
    const after = await api(aal2, '/cofre/workspaces');
    pass('AAL2 passes the actual handler and database MFA roster guard', after.status === 200 &&
      Array.isArray(after.body.data) && after.body.data.length === 4 && after.body.data.every(row => row.workspace_id === workspaceId));
    const created = await api(aal2, '/cofre/cases', create);
    requireCondition(created.status === 200 && UUID.test(created.body.data?.case_id), 'AAL2 creates the actual COFRE case');
    const caseId = created.body.data.case_id;
    const saved = await api(aal2, '/cofre/cases/' + caseId + '/intake', { intake: syntheticCofreIntake(), expected_revision: 0, idempotency_key: randomUUID() });
    requireCondition(saved.status === 200 && UUID.test(saved.body.data?.report_version_id), 'AAL2 persists the actual COFRE intake');
    const reportPath = '/reports/' + saved.body.data.report_version_id;
    pass('AAL2 can read its assigned case and review package', (await api(aal2, reportPath)).status === 200 &&
      (await api(aal2, reportPath + '/review-package')).status === 200);
    pass('the original AAL1 JWT does not inherit the upgraded token authorization',
      (await api(aal1, reportPath)).status === 404 && (await api(aal1, reportPath + '/review-package')).status === 404);
    gate = 'AAL2 session logout';
    const ended = await local('/auth/v1/logout?scope=local', { method: 'POST', token: aal2, body: {} });
    pass('real MFA session logout is acknowledged by Auth', ended.status === 204);
    logoutTokens.delete(aal2); logoutTokens.delete(aal1);
    const oldRead = await api(aal2, reportPath), oldPackage = await api(aal2, reportPath + '/review-package');
    pass('logged-out AAL2 JWT cannot read a COFRE report or review package',
      [401, 404].includes(oldRead.status) && [401, 404].includes(oldPackage.status));
    const direct = await local('/rest/v1/advisory_report_versions?select=id,content&id=eq.' + saved.body.data.report_version_id,
      { token: aal2, profile: true });
    pass('direct Data API rejects the logged-out AAL2 session', [401, 403].includes(direct.status) || direct.status === 200 && direct.body.length === 0);

    gate = 'recovery link generation'; const recoveredAccount = await fixture('recovery');
    const recoveryWorkspace = randomUUID();
    await sql(`begin;
insert into capital_web3_private.cofre_workspaces(id,label,staff_mfa_required) values('${recoveryWorkspace}','Recovery synthetic workspace',false);
insert into capital_web3_private.cofre_workspace_members(workspace_id,user_id,display_name,member_role) values
('${recoveryWorkspace}','${recoveredAccount.id}','Recovery fictitious analyst','analyst'),
('${recoveryWorkspace}','${reviewer.id}','Recovery fictitious reviewer','reviewer'),
('${recoveryWorkspace}','${reviewer.id}','Recovery fictitious reviewer','publisher'),
('${recoveryWorkspace}','${client.id}','Recovery fictitious client','client');
commit;`);
    const oldRecoverySession = await login(recoveredAccount);
    const oldRecoveryCase = await api(oldRecoverySession, '/cofre/cases', {
      workspace_id: recoveryWorkspace, client_user_id: client.id, idempotency_key: randomUUID(),
    });
    requireCondition(oldRecoveryCase.status === 200 && UUID.test(oldRecoveryCase.body.data?.case_id), 'pre-recovery session creates an assigned synthetic case');
    const oldRecoveryDraft = await api(oldRecoverySession, '/cofre/cases/' + oldRecoveryCase.body.data.case_id + '/intake', {
      intake: syntheticCofreIntake(), expected_revision: 0, idempotency_key: randomUUID(),
    });
    requireCondition(oldRecoveryDraft.status === 200 && UUID.test(oldRecoveryDraft.body.data?.report_version_id), 'pre-recovery session writes its assigned synthetic report');
    const recoveryReport = '/reports/' + oldRecoveryDraft.body.data.report_version_id;
    pass('pre-recovery Auth session has an actual protected report before password reset',
      (await api(oldRecoverySession, recoveryReport)).status === 200);
    const recovery = await local('/auth/v1/admin/generate_link', { method: 'POST', admin: true,
      body: { type: 'recovery', email: recoveredAccount.email } });
    requireCondition(recovery.status === 200 && recovery.body.verification_type === 'recovery' &&
      typeof recovery.body.hashed_token === 'string' && recovery.body.id === recoveredAccount.id, 'local recovery token is generated without sending email');
    const recoveryBody = { type: 'recovery', token_hash: recovery.body.hashed_token };
    const wrongRecoveryType = await local('/auth/v1/verify', { method: 'POST', body: { ...recoveryBody, type: 'invite' } });
    pass('recovery token cannot be used as an invitation token', [400, 401, 403, 422].includes(wrongRecoveryType.status) && !wrongRecoveryType.body?.access_token);
    const recovered = await local('/auth/v1/verify', { method: 'POST', body: recoveryBody });
    if (JWT.test(recovered.body?.access_token)) logoutTokens.add(recovered.body.access_token);
    pass('real recovery token exchanges for its exact synthetic account session', recovered.status === 200 &&
      JWT.test(recovered.body.access_token) && recovered.body.user?.id === recoveredAccount.id);
    const recoveredPassword = randomBytes(36).toString('base64url');
    const changed = await auth.updatePassword(recovered.body.access_token, recoveredPassword);
    pass('production helper sets a recovery password and ends the temporary session', changed.updated === true && changed.session_ended === true);
    pass('the temporary recovery token no longer satisfies the live access requirement',
      (await api(recovered.body.access_token, '/access-requirements')).status === 401);
    const endedRecoveryRead = await api(recovered.body.access_token, recoveryReport);
    const endedRecoveryDirect = await local('/rest/v1/advisory_report_versions?select=id,content&id=eq.' + oldRecoveryDraft.body.data.report_version_id,
      { token: recovered.body.access_token, profile: true });
    pass('ending the recovery session also blocks protected API and direct Data API reads',
      [401, 404].includes(endedRecoveryRead.status) && ([401, 403].includes(endedRecoveryDirect.status) ||
        endedRecoveryDirect.status === 200 && endedRecoveryDirect.body.length === 0));
    logoutTokens.delete(recovered.body.access_token);
    const oldRecoveryAccess = await api(oldRecoverySession, recoveryReport);
    pass('password recovery invalidates a previously active protected session', [401, 404].includes(oldRecoveryAccess.status));
    const recoveredLogin = await login({ ...recoveredAccount, password: recoveredPassword });
    pass('recovered account signs in with the new password', JWT.test(recoveredLogin));
    const oldPassword = await local('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: recoveredAccount.email, password: recoveredAccount.password } });
    pass('the superseded recovery password no longer authenticates', [400, 401, 403, 422].includes(oldPassword.status) && !oldPassword.body?.access_token);
    const recoveryReplay = await local('/auth/v1/verify', { method: 'POST', body: recoveryBody });
    pass('recovery token is consumed and cannot be exchanged twice', [400, 401, 403, 422].includes(recoveryReplay.status) && !recoveryReplay.body?.access_token);

    gate = 'invitation link generation';
    const inviteEmail = 'capital-auth-' + tag + '-invite@example.invalid';
    const invite = await local('/auth/v1/admin/generate_link', { method: 'POST', admin: true, body: { type: 'invite', email: inviteEmail } });
    requireCondition(invite.status === 200 && UUID.test(invite.body.id) && invite.body.verification_type === 'invite' &&
      typeof invite.body.hashed_token === 'string', 'local invitation is generated without sending email');
    const pendingInvite = await local('/auth/v1/admin/users/' + invite.body.id, { admin: true });
    pass('generated invitation has a pending account and no confirmed email', pendingInvite.status === 200 &&
      Boolean(pendingInvite.body.invited_at) && !pendingInvite.body.email_confirmed_at);
    const inviteBody = { type: 'invite', token_hash: invite.body.hashed_token };
    const accepted = await local('/auth/v1/verify', { method: 'POST', body: inviteBody });
    if (JWT.test(accepted.body?.access_token)) logoutTokens.add(accepted.body.access_token);
    pass('real invitation token accepts only the invited account', accepted.status === 200 &&
      JWT.test(accepted.body.access_token) && accepted.body.user?.id === invite.body.id && Boolean(accepted.body.user?.email_confirmed_at));
    const invitedRoster = await api(accepted.body.access_token, '/cofre/workspaces');
    pass('accepting an Auth invitation does not enroll the account into Capital', invitedRoster.status === 200 &&
      Array.isArray(invitedRoster.body.data) && invitedRoster.body.data.length === 0 &&
      (await api(accepted.body.access_token, '/cofre/cases', { ...create, idempotency_key: randomUUID() })).status === 404);
    const invitePassword = randomBytes(36).toString('base64url');
    const setInvitePassword = await auth.updatePassword(accepted.body.access_token, invitePassword);
    pass('invited account sets its initial password and ends the temporary session',
      setInvitePassword.updated === true && setInvitePassword.session_ended === true);
    pass('the temporary invitation token is unusable after password setup',
      (await api(accepted.body.access_token, '/access-requirements')).status === 401);
    logoutTokens.delete(accepted.body.access_token);
    pass('accepted invitation signs in with its chosen password', JWT.test(await login({ id: invite.body.id, email: inviteEmail, password: invitePassword })));
    const inviteReplay = await local('/auth/v1/verify', { method: 'POST', body: inviteBody });
    pass('invitation token is single use', [400, 401, 403, 422].includes(inviteReplay.status) && !inviteReplay.body?.access_token);
    if (process.env.CAPITAL_STAGING_BROWSER === '1') {
      gate = 'MFA browser fixture'; const browserStaff = await fixture('browser');
      const browserWorkspace = randomUUID();
      await sql(`begin;
insert into capital_web3_private.cofre_workspaces(id,label,staff_mfa_required) values('${browserWorkspace}','Browser MFA synthetic workspace',true);
insert into capital_web3_private.cofre_workspace_members(workspace_id,user_id,display_name,member_role) values
('${browserWorkspace}','${browserStaff.id}','Browser fictitious analyst','analyst'),
('${browserWorkspace}','${reviewer.id}','Browser fictitious reviewer','reviewer'),
('${browserWorkspace}','${reviewer.id}','Browser fictitious reviewer','publisher'),
('${browserWorkspace}','${client.id}','Browser fictitious client','client');
commit;`);
      const { runAuthControlsBrowser } = await import('../browser/auth_controls_supabase.mjs');
      await runAuthControlsBrowser({ status, user: browserStaff, workspaceId: browserWorkspace, handler, origin });
    }
    console.log('AUTH CONTROLS LOCAL: real TOTP/AAL2, recovery and invite token exchange passed; no email delivery or cloud validation.');
    return { workspaceId, staffId: staff.id, caseId, reportVersionId: saved.body.data.report_version_id };
  } finally {
    // Disposable local fixture sessions only. Cleanup failures never expose errors.
    for (const token of logoutTokens) { try { await local('/auth/v1/logout?scope=local', { method: 'POST', token, body: {} }); } catch { /* teardown owns the disposable stack */ } }
  }
}
