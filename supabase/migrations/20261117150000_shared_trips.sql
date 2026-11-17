-- Shared trips and cards sent into a chat.
-- Apply after 20261117140000_climb_requests.sql.
-- Do not apply this from the app. Run it in the Supabase SQL editor.
-- An accepted climb request stays on the message. Both people in the
-- conversation can update its checklist. A share message is a peak,
-- route, or logbook card and is not edited after it is sent.

alter table public.messages drop constraint if exists messages_kind_check;

alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'date_proposal', 'gear_checklist', 'system', 'climb_request', 'share'));

create or replace function public.protect_message_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.kind is distinct from new.kind then
    raise exception 'messages are not editable';
  end if;
  if old.kind not in ('date_proposal', 'climb_request') then
    raise exception 'messages are not editable';
  end if;
  if new.body is distinct from old.body
    or new.sender_id is distinct from old.sender_id
    or new.conversation_id is distinct from old.conversation_id
    or new.client_id is distinct from old.client_id
    or new.created_at is distinct from old.created_at then
    raise exception 'message fields are locked';
  end if;
  if old.kind = 'date_proposal' then
    if coalesce(new.payload->>'label', '') is distinct from coalesce(old.payload->>'label', '') then
      raise exception 'date label is locked';
    end if;
    if coalesce(new.payload->>'status', '') not in ('pending', 'accepted', 'declined') then
      raise exception 'date status is invalid';
    end if;
  end if;
  if old.kind = 'climb_request' then
    if coalesce(new.payload->>'name', '') is distinct from coalesce(old.payload->>'name', '') then
      raise exception 'climb name is locked';
    end if;
    if coalesce(new.payload->>'route', '') is distinct from coalesce(old.payload->>'route', '') then
      raise exception 'climb route is locked';
    end if;
    if coalesce(new.payload->>'status', '') not in ('pending', 'accepted', 'declined', 'suggested') then
      raise exception 'climb status is invalid';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_message_edit() from public, anon, authenticated;
