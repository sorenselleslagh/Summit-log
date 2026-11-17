-- Climb request cards inside an existing conversation.
-- Apply after 20261117130000_profile_avatar_path.sql.
-- Do not apply this from the app. Run it in the Supabase SQL editor.
-- The two people in the conversation can read the message. Either can
-- accept, decline, or suggest another date. Authorization uses auth.uid().

alter table public.messages drop constraint if exists messages_kind_check;

alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'date_proposal', 'gear_checklist', 'system', 'climb_request'));

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
    if coalesce(new.payload->>'status', '') not in ('pending', 'accepted', 'declined', 'suggested') then
      raise exception 'climb status is invalid';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_message_edit() from public, anon, authenticated;

drop policy if exists messages_update_climb on public.messages;
create policy messages_update_climb on public.messages
  for update to authenticated
  using (kind = 'climb_request' and private.is_conversation_member(conversation_id, true))
  with check (kind = 'climb_request' and private.is_conversation_member(conversation_id, true));
