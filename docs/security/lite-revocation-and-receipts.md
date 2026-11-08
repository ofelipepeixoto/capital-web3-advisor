# Candidate controls for Lite synthetic signals

Scope: candidate migration `supabase/pending/cofre_lite_signals.sql`. No hosted database changes.

## Ordering of revocation and in-flight operations

A Lite read or write locks the case, its workspace mapping, the feature row, the workspace policy, the actor's analyst membership, each matching case assignment in role order, and the current session row, then rechecks identity, MFA and authorization. Locks remain until transaction completion. A concurrent update or delete of one of those existing rows must wait, or completes first and is caught by the subsequent check. A write already authorized and holding locks is allowed to commit before the revocation; once revocation commits, later operations are denied. Consistent ordering is necessary in any future multi-row admin operation to reduce deadlock risk; transaction aborts must be retried safely.

This does not serialize a newly added MFA factor or guarantee expiry semantics when a transaction is already running at the time a session expires. It is not a global guarantee for other RPCs. Add explicit lifecycle controls and tests before extending the promise to all account and factor changes.

## Receipt capacity and retention

`cofre_lite_receipt_policy` is a private singleton. Default capacity is 128 distinct keys per actor across all workspaces; an authorized database operator may configure 1–10,000. The minimum retention metadata defaults to 365 days and accepts 1–3,650. New receipts record `retain_until`; existing receipts preserve their original deadline if policy changes. Existing matching keys replay before quota is enforced. A conflicting request using the same key is rejected.

There is deliberately no deletion or scheduled cleanup. Reaching the configured cap continues to block new saves until an operator reviews capacity. `retain_until` is only a minimum, not authorization to delete: deleting a receipt loses replay protection and can allow a later retry to be interpreted as a new request. A future retention design must define retry windows, tombstones, audit/backup, access control and an approved manual procedure before any purge. No plaintext request or intake is stored in the receipt.

## Required review

Review PostgreSQL lock ordering against every administrative revocation transaction and any new factor-management code. Run the disposable database integration suite for both ordering directions and API denial tests. Review hosted migration and rollback separately; candidate is not deployed. Synthetic markers do not establish that data is actually fictitious, and consent booleans are not evidence of real consent.
