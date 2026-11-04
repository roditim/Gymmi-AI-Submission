-- One JSON journal per account keeps the student's existing backup format.
-- revision is used by the browser to reject stale writes from another device.
create table public.workout_journals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workouts jsonb not null default '[]'::jsonb,
  revision integer not null default 1 check (revision > 0),
  constraint workouts_array check (jsonb_typeof(workouts) = 'array'),
  constraint workouts_limit check (jsonb_array_length(workouts) <= 1000),
  constraint journal_size check (octet_length(workouts::text) <= 1000000)
);

alter table public.workout_journals enable row level security;
revoke all on public.workout_journals from anon, authenticated, public;
grant select, insert, update on public.workout_journals to authenticated;

create policy "Read own journal" on public.workout_journals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own journal" on public.workout_journals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own journal" on public.workout_journals
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
-- No DELETE/TRUNCATE grants: clearing the diary writes an empty array instead.
