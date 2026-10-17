/** Offline HTTP-contract tests: Auth/REST are simulated; these do not certify Supabase. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "../supabase/functions/advisory-api/index.ts";

const USER = "10000000-0000-0000-0000-000000000011";
const VERSION = "40000000-0000-0000-0000-000000000001";
const PUBLICATION = "60000000-0000-0000-0000-000000000001";
const IDEMPOTENCY = "90000000-0000-0000-0000-000000000001";
const CLIENT = "10000000-0000-0000-0000-000000000001";
const TOKEN = "synthetic.jwt.signature";
const ORIGIN = "https://homolog.capitalweb3.example";
const SHA = "a".repeat(64);
const MANIFEST = "b".repeat(64);
const BASE = "https://synthetic-project.supabase.co";
const defaults = {
  SUPABASE_URL: BASE,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_only",
  ADVISORY_ALLOWED_ORIGINS: ORIGIN,
};

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function setup({ env = {}, auth = { id: USER, is_anonymous: false }, authStatus = 200,
  db = [], dbStatus = 200, fail = false, handlerOptions = {} } = {}) {
  const calls = [];
  const handler = createHandler((name) => ({ ...defaults, ...env })[name], async (url, init) => {
    calls.push({ url, init });
    if (fail) throw new Error("provider diagnostic contains a sensitive token");
    return String(url).endsWith("/auth/v1/user") ? response(auth, authStatus) : response(db, dbStatus);
  }, handlerOptions);
  return { handler, calls };
}
function request(path = "/reports", { method = "GET", body, headers = {} } = {}) {
  return new Request("https://synthetic-project.supabase.co/functions/v1/advisory-api" + path, {
    method, headers: { authorization: "Bearer " + TOKEN, origin: ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
function reviewBody() {
  return { decision: "approved", expected_content_sha256: SHA,
    expected_manifest_sha256: MANIFEST, private_notes: "Synthetic review", idempotency_key: IDEMPOTENCY };
}
function publishBody() {
  return { recipient_user_ids: [CLIENT], expected_content_sha256: SHA,
    expected_manifest_sha256: MANIFEST, expires_at: null, idempotency_key: IDEMPOTENCY };
}

test("database schema is fixed server-side for reads and RPC writes", async () => {
  for (const [path, options] of [
    ['/reports', {}],
    ['/reports/' + VERSION + '/review', { method: 'POST', body: reviewBody() }],
  ]) {
    const { handler, calls } = setup();
    const result = await handler(request(path, { ...options,
      headers: { 'Accept-Profile': 'public', 'Content-Profile': 'private' } }));
    assert.equal(result.status, 200);
    assert.equal(calls[0].init.headers['Accept-Profile'], undefined);
    assert.equal(calls[0].init.headers['Content-Profile'], undefined);
    assert.equal(calls[1].init.headers['Accept-Profile'], 'capital_web3');
    assert.equal(calls[1].init.headers['Content-Profile'], 'capital_web3');
    assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + TOKEN);
  }
});

test("recipient selection reads active case membership through the same user JWT", async () => {
  const { handler, calls } = setup({ db: [{ user_id: CLIENT }] });
  const result = await handler(request('/cases/' + VERSION + '/recipients'));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).data, [{ user_id: CLIENT }]);
  assert.ok(calls[1].url.includes('advisory_case_clients?select=user_id&active=eq.true&case_id=eq.' + VERSION));
  assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + TOKEN);
});
test("recipient selection rejects malformed case identifiers", async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(request('/cases/not-a-uuid/recipients'))).status, 400);
  assert.equal(calls.length, 1);
});

test("configuration closes before network if the origin list is absent", async () => {
  const { handler, calls } = setup({ env: { ADVISORY_ALLOWED_ORIGINS: "" } });
  const result = await handler(request());
  assert.equal(result.status, 503); assert.equal(calls.length, 0);
});
test("configuration rejects metadata addresses, arbitrary hosts, URL credentials and paths", async () => {
  for (const url of ["http://169.254.169.254", "https://attacker.example", "https://u:p@synthetic-project.supabase.co", BASE + "/path", BASE + "?redirect=x"]) {
    const { handler, calls } = setup({ env: { SUPABASE_URL: url } });
    assert.equal((await handler(request())).status, 503); assert.equal(calls.length, 0);
  }
});
test("local integration opt-in accepts only the fixed CLI endpoint and cannot be enabled through environment", async () => {
  const denied = setup({ env: { SUPABASE_URL: "http://127.0.0.1:54321", ADVISORY_LOCAL_TEST: "true" } });
  assert.equal((await denied.handler(request())).status, 503); assert.equal(denied.calls.length, 0);
  const allowed = setup({ env: { SUPABASE_URL: "http://127.0.0.1:54321" }, handlerOptions: { localTest: true } });
  assert.equal((await allowed.handler(request())).status, 200);
  assert.equal(allowed.calls[0].url, "http://127.0.0.1:54321/auth/v1/user");
  for (const url of ["http://169.254.169.254:54321", "http://127.0.0.1:54322", "http://localhost:54321"]) {
    const item = setup({ env: { SUPABASE_URL: url }, handlerOptions: { localTest: true } });
    assert.equal((await item.handler(request())).status, 503); assert.equal(item.calls.length, 0);
  }
});
test("service-role keys cannot form the downstream client", async () => {
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  for (const key of ["sb_secret_synthetic", "head." + payload + ".sig"]) {
    const { handler, calls } = setup({ env: { SUPABASE_PUBLISHABLE_KEY: key } });
    assert.equal((await handler(request())).status, 503); assert.equal(calls.length, 0);
  }
});
test("legacy anon configuration remains supported without using it as user bearer", async () => {
  const payload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
  const { handler, calls } = setup({ env: { SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_ANON_KEY: "head." + payload + ".sig" } });
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + TOKEN);
  assert.equal(calls[0].init.headers.apikey, "head." + payload + ".sig");
});
test("disallowed and null browser origins have no CORS authorization", async () => {
  for (const origin of ["https://evil.example", "null"]) {
    const { handler, calls } = setup();
    const result = await handler(request("/reports", { headers: { origin } }));
    assert.equal(result.status, 403); assert.equal(result.headers.has("access-control-allow-origin"), false);
    assert.equal(calls.length, 0);
  }
});
test("allowed preflight sends exact origin and no credentials, without contacting Auth", async () => {
  const { handler, calls } = setup();
  const result = await handler(request("/reports", { method: "OPTIONS", headers: {
    "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type, apikey",
  } }));
  assert.equal(result.status, 204); assert.equal(await result.text(), "");
  assert.equal(result.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(result.headers.has("access-control-allow-credentials"), false); assert.equal(calls.length, 0);
});
test("preflight rejects unapproved methods and identity headers", async () => {
  for (const headers of [{ "access-control-request-method": "DELETE" }, {
    "access-control-request-method": "POST", "access-control-request-headers": "x-user-id",
  }]) {
    const { handler, calls } = setup();
    assert.equal((await handler(request("/reports", { method: "OPTIONS", headers }))).status, 403);
    assert.equal(calls.length, 0);
  }
});
test("bearer is mandatory even if caller provides an API key or forged identity header", async () => {
  for (const authorization of ["", "Bearer sb_publishable_fake", "Bearer not-a-jwt"]) {
    const { handler, calls } = setup();
    assert.equal((await handler(request("/reports", { headers: {
      authorization, apikey: "sb_publishable_fake", "x-user-id": USER, "x-role": "admin",
    } }))).status, 401);
    assert.equal(calls.length, 0);
  }
});
test("Auth rejects the bearer before any database read", async () => {
  const { handler, calls } = setup({ auth: { message: "private diagnostic" }, authStatus: 401 });
  const result = await handler(request());
  assert.equal(result.status, 401); assert.equal(calls.length, 1);
  assert.doesNotMatch(await result.text(), /private diagnostic/);
});
test("anonymous Auth accounts and malformed user responses are denied", async () => {
  for (const auth of [{ id: USER, is_anonymous: true }, { id: "attacker", is_anonymous: false }, { id: USER }]) {
    const { handler, calls } = setup({ auth });
    assert.equal((await handler(request())).status, 401); assert.equal(calls.length, 1);
  }
});
test("database uses exactly the Auth-verified bearer, with timeout and redirects disabled", async () => {
  const { handler, calls } = setup({ db: [{ id: VERSION }] });
  const result = await handler(request());
  assert.equal(result.status, 200); assert.equal(calls.length, 2);
  assert.equal(calls[0].url, BASE + "/auth/v1/user");
  for (const call of calls) {
    assert.equal(call.init.headers.Authorization, "Bearer " + TOKEN);
    assert.equal(call.init.redirect, "error"); assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(call.init.headers.apikey, defaults.SUPABASE_PUBLISHABLE_KEY);
  }
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("caller supplied subject and role never appear in session assignment lookup", async () => {
  const { handler, calls } = setup({ db: [{ case_id: VERSION, staff_role: "reviewer" }] });
  const result = await handler(request("/session", { headers: { "x-user-id": CLIENT, "x-role": "admin" } }));
  const body = await result.json();
  assert.equal(body.user_id, USER); assert.equal(body.assignments[0].staff_role, "reviewer");
  assert.doesNotMatch(calls[1].url, new RegExp(CLIENT));
});
test("unavailable and denied report content/download have the same public status", async () => {
  for (const suffix of ["", "/download"]) {
    for (const options of [{ db: [] }, { db: { code: "42501", message: "private case exists" }, dbStatus: 403 }]) {
      const { handler } = setup(options);
      const result = await handler(request("/reports/" + VERSION + suffix));
      assert.equal(result.status, 404); assert.equal((await result.json()).error, "resource_unavailable");
    }
  }
});
test("JSON download only includes the selected client-safe row, with safe filename", async () => {
  const row = { id: VERSION, content: { title: "Synthetic client-safe diagnosis" }, content_sha256: SHA };
  const { handler, calls } = setup({ db: [row] });
  const result = await handler(request("/reports/" + VERSION + "/download"));
  assert.equal(result.status, 200); assert.deepEqual((await result.json()).data, row);
  assert.equal(result.headers.get("content-disposition"), 'attachment; filename="diagnostico-' + VERSION + '.json"');
  assert.doesNotMatch(calls[1].url, /private_notes|human_review/);
});
test("review binds the exact human-observed content and manifest digests", async () => {
  const { handler, calls } = setup({ db: { review_id: VERSION } });
  const result = await handler(request("/reports/" + VERSION + "/review", { method: "POST", body: reviewBody() }));
  assert.equal(result.status, 200);
  assert.equal(calls[1].url, BASE + "/rest/v1/rpc/advisory_review_report");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    p_report_version_id: VERSION, p_decision: "approved", p_expected_content_sha256: SHA,
    p_expected_manifest_sha256: MANIFEST, p_private_notes: "Synthetic review", p_idempotency_key: IDEMPOTENCY,
  });
});
test("review does not accept caller-owned actor IDs, missing digests or malformed hashes", async () => {
  const bodies = [{ ...reviewBody(), reviewer_user_id: CLIENT }, { ...reviewBody(), expected_manifest_sha256: "" },
    { ...reviewBody(), expected_content_sha256: SHA.toUpperCase() }, { ...reviewBody(), idempotency_key: "retry" }];
  for (const body of bodies) {
    const { handler, calls } = setup();
    assert.equal((await handler(request("/reports/" + VERSION + "/review", { method: "POST", body }))).status, 400);
    assert.equal(calls.length, 1);
  }
});
test("publication passes UUID idempotency, recipients and both observed hashes to a single RPC", async () => {
  const { handler, calls } = setup({ db: { publication_id: PUBLICATION } });
  const result = await handler(request("/reports/" + VERSION + "/publish", { method: "POST", body: publishBody() }));
  assert.equal(result.status, 200); assert.equal(calls.length, 2);
  assert.equal(calls[1].url, BASE + "/rest/v1/rpc/advisory_publish_report");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    p_report_version_id: VERSION, p_recipient_user_ids: [CLIENT], p_expected_content_sha256: SHA,
    p_expected_manifest_sha256: MANIFEST, p_expires_at: null, p_idempotency_key: IDEMPOTENCY,
  });
});
test("publication rejects duplicate recipients and uncontrolled expiry or actor fields", async () => {
  const bodies = [{ ...publishBody(), recipient_user_ids: [CLIENT, CLIENT] }, { ...publishBody(), recipient_user_ids: [] },
    { ...publishBody(), expires_at: "in one hour" }, { ...publishBody(), publisher_user_id: CLIENT }];
  for (const body of bodies) {
    const { handler, calls } = setup();
    assert.equal((await handler(request("/reports/" + VERSION + "/publish", { method: "POST", body }))).status, 400);
    assert.equal(calls.length, 1);
  }
});
test("database stale-hash/review conflict returns safe 409 without recomputing hashes", async () => {
  const { handler, calls } = setup({ db: { code: "23514", message: "sensitive private note / stale hash" }, dbStatus: 400 });
  const result = await handler(request("/reports/" + VERSION + "/publish", { method: "POST", body: publishBody() }));
  assert.equal(result.status, 409); assert.equal(calls.length, 2);
  assert.deepEqual((await result.json()).error, "state_conflict");
});
test("revocation preserves caller's observed hashes and delegated recipient selection", async () => {
  const { handler, calls } = setup({ db: { revocation_id: IDEMPOTENCY } });
  const result = await handler(request("/publications/" + PUBLICATION + "/revoke", { method: "POST", body: {
    recipient_user_id: null, reason: "Synthetic withdrawal", expected_content_sha256: SHA,
    expected_manifest_sha256: MANIFEST, idempotency_key: IDEMPOTENCY,
  } }));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    p_publication_id: PUBLICATION, p_recipient_user_id: null, p_reason: "Synthetic withdrawal",
    p_expected_content_sha256: SHA, p_expected_manifest_sha256: MANIFEST, p_idempotency_key: IDEMPOTENCY,
  });
});
test("receipt never accepts caller-supplied identity or a strategy approval flag", async () => {
  const { handler, calls } = setup();
  const result = await handler(request("/publications/" + PUBLICATION + "/receipt", { method: "POST", body: {
    user_id: CLIENT, approve_strategy: true,
  } }));
  assert.equal(result.status, 400); assert.equal(calls.length, 1);
});
test("receipt dispatches only publication UUID, leaving identity/authorization/idempotency to DB", async () => {
  const { handler, calls } = setup({ db: { receipt_id: IDEMPOTENCY } });
  const result = await handler(request("/publications/" + PUBLICATION + "/receipt", { method: "POST", body: {} }));
  assert.equal(result.status, 200);
  assert.equal(calls[1].url, BASE + "/rest/v1/rpc/advisory_record_receipt");
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_publication_id: PUBLICATION });
});
test("revoked receipt access returns resource-unavailable from scoped database denial", async () => {
  const { handler } = setup({ db: { code: "42501", message: "revoked" }, dbStatus: 403 });
  const result = await handler(request("/publications/" + PUBLICATION + "/receipt", { method: "POST", body: {} }));
  assert.equal(result.status, 404); assert.equal((await result.json()).error, "resource_unavailable");
});
test("body byte limits reject oversized JSON even without Content-Length", async () => {
  const { handler, calls } = setup();
  const result = await handler(request("/reports/" + VERSION + "/review", { method: "POST",
    body: JSON.stringify({ ...reviewBody(), private_notes: "á".repeat(20000) }) }));
  assert.equal(result.status, 413); assert.equal(calls.length, 1);
});
test("a body stream that never finishes is cancelled at the request deadline", { timeout: 10000 }, async () => {
  const { handler, calls } = setup();
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = new Request("https://synthetic-project.supabase.co/functions/v1/advisory-api/reports/" + VERSION + "/review", {
    method: "POST", headers: { authorization: "Bearer " + TOKEN, origin: ORIGIN, "content-type": "application/json" },
    body: stream, duplex: "half",
  });
  const result = await handler(pending);
  assert.equal(result.status, 408); assert.equal((await result.json()).error, "request_timeout");
  assert.equal(cancelled, true); assert.equal(calls.length, 1);
});
test("malformed JSON and inappropriate media types never reach write RPC", async () => {
  for (const options of [{ body: "{broken" }, { body: reviewBody(), headers: { "content-type": "text/plain" } }]) {
    const { handler, calls } = setup();
    const result = await handler(request("/reports/" + VERSION + "/review", { method: "POST", ...options }));
    assert.ok([400, 415].includes(result.status)); assert.equal(calls.length, 1);
  }
});
test("transport/provider failures expose no provider diagnostic or bearer", async () => {
  const { handler } = setup({ fail: true });
  const result = await handler(request());
  assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /sensitive|synthetic.jwt.signature/);
});
test("server generates request IDs instead of reflecting caller text", async () => {
  const { handler } = setup();
  const result = await handler(request("/reports", { headers: { "x-request-id": "private-secret" } }));
  const body = await result.json();
  assert.match(body.request_id, /^[a-f0-9-]{36}$/);
  assert.equal(result.headers.get("x-request-id"), body.request_id);
  assert.doesNotMatch(JSON.stringify(body), /private-secret/);
});
test("health reports configured mode only, without pretending to test the database", async () => {
  const { handler, calls } = setup();
  const result = await handler(request("/health", { headers: { authorization: "" } }));
  assert.equal(result.status, 200); assert.equal((await result.json()).status, "configured");
  const hosted = await handler(new Request("https://synthetic-project.supabase.co/advisory-api/health"));
  assert.equal(hosted.status, 200); assert.equal((await hosted.json()).status, "configured");
  assert.equal(calls.length, 0);
});
test("arbitrary query parameters and malformed object references do not reach database", async () => {
  for (const path of ["/reports?user_id=" + CLIENT, "/reports/not-a-uuid", "/reports/" + VERSION + "/execute"]) {
    const { handler, calls } = setup();
    const result = await handler(request(path));
    assert.ok([400, 404].includes(result.status)); assert.ok(calls.length <= 1);
  }
});
