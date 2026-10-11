-- DISPOSABLE CI ONLY. Deliberately colliding legacy names from another app.
-- Never provision these fixtures in a hosted/shared project.
create schema advisory_private;
create table advisory_private.neighbor_sentinel(id integer primary key);
insert into advisory_private.neighbor_sentinel values (73);
create table public.advisory_cases(id uuid primary key, client_safe_title text);
insert into public.advisory_cases values
 ('a0000000-0000-0000-0000-000000000001','Synthetic unrelated application');
alter table public.advisory_cases enable row level security;
grant select on public.advisory_cases to anon, authenticated;
create policy neighbor_public_read on public.advisory_cases for select using (true);
create function public.advisory_neighbor() returns integer language sql as $$ select 73 $$;
insert into storage.buckets(id,name,public) values ('neighbor-fixture','neighbor-fixture',false);
insert into storage.objects(bucket_id,name) values ('neighbor-fixture','untouched.txt');
create policy neighbor_object_read on storage.objects for select to authenticated
 using (bucket_id='neighbor-fixture');
