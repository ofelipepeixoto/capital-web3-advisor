/** Offline Auth helpers: no real account, email, TOTP seed or network access. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthControls, consumeAuthFragment } from '../apps/staging/auth-controls.mjs';

const USER = '10000000-0000-0000-0000-000000000011';
const FACTOR = '30000000-0000-0000-0000-000000000001';
const CHALLENGE = '30000000-0000-0000-0000-000000000002';
const CANONICAL = 'https://capital.camaleaoweb3.com.br/';
const NOW = Date.parse('2026-10-17T20:00:00Z');
const SECRET = 'JBSWY3DPEHPK3PXP'; // Fictional RFC-style fixture, never used by an account.
function token(extra = {}) {
  return [Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: USER, role: 'authenticated', exp: Math.floor(NOW / 1000) + 3600, aal: 'aal1', ...extra })).toString('base64url'),
    'fictional_signature'].join('.');
}
function fragment(extra = {}) {
  return CANONICAL + '#' + new URLSearchParams({ access_token: token(), refresh_token: 'fictional_refresh_do_not_keep',
    expires_in: '3600', token_type: 'bearer', type: 'recovery', ...extra });
}
function setup(responses = []) {
  const calls = [], sessions = [];
  const auth = createAuthControls({ request: async (path, options) => {
    calls.push({ path, options });
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return result;
  }, onSession: (value) => { sessions.push(value); } });
  return { auth, calls, sessions };
}

test('recovery/invite fragments are removed first and refresh tokens are discarded', () => {
  for (const type of ['recovery', 'invite']) {
    const replaced = [];
    const result = consumeAuthFragment(fragment({ type }), (url) => replaced.push(url), () => NOW);
    assert.deepEqual(replaced, [CANONICAL]);
    assert.deepEqual(result, { type, accessToken: token(), expiresIn: 3600 });
    assert.equal(result.refresh_token, undefined);
    assert.equal(JSON.stringify(result).includes('fictional_refresh_do_not_keep'), false);
  }
  assert.equal(consumeAuthFragment(CANONICAL, () => { throw new Error('should not run'); }), null);
});

test('invalid auth fragments are still scrubbed and errors never reproduce tokens or details', () => {
  for (const input of [
    fragment({ access_token: 'fictional_private_marker', type: 'recovery' }),
    fragment({ access_token: token({ exp: Math.floor(NOW / 1000) - 1 }) }),
    fragment({ type: 'signup' }), fragment({ expires_in: '0' }),
    fragment({ expires_in: 'NaN' }), fragment({ token_type: 'secret' }),
    fragment({ expires_at: String(Math.floor(NOW / 1000) - 1) }),
    fragment() + '&access_token=fictional_private_marker',
    fragment() + '&next=https://fictional-private-marker.example',
    CANONICAL + '#error=fictional_private_marker&error_description=fictional_secret',
  ]) {
    let scrubbed = false;
    assert.throws(() => consumeAuthFragment(input, () => { scrubbed = true; }, () => NOW),
      (error) => scrubbed && !error.message.includes('fictional_') && !error.message.includes(token()));
  }
});

test('fragments reject insecure pages, duplicated parameters, missing subject and missing token expiry', () => {
  for (const input of [fragment().replace('https:', 'http:'),
    fragment({ access_token: token({ sub: null }) }),
    fragment({ access_token: token({ exp: null }) }),
    fragment({ access_token: token({ role: 'service_role' }) }),
    fragment() + '&type=invite']) {
    assert.throws(() => consumeAuthFragment(input, () => {}, () => NOW));
  }
  assert.equal(consumeAuthFragment(CANONICAL + '#plain-section', () => {}, () => NOW), null);
});

test('lists only TOTP factor metadata and treats it as metadata, not session approval', async () => {
  const { auth, calls, sessions } = setup([{ id: USER, is_anonymous: false, factors: [
    { id: FACTOR, status: 'verified', factor_type: 'totp', friendly_name: '<b>fictional name</b>', secret: 'fictional_private_marker' },
    { id: CHALLENGE, status: 'unverified', factor_type: 'totp' },
    { id: CHALLENGE, status: 'verified', factor_type: 'phone', phone: 'fictional_private_phone' },
  ] }]);
  const result = await auth.listFactors();
  assert.deepEqual(calls, [{ path: '/auth/v1/user', options: { method: 'GET' } }]);
  assert.equal(result.totp.length, 1); assert.equal(result.all.length, 2);
  assert.equal(result.totp[0].friendly_name, '<b>fictional name</b>');
  assert.equal(JSON.stringify(result).includes('fictional_private'), false);
  assert.deepEqual(sessions, []);
});

test('enrollment uses fixed factor type/name and returns the seed only to the active UI', async () => {
  const enrollment = { id: FACTOR, type: 'totp', totp: { secret: SECRET,
    qr_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', uri: 'otpauth://totp/Capital?secret=' + SECRET } };
  const { auth, calls, sessions } = setup([enrollment]);
  assert.deepEqual(await auth.enrollTOTP(), { id: FACTOR, totp: enrollment.totp });
  assert.deepEqual(calls, [{ path: '/auth/v1/factors', options: { method: 'POST',
    body: { factor_type: 'totp', friendly_name: 'Capital Web3' } } }]);
  assert.deepEqual(sessions, []);
  assert.equal(auth.unenroll, undefined);
});

test('enrollment rejects remote QR URLs and inconsistent secrets without echoing them', async () => {
  for (const totp of [
    { secret: SECRET, qr_code: 'https://fictional-private.example/qr', uri: 'otpauth://totp/Capital?secret=' + SECRET },
    { secret: SECRET, qr_code: '<svg/>', uri: 'https://fictional-private.example/?secret=' + SECRET },
    { secret: SECRET, qr_code: '<svg/>', uri: 'otpauth://totp/Capital?secret=DIFFERENT' },
  ]) {
    const { auth } = setup([{ id: FACTOR, totp }]);
    await assert.rejects(auth.enrollTOTP(), (error) => !error.message.includes(SECRET) && !error.message.includes('fictional-private'));
  }
});

test('explicit cancellation rechecks own unverified TOTP then deletes only that factor', async () => {
  const { auth, calls, sessions } = setup([{ id: USER, is_anonymous: false,
    factors: [{ id: FACTOR, status: 'unverified', factor_type: 'totp' }] }, { id: FACTOR }]);
  assert.deepEqual(await auth.cancelPendingTOTP(FACTOR), { cancelled: true, factor_id: FACTOR });
  assert.deepEqual(calls, [
    { path: '/auth/v1/user', options: { method: 'GET' } },
    { path: `/auth/v1/factors/${FACTOR}`, options: { method: 'DELETE' } },
  ]);
  assert.deepEqual(sessions, []);
});

test('cancellation refuses verified, missing or non-TOTP factors before DELETE', async () => {
  for (const factors of [[], [{ id: FACTOR, status: 'verified', factor_type: 'totp' }],
    [{ id: FACTOR, status: 'unverified', factor_type: 'phone' }]]) {
    const { auth, calls } = setup([{ id: USER, is_anonymous: false, factors }]);
    await assert.rejects(auth.cancelPendingTOTP(FACTOR), /ainda não confirmada/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/auth/v1/user');
  }
  const invalid = setup(); await assert.rejects(invalid.auth.cancelPendingTOTP('../user'));
  assert.equal(invalid.calls.length, 0);
});

test('TOTP verification challenges the factor and adopts only the AAL2 bearer in memory', async () => {
  const access = token({ aal: 'aal2' });
  const { auth, calls, sessions } = setup([{ id: CHALLENGE },
    { access_token: access, expires_in: 3600, refresh_token: 'fictional_refresh_do_not_keep', user: { id: USER } }]);
  assert.deepEqual(await auth.verifyTOTP(FACTOR, '123456'), { aal: 'aal2', factor_id: FACTOR });
  assert.deepEqual(calls, [
    { path: `/auth/v1/factors/${FACTOR}/challenge`, options: { method: 'POST', body: {} } },
    { path: `/auth/v1/factors/${FACTOR}/verify`, options: { method: 'POST', body: { challenge_id: CHALLENGE, code: '123456' } } },
  ]);
  assert.deepEqual(sessions, [{ access_token: access, expires_in: 3600 }]);
  assert.equal(JSON.stringify(sessions).includes('fictional_refresh_do_not_keep'), false);
});

test('malformed codes/ids never make a request, and an AAL1 response is never adopted', async () => {
  for (const [id, code] of [[FACTOR, '12345'], [FACTOR, '1234567'], [FACTOR, 123456], [FACTOR, ' 123456'], ['../user', '123456']]) {
    const { auth, calls } = setup();
    await assert.rejects(auth.verifyTOTP(id, code)); assert.deepEqual(calls, []);
  }
  const { auth, sessions } = setup([{ id: CHALLENGE }, { access_token: token(), expires_in: 3600 }]);
  await assert.rejects(auth.verifyTOTP(FACTOR, '123456')); assert.deepEqual(sessions, []);
});

test('password update sends only password under the explicit recovery bearer and does not auto-login', async () => {
  const { auth, calls, sessions } = setup([{ id: USER, factors: [], email: 'fictional@example.invalid' }, null]);
  const password = 'Fictional passphrase 123!';
  assert.deepEqual(await auth.updatePassword(token(), password), { updated: true, session_ended: true });
  assert.deepEqual(calls, [
    { path: '/auth/v1/user', options: { method: 'PUT', body: { password }, token: token() } },
    { path: '/auth/v1/logout?scope=local', options: { method: 'POST', body: {}, token: token() } },
  ]);
  assert.deepEqual(sessions, []);
  for (const value of ['short', 'x'.repeat(129), 'a'.repeat(12) + '\n', null]) {
    const invalid = setup(); await assert.rejects(invalid.auth.updatePassword(token(), value)); assert.equal(invalid.calls.length, 0);
  }
  const wrongAccount = setup([{ id: FACTOR }]);
  await assert.rejects(wrongAccount.auth.updatePassword(token(), password), /Não foi possível concluir/);
  assert.deepEqual(wrongAccount.sessions, []);
});

test('link-session logout failure preserves successful password update and exposes no diagnostics', async () => {
  const failure = new Error('fictional_private_logout_failure'); failure.status = 503;
  const { auth, calls, sessions } = setup([{ id: USER }, failure]);
  const result = await auth.updatePassword(token(), 'Fictional passphrase 123!');
  assert.deepEqual(result, { updated: true, session_ended: false });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.token, token());
  assert.deepEqual(sessions, []);
  assert.equal(JSON.stringify(result).includes('fictional_private'), false);
  const updateFailure = setup([failure]);
  await assert.rejects(updateFailure.auth.updatePassword(token(), 'Fictional passphrase 123!'));
  assert.equal(updateFailure.calls.length, 1);
});

test('recovery uses exact canonical redirect with no current-session bearer and generic account outcome', async () => {
  const { auth, calls } = setup([{}]);
  const result = await auth.recover('fictional@example.invalid', CANONICAL);
  assert.match(result.message, /Se houver uma conta elegível/);
  assert.deepEqual(calls, [{ path: '/auth/v1/recover?redirect_to=' + encodeURIComponent(CANONICAL),
    options: { method: 'POST', body: { email: 'fictional@example.invalid' }, token: null } }]);
  const failure = new Error('fictional_private_account_exists'); failure.status = 404;
  const absent = setup([failure]); assert.deepEqual(await absent.auth.recover('fictional@example.invalid', CANONICAL), result);
  for (const redirect of ['https://attacker.invalid/', CANONICAL + '?next=evil', CANONICAL + '#token', CANONICAL.replace('https:', 'http:')]) {
    const invalid = setup(); await assert.rejects(invalid.auth.recover('fictional@example.invalid', redirect)); assert.equal(invalid.calls.length, 0);
  }
});

test('provider failures and thrown diagnostics are redacted, including enrollment secrets and passwords', async () => {
  const failure = new Error('fictional_private_marker ' + SECRET); failure.status = 429;
  const { auth } = setup([failure]);
  await assert.rejects(auth.enrollTOTP(), (error) => error.status === 429 && !error.message.includes(SECRET) && !error.message.includes('fictional_private'));
  const unavailable = setup([new Error('fictional_private_network_diagnostic')]);
  await assert.rejects(unavailable.auth.recover('fictional@example.invalid', CANONICAL), /Não foi possível concluir/);
});
