-- Disposable database only: requires tests/fixtures/shared_neighbor.sql BEFORE migrations.
begin;
create temporary table shared_test_sentinel(id integer);
do $$ declare s text; begin
 select nspname into strict s from pg_namespace where oid=pg_my_temp_schema();
 execute format('grant usage on schema %I to authenticated, anon',s);
end $$;
create function pg_temp.require(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if;
 raise notice 'PASS: %',label;
end $$;
grant execute on function pg_temp.require(boolean,text) to authenticated, anon;
select pg_temp.require((select count(*)=1 from public.advisory_cases), 'neighbor table and row survive installation');
select pg_temp.require(public.advisory_neighbor()=73, 'neighbor public function survives installation');
select pg_temp.require((select id=73 from advisory_private.neighbor_sentinel), 'neighbor private schema survives installation');
select pg_temp.require((select count(*)=14 and bool_and(relrowsecurity and relforcerowsecurity)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='capital_web3' and c.relkind='r'), 'all 14 application tables enforce RLS in their own schema');
select pg_temp.require((select count(*)=5 and bool_and(relrowsecurity and relforcerowsecurity)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='capital_web3_private' and c.relkind='r'), 'all five private tables enforce RLS');
select pg_temp.require(not has_schema_privilege('anon','capital_web3','usage'), 'anonymous role has no application schema access');
select pg_temp.require(not has_schema_privilege('authenticated','capital_web3','create'), 'clients cannot create application objects');
select pg_temp.require((select public=false from storage.buckets where id='capital-web3-advisory'), 'dedicated bucket is private');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-000000000001',true);
select pg_temp.require((select count(*)=0 from capital_web3.advisory_cases), 'authenticated identity from another app has no Capital cases');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_case_staff), 'authenticated identity cannot acquire Capital staff');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions), 'authenticated identity from another app has no Capital reports');
select pg_temp.require((select count(*)=1 from public.advisory_cases), 'neighbor table keeps its original read policy');
select pg_temp.require((select count(*)=1 from storage.objects where bucket_id='neighbor-fixture'), 'neighbor bucket keeps its original read policy');
reset role;
rollback;
