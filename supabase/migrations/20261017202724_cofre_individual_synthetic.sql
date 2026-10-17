-- Additive synthetic COFRE journey. No Auth/global settings or neighboring schemas changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table capital_web3_private.cofre_workspaces (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(label) between 1 and 100),
  synthetic_only boolean not null default true check (synthetic_only),
  staff_mfa_required boolean not null default false
);
create table capital_web3_private.cofre_workspace_members (
  workspace_id uuid not null references capital_web3_private.cofre_workspaces(id),
  user_id uuid not null references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 100),
  member_role text not null check (member_role in ('analyst','reviewer','publisher','client')),
  active boolean not null default true,
  primary key (workspace_id,user_id,member_role)
);
create table capital_web3_private.cofre_case_workspaces (
  case_id uuid primary key references capital_web3.advisory_cases(id),
  workspace_id uuid not null references capital_web3_private.cofre_workspaces(id)
);
create table capital_web3_private.cofre_actions (
  actor uuid not null references auth.users(id),
  action text not null check (action in ('cofre_create','cofre_save')),
  key uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor,action,key)
);
create table capital_web3.cofre_intakes (
  case_id uuid not null references capital_web3.advisory_cases(id),
  revision integer not null check (revision>0),
  intake jsonb not null check (jsonb_typeof(intake)='object' and octet_length(intake::text)<=10000),
  report_version_id uuid not null unique references capital_web3.advisory_report_versions(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (case_id,revision)
);
alter table capital_web3_private.cofre_workspaces enable row level security;
alter table capital_web3_private.cofre_workspaces force row level security;
alter table capital_web3_private.cofre_workspace_members enable row level security;
alter table capital_web3_private.cofre_workspace_members force row level security;
alter table capital_web3_private.cofre_case_workspaces enable row level security;
alter table capital_web3_private.cofre_case_workspaces force row level security;
alter table capital_web3_private.cofre_actions enable row level security;
alter table capital_web3_private.cofre_actions force row level security;
alter table capital_web3.cofre_intakes enable row level security;
alter table capital_web3.cofre_intakes force row level security;
revoke all on capital_web3_private.cofre_workspaces,capital_web3_private.cofre_workspace_members,
 capital_web3_private.cofre_case_workspaces,capital_web3_private.cofre_actions,capital_web3.cofre_intakes
 from public,anon,authenticated,service_role;
grant select(case_id,revision,intake,report_version_id,created_at) on capital_web3.cofre_intakes to authenticated;
create index cofre_member_user on capital_web3_private.cofre_workspace_members(user_id,workspace_id) where active;

-- Session revocation is checked for the new COFRE slice, including direct Data API reads.
create function capital_web3_private.cofre_session_active()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare sid text:=auth.jwt()->>'session_id';
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
    or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or sid is null or sid !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  return exists(select 1 from auth.sessions s where s.id=sid::uuid and s.user_id=auth.uid()
    and (s.not_after is null or s.not_after>now()));
exception when invalid_text_representation then return false;
end $$;
create function capital_web3_private.cofre_is_staff(p_workspace uuid,p_roles text[] default array['analyst','reviewer','publisher'])
returns boolean language sql stable security definer set search_path='' as $$
 select capital_web3_private.cofre_session_active() and exists(
 select 1 from capital_web3_private.cofre_workspace_members m
 join capital_web3_private.cofre_workspaces w on w.id=m.workspace_id
 where m.workspace_id=p_workspace and m.user_id=auth.uid() and m.active
 and m.member_role=any(p_roles) and (not w.staff_mfa_required or auth.jwt()->>'aal'='aal2'));
$$;
create function capital_web3_private.is_cofre_case(p_case uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from capital_web3_private.cofre_case_workspaces where case_id=p_case);
$$;
create function capital_web3_private.cofre_case_access(p_case uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select capital_web3_private.cofre_session_active() and exists(
 select 1 from capital_web3_private.cofre_case_workspaces c
 join capital_web3_private.cofre_workspace_members m on m.workspace_id=c.workspace_id
 join capital_web3_private.cofre_workspaces w on w.id=c.workspace_id
 where c.case_id=p_case and m.user_id=auth.uid() and m.active
 and (not w.staff_mfa_required or auth.jwt()->>'aal'='aal2' or not exists(
 select 1 from capital_web3_private.cofre_workspace_members staff where staff.workspace_id=c.workspace_id
 and staff.user_id=auth.uid() and staff.active and staff.member_role<>'client')));
$$;
create or replace function capital_web3_private.is_assigned_staff(
  p_case uuid, p_roles text[] default array['analyst','reviewer','publisher','admin']::text[]
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
    and (not capital_web3_private.is_cofre_case(p_case) or exists(
      select 1 from capital_web3_private.cofre_case_workspaces cw where cw.case_id=p_case
      and capital_web3_private.cofre_is_staff(cw.workspace_id,p_roles)))
    and exists (
      select 1 from capital_web3.advisory_case_staff s
      where s.case_id = p_case and s.user_id = auth.uid()
        and s.active and s.staff_role = any(p_roles)
    );
$$;

create or replace function capital_web3_private.can_receive_publication(p_publication uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
    and exists (
      select 1 from capital_web3.advisory_publications p
      join capital_web3.advisory_publication_recipients r
        on r.publication_id = p.id and r.case_id = p.case_id and r.user_id = auth.uid()
      join capital_web3.advisory_case_clients c
        on c.case_id = p.case_id and c.user_id = r.user_id and c.active
      where p.id = p_publication and p.published_at <= now()
        and (not capital_web3_private.is_cofre_case(p.case_id) or capital_web3_private.cofre_case_access(p.case_id))
        and (p.expires_at is null or p.expires_at > now())
        and not exists (
          select 1 from capital_web3.advisory_publication_revocations x
          where x.publication_id = p.id
            and (x.recipient_user_id is null or x.recipient_user_id = auth.uid())
        )
    );
$$;


create policy staff_read_intake on capital_web3.cofre_intakes for select to authenticated
 using (capital_web3_private.is_assigned_staff(case_id) and capital_web3_private.cofre_case_access(case_id));
create trigger immutable_intake before update or delete on capital_web3.cofre_intakes
 for each row execute function capital_web3_private.reject_mutation();
create trigger immutable_cofre_receipt before update or delete on capital_web3_private.cofre_actions
 for each row execute function capital_web3_private.reject_mutation();

-- Definer returns a narrow roster only to enrolled staff in the same workspace.
create function capital_web3.advisory_cofre_workspaces()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('workspace_id',w.id,'workspace_label',w.label,
 'user_id',m.user_id,'display_name',m.display_name,'member_role',m.member_role)
 order by w.label,m.display_name,m.member_role),'[]'::jsonb)
 from capital_web3_private.cofre_workspaces w
 join capital_web3_private.cofre_workspace_members m on m.workspace_id=w.id and m.active
 where capital_web3_private.cofre_is_staff(w.id);
$$;

-- Input is an enum-only synthetic record. Rechecked here because RPCs can be called without Edge.
create function capital_web3_private.validate_cofre_intake(v jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare k text; item jsonb; a text; e text;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>10000
 or (select array_agg(x order by x) from jsonb_object_keys(v) x) is distinct from 
 array['consents','controls','inventory','profile','schema_version','synthetic']::text[]
 or v->>'schema_version' is distinct from 'cofre-intake-0.1' or v->'synthetic'<>'true'::jsonb then
 raise exception 'invalid synthetic intake' using errcode='22023'; end if;
 if jsonb_typeof(v->'profile')<>'object' or
 (select array_agg(x order by x) from jsonb_object_keys(v->'profile') x) is distinct from 
 array['experience','liquidity','loss_capacity','objective']::text[] or
 (v#>>'{profile,objective}'=any(array['organize','learn_defi','protect_family'])) is not true or
 (v#>>'{profile,experience}'=any(array['beginner','intermediate','advanced'])) is not true or
 (v#>>'{profile,liquidity}'=any(array['short_term','long_term','unknown'])) is not true or
 (v#>>'{profile,loss_capacity}'=any(array['essential','limited','discretionary','unknown'])) is not true then
 raise exception 'invalid profile' using errcode='22023'; end if;
 if v->'consents' is distinct from jsonb_build_object('assessment',true,'storage',true,'external_sources',false,'notifications',false) then
 raise exception 'explicit synthetic consents required' using errcode='22023'; end if;
 if jsonb_typeof(v->'controls')<>'object' or
 (select array_agg(x order by x) from jsonb_object_keys(v->'controls') x) is distinct from 
 array['backup_offline','device_updates','domain_checks','permissions_review','recovery_tested','secret_exposure','wallet_separation']::text[] then
 raise exception 'invalid controls' using errcode='22023'; end if;
 for k,item in select * from jsonb_each(v->'controls') loop
   if jsonb_typeof(item)<>'object' or
    (select array_agg(x order by x) from jsonb_object_keys(item) x) is distinct from array['answer','evidence']::text[] then
    raise exception 'invalid control' using errcode='22023'; end if;
   a:=item->>'answer'; e:=item->>'evidence';
   if a is null or e is null or not(a=any(array['yes','no','unknown'])) or
    not(e=any(array['declared','observed','unknown'])) or
    (a='unknown')<>(e='unknown') then raise exception 'invalid evidence' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(v->'inventory')<>'array' or jsonb_array_length(v->'inventory')>12 then
 raise exception 'invalid inventory' using errcode='22023'; end if;
 for item in select * from jsonb_array_elements(v->'inventory') loop
   if jsonb_typeof(item)<>'object' or
    (select array_agg(x order by x) from jsonb_object_keys(item) x) is distinct from array['category','custody','network']::text[] or
    (item->>'category'=any(array['exchange','vault','apps','spending','watch'])) is not true or
    (item->>'network'=any(array['bitcoin','evm','other','unknown'])) is not true or
    (item->>'custody'=any(array['self','third_party','unknown'])) is not true then
    raise exception 'invalid inventory entry' using errcode='22023'; end if;
 end loop;
end $$;

create function capital_web3.advisory_create_cofre_case(p_workspace_id uuid,p_client_user_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; req jsonb; prior capital_web3_private.cofre_actions%rowtype; cid uuid; result jsonb; label text;
begin
 v_actor:=capital_web3_private.require_human_identity();
 perform 1 from capital_web3_private.cofre_workspace_members where workspace_id=p_workspace_id for share;
 if not capital_web3_private.cofre_is_staff(p_workspace_id,array['analyst']) then
 raise exception 'workspace unavailable' using errcode='42501'; end if;
 select display_name into label from capital_web3_private.cofre_workspace_members
 where workspace_id=p_workspace_id and user_id=p_client_user_id and member_role='client' and active;
 if label is null then raise exception 'recipient unavailable' using errcode='42501'; end if;
 if p_idempotency_key is null then raise exception 'invalid key' using errcode='22023'; end if;
 req:=jsonb_build_object('workspace',p_workspace_id,'client',p_client_user_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':cofre_create:'||p_idempotency_key::text,0));
 select * into prior from capital_web3_private.cofre_actions where cofre_actions.actor=v_actor and action='cofre_create' and key=p_idempotency_key;
 if found then
 if prior.request<>req then raise exception 'key conflict' using errcode='23505'; end if;
 return prior.result; end if;
 -- The roster is an administrative prerequisite; no account can promote itself.
 if not exists(select 1 from capital_web3_private.cofre_workspace_members where workspace_id=p_workspace_id
 and user_id<>v_actor and member_role='reviewer' and active) or
 not exists(select 1 from capital_web3_private.cofre_workspace_members where workspace_id=p_workspace_id
 and user_id<>v_actor and member_role='publisher' and active) then
 raise exception 'independent reviewer and publisher required' using errcode='23514'; end if;
 insert into capital_web3.advisory_cases(client_safe_title,created_by) values('COFRE Individual · '||label,v_actor) returning id into cid;
 insert into capital_web3_private.cofre_case_workspaces values(cid,p_workspace_id);
 insert into capital_web3.advisory_case_staff(case_id,user_id,staff_role)
 select cid,m.user_id,m.member_role from capital_web3_private.cofre_workspace_members m
 where m.workspace_id=p_workspace_id and m.active and (m.member_role in ('reviewer','publisher') or (m.member_role='analyst' and m.user_id=v_actor));
 insert into capital_web3.advisory_case_clients(case_id,user_id) values(cid,p_client_user_id);
 result:=jsonb_build_object('case_id',cid);
 insert into capital_web3_private.cofre_actions(actor,action,key,request,result) values(v_actor,'cofre_create',p_idempotency_key,req,result);
 insert into capital_web3.advisory_audit_events(case_id,actor_user_id,action,entity_id) values(cid,v_actor,'cofre_case_created',cid);
 return result;
end $$;

create function capital_web3.advisory_save_cofre_intake(p_case_id uuid,p_intake jsonb,p_content jsonb,p_expected_revision integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; wid uuid; req jsonb; prior capital_web3_private.cofre_actions%rowtype; rev integer; rid uuid; vid uuid; result jsonb;
begin
 v_actor:=capital_web3_private.require_human_identity();
 select workspace_id into wid from capital_web3_private.cofre_case_workspaces where case_id=p_case_id;
 if wid is null or not capital_web3_private.cofre_is_staff(wid,array['analyst']) or
 not capital_web3_private.is_assigned_staff(p_case_id,array['analyst','admin']) then
 raise exception 'case unavailable' using errcode='42501'; end if;
 perform 1 from capital_web3.advisory_cases where id=p_case_id for update;
 perform capital_web3_private.validate_cofre_intake(p_intake);
 -- Draft authored through the product; content never grants review/publication authority.
 if p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>60000
 or p_content->>'report_kind' is distinct from 'cofre_individual' or p_content->>'mode' is distinct from 'synthetic'
 or p_content->>'schema_version' is distinct from 'cofre-report-0.1'
 or p_content->'profile' is distinct from p_intake->'profile'
 or (select jsonb_object_agg(c->>'id',jsonb_build_object('answer',c->'answer','evidence',c->'evidence')) from jsonb_array_elements(p_content->'controls') c) is distinct from p_intake->'controls'
 or (select coalesce(jsonb_agg(i - array['title','category_label','network_label','custody_label']::text[]),'[]'::jsonb) from jsonb_array_elements(p_content->'inventory') i) is distinct from p_intake->'inventory'
 or p_content#>'{human_review,approved}' is distinct from 'false'::jsonb then
 raise exception 'invalid draft envelope' using errcode='22023'; end if;
 if (p_content->>'status'=any(array['blocked','needs_input','ok'])) is not true
 or (p_intake#>>'{controls,secret_exposure,answer}'='yes' and p_content->>'status'<>'blocked')
 or (p_content->>'status'='ok' and (
   p_intake#>>'{controls,secret_exposure,answer}'<>'no'
   or exists(select 1 from jsonb_each(p_intake->'controls') c where c.key<>'secret_exposure' and c.value->>'answer'<>'yes')
   or p_intake#>>'{profile,liquidity}'<>'long_term'
   or p_intake#>>'{profile,loss_capacity}' in ('essential','unknown')
   or jsonb_array_length(p_intake->'inventory')=0
   or exists(select 1 from jsonb_array_elements(p_intake->'inventory') i where i->>'network'='unknown' or i->>'custody'='unknown')
 )) then raise exception 'draft status contradicts intake' using errcode='22023'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_idempotency_key is null then
 raise exception 'invalid revision' using errcode='22023'; end if;
 req:=jsonb_build_object('case',p_case_id,'intake',p_intake,'expected_revision',p_expected_revision);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':cofre_save:'||p_idempotency_key::text,0));
 select * into prior from capital_web3_private.cofre_actions where cofre_actions.actor=v_actor and action='cofre_save' and key=p_idempotency_key;
 if found then
 if prior.request<>req then raise exception 'key conflict' using errcode='23505'; end if;
 return prior.result; end if;
 select coalesce(max(revision),0) into rev from capital_web3.cofre_intakes where case_id=p_case_id;
 if rev<>p_expected_revision then raise exception 'intake changed; reload current version' using errcode='23514'; end if;
 select id into rid from capital_web3.advisory_reports where case_id=p_case_id order by created_at limit 1;
 if rid is null then insert into capital_web3.advisory_reports(case_id,created_by) values(p_case_id,v_actor) returning id into rid; end if;
 insert into capital_web3.advisory_report_versions(report_id,case_id,version_number,content,created_by)
 values(rid,p_case_id,rev+1,p_content,v_actor) returning id into vid;
 insert into capital_web3.cofre_intakes(case_id,revision,intake,report_version_id,created_by) values(p_case_id,rev+1,p_intake,vid,v_actor);
 result:=jsonb_build_object('case_id',p_case_id,'revision',rev+1,'report_version_id',vid);
 insert into capital_web3_private.cofre_actions(actor,action,key,request,result) values(v_actor,'cofre_save',p_idempotency_key,req,result);
 insert into capital_web3.advisory_audit_events(case_id,actor_user_id,action,entity_id) values(p_case_id,v_actor,'cofre_draft_created',vid);
 return result;
end $$;

-- A direct Data API write cannot bypass the intake path. The invoker is postgres
-- inside the controlled definer RPC, authenticated for direct client statements.
create function capital_web3_private.guard_cofre_direct_write()
returns trigger language plpgsql set search_path='' as $$
begin
 if capital_web3_private.is_cofre_case(new.case_id) and not exists(select 1 from pg_catalog.pg_roles
 where rolname=current_user and (rolbypassrls or rolsuper)) then
 raise exception 'use the COFRE intake workflow' using errcode='42501'; end if;
 return new;
end $$;
create trigger cofre_write_path before insert or update on capital_web3.advisory_report_versions
 for each row execute function capital_web3_private.guard_cofre_direct_write();
create trigger cofre_report_path before insert or update on capital_web3.advisory_reports
 for each row execute function capital_web3_private.guard_cofre_direct_write();
create function capital_web3_private.guard_cofre_decision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if capital_web3_private.is_cofre_case(new.case_id) then
 if not capital_web3_private.cofre_case_access(new.case_id) then
 raise exception 'active enrolled session required' using errcode='42501'; end if;
 if exists(select 1 from capital_web3.advisory_report_assets where report_version_id=new.report_version_id) then
 raise exception 'COFRE attachments not supported' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger cofre_review_gate before insert on capital_web3.advisory_human_reviews
 for each row execute function capital_web3_private.guard_cofre_decision();
create trigger cofre_publication_gate before insert on capital_web3.advisory_publications
 for each row execute function capital_web3_private.guard_cofre_decision();
create function capital_web3_private.guard_cofre_asset()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if capital_web3_private.is_cofre_case(new.case_id) then
 raise exception 'COFRE attachments not supported' using errcode='23514'; end if;
 return new;
end $$;
create trigger cofre_no_assets before insert or update on capital_web3.advisory_report_assets
 for each row execute function capital_web3_private.guard_cofre_asset();

-- Restrictive guards add current-session/roster checks to the existing case ACL.
create policy cofre_current_session on capital_web3.advisory_cases as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(id) or capital_web3_private.cofre_case_access(id));
create policy cofre_current_session on capital_web3.advisory_reports as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));
create policy cofre_current_session on capital_web3.advisory_report_versions as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));
create policy cofre_current_session on capital_web3.advisory_publications as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

create policy cofre_current_session on capital_web3.advisory_case_staff as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

create policy cofre_current_session on capital_web3.advisory_case_clients as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

create policy cofre_current_session on capital_web3.advisory_human_reviews as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

create policy cofre_current_session on capital_web3.advisory_publication_recipients as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

create policy cofre_current_session on capital_web3.advisory_publication_revocations as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

create policy cofre_current_session on capital_web3.advisory_receipts as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

create policy cofre_current_session on capital_web3.advisory_clarifications as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

create policy cofre_current_session on capital_web3.advisory_audit_events as restrictive for select to authenticated
 using (not capital_web3_private.is_cofre_case(case_id) or capital_web3_private.cofre_case_access(case_id));

revoke all on function capital_web3_private.cofre_session_active(),capital_web3_private.cofre_is_staff(uuid,text[]),
 capital_web3_private.is_cofre_case(uuid),capital_web3_private.cofre_case_access(uuid),capital_web3_private.validate_cofre_intake(jsonb),
 capital_web3_private.guard_cofre_direct_write(),capital_web3_private.guard_cofre_decision(),capital_web3_private.guard_cofre_asset()
 from public,anon,authenticated,service_role;
grant execute on function capital_web3_private.is_cofre_case(uuid),capital_web3_private.cofre_case_access(uuid) to authenticated;
revoke all on function capital_web3.advisory_cofre_workspaces(),capital_web3.advisory_create_cofre_case(uuid,uuid,uuid),
 capital_web3.advisory_save_cofre_intake(uuid,jsonb,jsonb,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function capital_web3.advisory_cofre_workspaces(),capital_web3.advisory_create_cofre_case(uuid,uuid,uuid),
 capital_web3.advisory_save_cofre_intake(uuid,jsonb,jsonb,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
