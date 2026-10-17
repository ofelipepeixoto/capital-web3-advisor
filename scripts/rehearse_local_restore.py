#!/usr/bin/env python3
"""Rehearse a consistent local SQLite restore using synthetic application stores.

No arguments, network, real files, credentials, Supabase or existing database are
accepted. All files are created inside one disposable temporary directory. This
is an executable local rehearsal, not a backup of the hosted COFRE service.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from capital_web3.budget import BudgetLedger, ScopedNotFound, TrustedScope, request_digest
from capital_web3.jobs import DurableJobQueue, SignedWebhookVerifier, WebhookRejected


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _consistent_copy(source: Path, destination: Path) -> None:
    # The only callers supply files created in this rehearsal's private tempdir.
    # Exclusive creation also makes an accidental overwrite fail closed.
    with destination.open("xb"):
        pass
    destination.chmod(0o600)
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as origin:
        with sqlite3.connect(destination) as target:
            origin.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise ValueError("Snapshot integrity check failed")
            if target.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("Snapshot foreign-key check failed")


def _restore(snapshot: Path, destination: Path, expected_sha256: str) -> None:
    if not hmac.compare_digest(_sha256(snapshot), expected_sha256):
        raise ValueError("Snapshot digest mismatch; destination not created")
    _consistent_copy(snapshot, destination)


def rehearse() -> dict:
    checks: dict[str, bool] = {}
    tick = [1000]
    now = lambda: tick[0]
    scope = TrustedScope("synthetic-tenant", "synthetic-case", "synthetic-staff",
                         frozenset({"budget:reserve", "budget:reconcile", "jobs:enqueue",
                                    "job:draft", "case:read"}))
    with tempfile.TemporaryDirectory(prefix="capital-synthetic-restore-") as directory:
        root = Path(directory)
        source, snapshot, restored = (root / name for name in
                                     ("source.sqlite3", "snapshot.sqlite3", "restored.sqlite3"))
        ledger = BudgetLedger(source, clock=now)
        queue = DurableJobQueue(source, clock=now)
        for case in (None, scope.case_ref):
            ledger.configure_limit(scope.tenant_ref, case, cost_limit_micro=100, call_limit=5)

        def reserve(key: str, cost: int):
            return ledger.reserve(scope, idempotency_key=key, request_digest=request_digest({"synthetic": key}),
                                  worst_cost_micro=cost, worst_calls=1, deadline=1200)

        reserved = reserve("reserved", 20)
        dispatched = reserve("dispatched-unknown-usage", 40)
        ledger.mark_dispatched(scope, dispatched.id)
        settled = reserve("settled", 10)
        ledger.mark_dispatched(scope, settled.id)
        ledger.settle(scope, settled.id, actual_cost_micro=7, actual_calls=1)

        enqueue_args = dict(purpose="draft", payload={"snapshot_ref": "synthetic-only"},
                            required_scopes=("case:read",), deadline=1200,
                            idempotency_key="synthetic-draft", max_attempts=2)
        original_job = queue.enqueue(scope, **enqueue_args)
        claimed = queue.claim("synthetic-worker-before-loss", purposes=("draft",), lease_seconds=10)
        assert claimed is not None
        secret = b"synthetic-restore-fixture-not-a-real-secret"
        verifier = SignedWebhookVerifier(source, secret=secret, target="/synthetic/jobs", clock=now)
        packet = dict(method="POST", target="/synthetic/jobs", timestamp=1000,
                      nonce="synthetic_nonce_0001", body=b'{"synthetic":true}')
        packet["signature"] = hmac.new(secret, verifier.signing_input(**packet), hashlib.sha256).hexdigest()
        verifier.verify(**packet)

        expected_usage = ledger.usage(scope)
        _consistent_copy(source, snapshot)
        digest = _sha256(snapshot)
        manifest = {"schema_version": "local-restore-rehearsal-0.1", "synthetic": True,
                    "sha256": digest, "bytes": snapshot.stat().st_size,
                    "stores": ["budget", "jobs", "webhook-replay"]}
        (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (root / "manifest.json").chmod(0o600)

        # A later write must not become part of the already captured snapshot.
        later = reserve("after-snapshot", 10)
        _restore(snapshot, restored, digest)
        recovered_ledger = BudgetLedger(restored, clock=now)
        recovered_queue = DurableJobQueue(restored, clock=now)
        checks["sqlite_integrity"] = True  # Both copy operations checked the actual database.
        checks["budget_totals_preserved"] = recovered_ledger.usage(scope) == expected_usage
        checks["reservation_state_preserved"] = recovered_ledger.get(scope, reserved.id).state == "reserved"
        checks["unknown_provider_usage_stays_held"] = (
            recovered_ledger.get(scope, dispatched.id).state == "dispatched"
            and not recovered_ledger.mark_dispatched(scope, dispatched.id))
        try:
            recovered_ledger.get(scope, later.id)
        except ScopedNotFound:
            checks["snapshot_excludes_later_writes"] = True
        else:
            checks["snapshot_excludes_later_writes"] = False
        checks["job_idempotency_survives_restore"] = (
            recovered_queue.enqueue(scope, **enqueue_args).id == original_job.id)
        recovered_verifier = SignedWebhookVerifier(restored, secret=secret, target="/synthetic/jobs", clock=now)
        try:
            recovered_verifier.verify(**packet)
        except WebhookRejected:
            checks["webhook_replay_stays_rejected"] = True
        else:
            checks["webhook_replay_stays_rejected"] = False

        tick[0] = 1011
        recovered_job = recovered_queue.claim("synthetic-worker-after-loss", purposes=("draft",))
        checks["expired_lease_recovers_with_attempt_limit"] = (
            recovered_job is not None and recovered_job.id == original_job.id
            and recovered_job.attempts == 2)
        try:
            recovered_queue.complete(claimed.id, "synthetic-worker-before-loss", claimed.claim_token,
                                     result_digest=request_digest({"synthetic": "stale"}))
        except ScopedNotFound:
            checks["stale_worker_cannot_complete"] = True
        else:
            checks["stale_worker_cannot_complete"] = False

        corrupt = root / "corrupt.sqlite3"
        corrupt.write_bytes(snapshot.read_bytes() + b"synthetic-tamper")
        denied_destination = root / "must-not-exist.sqlite3"
        try:
            _restore(corrupt, denied_destination, digest)
        except ValueError:
            checks["tampered_snapshot_rejected_before_write"] = not denied_destination.exists()
        else:
            checks["tampered_snapshot_rejected_before_write"] = False
        try:
            _restore(snapshot, restored, digest)
        except FileExistsError:
            checks["existing_restore_destination_preserved"] = True
        else:
            checks["existing_restore_destination_preserved"] = False

    if not all(checks.values()):
        raise AssertionError("Local restore rehearsal failed: " + ", ".join(k for k, v in checks.items() if not v))
    return {"scope": "synthetic-local-sqlite-only", "cloud_backup": False,
            "checks_passed": len(checks), "checks": checks,
            "temporary_files_removed": True, "network_calls": 0}


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("No paths or credentials accepted; this is a synthetic local rehearsal only.")
    print(json.dumps(rehearse(), indent=2))
