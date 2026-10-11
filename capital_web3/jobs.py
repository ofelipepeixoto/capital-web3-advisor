"""Durable local queue and signed webhook ingress, with no external actions.

The queue uses at-least-once leases: a handler must make its own durable effect
idempotent (including BudgetLedger dispatch) before doing work. Nothing in this
module sends notifications, calls n8n/OpenAI, or approves/publishes reports.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from capital_web3.budget import (
    IdempotencyConflict, LedgerError, ScopedNotFound, TrustedScope,
    _Database, _identifier, _integer, request_digest,
)


PURPOSES = frozenset({"import", "draft", "monitor", "notification"})


@dataclass(frozen=True)
class Job:
    id: str
    tenant_ref: str
    case_ref: str
    actor_ref: str
    purpose: str
    payload: dict
    required_scopes: frozenset[str]
    deadline: int
    state: str
    attempts: int
    max_attempts: int
    claim_token: str | None
    lease_until: int | None


class DurableJobQueue(_Database):
    def __init__(self, path: str | Path, clock: Callable[[], float] = time.time) -> None:
        super().__init__(path, clock)
        with self.transaction() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS durable_jobs (
                id TEXT PRIMARY KEY, tenant TEXT NOT NULL, case_ref TEXT NOT NULL,
                actor TEXT NOT NULL, idem TEXT NOT NULL, digest TEXT NOT NULL,
                purpose TEXT NOT NULL, payload TEXT NOT NULL, scopes TEXT NOT NULL,
                deadline INTEGER NOT NULL, max_attempts INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL,
                state TEXT NOT NULL CHECK(state IN
                    ('queued','claimed','completed','failed','expired','cancelled')),
                worker TEXT, claim_token TEXT, lease_until INTEGER, result_digest TEXT,
                error_code TEXT,
                UNIQUE(tenant,case_ref,actor,idem))""")
            conn.execute("CREATE INDEX IF NOT EXISTS jobs_ready "
                         "ON durable_jobs(state,available,deadline)")

    @staticmethod
    def _job(row: sqlite3.Row) -> Job:
        return Job(row["id"], row["tenant"], row["case_ref"], row["actor"],
                   row["purpose"], json.loads(row["payload"]),
                   frozenset(json.loads(row["scopes"])), row["deadline"],
                   row["state"], row["attempts"], row["max_attempts"],
                   row["claim_token"], row["lease_until"])

    @staticmethod
    def _recover(conn: sqlite3.Connection, now: int) -> None:
        conn.execute("UPDATE durable_jobs SET state='expired',claim_token=NULL,"
                     "worker=NULL,lease_until=NULL WHERE state IN ('queued','claimed') "
                     "AND deadline<=?", (now,))
        conn.execute("UPDATE durable_jobs SET state='failed',claim_token=NULL,"
                     "worker=NULL,lease_until=NULL,error_code='attempts_exhausted' "
                     "WHERE state='claimed' AND lease_until<=? AND attempts>=max_attempts", (now,))
        conn.execute("UPDATE durable_jobs SET state='queued',available=?,claim_token=NULL,"
                     "worker=NULL,lease_until=NULL WHERE state='claimed' AND lease_until<=?",
                     (now, now))

    def enqueue(self, scope: TrustedScope, *, purpose: str, payload: dict,
                required_scopes: frozenset[str] | tuple[str, ...], deadline: int,
                idempotency_key: str, max_attempts: int = 3) -> Job:
        scope.require("jobs:enqueue")
        if purpose not in PURPOSES:
            raise LedgerError("Unsupported job purpose")
        required = frozenset(required_scopes)
        # Purpose-specific scope is compulsory, even if caller supplies [] here.
        required = required | {"job:" + purpose}
        for value in required:
            _identifier(value)
        if not required <= scope.grants:
            raise ScopedNotFound()
        _identifier(idempotency_key)
        _integer(deadline)
        _integer(max_attempts, maximum=5)
        if max_attempts < 1:
            raise LedgerError("At least one attempt is required")
        request_digest(payload)  # Reject non-object/non-JSON/oversized source data.
        digest = request_digest({"purpose": purpose, "payload": payload,
                                 "scopes": sorted(required), "deadline": deadline,
                                 "max_attempts": max_attempts})
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
        with self.transaction() as conn:
            now = self.now()
            self._recover(conn, now)
            row = conn.execute("SELECT * FROM durable_jobs WHERE "
                               "tenant=? AND case_ref=? AND actor=? AND idem=?",
                               (scope.tenant_ref, scope.case_ref, scope.actor_ref,
                                idempotency_key)).fetchone()
            if row is not None:
                if row["digest"] != digest:
                    raise IdempotencyConflict("Job key already binds a different request")
                return self._job(row)
            if not now < deadline <= now + 86_400:
                raise LedgerError("Deadline must be within the next 24 hours")
            job_id = uuid.uuid4().hex
            conn.execute("INSERT INTO durable_jobs "
                         "(id,tenant,case_ref,actor,idem,digest,purpose,payload,scopes,deadline,"
                         "max_attempts,available,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'queued')",
                         (job_id, scope.tenant_ref, scope.case_ref, scope.actor_ref,
                          idempotency_key, digest, purpose, encoded, json.dumps(sorted(required)),
                          deadline, max_attempts, now))
            return self._job(conn.execute("SELECT * FROM durable_jobs WHERE id=?",
                                          (job_id,)).fetchone())

    def get(self, scope: TrustedScope, job_id: str) -> Job:
        with self.transaction() as conn:
            self._recover(conn, self.now())
            row = conn.execute("SELECT * FROM durable_jobs WHERE id=? AND tenant=? "
                               "AND case_ref=? AND actor=?", (job_id, scope.tenant_ref,
                               scope.case_ref, scope.actor_ref)).fetchone()
            if row is None:
                raise ScopedNotFound()
            return self._job(row)

    def claim(self, worker_id: str, *, purposes: frozenset[str] | tuple[str, ...],
              lease_seconds: int = 30) -> Job | None:
        """Trusted internal worker API; never expose without worker authorization.

        The server must revalidate current assignment/consent/grants before a
        handler effect: the scopes saved here are an enqueue-time snapshot.
        """
        _identifier(worker_id)
        permitted = frozenset(purposes)
        if not permitted or not permitted <= PURPOSES:
            raise LedgerError("Worker purpose allowlist required")
        _integer(lease_seconds, maximum=300)
        if lease_seconds < 1:
            raise LedgerError("Lease must be positive")
        with self.transaction() as conn:
            now = self.now()
            self._recover(conn, now)
            marks = ",".join("?" for _ in permitted)
            row = conn.execute("SELECT * FROM durable_jobs WHERE state='queued' "
                               "AND available<=? AND deadline>? AND attempts<max_attempts "
                               "AND purpose IN (" + marks + ") ORDER BY available,id LIMIT 1",
                               (now, now, *sorted(permitted))).fetchone()
            if row is None:
                return None
            conn.execute("UPDATE durable_jobs SET state='claimed',attempts=attempts+1,"
                         "worker=?,claim_token=?,lease_until=? WHERE id=?",
                         (worker_id, uuid.uuid4().hex + uuid.uuid4().hex,
                          min(now + lease_seconds, row["deadline"]), row["id"]))
            return self._job(conn.execute("SELECT * FROM durable_jobs WHERE id=?",
                                          (row["id"],)).fetchone())

    def _claimed(self, conn: sqlite3.Connection, job_id: str, worker_id: str,
                 claim_token: str) -> sqlite3.Row:
        row = conn.execute("SELECT * FROM durable_jobs WHERE id=? AND state='claimed' "
                           "AND worker=? AND claim_token=? AND lease_until>? AND deadline>?",
                           (job_id, worker_id, claim_token, self.now(), self.now())).fetchone()
        if row is None:
            raise ScopedNotFound()
        return row

    def complete(self, job_id: str, worker_id: str, claim_token: str, *, result_digest: str) -> None:
        if not isinstance(result_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", result_digest):
            raise LedgerError("Result must be a SHA-256 digest")
        with self.transaction() as conn:
            self._claimed(conn, job_id, worker_id, claim_token)
            conn.execute("UPDATE durable_jobs SET state='completed',result_digest=?,"
                         "claim_token=NULL,worker=NULL,lease_until=NULL WHERE id=?",
                         (result_digest, job_id))

    def retry(self, job_id: str, worker_id: str, claim_token: str, *,
              delay_seconds: int = 1, error_code: str = "temporary_failure") -> None:
        _integer(delay_seconds, maximum=300)
        _identifier(error_code)
        with self.transaction() as conn:
            row = self._claimed(conn, job_id, worker_id, claim_token)
            now = self.now()
            state = ("failed" if row["attempts"] >= row["max_attempts"] or
                     now + delay_seconds >= row["deadline"] else "queued")
            conn.execute("UPDATE durable_jobs SET state=?,available=?,error_code=?,"
                         "claim_token=NULL,worker=NULL,lease_until=NULL WHERE id=?",
                         (state, now + delay_seconds, error_code, job_id))

    def cancel(self, scope: TrustedScope, job_id: str) -> None:
        scope.require("jobs:enqueue")
        with self.transaction() as conn:
            row = conn.execute("SELECT * FROM durable_jobs WHERE id=? AND tenant=? "
                               "AND case_ref=? AND actor=?", (job_id, scope.tenant_ref,
                               scope.case_ref, scope.actor_ref)).fetchone()
            if row is None:
                raise ScopedNotFound()
            if row["state"] not in ("queued", "cancelled"):
                raise LedgerError("Only unclaimed work can be cancelled")
            conn.execute("UPDATE durable_jobs SET state='cancelled' WHERE id=?", (job_id,))


class WebhookRejected(LedgerError):
    pass


class SignedWebhookVerifier(_Database):
    """HMAC verified before nonce commit. No payload, URLs or identity trusted.

    Not a production endpoint. Caller binds verified webhook to a configured
    service account, rechecks object authorization, then enqueues durably. Keep
    authenticated timestamp/nonce/signature out of logs. No implicit retry of a
    consumed nonce; a delivery may be safely retried with a new signed nonce and
    the same domain idempotency key.
    """

    def __init__(self, path: str | Path, *, secret: bytes, target: str,
                 max_age: int = 300, clock: Callable[[], float] = time.time) -> None:
        if not isinstance(secret, bytes) or len(secret) < 32:
            raise LedgerError("Webhook secret must be >=32 bytes, from protected configuration")
        if not isinstance(target, str) or not re.fullmatch(r"/[A-Za-z0-9/_-]{1,160}", target):
            raise LedgerError("A fixed configured path is required")
        _integer(max_age, maximum=300)
        if max_age < 1:
            raise LedgerError("Webhook lifetime must be positive")
        super().__init__(path, clock)
        self.secret, self.target, self.max_age = secret, target, max_age
        self.channel = hashlib.sha256(secret + b"\x00" + target.encode()).hexdigest()
        with self.transaction() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS webhook_nonces "
                         "(channel TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL,"
                         "PRIMARY KEY(channel,nonce))")

    @staticmethod
    def signing_input(method: str, target: str, timestamp: int, nonce: str, body: bytes) -> bytes:
        return (f"CW3-HMAC-v1\n{method}\n{target}\n{timestamp}\n{nonce}\n".encode() +
                hashlib.sha256(body).hexdigest().encode())

    def verify(self, *, method: str, target: str, timestamp: int, nonce: str,
               body: bytes, signature: str) -> str:
        """Returns body digest once; signature is lowercase hex, no bearer auth."""
        now = self.now()
        if (method != "POST" or target != self.target or type(timestamp) is not int or
                not 0 <= now - timestamp <= self.max_age or not isinstance(body, bytes) or
                len(body) > 65_536 or not isinstance(nonce, str) or
                not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", nonce) or
                not isinstance(signature, str) or not re.fullmatch(r"[0-9a-f]{64}", signature)):
            raise WebhookRejected("Webhook unavailable")
        expected = hmac.new(self.secret, self.signing_input(method, target, timestamp, nonce, body),
                            hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise WebhookRejected("Webhook unavailable")
        with self.transaction() as conn:
            conn.execute("DELETE FROM webhook_nonces WHERE expires<?", (now,))
            try:
                conn.execute("INSERT INTO webhook_nonces VALUES (?,?,?)",
                             (self.channel, nonce, timestamp + self.max_age))
            except sqlite3.IntegrityError as error:
                raise WebhookRejected("Webhook unavailable") from error
        return hashlib.sha256(body).hexdigest()
