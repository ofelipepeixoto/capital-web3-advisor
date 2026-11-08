-- Synthetic COFRE Lite signals: candidate for disposable stack only. No score or report.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table capital_web3_private.cofre_lite_signals (
 case_id uuid primary key references capital_web3.advisory_cases(id),
 revision integer not null check(revision>0),
 intake jsonb not null check(jsonb_typeof(intake)='object' and octet_length(intake::text)<=4000),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create table capital_web3_private.cofre_lite_signal_receipts (
 actor uuid not null references auth.users(id),
 key uuid not null,
 request_hash text not null check(length(request_hash)=64),
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor,key)
);
alter table capital_web3_private.cofre_lite_signals enable row level security;
alter table capital_web3_private.cofre_lite_signals force row level security;
alter table capital_web3_private.cofre_lite_signal_receipts enable row level security;
alter table capital_web3_private.cofre_lite_signal_receipts force row level security;
revoke all on capital_web3_private.cofre_lite_signals,capital_web3_private.cofre_lite_signal_receipts from public,anon,authenticated,service_role;

create function capital_web3_private.validate_lite_signal_intake(v jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare names text[] := array['urgency','guaranteed_return','unsolicited_link','different_domain','unverified_contract','unlimited_approval','secret_request','missing_team_docs','unclear_tokenomics','profit_screenshots'];
  k text; z jsonb;
begin
 if v is null or jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>4000 then raise exception 'invalid intake' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(v))<>4 or not (v ?& array['schema_version','synthetic','consents','signals'])
  or v->>'schema_version' is distinct from 'cofre-lite-signals-0.1' or v->'synthetic' is distinct from 'true'::jsonb
  or jsonb_typeof(v->'consents') is distinct from 'object' or jsonb_typeof(v->'signals') is distinct from 'object'
 then raise exception 'invalid intake' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(v->'consents'))<>2 or not ((v->'consents') ?& array['assessment','storage'])
  or v#>'{consents,assessment}' is distinct from 'true'::jsonb or v#>'{consents,storage}' is distinct from 'true'::jsonb then
  raise exception 'consent required' using errcode='22023'; end if;
 z:=v->'signals';
 if (select count(*) from jsonb_object_keys(z))<>10 or not (z ?& names) then raise exception 'invalid signals' using errcode='22023'; end if;
 foreach k in array names loop
  if jsonb_typeof(z->k) is distinct from 'string' or not ((z->>k)=any(array['yes','no','unknown','not_applicable'])) then
   raise exception 'invalid signal' using errcode='22023'; end if;
 end loop;
end $$;

create function capital_web3.advisory_lite_signals_get(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; result jsonb;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 select jsonb_build_object('intake',intake,'revision',revision,'updated_at',updated_at) into result from capital_web3_private.cofre_lite_signals where case_id=p_case_id;
 return result;
end $$;
create function capital_web3.advisory_lite_signals_save(p_case_id uuid,p_intake jsonb,p_expected_revision integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; r integer; v_request_hash text; old capital_web3_private.cofre_lite_signal_receipts%rowtype; result jsonb;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>10000 or p_idempotency_key is null then raise exception 'invalid revision' using errcode='22023'; end if;
 perform capital_web3_private.validate_lite_signal_intake(p_intake);
 -- Serialize both the case's revision and the actor's global idempotency quota.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':lite-actor',0));
 perform 1 from capital_web3.advisory_cases where id=p_case_id for update;
 v_request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('case',p_case_id,'intake',p_intake,'revision',p_expected_revision)::text,'UTF8')),'hex');
 select * into old from capital_web3_private.cofre_lite_signal_receipts where cofre_lite_signal_receipts.actor=v_actor and key=p_idempotency_key;
 if found then if old.request_hash<>v_request_hash then raise exception 'key conflict' using errcode='23505'; end if; return old.result; end if;
 if (select count(*) from capital_web3_private.cofre_lite_signal_receipts where cofre_lite_signal_receipts.actor=v_actor)>=128 then raise exception 'receipt limit reached' using errcode='54000'; end if;
 select revision into r from capital_web3_private.cofre_lite_signals where case_id=p_case_id;
 r:=coalesce(r,0);
 if r<>p_expected_revision then raise exception 'lite changed' using errcode='23514'; end if;
 insert into capital_web3_private.cofre_lite_signals(case_id,revision,intake,updated_by) values(p_case_id,r+1,p_intake,v_actor)
 on conflict(case_id) do update set revision=excluded.revision,intake=excluded.intake,updated_by=excluded.updated_by,updated_at=now();
 result:=jsonb_build_object('revision',r+1);
 insert into capital_web3_private.cofre_lite_signal_receipts(actor,key,request_hash,result) values(v_actor,p_idempotency_key,v_request_hash,result);
 insert into capital_web3.advisory_audit_events(case_id,actor_user_id,action,entity_id) values(p_case_id,v_actor,'cofre_lite_signals_saved',p_case_id);
 return result;
end $$;
revoke all on function capital_web3_private.validate_lite_signal_intake(jsonb),capital_web3.advisory_lite_signals_get(uuid),capital_web3.advisory_lite_signals_save(uuid,jsonb,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function capital_web3.advisory_lite_signals_get(uuid),capital_web3.advisory_lite_signals_save(uuid,jsonb,integer,uuid) to authenticated;
commit;
