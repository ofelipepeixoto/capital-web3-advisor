-- FUTURE INTEGRATION SUITE: run as database owner on isolated Supabase staging.
-- Synthetic claims exercise RLS, NOT JWT signature/login or real Storage bytes.
-- Requires 0001_advisory.sql and auth/storage schemas. Everything rolls back.
-- psql --set ON_ERROR_STOP=1 --file supabase/tests/authorization.sql
begin;

create temporary table advisory_test_sentinel(id integer);
grant usage on schema pg_temp to authenticated, anon;
create function pg_temp.require(p_condition boolean, p_label text)
returns void language plpgsql security invoker as $$
begin
  if p_condition is distinct from true then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;
create function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql security invoker as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then
      raise notice 'PASS: % (SQLSTATE %)', p_label, sqlstate;
      return;
    end if;
    raise exception 'FAIL: % expected SQLSTATE %, got %: %', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % unexpectedly succeeded', p_label;
end;
$$;
grant execute on function pg_temp.require(boolean,text),
  pg_temp.expect_error(text,text,text) to authenticated, anon;

-- Two fictitious clients plus assigned staff; no usable passwords or sessions.
insert into auth.users(id,email) values
  ('10000000-0000-0000-0000-000000000001','client-a@example.invalid'),
  ('10000000-0000-0000-0000-000000000002','client-b@example.invalid'),
  ('10000000-0000-0000-0000-000000000010','analyst-a@example.invalid'),
  ('10000000-0000-0000-0000-000000000011','reviewer-a-analyst-b@example.invalid'),
  ('10000000-0000-0000-0000-000000000012','reviewer-b@example.invalid');

insert into public.advisory_cases(id,client_safe_title,created_by) values
  ('20000000-0000-0000-0000-000000000001','Synthetic case A','10000000-0000-0000-0000-000000000010'),
  ('20000000-0000-0000-0000-000000000002','Synthetic case B','10000000-0000-0000-0000-000000000011');
insert into public.advisory_case_staff(case_id,user_id,staff_role) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000010','analyst'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000011','reviewer'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000011','publisher'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000011','analyst'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000012','reviewer'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000012','publisher');
insert into public.advisory_case_clients(case_id,user_id) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into public.advisory_reports(id,case_id,created_by) values
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000010'),
  ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000011');
insert into public.advisory_report_versions(id,report_id,case_id,version_number,content,created_by) values
  ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',1,'{"title":"Client-safe A v1"}','10000000-0000-0000-0000-000000000010'),
  ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',2,'{"title":"Unpublished A v2"}','10000000-0000-0000-0000-000000000010'),
  ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000002',1,'{"title":"Client-safe B v1"}','10000000-0000-0000-0000-000000000011');

insert into public.advisory_report_assets(report_version_id,case_id,object_name,bytes_sha256,mime_type) values
  ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','case-a/v1/approved.pdf',repeat('a',64),'application/pdf'),
  ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','case-a/v2/draft.pdf',repeat('b',64),'application/pdf'),
  ('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','case-b/v1/approved.pdf',repeat('c',64),'application/pdf');
-- Metadata-only fixtures; this does NOT upload files to the Storage service.
insert into storage.objects(bucket_id,name) values
  ('capital-web3-advisory','case-a/v1/approved.pdf'),
  ('capital-web3-advisory','case-a/v2/draft.pdf'),
  ('capital-web3-advisory','case-b/v1/approved.pdf'),
  ('capital-web3-advisory','case-a/unregistered.pdf');

insert into public.advisory_human_reviews(id,case_id,report_version_id,reviewer_user_id,decision,reviewed_content_sha256,reviewed_manifest_sha256)
select '50000000-0000-0000-0000-000000000001',case_id,id,
  '10000000-0000-0000-0000-000000000011','approved',content_sha256,advisory_private.manifest_sha256(id)
from public.advisory_report_versions where id = '40000000-0000-0000-0000-000000000001';
insert into public.advisory_human_reviews(id,case_id,report_version_id,reviewer_user_id,decision,reviewed_content_sha256,reviewed_manifest_sha256)
select '50000000-0000-0000-0000-000000000003',case_id,id,
  '10000000-0000-0000-0000-000000000012','approved',content_sha256,advisory_private.manifest_sha256(id)
from public.advisory_report_versions where id = '40000000-0000-0000-0000-000000000003';
insert into public.advisory_publications(id,case_id,report_version_id,human_review_id,publisher_user_id) values
  ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000011'),
  ('60000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002',
   '40000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000012');
insert into public.advisory_publication_recipients(publication_id,case_id,user_id) values
  ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');

select pg_temp.require(not has_table_privilege('anon','public.advisory_report_versions','SELECT'),
  'anon has no table read grant');
select pg_temp.require(not has_table_privilege('authenticated','public.advisory_human_reviews','INSERT'),
  'authenticated staff/client cannot approve directly');
select pg_temp.require(not has_table_privilege('authenticated','public.advisory_publications','INSERT'),
  'authenticated staff/client cannot publish directly');
select pg_temp.require(not has_function_privilege('anon','advisory_private.validate_review()','EXECUTE'),
  'privileged trigger function is not callable by anon');
select pg_temp.require((select count(*) = 13 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'advisory_%' and c.relkind in ('r','p')),
  'all 13 advisory tables enable and force RLS');
select pg_temp.require(not exists (select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
  where n.nspname = 'advisory_private' and p.prosecdef and not (r.rolbypassrls or r.rolsuper)),
  'definer functions have controlled owners able to query FORCE RLS tables');

-- A deliberately broad unrelated policy must not override the bucket boundary.
create policy advisory_test_broad_storage_select on storage.objects for select to anon, authenticated using (true);
set local role anon;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select * from public.advisory_report_versions','42501','anon cannot query report table');
select pg_temp.require((select count(*) = 0 from storage.objects where bucket_id='capital-web3-advisory'),
  'anon cannot list advisory objects despite unrelated broad policy');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.require((select count(*) = 1 from public.advisory_report_versions), 'A reads exactly their published version');
select pg_temp.require((select count(*) = 0 from public.advisory_report_versions
  where id='40000000-0000-0000-0000-000000000002'), 'A cannot read unpublished newer version');
select pg_temp.require((select count(*) = 0 from public.advisory_report_versions
  where case_id='20000000-0000-0000-0000-000000000002'), 'A cannot read published version of case B');
select pg_temp.require((select count(*) = 1 from public.advisory_cases), 'A sees only case with a permitted publication');
select pg_temp.require((select count(*) = 1 from public.advisory_reports), 'A sees the matching logical report');
select pg_temp.require((select count(*) = 0 from public.advisory_human_reviews), 'client cannot read private reviewer notes');
select pg_temp.require((select count(*) = 1 from storage.objects where bucket_id='capital-web3-advisory'),
  'A gets exact registered published object, no drafts/foreign/unregistered paths');

select pg_temp.expect_error($q$insert into public.advisory_case_staff(case_id,user_id,staff_role)
  values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','admin')$q$,
  '42501','client cannot self-assign a staff role');
select pg_temp.expect_error($q$insert into public.advisory_publications
  (case_id,report_version_id,human_review_id,publisher_user_id) values
  ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$q$,
  '42501','client cannot publish');
-- A hidden UPDATE is zero affected rows, rather than necessarily an exception.
do $$ declare changed bigint; begin
  update public.advisory_report_versions set content='{}'
    where id='40000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  perform pg_temp.require(changed = 0,'client report update affects zero rows');
end $$;
select pg_temp.expect_error('delete from public.advisory_report_versions','42501','client cannot delete reports');
select pg_temp.expect_error($q$insert into storage.objects(bucket_id,name)
  values ('capital-web3-advisory','client-upload.pdf')$q$,'42501','client cannot upload into report bucket');
insert into public.advisory_receipts(id,publication_id,case_id,report_version_id,user_id,received_at) values
  ('70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001','2099-01-01');
select pg_temp.require((select received_at = now() from public.advisory_receipts
  where id='70000000-0000-0000-0000-000000000001'),'receipt timestamp is server-generated');
insert into public.advisory_clarifications(id,publication_id,case_id,report_version_id,author_user_id,thread_client_user_id,entry_kind,message)
values ('80000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','client_question','Synthetic clarification A');
select pg_temp.expect_error($q$insert into public.advisory_receipts(publication_id,case_id,report_version_id,user_id)
  values ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')$q$,
  '42501','client cannot forge another person receipt');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false,"user_metadata":{"role":"admin"}}',true);
select pg_temp.require(not advisory_private.is_assigned_staff('20000000-0000-0000-0000-000000000001'),
  'user-editable metadata cannot create staff membership');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}',true);
select pg_temp.require((select count(*) = 0 from public.advisory_report_versions), 'anonymous Auth account is denied even with a matching UID');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select pg_temp.require((select count(*) = 0 from public.advisory_report_versions
  where case_id='20000000-0000-0000-0000-000000000001'),'B membership alone is insufficient without exact recipient grant');
select pg_temp.require((select count(*) = 1 from public.advisory_report_versions),'B reads their case B publication');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000010","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000010',true);
select pg_temp.require((select count(*) = 2 from public.advisory_report_versions),'assigned analyst reads draft and published A versions');
select pg_temp.require((select count(*) = 0 from public.advisory_report_versions
  where case_id='20000000-0000-0000-0000-000000000002'),'staff cannot read an unassigned case');
update public.advisory_report_versions set content='{"title":"Updated draft A v2"}'
where id='40000000-0000-0000-0000-000000000002';
select pg_temp.require((select content->>'title' = 'Updated draft A v2' from public.advisory_report_versions
  where id='40000000-0000-0000-0000-000000000002'),'assigned author can edit unreviewed draft');
select pg_temp.expect_error($q$update public.advisory_report_versions set content='{}'
  where id='40000000-0000-0000-0000-000000000001'$q$,'23514','reviewed version is immutable even to author');
select pg_temp.expect_error($q$update public.advisory_report_versions set case_id='20000000-0000-0000-0000-000000000002'
  where id='40000000-0000-0000-0000-000000000002'$q$,'42501','author cannot reassign version identity');
select pg_temp.require((select count(*) > 0 from public.advisory_audit_events),'assigned staff can inspect audit trail');
select pg_temp.require((select count(*) = 0 from public.advisory_audit_events
  where case_id='20000000-0000-0000-0000-000000000002'),'audit trail is case-restricted');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);

-- Privileged constraint tests are NOT counted as evidence that client RLS works.
select pg_temp.expect_error($q$insert into public.advisory_human_reviews
  (case_id,report_version_id,reviewer_user_id,decision,reviewed_content_sha256,reviewed_manifest_sha256) values
  ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000010','approved',repeat('a',64),
   advisory_private.manifest_sha256('40000000-0000-0000-0000-000000000002'))$q$,
  '23514','author cannot self-review through future privileged workflow');
select pg_temp.expect_error($q$insert into public.advisory_human_reviews
  (case_id,report_version_id,reviewer_user_id,decision,reviewed_content_sha256,reviewed_manifest_sha256) values
  ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000011','approved',repeat('a',64),
   advisory_private.manifest_sha256('40000000-0000-0000-0000-000000000002'))$q$,
  '23514','review cannot bind a wrong digest');
-- The human observed M1, but a draft asset changed to M2 before submission.
-- The content digest still matches; the stale manifest digest must reject it.
do $$
declare observed_manifest text;
begin
  observed_manifest := advisory_private.manifest_sha256('40000000-0000-0000-0000-000000000002');
  update public.advisory_report_assets set bytes_sha256=repeat('d',64)
    where report_version_id='40000000-0000-0000-0000-000000000002';
  begin
    insert into public.advisory_human_reviews
      (case_id,report_version_id,reviewer_user_id,decision,reviewed_content_sha256,reviewed_manifest_sha256)
    select case_id,id,'10000000-0000-0000-0000-000000000011','approved',content_sha256,observed_manifest
    from public.advisory_report_versions where id='40000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: stale observed manifest accepted';
  exception when check_violation then
    perform pg_temp.require(position('asset manifest digest' in sqlerrm)>0,
      'unchanged content cannot authorize an asset manifest changed since human inspection');
  end;
end;
$$;
select pg_temp.expect_error($q$insert into public.advisory_publications
  (case_id,report_version_id,human_review_id,publisher_user_id) values
  ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000011')$q$,
  '23514','approval of v1 cannot publish v2');
select pg_temp.expect_error($q$update public.advisory_report_assets set object_name='altered.pdf'
  where report_version_id='40000000-0000-0000-0000-000000000001'$q$,
  '23514','review freezes exact object manifest');
select pg_temp.expect_error($q$delete from public.advisory_human_reviews
  where id='50000000-0000-0000-0000-000000000001'$q$,'23514','reviews cannot be erased');

insert into public.advisory_publication_recipients(publication_id,case_id,user_id) values
  ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select pg_temp.require((select count(*) = 1 from public.advisory_report_versions
  where case_id='20000000-0000-0000-0000-000000000001'),'explicit recipient grant enables A v1 for B');
select pg_temp.require((select count(*) = 0 from public.advisory_clarifications),
  'co-recipient B cannot see A private clarification thread');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
insert into public.advisory_publication_revocations(publication_id,case_id,recipient_user_id,revoked_by,reason)
values ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000011','Synthetic targeted revocation');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select pg_temp.require((select count(*) = 0 from public.advisory_report_versions
  where case_id='20000000-0000-0000-0000-000000000001'),'targeted revocation immediately removes B access');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.require((select count(*) = 1 from public.advisory_report_versions),'targeted B revocation does not revoke A');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
insert into public.advisory_publication_revocations(publication_id,case_id,revoked_by,reason)
values ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000011','Synthetic whole publication revocation');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.require((select count(*) = 0 from public.advisory_report_versions),'revoked publication hides exact report version');
select pg_temp.require((select count(*) = 0 from storage.objects where bucket_id='capital-web3-advisory'),
  'revoked publication hides object metadata');
select pg_temp.expect_error($q$insert into public.advisory_receipts(publication_id,case_id,report_version_id,user_id)
  values ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$q$,
  '42501','client cannot acknowledge a revoked publication');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);

-- New explicit release is allowed; old revocation remains as evidence.
insert into public.advisory_publications(id,case_id,report_version_id,human_review_id,publisher_user_id)
values ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000011');
insert into public.advisory_publication_recipients(publication_id,case_id,user_id) values
  ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
update public.advisory_case_clients set active=false
where case_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.require((select count(*) = 0 from public.advisory_report_versions),'inactive DB membership denies even with an unexpired old JWT');
select pg_temp.require((select count(*) = 0 from storage.objects where bucket_id='capital-web3-advisory'),
  'inactive membership removes object access');
reset role;

rollback;
