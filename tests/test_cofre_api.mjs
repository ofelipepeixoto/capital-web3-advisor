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
const config = { SUPABASE_URL: BASE, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_only", ADVISORY_ALLOWED_ORIGINS: ORIGIN };
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
