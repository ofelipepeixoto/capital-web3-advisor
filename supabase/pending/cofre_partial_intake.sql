-- Apply only in a disposable Supabase stack after review. Synthetic data only.
begin;
create table capital_web3_private.cofre_partial_intakes (
 case_id uuid not null references capital_web3.advisory_cases(id),
 actor uuid not null references auth.users(id),
 revision integer not null check(revision > 0),
 base_revision integer not null check(base_revision >= 0),
 intake jsonb not null check(jsonb_typeof(intake)='object' and octet_length(intake::text)<=10000),
 updated_at timestamptz not null default now(),
 primary key(case_id, actor)
);
alter table capital_web3_private.cofre_partial_intakes enable row level security;
alter table capital_web3_private.cofre_partial_intakes force row level security;
revoke all on capital_web3_private.cofre_partial_intakes from public,anon,authenticated,service_role;
create table capital_web3_private.cofre_partial_receipts (
 actor uuid not null references auth.users(id),
 key uuid not null,
 request jsonb not null,
 result jsonb not null,
 primary key(actor,key)
);
alter table capital_web3_private.cofre_partial_receipts enable row level security;
alter table capital_web3_private.cofre_partial_receipts force row level security;
revoke all on capital_web3_private.cofre_partial_receipts from public,anon,authenticated,service_role;
create function capital_web3_private.cofre_partial_validate(v jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare cleaned jsonb:=v; i integer;
begin
 if v is null or octet_length(v::text)>10000 then raise exception 'invalid intake' using errcode='22023'; end if;
 if v#>>'{profile,objective}'='' then cleaned:=jsonb_set(cleaned,'{profile,objective}','"organize"'::jsonb); end if;
 if v#>>'{profile,experience}'='' then cleaned:=jsonb_set(cleaned,'{profile,experience}','"beginner"'::jsonb); end if;
 if jsonb_typeof(v->'inventory')='array' then
  for i in 0..jsonb_array_length(v->'inventory')-1 loop
   if v#>>array['inventory',i::text,'category']='' then
    cleaned:=jsonb_set(cleaned,array['inventory',i::text,'category'],'"vault"'::jsonb);
   end if;
  end loop;
 end if;
 perform capital_web3_private.validate_cofre_intake(cleaned);
end $$;
create function capital_web3.advisory_cofre_partial_get(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; result jsonb; rev integer;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 select coalesce(max(revision),0) into rev from capital_web3.cofre_intakes where case_id=p_case_id;
 select jsonb_build_object('intake',intake,'revision',revision,'base_revision',base_revision,'stale',base_revision<>rev,'updated_at',updated_at) into result
 from capital_web3_private.cofre_partial_intakes where case_id=p_case_id and cofre_partial_intakes.actor=v_actor;
 return result;
end $$;
create function capital_web3.advisory_cofre_partial_save(p_case_id uuid,p_intake jsonb,p_expected_revision integer,p_base_revision integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; r integer; rev integer; req jsonb; old capital_web3_private.cofre_partial_receipts%rowtype; result jsonb;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then raise exception 'case unavailable' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_base_revision is null or p_base_revision<0 or p_idempotency_key is null then raise exception 'invalid revision' using errcode='22023'; end if;
 perform capital_web3_private.cofre_partial_validate(p_intake);
 perform 1 from capital_web3.advisory_cases where id=p_case_id for update;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':partial:'||p_idempotency_key::text,0));
 req:=jsonb_build_object('case',p_case_id,'intake',p_intake,'revision',p_expected_revision,'base_revision',p_base_revision);
 select * into old from capital_web3_private.cofre_partial_receipts where cofre_partial_receipts.actor=v_actor and key=p_idempotency_key;
 if found then if old.request<>req then raise exception 'key conflict' using errcode='23505'; end if; return old.result; end if;
 select coalesce(max(revision),0) into rev from capital_web3.cofre_intakes where case_id=p_case_id;
 if rev<>p_base_revision then raise exception 'final version changed' using errcode='23514'; end if;
 select revision into r from capital_web3_private.cofre_partial_intakes where case_id=p_case_id and cofre_partial_intakes.actor=v_actor;
 r:=coalesce(r,0);
 if r<>p_expected_revision then raise exception 'partial changed' using errcode='23514'; end if;
 insert into capital_web3_private.cofre_partial_intakes(case_id,actor,revision,base_revision,intake) values(p_case_id,v_actor,r+1,rev,p_intake)
 on conflict(case_id,actor) do update set revision=excluded.revision,base_revision=excluded.base_revision,intake=excluded.intake,updated_at=now();
 result:=jsonb_build_object('revision',r+1,'base_revision',rev);
 insert into capital_web3_private.cofre_partial_receipts(actor,key,request,result) values(v_actor,p_idempotency_key,req,result);
 insert into capital_web3.advisory_audit_events(case_id,actor_user_id,action,entity_id) values(p_case_id,v_actor,'cofre_partial_saved',p_case_id);
 return result;
end $$;
revoke all on function capital_web3_private.cofre_partial_validate(jsonb),capital_web3.advisory_cofre_partial_get(uuid),capital_web3.advisory_cofre_partial_save(uuid,jsonb,integer,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function capital_web3.advisory_cofre_partial_get(uuid),capital_web3.advisory_cofre_partial_save(uuid,jsonb,integer,integer,uuid) to authenticated;
commit;
