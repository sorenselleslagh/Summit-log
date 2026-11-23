-- Photos and logs for a Fontainebleau problem.
-- Apply in the Supabase SQL editor. Do not apply this from the app.
-- A person can write only their own rows. Others can read a photo or a
-- log when neither person has blocked the other, and the owner's profile
-- is public or the two people are accepted partners. Authorization uses
-- auth.uid(), never user_metadata.

create or replace function private.shares_with_viewer(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    auth.uid() = owner
    or (
      not private.users_are_blocked(auth.uid(), owner)
      and (
        private.avatar_is_public(owner::text)
        or exists (
          select 1 from public.partner_connections pc
          where pc.status = 'accepted'
            and (
              (pc.requester_id = auth.uid() and pc.addressee_id = owner)
              or (pc.addressee_id = auth.uid() and pc.requester_id = owner)
            )
        )
      )
    )
  );
$$;

revoke all on function private.shares_with_viewer(uuid) from public;
grant execute on function private.shares_with_viewer(uuid) to authenticated;

create table public.problem_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  problem_id text not null check (problem_id ~ '^[0-9]{1,12}$'),
  climbed_on date,
  created_at timestamptz not null default now(),
  unique (user_id, problem_id)
);

alter table public.problem_logs enable row level security;
grant select, insert, update, delete on public.problem_logs to authenticated;

create policy problem_logs_select on public.problem_logs
  for select to authenticated
  using (private.shares_with_viewer(user_id));

create policy problem_logs_insert on public.problem_logs
  for insert to authenticated
  with check (user_id = auth.uid());

create policy problem_logs_update on public.problem_logs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy problem_logs_delete on public.problem_logs
  for delete to authenticated
  using (user_id = auth.uid());

create table public.problem_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  problem_id text not null check (problem_id ~ '^[0-9]{1,12}$'),
  path text not null check (path <> ''),
  created_at timestamptz not null default now()
);

alter table public.problem_photos enable row level security;
grant select, insert, delete on public.problem_photos to authenticated;

create policy problem_photos_select on public.problem_photos
  for select to authenticated
  using (private.shares_with_viewer(user_id));

create policy problem_photos_insert on public.problem_photos
  for insert to authenticated
  with check (user_id = auth.uid() and path like auth.uid()::text || '/%');

create policy problem_photos_delete on public.problem_photos
  for delete to authenticated
  using (user_id = auth.uid());

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('problem-photos', 'problem-photos', false)
    on conflict (id) do nothing;
  end if;
  if to_regclass('storage.objects') is null then
    return;
  end if;
  begin
    execute $policy$
      create policy problem_photos_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'problem-photos'
        and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and private.shares_with_viewer(((storage.foldername(name))[1])::uuid)
      )
    $policy$;
  exception when duplicate_object then null;
  end;
  begin
    execute $policy$
      create policy problem_photos_owner_write on storage.objects
      for all to authenticated
      using (
        bucket_id = 'problem-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'problem-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;
  exception when duplicate_object then null;
  end;
end;
$$;
