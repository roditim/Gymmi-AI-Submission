begin;

create table public.coach_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60),
  bio text not null check (char_length(btrim(bio)) between 10 and 500),
  specialties text[] not null check (cardinality(specialties) between 1 and 6 and specialties <@ array['general','cut','muscle','strength','endurance','mobility']),
  audiences text[] not null check (cardinality(audiences) between 1 and 5 and audiences <@ array['adults','women','men','children','older']),
  focus text not null check (focus in ('beginner','technique','consistency','flexible')),
  format text not null check (format in ('online','in_person','both')),
  contact_email text not null check (char_length(contact_email) <= 120 and contact_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$'),
  published boolean not null default false
);

create table public.coach_ratings (
  coach_id uuid not null references public.coach_profiles(id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  primary key (coach_id, reviewer_id)
);
create index coach_ratings_reviewer_idx on public.coach_ratings(reviewer_id);

alter table public.coach_profiles enable row level security;
alter table public.coach_ratings enable row level security;
revoke all on public.coach_profiles, public.coach_ratings from public, anon, authenticated;
grant select, insert, update on public.coach_profiles to authenticated;
grant select, insert, update, delete on public.coach_ratings to authenticated;

create policy "Coach manages own profile" on public.coach_profiles for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create function gymmi_private.can_rate_coach(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coach_profiles p
    where p.id = target and p.published and p.owner_id <> (select auth.uid())
  );
$$;
revoke all on function gymmi_private.can_rate_coach(uuid) from public, anon, authenticated;
grant execute on function gymmi_private.can_rate_coach(uuid) to authenticated;

create policy "Reviewer reads own ratings" on public.coach_ratings for select to authenticated
  using ((select auth.uid()) = reviewer_id);
create policy "Reviewer rates a published coach" on public.coach_ratings for insert to authenticated
  with check ((select auth.uid()) = reviewer_id and gymmi_private.can_rate_coach(coach_id));
create policy "Reviewer updates own rating" on public.coach_ratings for update to authenticated
  using ((select auth.uid()) = reviewer_id)
  with check ((select auth.uid()) = reviewer_id and gymmi_private.can_rate_coach(coach_id));
create policy "Reviewer deletes own rating" on public.coach_ratings for delete to authenticated
  using ((select auth.uid()) = reviewer_id);

-- Only published profile fields and aggregate ratings leave the private tables.
create function gymmi_private.coach_directory()
returns table (id uuid, display_name text, bio text, specialties text[], audiences text[],
  focus text, format text, contact_email text, rating numeric, rating_count integer, is_mine boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.bio, p.specialties, p.audiences,
    p.focus, p.format, p.contact_email, round(stats.rating, 1), stats.total,
    coalesce(p.owner_id = (select auth.uid()), false)
  from public.coach_profiles p
  cross join lateral (
    select avg(r.score) as rating, count(*)::integer as total
    from public.coach_ratings r where r.coach_id = p.id
  ) stats
  where p.published
  order by stats.rating desc nulls last, stats.total desc, p.display_name, p.id;
$$;
grant usage on schema gymmi_private to anon;
revoke all on function gymmi_private.coach_directory() from public, anon, authenticated;
grant execute on function gymmi_private.coach_directory() to anon, authenticated;

create function public.coach_directory()
returns table (id uuid, display_name text, bio text, specialties text[], audiences text[],
  focus text, format text, contact_email text, rating numeric, rating_count integer, is_mine boolean)
language sql stable security invoker set search_path = '' as $$
  select * from gymmi_private.coach_directory();
$$;
revoke all on function public.coach_directory() from public, anon, authenticated;
grant execute on function public.coach_directory() to anon, authenticated;

-- Separate demo quota so matching cannot spend the workout scheduler's allocation.
create table public.coach_match_budget (
  id integer primary key check (id = 1),
  used integer not null default 0 check (used >= 0)
);
insert into public.coach_match_budget(id) values (1);
create table public.coach_match_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day date not null,
  used integer not null check (used > 0)
);
alter table public.coach_match_budget enable row level security;
alter table public.coach_match_usage enable row level security;
revoke all on public.coach_match_budget, public.coach_match_usage from public, anon, authenticated;
grant select, insert, update on public.coach_match_budget, public.coach_match_usage to service_role;

create function public.claim_coach_match(p_user_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare today date := (now() at time zone 'UTC')::date;
begin
  update public.coach_match_budget set used = used + 1 where id = 1 and used < 50;
  if not found then raise exception 'AI_DEMO_LIMIT'; end if;
  insert into public.coach_match_usage as counter(user_id, day, used) values (p_user_id, today, 1)
    on conflict (user_id) do update set day = excluded.day,
      used = case when counter.day = excluded.day then counter.used + 1 else 1 end
    where counter.day <> excluded.day or counter.used < 3;
  if not found then raise exception 'AI_USER_LIMIT'; end if;
end;
$$;
revoke all on function public.claim_coach_match(uuid) from public, anon, authenticated;
grant execute on function public.claim_coach_match(uuid) to service_role;

commit;
