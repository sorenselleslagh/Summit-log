-- SummitLog accounts, shared plans, and partner chat.
-- Apply this in the Supabase SQL editor, or with `supabase db push`.
-- The browser uses only the anon key. Do not put the service_role key in the client.
--
-- Private plan notes and preparation checklists are not columns on plan_shares.
-- They live only in account_records, which the owner alone can read.
-- Team chats use conversations.type = 'team' and extra conversation_members.
-- Clients cannot insert conversations; a direct chat is created only when the
-- recipient accepts a partner request.

create extension if not exists pgcrypto;
create schema if not exists private;

do $$
begin
  create extension if not exists unaccent;
exception when others then
  raise notice 'unaccent unavailable: %', sqlerrm;
end $$;

create or replace function public.objective_key(value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  raw text := coalesce(value, '');
begin
  begin
    raw := unaccent(raw);
  exception when undefined_function then
    raw := translate(raw,
      'ÀÁÂÄÃÅàáâäãåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÖÕòóôöõÙÚÛÜùúûüÝŸýÿÑñÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYYyyNnCc');
  end;
  return trim(both ' ' from regexp_replace(lower(raw), '[^a-z0-9]+', ' ', 'g'));
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  region_label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_len check (char_length(display_name) <= 80),
  constraint profiles_region_len check (char_length(region_label) <= 80)
);

comment on column public.profiles.region_label is
  'Approximate place name only, such as Chamonix. Never a coordinate.';

create table public.account_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('item', 'membership', 'level')),
  local_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  unique (owner_id, kind, local_id)
);

comment on table public.account_records is
  'Full device records for the owner, including private notes. Other accounts cannot read this table.';

create table public.plan_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  local_id uuid not null,
  name text not null,
  name_key text not null default '',
  kind text not null check (kind in ('peak', 'route', 'hike')),
  route_name text not null default '',
  route_grade text not null default '',
  stage text not null default 'idea' check (stage in ('idea', 'objective', 'scheduled')),
  visibility text not null default 'private' check (visibility in ('private', 'people', 'community')),
  looking_for_partner boolean not null default false,
  timeframe text not null default '',
  fixed_date date,
  season text not null default '' check (season in ('', 'winter', 'spring', 'summer', 'autumn')),
  share_note text not null default '',
  elevation numeric,
  status text not null default 'planned' check (status in ('planned', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, local_id),
  constraint plan_shares_name_len check (char_length(name) <= 200),
  constraint plan_shares_note_len check (char_length(share_note) <= 500)
);

comment on table public.plan_shares is
  'Shareable plan fields only. Private notes and checklists are intentionally absent.';

create table public.partner_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.plan_shares (id) on delete set null,
  objective_name text not null,
  route_name text not null default '',
  dates text not null default '',
  stage text not null default '',
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint partner_requests_not_self check (from_user <> to_user),
  constraint partner_requests_name_len check (char_length(objective_name) <= 200),
  constraint partner_requests_note_len check (char_length(note) <= 400)
);

create unique index partner_requests_one_pending
  on public.partner_requests (from_user, to_user, lower(objective_name))
  where status = 'pending';

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'team')),
  plan_id uuid references public.plan_shares (id) on delete set null,
  request_id uuid unique references public.partner_requests (id) on delete set null,
  objective_name text not null default '',
  route_name text not null default '',
  dates text not null default '',
  stage text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_shape check (
    (type = 'direct' and request_id is not null)
    or (type = 'team' and request_id is null)
  )
);

comment on table public.conversations is
  'direct is 1:1 after an accepted request. team is reserved for a later group on one plan.';

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'owner')),
  muted_until timestamptz,
  last_read_at timestamptz,
  left_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('text', 'date_proposal', 'gear_checklist', 'system')),
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  client_id uuid not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, client_id),
  constraint messages_body_len check (char_length(body) <= 4000),
  constraint messages_payload_len check (octet_length(payload::text) <= 8000)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint reports_reason_len check (char_length(reason) between 1 and 1000)
);

-- Kept for a later web-push worker. The client does not write here unless
-- pushEnabled is turned on, and a server (not the anon key) must hold VAPID keys.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index account_records_owner on public.account_records (owner_id, kind, updated_at desc);
create index plan_shares_owner on public.plan_shares (owner_id, updated_at desc);
create index plan_shares_queue on public.plan_shares (name_key) where visibility = 'community';
create index partner_requests_inbox on public.partner_requests (to_user, status, created_at desc);
create index partner_requests_outbox on public.partner_requests (from_user, status, created_at desc);
create index conversation_members_inbox on public.conversation_members (user_id, conversation_id) where left_at is null;
create index messages_by_conversation on public.messages (conversation_id, created_at desc);
create index conversations_plan on public.conversations (plan_id);
create index blocks_blocked on public.blocks (blocked_id);

create or replace function public.set_plan_name_key()
returns trigger
language plpgsql
as $$
begin
  new.name_key := public.objective_key(new.name);
  return new;
end;
$$;

create trigger plan_shares_name_key
  before insert or update of name on public.plan_shares
  for each row execute function public.set_plan_name_key();

create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation();

create or replace function public.protect_member_row()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.conversation_id is distinct from old.conversation_id
    or new.role is distinct from old.role
    or new.joined_at is distinct from old.joined_at then
    raise exception 'member row is protected';
  end if;
  if old.left_at is not null and new.left_at is null then
    raise exception 'already left';
  end if;
  return new;
end;
$$;

create trigger conversation_members_protect
  before update on public.conversation_members
  for each row execute function public.protect_member_row();

create or replace function public.protect_message_edit()
returns trigger
language plpgsql
as $$
begin
  if old.kind is distinct from 'date_proposal' or new.kind is distinct from 'date_proposal' then
    raise exception 'messages are not editable';
  end if;
  if new.body is distinct from old.body
    or new.sender_id is distinct from old.sender_id
    or new.conversation_id is distinct from old.conversation_id
    or new.client_id is distinct from old.client_id
    or new.created_at is distinct from old.created_at then
    raise exception 'message fields are locked';
  end if;
  if coalesce(new.payload->>'label', '') is distinct from coalesce(old.payload->>'label', '') then
    raise exception 'date label is locked';
  end if;
  if coalesce(new.payload->>'status', '') not in ('pending', 'accepted', 'declined') then
    raise exception 'date status is invalid';
  end if;
  return new;
end;
$$;

create trigger messages_protect_edit
  before update on public.messages
  for each row execute function public.protect_message_edit();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1), ''), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function private.is_conversation_member(conv uuid, active_only boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv
      and user_id = auth.uid()
      and (not active_only or left_at is null)
  );
$$;

create or replace function private.users_are_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
      or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function public.accept_partner_request(request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.partner_requests%rowtype;
  conv uuid;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  select * into req from public.partner_requests where id = request_id;
  if req.id is null or req.to_user is distinct from auth.uid() or req.status is distinct from 'pending' then
    raise exception 'not allowed';
  end if;
  if private.users_are_blocked(req.from_user, req.to_user) then
    raise exception 'blocked';
  end if;
  update public.partner_requests
    set status = 'accepted', responded_at = now(), updated_at = now()
    where id = req.id and status = 'pending' and to_user = auth.uid();
  if not found then
    raise exception 'not allowed';
  end if;
  insert into public.conversations (
    type, plan_id, request_id, objective_name, route_name, dates, stage, created_by
  ) values (
    'direct', req.plan_id, req.id, req.objective_name, req.route_name, req.dates, req.stage, auth.uid()
  ) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, role) values
    (conv, req.from_user, 'member'),
    (conv, req.to_user, 'member');
  return conv;
end;
$$;

create or replace function public.decline_partner_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  update public.partner_requests
    set status = 'declined', responded_at = now(), updated_at = now()
    where id = request_id and to_user = auth.uid() and status = 'pending';
  if not found then
    raise exception 'not allowed';
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.account_records enable row level security;
alter table public.plan_shares enable row level security;
alter table public.partner_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.push_subscriptions enable row level security;

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.account_records,
  public.plan_shares,
  public.partner_requests,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.blocks,
  public.reports,
  public.push_subscriptions
to authenticated;

revoke all on function public.objective_key(text) from public;
revoke all on function public.set_plan_name_key() from public;
revoke all on function public.touch_conversation() from public;
revoke all on function public.protect_member_row() from public;
revoke all on function public.protect_message_edit() from public;
revoke all on function public.handle_new_user() from public;
revoke all on function private.is_conversation_member(uuid, boolean) from public;
revoke all on function private.users_are_blocked(uuid, uuid) from public;
grant execute on function private.is_conversation_member(uuid, boolean) to authenticated;
grant execute on function private.users_are_blocked(uuid, uuid) to authenticated;
grant usage on schema private to authenticated;
grant execute on function public.objective_key(text) to authenticated;
revoke all on function public.accept_partner_request(uuid) from public;
revoke all on function public.decline_partner_request(uuid) from public;

grant execute on function public.accept_partner_request(uuid) to authenticated;
grant execute on function public.decline_partner_request(uuid) to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated using (true);

create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy records_owner on public.account_records
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy plans_owner on public.plan_shares
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy plans_read_shared on public.plan_shares
  for select to authenticated
  using (
    visibility = 'community'
    or (
      visibility = 'people'
      and exists (
        select 1 from public.conversations c
        where c.plan_id = plan_shares.id
          and private.is_conversation_member(c.id, true)
      )
    )
  );

create policy requests_select on public.partner_requests
  for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

create policy requests_insert on public.partner_requests
  for insert to authenticated
  with check (
    from_user = auth.uid()
    and to_user <> auth.uid()
    and status = 'pending'
    and not private.users_are_blocked(from_user, to_user)
  );

create policy requests_cancel on public.partner_requests
  for update to authenticated
  using (from_user = auth.uid() and status = 'pending')
  with check (from_user = auth.uid() and status = 'cancelled');

create policy requests_decline on public.partner_requests
  for update to authenticated
  using (to_user = auth.uid() and status = 'pending')
  with check (to_user = auth.uid() and status = 'declined');

create policy conversations_member_select on public.conversations
  for select to authenticated
  using (private.is_conversation_member(id, true));

create policy members_select on public.conversation_members
  for select to authenticated
  using (private.is_conversation_member(conversation_id, false));

create policy members_update_self on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy messages_select on public.messages
  for select to authenticated
  using (private.is_conversation_member(conversation_id, true));

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
        where c.id = messages.conversation_id
          and c.type = 'team'
      )
    )
  );

create policy messages_update_date on public.messages
  for update to authenticated
  using (kind = 'date_proposal' and private.is_conversation_member(conversation_id, true))
  with check (kind = 'date_proposal' and private.is_conversation_member(conversation_id, true));

create policy blocks_select on public.blocks
  for select to authenticated using (blocker_id = auth.uid());

create policy blocks_insert on public.blocks
  for insert to authenticated
  with check (blocker_id = auth.uid() and blocked_id <> auth.uid());

create policy blocks_delete on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

create policy reports_select on public.reports
  for select to authenticated using (reporter_id = auth.uid());

create policy reports_insert on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());

create policy push_owner on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.messages;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.partner_requests;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.conversation_members;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('log-photos', 'log-photos', false)
    on conflict (id) do nothing;
  end if;
  if to_regclass('storage.objects') is not null then
    begin
      execute $policy$
        create policy log_photos_owner on storage.objects
        for all to authenticated
        using (
          bucket_id = 'log-photos'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
        with check (
          bucket_id = 'log-photos'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
      $policy$;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
