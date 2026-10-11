/** Real local Supabase Auth/PostgREST/Storage. Never targets a cloud project.
 * Run after migrations, in a disposable CLI stack. Private status JSON is not logged.
 * Node 24 runs the actual API handler with native fetch, not a deployed Edge runtime.
 */
import { readFileSync, statSync } from "node:fs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createHandler } from "../../supabase/functions/advisory-api/index.ts";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
let assertions = 0;
class SafeTestFailure extends Error {}
function requireCondition(condition, label) {
  if (!condition) throw new SafeTestFailure(label);
}
function pass(label, condition) {
  requireCondition(condition, label);
  assertions += 1;
  console.log("PASS " + String(assertions).padStart(2, "0") + " " + label);
}
function uuid(value) {
  requireCondition(typeof value === "string" && UUID.test(value), "invalid synthetic identity");
  return value.toLowerCase();
}
function loadStatus() {
  const file = process.env.CAPITAL_SUPABASE_STATUS_FILE;
  requireCondition(typeof file === "string" && file.length > 0, "private local status file required");
  const meta = statSync(file);
  requireCondition(meta.isFile() && meta.size < 65536 && (meta.mode & 0o077) === 0,
    "local status file must be private and bounded");
  let status;
  try { status = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new SafeTestFailure("invalid local status JSON"); }
  requireCondition(status && status.API_URL === "http://127.0.0.1:54321", "only the fixed local API endpoint is allowed");
  requireCondition(typeof status.ANON_KEY === "string" && status.ANON_KEY.length > 20 &&
    typeof status.SERVICE_ROLE_KEY === "string" && status.SERVICE_ROLE_KEY.length > 20,
    "local CLI API keys are required");
  let database;
  try { database = new URL(status.DB_URL); } catch { throw new SafeTestFailure("invalid local database configuration"); }
  requireCondition(["postgres:", "postgresql:"].includes(database.protocol) &&
    database.hostname === "127.0.0.1" && database.port === "54322" &&
    database.pathname === "/postgres" && database.username === "postgres" &&
    !database.search && !database.hash, "only the fixed local database endpoint is allowed");
  return { ...status, database };
}

async function main() {
  const status = loadStatus();
  const base = status.API_URL;
  const origin = "https://homolog.capitalweb3.example";
  const fetchLocal = async (path, init = {}) => {
    requireCondition(/^\/(auth|rest|storage)\/v1\//.test(path), "unknown local endpoint");
    try { return await fetch(base + path, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }); }
    catch { throw new SafeTestFailure("local upstream unavailable"); }
  };
  const parsed = async (response) => {
    try { return await response.json(); } catch { throw new SafeTestFailure("local upstream returned invalid JSON"); }
  };
  const adminHeaders = { apikey: status.SERVICE_ROLE_KEY,
    Authorization: "Bearer " + status.SERVICE_ROLE_KEY, "Content-Type": "application/json" };
  const tag = randomBytes(8).toString("hex");
  const users = {};
  for (const role of ["ana", "rui", "clientA", "clientB", "authorB"]) {
    const email = "capital-homolog-" + tag + "-" + role.toLowerCase() + "@example.invalid";
    const password = randomBytes(36).toString("base64url");
    const created = await fetchLocal("/auth/v1/admin/users", {
      method: "POST", headers: adminHeaders,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    requireCondition(created.ok, "synthetic Auth account creation failed");
    const account = await parsed(created);
    const id = uuid(account.id);
    const login = await fetchLocal("/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: status.ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    requireCondition(login.ok, "synthetic Auth login failed");
    const session = await parsed(login);
    requireCondition(typeof session.access_token === "string" && session.user?.id === id,
      "real Auth session did not match its synthetic account");
    users[role] = { id, token: session.access_token };
  }
  pass("real Auth login for five synthetic accounts", Object.keys(users).length === 5);

  const ids = { caseA: randomUUID(), caseB: randomUUID(), reportA: randomUUID(), reportB: randomUUID(),
    versionA1: randomUUID(), versionA2: randomUUID(), versionB1: randomUUID(), asset: randomUUID() };
  const objectName = "homolog-" + tag + "/diagnostico.json";
  const bytes = Buffer.from(JSON.stringify({ title: "Synthetic client-safe diagnosis", mode: "homologation" }));
  const bytesDigest = createHash("sha256").update(bytes).digest("hex");
  // UUIDs come from the Auth server or crypto; strings below are controlled constants.
  // SQL is passed through stdin. Database credentials are environment-only and never logged.
  const fixtureSql = `begin;
insert into public.advisory_cases(id,client_safe_title,created_by) values
('${ids.caseA}','Synthetic case A','${users.ana.id}'),
('${ids.caseB}','Synthetic case B','${users.authorB.id}');
insert into public.advisory_case_staff(case_id,user_id,staff_role) values
('${ids.caseA}','${users.ana.id}','analyst'),('${ids.caseA}','${users.ana.id}','admin'),
('${ids.caseA}','${users.rui.id}','reviewer'),('${ids.caseA}','${users.rui.id}','publisher'),
('${ids.caseB}','${users.authorB.id}','analyst');
insert into public.advisory_case_clients(case_id,user_id) values
('${ids.caseA}','${users.clientA.id}'),('${ids.caseB}','${users.clientB.id}');
insert into public.advisory_reports(id,case_id,created_by) values
('${ids.reportA}','${ids.caseA}','${users.ana.id}'),
('${ids.reportB}','${ids.caseB}','${users.authorB.id}');
insert into public.advisory_report_versions(id,report_id,case_id,version_number,content,created_by) values
('${ids.versionA1}','${ids.reportA}','${ids.caseA}',1,'{"title":"Synthetic diagnosis A v1","status":"draft"}','${users.ana.id}'),
('${ids.versionA2}','${ids.reportA}','${ids.caseA}',2,'{"title":"Synthetic diagnosis A v2 unpublished","status":"draft"}','${users.ana.id}'),
('${ids.versionB1}','${ids.reportB}','${ids.caseB}',1,'{"title":"Synthetic diagnosis B v1","status":"draft"}','${users.authorB.id}');
insert into public.advisory_report_assets(id,report_version_id,case_id,bucket_id,object_name,bytes_sha256,mime_type) values
('${ids.asset}','${ids.versionA1}','${ids.caseA}','capital-web3-advisory','${objectName}','${bytesDigest}','application/json');
commit;
notify pgrst,'reload schema';`;
  const db = status.database;
  const seeded = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: fixtureSql, encoding: "utf8", timeout: 30000,
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: "54322", PGDATABASE: "postgres",
      PGUSER: "postgres", PGPASSWORD: decodeURIComponent(db.password), PGCONNECT_TIMEOUT: "10" },
  });
  requireCondition(!seeded.error && seeded.status === 0, "local synthetic SQL fixtures failed");
  pass("SQL fixtures with independent reviewer and two isolated cases", true);

  const upload = await fetchLocal("/storage/v1/object/capital-web3-advisory/" + objectName, {
    method: "POST", headers: { ...adminHeaders, "x-upsert": "false" }, body: bytes,
  });
  requireCondition(upload.ok, "private synthetic Storage upload failed");
  pass("private Storage contains actual synthetic bytes", true);

  const backendEnv = { SUPABASE_URL: base, SUPABASE_ANON_KEY: status.ANON_KEY,
    ADVISORY_ALLOWED_ORIGINS: origin };
  const handler = createHandler((name) => backendEnv[name], fetch, { localTest: true });
  const api = (role, path, body) => handler(new Request(base + "/functions/v1/advisory-api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer " + users[role].token, origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const result = async (role, path, body) => {
    const response = await api(role, path, body);
    return { status: response.status, body: await parsed(response) };
  };
  const downloadStorage = (role) => fetchLocal("/storage/v1/object/authenticated/capital-web3-advisory/" + objectName, {
    method: "GET", headers: { apikey: status.ANON_KEY, Authorization: "Bearer " + users[role].token },
  });
  const deniedStorage = (response) => !response.ok && response.status >= 400 && response.status < 500;
  const publicationPath = "/reports/" + ids.versionA1;

  const anaSession = await result("ana", "/session");
  pass("API verifies real Auth UID and database assignments", anaSession.status === 200 &&
    anaSession.body.user_id === users.ana.id && anaSession.body.assignments.some((row) => row.staff_role === "analyst"));
  const tokenParts = users.clientA.token.split(".");
  tokenParts[2] = (tokenParts[2][0] === "A" ? "B" : "A") + tokenParts[2].slice(1);
  const forgedJwt = await handler(new Request(base + "/functions/v1/advisory-api/reports", {
    headers: { authorization: "Bearer " + tokenParts.join("."), origin },
  }));
  pass("Auth rejects a real JWT with an adulterated signature", forgedJwt.status === 401);
  pass("client cannot read an unpublished report", (await result("clientA", publicationPath)).status === 404);
  pass("client cannot download unpublished Storage bytes", deniedStorage(await downloadStorage("clientA")));
  pass("unassigned reviewer cannot read the other case", (await result("rui", "/reports/" + ids.versionB1)).status === 404);
  const observed = await result("rui", publicationPath + "/review-package");
  requireCondition(observed.status === 200 && SHA.test(observed.body.data?.content_sha256) &&
    SHA.test(observed.body.data?.manifest_sha256), "review package retrieval failed");
  const packageData = observed.body.data;
  pass("review package binds the uploaded object's byte hash", packageData.assets.length === 1 &&
    packageData.assets[0].bytes_sha256 === bytesDigest);

  const review = { decision: "approved", expected_content_sha256: packageData.content_sha256,
    expected_manifest_sha256: packageData.manifest_sha256, private_notes: "Synthetic independent review",
    idempotency_key: randomUUID() };
  pass("author with admin assignment cannot approve own report",
    (await result("ana", publicationPath + "/review", review)).status === 404);
  const staleReview = { ...review, expected_manifest_sha256: "0".repeat(64), idempotency_key: randomUUID() };
  pass("stale observed manifest is rejected", (await result("rui", publicationPath + "/review", staleReview)).status === 409);
  const reviewed = await result("rui", publicationPath + "/review", review);
  requireCondition(reviewed.status === 200 && UUID.test(reviewed.body.data?.review_id), "independent human review RPC failed");
  pass("independent reviewer approves exact content and manifest", true);
  const retriedReview = await result("rui", publicationPath + "/review", review);
  pass("review retry returns the same review", retriedReview.status === 200 &&
    retriedReview.body.data.review_id === reviewed.body.data.review_id);
  const publish = { recipient_user_ids: [users.clientA.id], expected_content_sha256: packageData.content_sha256,
    expected_manifest_sha256: packageData.manifest_sha256, expires_at: null, idempotency_key: randomUUID() };
  pass("author with admin assignment cannot publish own report",
    (await result("ana", publicationPath + "/publish", publish)).status === 404);
  const published = await result("rui", publicationPath + "/publish", publish);
  requireCondition(published.status === 200 && UUID.test(published.body.data?.publication_id), "human publication RPC failed");
  const publication = published.body.data.publication_id;
  pass("publisher releases the reviewed version to its exact recipient", true);
  const retriedPublish = await result("rui", publicationPath + "/publish", publish);
  pass("publication retry returns the same publication", retriedPublish.status === 200 &&
    retriedPublish.body.data.publication_id === publication);
  const changedRetry = await result("rui", publicationPath + "/publish", {
    ...publish, expires_at: "2099-01-01T00:00:00Z",
  });
  pass("idempotency key cannot be reused for changed publication", changedRetry.status === 409);

  const aReports = await result("clientA", "/reports");
  pass("client sees only the published version", aReports.status === 200 &&
    aReports.body.data.length === 1 && aReports.body.data[0].id === ids.versionA1);
  pass("newer unpublished version remains hidden", (await result("clientA", "/reports/" + ids.versionA2)).status === 404);
  const aDownload = await result("clientA", publicationPath + "/download");
  pass("client downloads the published client-safe JSON", aDownload.status === 200 &&
    aDownload.body.data.id === ids.versionA1 && aDownload.body.data.content.title === "Synthetic diagnosis A v1");
  pass("another client cannot read the published foreign case", (await result("clientB", publicationPath)).status === 404);
  pass("another client cannot download the private object", deniedStorage(await downloadStorage("clientB")));
  const storageA = await downloadStorage("clientA");
  requireCondition(storageA.ok, "recipient Storage download failed");
  const actualBytes = Buffer.from(await storageA.arrayBuffer());
  pass("recipient receives exact reviewed Storage bytes", createHash("sha256").update(actualBytes).digest("hex") === bytesDigest);
  const directReceipt = await fetchLocal("/rest/v1/advisory_receipts", {
    method: "POST", headers: { apikey: status.ANON_KEY, Authorization: "Bearer " + users.clientA.token,
      "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ publication_id: publication, case_id: ids.caseA,
      report_version_id: ids.versionA1, user_id: users.clientA.id }),
  });
  const directReceiptError = await parsed(directReceipt);
  pass("direct receipt INSERT is denied so every acknowledgement uses the locked RPC",
    directReceipt.status === 403 && directReceiptError.code === "42501");
  const receipt1 = await result("clientA", "/publications/" + publication + "/receipt", {});
  const receipt2 = await result("clientA", "/publications/" + publication + "/receipt", {});
  pass("receipt is idempotent for the authenticated recipient", receipt1.status === 200 && receipt2.status === 200 &&
    receipt1.body.data.receipt_id === receipt2.body.data.receipt_id);
  pass("foreign client cannot acknowledge the publication",
    (await result("clientB", "/publications/" + publication + "/receipt", {})).status === 404);
  pass("client cannot call the staff review package", (await result("clientA", publicationPath + "/review-package")).status === 404);

  const revoked = await result("rui", "/publications/" + publication + "/revoke", {
    recipient_user_id: null, reason: "Synthetic homologation revocation",
    expected_content_sha256: packageData.content_sha256, expected_manifest_sha256: packageData.manifest_sha256,
    idempotency_key: randomUUID(),
  });
  pass("publisher records revocation of the exact package", revoked.status === 200);
  pass("revocation immediately denies fresh report access", (await result("clientA", publicationPath)).status === 404);
  pass("revocation immediately denies fresh JSON download", (await result("clientA", publicationPath + "/download")).status === 404);
  pass("revocation immediately denies fresh private Storage download", deniedStorage(await downloadStorage("clientA")));
  pass("receipt retry rechecks authorization after revocation",
    (await result("clientA", "/publications/" + publication + "/receipt", {})).status === 404);
  const afterRevoke = await result("clientA", "/reports");
  pass("revoked versions disappear from client list", afterRevoke.status === 200 && afterRevoke.body.data.length === 0);
  console.log("REAL SUPABASE LOCAL: " + assertions + " assertions passed; Auth/PostgREST/Storage exercised.");
  console.log("Edge deployment, cloud staging and production approval remain unvalidated.");
}

main().catch((error) => {
  // Provider bodies, credentials, SQL text, user IDs and JWTs must never enter CI output.
  const safeMessage = error instanceof SafeTestFailure ? error.message : "runner initialization or native operation failed";
  console.error("FAIL real Supabase local homologation: " + safeMessage + "; last PASS identifies the completed gate.");
  process.exitCode = 1;
});
