-- Synthetic COFRE authorization suite. Owner-only, disposable Supabase; ROLLBACK.
-- Claims here are fixtures, not proof of JWT signature, MFA enrollment or login.
begin;
create temporary table cofre_test_data(label text primary key,value jsonb not null);
grant select,insert,update on cofre_test_data to authenticated,anon;
do $$ declare temporary_schema text; begin
 select nspname into strict temporary_schema from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
 execute pg_catalog.format('grant usage on schema %I to authenticated,anon',temporary_schema);
end $$;
create function pg_temp.require(v boolean,label text) returns void language plpgsql security invoker as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if;
raise notice 'PASS: %',label; end $$;
create function pg_temp.expect_error(q text,wanted text,label text) returns void language plpgsql security invoker as $$
begin
 begin execute q;
 exception when others then
 if sqlstate=wanted then raise notice 'PASS: % (SQLSTATE %)',label,sqlstate; return; end if;
 raise exception 'FAIL: % expected %, got %: %',label,wanted,sqlstate,sqlerrm;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end $$;
create function pg_temp.identity(uid text,sid text,aal text default 'aal1',anonymous boolean default false)
returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated',
 'session_id',sid,'aal',aal,'is_anonymous',anonymous)::text,true);
 perform set_config('request.jwt.claim.sub',uid,true);
end $$;
create function pg_temp.data(k text) returns jsonb language sql security invoker as $$
 select value from cofre_test_data where label=k;
$$;
grant execute on function pg_temp.require(boolean,text),pg_temp.expect_error(text,text,text),
 pg_temp.identity(text,text,text,boolean),pg_temp.data(text) to authenticated,anon;

insert into auth.users(id,email) values
 ('13000000-0000-0000-0000-000000000001','cofre-sql-client@example.invalid'),
 ('13000000-0000-0000-0000-000000000002','cofre-sql-other@example.invalid'),
 ('13000000-0000-0000-0000-000000000010','cofre-sql-analyst@example.invalid'),
 ('13000000-0000-0000-0000-000000000011','cofre-sql-reviewer@example.invalid'),
 ('13000000-0000-0000-0000-000000000012','cofre-sql-neighbor@example.invalid');
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('93000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001',now(),now(),'aal1',now()+interval '1 hour'),
 ('93000000-0000-0000-0000-000000000002','13000000-0000-0000-0000-000000000002',now(),now(),'aal1',now()+interval '1 hour'),
 ('93000000-0000-0000-0000-000000000010','13000000-0000-0000-0000-000000000010',now(),now(),'aal1',now()+interval '1 hour'),
 ('93000000-0000-0000-0000-000000000011','13000000-0000-0000-0000-000000000011',now(),now(),'aal1',now()+interval '1 hour'),
 ('93000000-0000-0000-0000-000000000012','13000000-0000-0000-0000-000000000012',now(),now(),'aal1',now()+interval '1 hour');
-- Legacy journey fixtures explicitly opt out; dedicated MFA tests exercise true.
insert into capital_web3_private.cofre_workspaces(id,label,staff_mfa_required) values
 ('83000000-0000-0000-0000-000000000001','SQL synthetic workspace A',false),
 ('83000000-0000-0000-0000-000000000002','SQL synthetic workspace B',false);
insert into capital_web3_private.cofre_workspace_members(workspace_id,user_id,display_name,member_role) values
 ('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','Synthetic A','client'),
 ('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000010','Synthetic author','analyst'),
 ('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000010','Synthetic author','reviewer'),
 ('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000010','Synthetic author','publisher'),
 ('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000011','Synthetic reviewer','reviewer'),
 ('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000011','Synthetic reviewer','publisher'),
 ('83000000-0000-0000-0000-000000000002','13000000-0000-0000-0000-000000000002','Synthetic B','client');

insert into cofre_test_data values('intake',jsonb_build_object(
 'schema_version','cofre-intake-0.1','synthetic',true,
 'profile',jsonb_build_object('objective','organize','experience','beginner','liquidity','long_term','loss_capacity','discretionary'),
 'consents',jsonb_build_object('assessment',true,'storage',true,'external_sources',false,'notifications',false),
 'controls',jsonb_build_object(
  'secret_exposure',jsonb_build_object('answer','no','evidence','declared'),
  'backup_offline',jsonb_build_object('answer','yes','evidence','declared'),
  'recovery_tested',jsonb_build_object('answer','unknown','evidence','unknown'),
  'wallet_separation',jsonb_build_object('answer','yes','evidence','observed'),
  'device_updates',jsonb_build_object('answer','yes','evidence','declared'),
  'domain_checks',jsonb_build_object('answer','yes','evidence','declared'),
  'permissions_review',jsonb_build_object('answer','unknown','evidence','unknown')),
 'inventory',jsonb_build_array(jsonb_build_object('category','vault','network','bitcoin','custody','self'))));
-- Minimum SQL envelope fixture. Report language is covered by the deterministic engine suite.
insert into cofre_test_data select 'content',jsonb_build_object(
 'schema_version','cofre-report-0.1','report_kind','cofre_individual','mode','synthetic','status','needs_input',
 'profile',value->'profile','inventory',value->'inventory',
 'controls',(select jsonb_agg(jsonb_build_object('id',k)||v order by k) from jsonb_each(value->'controls') e(k,v)),
 'human_review',jsonb_build_object('approved',false)) from cofre_test_data where label='intake';
update cofre_test_data set value=capital_web3_private.cofre_canonical_report(pg_temp.data('intake'),to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where label='content';
select capital_web3_private.validate_cofre_intake(pg_temp.data('intake'));
select pg_temp.require(true,'valid closed synthetic SQL intake accepted');

-- Owner invokes validator to isolate input validation from intentionally revoked runtime EXECUTE.
do $$ declare path text[]; invalid jsonb; field text;
begin
 foreach field in array array['schema_version','profile.objective','profile.experience','profile.liquidity','profile.loss_capacity',
 'controls.secret_exposure.answer','controls.secret_exposure.evidence','inventory.0.category','inventory.0.network','inventory.0.custody'] loop
 path:=string_to_array(field,'.'); invalid:=jsonb_set(pg_temp.data('intake'),path,'null'::jsonb);
 perform pg_temp.expect_error(format('select capital_web3_private.validate_cofre_intake(%L::jsonb)',invalid::text),'22023','JSON null denied: '||field);
 end loop;
 invalid:=jsonb_set(pg_temp.data('intake'),'{controls}','{}'::jsonb);
 perform pg_temp.expect_error(format('select capital_web3_private.validate_cofre_intake(%L::jsonb)',invalid::text),'22023','empty controls denied');
 invalid:=pg_temp.data('intake')||'{"secret":"do-not-collect"}'::jsonb;
 perform pg_temp.expect_error(format('select capital_web3_private.validate_cofre_intake(%L::jsonb)',invalid::text),'22023','extra secret field denied');
 invalid:=jsonb_set(pg_temp.data('intake'),'{synthetic}','false'::jsonb);
 perform pg_temp.expect_error(format('select capital_web3_private.validate_cofre_intake(%L::jsonb)',invalid::text),'22023','non-synthetic intake denied');
 invalid:=jsonb_set(pg_temp.data('intake'),'{consents,notifications}','true'::jsonb);
 perform pg_temp.expect_error(format('select capital_web3_private.validate_cofre_intake(%L::jsonb)',invalid::text),'22023','unimplemented consent denied');
end $$;

set local role anon;
select pg_temp.expect_error($q$select capital_web3.advisory_cofre_workspaces()$q$,'42501','anonymous role has no roster RPC');
reset role;
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000012','93000000-0000-0000-0000-000000000012');
select pg_temp.require(capital_web3.advisory_cofre_workspaces()='[]'::jsonb,'Auth account without roster sees no workspace');
select pg_temp.expect_error($q$select capital_web3.advisory_create_cofre_case('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001')$q$,
 '42501','unrostered Auth account cannot open case');
select pg_temp.identity('13000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001');
select pg_temp.require(capital_web3.advisory_cofre_workspaces()='[]'::jsonb,'client cannot list workspace roster');
select pg_temp.expect_error($q$select capital_web3.advisory_create_cofre_case('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000002')$q$,
 '42501','client cannot open own case with forged staff action');

select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010');
select pg_temp.require(not exists(select 1 from jsonb_array_elements(capital_web3.advisory_cofre_workspaces()) r
 where r->>'workspace_id'<>'83000000-0000-0000-0000-000000000001'),'staff roster excludes foreign workspace');
select pg_temp.expect_error($q$select capital_web3.advisory_create_cofre_case('83000000-0000-0000-0000-000000000002','13000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-000000000003')$q$,
 '42501','analyst cannot open foreign workspace case');
select pg_temp.expect_error($q$select capital_web3.advisory_create_cofre_case('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-000000000004')$q$,
 '42501','analyst cannot attach foreign client');
insert into cofre_test_data values('case',capital_web3.advisory_create_cofre_case(
 '83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000005'));
select pg_temp.require(capital_web3.advisory_create_cofre_case('83000000-0000-0000-0000-000000000001',
 '13000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000005')=pg_temp.data('case'),'case creation retry returns original case');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),jsonb_set(pg_temp.data('content'),'{summary}','"fabricated synthetic safety claim"'),0,'73000000-0000-0000-0000-000000000089')$q$,
 '22023','direct RPC denies fabricated report text');
-- A direct PostgREST RPC cannot bypass the default-closed database capability.
select pg_temp.require(not capital_web3.advisory_cofre_partial_capability(),'partial capability defaults off');
select pg_temp.expect_error($q$select capital_web3.advisory_cofre_partial_get((pg_temp.data('case')->>'case_id')::uuid)$q$,'42501','direct partial read denied while feature off');
select pg_temp.expect_error($q$select capital_web3.advisory_cofre_partial_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('intake'),0,0,'73000000-0000-0000-0000-000000000096')$q$,'42501','direct partial write denied while feature off');
reset role;
update capital_web3_private.cofre_partial_limits set partial_enabled=true where singleton=true;
set local role authenticated;
select pg_temp.require(capital_web3.advisory_cofre_partial_capability(),'owner enabled partial capability for fixture');
-- Versioned Lite signals persist by case only for the assigned analyst and require consent.
insert into cofre_test_data values('lite',jsonb_build_object(
 'schema_version','cofre-lite-signals-0.1','synthetic',true,
 'consents',jsonb_build_object('assessment',true,'storage',true),
 'signals',jsonb_build_object('urgency','unknown','guaranteed_return','unknown','unsolicited_link','unknown',
 'different_domain','unknown','unverified_contract','unknown','unlimited_approval','unknown','secret_request','unknown',
 'missing_team_docs','unknown','unclear_tokenomics','unknown','profit_screenshots','unknown')));
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_get((pg_temp.data('case')->>'case_id')::uuid)$q$,'42501','Lite off by default denies get');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite'),0,'73000000-0000-0000-0000-000000000100')$q$,'42501','Lite off by default denies direct save');
reset role;
insert into capital_web3_private.cofre_lite_features(workspace_id,enabled) values('83000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010');
select pg_temp.require(capital_web3.advisory_lite_signals_get((pg_temp.data('case')->>'case_id')::uuid) is null,'new case has no Lite signals');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite')||'{"secret":"do-not-collect"}'::jsonb,0,'73000000-0000-0000-0000-000000000100')$q$,'22023','Lite rejects invented secret field');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,jsonb_set(pg_temp.data('lite'),'{consents,storage}','false'),0,'73000000-0000-0000-0000-000000000100')$q$,'22023','Lite requires explicit storage consent');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,jsonb_set(pg_temp.data('lite'),'{signals,urgency}','null'),0,'73000000-0000-0000-0000-000000000100')$q$,'22023','Lite rejects null signal');
insert into cofre_test_data values('lite_saved',capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite'),0,'73000000-0000-0000-0000-000000000100'));
select pg_temp.require((pg_temp.data('lite_saved')->>'revision')::integer=1,'Lite saves first revision');
select pg_temp.require(capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite'),0,'73000000-0000-0000-0000-000000000100')=pg_temp.data('lite_saved'),'Lite retry is idempotent');
select pg_temp.require(capital_web3.advisory_lite_signals_get((pg_temp.data('case')->>'case_id')::uuid)#>>'{intake,signals,urgency}'='unknown','Lite persists unknown');

-- Generate Lite first, then Individual: report identities and counters must remain separate.
insert into cofre_test_data values('lite_v02',jsonb_build_object(
 'schema_version','cofre-lite-intake-0.2','synthetic',true,'consents',jsonb_build_object('assessment',true,'storage',true),
 'profile',jsonb_build_object('experience','unknown'),
 'controls',jsonb_build_object('backup','unknown','vault','unknown','apps','unknown','spending','unknown','testing','unknown','watch','unknown','recovery','unknown','secret_exposure','unknown','source','unknown','permissions','unknown','payload','unknown','routine','unknown'),
 'signals',pg_temp.data('lite')->'signals'));
select capital_web3.advisory_lite_intake_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite_v02'),0,'73000000-0000-0000-0000-000000000200',1);
insert into cofre_test_data values('lite_draft',capital_web3.advisory_lite_create_draft((pg_temp.data('case')->>'case_id')::uuid,1,'73000000-0000-0000-0000-000000000201'));
select pg_temp.require(capital_web3.advisory_lite_create_draft((pg_temp.data('case')->>'case_id')::uuid,1,'73000000-0000-0000-0000-000000000201')=pg_temp.data('lite_draft'),'Lite draft retry returns identical version');
select pg_temp.require(capital_web3.advisory_lite_create_draft((pg_temp.data('case')->>'case_id')::uuid,1,'73000000-0000-0000-0000-000000000202')=pg_temp.data('lite_draft'),'same saved intake yields same immutable draft');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_create_draft((pg_temp.data('case')->>'case_id')::uuid,2,'73000000-0000-0000-0000-000000000201')$q$,'23505','Lite draft key cannot be reused for another revision');
select pg_temp.require((select content->>'status'='incomplete' and content->'score'='null'::jsonb and content#>>'{human_review,status}'='pending' from capital_web3.advisory_report_versions where id=(pg_temp.data('lite_draft')->>'report_version_id')::uuid),'server generates incomplete no-score draft');
insert into cofre_test_data values('lite_package',capital_web3.advisory_get_review_package((pg_temp.data('lite_draft')->>'report_version_id')::uuid));
select pg_temp.expect_error($q$select capital_web3.advisory_review_report((pg_temp.data('lite_draft')->>'report_version_id')::uuid,'approved',pg_temp.data('lite_package')->>'content_sha256',pg_temp.data('lite_package')->>'manifest_sha256','','73000000-0000-0000-0000-000000000203')$q$,'42501','Lite author cannot approve own version');
select pg_temp.expect_error($q$select * from capital_web3_private.cofre_lite_report_snapshots$q$,'42501','Lite snapshot is private');
select pg_temp.identity('13000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_create_draft((pg_temp.data('case')->>'case_id')::uuid,1,'73000000-0000-0000-0000-000000000204')$q$,'42501','client cannot create Lite draft');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions where id=(pg_temp.data('lite_draft')->>'report_version_id')::uuid),'client cannot see unpublished Lite draft');
select pg_temp.identity('13000000-0000-0000-0000-000000000011','93000000-0000-0000-0000-000000000011');
select capital_web3.advisory_review_report((pg_temp.data('lite_draft')->>'report_version_id')::uuid,'approved',pg_temp.data('lite_package')->>'content_sha256',pg_temp.data('lite_package')->>'manifest_sha256','','73000000-0000-0000-0000-000000000205');
select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010');

select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,jsonb_set(pg_temp.data('lite'),'{signals,urgency}','"yes"'),0,'73000000-0000-0000-0000-000000000100')$q$,'23505','Lite rejects changed idempotency payload');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite'),0,'73000000-0000-0000-0000-000000000101')$q$,'23514','Lite denies stale revision');
select pg_temp.identity('13000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_get((pg_temp.data('case')->>'case_id')::uuid)$q$,'42501','client cannot read analyst Lite intake');
select pg_temp.identity('13000000-0000-0000-0000-000000000011','93000000-0000-0000-0000-000000000011');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_get((pg_temp.data('case')->>'case_id')::uuid)$q$,'42501','reviewer cannot read analyst Lite intake');
select pg_temp.identity('13000000-0000-0000-0000-000000000012','93000000-0000-0000-0000-000000000012');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite'),1,'73000000-0000-0000-0000-000000000102')$q$,'42501','foreign user cannot save Lite intake');
select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010');
select pg_temp.expect_error($q$select * from capital_web3_private.cofre_lite_signals$q$,'42501','direct access to Lite table denied');
reset role;
insert into capital_web3_private.cofre_lite_signal_receipts(actor,key,request_hash,result)
select '13000000-0000-0000-0000-000000000010'::uuid,md5(n::text)::uuid,repeat('0',64),'{}'::jsonb from generate_series(1,127) n;
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite'),1,'73000000-0000-0000-0000-000000000103')$q$,'54000','Lite receipt quota blocks new keys');
select pg_temp.require(capital_web3.advisory_lite_signals_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('lite'),0,'73000000-0000-0000-0000-000000000100')=pg_temp.data('lite_saved'),'Lite existing retry remains possible at quota');

insert into cofre_test_data values('partial',capital_web3.advisory_cofre_partial_save((pg_temp.data('case')->>'case_id')::uuid,
 jsonb_set(pg_temp.data('intake'),'{profile,objective}','""'::jsonb),0,0,'73000000-0000-0000-0000-000000000091'));
select pg_temp.require((pg_temp.data('partial')->>'revision')::integer=1,'partial save stores one revision');
reset role;
update capital_web3_private.cofre_partial_limits set partial_enabled=false where singleton=true;
set local role authenticated;
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('intake'),pg_temp.data('content'),0,'73000000-0000-0000-0000-000000000097')$q$,'23514','cannot finalize while hidden partial exists and feature is off');
select pg_temp.identity('13000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('intake'),pg_temp.data('content'),0,'73000000-0000-0000-0000-000000000098')$q$,'42501','foreign role cannot infer whether partial exists');
select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010');

reset role;
update capital_web3_private.cofre_partial_limits set partial_enabled=true where singleton=true;
set local role authenticated;

select pg_temp.require(capital_web3.advisory_cofre_partial_save((pg_temp.data('case')->>'case_id')::uuid,
 jsonb_set(pg_temp.data('intake'),'{profile,objective}','""'::jsonb),0,0,'73000000-0000-0000-0000-000000000091')=pg_temp.data('partial'),'partial retry is idempotent');
select pg_temp.require(capital_web3.advisory_cofre_partial_get((pg_temp.data('case')->>'case_id')::uuid)#>>'{intake,profile,objective}'='', 'partial preserves empty objective');
-- Preserve old idempotency even at capacity; no auto-delete or payload retention.
reset role;
update capital_web3_private.cofre_partial_limits set max_receipts_per_actor=1 where singleton=true;
select pg_temp.require(not exists(select 1 from information_schema.columns where table_schema='capital_web3_private' and table_name='cofre_partial_receipts' and column_name='request'),'partial receipts never store request payload');
set local role authenticated;
select pg_temp.require(capital_web3.advisory_cofre_partial_save((pg_temp.data('case')->>'case_id')::uuid,
 jsonb_set(pg_temp.data('intake'),'{profile,objective}','""'::jsonb),0,0,'73000000-0000-0000-0000-000000000091')=pg_temp.data('partial'),'partial retry remains available at quota');
select pg_temp.expect_error($q$select capital_web3.advisory_cofre_partial_save((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),1,0,'73000000-0000-0000-0000-000000000093')$q$,'P0001','new partial operation fails closed at quota');
reset role;
update capital_web3_private.cofre_partial_limits set max_receipts_per_actor=1000 where singleton=true;
set local role authenticated;
insert into cofre_test_data values('saved',capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),pg_temp.data('content'),0,'73000000-0000-0000-0000-000000000006'));
select pg_temp.require(capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),pg_temp.data('content'),0,'73000000-0000-0000-0000-000000000006')=pg_temp.data('saved'),'intake retry returns original version');
-- An old timestamp on an idempotent retry returns the original result; altered content still fails.
select pg_temp.require(capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'), jsonb_set(jsonb_set(jsonb_set(pg_temp.data('content'),'{as_of}','"2000-01-01T00:00:00.000Z"'),'{sources,0,as_of}','"2000-01-01T00:00:00.000Z"'),'{sources,1,as_of}','"2000-01-01T00:00:00.000Z"'),0,'73000000-0000-0000-0000-000000000006')=pg_temp.data('saved'),
 'confirmed idempotent retry survives freshness window');
select pg_temp.require(capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),jsonb_set(jsonb_set(jsonb_set(pg_temp.data('content'),'{as_of}',to_jsonb(to_char((now()+interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'{sources,0,as_of}',to_jsonb(to_char((now()+interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'{sources,1,as_of}',to_jsonb(to_char((now()+interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),0,'73000000-0000-0000-0000-000000000006')=pg_temp.data('saved'),
 'retry with a newly generated timestamp returns original version');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),jsonb_set(pg_temp.data('content'),'{summary}','"malicious retry"'),0,'73000000-0000-0000-0000-000000000006')$q$,
 '22023','changed report text denied even on idempotent retry');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),jsonb_set(jsonb_set(jsonb_set(pg_temp.data('content'),'{as_of}','"2000-01-01T00:00:00.000Z"'),'{sources,0,as_of}','"2000-01-01T00:00:00.000Z"'),'{sources,1,as_of}','"2000-01-01T00:00:00.000Z"'),1,'73000000-0000-0000-0000-000000000090')$q$,
 '22023','new write with expired report timestamp denied');
select pg_temp.require((select count(*)=1 from capital_web3.cofre_intakes where case_id=(pg_temp.data('case')->>'case_id')::uuid),'assigned analyst can read intake');
select pg_temp.require((select count(distinct report_id)=2 from capital_web3.advisory_report_versions where id in ((pg_temp.data('lite_draft')->>'report_version_id')::uuid,(pg_temp.data('saved')->>'report_version_id')::uuid)),'Lite and Individual versions use separate report identities');
select pg_temp.require((capital_web3.advisory_cofre_partial_get((pg_temp.data('case')->>'case_id')::uuid)->>'stale')::boolean,'partial becomes stale after report');
insert into cofre_test_data values('restore',capital_web3.advisory_cofre_partial_restore((pg_temp.data('case')->>'case_id')::uuid,1,1,'73000000-0000-0000-0000-000000000094'));
select pg_temp.require((pg_temp.data('restore')->>'revision')::integer=2,'explicit restore advances revision');
select pg_temp.require(capital_web3.advisory_cofre_partial_restore((pg_temp.data('case')->>'case_id')::uuid,1,1,'73000000-0000-0000-0000-000000000094')=pg_temp.data('restore'),'restore retry is idempotent');
select pg_temp.require(capital_web3.advisory_cofre_partial_get((pg_temp.data('case')->>'case_id')::uuid)#>>'{intake,profile,objective}'='', 'restore preserves original partial answers');
select pg_temp.expect_error($q$select capital_web3.advisory_cofre_partial_restore((pg_temp.data('case')->>'case_id')::uuid,1,1,'73000000-0000-0000-0000-000000000095')$q$,'23514','stale restore revision cannot replay with another key');

select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),pg_temp.data('content'),0,'73000000-0000-0000-0000-000000000007')$q$,'23514','stale revision cannot overwrite newer intake');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 jsonb_set(pg_temp.data('intake'),'{profile,objective}','"learn_defi"'),
 jsonb_set(pg_temp.data('content'),'{profile,objective}','"learn_defi"'),0,'73000000-0000-0000-0000-000000000006')$q$,
 '23505','save key cannot be reused for changed intake');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),jsonb_set(pg_temp.data('content'),'{human_review,approved}','true'),1,'73000000-0000-0000-0000-000000000008')$q$,
 '22023','caller cannot claim approval in report envelope');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),jsonb_set(pg_temp.data('content'),'{report_kind}','null'),1,'73000000-0000-0000-0000-000000000009')$q$,
 '22023','JSON null report kind denied');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 jsonb_set(pg_temp.data('intake'),'{controls,secret_exposure,answer}','"yes"'),
 jsonb_set(jsonb_set(pg_temp.data('content'),'{status}','"ok"'),'{controls}',
  (select jsonb_agg(case when c->>'id'='secret_exposure' then jsonb_set(c,'{answer}','"yes"') else c end)
   from jsonb_array_elements(pg_temp.data('content')->'controls') c)),
 1,'73000000-0000-0000-0000-000000000015')$q$,
 '22023','critical secret exposure cannot be labeled ok through direct RPC');
select pg_temp.expect_error($q$select capital_web3.advisory_save_cofre_intake((pg_temp.data('case')->>'case_id')::uuid,
 pg_temp.data('intake'),jsonb_set(pg_temp.data('content'),'{status}','"ok"'),1,'73000000-0000-0000-0000-000000000016')$q$,
 '22023','unknown controls cannot be labeled ok through direct RPC');
select pg_temp.expect_error($q$insert into capital_web3.advisory_reports(case_id,created_by)
 values((pg_temp.data('case')->>'case_id')::uuid,'13000000-0000-0000-0000-000000000010')$q$,
 '42501','direct COFRE logical report INSERT denied');
select pg_temp.expect_error($q$insert into capital_web3.advisory_report_versions(report_id,case_id,version_number,content,created_by)
 select report_id,case_id,2,'{"forged":true}','13000000-0000-0000-0000-000000000010'
 from capital_web3.advisory_report_versions where id=(pg_temp.data('saved')->>'report_version_id')::uuid$q$,
 '42501','direct COFRE version INSERT denied');
select pg_temp.expect_error($q$update capital_web3.advisory_report_versions set content='{"forged":true}'
 where id=(pg_temp.data('saved')->>'report_version_id')::uuid$q$,'42501','direct COFRE content UPDATE denied');
insert into cofre_test_data values('package',capital_web3.advisory_get_review_package((pg_temp.data('saved')->>'report_version_id')::uuid));
select pg_temp.expect_error($q$select capital_web3.advisory_review_report((pg_temp.data('saved')->>'report_version_id')::uuid,'approved',
 pg_temp.data('package')->>'content_sha256',pg_temp.data('package')->>'manifest_sha256','',
 '73000000-0000-0000-0000-000000000010')$q$,'42501','author with reviewer role cannot approve own draft');
select pg_temp.expect_error($q$select capital_web3.advisory_publish_report((pg_temp.data('saved')->>'report_version_id')::uuid,
 array['13000000-0000-0000-0000-000000000001'::uuid],pg_temp.data('package')->>'content_sha256',
 pg_temp.data('package')->>'manifest_sha256',now()+interval '1 hour','73000000-0000-0000-0000-000000000011')$q$,
 '42501','author with publisher role cannot publish own draft');
select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010','aal1',true);
select pg_temp.expect_error($q$select capital_web3.advisory_create_cofre_case('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000012')$q$,
 '42501','anonymous Auth claim cannot impersonate enrolled staff');
reset role;

select pg_temp.expect_error($q$insert into capital_web3.advisory_report_assets(report_version_id,case_id,object_name,bytes_sha256,mime_type)
 values((pg_temp.data('saved')->>'report_version_id')::uuid,(pg_temp.data('case')->>'case_id')::uuid,
 'synthetic-forbidden.pdf',repeat('a',64),'application/pdf')$q$,'23514','COFRE assets denied even on privileged ingestion path');

set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001');
select pg_temp.require((select count(*)=0 from capital_web3.cofre_intakes where case_id=(pg_temp.data('case')->>'case_id')::uuid),'client cannot read intake');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions where case_id=(pg_temp.data('case')->>'case_id')::uuid),'client cannot read unpublished COFRE draft');
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package((pg_temp.data('saved')->>'report_version_id')::uuid)$q$,'42501','client cannot obtain staff review package');
select pg_temp.identity('13000000-0000-0000-0000-000000000011','93000000-0000-0000-0000-000000000011');
select capital_web3.advisory_review_report((pg_temp.data('saved')->>'report_version_id')::uuid,'approved',
 pg_temp.data('package')->>'content_sha256',pg_temp.data('package')->>'manifest_sha256','',
 '73000000-0000-0000-0000-000000000013');
insert into cofre_test_data values('publication',capital_web3.advisory_publish_report((pg_temp.data('saved')->>'report_version_id')::uuid,
 array['13000000-0000-0000-0000-000000000001'::uuid],pg_temp.data('package')->>'content_sha256',
 pg_temp.data('package')->>'manifest_sha256',now()+interval '1 hour','73000000-0000-0000-0000-000000000014'));
reset role;

-- Author session removed: old JWT claims may still be presented, including directly to RPC.
delete from auth.sessions where id='93000000-0000-0000-0000-000000000010';
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions where case_id=(pg_temp.data('case')->>'case_id')::uuid),'revoked staff session cannot SELECT content');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_case_clients where case_id=(pg_temp.data('case')->>'case_id')::uuid),'revoked staff session cannot list recipients');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_human_reviews where case_id=(pg_temp.data('case')->>'case_id')::uuid),'revoked staff session cannot read private review notes');
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package((pg_temp.data('saved')->>'report_version_id')::uuid)$q$,'42501','DEFINER review package denies revoked session');
reset role;

-- A second client role must not let staff bypass mandatory MFA.
insert into capital_web3_private.cofre_workspace_members(workspace_id,user_id,display_name,member_role) values
 ('83000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000011','Synthetic reviewer','client');
update capital_web3_private.cofre_workspaces set staff_mfa_required=true where id='83000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000011','93000000-0000-0000-0000-000000000011','aal1');
select pg_temp.require(capital_web3.advisory_cofre_workspaces()='[]'::jsonb,'aal1 staff cannot read roster when MFA required');
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package((pg_temp.data('saved')->>'report_version_id')::uuid)$q$,'42501','dual-role staff cannot use client role to bypass MFA');
select pg_temp.identity('13000000-0000-0000-0000-000000000011','93000000-0000-0000-0000-000000000011','aal2');
select pg_temp.require((capital_web3.advisory_get_review_package((pg_temp.data('saved')->>'report_version_id')::uuid)->>'report_version_id')=
 (pg_temp.data('saved')->>'report_version_id'),'aal2 assigned reviewer retains review access');
select pg_temp.identity('13000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001','aal1');
select pg_temp.require((select count(*)=1 from capital_web3.advisory_report_versions where id=(pg_temp.data('saved')->>'report_version_id')::uuid),'client without staff role reads own publication at aal1');
select capital_web3.advisory_record_receipt((pg_temp.data('publication')->>'publication_id')::uuid);
select pg_temp.identity('13000000-0000-0000-0000-000000000002','93000000-0000-0000-0000-000000000002','aal1');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions where id=(pg_temp.data('saved')->>'report_version_id')::uuid),'other-workspace client cannot read publication');
reset role;

update capital_web3_private.cofre_workspace_members set active=false
 where workspace_id='83000000-0000-0000-0000-000000000001' and user_id='13000000-0000-0000-0000-000000000011'
 and member_role='reviewer';
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000011','93000000-0000-0000-0000-000000000011','aal2');
select pg_temp.expect_error($q$select capital_web3.advisory_review_report((pg_temp.data('saved')->>'report_version_id')::uuid,'approved',
 pg_temp.data('package')->>'content_sha256',pg_temp.data('package')->>'manifest_sha256','',
 '73000000-0000-0000-0000-000000000013')$q$,'42501','removed roster reviewer cannot replay approval despite remaining publisher/client role');
reset role;
update capital_web3_private.cofre_workspace_members set active=false
 where workspace_id='83000000-0000-0000-0000-000000000001' and user_id='13000000-0000-0000-0000-000000000011'
 and member_role='publisher';
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000011','93000000-0000-0000-0000-000000000011','aal2');
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package((pg_temp.data('saved')->>'report_version_id')::uuid)$q$,
 '42501','remaining client membership cannot preserve removed staff privileges');
reset role;

update capital_web3_private.cofre_workspace_members set active=false
 where workspace_id='83000000-0000-0000-0000-000000000001' and user_id='13000000-0000-0000-0000-000000000011';
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000011','93000000-0000-0000-0000-000000000011','aal2');
select pg_temp.expect_error($q$select capital_web3.advisory_get_review_package((pg_temp.data('saved')->>'report_version_id')::uuid)$q$,'42501','inactive roster overrides surviving case assignment');
reset role;
delete from auth.sessions where id='93000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001','aal1');
select pg_temp.require((select count(*)=0 from capital_web3.advisory_report_versions where id=(pg_temp.data('saved')->>'report_version_id')::uuid),'client JWT with removed session cannot read previously published content');
select pg_temp.expect_error($q$select capital_web3.advisory_record_receipt((pg_temp.data('publication')->>'publication_id')::uuid)$q$,'42501','receipt replay denies removed client session');
reset role;
delete from auth.sessions where id='93000000-0000-0000-0000-000000000010';
set local role authenticated;
select pg_temp.identity('13000000-0000-0000-0000-000000000010','93000000-0000-0000-0000-000000000010','aal1');
select pg_temp.expect_error($q$select capital_web3.advisory_lite_signals_get((pg_temp.data('case')->>'case_id')::uuid)$q$,'42501','revoked analyst session cannot read Lite');
select pg_temp.expect_error($q$select capital_web3.advisory_cofre_partial_get((pg_temp.data('case')->>'case_id')::uuid)$q$,'42501','revoked analyst session cannot read partial');
select pg_temp.expect_error($q$select capital_web3.advisory_cofre_partial_save((pg_temp.data('case')->>'case_id')::uuid,pg_temp.data('intake'),1,1,'73000000-0000-0000-0000-000000000092')$q$,'42501','revoked analyst session cannot write partial');
reset role;
select pg_temp.require((select count(*)=1 from capital_web3.cofre_intakes where case_id=(pg_temp.data('case')->>'case_id')::uuid),'invalid actions left no partial intake version');
select pg_temp.require((select count(*)=2 from capital_web3.advisory_report_versions where case_id=(pg_temp.data('case')->>'case_id')::uuid),'invalid actions left no extra report version');
rollback;
