-- Profile photo path on profiles. Apply after 20261117100000_partner_connections.sql.
-- Do not apply this from the app. Run it in the Supabase SQL editor.
-- The photo file lives in the avatars bucket at <user id>/avatar-<timestamp>.jpg.
-- Only that user can write their folder. Reads stay public when the profile is not private.

alter table public.profiles
  add column if not exists avatar_path text not null default '';

alter table public.profiles
  drop constraint if exists profiles_avatar_len;

alter table public.profiles
  add constraint profiles_avatar_len check (char_length(avatar_path) <= 200);

comment on column public.profiles.avatar_path is
  'Path in the avatars bucket: <user id>/avatar-<timestamp>.jpg. Empty when there is no photo.';

-- search_profiles used to read profile_details.avatar_path. Hosted profiles
-- did not have this column, so the name search now reads profiles.avatar_path.
create or replace function public.search_profiles(query text)
returns table (id uuid, full_name text, avatar_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    case
      when btrim(coalesce(p.first_name, '')) <> '' and btrim(coalesce(p.last_name, '')) <> ''
        then left(btrim(p.first_name || ' ' || p.last_name), 80)
      else left(btrim(coalesce(p.display_name, '')), 80)
    end as full_name,
    coalesce(p.avatar_path, '') as avatar_path
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and char_length(btrim(coalesce(query, ''))) >= 2
    and (
      public.objective_key(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
        like '%' || public.objective_key(query) || '%'
      or public.objective_key(coalesce(p.display_name, ''))
        like '%' || public.objective_key(query) || '%'
    )
  order by full_name
  limit 20;
$$;

revoke all on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;

-- Owner writes only inside their own folder. Anyone can read a photo unless
-- that profile is marked private.
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
    values ('avatars', 'avatars', true)
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
end $$;
