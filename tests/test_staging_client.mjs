import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PortalClient, validateConfig } from '../apps/staging/client.mjs';

const settings = { supabaseUrl: 'https://synthetic-project.supabase.co', publishableKey: 'sb_publishable_synthetic_only' };
const config = validateConfig(settings, 'https://homolog.capitalweb3.example');
const token = 'synthetic.jwt.signature';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const auth = () => json({ access_token: token, refresh_token: 'never-persist-this', expires_in: 3600 });
const session = () => json({ user_id: 'synthetic-user', assignments: [] });
test('MFA upgrade replaces the bearer without clearing the UI and rejects earlier in-flight results', async () => {
  let finish; let ended = 0; const calls=[];
  const client = new PortalClient(config,{onEnd:()=>{ended+=1;},fetcher:async(url,init)=>{
    calls.push(init.headers.Authorization);
    if(url.endsWith('/reports')) return new Promise(resolve=>{finish=()=>resolve(json({data:[]}));});
    return session();
  }});
  client.adoptSession({access_token:token,expires_in:3600}); const pending=client.api('/reports');
  client.adoptSession({access_token:'mfa.jwt.signature',expires_in:1800,refresh_token:'discard'});
  finish(); await assert.rejects(pending,/Sessão alterada/);
  await client.api('/access-requirements'); assert.equal(calls.at(-1),'Bearer mfa.jwt.signature');
  assert.equal(ended,0); assert.ok(!JSON.stringify(client).includes('mfa.jwt')); client.clear();
});
test('public recovery never inherits a current bearer and Auth methods have a fixed route set', async () => {
  const calls=[]; const client=new PortalClient(config,{fetcher:async(url,init)=>{calls.push({url,init});return json({});}});
  client.adoptSession({access_token:token,expires_in:3600});
  await client.authRequest('/auth/v1/recover?redirect_to=https%3A%2F%2Fcapital.camaleaoweb3.com.br%2F',
    {method:'POST',body:{email:'synthetic@example.invalid'},token:null});
  assert.equal(calls[0].init.headers.Authorization,undefined);
  for(const path of ['/auth/v1/admin/users','/rest/v1/advisory_cases','https://foreign.invalid/auth/v1/user']) {
    await assert.rejects(client.authRequest(path,{method:'DELETE'}),/Rota de acesso inválida/);
  }
  assert.equal(calls.length,1); client.clear();
});
test('configuration rejects secret keys, extra destinations and insecure hosted origins', () => {
  const secret = 'head.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.sig';
  for (const values of [ { ...settings, publishableKey: secret }, { ...settings, publishableKey: 'sb_secret_never_allowed' },
    { ...settings, extraUrl: 'https://elsewhere.example' }, { ...settings, supabaseUrl: 'https://evil.example' },
    { ...settings, supabaseUrl: 'https://u:p@synthetic-project.supabase.co' },
    { ...settings, supabaseUrl: settings.supabaseUrl + '?redirect=https://evil.example' } ]) {
    assert.throws(() => validateConfig(values, 'https://portal.example'));
  }
  assert.throws(() => validateConfig(settings, 'http://portal.example'));
});
test('local Auth endpoint is accepted only from a loopback page', () => {
  const local = { ...settings, supabaseUrl: 'http://127.0.0.1:54321' };
  assert.equal(validateConfig(local, 'http://127.0.0.1:9999').base, local.supabaseUrl);
  assert.throws(() => validateConfig(local, 'https://portal.example'));
});
test('login verifies the API session and attaches bearer only in headers', async () => {
  const calls = [];
  const client = new PortalClient(config, { fetcher: async (url, init) => {
    calls.push({ url, init }); return url.includes('/token?') ? auth() : session();
  } });
  await client.login('synthetic@example.invalid', 'synthetic-only'); await client.api('/reports');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + token);
  assert.ok(calls.every(c => !c.url.includes(token) && c.init.credentials === 'omit' && c.init.redirect === 'error'));
  assert.equal(JSON.stringify(client).includes(token), false); client.clear();
});
test('a late login cannot restore a cleared session', async () => {
  let release;
  const client = new PortalClient(config, { fetcher: () => new Promise(resolve => { release = resolve; }) });
  const pending = client.login('x', 'y'); client.clear(); release(auth());
  await assert.rejects(pending, /cancelada/); await assert.rejects(client.api('/reports'), /encerrada/);
});
test('native browser fetch is never invoked with the client as its receiver', async () => {
  const client = new PortalClient(config, { fetcher: async function (url) {
    assert.equal(this, undefined, 'Web API receiver must not be PortalClient');
    return url.includes('/token?') ? auth() : session();
  } });
  await client.login('x', 'y'); await client.api('/reports'); client.clear();
});
test('late report responses cannot cross logout and another login', async () => {
  let release, wait = false;
  const client = new PortalClient(config, { fetcher: async url => {
    if (url.includes('/token?')) return auth();
    if (wait && url.endsWith('/reports')) return new Promise(resolve => { release = resolve; });
    return session();
  } });
  await client.login('a', 'a'); wait = true; const pending = client.api('/reports');
  await client.login('b', 'b'); release(json({ data: ['private old report'] }));
  await assert.rejects(pending, /alterada/); client.clear();
});
test('an old unauthorized response does not clear a newer valid session', async () => {
  let release;
  const client = new PortalClient(config, { fetcher: async url => {
    if (url.includes('/token?')) return auth();
    if (url.endsWith('/reports')) return new Promise(resolve => { release = resolve; });
    return session();
  } });
  await client.login('a', 'a'); const old = client.api('/reports'); await client.login('b', 'b');
  release(json({}, 401)); await assert.rejects(old); assert.ok(await client.api('/session')); client.clear();
});
test('logout clears access even when the provider is unavailable', async () => {
  const client = new PortalClient(config, { fetcher: async url => {
    if (url.includes('/token?')) return auth(); if (url.includes('/logout?')) throw new Error('private provider text'); return session();
  } });
  await client.login('x', 'y'); await assert.rejects(client.logout(), /Conexão indisponível/);
  await assert.rejects(client.api('/reports'), /encerrada/);
});
test('expiry and HTTP 401 stop further data requests', async () => {
  let now = 1, calls = 0;
  const client = new PortalClient(config, { clock: () => now, fetcher: async url => {
    calls++; return url.includes('/token?') ? auth() : session();
  } });
  await client.login('x', 'y'); now += 3600001;
  await assert.rejects(client.api('/reports')); assert.equal(calls, 2);
  const other = new PortalClient(config, { fetcher: async url => url.includes('/token?') ? auth() : url.endsWith('/session') ? session() : json({}, 401) });
  await other.login('x', 'y'); await assert.rejects(other.api('/reports'), /Sessão inválida/);
  await assert.rejects(other.api('/session'), /encerrada/);
});
test('denied object errors never echo upstream bodies', async () => {
  const client = new PortalClient(config, { fetcher: async url => url.includes('/token?') ? auth() : url.endsWith('/session') ? session() : json({ error: 'PRIVATE ROW DETAILS' }, 404) });
  await client.login('x', 'y'); await assert.rejects(client.api('/reports'), /Diagnóstico indisponível/); client.clear();
});
test('transport denies caller-controlled URLs, queries and traversal', async () => {
  const client = new PortalClient(config);
  for (const path of ['https://elsewhere.example', '/reports/../session', '/reports?token=x', '/auth/v1/admin/users']) await assert.rejects(client.api(path), /Rota inválida/);
});
test('successful body is size bounded even without content-length', async () => {
  const client = new PortalClient(config, { fetcher: async url => url.includes('/token?') ? auth() : url.endsWith('/session') ? session() : new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  await client.login('x', 'y'); await assert.rejects(client.api('/reports'), /limite/); client.clear();
});
