-- Operator-only read preview. No mutations, Auth reads, report bodies or secrets.
-- Proposed synthetic 30-day review period, not an approved legal retention term.
-- Run with psql -X -v ON_ERROR_STOP=1 -f scripts/retention_preview.sql using
-- a protected operator connection. Never place the connection URI in Git/logs.
begin read only;
set local statement_timeout = '10s';
set local lock_timeout = '2s';
with synthetic_cases as (
  select c.id, c.created_at
  from capital_web3.advisory_cases c
  join capital_web3_private.cofre_case_workspaces cw on cw.case_id=c.id
  join capital_web3_private.cofre_workspaces w on w.id=cw.workspace_id
  where w.synthetic_only
), events as (
  select id as case_id, created_at as activity_at from synthetic_cases
  union all select i.case_id, i.created_at from capital_web3.cofre_intakes i join synthetic_cases c on c.id=i.case_id
  union all select r.case_id, r.reviewed_at from capital_web3.advisory_human_reviews r join synthetic_cases c on c.id=r.case_id
  union all select p.case_id, p.published_at from capital_web3.advisory_publications p join synthetic_cases c on c.id=p.case_id
  union all select r.case_id, r.revoked_at from capital_web3.advisory_publication_revocations r join synthetic_cases c on c.id=r.case_id
  union all select r.case_id, r.received_at from capital_web3.advisory_receipts r join synthetic_cases c on c.id=r.case_id
  union all select q.case_id, q.created_at from capital_web3.advisory_clarifications q join synthetic_cases c on c.id=q.case_id
), latest as (
  select case_id, max(activity_at) as last_activity_at from events group by case_id
)
select l.case_id, l.last_activity_at,
       l.last_activity_at + interval '30 days' as proposed_review_at,
       'REVIEW_ONLY_NO_DELETE'::text as disposition,
       'Owner must verify case closure, unresolved requests, holds and backups'::text as required_decision
from latest l
where l.last_activity_at < now() - interval '30 days'
order by l.last_activity_at, l.case_id;
rollback;
