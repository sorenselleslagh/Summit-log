-- Call the send-push edge function after a message is stored.
-- Apply after 20261110190000_profile_credentials.sql.
-- If the function URL or webhook secret is not set, the trigger does nothing,
-- so chat keeps working before the function is deployed.
--
-- After deploy, set these database settings (not in this file):
--   alter database postgres set app.settings.push_function_url = 'https://<project>.supabase.co/functions/v1/send-push';
--   alter database postgres set app.settings.push_webhook_secret = '<same value as PUSH_WEBHOOK_SECRET>';

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net unavailable: %', sqlerrm;
end $$;

create or replace function public.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dest text := nullif(current_setting('app.settings.push_function_url', true), '');
  secret text := nullif(current_setting('app.settings.push_webhook_secret', true), '');
begin
  if dest is null or secret is null then
    return new;
  end if;
  begin
    perform net.http_post(
      url := dest,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', secret
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'messages',
        'schema', 'public',
        'record', to_jsonb(new)
      )
    );
  exception when undefined_function or undefined_table then
    return new;
  end;
  return new;
end;
$$;

drop trigger if exists messages_enqueue_push on public.messages;
create trigger messages_enqueue_push
  after insert on public.messages
  for each row execute function public.enqueue_message_push();

revoke all on function public.enqueue_message_push() from public, anon, authenticated;
alter function public.enqueue_message_push() set search_path = '';
