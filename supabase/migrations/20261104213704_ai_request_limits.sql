-- Demo cost limits are private to the server, not writable by browser clients.
create table public.ai_demo_budget (
  id integer primary key check (id = 1),
  used integer not null default 0 check (used >= 0)
);
insert into public.ai_demo_budget(id) values (1);
create table public.ai_daily_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day date not null,
  used integer not null check (used > 0)
);
alter table public.ai_demo_budget enable row level security;
alter table public.ai_daily_usage enable row level security;
revoke all on public.ai_demo_budget, public.ai_daily_usage from public, anon, authenticated;
grant select, insert, update on public.ai_demo_budget, public.ai_daily_usage to service_role;

-- One transaction reserves both limits before contacting the paid provider.
-- Failed provider requests also consume a slot. Exceptions roll back both counters.
create function public.claim_ai_request(p_user_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_day date := (now() at time zone 'UTC')::date;
begin
  update public.ai_demo_budget set used = used + 1 where id = 1 and used < 100;
  if not found then raise exception 'AI_DEMO_LIMIT'; end if;
  insert into public.ai_daily_usage as counter(user_id, day, used)
  values (p_user_id, v_day, 1)
  on conflict (user_id) do update set day = excluded.day,
    used = case when counter.day = excluded.day then counter.used + 1 else 1 end
  where counter.day <> excluded.day or counter.used < 3;
  if not found then raise exception 'AI_USER_LIMIT'; end if;
end;
$$;
revoke all on function public.claim_ai_request(uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_request(uuid) to service_role;
