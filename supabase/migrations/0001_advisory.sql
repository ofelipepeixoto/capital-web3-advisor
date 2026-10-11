-- FUTURE STAGING ONLY. This file does not provision a Supabase project.
-- Apply to a fresh isolated project after review. No transaction/execution tools.
begin;

-- FORCE RLS also applies to a table owner. Definer helpers therefore require a
-- controlled administrative owner with BYPASSRLS, not ownership alone.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolbypassrls or rolsuper)) then
    raise exception 'migration owner must be a controlled BYPASSRLS administrative role'
      using errcode = '42501';
  end if;
end;
$$;

create schema if not exists advisory_private;
revoke all on schema advisory_private from public;
grant usage on schema advisory_private to authenticated, anon;

create table public.advisory_cases (
  id uuid primary key default gen_random_uuid(),
  client_safe_title text not null check (length(client_safe_title) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

-- Assignment comes from the future trusted administrative workflow, never JWT
-- user_metadata or an org/case ID supplied by the model.
create table public.advisory_case_staff (
  case_id uuid not null references public.advisory_cases(id),
  user_id uuid not null references auth.users(id),
  staff_role text not null check (staff_role in ('analyst','reviewer','publisher','admin')),
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  primary key (case_id, user_id, staff_role)
);

create table public.advisory_case_clients (
  case_id uuid not null references public.advisory_cases(id),
  user_id uuid not null references auth.users(id),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (case_id, user_id)
);

create table public.advisory_reports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.advisory_cases(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, case_id)
);

-- content is the CLIENT-SAFE report only. Keep prompts, internal notes, secrets,
-- recovery locations and private reviewer notes out of this table and assets.
create table public.advisory_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  case_id uuid not null,
  version_number integer not null check (version_number > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_sha256 text not null default '' check (length(content_sha256) = 64),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (report_id, case_id) references public.advisory_reports(id, case_id),
  unique (report_id, version_number),
  unique (id, case_id)
);

create table public.advisory_report_assets (
  id uuid primary key default gen_random_uuid(),
  report_version_id uuid not null,
  case_id uuid not null,
  bucket_id text not null default 'capital-web3-advisory'
    check (bucket_id = 'capital-web3-advisory'),
  object_name text not null check (
    length(object_name) between 1 and 500 and
    object_name !~ '(^/|(^|/)\.\.(/|$))'
  ),
  bytes_sha256 text not null check (bytes_sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('application/pdf','application/json','text/plain')),
  created_at timestamptz not null default now(),
  foreign key (report_version_id, case_id)
    references public.advisory_report_versions(id, case_id),
  unique (bucket_id, object_name)
);

-- All workflow decisions are append-only and have NO authenticated write grants.
-- The future server must verify the human identity and populate actor IDs from
-- verified authentication, never from a caller/model supplied field.
create table public.advisory_human_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  report_version_id uuid not null unique,
  reviewer_user_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved','rejected')),
  reviewed_content_sha256 text not null check (reviewed_content_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_manifest_sha256 text not null check (reviewed_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  private_notes text not null default '' check (length(private_notes) <= 4000),
  reviewed_at timestamptz not null default now(),
  foreign key (report_version_id, case_id)
    references public.advisory_report_versions(id, case_id),
  unique (id, case_id, report_version_id)
);

create table public.advisory_publications (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  report_version_id uuid not null,
  human_review_id uuid not null,
  publisher_user_id uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  check (expires_at is null or expires_at > published_at),
  foreign key (human_review_id, case_id, report_version_id)
    references public.advisory_human_reviews(id, case_id, report_version_id),
  unique (id, case_id),
  unique (id, case_id, report_version_id)
);

create table public.advisory_publication_recipients (
  publication_id uuid not null,
  case_id uuid not null,
  user_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (publication_id, user_id),
  foreign key (publication_id, case_id)
    references public.advisory_publications(id, case_id),
  foreign key (case_id, user_id)
    references public.advisory_case_clients(case_id, user_id)
);

-- NULL recipient revokes the publication for everybody; non-NULL is targeted.
-- Revocation is never erased. A new release requires a new publication record.
create table public.advisory_publication_revocations (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
  case_id uuid not null,
  recipient_user_id uuid,
  revoked_by uuid not null references auth.users(id),
  reason text not null check (length(reason) between 1 and 1000),
  revoked_at timestamptz not null default now(),
  foreign key (publication_id, case_id)
    references public.advisory_publications(id, case_id),
  foreign key (case_id, recipient_user_id)
    references public.advisory_case_clients(case_id, user_id)
);

create table public.advisory_receipts (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
  case_id uuid not null,
  report_version_id uuid not null,
  user_id uuid not null references auth.users(id),
  received_at timestamptz not null default now(),
  foreign key (publication_id, case_id, report_version_id)
    references public.advisory_publications(id, case_id, report_version_id),
  unique (publication_id, user_id)
);

create table public.advisory_clarifications (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
  case_id uuid not null,
  report_version_id uuid not null,
  author_user_id uuid not null references auth.users(id),
  thread_client_user_id uuid not null references auth.users(id),
  entry_kind text not null check (entry_kind in ('client_question','staff_reply')),
  parent_id uuid,
  message text not null check (length(btrim(message)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (publication_id, case_id, report_version_id)
    references public.advisory_publications(id, case_id, report_version_id),
  unique (id, publication_id, case_id, report_version_id, thread_client_user_id),
  foreign key (parent_id, publication_id, case_id, report_version_id, thread_client_user_id)
    references public.advisory_clarifications(id, publication_id, case_id, report_version_id, thread_client_user_id),
  check (
    (entry_kind = 'client_question' and parent_id is null and thread_client_user_id = author_user_id) or
    (entry_kind = 'staff_reply' and parent_id is not null)
  )
);

create table public.advisory_audit_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.advisory_cases(id),
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_id uuid,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2000)
);

create index advisory_staff_lookup on public.advisory_case_staff(user_id, case_id) where active;
create index advisory_clients_lookup on public.advisory_case_clients(user_id, case_id) where active;
create index advisory_versions_case on public.advisory_report_versions(case_id, report_id);
create index advisory_publications_version on public.advisory_publications(report_version_id);
create index advisory_recipient_lookup on public.advisory_publication_recipients(user_id, publication_id);
create index advisory_revocation_lookup on public.advisory_publication_revocations(publication_id, recipient_user_id);
create index advisory_assets_version on public.advisory_report_assets(report_version_id);
create index advisory_clarification_publication on public.advisory_clarifications(publication_id);

-- Narrow authorization helpers are SECURITY DEFINER only to avoid recursive RLS
-- and to read authoritative assignment/revocation rows. Private schema, fixed
-- search_path, caller auth.uid(), no caller-provided user ID, no mutations.
create function advisory_private.is_assigned_staff(
  p_case uuid, p_roles text[] default array['analyst','reviewer','publisher','admin']::text[]
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
    and exists (
      select 1 from public.advisory_case_staff s
      where s.case_id = p_case and s.user_id = auth.uid()
        and s.active and s.staff_role = any(p_roles)
    );
$$;

create function advisory_private.can_receive_publication(p_publication uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
    and exists (
      select 1 from public.advisory_publications p
      join public.advisory_publication_recipients r
        on r.publication_id = p.id and r.case_id = p.case_id and r.user_id = auth.uid()
      join public.advisory_case_clients c
        on c.case_id = p.case_id and c.user_id = r.user_id and c.active
      where p.id = p_publication and p.published_at <= now()
        and (p.expires_at is null or p.expires_at > now())
        and not exists (
          select 1 from public.advisory_publication_revocations x
          where x.publication_id = p.id
            and (x.recipient_user_id is null or x.recipient_user_id = auth.uid())
        )
    );
$$;

create function advisory_private.can_read_version(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.advisory_report_versions v
    where v.id = p_version and (
      advisory_private.is_assigned_staff(v.case_id) or exists (
        select 1 from public.advisory_publications p
        where p.report_version_id = v.id and p.case_id = v.case_id
          and advisory_private.can_receive_publication(p.id)
      )
    )
  );
$$;

create function advisory_private.can_read_object(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_bucket = 'capital-web3-advisory' and exists (
    select 1 from public.advisory_report_assets a
    where a.bucket_id = p_bucket and a.object_name = p_name
      and advisory_private.can_read_version(a.report_version_id)
  );
$$;

create function advisory_private.reject_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'append-only record: create a new record or revocation' using errcode = '23514';
end;
$$;

create function advisory_private.submission_time()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'advisory_receipts' then new.received_at := now();
  else new.created_at := now(); end if;
  return new;
end;
$$;

create function advisory_private.protect_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  if tg_op in ('UPDATE','DELETE') then
    if exists (select 1 from public.advisory_human_reviews r where r.report_version_id = old.id) then
      raise exception 'reviewed report version is immutable' using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if new.id <> old.id or new.case_id <> old.case_id or new.report_id <> old.report_id
      or new.version_number <> old.version_number or new.created_by <> old.created_by
      or new.created_at <> old.created_at then
      raise exception 'version identity is immutable' using errcode = '23514';
    end if;
  end if;
  if not exists (
    select 1 from public.advisory_case_staff s where s.case_id = new.case_id
      and s.user_id = new.created_by and s.active and s.staff_role in ('analyst','admin')
  ) then
    raise exception 'report author must be an active assigned analyst' using errcode = '23514';
  end if;
  -- PostgreSQL computes this; a model/caller cannot assert an arbitrary digest.
  new.content_sha256 := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(new.content::text, 'UTF8')), 'hex');
  return new;
end;
$$;

create function advisory_private.protect_asset_manifest()
returns trigger language plpgsql security definer set search_path = '' as $$
declare version_id uuid;
begin
  version_id := case when tg_op = 'DELETE' then old.report_version_id else new.report_version_id end;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.report_version_id <> old.report_version_id
    or new.case_id <> old.case_id) then
    raise exception 'asset version identity is immutable' using errcode = '23514';
  end if;
  -- Same row lock as review creation prevents review/manifest write races.
  perform 1 from public.advisory_report_versions v where v.id = version_id for update;
  if exists (select 1 from public.advisory_human_reviews r where r.report_version_id = version_id) then
    raise exception 'reviewed asset manifest is immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Internal digest only; no authenticated EXECUTE grant and no exposed RPC.
-- A human must confirm the package they saw, not a hash recomputed by the
-- publisher on their behalf. Empty manifests bind the canonical [] value.
create function advisory_private.manifest_sha256(p_version uuid)
returns text language sql stable security definer set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'bucket_id', a.bucket_id, 'object_name', a.object_name,
      'bytes_sha256', a.bytes_sha256, 'mime_type', a.mime_type
    ) order by a.id), '[]'::jsonb)::text, 'UTF8')), 'hex')
  from public.advisory_report_assets a where a.report_version_id = p_version;
$$;

create function advisory_private.validate_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.advisory_report_versions%rowtype;
begin
  select * into strict v from public.advisory_report_versions
    where id = new.report_version_id and case_id = new.case_id for update;
  if v.created_by = new.reviewer_user_id then
    raise exception 'author cannot approve their own report' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.advisory_case_staff s where s.case_id = new.case_id
      and s.user_id = new.reviewer_user_id and s.active and s.staff_role in ('reviewer','admin')
  ) then
    raise exception 'reviewer must be actively assigned to this case' using errcode = '23514';
  end if;
  if new.reviewed_content_sha256 <> v.content_sha256 then
    raise exception 'review must bind the exact current report digest' using errcode = '23514';
  end if;
  if new.reviewed_manifest_sha256 <> advisory_private.manifest_sha256(new.report_version_id) then
    raise exception 'review must bind the exact current asset manifest digest' using errcode = '23514';
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;

create function advisory_private.validate_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.advisory_human_reviews r
    where r.id = new.human_review_id and r.case_id = new.case_id
      and r.report_version_id = new.report_version_id and r.decision = 'approved'
  ) then
    raise exception 'publication requires approval of the exact report version' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.advisory_case_staff s where s.case_id = new.case_id
      and s.user_id = new.publisher_user_id and s.active and s.staff_role in ('publisher','admin')
  ) then
    raise exception 'publisher must be actively assigned to this case' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function advisory_private.validate_recipient_or_revocation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'advisory_publication_recipients' then
    if not exists (
      select 1 from public.advisory_case_clients c where c.case_id = new.case_id
        and c.user_id = new.user_id and c.active
    ) then
      raise exception 'recipient must be an active client of this case' using errcode = '23514';
    end if;
  elsif not exists (
    select 1 from public.advisory_case_staff s where s.case_id = new.case_id
      and s.user_id = new.revoked_by and s.active and s.staff_role in ('publisher','admin')
  ) then
    raise exception 'revocation actor must be an assigned publisher' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function advisory_private.audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare data jsonb; actor uuid;
begin
  data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor := coalesce(auth.uid(), (data->>'reviewer_user_id')::uuid,
    (data->>'publisher_user_id')::uuid, (data->>'revoked_by')::uuid,
    (data->>'author_user_id')::uuid, (data->>'created_by')::uuid);
  insert into public.advisory_audit_events(case_id, actor_user_id, action, entity_id, metadata)
  values (
    coalesce((data->>'case_id')::uuid,
      case when tg_table_name = 'advisory_cases' then (data->>'id')::uuid end),
    actor, tg_table_name || '.' || lower(tg_op), (data->>'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object('content_sha256', data->>'content_sha256',
      'reviewed_content_sha256', data->>'reviewed_content_sha256',
      'reviewed_manifest_sha256', data->>'reviewed_manifest_sha256',
      'report_version_id', data->>'report_version_id', 'publication_id', data->>'publication_id',
      'subject_user_id', data->>'user_id', 'staff_role', data->>'staff_role', 'active', data->'active'))
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger version_guard before insert or update or delete on public.advisory_report_versions
  for each row execute function advisory_private.protect_version();
create trigger asset_manifest_guard before insert or update or delete on public.advisory_report_assets
  for each row execute function advisory_private.protect_asset_manifest();
create trigger review_gate before insert on public.advisory_human_reviews
  for each row execute function advisory_private.validate_review();
create trigger publication_gate before insert on public.advisory_publications
  for each row execute function advisory_private.validate_publication();
create trigger recipient_gate before insert on public.advisory_publication_recipients
  for each row execute function advisory_private.validate_recipient_or_revocation();
create trigger revocation_gate before insert on public.advisory_publication_revocations
  for each row execute function advisory_private.validate_recipient_or_revocation();
create trigger receipt_server_time before insert on public.advisory_receipts
  for each row execute function advisory_private.submission_time();
create trigger clarification_server_time before insert on public.advisory_clarifications
  for each row execute function advisory_private.submission_time();

do $$
declare t text;
begin
  foreach t in array array['advisory_cases','advisory_case_staff','advisory_case_clients',
    'advisory_reports','advisory_report_versions','advisory_report_assets',
    'advisory_human_reviews','advisory_publications','advisory_publication_recipients',
    'advisory_publication_revocations','advisory_receipts','advisory_clarifications'] loop
    execute format('create trigger audit_changes after insert or update or delete on public.%I
      for each row execute function advisory_private.audit_change()', t);
  end loop;
  foreach t in array array['advisory_reports','advisory_human_reviews','advisory_publications',
    'advisory_publication_recipients','advisory_publication_revocations',
    'advisory_receipts','advisory_clarifications','advisory_audit_events'] loop
    execute format('create trigger append_only before update or delete on public.%I
      for each row execute function advisory_private.reject_mutation()', t);
  end loop;
  foreach t in array array['advisory_cases','advisory_case_staff','advisory_case_clients',
    'advisory_reports','advisory_report_versions','advisory_report_assets',
    'advisory_human_reviews','advisory_publications','advisory_publication_recipients',
    'advisory_publication_revocations','advisory_receipts','advisory_clarifications','advisory_audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

revoke all on all functions in schema advisory_private from public, anon, authenticated;
grant execute on function advisory_private.is_assigned_staff(uuid,text[]) to authenticated;
grant execute on function advisory_private.can_receive_publication(uuid) to authenticated;
grant execute on function advisory_private.can_read_version(uuid) to authenticated;
grant execute on function advisory_private.can_read_object(text,text) to anon, authenticated;
alter default privileges in schema advisory_private revoke execute on functions from public;

create policy staff_assignment_self on public.advisory_case_staff for select to authenticated
  using (user_id = (select auth.uid()) and active
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy client_membership_self_or_staff on public.advisory_case_clients for select to authenticated
  using ((user_id = (select auth.uid()) and active
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false)
    or advisory_private.is_assigned_staff(case_id));
create policy case_read on public.advisory_cases for select to authenticated using (
  advisory_private.is_assigned_staff(id) or exists (
    select 1 from public.advisory_publications p
    where p.case_id = advisory_cases.id and advisory_private.can_receive_publication(p.id)
  )
);
create policy report_read on public.advisory_reports for select to authenticated using (
  advisory_private.is_assigned_staff(case_id) or exists (
    select 1 from public.advisory_report_versions v
    where v.report_id = advisory_reports.id and advisory_private.can_read_version(v.id)
  )
);
create policy version_read on public.advisory_report_versions for select to authenticated
  using (advisory_private.can_read_version(id));
create policy asset_read on public.advisory_report_assets for select to authenticated
  using (advisory_private.can_read_version(report_version_id));
create policy review_staff_read on public.advisory_human_reviews for select to authenticated
  using (advisory_private.is_assigned_staff(case_id));
create policy publication_read on public.advisory_publications for select to authenticated
  using (advisory_private.is_assigned_staff(case_id) or advisory_private.can_receive_publication(id));
create policy recipient_read on public.advisory_publication_recipients for select to authenticated
  using (advisory_private.is_assigned_staff(case_id) or
    (user_id = (select auth.uid()) and advisory_private.can_receive_publication(publication_id)));
create policy revocation_staff_read on public.advisory_publication_revocations for select to authenticated
  using (advisory_private.is_assigned_staff(case_id));
create policy receipt_read on public.advisory_receipts for select to authenticated
  using (advisory_private.is_assigned_staff(case_id) or
    (user_id = (select auth.uid()) and advisory_private.can_receive_publication(publication_id)));
create policy clarification_read on public.advisory_clarifications for select to authenticated
  using (advisory_private.is_assigned_staff(case_id) or
    (thread_client_user_id = (select auth.uid()) and
      advisory_private.can_receive_publication(publication_id)));
create policy audit_staff_read on public.advisory_audit_events for select to authenticated
  using (advisory_private.is_assigned_staff(case_id));

grant insert on public.advisory_reports, public.advisory_report_versions,
  public.advisory_receipts, public.advisory_clarifications to authenticated;
grant update (content) on public.advisory_report_versions to authenticated;
create policy report_draft_create on public.advisory_reports for insert to authenticated
  with check (created_by = (select auth.uid()) and
    advisory_private.is_assigned_staff(case_id, array['analyst','admin']));
create policy version_draft_create on public.advisory_report_versions for insert to authenticated
  with check (created_by = (select auth.uid()) and
    advisory_private.is_assigned_staff(case_id, array['analyst','admin']));
create policy version_draft_update on public.advisory_report_versions for update to authenticated
  using (created_by = (select auth.uid()) and
    advisory_private.is_assigned_staff(case_id, array['analyst','admin']))
  with check (created_by = (select auth.uid()) and
    advisory_private.is_assigned_staff(case_id, array['analyst','admin']));
create policy client_receipt_create on public.advisory_receipts for insert to authenticated
  with check (user_id = (select auth.uid()) and
    advisory_private.can_receive_publication(publication_id));
create policy clarification_create on public.advisory_clarifications for insert to authenticated
  with check (author_user_id = (select auth.uid()) and (
    (entry_kind = 'client_question' and advisory_private.can_receive_publication(publication_id)) or
    (entry_kind = 'staff_reply' and advisory_private.is_assigned_staff(case_id))
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capital-web3-advisory','capital-web3-advisory',false,10485760,
  array['application/pdf','application/json','text/plain'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from storage.buckets
    where id = 'capital-web3-advisory' and public = false) then
    raise exception 'advisory storage bucket must be private';
  end if;
end $$;

-- Exact object reference, never a prefix or path containing a caller user ID.
-- RESTRICTIVE protection prevents unrelated broad permissive policies from
-- accidentally granting access to this bucket. Other buckets are unaffected.
create policy advisory_object_read on storage.objects for select to authenticated
  using (bucket_id = 'capital-web3-advisory' and
    advisory_private.can_read_object(bucket_id, name));
create policy advisory_object_read_boundary on storage.objects as restrictive
  for select to public using (bucket_id <> 'capital-web3-advisory' or
    advisory_private.can_read_object(bucket_id, name));
create policy advisory_object_no_client_insert on storage.objects as restrictive
  for insert to public with check (bucket_id <> 'capital-web3-advisory');
create policy advisory_object_no_client_update on storage.objects as restrictive
  for update to public using (bucket_id <> 'capital-web3-advisory')
    with check (bucket_id <> 'capital-web3-advisory');
create policy advisory_object_no_client_delete on storage.objects as restrictive
  for delete to public using (bucket_id <> 'capital-web3-advisory');

comment on schema advisory_private is
  'Internal RLS/trigger helpers. MUST NOT be included in Supabase exposed schemas.';
comment on table public.advisory_human_reviews is
  'Backend-only human workflow. No client insert/update/delete grants or approval RPC.';
comment on table public.advisory_receipts is
  'Acknowledgement of receipt only; not approval, consent to trade, or financial suitability.';
comment on table public.advisory_report_assets is
  'Manifest is frozen at review. Byte hashes must be verified by server; blobs write-once, no upsert.';

commit;
