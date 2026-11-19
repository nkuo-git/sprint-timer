-- 短跑計時：帳號、暱稱、雲端成績、標記跑者
-- 套用方式見 supabase/README.md。所有資料表都開 RLS，App 只用公開的 anon/publishable key。

-- ───────────── 暱稱 ─────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 16 and nickname = btrim(nickname)),
  -- 不分大小寫比對是否重複
  nickname_key text generated always as (lower(nickname)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_nickname_key on public.profiles (nickname_key);

-- ───────────── 比賽（一趟）與每位跑者的成績 ─────────────
-- id 由手機產生（離線也能先存），上傳時用 upsert。
create table public.races (
  id uuid primary key,
  -- 計時的人（終點那支手機登入的帳號）
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ran_at timestamptz not null,
  distance_m numeric(7, 2) check (distance_m > 0 and distance_m <= 100000),
  mode text not null check (mode in ('two-phone', 'single-phone')),
  signal text check (signal in ('sound', 'flash')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index races_owner_ran_at on public.races (owner, ran_at desc);

create table public.results (
  id uuid primary key,
  race_id uuid not null references public.races (id) on delete cascade,
  place int not null check (place >= 1),
  -- 成績（秒，千分位）與正式成績（進位到百分位）
  time_s numeric(8, 3) not null check (time_s > 0),
  official_s numeric(7, 2) not null check (official_s > 0),
  reaction_s numeric(6, 3),
  false_start boolean not null default false,
  auto boolean not null default true,
  -- 標記給哪個用戶；不是用戶的人只寫名字
  runner uuid references auth.users (id) on delete set null,
  runner_name text check (char_length(runner_name) <= 40),
  updated_at timestamptz not null default now()
);
create index results_race on public.results (race_id);
create index results_runner on public.results (runner) where runner is not null;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger races_touch before update on public.races for each row execute function public.touch_updated_at();
create trigger results_touch before update on public.results for each row execute function public.touch_updated_at();

-- ───────────── 權限 ─────────────
-- races 和 results 的規則互相參照，用 security definer 函式避免 RLS 無限遞迴。
create function public.is_race_owner(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.races r where r.id = rid and r.owner = (select auth.uid()));
$$;

create function public.is_tagged_in_race(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.results x where x.race_id = rid and x.runner = (select auth.uid()));
$$;

alter table public.profiles enable row level security;
alter table public.races enable row level security;
alter table public.results enable row level security;

-- 暱稱：登入的人都看得到（顯示名字、搜尋用），只能改自己的。Email 不在這張表。
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- 比賽：計時的人可以讀寫；被標記的人可以讀（知道日期、距離、誰計時）。
create policy races_read on public.races for select to authenticated
  using (owner = (select auth.uid()) or public.is_tagged_in_race(id));
create policy races_insert on public.races for insert to authenticated with check (owner = (select auth.uid()));
create policy races_update on public.races for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy races_delete on public.races for delete to authenticated using (owner = (select auth.uid()));

-- 成績：計時的人可以讀寫整趟；被標記的人只讀得到自己的那一筆。
create policy results_read on public.results for select to authenticated
  using (runner = (select auth.uid()) or public.is_race_owner(race_id));
create policy results_insert on public.results for insert to authenticated with check (public.is_race_owner(race_id));
create policy results_update on public.results for update to authenticated
  using (public.is_race_owner(race_id)) with check (public.is_race_owner(race_id));
create policy results_delete on public.results for delete to authenticated using (public.is_race_owner(race_id));

revoke all on public.profiles, public.races, public.results from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.races, public.results to authenticated;

-- ───────────── 給 App 呼叫的函式 ─────────────
-- 找人來標記：含 @ 就當作完整 Email（只回傳完全相同的那一位，不能用來猜 Email），否則比對暱稱。
create function public.search_profiles(q text) returns table (id uuid, nickname text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  needle text := lower(btrim(coalesce(q, '')));
  pattern text;
begin
  if (select auth.uid()) is null or char_length(needle) < 1 or char_length(needle) > 254 then
    return;
  end if;
  if position('@' in needle) > 0 then
    return query
      select p.id, p.nickname
      from auth.users u
      join public.profiles p on p.id = u.id
      where lower(u.email) = needle
      limit 1;
  else
    pattern := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');
    return query
      select p.id, p.nickname
      from public.profiles p
      where p.nickname_key like '%' || pattern || '%' escape '\'
      order by (p.nickname_key like pattern || '%' escape '\') desc, p.nickname_key
      limit 10;
  end if;
end $$;

-- 被標記的人把某筆成績從自己的紀錄拿掉（計時的人那邊保留名字）。
create function public.untag_me(result_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.results r
  set runner = null,
      runner_name = coalesce(r.runner_name, (select p.nickname from public.profiles p where p.id = (select auth.uid())))
  where r.id = result_id and r.runner = (select auth.uid());
$$;

-- 刪除帳號：自己計時的比賽與暱稱一起刪除；別人幫忙計時的成績會變成未標記。
create function public.delete_my_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = (select auth.uid());
$$;

revoke all on function public.is_race_owner(uuid), public.is_tagged_in_race(uuid),
  public.search_profiles(text), public.untag_me(uuid), public.delete_my_account() from public, anon;
grant execute on function public.is_race_owner(uuid), public.is_tagged_in_race(uuid),
  public.search_profiles(text), public.untag_me(uuid), public.delete_my_account() to authenticated;
