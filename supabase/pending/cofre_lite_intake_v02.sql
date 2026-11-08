-- Candidate only: synthetic full Lite intake. Apply after cofre_lite_intakes_v02.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table capital_web3_private.cofre_lite_intakes_v02 (
 case_id uuid primary key references capital_web3.advisory_cases(id),
 revision integer not null check(revision>0),
 intake jsonb not null check(jsonb_typeof(intake)='object' and octet_length(intake::text)<=6000),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create table capital_web3_private.cofre_lite_intake_policy_v02 (
 singleton boolean primary key default true check(singleton),
 max_receipts_per_actor integer not null default 128 check(max_receipts_per_actor between 1 and 10000),
 minimum_retention_days integer not null default 365 check(minimum_retention_days between 1 and 3650)
);
insert into capital_web3_private.cofre_lite_intake_policy_v02(singleton) values(true);
alter table capital_web3_private.cofre_lite_intake_policy_v02 enable row level security;
alter table capital_web3_private.cofre_lite_intake_policy_v02 force row level security;
revoke all on capital_web3_private.cofre_lite_intake_policy_v02 from public,anon,authenticated,service_role;
create table capital_web3_private.cofre_lite_intake_receipts (
 actor uuid not null references auth.users(id),
 key uuid not null,
 request_hash text not null check(length(request_hash)=64),
 result jsonb not null,
 created_at timestamptz not null default now(),
 retain_until timestamptz not null,
 primary key(actor,key)
);
alter table capital_web3_private.cofre_lite_intakes_v02 enable row level security;
alter table capital_web3_private.cofre_lite_intakes_v02 force row level security;
alter table capital_web3_private.cofre_lite_intake_receipts enable row level security;
alter table capital_web3_private.cofre_lite_intake_receipts force row level security;
revoke all on capital_web3_private.cofre_lite_intakes_v02,capital_web3_private.cofre_lite_intake_receipts from public,anon,authenticated,service_role;

create function capital_web3_private.validate_lite_intake_v02(v jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare names text[] := array['urgency','guaranteed_return','unsolicited_link','different_domain','unverified_contract','unlimited_approval','secret_request','missing_team_docs','unclear_tokenomics','profit_screenshots'];
  k text; z jsonb;
begin
 if v is null or jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>6000 then raise exception 'invalid intake' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(v))<>6 or not (v ?& array['schema_version','synthetic','consents','signals','profile','controls'])
  or v->>'schema_version' is distinct from 'cofre-lite-intake-0.2' or v->'synthetic' is distinct from 'true'::jsonb
  or jsonb_typeof(v->'consents') is distinct from 'object' or jsonb_typeof(v->'signals') is distinct from 'object'
  or jsonb_typeof(v->'profile') is distinct from 'object' or jsonb_typeof(v->'controls') is distinct from 'object'
 then raise exception 'invalid intake' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(v->'consents'))<>2 or not ((v->'consents') ?& array['assessment','storage'])
  or v#>'{consents,assessment}' is distinct from 'true'::jsonb or v#>'{consents,storage}' is distinct from 'true'::jsonb then
  raise exception 'consent required' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(v->'profile'))<>1 or not ((v->'profile') ? 'experience')
  or jsonb_typeof(v#>'{profile,experience}') is distinct from 'string' or ((v#>>'{profile,experience}')=any(array['beginner','some','unknown'])) is not true then raise exception 'invalid profile' using errcode='22023'; end if;
 z:=v->'controls';
 if (select count(*) from jsonb_object_keys(z))<>12 or not (z ?& array['backup','vault','apps','spending','testing','watch','recovery','secret_exposure','source','permissions','payload','routine']) then raise exception 'invalid controls' using errcode='22023'; end if;
 foreach k in array array['backup','vault','apps','spending','testing','watch','recovery','secret_exposure','source','permissions','payload','routine'] loop
  if jsonb_typeof(z->k) is distinct from 'string' or not ((z->>k)=any(array['yes','no','unknown','not_applicable'])) or (k='secret_exposure' and z->>k='not_applicable') then raise exception 'invalid control' using errcode='22023'; end if;
 end loop;
 z:=v->'signals';
 if (select count(*) from jsonb_object_keys(z))<>10 or not (z ?& names) then raise exception 'invalid signals' using errcode='22023'; end if;
 foreach k in array names loop
  if jsonb_typeof(z->k) is distinct from 'string' or not ((z->>k)=any(array['yes','no','unknown','not_applicable'])) then
   raise exception 'invalid signal' using errcode='22023'; end if;
 end loop;
end $$;

create function capital_web3.advisory_lite_intake_get(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; result jsonb; legacy_rev integer;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not exists(select 1 from capital_web3_private.cofre_lite_features f where f.workspace_id=wid and f.enabled) or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 -- A committed disable must precede any newly authorized read.
 perform 1 from capital_web3.advisory_cases where id=p_case_id for share;
 perform 1 from capital_web3_private.cofre_case_workspaces where case_id=p_case_id and workspace_id=wid for share;
 if not found then raise exception 'case unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3_private.cofre_lite_features where workspace_id=wid and enabled for share; if not found then raise exception 'case unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3_private.cofre_workspaces where id=wid for share;
 perform 1 from capital_web3_private.cofre_workspace_members where workspace_id=wid and user_id=v_actor and member_role='analyst' and active for share;
 perform 1 from capital_web3.advisory_case_staff where case_id=p_case_id and user_id=v_actor and staff_role in ('analyst','admin') and active order by staff_role for share;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=v_actor for share;

 if not found or capital_web3_private.require_human_identity() is distinct from v_actor
  or not capital_web3_private.cofre_is_staff(wid,array['analyst'])
  or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin'])
 then raise exception 'case unavailable' using errcode='42501'; end if;
 select jsonb_build_object('intake',intake,'revision',revision,'updated_at',updated_at) into result from capital_web3_private.cofre_lite_intakes_v02 where case_id=p_case_id;
 if result is null then
  select revision into legacy_rev from capital_web3_private.cofre_lite_signals where case_id=p_case_id;
  if found then return jsonb_build_object('legacy_available',true,'legacy_revision',legacy_rev); end if;
 end if;
 return result;
end $$;
create function capital_web3.advisory_lite_intake_save(p_case_id uuid,p_intake jsonb,p_expected_revision integer,p_idempotency_key uuid,p_legacy_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; r integer; legacy_rev integer; v_capacity integer; v_retention_days integer; v_request_hash text; old capital_web3_private.cofre_lite_intake_receipts%rowtype; result jsonb;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not exists(select 1 from capital_web3_private.cofre_lite_features f where f.workspace_id=wid and f.enabled) or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>10000 or p_idempotency_key is null then raise exception 'invalid revision' using errcode='22023'; end if;
 perform capital_web3_private.validate_lite_intake_v02(p_intake);
 -- Serialize both the case's revision and the actor's global idempotency quota.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':lite-intake-actor',0));
 perform 1 from capital_web3.advisory_cases where id=p_case_id for update;
 perform 1 from capital_web3_private.cofre_case_workspaces where case_id=p_case_id and workspace_id=wid for share;
 if not found then raise exception 'case unavailable' using errcode='42501'; end if;
 -- The shared lock serializes a disable with this write until transaction commit.
 perform 1 from capital_web3_private.cofre_lite_features where workspace_id=wid and enabled for share; if not found then raise exception 'case unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3_private.cofre_workspaces where id=wid for share;
 perform 1 from capital_web3_private.cofre_workspace_members where workspace_id=wid and user_id=v_actor and member_role='analyst' and active for share;
 perform 1 from capital_web3.advisory_case_staff where case_id=p_case_id and user_id=v_actor and staff_role in ('analyst','admin') and active order by staff_role for share;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=v_actor for share;

 if not found or capital_web3_private.require_human_identity() is distinct from v_actor
  or not capital_web3_private.cofre_is_staff(wid,array['analyst'])
  or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin'])
 then raise exception 'case unavailable' using errcode='42501'; end if;
 v_request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('case',p_case_id,'intake',p_intake,'revision',p_expected_revision,'legacy_revision',p_legacy_revision)::text,'UTF8')),'hex');
 select * into old from capital_web3_private.cofre_lite_intake_receipts where cofre_lite_intake_receipts.actor=v_actor and key=p_idempotency_key;
 if found then if old.request_hash<>v_request_hash then raise exception 'key conflict' using errcode='23505'; end if; return old.result; end if;
 select max_receipts_per_actor,minimum_retention_days into strict v_capacity,v_retention_days from capital_web3_private.cofre_lite_intake_policy_v02 where singleton for share;
 if (select count(*) from capital_web3_private.cofre_lite_intake_receipts where cofre_lite_intake_receipts.actor=v_actor)>=v_capacity then raise exception 'receipt limit reached' using errcode='54000'; end if;
 select revision into r from capital_web3_private.cofre_lite_intakes_v02 where case_id=p_case_id;
 r:=coalesce(r,0);
 if r<>p_expected_revision then raise exception 'lite changed' using errcode='23514'; end if;
 if r=0 then
  select revision into legacy_rev from capital_web3_private.cofre_lite_signals where case_id=p_case_id;
  if legacy_rev is distinct from p_legacy_revision then raise exception 'previous signals changed or unacknowledged' using errcode='23514'; end if;
 elsif p_legacy_revision is not null then raise exception 'unexpected legacy revision' using errcode='22023'; end if;
 insert into capital_web3_private.cofre_lite_intakes_v02(case_id,revision,intake,updated_by) values(p_case_id,r+1,p_intake,v_actor)
 on conflict(case_id) do update set revision=excluded.revision,intake=excluded.intake,updated_by=excluded.updated_by,updated_at=now();
 result:=jsonb_build_object('revision',r+1);
 insert into capital_web3_private.cofre_lite_intake_receipts(actor,key,request_hash,result,retain_until) values(v_actor,p_idempotency_key,v_request_hash,result,now()+pg_catalog.make_interval(days=>v_retention_days));
 insert into capital_web3.advisory_audit_events(case_id,actor_user_id,action,entity_id) values(p_case_id,v_actor,'cofre_lite_intakes_v02_saved',p_case_id);
 return result;
end $$;
revoke all on function capital_web3_private.validate_lite_intake_v02(jsonb),capital_web3.advisory_lite_intake_get(uuid),capital_web3.advisory_lite_intake_save(uuid,jsonb,integer,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function capital_web3.advisory_lite_intake_get(uuid),capital_web3.advisory_lite_intake_save(uuid,jsonb,integer,uuid,integer) to authenticated;
commit;
