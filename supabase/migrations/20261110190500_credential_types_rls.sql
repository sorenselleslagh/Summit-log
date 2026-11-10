-- Match the credential_types hotfix already applied on the hosted project.
-- The catalogue is readable. Members cannot change it.
-- Drop-and-create keeps a second apply from failing where the policy already exists.

alter table public.credential_types enable row level security;

drop policy if exists credential_types_read on public.credential_types;

create policy credential_types_read on public.credential_types
  for select to anon, authenticated
  using (true);

revoke insert, update, delete, truncate on public.credential_types from anon, authenticated;
