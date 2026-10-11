-- Capital Web3 namespace staging only. Narrow human workflow RPCs; no financial execution.
-- Requires 0001_advisory.sql; every identity is derived from the verified JWT.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$ begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolbypassrls or rolsuper)) then
    raise exception 'migration owner must be a controlled BYPASSRLS administrative role'
      using errcode = '42501';
  end if;
end $$;

-- Route every client acknowledgement through the locking RPC. The direct
-- INSERT policy from 0001 would otherwise allow a statement authorized before
-- revocation to finish after it while bypassing the publication row lock.
revoke insert on capital_web3.advisory_receipts from authenticated;
drop policy client_receipt_create on capital_web3.advisory_receipts;

-- Private, append-only action receipts are not part of the exposed Data API.
-- The idempotency key is scoped to actor + action and bound to the full request.
create table capital_web3_private.human_workflow_actions (
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('review','publish','revoke')),
  idempotency_key uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (actor_user_id, action, idempotency_key)
);
alter table capital_web3_private.human_workflow_actions enable row level security;
alter table capital_web3_private.human_workflow_actions force row level security;
revoke all on capital_web3_private.human_workflow_actions from public, anon, authenticated, service_role;
create trigger append_only before update or delete on capital_web3_private.human_workflow_actions
  for each row execute function capital_web3_private.reject_mutation();

-- Internal helper: never expose capital_web3_private as a Supabase API schema.
-- Row locking of the version/publication protects workflow data; this lock
-- serializes identical action keys so retries cannot insert a second action.
create function capital_web3_private.previous_human_action(
  p_actor uuid, p_action text, p_key uuid, p_request jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved capital_web3_private.human_workflow_actions%rowtype; request_hash text;
begin
  if p_actor is null or p_key is null or p_action not in ('review','publish','revoke') then
    raise exception 'invalid human action' using errcode = '22023';
  end if;
  request_hash := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(p_request::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_actor::text || ':' || p_action || ':' || p_key::text, 0));
  select * into saved from capital_web3_private.human_workflow_actions
    where actor_user_id = p_actor and action = p_action and idempotency_key = p_key;
  if found then
    if saved.request_sha256 <> request_hash then
      raise exception 'idempotency key already bound to a different action' using errcode = '23505';
    end if;
    return saved.result;
  end if;
  return null;
end $$;

create function capital_web3_private.save_human_action(
  p_actor uuid, p_action text, p_key uuid, p_request jsonb, p_result jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into capital_web3_private.human_workflow_actions
    (actor_user_id, action, idempotency_key, request_sha256, result)
  values (p_actor, p_action, p_key, pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(p_request::text, 'UTF8')), 'hex'), p_result);
$$;

-- Require a regular authenticated human account. Case-specific roles remain
-- authoritative rows in advisory_case_staff, never user_metadata/app text.
create function capital_web3_private.require_human_identity()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or coalesce(auth.jwt()->>'role','') <> 'authenticated'
    or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'authenticated human account required' using errcode = '42501';
  end if;
  return actor;
end $$;

create function capital_web3.advisory_get_review_package(p_report_version_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v capital_web3.advisory_report_versions%rowtype; assets jsonb; review jsonb;
begin
  perform capital_web3_private.require_human_identity();
  select * into v from capital_web3.advisory_report_versions where id = p_report_version_id;
  if not found or not capital_web3_private.is_assigned_staff(v.case_id) then
    raise exception 'report unavailable' using errcode = '42501';
  end if;
  -- Share lock gives one package snapshot while preventing content/asset writes.
  select * into v from capital_web3.advisory_report_versions where id = p_report_version_id for share;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'bucket_id',a.bucket_id,
    'object_name',a.object_name,'bytes_sha256',a.bytes_sha256,'mime_type',a.mime_type)
    order by a.id), '[]'::jsonb) into assets
    from capital_web3.advisory_report_assets a where a.report_version_id = v.id;
  select jsonb_build_object('id',r.id,'decision',r.decision) into review
    from capital_web3.advisory_human_reviews r where r.report_version_id = v.id;
  return jsonb_build_object('report_version_id',v.id,'case_id',v.case_id,
    'content',v.content,'content_sha256',v.content_sha256,
    'manifest_sha256',capital_web3_private.manifest_sha256(v.id),'assets',assets,
    'human_review',review);
end $$;

create function capital_web3.advisory_review_report(
  p_report_version_id uuid, p_decision text, p_expected_content_sha256 text,
  p_expected_manifest_sha256 text, p_private_notes text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; v capital_web3.advisory_report_versions%rowtype; request jsonb;
  result jsonb; review_id uuid; manifest_hash text;
begin
  actor := capital_web3_private.require_human_identity();
  select * into v from capital_web3.advisory_report_versions where id = p_report_version_id for update;
  if not found then
    raise exception 'report unavailable for human review' using errcode = '42501';
  end if;
  perform 1 from capital_web3.advisory_case_staff s where s.case_id = v.case_id
    and s.user_id = actor and s.active and s.staff_role in ('reviewer','admin') for share;
  if not capital_web3_private.is_assigned_staff(v.case_id,array['reviewer','admin']) then
    raise exception 'report unavailable for human review' using errcode = '42501';
  end if;
  if v.created_by = actor then
    raise exception 'author cannot review their own report' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved','rejected')
    or p_private_notes is null or length(p_private_notes) > 4000
    or p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_manifest_sha256 is null or p_expected_manifest_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid review request' using errcode = '22023';
  end if;
  manifest_hash := capital_web3_private.manifest_sha256(v.id);
  if p_expected_content_sha256 <> v.content_sha256 or p_expected_manifest_sha256 <> manifest_hash then
    raise exception 'review package changed; inspect the current content and assets again' using errcode = '23514';
  end if;
  request := jsonb_build_object('report_version_id',v.id,'decision',p_decision,
    'content_sha256',p_expected_content_sha256,'manifest_sha256',p_expected_manifest_sha256,
    'private_notes',p_private_notes);
  result := capital_web3_private.previous_human_action(actor,'review',p_idempotency_key,request);
  if result is not null then return result; end if;
  insert into capital_web3.advisory_human_reviews(case_id,report_version_id,reviewer_user_id,
    decision,reviewed_content_sha256,reviewed_manifest_sha256,private_notes)
  values (v.case_id,v.id,actor,p_decision,p_expected_content_sha256,
    p_expected_manifest_sha256,p_private_notes) returning id into review_id;
  result := jsonb_build_object('review_id',review_id,'report_version_id',v.id,
    'decision',p_decision,'content_sha256',p_expected_content_sha256,
    'manifest_sha256',p_expected_manifest_sha256);
  perform capital_web3_private.save_human_action(actor,'review',p_idempotency_key,request,result);
  return result;
end $$;

create function capital_web3.advisory_publish_report(
  p_report_version_id uuid, p_recipient_user_ids uuid[], p_expected_content_sha256 text,
  p_expected_manifest_sha256 text, p_expires_at timestamptz, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; v capital_web3.advisory_report_versions%rowtype;
  r capital_web3.advisory_human_reviews%rowtype; request jsonb; result jsonb;
  recipients uuid[]; publication_id uuid; manifest_hash text;
begin
  actor := capital_web3_private.require_human_identity();
  select * into v from capital_web3.advisory_report_versions where id = p_report_version_id for update;
  if not found then
    raise exception 'report unavailable for publication' using errcode = '42501';
  end if;
  perform 1 from capital_web3.advisory_case_staff s where s.case_id = v.case_id
    and s.user_id = actor and s.active and s.staff_role in ('publisher','admin') for share;
  if not capital_web3_private.is_assigned_staff(v.case_id,array['publisher','admin']) then
    raise exception 'report unavailable for publication' using errcode = '42501';
  end if;
  -- A publisher cannot bypass the independent reviewer by publishing their own
  -- draft, even if their account also has reviewer/admin assignments.
  if v.created_by = actor then
    raise exception 'author cannot publish their own report' using errcode = '42501';
  end if;
  if p_recipient_user_ids is null or cardinality(p_recipient_user_ids) not between 1 and 100
    or array_position(p_recipient_user_ids,null) is not null
    or p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_manifest_sha256 is null or p_expected_manifest_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid publication request' using errcode = '22023';
  end if;
  select array_agg(x order by x) into recipients from
    (select distinct unnest(p_recipient_user_ids) x) normalized;
  if cardinality(recipients) <> cardinality(p_recipient_user_ids) then
    raise exception 'duplicate publication recipients' using errcode = '22023';
  end if;
  manifest_hash := capital_web3_private.manifest_sha256(v.id);
  if p_expected_content_sha256 <> v.content_sha256 or p_expected_manifest_sha256 <> manifest_hash then
    raise exception 'publication package changed; inspect the current content and assets again' using errcode = '23514';
  end if;
  select * into r from capital_web3.advisory_human_reviews
    where report_version_id = v.id and decision = 'approved';
  if not found or r.reviewed_content_sha256 <> p_expected_content_sha256
    or r.reviewed_manifest_sha256 <> p_expected_manifest_sha256 then
    raise exception 'publication requires approval of the exact package' using errcode = '23514';
  end if;
  -- Lock every recipient membership to prevent deactivation racing release.
  perform 1 from capital_web3.advisory_case_clients c
    where c.case_id = v.case_id and c.user_id = any(recipients) and c.active for share;
  if (select count(*) from capital_web3.advisory_case_clients c
    where c.case_id = v.case_id and c.user_id = any(recipients) and c.active) <> cardinality(recipients) then
    raise exception 'publication recipients unavailable' using errcode = '42501';
  end if;
  request := jsonb_build_object('report_version_id',v.id,'recipient_user_ids',to_jsonb(recipients),
    'content_sha256',p_expected_content_sha256,'manifest_sha256',p_expected_manifest_sha256,
    'expires_at',p_expires_at);
  result := capital_web3_private.previous_human_action(actor,'publish',p_idempotency_key,request);
  if result is not null then return result; end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'publication expiry must be in the future' using errcode = '22023';
  end if;
  insert into capital_web3.advisory_publications(case_id,report_version_id,human_review_id,
    publisher_user_id,expires_at) values(v.case_id,v.id,r.id,actor,p_expires_at)
    returning id into publication_id;
  insert into capital_web3.advisory_publication_recipients(publication_id,case_id,user_id)
    select publication_id,v.case_id,unnest(recipients);
  result := jsonb_build_object('publication_id',publication_id,'report_version_id',v.id,
    'recipient_user_ids',to_jsonb(recipients),'expires_at',p_expires_at);
  perform capital_web3_private.save_human_action(actor,'publish',p_idempotency_key,request,result);
  return result;
end $$;

create function capital_web3.advisory_revoke_publication(
  p_publication_id uuid, p_recipient_user_id uuid, p_reason text,
  p_expected_content_sha256 text, p_expected_manifest_sha256 text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; p capital_web3.advisory_publications%rowtype;
  v capital_web3.advisory_report_versions%rowtype; request jsonb; result jsonb; revocation_id uuid;
begin
  actor := capital_web3_private.require_human_identity();
  select * into p from capital_web3.advisory_publications where id = p_publication_id for update;
  if not found then
    raise exception 'publication unavailable for revocation' using errcode = '42501';
  end if;
  perform 1 from capital_web3.advisory_case_staff s where s.case_id = p.case_id
    and s.user_id = actor and s.active and s.staff_role in ('publisher','admin') for share;
  if not capital_web3_private.is_assigned_staff(p.case_id,array['publisher','admin']) then
    raise exception 'publication unavailable for revocation' using errcode = '42501';
  end if;
  select * into strict v from capital_web3.advisory_report_versions where id = p.report_version_id;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000
    or p_expected_content_sha256 is null or p_expected_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_manifest_sha256 is null or p_expected_manifest_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid revocation request' using errcode = '22023';
  end if;
  if v.content_sha256 <> p_expected_content_sha256
    or capital_web3_private.manifest_sha256(v.id) <> p_expected_manifest_sha256 then
    raise exception 'revocation must bind the exact published package' using errcode = '23514';
  end if;
  if p_recipient_user_id is not null and not exists (
    select 1 from capital_web3.advisory_publication_recipients pr
      where pr.publication_id = p.id and pr.user_id = p_recipient_user_id
  ) then
    raise exception 'publication recipient unavailable' using errcode = '42501';
  end if;
  request := jsonb_build_object('publication_id',p.id,'recipient_user_id',p_recipient_user_id,
    'reason',p_reason,'content_sha256',p_expected_content_sha256,
    'manifest_sha256',p_expected_manifest_sha256);
  result := capital_web3_private.previous_human_action(actor,'revoke',p_idempotency_key,request);
  if result is not null then return result; end if;
  insert into capital_web3.advisory_publication_revocations(publication_id,case_id,recipient_user_id,
    revoked_by,reason) values(p.id,p.case_id,p_recipient_user_id,actor,p_reason)
    returning id into revocation_id;
  result := jsonb_build_object('revocation_id',revocation_id,'publication_id',p.id,
    'recipient_user_id',p_recipient_user_id);
  perform capital_web3_private.save_human_action(actor,'revoke',p_idempotency_key,request,result);
  return result;
end $$;

create function capital_web3.advisory_record_receipt(p_publication_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; p capital_web3.advisory_publications%rowtype; r capital_web3.advisory_receipts%rowtype;
begin
  actor := capital_web3_private.require_human_identity();
  -- Same lock as revocation: a receipt cannot be added after a committed revoke.
  select * into p from capital_web3.advisory_publications where id = p_publication_id for update;
  if not found then
    raise exception 'publication unavailable' using errcode = '42501';
  end if;
  perform 1 from capital_web3.advisory_case_clients c where c.case_id = p.case_id
    and c.user_id = actor and c.active for share;
  if not capital_web3_private.can_receive_publication(p.id) then
    raise exception 'publication unavailable' using errcode = '42501';
  end if;
  insert into capital_web3.advisory_receipts(publication_id,case_id,report_version_id,user_id)
    values(p.id,p.case_id,p.report_version_id,actor)
    on conflict (publication_id,user_id) do nothing;
  select * into strict r from capital_web3.advisory_receipts
    where publication_id = p.id and user_id = actor;
  return jsonb_build_object('receipt_id',r.id,'publication_id',r.publication_id,
    'report_version_id',r.report_version_id,'received_at',r.received_at);
end $$;

revoke all on all functions in schema capital_web3_private from public, anon, authenticated, service_role;
-- Reapply the four RLS predicate grants intentionally allowed by 0001.
grant execute on function capital_web3_private.is_assigned_staff(uuid,text[]) to authenticated;
grant execute on function capital_web3_private.can_receive_publication(uuid) to authenticated;
grant execute on function capital_web3_private.can_read_version(uuid) to authenticated;
grant execute on function capital_web3_private.can_read_object(text,text) to anon, authenticated;

revoke all on function capital_web3.advisory_get_review_package(uuid),
  capital_web3.advisory_review_report(uuid,text,text,text,text,uuid),
  capital_web3.advisory_publish_report(uuid,uuid[],text,text,timestamptz,uuid),
  capital_web3.advisory_revoke_publication(uuid,uuid,text,text,text,uuid),
  capital_web3.advisory_record_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function capital_web3.advisory_get_review_package(uuid),
  capital_web3.advisory_review_report(uuid,text,text,text,text,uuid),
  capital_web3.advisory_publish_report(uuid,uuid[],text,text,timestamptz,uuid),
  capital_web3.advisory_revoke_publication(uuid,uuid,text,text,text,uuid),
  capital_web3.advisory_record_receipt(uuid) to authenticated;

-- A privileged owner is deliberate here; runtime users have neither table
-- write grants nor arbitrary helper EXECUTE. Verify this assertion after deploy.
do $$ begin
  if exists (select 1 from pg_catalog.pg_proc f
    join pg_catalog.pg_roles r on r.oid = f.proowner
    join pg_catalog.pg_namespace n on n.oid = f.pronamespace
    where f.prosecdef and ((n.nspname = 'capital_web3' and f.proname like 'advisory_%')
      or n.nspname = 'capital_web3_private') and not (r.rolbypassrls or r.rolsuper)) then
    raise exception 'workflow definer owner cannot enforce FORCE RLS helpers' using errcode = '42501';
  end if;
end $$;
comment on function capital_web3.advisory_review_report(uuid,text,text,text,text,uuid) is
  'Human-only review RPC: identity from auth.uid, separate author, exact observed content/manifest digests.';
comment on function capital_web3.advisory_publish_report(uuid,uuid[],text,text,timestamptz,uuid) is
  'Atomic human release to an exact recipient set; idempotency binds all request fields.';
comment on function capital_web3.advisory_record_receipt(uuid) is
  'Acknowledgement only: does not approve the report, trade, contract or plan.';
comment on table capital_web3.advisory_human_reviews is
  'Append-only workflow records; writes only via the narrow authenticated human review RPC.';
commit;
