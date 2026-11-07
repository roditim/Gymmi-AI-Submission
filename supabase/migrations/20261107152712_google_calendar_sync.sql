begin;

create table public.google_calendar_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_hash text not null,
  verifier text not null,
  expires_at timestamptz not null
);

create table public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  calendar_id text not null,
  refresh_cipher text not null,
  links jsonb not null default '{}'::jsonb check (jsonb_typeof(links) = 'object'),
  lease_id uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  next_sync_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text,
  paused boolean not null default false
);

create index google_calendar_due
  on public.google_calendar_connections (next_sync_at) where not paused;

alter table public.google_calendar_states enable row level security;
alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_states, public.google_calendar_connections from public, anon, authenticated;
grant select, insert, update, delete on public.google_calendar_states, public.google_calendar_connections to service_role;

-- Commit incoming edits and their Google mapping together. A concurrent
-- browser write wins the race and the sync replans from the latest revision.
create function public.commit_google_calendar_pull(
  p_user uuid, p_lease uuid, p_revision integer, p_workouts jsonb, p_links jsonb
)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  current_revision integer;
begin
  perform 1 from public.google_calendar_connections
    where user_id = p_user and lease_id = p_lease and lease_until > now()
    for update;
  if not found then return false; end if;

  select revision into current_revision from public.workout_journals
    where user_id = p_user for update;
  if coalesce(current_revision, 0) <> p_revision then return false; end if;

  if p_workouts is not null then
    if current_revision is null then
      insert into public.workout_journals (user_id, workouts, revision)
        values (p_user, p_workouts, 1) on conflict do nothing;
      if not found then return false; end if;
    else
      update public.workout_journals
        set workouts = p_workouts, revision = revision + 1 where user_id = p_user;
    end if;
  end if;

  update public.google_calendar_connections set links = p_links where user_id = p_user;
  return true;
end;
$$;

revoke all on function public.commit_google_calendar_pull(uuid,uuid,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.commit_google_calendar_pull(uuid,uuid,integer,jsonb,jsonb) to service_role;

commit;

