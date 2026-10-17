-- Run after security_hardening_template.sql on disposable Supabase only.
-- Synthetic identities/claims; this tests SQL privileges and RLS, not JWT login.
begin;
create temporary table client_column_sentinel(id integer);
do $$ declare temporary_schema text; begin
  select nspname into strict temporary_schema from pg_catalog.pg_namespace
    where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated',temporary_schema);
end $$;
create function pg_temp.require(p_condition boolean, p_label text)
returns void language plpgsql security invoker as $$
begin
  if p_condition is distinct from true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;
create function pg_temp.expect_denied(p_sql text, p_label text)
returns void language plpgsql security invoker as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege then
    raise notice 'PASS: % (SQLSTATE 42501)', p_label; return;
  end;
  raise exception 'FAIL: % unexpectedly succeeded', p_label;
end $$;
grant execute on function pg_temp.require(boolean,text),
  pg_temp.expect_denied(text,text) to authenticated;

insert into auth.users(id,email) values
 ('12000000-0000-0000-0000-000000000001','column-client@example.invalid'),
 ('12000000-0000-0000-0000-000000000002','column-other@example.invalid'),
 ('12000000-0000-0000-0000-000000000010','column-author@example.invalid'),
 ('12000000-0000-0000-0000-000000000011','column-reviewer@example.invalid');
insert into capital_web3.advisory_cases(id,client_safe_title,created_by) values
 ('22000000-0000-0000-0000-000000000001','Synthetic column-privacy case',
  '12000000-0000-0000-0000-000000000010');
insert into capital_web3.advisory_case_staff(case_id,user_id,staff_role) values
 ('22000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000010','analyst'),
 ('22000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000011','reviewer'),
 ('22000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000011','publisher');
insert into capital_web3.advisory_case_clients(case_id,user_id) values
 ('22000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001');
insert into capital_web3.advisory_reports(id,case_id,created_by) values
 ('32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000010');
insert into capital_web3.advisory_report_versions(id,report_id,case_id,version_number,content,created_by) values
 ('42000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',1,'{"title":"Synthetic client-safe report"}',
  '12000000-0000-0000-0000-000000000010');
insert into capital_web3.advisory_human_reviews(id,case_id,report_version_id,reviewer_user_id,decision,reviewed_content_sha256,reviewed_manifest_sha256)
 select '52000000-0000-0000-0000-000000000001',case_id,id,
 '12000000-0000-0000-0000-000000000011','approved',content_sha256,
 capital_web3_private.manifest_sha256(id) from capital_web3.advisory_report_versions
 where id='42000000-0000-0000-0000-000000000001';
insert into capital_web3.advisory_publications(id,case_id,report_version_id,human_review_id,publisher_user_id) values
 ('62000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001',
  '42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000011');
insert into capital_web3.advisory_publication_recipients(publication_id,case_id,user_id) values
 ('62000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000001',true);
select pg_temp.require((select count(*)=1 from capital_web3.advisory_cases
 where id='22000000-0000-0000-0000-000000000001'),'client still reads its case');
select pg_temp.require((select content->>'title'='Synthetic client-safe report'
 from capital_web3.advisory_report_versions where id='42000000-0000-0000-0000-000000000001'),
 'client still reads permitted report content');
select pg_temp.require((select count(*)=1 from capital_web3.advisory_publications
 where id='62000000-0000-0000-0000-000000000001'),'client still reads its publication');
select pg_temp.expect_denied('select created_by from capital_web3.advisory_cases','case staff identity is hidden');
select pg_temp.expect_denied('select created_by from capital_web3.advisory_reports','report staff identity is hidden');
select pg_temp.expect_denied('select created_by from capital_web3.advisory_report_versions','version author identity is hidden');
select pg_temp.expect_denied('select publisher_user_id from capital_web3.advisory_publications','publisher identity is hidden');
select pg_temp.expect_denied('select human_review_id from capital_web3.advisory_publications','internal review ID is hidden');
select pg_temp.expect_denied('select author_user_id from capital_web3.advisory_clarifications','clarification staff identity is hidden');
select pg_temp.expect_denied('select * from capital_web3.advisory_report_versions','wildcard cannot recover internal fields');

select set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000002',true);
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions
 where id='42000000-0000-0000-0000-000000000001'),'safe column grants preserve other-client denial');

select set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000011","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000011',true);
select pg_temp.require((capital_web3.advisory_get_review_package(
 '42000000-0000-0000-0000-000000000001')->'content'->>'title')='Synthetic client-safe report',
 'assigned staff still obtains review package through controlled RPC');
reset role;
rollback;
