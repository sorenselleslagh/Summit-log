-- Profile details, credential chips, and private proof files.
-- Apply after 20261110181000_harden_function_search_path.sql.
-- Do not edit the earlier migrations. Verified is never a status the
-- member can write: only review_credential, and only when the JWT
-- app_metadata.role is admin. user_metadata is ignored.

create table public.profile_details (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  bio text not null default '',
  home_base text not null default '',
  avatar_path text,
  is_private boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint profile_details_bio_len check (char_length(bio) <= 280),
  constraint profile_details_home_len check (char_length(home_base) <= 80)
);

comment on table public.profile_details is
  'Bio, home base, and avatar. Hidden from other accounts when is_private.';

create table public.credential_types (
  code text primary key,
  label text not null,
  detail text not null,
  group_name text not null
);

insert into public.credential_types (code, label, detail, group_name) values
  ('ifmga', 'IFMGA/UIAGM Mountain guide', 'A professional mountain guide qualification from the international guides association. It is not a ranking.', 'Guides'),
  ('uimla', 'UIMLA Mountain leader', 'An international mountain leader qualification for trekking and hill walking, not glacier guiding.', 'Guides'),
  ('aspirant', 'Aspirant guide', 'Training toward a guide qualification. It is not a finished guide licence.', 'Guides'),
  ('kvb1', 'KVB1', 'A club rock course, often the first course before leading.', 'Club courses'),
  ('kvb2', 'KVB2 lead', 'A club course on leading single-pitch rock climbs.', 'Club courses'),
  ('kvb3', 'KVB3 multipitch', 'A club course on multipitch rock climbs.', 'Club courses'),
  ('c1', 'C1 glacier course', 'An introductory course in glacier travel.', 'Club courses'),
  ('first_aid', 'First aid', 'A current first-aid certificate.', 'Care'),
  ('wfr', 'Wilderness First Responder', 'A wilderness medicine qualification.', 'Care'),
  ('avy', 'Avalanche course', 'An avalanche awareness or rescue course.', 'Care');

create table public.profile_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  code text not null references public.credential_types (code),
  status text not null check (status in ('self_declared', 'pending', 'verified', 'rejected')),
  declared_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  unique (profile_id, code)
);

comment on table public.profile_credentials is
  'Self-declared and pending are the member''s own words. Verified is set only by review_credential.';

create table public.credential_proofs (
  credential_id uuid primary key references public.profile_credentials (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

comment on table public.credential_proofs is
  'Certificate files. The owner and an admin can read the path. Other climbers cannot.';

create index profile_credentials_status on public.profile_credentials (status, declared_at desc);
create index credential_proofs_owner on public.credential_proofs (owner_id);

alter table public.profile_details enable row level security;
alter table public.profile_credentials enable row level security;
alter table public.credential_proofs enable row level security;

grant select on public.credential_types to authenticated;
grant select, insert, update, delete on public.profile_details to authenticated;
grant select, insert, update, delete on public.profile_credentials to authenticated;
grant select, insert, update, delete on public.credential_proofs to authenticated;

create policy details_read on public.profile_details
  for select to authenticated
  using (profile_id = auth.uid() or is_private = false);

create policy details_write on public.profile_details
  for insert to authenticated
  with check (profile_id = auth.uid());

create policy details_update on public.profile_details
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy details_delete on public.profile_details
  for delete to authenticated
  using (profile_id = auth.uid());

create or replace function public.guard_credential_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'verified' and coalesce(current_setting('summitlog.reviewing', true), '') is distinct from '1' then
    raise exception 'verified credentials are assigned by review';
  end if;
  if tg_op = 'UPDATE' and old.status = 'verified' and coalesce(current_setting('summitlog.reviewing', true), '') is distinct from '1' then
    raise exception 'a verified credential cannot be changed here';
  end if;
  if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id then
    raise exception 'profile is locked';
  end if;
  return new;
end;
$$;

create trigger profile_credentials_guard
  before insert or update on public.profile_credentials
  for each row execute function public.guard_credential_status();

create policy credentials_owner_select on public.profile_credentials
  for select to authenticated
  using (profile_id = auth.uid());

create policy credentials_public_select on public.profile_credentials
  for select to authenticated
  using (status in ('self_declared', 'verified'));

create policy credentials_admin_select on public.profile_credentials
  for select to authenticated
  using (
    coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'role',
      ''
    ) = 'admin'
  );

create policy credentials_insert on public.profile_credentials
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and status in ('self_declared', 'pending')
  );

create policy credentials_update on public.profile_credentials
  for update to authenticated
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and status in ('self_declared', 'pending', 'rejected')
  );

create policy credentials_delete on public.profile_credentials
  for delete to authenticated
  using (profile_id = auth.uid() and status is distinct from 'verified');

create policy proofs_owner on public.credential_proofs
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy proofs_admin_select on public.credential_proofs
  for select to authenticated
  using (
    coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'role',
      ''
    ) = 'admin'
  );

create or replace function public.review_credential(credential_id uuid, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  actor uuid := nullif(claims ->> 'sub', '')::uuid;
begin
  -- app_metadata only. A role stuffed into user_metadata does not count.
  if coalesce(claims -> 'app_metadata' ->> 'role', '') is distinct from 'admin' then
    raise exception 'not allowed';
  end if;
  if decision is distinct from 'verified' and decision is distinct from 'rejected' then
    raise exception 'decision';
  end if;
  perform set_config('summitlog.reviewing', '1', true);
  update public.profile_credentials
    set status = decision,
        reviewed_at = pg_catalog.now(),
        reviewed_by = actor
    where id = credential_id;
  if not found then
    raise exception 'not found';
  end if;
end;
$$;

revoke all on function public.guard_credential_status() from public, anon, authenticated;
revoke all on function public.review_credential(uuid, text) from public, anon;
grant execute on function public.review_credential(uuid, text) to authenticated;

alter function public.guard_credential_status() set search_path = '';
alter function public.review_credential(uuid, text) set search_path = '';

create or replace function private.avatar_is_public(account_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profile_details d
    where d.profile_id::text = account_id
      and d.is_private = true
  );
$$;

revoke all on function private.avatar_is_public(text) from public;
grant execute on function private.avatar_is_public(text) to anon, authenticated;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true), ('credential-proofs', 'credential-proofs', false)
    on conflict (id) do nothing;
  end if;
  if to_regclass('storage.objects') is null then
    return;
  end if;
  begin
    execute $policy$
      create policy avatars_read on storage.objects
      for select to authenticated, anon
      using (
        bucket_id = 'avatars'
        and (
          (storage.foldername(name))[1] = auth.uid()::text
          or private.avatar_is_public((storage.foldername(name))[1])
        )
      )
    $policy$;
  exception when duplicate_object then null;
  end;
  begin
    execute $policy$
      create policy avatars_owner_write on storage.objects
      for all to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;
  exception when duplicate_object then null;
  end;
  begin
    execute $policy$
      create policy proofs_owner_storage on storage.objects
      for all to authenticated
      using (
        bucket_id = 'credential-proofs'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'credential-proofs'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;
  exception when duplicate_object then null;
  end;
  begin
    execute $policy$
      create policy proofs_admin_storage on storage.objects
      for select to authenticated
      using (
        bucket_id = 'credential-proofs'
        and coalesce(
          nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'role',
          ''
        ) = 'admin'
      )
    $policy$;
  exception when duplicate_object then null;
  end;
end $$;
