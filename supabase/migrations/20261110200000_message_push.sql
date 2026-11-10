-- After a message is stored, ask the send-push function to notify the other person.
-- Apply after 20261110190500_credential_types_rls.sql.
-- This does nothing until the Vault secrets exist, so chat works before push is set up.
-- The URL and webhook secret are read from vault.decrypted_secrets inside private,
-- which PostgREST does not expose. pg_net is called only when both values are present.

create schema if not exists private;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net unavailable: %', sqlerrm;
end $$;

create or replace function private.push_runtime_secrets()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  jwt_role text := coalesce(claims->>'role', '');
begin
  -- Direct database sessions used by the edge runtime, or a service_role JWT.
  -- Authenticated and anon callers are rejected even if they obtain execute.
  if session_user not in ('postgres', 'supabase_admin')
     and jwt_role is distinct from 'service_role' then
    raise exception 'not allowed';
  end if;
  return coalesce((
    select jsonb_object_agg(s.name, s.decrypted_secret)
    from vault.decrypted_secrets s
    where s.name in (
      'summitlog_vapid_private',
      'summitlog_vapid_public',
      'summitlog_vapid_subject',
      'summitlog_push_webhook_secret',
      'summitlog_push_function_url'
    )
  ), '{}'::jsonb);
end;
$$;

create or replace function private.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dest text;
  secret text;
begin
  begin
    select s.decrypted_secret into dest
    from vault.decrypted_secrets s
    where s.name = 'summitlog_push_function_url'
    limit 1;
    select s.decrypted_secret into secret
    from vault.decrypted_secrets s
    where s.name = 'summitlog_push_webhook_secret'
    limit 1;
    if dest is null or secret is null or dest = '' or secret = '' then
      return new;
    end if;
    if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
      perform net.http_post(
        url := dest,
        body := jsonb_build_object(
          'type', 'INSERT',
          'table', 'messages',
          'schema', 'public',
          'record', to_jsonb(new)
        ),
        params := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-webhook-secret', secret
        ),
        timeout_milliseconds := 5000
      );
    end if;
  exception when others then
    raise warning 'summitlog push skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function private.push_runtime_secrets() from public, anon, authenticated;
revoke all on function private.enqueue_message_push() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema private to service_role';
    execute 'grant execute on function private.push_runtime_secrets() to service_role';
  end if;
end $$;

alter function private.push_runtime_secrets() set search_path = '';
alter function private.enqueue_message_push() set search_path = '';

drop trigger if exists messages_enqueue_push on public.messages;
drop function if exists public.enqueue_message_push();

create trigger messages_enqueue_push
  after insert on public.messages
  for each row execute function private.enqueue_message_push();
