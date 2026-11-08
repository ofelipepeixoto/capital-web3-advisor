-- Disposable database regression. Revoke inside transaction; rollback leaves
-- other test suites and fixtures untouched. No real DB may run this suite.
BEGIN;
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated',
   'capital_web3.advisory_save_cofre_intake(uuid,jsonb,jsonb,integer,uuid)', 'EXECUTE') THEN
   RAISE EXCEPTION 'baseline RPC unexpectedly unavailable';
 END IF;
END $$;
\ir ../../scripts/security/disable_forged_cofre_reports.sql
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM capital_web3.advisory_save_cofre_intake('10000000-0000-0000-0000-000000000001'::uuid,
     '{}'::jsonb, '{"summary":"conteudo adulterado ficticio"}'::jsonb, 0,
     '10000000-0000-0000-0000-000000000002'::uuid);
   RAISE EXCEPTION 'forged report was not blocked';
 EXCEPTION WHEN insufficient_privilege THEN
   RAISE NOTICE 'PASS: authenticated direct forged content denied';
 END;
 BEGIN
   PERFORM capital_web3.advisory_save_cofre_intake('10000000-0000-0000-0000-000000000001'::uuid,
     '{}'::jsonb, '{}'::jsonb, 0, '10000000-0000-0000-0000-000000000002'::uuid);
   RAISE EXCEPTION 'normal report write was not disabled';
 EXCEPTION WHEN insufficient_privilege THEN
   RAISE NOTICE 'PASS: all writes fail closed until trusted generator exists';
 END;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated',
   'capital_web3.advisory_save_cofre_intake(uuid,jsonb,jsonb,integer,uuid)', 'EXECUTE') THEN
   RAISE EXCEPTION 'rollback failed to restore baseline access';
 END IF;
 RAISE NOTICE 'PASS: transactional rollback restored original access';
END $$;
