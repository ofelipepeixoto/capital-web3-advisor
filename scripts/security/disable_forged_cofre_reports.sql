-- Emergency gate for REVIEW ONLY. Run under a privileged migration owner in a
-- transactional deployment. This is intentionally fail-closed: it disables ALL
-- new COFRE report generation through Edge and direct PostgREST until a trusted
-- server-side canonical report generator replaces this RPC. Existing reads and
-- unrelated workflows are not changed. No data is deleted.
-- psql -X -v ON_ERROR_STOP=1 --single-transaction -f scripts/security/disable_forged_cofre_reports.sql
DO $guard$
DECLARE f regprocedure := to_regprocedure('capital_web3.advisory_save_cofre_intake(uuid,jsonb,jsonb,integer,uuid)');
BEGIN
  IF f IS NULL THEN RAISE EXCEPTION 'expected COFRE report RPC is missing'; END IF;
  REVOKE ALL ON FUNCTION capital_web3.advisory_save_cofre_intake(uuid,jsonb,jsonb,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
  IF has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
     OR has_function_privilege('service_role',f,'EXECUTE') THEN
     RAISE EXCEPTION 'inherited report RPC access remains; investigate role grants';
  END IF;
END $guard$;
