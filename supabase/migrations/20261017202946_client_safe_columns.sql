-- Additive Capital-only column grants. Apply after 0001/0002 using a CLI-generated
-- migration in disposable CI first. Does not change Auth or neighbor applications.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A client can call exposed PostgREST tables directly with its authenticated JWT.
-- An Edge projection alone cannot hide staff identifiers from that route. Keep
-- row authorization unchanged and grant only client-safe columns at the table.
-- Trusted review RPCs run with their controlled owner and retain internal access.
revoke select on capital_web3.advisory_cases,
  capital_web3.advisory_reports, capital_web3.advisory_report_versions,
  capital_web3.advisory_publications, capital_web3.advisory_clarifications
  from authenticated;

grant select (id, client_safe_title, created_at)
  on capital_web3.advisory_cases to authenticated;
grant select (id, case_id, created_at)
  on capital_web3.advisory_reports to authenticated;
grant select (id, report_id, case_id, version_number, content,
  content_sha256, created_at)
  on capital_web3.advisory_report_versions to authenticated;
grant select (id, case_id, report_version_id, published_at, expires_at)
  on capital_web3.advisory_publications to authenticated;
grant select (id, publication_id, case_id, report_version_id,
  thread_client_user_id, entry_kind, parent_id, message, created_at)
  on capital_web3.advisory_clarifications to authenticated;

-- INSERT/UPDATE permissions and RLS remain unchanged. Runtime callers must use
-- an explicit projection; SELECT * intentionally fails on these tables.
notify pgrst, 'reload schema';
commit;
