-- Harden functions flagged by the Supabase security advisors.
-- Apply this in the SQL editor after 20261110180000_accounts_and_chat.sql.
-- Do not edit that earlier file: it has already been applied.
--
-- accept_partner_request and decline_partner_request are unchanged apart from
-- search_path. Both still reject the call when auth.uid() is null, and accept
-- only when auth.uid() is the request's recipient.

create schema if not exists extensions;

do $$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'unaccent';
  if ext_schema is null then
    execute 'create extension if not exists unaccent schema extensions';
  elsif ext_schema = 'public' then
    execute 'alter extension unaccent set schema extensions';
  end if;
end $$;

grant usage on schema extensions to authenticated;

do $$
declare
  fn regprocedure;
begin
  select p.oid::regprocedure into fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'extensions'
    and p.proname = 'unaccent'
    and pg_get_function_identity_arguments(p.oid) = 'text';
  if fn is not null then
    execute format('grant execute on function %s to authenticated', fn);
  end if;
end $$;

-- Fold names with extensions.unaccent. The body is schema-qualified so an
-- empty search_path cannot pick up a shadow function in public.
create or replace function public.objective_key(value text)
returns text
language plpgsql
immutable
as $$
declare
  raw text := coalesce(value, '');
begin
  begin
    raw := extensions.unaccent(raw);
  exception when undefined_function then
    raw := translate(raw,
      'ÀÁÂÄÃÅàáâäãåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÖÕòóôöõÙÚÛÜùúûüÝŸýÿÑñÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYYyyNnCc');
  end;
  return trim(both ' ' from regexp_replace(lower(raw), '[^a-z0-9]+', ' ', 'g'));
end;
$$;

alter function public.objective_key(text) set search_path = '';
alter function public.set_plan_name_key() set search_path = '';
alter function public.protect_message_edit() set search_path = '';
alter function public.protect_member_row() set search_path = '';
alter function public.touch_conversation() set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.accept_partner_request(uuid) set search_path = '';
alter function public.decline_partner_request(uuid) set search_path = '';
alter function private.is_conversation_member(uuid, boolean) set search_path = '';
alter function private.users_are_blocked(uuid, uuid) set search_path = '';

-- Trigger functions are not part of the API. Revoking execute stops PostgREST
-- from exposing them. Firing a trigger does not require this privilege.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_conversation() from public, anon, authenticated;
revoke all on function public.set_plan_name_key() from public, anon, authenticated;
revoke all on function public.protect_member_row() from public, anon, authenticated;
revoke all on function public.protect_message_edit() from public, anon, authenticated;

-- Authenticated clients may accept or decline only through these functions.
-- anon and public cannot call them. The functions check auth.uid() themselves.
revoke all on function public.accept_partner_request(uuid) from public, anon;
revoke all on function public.decline_partner_request(uuid) from public, anon;
grant execute on function public.accept_partner_request(uuid) to authenticated;
grant execute on function public.decline_partner_request(uuid) to authenticated;
