import hashlib
import hmac
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from capital_web3.budget import IdempotencyConflict, LedgerError, ScopedNotFound, TrustedScope, request_digest
from capital_web3.jobs import DurableJobQueue, SignedWebhookVerifier, WebhookRejected


class JobTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "jobs.sqlite3"
        self.tick = 1000
        self.scope = TrustedScope("tenant-a", "case-a", "staff-a",
                                  frozenset({"jobs:enqueue", "job:draft", "case:read"}))
        self.queue = DurableJobQueue(self.path, clock=lambda: self.tick)

    def enqueue(self, **changes):
        kwargs = {"purpose": "draft", "payload": {"snapshot_ref": "synthetic-1"},
                  "required_scopes": ("case:read",), "deadline": 1200,
                  "idempotency_key": "draft-1", "max_attempts": 3}
        kwargs.update(changes)
        return self.queue.enqueue(self.scope, **kwargs)

    def test_restart_and_idempotent_payload_scopes_binding(self):
        original = self.enqueue()
        self.queue = DurableJobQueue(self.path, clock=lambda: self.tick)
        self.assertEqual(self.enqueue().id, original.id)
        for change in ({"payload": {"snapshot_ref": "different"}},
                       {"required_scopes": ()}, {"deadline": 1250}):
            with self.subTest(change=change), self.assertRaises(IdempotencyConflict):
                self.enqueue(**change)

    def test_scope_grants_payload_and_deadline_validation(self):
        original = self.enqueue()
        for scope in (TrustedScope("tenant-b", "case-a", "staff-a", self.scope.grants),
                      TrustedScope("tenant-a", "case-b", "staff-a", self.scope.grants),
                      TrustedScope("tenant-a", "case-a", "staff-b", self.scope.grants)):
            with self.assertRaises(ScopedNotFound):
                self.queue.get(scope, original.id)
        for kwargs in ({"purpose": "notification"}, {"required_scopes": ("admin:all",)}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ScopedNotFound):
                self.enqueue(**kwargs)
        for kwargs in ({"payload": []}, {"payload": {"bad": float("nan")}},
                       {"purpose": "trade"}, {"deadline": 1000}, {"max_attempts": 0}):
            with self.subTest(kwargs=kwargs), self.assertRaises(LedgerError):
                self.enqueue(idempotency_key="new", **kwargs)

    def test_concurrent_workers_claim_each_job_only_once(self):
        for i in range(10):
            self.enqueue(idempotency_key=f"draft-{i}")
        with ThreadPoolExecutor(max_workers=10) as pool:
            jobs = list(pool.map(lambda i: self.queue.claim(f"worker-{i}", purposes=("draft",)),
                                 range(20)))
        claimed = [j for j in jobs if j]
        self.assertEqual(len(claimed), 10)
        self.assertEqual(len({j.id for j in claimed}), 10)
        self.assertTrue(all(j.attempts == 1 for j in claimed))

    def test_lease_recovery_fences_old_worker_and_bounded_retry(self):
        original = self.enqueue(max_attempts=2)
        old = self.queue.claim("worker-a", purposes=("draft",), lease_seconds=10)
        self.tick = 1011
        self.queue = DurableJobQueue(self.path, clock=lambda: self.tick)
        new = self.queue.claim("worker-b", purposes=("draft",))
        self.assertEqual(new.id, old.id)
        self.assertEqual(new.attempts, 2)
        with self.assertRaises(ScopedNotFound):
            self.queue.complete(old.id, "worker-a", old.claim_token, result_digest=request_digest({}))
        self.queue.retry(new.id, "worker-b", new.claim_token)
        self.assertEqual(self.queue.get(self.scope, original.id).state, "failed")
        self.tick = 1015
        self.assertIsNone(self.queue.claim("worker-c", purposes=("draft",)))

    def test_retry_delay_deadline_completion_and_cancel(self):
        original = self.enqueue()
        claimed = self.queue.claim("worker-a", purposes=("draft",))
        self.queue.retry(claimed.id, "worker-a", claimed.claim_token, delay_seconds=5)
        self.assertIsNone(self.queue.claim("worker-a", purposes=("draft",)))
        self.tick = 1005
        claimed = self.queue.claim("worker-a", purposes=("draft",))
        self.queue.complete(claimed.id, "worker-a", claimed.claim_token, result_digest=request_digest({"ok": True}))
        self.assertEqual(self.enqueue().state, "completed")
        with self.assertRaises(ScopedNotFound):
            self.queue.complete(claimed.id, "worker-a", claimed.claim_token, result_digest=request_digest({}))
        cancelled = self.enqueue(idempotency_key="cancel")
        self.queue.cancel(self.scope, cancelled.id)
        expired = self.enqueue(idempotency_key="expire", deadline=1010)
        self.tick = 1010
        self.assertEqual(self.queue.get(self.scope, expired.id).state, "expired")
        self.assertIsNone(self.queue.claim("worker-a", purposes=("draft",)))
        self.assertEqual(self.queue.get(self.scope, original.id).state, "completed")

    def verifier(self):
        return SignedWebhookVerifier(self.path, secret=b"synthetic-test-secret-value-32-bytes", target="/internal/jobs",
                                     clock=lambda: self.tick)

    def signed(self, **changes):
        kwargs = {"method": "POST", "target": "/internal/jobs", "timestamp": self.tick,
                  "nonce": "test_nonce_00000001", "body": b'{"case_ref":"synthetic"}'}
        kwargs.update(changes)
        kwargs["signature"] = hmac.new(self.verifier().secret, SignedWebhookVerifier.signing_input(
            kwargs["method"], kwargs["target"], kwargs["timestamp"], kwargs["nonce"], kwargs["body"]),
            hashlib.sha256).hexdigest()
        return kwargs

    def test_webhook_replay_is_persisted_and_concurrent_delivery_accepts_once(self):
        packet = self.signed()
        verifier = self.verifier()
        with ThreadPoolExecutor(max_workers=8) as pool:
            def verify(_):
                try:
                    return verifier.verify(**packet)
                except WebhookRejected:
                    return None
            results = list(pool.map(verify, range(8)))
        self.assertEqual(len([x for x in results if x]), 1)
        with self.assertRaises(WebhookRejected):
            self.verifier().verify(**packet)

    def test_webhook_binds_body_method_target_timestamp_and_tamper_does_not_consume_nonce(self):
        packet = self.signed()
        verifier = self.verifier()
        for change in ({"body": b"tampered"}, {"method": "GET"},
                       {"target": "/another/jobs"}, {"timestamp": 699},
                       {"timestamp": 1001}, {"signature": "0" * 64}):
            with self.subTest(change=change), self.assertRaises(WebhookRejected):
                verifier.verify(**(packet | change))
        verifier.verify(**packet)
        self.tick = 1301
        with self.assertRaises(WebhookRejected):
            self.verifier().verify(**packet)


if __name__ == "__main__":
    unittest.main()
