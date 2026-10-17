/** Staging API. Identity comes from Supabase Auth; authorization from database RLS/RPCs.
 * No service-role client, persona selector, AI approval or financial execution.
 * Native fetch avoids runtime packages and only reaches the operator's project URL.
 */
type EnvReader = (name: string) => string | undefined;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;
type Config = { base: string; key: string; origins: Set<string> };
type HandlerOptions = { localTest?: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const BODY_LIMIT = 16 * 1024;
const UPSTREAM_LIMIT = 2 * 1024 * 1024;
const PREFIX = "/functions/v1/advisory-api";

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(400, "invalid_request");
  return value.toLowerCase();
}

function assertDigest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new ApiError(400, "invalid_request");
  return value;
}

function exactKeys(body: JsonObject, keys: string[]): void {
  if (Object.keys(body).length !== keys.length || keys.some((key) => !(key in body))) {
    throw new ApiError(400, "invalid_request");
  }
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new ApiError(400, "invalid_request");
  }
  return value;
}

function configuration(env: EnvReader, options: HandlerOptions): Config {
  const url = new URL(env("SUPABASE_URL") ?? "");
  // Hosted staging only. No caller-controlled hosts, redirects, paths or local metadata endpoints.
  // A Node integration test may opt into this one CLI endpoint in code. No environment
  // flag or request can enable it in the deployed Deno entry point.
  const localEndpoint = options.localTest === true && url.origin === "http://127.0.0.1:54321";
  const hostedEndpoint = url.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname);
  if ((!hostedEndpoint && !localEndpoint) ||
      url.username || url.password || (!localEndpoint && url.port) || url.search || url.hash || url.pathname !== "/") {
    throw new Error("invalid_config");
  }
  const key = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY") || "";
  if (key.startsWith("sb_publishable_")) {
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error("invalid_config");
  } else {
    // A legacy anon key may be used, never a service-role JWT. This is a configuration
    // guard, NOT user authentication; the Auth server verifies every user's JWT.
    const parts = key.split(".");
    if (parts.length !== 3) throw new Error("invalid_config");
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (!isObject(payload) || payload.role !== "anon") throw new Error("invalid_config");
  }
  const entries = (env("ADVISORY_ALLOWED_ORIGINS") ?? "").split(",").map((origin) => origin.trim());
  if (!entries.length || entries.some((origin) => !origin)) throw new Error("invalid_config");
  const origins = new Set<string>();
  for (const entry of entries) {
    const origin = new URL(entry);
    if (origin.origin !== entry || origin.protocol !== "https:" || origin.username || origin.password) {
      throw new Error("invalid_config");
    }
    origins.add(entry);
  }
  return { base: url.origin, key, origins };
}

async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new ApiError(503, "upstream_unavailable");
  }
  if (!response.body) throw new ApiError(503, "upstream_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.length;
    if (bytes > limit) {
      await reader.cancel();
      throw new ApiError(503, "upstream_unavailable");
    }
    chunks.push(item.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(combined)); }
  catch { throw new ApiError(503, "upstream_unavailable"); }
}

async function readBody(request: Request): Promise<JsonObject> {
  if ((request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "json_required");
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) {
    throw new ApiError(413, "request_too_large");
  }
  if (!request.body) throw new ApiError(400, "invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError(408, "request_timeout"));
      void reader.cancel().catch(() => {});
    }, 5000);
  });
  try {
    while (true) {
      const item = await Promise.race([reader.read(), deadline]);
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > BODY_LIMIT) {
        await reader.cancel();
        throw new ApiError(413, "request_too_large");
      }
      chunks.push(item.value);
    }
  } finally {
    clearTimeout(timer);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(combined)); }
  catch { throw new ApiError(400, "invalid_request"); }
  if (!isObject(body)) throw new ApiError(400, "invalid_request");
  return body;
}

/** Dependency injection is for offline contract tests; deployment always uses native fetch. */
export function createHandler(env: EnvReader, upstreamFetch: Fetcher = fetch, options: HandlerOptions = {}) {
  let config: Config | null;
  try { config = configuration(env, options); } catch { config = null; }

  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID(); // Never echo a caller-controlled identifier.
    const headers = new Headers({
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId, "Vary": "Origin", "Content-Type": "application/json; charset=utf-8",
    });
    const respond = (status: number, value: unknown): Response =>
      new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
    try {
      if (!config) throw new ApiError(503, "configuration_unavailable");
      const origin = request.headers.get("origin");
      if (origin !== null) {
        if (!config.origins.has(origin)) throw new ApiError(403, "origin_denied");
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Expose-Headers", "X-Request-ID, Content-Disposition");
      }
      if (request.method === "OPTIONS") {
        if (!origin) throw new ApiError(403, "origin_denied");
        const desired = request.headers.get("access-control-request-method");
        const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "")
          .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
        if (!desired || !["GET", "POST"].includes(desired) || requestedHeaders.some((item) =>
          !["authorization", "content-type", "apikey"].includes(item))) {
          throw new ApiError(403, "preflight_denied");
        }
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "authorization, content-type, apikey");
        headers.set("Access-Control-Max-Age", "300");
        return respond(204, null);
      }
      const url = new URL(request.url);
      // Hosted Edge forwards /advisory-api/... to Deno, while local tests may
      // present the full gateway path. Normalize both before routing.
      const hostedPrefix = "/advisory-api";
      const path = url.pathname.startsWith(PREFIX + "/") ? url.pathname.slice(PREFIX.length)
        : url.pathname.startsWith(hostedPrefix + "/") ? url.pathname.slice(hostedPrefix.length)
        : url.pathname;
      if (url.search) throw new ApiError(400, "invalid_request");
      if (request.method === "GET" && path === "/health") {
        return respond(200, { status: "configured", mode: "synthetic-staging", request_id: requestId });
      }
      if (!["GET", "POST"].includes(request.method)) throw new ApiError(405, "method_not_allowed");
      const authorization = request.headers.get("authorization") ?? "";
      if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) ||
          authorization.length > 8192) throw new ApiError(401, "authentication_required");

      // All upstream URLs use this validated operator-controlled base and constant paths.
      const scopedFetch = async (pathname: string, init: RequestInit = {}): Promise<Response> => {
        try {
          return await upstreamFetch(config!.base + pathname, {
            ...init, redirect: "error", signal: AbortSignal.timeout(8000),
            headers: { "apikey": config!.key, "Authorization": authorization,
              "Content-Type": "application/json", "Accept": "application/json",
              // Profile is fixed by the server. Auth/Storage never receive a DB profile.
              ...(pathname.startsWith("/rest/v1/") ? {
                "Accept-Profile": "capital_web3", "Content-Profile": "capital_web3",
              } : {}),
            },
          });
        } catch { throw new ApiError(503, "upstream_unavailable"); }
      };
      const authResponse = await scopedFetch("/auth/v1/user", { method: "GET" });
      if (!authResponse.ok) {
        throw new ApiError(authResponse.status >= 500 ? 503 : 401,
          authResponse.status >= 500 ? "upstream_unavailable" : "authentication_required");
      }
      const user = await readBoundedJson(authResponse, 64 * 1024);
      if (!isObject(user) || typeof user.id !== "string" || !UUID.test(user.id) || user.is_anonymous !== false) {
        throw new ApiError(401, "authentication_required");
      }

      const database = async (pathname: string, init: RequestInit = {}): Promise<unknown> => {
        const response = await scopedFetch(pathname, init);
        const result = await readBoundedJson(response, UPSTREAM_LIMIT);
        if (!response.ok) {
          const code = isObject(result) ? result.code : null;
          if (response.status >= 500) throw new ApiError(503, "upstream_unavailable");
          if (code === "23505" || code === "23514") throw new ApiError(409, "state_conflict");
          if (code === "22023" || code === "22P02") throw new ApiError(400, "invalid_request");
          // Object denied and nonexistent have the same public response.
          throw new ApiError(404, "resource_unavailable");
        }
        return result;
      };
      const rpc = (name: string, body: JsonObject): Promise<unknown> =>
        database("/rest/v1/rpc/" + name, { method: "POST", body: JSON.stringify(body) });

      if (request.method === "GET" && path === "/session") {
        const assignments = await database("/rest/v1/advisory_case_staff?select=case_id,staff_role&active=eq.true&limit=100");
        if (!Array.isArray(assignments)) throw new ApiError(503, "upstream_unavailable");
        return respond(200, { user_id: user.id, assignments, request_id: requestId });
      }
      if (request.method === "GET" && path === "/cases") {
        return respond(200, { data: await database("/rest/v1/advisory_cases?select=id,client_safe_title&order=created_at.desc&limit=100"), request_id: requestId });
      }
      const recipientsRoute = path.match(/^\/cases\/([^/]+)\/recipients$/);
      if (request.method === "GET" && recipientsRoute) {
        const caseId = assertUuid(recipientsRoute[1]);
        // Staff obtain the eligible recipients from RLS-protected membership rows.
        // A client can see only its own membership, never other client identities.
        return respond(200, { data: await database("/rest/v1/advisory_case_clients?select=user_id&active=eq.true&case_id=eq." + caseId + "&limit=50"), request_id: requestId });
      }
      if (request.method === "GET" && path === "/reports") {
        return respond(200, { data: await database("/rest/v1/advisory_report_versions?select=id,report_id,case_id,version_number,content_sha256,created_at&order=created_at.desc&limit=100"), request_id: requestId });
      }
      if (request.method === "GET" && path === "/publications") {
        return respond(200, { data: await database("/rest/v1/advisory_publications?select=id,case_id,report_version_id,published_at,expires_at&order=published_at.desc&limit=100"), request_id: requestId });
      }
      const reportRoute = path.match(/^\/reports\/([^/]+)(?:\/(download|review-package|review|publish))?$/);
      if (reportRoute) {
        const versionId = assertUuid(reportRoute[1]);
        const action = reportRoute[2] ?? "content";
        if (request.method === "GET" && (action === "content" || action === "download")) {
          const rows = await database("/rest/v1/advisory_report_versions?select=id,case_id,version_number,content,content_sha256&id=eq." + versionId + "&limit=1");
          if (!Array.isArray(rows) || rows.length !== 1) throw new ApiError(404, "resource_unavailable");
          if (action === "download") headers.set("Content-Disposition", 'attachment; filename="diagnostico-' + versionId + '.json"');
          return respond(200, { data: rows[0], request_id: requestId });
        }
        if (request.method === "GET" && action === "review-package") {
          return respond(200, { data: await rpc("advisory_get_review_package", { p_report_version_id: versionId }), request_id: requestId });
        }
        if (request.method === "POST" && action === "review") {
          const body = await readBody(request);
          exactKeys(body, ["decision", "expected_content_sha256", "expected_manifest_sha256", "private_notes", "idempotency_key"]);
          if (!["approved", "rejected"].includes(body.decision as string)) throw new ApiError(400, "invalid_request");
          const result = await rpc("advisory_review_report", {
            p_report_version_id: versionId, p_decision: body.decision,
            p_expected_content_sha256: assertDigest(body.expected_content_sha256),
            p_expected_manifest_sha256: assertDigest(body.expected_manifest_sha256),
            p_private_notes: boundedText(body.private_notes, 4000, true),
            p_idempotency_key: assertUuid(body.idempotency_key),
          });
          return respond(200, { data: result, request_id: requestId });
        }
        if (request.method === "POST" && action === "publish") {
          const body = await readBody(request);
          exactKeys(body, ["recipient_user_ids", "expected_content_sha256", "expected_manifest_sha256", "expires_at", "idempotency_key"]);
          if (!Array.isArray(body.recipient_user_ids) || body.recipient_user_ids.length < 1 || body.recipient_user_ids.length > 50) {
            throw new ApiError(400, "invalid_request");
          }
          const recipients = body.recipient_user_ids.map(assertUuid);
          if (new Set(recipients).size !== recipients.length) throw new ApiError(400, "invalid_request");
          if (body.expires_at !== null && (typeof body.expires_at !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(body.expires_at) ||
            !Number.isFinite(Date.parse(body.expires_at)))) throw new ApiError(400, "invalid_request");
          const result = await rpc("advisory_publish_report", {
            p_report_version_id: versionId, p_recipient_user_ids: recipients,
            p_expected_content_sha256: assertDigest(body.expected_content_sha256),
            p_expected_manifest_sha256: assertDigest(body.expected_manifest_sha256),
            p_expires_at: body.expires_at, p_idempotency_key: assertUuid(body.idempotency_key),
          });
          return respond(200, { data: result, request_id: requestId });
        }
      }
      const publicationRoute = path.match(/^\/publications\/([^/]+)\/(revoke|receipt)$/);
      if (publicationRoute && request.method === "POST") {
        const publicationId = assertUuid(publicationRoute[1]);
        const body = await readBody(request);
        if (publicationRoute[2] === "receipt") {
          exactKeys(body, []);
          return respond(200, { data: await rpc("advisory_record_receipt", { p_publication_id: publicationId }), request_id: requestId });
        }
        exactKeys(body, ["recipient_user_id", "reason", "expected_content_sha256", "expected_manifest_sha256", "idempotency_key"]);
        return respond(200, { data: await rpc("advisory_revoke_publication", {
          p_publication_id: publicationId,
          p_recipient_user_id: body.recipient_user_id === null ? null : assertUuid(body.recipient_user_id),
          p_reason: boundedText(body.reason, 1000),
          p_expected_content_sha256: assertDigest(body.expected_content_sha256),
          p_expected_manifest_sha256: assertDigest(body.expected_manifest_sha256),
          p_idempotency_key: assertUuid(body.idempotency_key),
        }), request_id: requestId });
      }
      throw new ApiError(404, "resource_unavailable");
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError(503, "upstream_unavailable");
      // No JWTs, report bodies, provider messages or private notes in responses/logs.
      return respond(failure.status, { error: failure.code, request_id: requestId });
    }
  };
}

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
if (typeof Deno !== "undefined") Deno.serve(createHandler((name) => Deno.env.get(name)));
