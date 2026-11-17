-- Mutual partner connections. Apply in the Supabase SQL editor after
-- 20261110210000_profile_names.sql. Do not apply this from the app.
-- A connection is a request plus an accept. It is not a follow, and it
-- stores no counts. Authorization uses auth.uid() and this table.

create table public.partner_connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_connections_not_self check (requester_id <> addressee_id)
);

-- One live pair no matter who asked first. A declined row can stay, and a
-- later request is a new row.
create unique index partner_connections_live_pair
  on public.partner_connections (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where status in ('pending', 'accepted');

create index partner_connections_addressee
  on public.partner_connections (addressee_id, status, created_at desc);

alter table public.partner_connections enable row level security;

grant select, insert, update, delete on public.partner_connections to authenticated;

create policy partner_connections_select on public.partner_connections
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy partner_connections_insert on public.partner_connections
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and addressee_id <> auth.uid()
    and status = 'pending'
    and not private.users_are_blocked(requester_id, addressee_id)
  );

create policy partner_connections_update on public.partner_connections
  for update to authenticated
  using (addressee_id = auth.uid() and status = 'pending')
  with check (
    addressee_id = auth.uid()
    and requester_id is not distinct from requester_id
    and status in ('accepted', 'declined')
  );

create policy partner_connections_delete on public.partner_connections
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create or replace function public.protect_partner_connection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.requester_id is distinct from old.requester_id
    or new.addressee_id is distinct from old.addressee_id
    or new.created_at is distinct from old.created_at then
    raise exception 'connection row is protected';
  end if;
  if old.status is distinct from 'pending' then
    raise exception 'already answered';
  end if;
  if new.status not in ('accepted', 'declined') then
    raise exception 'not allowed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists partner_connections_protect on public.partner_connections;
create trigger partner_connections_protect
  before update on public.partner_connections
  for each row execute function public.protect_partner_connection();

revoke all on function public.protect_partner_connection() from public, anon, authenticated;

-- Name search for signed-in people. Returns id, full name, and avatar path only.
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
    coalesce(d.avatar_path, '') as avatar_path
  from public.profiles p
  left join public.profile_details d on d.profile_id = p.id
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

-- A direct chat between two accepted partners. Plan requests keep their own path.
alter table public.conversations drop constraint if exists conversations_shape;
alter table public.conversations add constraint conversations_shape check (
  type = 'direct'
  or (type = 'team' and request_id is null)
);

create or replace function public.open_partner_chat(other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing uuid;
begin
  if me is null or other_id is null or other_id = me then
    raise exception 'not allowed';
  end if;
  if not exists (
    select 1 from public.partner_connections pc
    where pc.status = 'accepted'
      and (
        (pc.requester_id = me and pc.addressee_id = other_id)
        or (pc.requester_id = other_id and pc.addressee_id = me)
      )
  ) then
    raise exception 'not partners';
  end if;
  if private.users_are_blocked(me, other_id) then
    raise exception 'not allowed';
  end if;
  select c.id into existing
  from public.conversations c
  where c.type = 'direct'
    and private.is_conversation_member(c.id, true)
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = c.id and m.user_id = other_id and m.left_at is null
    )
  order by c.updated_at desc
  limit 1;
  if existing is not null then
    return existing;
  end if;
  insert into public.conversations (type, objective_name, created_by)
  values ('direct', '', me)
  returning id into existing;
  insert into public.conversation_members (conversation_id, user_id, role)
  values (existing, me, 'owner'), (existing, other_id, 'member');
  return existing;
end;
$$;

revoke all on function public.open_partner_chat(uuid) from public, anon;
grant execute on function public.open_partner_chat(uuid) to authenticated;

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and private.is_conversation_member(conversation_id, true)
    and not exists (
      select 1 from public.conversation_members other
      where other.conversation_id = messages.conversation_id
        and other.user_id <> auth.uid()
        and private.users_are_blocked(auth.uid(), other.user_id)
    )
    and (
      exists (
        select 1 from public.conversations c
        join public.partner_requests r on r.id = c.request_id
        where c.id = messages.conversation_id
          and c.type = 'direct'
          and r.status = 'accepted'
      )
      or exists (
        select 1 from public.conversations c
        join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
        join public.conversation_members them on them.conversation_id = c.id and them.user_id <> auth.uid()
        join public.partner_connections pc on pc.status = 'accepted'
          and (
            (pc.requester_id = auth.uid() and pc.addressee_id = them.user_id)
            or (pc.addressee_id = auth.uid() and pc.requester_id = them.user_id)
          )
        where c.id = messages.conversation_id
          and c.type = 'direct'
      )
      or exists (
        select 1 from public.conversations c
        where c.id = messages.conversation_id
          and c.type = 'team'
      )
    )
  );
