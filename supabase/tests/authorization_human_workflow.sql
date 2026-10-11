-- Execute as the controlled DB owner on isolated Supabase staging after 0001+0002.
-- Transactional synthetic claims exercise SQL authorization, not JWT signatures,
-- user login, file bytes or HTTP transport. No fixture persists after rollback.
begin;
create temporary table human_test_results(label text primary key, result jsonb);
-- GRANT SCHEMA does not resolve the pg_temp alias; grant the actual
-- transaction-local namespace created by the temporary table above.
do $$ declare temporary_schema text; begin
  select nspname into strict temporary_schema from pg_catalog.pg_namespace
    where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated, anon',temporary_schema);
end $$;
grant select, insert on human_test_results to authenticated;
create function pg_temp.require(p_condition boolean, p_label text)
returns void language plpgsql security invoker as $$ begin
  if p_condition is distinct from true then raise exception 'FAIL: %',p_label; end if;
  raise notice 'PASS: %',p_label;
end $$;
create function pg_temp.expect_error(p_sql text,p_state text,p_label text)
returns void language plpgsql security invoker as $$ begin
  begin execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice 'PASS: % (SQLSTATE %)',p_label,sqlstate; return; end if;
    raise exception 'FAIL: % expected %, got %: %',p_label,p_state,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % unexpectedly succeeded',p_label;
end $$;
grant execute on function pg_temp.require(boolean,text),pg_temp.expect_error(text,text,text)
  to authenticated,anon;

insert into auth.users(id,email) values
 ('11000000-0000-0000-0000-000000000001','hw-client-a@example.invalid'),
 ('11000000-0000-0000-0000-000000000002','hw-client-b@example.invalid'),
 ('11000000-0000-0000-0000-000000000003','hw-client-inactive@example.invalid'),
 ('11000000-0000-0000-0000-000000000010','hw-author@example.invalid'),
 ('11000000-0000-0000-0000-000000000011','hw-reviewer@example.invalid'),
 ('11000000-0000-0000-0000-000000000012','hw-publisher@example.invalid'),
 ('11000000-0000-0000-0000-000000000013','hw-unassigned@example.invalid');
insert into capital_web3.advisory_cases(id,client_safe_title,created_by) values
 ('21000000-0000-0000-0000-000000000001','Synthetic human workflow A','11000000-0000-0000-0000-000000000010'),
 ('21000000-0000-0000-0000-000000000002','Synthetic human workflow B','11000000-0000-0000-0000-000000000013');
insert into capital_web3.advisory_case_staff(case_id,user_id,staff_role) values
 ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000010','admin'),
 ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000011','reviewer'),
 ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000012','publisher'),
 ('21000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000013','admin');
insert into capital_web3.advisory_case_clients(case_id,user_id,active) values
 ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',true),
 ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000002',true),
 ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000003',false),
 ('21000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000002',true);
insert into capital_web3.advisory_reports(id,case_id,created_by) values
 ('31000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000010');
insert into capital_web3.advisory_report_versions(id,report_id,case_id,version_number,content,created_by) values
 ('41000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',1,'{"title":"Human workflow test"}','11000000-0000-0000-0000-000000000010'),
 ('41000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',2,'{"title":"Rejected draft"}','11000000-0000-0000-0000-000000000010');
insert into capital_web3.advisory_report_assets(report_version_id,case_id,object_name,bytes_sha256,mime_type)
 values ('41000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',
  'human-workflow/v1/package.json',repeat('d',64),'application/json');

select pg_temp.require(not has_table_privilege('authenticated','capital_web3.advisory_receipts','INSERT'),
 'clients cannot bypass locking RPC with direct receipt inserts');
select pg_temp.require(not has_function_privilege('anon','capital_web3.advisory_review_report(uuid,text,text,text,text,uuid)','EXECUTE'),
 'anon cannot call human review RPC');
select pg_temp.require(not has_function_privilege('service_role','capital_web3.advisory_publish_report(uuid,uuid[],text,text,timestamptz,uuid)','EXECUTE'),
 'service role is not a human workflow RPC principal');
select pg_temp.require(not has_table_privilege('authenticated','capital_web3_private.human_workflow_actions','SELECT'),
 'private action receipts cannot be read by clients or staff');
select pg_temp.require(not has_function_privilege('authenticated','capital_web3_private.previous_human_action(uuid,text,uuid,jsonb)','EXECUTE'),
 'internal action helper cannot be called by authenticated users');
select pg_temp.require((select c.relrowsecurity and c.relforcerowsecurity from pg_class c
 join pg_namespace n on n.oid=c.relnamespace where n.nspname='capital_web3_private' and c.relname='human_workflow_actions'),
 'private action receipt table has FORCE RLS');
select pg_temp.require(not exists(select 1 from pg_proc f join pg_namespace n on n.oid=f.pronamespace
 join pg_roles r on r.oid=f.proowner where f.prosecdef and
 ((n.nspname='capital_web3' and f.proname like 'advisory_%') or n.nspname='capital_web3_private')
 and not (r.rolbypassrls or r.rolsuper)), 'workflow definer owners can enforce FORCE RLS helpers');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false,"user_metadata":{"role":"admin"}}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package('41000000-0000-0000-0000-000000000001')$q$,
 '42501','client cannot inspect staff review package');
select pg_temp.expect_error($q$select capital_web3.advisory_review_report('41000000-0000-0000-0000-000000000001',
 'approved',repeat('a',64),repeat('b',64),'','71000000-0000-0000-0000-000000000001')$q$,
 '42501','client metadata cannot authorize human review');
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000001',
 array['11000000-0000-0000-0000-000000000001']::uuid[],repeat('a',64),repeat('b',64),null,
 '71000000-0000-0000-0000-000000000002')$q$,'42501','client cannot publish a report');
select pg_temp.expect_error($q$select capital_web3.advisory_record_receipt('61000000-0000-0000-0000-000000000001')$q$,
 '42501','client cannot create a receipt for nonexistent publication');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000010","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000010',true);
insert into human_test_results values ('package_v1',capital_web3.advisory_get_review_package('41000000-0000-0000-0000-000000000001'));
insert into human_test_results values ('package_v2',capital_web3.advisory_get_review_package('41000000-0000-0000-0000-000000000002'));
select pg_temp.require((select result->>'content_sha256' ~ '^[a-f0-9]{64}$' and
 result->>'manifest_sha256' ~ '^[a-f0-9]{64}$' from human_test_results where label='package_v1'),
 'staff review package has server-computed content and manifest hashes');
select pg_temp.require((select not (result ? 'private_notes') and jsonb_array_length(result->'assets')=1
 from human_test_results where label='package_v1'), 'review package includes exact assets without reviewer notes');
select pg_temp.expect_error($q$select capital_web3.advisory_review_report('41000000-0000-0000-0000-000000000001',
 'approved',(select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),'',
 '71000000-0000-0000-0000-000000000003')$q$,'42501','admin author cannot self-review');
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000001',
 array['11000000-0000-0000-0000-000000000001']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),null,
 '71000000-0000-0000-0000-000000000004')$q$,'42501','admin author cannot self-publish');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000013","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000013',true);
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package('41000000-0000-0000-0000-000000000001')$q$,
 '42501','admin assigned to case B cannot inspect case A');
select pg_temp.expect_error($q$select capital_web3.advisory_review_report('41000000-0000-0000-0000-000000000001',
 'approved',(select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),'',
 '71000000-0000-0000-0000-000000000005')$q$,'42501','staff assigned to B cannot review A');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000011","role":"authenticated","is_anonymous":true}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000011',true);
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package('41000000-0000-0000-0000-000000000001')$q$,
 '42501','anonymous Auth user is denied despite assigned reviewer UID');
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000011","role":"authenticated","is_anonymous":false}',true);
select pg_temp.expect_error($q$select capital_web3.advisory_review_report('41000000-0000-0000-0000-000000000001',
 'approved',repeat('a',64),(select result->>'manifest_sha256' from human_test_results where label='package_v1'),'',
 '71000000-0000-0000-0000-000000000006')$q$,'23514','review rejects stale content hash');
select pg_temp.expect_error($q$select capital_web3.advisory_review_report('41000000-0000-0000-0000-000000000001',
 'approved',(select result->>'content_sha256' from human_test_results where label='package_v1'),repeat('a',64),'',
 '71000000-0000-0000-0000-000000000007')$q$,'23514','review rejects stale manifest hash');
insert into human_test_results values ('review_v1',capital_web3.advisory_review_report(
 '41000000-0000-0000-0000-000000000001','approved',
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),'Synthetic review note',
 '71000000-0000-0000-0000-000000000008'));
select pg_temp.require(capital_web3.advisory_review_report('41000000-0000-0000-0000-000000000001','approved',
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),'Synthetic review note',
 '71000000-0000-0000-0000-000000000008')=(select result from human_test_results where label='review_v1'),
 'identical review retry returns the same immutable decision');
select pg_temp.expect_error($q$select capital_web3.advisory_review_report('41000000-0000-0000-0000-000000000001',
 'rejected',(select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),'Synthetic review note',
 '71000000-0000-0000-0000-000000000008')$q$,'23505','review idempotency cannot be replayed with a changed decision');
insert into human_test_results values ('review_v2',capital_web3.advisory_review_report(
 '41000000-0000-0000-0000-000000000002','rejected',
 (select result->>'content_sha256' from human_test_results where label='package_v2'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v2'),'',
 '71000000-0000-0000-0000-000000000009'));
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000012","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000012',true);
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000002',
 array['11000000-0000-0000-0000-000000000001']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v2'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v2'),null,
 '71000000-0000-0000-0000-000000000010')$q$,'23514','rejected version cannot be published');
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000001',
 array['11000000-0000-0000-0000-000000000003']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),null,
 '71000000-0000-0000-0000-000000000011')$q$,'42501','inactive recipient cannot receive a publication');
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000001',
 array['11000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000003']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),null,
 '71000000-0000-0000-0000-000000000012')$q$,'42501','invalid recipient set causes atomic publication failure');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_publications
 where report_version_id='41000000-0000-0000-0000-000000000001'),
 'failed release leaves no publication or partial recipients');
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000001',
 array['11000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),null,
 '71000000-0000-0000-0000-000000000013')$q$,'22023','duplicate recipients are rejected');
insert into human_test_results values ('publication_v1',capital_web3.advisory_publish_report(
 '41000000-0000-0000-0000-000000000001',array['11000000-0000-0000-0000-000000000001']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),null,
 '71000000-0000-0000-0000-000000000014'));
select pg_temp.require(capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000001',
 array['11000000-0000-0000-0000-000000000001']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),null,
 '71000000-0000-0000-0000-000000000014')=(select result from human_test_results where label='publication_v1'),
 'identical publication retry returns the same release');
select pg_temp.require((select count(*)=1 from capital_web3.advisory_publications
 where report_version_id='41000000-0000-0000-0000-000000000001'), 'publication retry creates no duplicate release');
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000001',
 array['11000000-0000-0000-0000-000000000002']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),null,
 '71000000-0000-0000-0000-000000000014')$q$,'23505','publication key is bound to the exact recipient set');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
select pg_temp.require((select count(*)=1 from capital_web3.advisory_report_versions
 where case_id='21000000-0000-0000-0000-000000000001'), 'recipient reads only the published exact version');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_human_reviews), 'recipient cannot read reviewer private notes');
select pg_temp.expect_error($q$insert into capital_web3.advisory_receipts(publication_id,case_id,report_version_id,user_id)
 values ((select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'),
 '21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
 '11000000-0000-0000-0000-000000000001')$q$,'42501','authorized recipient cannot insert a receipt directly');
insert into human_test_results values ('receipt_v1',capital_web3.advisory_record_receipt(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1')));
select pg_temp.require(capital_web3.advisory_record_receipt(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'))=
 (select result from human_test_results where label='receipt_v1'), 'receipt retry returns the same acknowledgement');
select pg_temp.require((select count(*)=1 and bool_and(user_id='11000000-0000-0000-0000-000000000001')
 from capital_web3.advisory_receipts), 'receipt author is derived from auth.uid without caller identity');
select pg_temp.expect_error($q$select capital_web3.advisory_revoke_publication(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'),null,'Unauthorized',
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),
 '71000000-0000-0000-0000-000000000015')$q$,'42501','recipient cannot revoke a publication');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions
 where case_id='21000000-0000-0000-0000-000000000001'), 'membership alone does not grant unpublished recipient access');
select pg_temp.expect_error($q$select capital_web3.advisory_record_receipt(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'))$q$,
 '42501','nonrecipient cannot acknowledge another client publication');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000012","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000012',true);
select pg_temp.expect_error($q$select capital_web3.advisory_revoke_publication(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'),null,'Wrong package',
 repeat('a',64),(select result->>'manifest_sha256' from human_test_results where label='package_v1'),
 '71000000-0000-0000-0000-000000000016')$q$,'23514','revocation must bind the exact published package');
select pg_temp.expect_error($q$select capital_web3.advisory_revoke_publication(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'),
 '11000000-0000-0000-0000-000000000002','Wrong recipient',
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),
 '71000000-0000-0000-0000-000000000017')$q$,'42501','targeted revocation cannot name a nonrecipient');
insert into human_test_results values ('revocation_v1',capital_web3.advisory_revoke_publication(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'),null,'Synthetic withdrawal',
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),
 '71000000-0000-0000-0000-000000000018'));
select pg_temp.require(capital_web3.advisory_revoke_publication(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'),null,'Synthetic withdrawal',
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),
 '71000000-0000-0000-0000-000000000018')=(select result from human_test_results where label='revocation_v1'),
 'identical revocation retry returns the same record');
select pg_temp.expect_error($q$select capital_web3.advisory_revoke_publication(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'),null,'Changed reason',
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),
 '71000000-0000-0000-0000-000000000018')$q$,'23505','revocation key cannot be replayed with different reason');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions
 where case_id='21000000-0000-0000-0000-000000000001'), 'committed-style revocation blocks future report reads');
select pg_temp.expect_error($q$select capital_web3.advisory_record_receipt(
 (select (result->>'publication_id')::uuid from human_test_results where label='publication_v1'))$q$,
 '42501','receipt replay is denied after revocation');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
select pg_temp.require((select bool_and(reviewer_user_id='11000000-0000-0000-0000-000000000011')
 from capital_web3.advisory_human_reviews where case_id='21000000-0000-0000-0000-000000000001'),
 'review actors are all the actual authenticated reviewer');
select pg_temp.require((select bool_and(publisher_user_id='11000000-0000-0000-0000-000000000012')
 from capital_web3.advisory_publications where case_id='21000000-0000-0000-0000-000000000001'),
 'publication actor is the actual authenticated publisher');
select pg_temp.require((select count(*)=1 from capital_web3.advisory_publication_revocations
 where case_id='21000000-0000-0000-0000-000000000001'), 'revocation retry creates no duplicate record');
select pg_temp.require((select count(*)=4 from capital_web3_private.human_workflow_actions
 where actor_user_id in ('11000000-0000-0000-0000-000000000011','11000000-0000-0000-0000-000000000012')),
 'action receipts record exactly two reviews, one release and one revocation');
select pg_temp.require((select count(*)>=4 from capital_web3.advisory_audit_events
 where case_id='21000000-0000-0000-0000-000000000001' and action in
 ('advisory_human_reviews.insert','advisory_publications.insert','advisory_publication_revocations.insert')),
 'human decisions generate append-only audit events');
-- A replay never restores authority after an administrative assignment removal.
update capital_web3.advisory_case_staff set active=false
 where case_id='21000000-0000-0000-0000-000000000001'
 and user_id in ('11000000-0000-0000-0000-000000000011','11000000-0000-0000-0000-000000000012');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000011","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000011',true);
select pg_temp.expect_error($q$select capital_web3.advisory_review_report('41000000-0000-0000-0000-000000000001',
 'approved',(select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),'Synthetic review note',
 '71000000-0000-0000-0000-000000000008')$q$,'42501','review replay cannot restore a deactivated reviewer assignment');
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000012","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000012',true);
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report('41000000-0000-0000-0000-000000000001',
 array['11000000-0000-0000-0000-000000000001']::uuid[],
 (select result->>'content_sha256' from human_test_results where label='package_v1'),
 (select result->>'manifest_sha256' from human_test_results where label='package_v1'),null,
 '71000000-0000-0000-0000-000000000014')$q$,'42501','publication replay cannot restore a deactivated publisher assignment');
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package('41000000-0000-0000-0000-000000000001')$q$,
 '42501','authenticated SQL role without a human UID cannot inspect packages');
select set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000010","role":"service_role","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000010',true);
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package('41000000-0000-0000-0000-000000000001')$q$,
 '42501','machine-role claims cannot represent a human actor');
reset role;
rollback;
