begin;

create table public.league_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (
    nickname = btrim(nickname) and nickname ~ '^[A-Za-z0-9א-ת _-]{3,24}$'
  )
);

alter table public.league_members enable row level security;
revoke all on public.league_members from public, anon, authenticated;
grant select, insert, update, delete on public.league_members to authenticated;
create policy "Manage own league membership" on public.league_members
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create schema gymmi_private;
revoke all on schema gymmi_private from public, anon, authenticated;
grant usage on schema gymmi_private to authenticated;

-- Read private journals internally and expose only the opted-in standings.
create function gymmi_private.weekly_league()
returns table (place bigint, nickname text, weekly_exp integer, is_you boolean)
language sql stable security definer set search_path = ''
as $$
  with league_week as (
    select date_trunc('week', now() at time zone 'Asia/Jerusalem')::date as monday,
      (now() at time zone 'Asia/Jerusalem')::date as today
  ), scores as (
    select member.user_id, member.nickname, score.weekly_exp
    from public.league_members member
    left join public.workout_journals journal using (user_id)
    cross join league_week week
    cross join lateral (
      select count(distinct item->>'id')::integer * 100 as weekly_exp
      from jsonb_array_elements(journal.workouts) item
      where item->>'status' = 'completed'
        and nullif(item->>'id', '') is not null
        and item->>'date' in (
          select to_char(week.monday + offset_day, 'YYYY-MM-DD')
          from generate_series(0, week.today - week.monday) as offset_day
        )
    ) score
    where (select auth.uid()) is not null
  ), ranked as (
    select rank() over (order by scores.weekly_exp desc) as place, scores.*
    from scores
  )
  select ranked.place, ranked.nickname, ranked.weekly_exp,
    ranked.user_id = (select auth.uid()) as is_you
  from ranked
  order by ranked.place, ranked.nickname, ranked.user_id
  limit 20;
$$;

revoke all on function gymmi_private.weekly_league() from public, anon, authenticated;
grant execute on function gymmi_private.weekly_league() to authenticated;

create function public.weekly_league()
returns table (place bigint, nickname text, weekly_exp integer, is_you boolean)
language sql stable security invoker set search_path = ''
as $$
  select * from gymmi_private.weekly_league();
$$;

revoke all on function public.weekly_league() from public, anon, authenticated;
grant execute on function public.weekly_league() to authenticated;

commit;

