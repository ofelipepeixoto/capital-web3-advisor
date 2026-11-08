/** Offline HTTP-contract tests. Database authorization is mocked here, not certified. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "../supabase/functions/advisory-api/index.ts";
import { COFRE_CONTROL_IDS, buildCofreReport } from "../supabase/functions/advisory-api/cofre.ts";

const BASE = "https://synthetic-project.supabase.co";
const ORIGIN = "https://homolog.capitalweb3.example";
const USER = "10000000-0000-0000-0000-000000000011";
const CLIENT = "10000000-0000-0000-0000-000000000001";
const WORKSPACE = "11000000-0000-0000-0000-000000000001";
const CASE = "20000000-0000-0000-0000-000000000001";
const KEY = "90000000-0000-0000-0000-000000000001";
const VERSION = "40000000-0000-0000-0000-000000000001";
const TOKEN = "synthetic.jwt.signature";
const config = { SUPABASE_URL: BASE, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_only", ADVISORY_ALLOWED_ORIGINS: ORIGIN, COFRE_PARTIAL_ENABLED: 'true' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function setup({ auth = { id: USER, is_anonymous: false }, authStatus = 200, data = [], dbStatus = 200 } = {}) {
  const calls = [];
  const handler = createHandler((name) => config[name], async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith("/auth/v1/user") ? reply(auth, authStatus) : reply(data, dbStatus);
  });
  return { handler, calls };
}
function request(path, { method = "GET", body, authenticated = true } = {}) {
  return new Request(BASE + "/functions/v1/advisory-api" + path, { method,
    headers: { origin: ORIGIN, ...(authenticated ? { authorization: "Bearer " + TOKEN } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function intake() {
  return { schema_version: "cofre-intake-0.1", synthetic: true,
    profile: { objective: "organize", experience: "beginner", liquidity: "long_term", loss_capacity: "discretionary" },
    consents: { assessment: true, storage: true, external_sources: false, notifications: false },
    controls: Object.fromEntries(COFRE_CONTROL_IDS.map((id) => [id,
      { answer: id === "secret_exposure" ? "no" : "yes", evidence: "declared" }])),
    inventory: [{ category: "vault", network: "evm", custody: "self" }] };
}
function createBody() { return { workspace_id: WORKSPACE, client_user_id: CLIENT, idempotency_key: KEY }; }
function saveBody() { return { intake: intake(), expected_revision: 0, idempotency_key: KEY }; }

test("COFRE routes require nonanonymous Supabase Auth before roster or data access", async () => {
  for (const [path, method, body] of [
    ["/cofre/workspaces", "GET", undefined],
    ["/cofre/cases", "POST", createBody()],
    [`/cofre/cases/${CASE}/intake`, "GET", undefined],
    [`/cofre/cases/${CASE}/intake`, "POST", saveBody()],
  ]) {
    const missing = setup();
    const denied = await missing.handler(request(path, { method, body, authenticated: false }));
    assert.equal(denied.status, 401); assert.equal(missing.calls.length, 0);
    const anonymous = setup({ auth: { id: USER, is_anonymous: true } });
    assert.equal((await anonymous.handler(request(path, { method, body }))).status, 401);
    assert.equal(anonymous.calls.length, 1);
  }
});

test("empty COFRE roster gives no invented workspace or identity", async () => {
  const { handler, calls } = setup({ data: [] });
  const result = await handler(request("/cofre/workspaces"));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).data, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, "Bearer " + TOKEN);
  assert.equal(calls[1].init.headers["Accept-Profile"], "capital_web3");
  assert.equal(calls[1].init.headers["Content-Profile"], "capital_web3");
});

test("intake read uses the fixed case and exposes no hidden revision when RLS returns nothing", async () => {
  const row = { case_id: CASE, revision: 2, intake: intake(), report_version_id: VERSION,
    created_at: "2026-10-17T20:00:00.000Z" };
  const found = setup({ data: [row] });
  const result = await found.handler(request(`/cofre/cases/${CASE}/intake`));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).data, row);
  assert.equal(found.calls[1].url, BASE + "/rest/v1/cofre_intakes?select=case_id,revision,intake,report_version_id,created_at&case_id=eq." + CASE + "&order=revision.desc&limit=1");
  assert.equal(found.calls[1].init.headers.Authorization, "Bearer " + TOKEN);
  const empty = setup({ data: [] });
  const missing = await empty.handler(request(`/cofre/cases/${CASE}/intake`));
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).data, null);
  const malformed = setup({ data: { intake: "fictional_private_marker" } });
  const unavailable = await malformed.handler(request(`/cofre/cases/${CASE}/intake`));
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes("fictional_private_marker"));
});

test("database denial for absent roster and missing case share an opaque response", async () => {
  for (const [path, body] of [["/cofre/cases", createBody()], [`/cofre/cases/${CASE}/intake`, saveBody()]]) {
    const { handler } = setup({ data: { code: "42501", message: "fictional_private_roster_information" }, dbStatus: 403 });
    const result = await handler(request(path, { method: "POST", body }));
    assert.equal(result.status, 404);
    const text = await result.text();
    assert.ok(!text.includes("fictional_private_roster_information"));
    assert.ok(!text.includes(TOKEN));
    assert.match(text, /resource_unavailable/);
  }
});

test("COFRE creation only supplies workspace and chosen client to fixed server RPC", async () => {
  const { handler, calls } = setup({ data: { case_id: CASE } });
  const result = await handler(request("/cofre/cases", { method: "POST", body: createBody() }));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).data, { case_id: CASE });
  assert.equal(calls[1].url, BASE + "/rest/v1/rpc/advisory_create_cofre_case");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    p_workspace_id: WORKSPACE, p_client_user_id: CLIENT, p_idempotency_key: KEY,
  });
  assert.equal(calls[1].init.headers.Authorization, "Bearer " + TOKEN);
});

test("COFRE save computes report on server and keeps review pending", async () => {
  const body = saveBody();
  const { handler, calls } = setup({ data: { case_id: CASE, revision: 1, report_version_id: VERSION } });
  const result = await handler(request(`/cofre/cases/${CASE}/intake`, { method: "POST", body }));
  assert.equal(result.status, 200);
  assert.equal(calls[1].url, BASE + "/rest/v1/rpc/advisory_save_cofre_intake");
  const sent = JSON.parse(calls[1].init.body);
  assert.deepEqual(Object.keys(sent).sort(), ["p_case_id", "p_content", "p_expected_revision", "p_idempotency_key", "p_intake"].sort());
  assert.equal(sent.p_case_id, CASE);
  assert.equal(sent.p_expected_revision, 0);
  assert.equal(sent.p_idempotency_key, KEY);
  assert.deepEqual(sent.p_intake, body.intake);
  assert.deepEqual(sent.p_content, buildCofreReport(body.intake, sent.p_content.as_of));
  assert.equal(sent.p_content.human_review.approved, false);
  assert.equal(sent.p_content.human_review.status, "pending");
  assert.equal(sent.p_actor_user_id, undefined);
});

test("API does not let caller forge report, approval, user identity or secret fields", async () => {
  const marker = "fictional_private_marker_do_not_echo";
  for (const [path, makeBody] of [
    ["/cofre/cases", () => ({ ...createBody(), actor_user_id: USER })],
    ["/cofre/cases", () => ({ ...createBody(), reviewer_user_id: USER })],
    [`/cofre/cases/${CASE}/intake`, () => ({ ...saveBody(), content: { approved: true, summary: marker } })],
    [`/cofre/cases/${CASE}/intake`, () => ({ ...saveBody(), as_of: "2020-01-01T00:00:00.000Z" })],
    [`/cofre/cases/${CASE}/intake`, () => { const body = saveBody(); body.intake.seed = marker; return body; }],
    [`/cofre/cases/${CASE}/intake`, () => { const body = saveBody(); body.intake.controls.backup_offline.evidence = "automatically_verified"; return body; }],
    [`/cofre/cases/${CASE}/intake`, () => { const body = saveBody(); body.intake.synthetic = false; return body; }],
  ]) {
    const { handler, calls } = setup();
    const result = await handler(request(path, { method: "POST", body: makeBody() }));
    assert.equal(result.status, 400);
    assert.equal(calls.length, 1);
    assert.ok(!(await result.text()).includes(marker));
  }
});

test("API bounds expected revision and identifiers before any database operation", async () => {
  for (const body of [
    { ...saveBody(), expected_revision: -1 },
    { ...saveBody(), expected_revision: 1.5 },
    { ...saveBody(), expected_revision: "0" },
    { ...saveBody(), idempotency_key: "not-a-uuid" },
  ]) {
    const { handler, calls } = setup();
    assert.equal((await handler(request(`/cofre/cases/${CASE}/intake`, { method: "POST", body }))).status, 400);
    assert.equal(calls.length, 1);
  }
  const { handler, calls } = setup();
  assert.equal((await handler(request("/cofre/cases/not-a-uuid/intake"))).status, 400);
  assert.equal(calls.length, 1);
});

test("critical reported exposure reaches storage as blocked draft, never auto approval", async () => {
  const body = saveBody(); body.intake.controls.secret_exposure.answer = "yes";
  const { handler, calls } = setup({ data: { case_id: CASE, revision: 1, report_version_id: VERSION } });
  const result = await handler(request(`/cofre/cases/${CASE}/intake`, { method: "POST", body }));
  assert.equal(result.status, 200);
  const report = JSON.parse(calls[1].init.body).p_content;
  assert.equal(report.status, "blocked");
  assert.equal(report.human_review.approved, false);
  assert.equal(report.plan[0].priority, "P0");
  assert.equal(calls.filter((item) => /publish|review_report/.test(item.url)).length, 0);
});

test("stale revision or reused key conflict does not masquerade as successful save", async () => {
  const { handler, calls } = setup({ data: { code: "23505", message: "fictional_private_conflict_detail" }, dbStatus: 409 });
  const result = await handler(request(`/cofre/cases/${CASE}/intake`, { method: "POST", body: saveBody() }));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error, "state_conflict");
  assert.equal(calls.length, 2);
});

test('partial intake accepts only consented closed synthetic records with honest gaps', async () => {
  const partial = intake(); partial.profile.objective = ''; partial.profile.experience = ''; partial.inventory[0].category = '';
  const body = { intake: partial, expected_revision: 0, base_revision: 0, idempotency_key: KEY };
  const h = setup({ data: { revision: 1, base_revision: 0 } });
  assert.equal((await h.handler(request(`/cofre/cases/${CASE}/partial`, {method: 'POST', body}))).status, 200);
  const sent = JSON.parse(h.calls[1].init.body); assert.equal(sent.p_intake.profile.objective, '');
  assert.equal(sent.p_intake.inventory[0].category, '');
  for (const mutate of [b => { b.intake.seed='secret'; }, b => { b.intake.consents.storage=false; }, b => { b.base_revision=-1; }]) {
    const changed=JSON.parse(JSON.stringify(body)); mutate(changed); const test=setup();
    assert.equal((await test.handler(request(`/cofre/cases/${CASE}/partial`, {method:'POST',body:changed}))).status, 400);
    assert.equal(test.calls.length, 1);
  }
});

test('synthetic journey exercise requires current staff and returns no private roster', async () => {
  for (const role of ['analyst','reviewer','publisher']) {
    const {handler,calls}=setup({data:[{user_id:USER,member_role:role,display_name:'private'}]});
    const res=await handler(request('/cofre/journeys'));assert.equal(res.status,200);
    const body=await res.json();assert.equal(body.data.length,4);assert.ok(!JSON.stringify(body).includes('private'));
    assert.ok(calls[1].url.endsWith('/rest/v1/rpc/advisory_cofre_workspaces'));
  }
  for(const data of [[],[{user_id:CLIENT,member_role:'analyst'}],[{user_id:USER,member_role:'client'}]]) {
    const res=await setup({data}).handler(request('/cofre/journeys'));assert.equal(res.status,404);
  }
  const anon=setup({auth:{id:USER,is_anonymous:true}});assert.equal((await anon.handler(request('/cofre/journeys'))).status,401);
  const malformed=setup({data:{user_id:USER}});assert.equal((await malformed.handler(request('/cofre/journeys'))).status,503);
});

test('synthetic exercise preview rejects real or extraneous data and never persists', async () => {
  const env=setup({data:[{user_id:USER,member_role:'analyst'}]});
  const catalog=(await (await env.handler(request('/cofre/journeys'))).json()).data;
  const j=catalog.find(x=>x.id==='rastro');
  const body={schema_version:'journey-intake-0.1',synthetic:true,journey:j.id,
    responses:Object.fromEntries(j.stages.map(k=>[k,{state:'not_assessed',evidence:'none'}]))};
  const res=await env.handler(request('/cofre/journeys/preview',{method:'POST',body}));
  const result=await res.json();assert.equal(res.status,200);assert.equal(result.data.status,'needs_input');
  assert.ok(!('score' in result.data));assert.equal(env.calls.length,4,'each request uses Auth and staff roster only');
  const forgedReview = structuredClone(body); forgedReview.responses[j.stages[0]] = {state:'human_reviewed',evidence:'human_reviewed'};
  const forgedGap = structuredClone(body); forgedGap.responses[j.stages[0]] = {state:'gap',evidence:'human_reviewed'};
  for (const bad of [{...body,synthetic:false},{...body,secret:'private_marker'}, {...body,journey:'__proto__'}, forgedReview, forgedGap]) {
    const r=await env.handler(request('/cofre/journeys/preview',{method:'POST',body:bad}));assert.equal(r.status,400);assert.ok(!(await r.text()).includes('private_marker'));
  }
});

test('partial flag is disabled unless explicitly enabled, even if RPC is absent', async () => {
  const disabled={...config}; delete disabled.COFRE_PARTIAL_ENABLED; const calls=[];
  const handler=createHandler(name=>disabled[name],async (url,init)=>{calls.push(String(url)); return String(url).endsWith('/auth/v1/user')?reply({id:USER,is_anonymous:false}):reply({code:'PGRST202'},404);});
  const result=await handler(request(`/cofre/cases/${CASE}/partial`));
  assert.equal(result.status,503); assert.equal(calls.length,1);
});

test('partial capacity is reported without echoing private upstream response', async () => {
  const h=setup({data:{code:'P0001',message:'partial receipt capacity reached',details:'private'},dbStatus:400});
  const body={intake:intake(),expected_revision:0,base_revision:0,idempotency_key:KEY};
  const response=await h.handler(request(`/cofre/cases/${CASE}/partial`, {method:'POST',body}));
  assert.equal(response.status,429); assert.ok(!(await response.text()).includes('private'));
});

test('stale restore permits only revision metadata and denies forged intake or foreign state', async () => {
  const body={expected_revision:2,base_revision:1,idempotency_key:KEY}; const h=setup({data:{revision:3,base_revision:1}});
  const response=await h.handler(request(`/cofre/cases/${CASE}/partial/restore`,{method:'POST',body}));
  assert.equal(response.status,200); const sent=JSON.parse(h.calls[1].init.body);
  assert.deepEqual(Object.keys(sent).sort(),['p_base_revision','p_case_id','p_expected_revision','p_idempotency_key'].sort());
  const forged=setup(); assert.equal((await forged.handler(request(`/cofre/cases/${CASE}/partial/restore`,{method:'POST',body:{...body,intake:intake()}}))).status,400); assert.equal(forged.calls.length,1);
  const denied=setup({data:{code:'42501',message:'private'},dbStatus:403}); assert.equal((await denied.handler(request(`/cofre/cases/${CASE}/partial/restore`,{method:'POST',body}))).status,404);
});

test('receipt capacity also fails closed for restore', async () => {
  const h=setup({data:{code:'P0001',message:'partial receipt capacity reached',details:'private'},dbStatus:400});
  const response=await h.handler(request(`/cofre/cases/${CASE}/partial/restore`, {method:'POST',body:{expected_revision:1,base_revision:1,idempotency_key:KEY}}));
  assert.equal(response.status,429); assert.ok(!(await response.text()).includes('private'));
});

test('capability requires the database switch as well as the Edge flag', async () => {
  const calls=[]; const handler=createHandler(name=>config[name],async (url,init)=>{
    calls.push(String(url)); if(String(url).endsWith('/auth/v1/user')) return reply({id:USER,is_anonymous:false});
    if(String(url).endsWith('/rpc/advisory_access_requirements')) return reply({mfa_required:false,assurance_level:'aal1'});
    if(String(url).endsWith('/rpc/advisory_cofre_partial_capability')) return reply(false);
    throw Error('unexpected request');
  });
  const response=await handler(request('/access-requirements')); assert.equal(response.status,200);
  assert.equal((await response.json()).partial_intake_enabled,false); assert.equal(calls.length,3);
});
test('Lite routes enforce authenticated request, explicit consent and closed ten-signal schema', async () => {
  const { SIGNAL_IDS } = await import('../supabase/functions/advisory-api/cofre-lite-rules.ts');
  const draft = { schema_version: 'cofre-lite-signals-0.1', synthetic: true,
    consents: { assessment: true, storage: true }, signals: Object.fromEntries(SIGNAL_IDS.map(k => [k, 'unknown'])) };
  const path = `/cofre/cases/${CASE}/lite-signals`;
  const body = { intake: draft, expected_revision: 0, idempotency_key: KEY };
  const h=setup({data:{revision:1}});
  assert.equal((await h.handler(request(path,{method:'POST',body,authenticated:false}))).status,401);
  assert.equal((await h.handler(request(path,{method:'POST',body}))).status,200);
  assert.ok(h.calls.at(-1).url.endsWith('/rest/v1/rpc/advisory_lite_signals_save'));
  for (const invalid of [ {...draft, secret: 'marker'}, {...draft,consents:{assessment:true,storage:false}},
    {...draft,signals:{...draft.signals, urgency:'unbounded text'}}, {...draft,signals:{...draft.signals, extra:'marker'}} ]) {
    const before=h.calls.length; const res=await h.handler(request(path,{method:'POST',body:{...body,intake:invalid}}));
    assert.equal(res.status,400); assert.equal(h.calls.length,before+1); assert.ok(!(await res.text()).includes('marker'));
  }
});

test('Lite receipt quota maps to a specific sanitized limit even when upstream responds 500', async () => {
  const { SIGNAL_IDS } = await import('../supabase/functions/advisory-api/cofre-lite-rules.ts');
  const body = {intake:{schema_version:'cofre-lite-signals-0.1',synthetic:true,consents:{assessment:true,storage:true},signals:Object.fromEntries(SIGNAL_IDS.map(k=>[k,'unknown']))},expected_revision:0,idempotency_key:KEY};
  const { handler }=setup({data:{code:'54000',message:'private marker'},dbStatus:500});
  const result=await handler(request(`/cofre/cases/${CASE}/lite-signals`,{method:'POST',body}));
  assert.equal(result.status,429); const text=await result.text(); assert.match(text,/lite_save_limit/);assert.ok(!text.includes('private marker'));
});


test('Lite 0.2 saves full closed enum intake through scoped RPC; missing and injected values denied', async () => {
  const { SIGNAL_IDS } = await import('../supabase/functions/advisory-api/cofre-lite-rules.ts');
  const { LITE_CONTROL_IDS } = await import('../supabase/functions/advisory-api/cofre-lite-intake.mjs');
  const draft = {schema_version:'cofre-lite-intake-0.2', synthetic:true, consents:{assessment:true,storage:true},
    profile:{experience:'unknown'}, controls:Object.fromEntries(LITE_CONTROL_IDS.map(id=>[id,'unknown'])),
    signals:Object.fromEntries(SIGNAL_IDS.map(id=>[id,'unknown']))};
  const body={intake:draft,expected_revision:0,idempotency_key:KEY,legacy_revision:null};
  const path=`/cofre/cases/${CASE}/lite-intake`, h=setup({data:{revision:1}});
  assert.equal((await h.handler(request(path,{method:'POST',body,authenticated:false}))).status,401);
  assert.equal((await h.handler(request(path,{method:'POST',body}))).status,200);
  assert.ok(h.calls.at(-1).url.endsWith('/rest/v1/rpc/advisory_lite_intake_save'));
  for (const invalid of [{...draft,profile:{experience:null}}, {...draft,controls:{...draft.controls,secret_exposure:'not_applicable'}},
    {...draft,controls:{...draft.controls,extra:'secret-marker'}}, {...draft,consents:{assessment:true,storage:false}},
    {...draft,signals:{...draft.signals,urgency:'secret-marker'}}]) {
    const before=h.calls.length, res=await h.handler(request(path,{method:'POST',body:{...body,intake:invalid}}));
    assert.equal(res.status,400); assert.equal(h.calls.length,before+1); assert.ok(!(await res.text()).includes('secret-marker'));
  }
});
