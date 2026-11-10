-- First and last name on the profile. Apply after 20261110200000_message_push.sql.
-- Do not apply this from the app. Run it in the Supabase SQL editor.
-- Email is not a column here. It stays in auth.users, so other climbers cannot read it.
-- The sign-up payload is only a hint the trigger copies once. Access checks use this table and auth.uid().

alter table public.profiles
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '';

alter table public.profiles
  drop constraint if exists profiles_first_len;

alter table public.profiles
  drop constraint if exists profiles_last_len;

alter table public.profiles
  add constraint profiles_first_len check (char_length(first_name) <= 40);

alter table public.profiles
  add constraint profiles_last_len check (char_length(last_name) <= 40);

comment on column public.profiles.first_name is
  'Given name. The owner writes it. Other accounts can read the name.';

comment on column public.profiles.last_name is
  'Family name. The owner writes it. Other accounts can read the name.';

-- A display name of "Ada Lovelace" becomes first Ada and last Lovelace.
-- A single word is left alone so the app can ask for the missing part.
update public.profiles
set
  first_name = left(split_part(btrim(display_name), ' ', 1), 40),
  last_name = left(btrim(regexp_replace(btrim(display_name), '^\S+\s+', '')), 40)
where first_name = ''
  and last_name = ''
  and position(' ' in btrim(display_name)) > 0;

update public.profiles
set display_name = left(btrim(first_name || ' ' || last_name), 80)
where btrim(first_name) <> ''
  and btrim(last_name) <> ''
  and display_name is distinct from left(btrim(first_name || ' ' || last_name), 80);

-- Owner updates their own row, including the new name columns.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  given text := left(btrim(coalesce(meta->>'first_name', meta->>'given_name', '')), 40);
  family text := left(btrim(coalesce(meta->>'last_name', meta->>'family_name', '')), 40);
  whole text := left(btrim(coalesce(meta->>'full_name', meta->>'name', meta->>'display_name', '')), 80);
begin
  if (given = '' or family = '') and strpos(whole, ' ') > 0 then
    if given = '' then
      given := left(split_part(whole, ' ', 1), 40);
    end if;
    if family = '' then
      family := left(btrim(substr(whole, length(split_part(whole, ' ', 1)) + 1)), 40);
    end if;
  end if;
  if whole = '' and (given <> '' or family <> '') then
    whole := left(btrim(given || ' ' || family), 80);
  end if;
  if whole = '' then
    whole := left(split_part(coalesce(new.email, ''), '@', 1), 80);
  end if;
  insert into public.profiles (id, display_name, first_name, last_name)
  values (new.id, coalesce(whole, ''), coalesce(given, ''), coalesce(family, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
