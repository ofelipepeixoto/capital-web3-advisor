import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from capital_web3.budget import (
    BudgetExceeded, BudgetLedger, IdempotencyConflict, LedgerError,
    ScopedNotFound, TrustedScope, request_digest,
)


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "ledger.sqlite3"
        self.tick = 1000
        self.scope = TrustedScope("tenant-a", "case-a", "staff-a",
                                  frozenset({"budget:reserve", "budget:reconcile"}))
        self.ledger = BudgetLedger(self.path, clock=lambda: self.tick)

    def configure(self, cost=100, calls=10):
        for case in (None, self.scope.case_ref):
            self.ledger.configure_limit(self.scope.tenant_ref, case,
                                         cost_limit_micro=cost, call_limit=calls)

    def reserve(self, key="request-1", cost=20, calls=1, digest=None, deadline=1100):
        return self.ledger.reserve(self.scope, idempotency_key=key,
                                   request_digest=digest or request_digest({"draft": 1}),
                                   worst_cost_micro=cost, worst_calls=calls, deadline=deadline)

    def test_default_zero_and_both_limits_fail_closed(self):
        with self.assertRaises(BudgetExceeded):
            self.reserve(cost=0)
        self.ledger.configure_limit("tenant-a", "case-a", cost_limit_micro=100, call_limit=10)
        with self.assertRaises(BudgetExceeded):
            self.reserve()
        self.ledger.configure_limit("tenant-a", cost_limit_micro=100, call_limit=10)
        self.assertEqual(self.reserve().state, "reserved")

    def test_concurrent_reservations_cannot_overspend_or_exceed_calls(self):
        self.configure(cost=50, calls=3)
        def attempt(i):
            try:
                return self.reserve(key=f"request-{i}", cost=15).id
            except BudgetExceeded:
                return None
        with ThreadPoolExecutor(max_workers=10) as pool:
            approved = [r for r in pool.map(attempt, range(20)) if r]
        self.assertEqual(len(approved), 3)
        self.assertEqual(self.ledger.usage(self.scope)["tenant_cost_micro"], 45)
        with self.assertRaises(BudgetExceeded):
            self.reserve("extra-zero-cost", cost=0)

    def test_aggregate_tenant_limit_covers_multiple_cases(self):
        self.configure(cost=30)
        other = TrustedScope("tenant-a", "case-b", "staff-a", self.scope.grants)
        self.ledger.configure_limit("tenant-a", "case-b", cost_limit_micro=30, call_limit=10)
        self.reserve(cost=20)
        with self.assertRaises(BudgetExceeded):
            self.ledger.reserve(other, idempotency_key="other", request_digest=request_digest({}),
                                worst_cost_micro=20, worst_calls=1, deadline=1100)

    def test_restart_retry_idempotency_and_digest_binding(self):
        self.configure()
        first = self.reserve()
        reopened = BudgetLedger(self.path, clock=lambda: self.tick)
        self.ledger = reopened
        self.assertEqual(self.reserve().id, first.id)
        self.assertEqual(self.ledger.usage(self.scope)["case_calls"], 1)
        with self.assertRaises(IdempotencyConflict):
            self.reserve(digest=request_digest({"draft": 2}))
        with self.assertRaises(IdempotencyConflict):
            self.reserve(cost=21)

    def test_dispatch_once_settle_release_and_strict_usage(self):
        self.configure()
        reserved = self.reserve(cost=70, calls=3)
        self.assertTrue(self.ledger.mark_dispatched(self.scope, reserved.id))
        self.assertFalse(self.ledger.mark_dispatched(self.scope, reserved.id))
        with self.assertRaises(BudgetExceeded):
            self.ledger.settle(self.scope, reserved.id, actual_cost_micro=71, actual_calls=1)
        with self.assertRaises(LedgerError):
            self.ledger.cancel(self.scope, reserved.id)
        self.assertEqual(self.ledger.usage(self.scope)["case_cost_micro"], 70)
        self.ledger.settle(self.scope, reserved.id, actual_cost_micro=40, actual_calls=2)
        self.ledger.settle(self.scope, reserved.id, actual_cost_micro=40, actual_calls=2)
        with self.assertRaises(IdempotencyConflict):
            self.ledger.settle(self.scope, reserved.id, actual_cost_micro=39, actual_calls=2)
        self.assertEqual(self.ledger.usage(self.scope)["case_cost_micro"], 40)
        self.reserve("second", cost=60)

    def test_cancel_expiry_and_unknown_dispatched_cost_remain_safe(self):
        self.configure()
        cancelled = self.reserve()
        self.ledger.cancel(self.scope, cancelled.id)
        self.ledger.cancel(self.scope, cancelled.id)
        dispatched = self.reserve("dispatched", cost=50)
        self.ledger.mark_dispatched(self.scope, dispatched.id)
        expired = self.reserve("expired", cost=50)
        self.tick = 1101
        self.assertEqual(self.ledger.get(self.scope, expired.id).state, "expired")
        self.assertEqual(self.ledger.get(self.scope, dispatched.id).state, "dispatched")
        self.assertEqual(self.ledger.usage(self.scope)["case_cost_micro"], 50)
        with self.assertRaises(LedgerError):
            self.ledger.mark_dispatched(self.scope, expired.id)
        with self.assertRaises(LedgerError):
            self.ledger.cancel(self.scope, dispatched.id)

    def test_scope_and_grants_are_checked_without_existence_leaks(self):
        self.configure()
        reservation = self.reserve()
        for scope in (TrustedScope("tenant-b", "case-a", "staff-a", self.scope.grants),
                      TrustedScope("tenant-a", "case-b", "staff-a", self.scope.grants),
                      TrustedScope("tenant-a", "case-a", "staff-b", self.scope.grants)):
            with self.assertRaises(ScopedNotFound):
                self.ledger.get(scope, reservation.id)
        no_grants = TrustedScope("tenant-a", "case-a", "staff-a")
        with self.assertRaises(ScopedNotFound):
            self.ledger.mark_dispatched(no_grants, reservation.id)

    def test_invalid_integer_deadline_and_limit_changes(self):
        self.configure()
        for cost in (True, -1, 0.5, 10**16):
            with self.subTest(cost=cost), self.assertRaises(LedgerError):
                self.reserve(cost=cost)
        for deadline in (999, 1000, 1000 + 86_401):
            with self.subTest(deadline=deadline), self.assertRaises(LedgerError):
                self.reserve(deadline=deadline)
        self.reserve(cost=80)
        with self.assertRaises(BudgetExceeded):
            self.ledger.configure_limit("tenant-a", cost_limit_micro=79, call_limit=10)
        with self.assertRaises(LedgerError):
            BudgetLedger(":memory:")


if __name__ == "__main__":
    unittest.main()
