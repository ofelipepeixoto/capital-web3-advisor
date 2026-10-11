"""Durable local budget reservations. No provider transport or live API calls.

TrustedScope is built by authenticated server policy, never from model/client
fields. SQLite transactions are suitable for local homologation on one host;
production needs the same invariants in its authoritative database.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator


class LedgerError(ValueError):
    pass


class BudgetExceeded(LedgerError):
    pass


class IdempotencyConflict(LedgerError):
    pass


class ScopedNotFound(LedgerError):
    def __init__(self) -> None:
        super().__init__("Resource unavailable")


def _identifier(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", value):
        raise LedgerError("Invalid opaque reference")
    return value


def _integer(value: int, *, maximum: int = 10**15) -> int:
    if type(value) is not int or not 0 <= value <= maximum:
        raise LedgerError("Expected a bounded non-negative integer")
    return value


def request_digest(payload: dict) -> str:
    """Hash canonical JSON, not identity assertions or authorization evidence."""
    if not isinstance(payload, dict) or not all(isinstance(k, str) for k in payload):
        raise LedgerError("Expected JSON object")
    try:
        body = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as error:
        raise LedgerError("Expected JSON data") from error
    if len(body.encode()) > 65_536:
        raise LedgerError("Payload exceeds local bound")
    return hashlib.sha256(body.encode()).hexdigest()


@dataclass(frozen=True)
class TrustedScope:
    tenant_ref: str
    case_ref: str
    actor_ref: str
    grants: frozenset[str] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        for value in (self.tenant_ref, self.case_ref, self.actor_ref):
            _identifier(value)
        object.__setattr__(self, "grants", frozenset(self.grants))
        for grant in self.grants:
            _identifier(grant)

    def require(self, grant: str) -> None:
        if grant not in self.grants:
            raise ScopedNotFound()


@dataclass(frozen=True)
class Reservation:
    id: str
    state: str
    worst_cost_micro: int
    worst_calls: int
    actual_cost_micro: int | None
    actual_calls: int | None
    deadline: int


class _Database:
    def __init__(self, path: str | Path, clock: Callable[[], float] = time.time) -> None:
        self.path = str(path)
        if self.path == ":memory:" or self.path.startswith("file:"):
            raise LedgerError("A persistent local file path is required")
        self.clock = clock
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
        finally:
            conn.close()
        Path(self.path).chmod(0o600)

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    def now(self) -> int:
        return int(self.clock())


class BudgetLedger(_Database):
    """Tenant AND case limits hold worst case before the first external step.

    No configured limit means zero; a case cannot escape its aggregate tenant
    limit. Cost units are integer millionths of one configured currency, never
    a current price/model assumption. Caller owns verified usage reconciliation.
    """

    def __init__(self, path: str | Path, clock: Callable[[], float] = time.time) -> None:
        super().__init__(path, clock)
        with self.transaction() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS budget_limits (
                tenant TEXT NOT NULL, case_ref TEXT NOT NULL,
                cost_limit INTEGER NOT NULL CHECK(cost_limit >= 0),
                call_limit INTEGER NOT NULL CHECK(call_limit >= 0),
                PRIMARY KEY(tenant,case_ref))""")
            conn.execute("""CREATE TABLE IF NOT EXISTS budget_reservations (
                id TEXT PRIMARY KEY, tenant TEXT NOT NULL, case_ref TEXT NOT NULL,
                actor TEXT NOT NULL, idem TEXT NOT NULL, digest TEXT NOT NULL,
                worst_cost INTEGER NOT NULL, worst_calls INTEGER NOT NULL,
                actual_cost INTEGER, actual_calls INTEGER, deadline INTEGER NOT NULL,
                state TEXT NOT NULL CHECK(state IN
                    ('reserved','dispatched','settled','cancelled','expired')),
                UNIQUE(tenant,case_ref,actor,idem))""")

    @staticmethod
    def _expire(conn: sqlite3.Connection, now: int) -> None:
        # Never release unknown provider usage after dispatch or process crash.
        conn.execute("UPDATE budget_reservations SET state='expired' "
                     "WHERE state='reserved' AND deadline<=?", (now,))

    @staticmethod
    def _usage(conn: sqlite3.Connection, tenant: str, case_ref: str) -> tuple[int, int]:
        where = "tenant=?" + (" AND case_ref=?" if case_ref else "")
        args = (tenant, case_ref) if case_ref else (tenant,)
        row = conn.execute("""SELECT COALESCE(SUM(CASE
            WHEN state IN ('reserved','dispatched') THEN worst_cost
            WHEN state='settled' THEN actual_cost ELSE 0 END),0) AS cost,
            COALESCE(SUM(CASE
            WHEN state IN ('reserved','dispatched') THEN worst_calls
            WHEN state='settled' THEN actual_calls ELSE 0 END),0) AS calls
            FROM budget_reservations WHERE """ + where, args).fetchone()
        return row["cost"], row["calls"]

    def configure_limit(self, tenant_ref: str, case_ref: str | None = None, *,
                        cost_limit_micro: int = 0, call_limit: int = 0) -> None:
        """Internal operator configuration; never expose as a client/model tool.

        No automatic period reset: a new approved ledger/window is explicit.
        Lowering below spent + held is rejected atomically.
        """
        _identifier(tenant_ref)
        if case_ref is not None:
            _identifier(case_ref)
        _integer(cost_limit_micro)
        _integer(call_limit, maximum=1_000_000)
        key = case_ref or ""
        with self.transaction() as conn:
            self._expire(conn, self.now())
            cost, calls = self._usage(conn, tenant_ref, key)
            if cost > cost_limit_micro or calls > call_limit:
                raise BudgetExceeded("Limit cannot discard spent or held usage")
            conn.execute("INSERT INTO budget_limits VALUES (?,?,?,?) "
                         "ON CONFLICT(tenant,case_ref) DO UPDATE SET "
                         "cost_limit=excluded.cost_limit,call_limit=excluded.call_limit",
                         (tenant_ref, key, cost_limit_micro, call_limit))

    @staticmethod
    def _reservation(row: sqlite3.Row) -> Reservation:
        return Reservation(row["id"], row["state"], row["worst_cost"], row["worst_calls"],
                           row["actual_cost"], row["actual_calls"], row["deadline"])

    @staticmethod
    def _scoped(conn: sqlite3.Connection, scope: TrustedScope,
                reservation_id: str) -> sqlite3.Row:
        row = conn.execute("SELECT * FROM budget_reservations WHERE "
                           "id=? AND tenant=? AND case_ref=? AND actor=?",
                           (reservation_id, scope.tenant_ref, scope.case_ref,
                            scope.actor_ref)).fetchone()
        if row is None:
            raise ScopedNotFound()
        return row

    def reserve(self, scope: TrustedScope, *, idempotency_key: str,
                request_digest: str, worst_cost_micro: int, worst_calls: int,
                deadline: int) -> Reservation:
        scope.require("budget:reserve")
        _identifier(idempotency_key)
        if not isinstance(request_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", request_digest):
            raise LedgerError("Invalid request digest")
        _integer(worst_cost_micro, maximum=10**12)
        _integer(worst_calls, maximum=1000)
        _integer(deadline)
        if worst_calls < 1:
            raise LedgerError("A reservation must bound at least one call")
        with self.transaction() as conn:
            now = self.now()
            self._expire(conn, now)
            row = conn.execute("SELECT * FROM budget_reservations WHERE "
                               "tenant=? AND case_ref=? AND actor=? AND idem=?",
                               (scope.tenant_ref, scope.case_ref, scope.actor_ref,
                                idempotency_key)).fetchone()
            if row is not None:
                if (row["digest"], row["worst_cost"], row["worst_calls"], row["deadline"]) != (
                        request_digest, worst_cost_micro, worst_calls, deadline):
                    raise IdempotencyConflict("Key already binds a different request")
                return self._reservation(row)
            if not now < deadline <= now + 86_400:
                raise LedgerError("Deadline must be within the next 24 hours")
            for case_key in ("", scope.case_ref):
                limit = conn.execute("SELECT * FROM budget_limits WHERE tenant=? "
                                     "AND case_ref=?", (scope.tenant_ref, case_key)).fetchone()
                allowed_cost, allowed_calls = ((limit["cost_limit"], limit["call_limit"])
                                              if limit else (0, 0))
                used_cost, used_calls = self._usage(conn, scope.tenant_ref, case_key)
                if (used_cost + worst_cost_micro > allowed_cost or
                        used_calls + worst_calls > allowed_calls):
                    raise BudgetExceeded("Worst-case reservation exceeds configured budget")
            reservation_id = uuid.uuid4().hex
            conn.execute("INSERT INTO budget_reservations "
                         "(id,tenant,case_ref,actor,idem,digest,worst_cost,worst_calls,deadline,state) "
                         "VALUES (?,?,?,?,?,?,?,?,?,'reserved')", (reservation_id,
                         scope.tenant_ref, scope.case_ref, scope.actor_ref, idempotency_key,
                         request_digest, worst_cost_micro, worst_calls, deadline))
            return self._reservation(self._scoped(conn, scope, reservation_id))

    def get(self, scope: TrustedScope, reservation_id: str) -> Reservation:
        with self.transaction() as conn:
            self._expire(conn, self.now())
            return self._reservation(self._scoped(conn, scope, reservation_id))

    def mark_dispatched(self, scope: TrustedScope, reservation_id: str) -> bool:
        """Only True authorizes the first attempt; retries do not redispatch.

        Write-before-send can strand a hold if the process dies before sending.
        This deliberately fails closed; operator reconciliation must prove usage.
        """
        scope.require("budget:reserve")
        with self.transaction() as conn:
            self._expire(conn, self.now())
            row = self._scoped(conn, scope, reservation_id)
            if row["state"] == "dispatched":
                return False
            if row["state"] != "reserved":
                raise LedgerError("Reservation cannot be dispatched")
            conn.execute("UPDATE budget_reservations SET state='dispatched' WHERE id=?",
                         (reservation_id,))
            return True

    def settle(self, scope: TrustedScope, reservation_id: str, *,
               actual_cost_micro: int, actual_calls: int) -> Reservation:
        scope.require("budget:reconcile")
        _integer(actual_cost_micro)
        _integer(actual_calls, maximum=1000)
        with self.transaction() as conn:
            row = self._scoped(conn, scope, reservation_id)
            if actual_cost_micro > row["worst_cost"] or actual_calls > row["worst_calls"]:
                raise BudgetExceeded("Verified usage exceeds reservation; hold remains")
            if row["state"] == "settled":
                if (actual_cost_micro, actual_calls) != (row["actual_cost"], row["actual_calls"]):
                    raise IdempotencyConflict("Usage already settled differently")
                return self._reservation(row)
            if row["state"] != "dispatched":
                raise LedgerError("Only dispatched usage may be settled")
            conn.execute("UPDATE budget_reservations SET state='settled',actual_cost=?,"
                         "actual_calls=? WHERE id=?", (actual_cost_micro, actual_calls, reservation_id))
            return self._reservation(self._scoped(conn, scope, reservation_id))

    def cancel(self, scope: TrustedScope, reservation_id: str) -> Reservation:
        scope.require("budget:reconcile")
        with self.transaction() as conn:
            self._expire(conn, self.now())
            row = self._scoped(conn, scope, reservation_id)
            if row["state"] not in ("reserved", "cancelled", "expired"):
                raise LedgerError("Cannot release dispatched or settled usage")
            if row["state"] == "reserved":
                conn.execute("UPDATE budget_reservations SET state='cancelled' WHERE id=?",
                             (reservation_id,))
            return self._reservation(self._scoped(conn, scope, reservation_id))

    def usage(self, scope: TrustedScope) -> dict[str, int]:
        scope.require("budget:reserve")
        with self.transaction() as conn:
            self._expire(conn, self.now())
            case_cost, case_calls = self._usage(conn, scope.tenant_ref, scope.case_ref)
            tenant_cost, tenant_calls = self._usage(conn, scope.tenant_ref, "")
            return {"case_cost_micro": case_cost, "case_calls": case_calls,
                    "tenant_cost_micro": tenant_cost, "tenant_calls": tenant_calls}
