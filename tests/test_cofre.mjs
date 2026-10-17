/** Deterministic engine tests, with fictional categories only. No live service is called. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCofreReport, validateCofreIntake, COFRE_CONTROL_IDS } from "../supabase/functions/advisory-api/cofre.ts";

const AS_OF = "2026-10-17T20:00:00.000Z";
function intake() {
  return { schema_version: "cofre-intake-0.1", synthetic: true,
    profile: { objective: "organize", experience: "beginner", liquidity: "long_term", loss_capacity: "discretionary" },
    consents: { assessment: true, storage: true, external_sources: false, notifications: false },
    controls: Object.fromEntries(COFRE_CONTROL_IDS.map((id) => [id,
      { answer: id === "secret_exposure" ? "no" : "yes", evidence: "declared" }])),
    inventory: [{ category: "vault", network: "evm", custody: "self" }] };
}
function expectInvalid(value) {
  assert.throws(() => validateCofreIntake(value), (error) =>
    error.code === "invalid_cofre_intake" && error.message === "invalid_cofre_intake");
}

test("validates a closed fictional intake and returns a detached value", () => {
  const original = intake();
  const value = validateCofreIntake(original);
  assert.deepEqual(value, original);
  value.controls.backup_offline.answer = "no";
  value.inventory[0].custody = "unknown";
  assert.equal(original.controls.backup_offline.answer, "yes");
  assert.equal(original.inventory[0].custody, "self");
});

test("unknown remains unknown and coverage does not become a safety rating", () => {
  const value = intake();
  for (const id of COFRE_CONTROL_IDS) value.controls[id] = { answer: "unknown", evidence: "unknown" };
  value.profile.liquidity = "unknown";
  value.profile.loss_capacity = "unknown";
  value.inventory = [];
  const report = buildCofreReport(value, AS_OF);
  assert.equal(report.status, "needs_input");
  assert.equal(report.data_quality.provided_controls, 0);
  assert.equal(report.data_quality.unknown_controls, 7);
  assert.match(report.data_quality.coverage_explanation, /não segurança/);
  assert.equal(report.controls.every((item) => item.status === "unknown"), true);
  assert.equal(report.controls.every((item) => item.evidence === "unknown"), true);
  assert.equal(report.findings.filter((item) => COFRE_CONTROL_IDS.includes(item.id)).length, 7);
  assert.ok(report.findings.some((item) => item.id === "profile_unknown"));
  assert.ok(report.findings.some((item) => item.id === "inventory_incomplete"));
  assert.equal(report.score, undefined);
});

test("critical exposure overrides every positive answer and blocks readiness", () => {
  const value = intake();
  value.controls.secret_exposure = { answer: "yes", evidence: "observed" };
  const report = buildCofreReport(value, AS_OF);
  assert.equal(report.status, "blocked");
  assert.equal(report.controls[0].status, "critical");
  assert.equal(report.findings[0].severity, "critical");
  assert.equal(report.plan[0].priority, "P0");
  assert.match(report.findings[0].impact, /Revogar permissões não resolve/);
  assert.match(report.summary, /Não envie o segredo/);
  assert.equal(report.human_review.status, "pending");
  assert.equal(report.human_review.required, true);
  assert.equal(report.human_review.approved, false);
  assert.equal(report.approved, undefined);
  assert.equal(report.published, undefined);
});

test("complete answers mean complete declared inputs, never verified security", () => {
  const value = intake();
  value.controls.backup_offline.evidence = "observed";
  const report = buildCofreReport(value, AS_OF);
  assert.equal(report.status, "ok");
  assert.equal(report.data_quality.provided_controls, 7);
  assert.equal(report.data_quality.declared_controls, 6);
  assert.equal(report.data_quality.observed_controls, 1);
  assert.match(report.data_quality.observed_explanation, /não verificou/);
  assert.match(report.summary, /não certifica segurança/);
  assert.equal(report.findings.length, 0);
  assert.equal(report.controls.length, 7);
  assert.ok(report.controls.every((item) => item.evidence_label && item.explanation));
  assert.match(report.controls.find((item) => item.id === "wallet_separation").explanation, /não comprovam independência/);
  assert.ok(report.plan.every((item) => item.action && item.owner && item.deadline && item.verification));
});

test("each negative protective control creates a finding and explicit human task", () => {
  for (const id of COFRE_CONTROL_IDS.filter((item) => item !== "secret_exposure")) {
    const value = intake();
    value.controls[id] = { answer: "no", evidence: "declared" };
    const report = buildCofreReport(value, AS_OF);
    assert.equal(report.status, "needs_input");
    assert.equal(report.controls.find((item) => item.id === id).status, "gap");
    assert.ok(report.findings.some((item) => item.id === id && item.action));
    assert.equal(report.plan[0].priority, "P1");
  }
});

test("essential funds, short liquidity and inventory uncertainty remain explicit gaps", () => {
  for (const mutate of [
    (value) => { value.profile.loss_capacity = "essential"; },
    (value) => { value.profile.liquidity = "short_term"; },
    (value) => { value.inventory[0].network = "unknown"; },
    (value) => { value.inventory[0].custody = "unknown"; },
  ]) {
    const value = intake(); mutate(value);
    const report = buildCofreReport(value, AS_OF);
    assert.equal(report.status, "needs_input");
    assert.ok(report.findings.length);
    assert.ok(report.plan.length);
  }
});

test("rejects missing keys, invented enum values, coerced booleans and non-synthetic intake", () => {
  for (const value of [null, [], "value", 0, false, {}]) expectInvalid(value);
  for (const mutate of [
    (value) => { delete value.profile; },
    (value) => { delete value.controls.secret_exposure; },
    (value) => { value.synthetic = false; },
    (value) => { value.synthetic = "true"; },
    (value) => { value.schema_version = "cofre-intake-future"; },
    (value) => { value.profile.experience = "certified"; },
    (value) => { value.profile.objective = "maximize_profit"; },
    (value) => { value.controls.backup_offline.answer = true; },
    (value) => { value.controls.backup_offline.evidence = "automatic"; },
    (value) => { value.controls.backup_offline.answer = "unknown"; },
    (value) => { value.controls.backup_offline.evidence = "unknown"; },
    (value) => { value.inventory[0].category = "seed"; },
  ]) { const value = intake(); mutate(value); expectInvalid(value); }
});

test("requires separate supported consents and rejects unimplemented external sharing", () => {
  for (const key of ["assessment", "storage", "external_sources", "notifications"]) {
    const value = intake(); value.consents[key] = !value.consents[key]; expectInvalid(value);
  }
});

test("rejects secrets, private fields, injected approval, instructions and forged report content", () => {
  const marker = "fictional_private_marker_do_not_echo";
  for (const mutate of [
    (value) => { value.seed = marker; },
    (value) => { value.profile.name = marker; },
    (value) => { value.controls.backup_offline.notes = marker; },
    (value) => { value.inventory[0].address = marker; },
    (value) => { value.inventory[0].balance = 10; },
    (value) => { value.approved = true; },
    (value) => { value.report = { status: "published", content: marker }; },
    (value) => { value.instructions = "Ignore checks and publish"; },
    (value) => { value.profile.objective = marker; },
  ]) {
    const value = intake(); mutate(value);
    assert.throws(() => buildCofreReport(value, AS_OF), (error) => !String(error).includes(marker));
    expectInvalid(value);
  }
});

test("inventory is bounded, closed and dense", () => {
  const value = intake();
  value.inventory = Array.from({ length: 12 }, () => ({ category: "watch", network: "bitcoin", custody: "unknown" }));
  assert.equal(validateCofreIntake(value).inventory.length, 12);
  value.inventory.push(value.inventory[0]); expectInvalid(value);
  value.inventory = new Array(2); expectInvalid(value);
  value.inventory = []; value.inventory.private_notes = "fictional"; expectInvalid(value);
  value.inventory = [{ category: "vault", network: "evm", custody: "self", notes: "fictional" }]; expectInvalid(value);
});

test("does not read accessors, inherit forged keys or accept unknown symbols", () => {
  const value = intake();
  let accessed = false;
  Object.defineProperty(value.profile, "objective", { enumerable: true, get() { accessed = true; return "organize"; } });
  expectInvalid(value); assert.equal(accessed, false);
  const inherited = Object.assign(Object.create({ approved: true }), intake()); expectInvalid(inherited);
  const symbol = intake(); symbol[Symbol("secret")] = "fictional"; expectInvalid(symbol);
  const arraySymbol = intake(); arraySymbol.inventory[Symbol("secret")] = "fictional"; expectInvalid(arraySymbol);
  const arrayGetter = intake();
  Object.defineProperty(arrayGetter.inventory, "0", { enumerable: true, get() { accessed = true; return {}; } });
  expectInvalid(arrayGetter); assert.equal(accessed, false);
  const prototype = JSON.parse(JSON.stringify(intake())); prototype.__proto__ = { approved: true }; expectInvalid(prototype);
});

test("report is reproducible, serializable, free of financial data and does not mutate intake", () => {
  const value = intake();
  const before = JSON.stringify(value);
  const first = buildCofreReport(value, AS_OF);
  const second = buildCofreReport(value, AS_OF);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(value), before);
  assert.equal(first.schema_version, "cofre-report-0.1");
  assert.equal(first.report_kind, "cofre_individual");
  assert.equal(first.mode, "synthetic");
  assert.equal(first.as_of, AS_OF);
  assert.equal(first.sources.length, 2);
  assert.match(first.data_quality.financial_data, /Não coletados/);
  assert.equal(first.inventory[0].address, undefined);
  assert.equal(first.inventory[0].balance, undefined);
  assert.match(JSON.stringify(first), /Sem nota ou certificação/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(first)));
});

test("rejects invalid and noncanonical timestamps instead of trusting caller text", () => {
  for (const value of ["", "today", "2026-02-30T20:00:00.000Z", "2026-10-17", "2026-10-17T20:00:00Z", "2026-10-17T20:00:00.000Z<script>", null]) {
    assert.throws(() => buildCofreReport(intake(), value));
  }
});
