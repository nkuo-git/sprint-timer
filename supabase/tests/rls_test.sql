-- 權限規則測試：在套用 migrations 之後執行。任何一項不符就會中止並回報。
\set ON_ERROR_STOP on
\set an   '''00000000-0000-4000-8000-000000000001'''
\set nick '''00000000-0000-4000-8000-000000000002'''
\set mia  '''00000000-0000-4000-8000-000000000003'''
\set race '''10000000-0000-4000-8000-000000000001'''

insert into auth.users (id, email) values (:an, 'an@example.com'), (:nick, 'Nick@Example.com'), (:mia, 'mia@example.com');

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '測試失敗：%', what; end if;
  raise notice 'ok - %', what;
end $$;
create function pg_temp.fails(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok - %（%）', what, sqlerrm;
    return;
  end;
  raise exception '測試失敗：% 應該被拒絕', what;
end $$;
create function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 未登入（anon）什麼都碰不到 ──
set role anon;
select pg_temp.fails('select * from public.profiles', '未登入不能讀暱稱');
select pg_temp.fails('select * from public.results', '未登入不能讀成績');
select pg_temp.fails($$select * from public.search_profiles('a')$$, '未登入不能搜尋');
reset role;

-- ── 暱稱 ──
set role authenticated;
set request.jwt.claim.sub = :an;
insert into public.profiles (id, nickname) values (:an, '小安');
select pg_temp.fails($$insert into public.profiles (id, nickname) values ('00000000-0000-4000-8000-000000000002', '冒名')$$, '不能替別人建暱稱');
set request.jwt.claim.sub = :nick;
insert into public.profiles (id, nickname) values (:nick, 'Nick');
select pg_temp.fails($$update public.profiles set nickname = 'nick ' where id = auth.uid()$$, '暱稱前後不能有空白');
select pg_temp.fails($$update public.profiles set nickname = 'N' where id = auth.uid()$$, '暱稱至少 2 個字');
select pg_temp.fails($$update public.profiles set nickname = '一二三四五六七八九十一二三四五六七' where id = auth.uid()$$, '暱稱最多 16 個字');
set request.jwt.claim.sub = :mia;
select pg_temp.fails($$insert into public.profiles (id, nickname) values (auth.uid(), 'NICK')$$, '暱稱不分大小寫不能重複');
insert into public.profiles (id, nickname) values (:mia, 'Mia_100%');
select pg_temp.expect(pg_temp.affected($$update public.profiles set nickname = '被改了' where nickname = 'Nick'$$) = 0, '不能改別人的暱稱');
select pg_temp.expect((select count(*) from public.profiles) = 3, '登入後看得到大家的暱稱');

-- ── 搜尋 ──
select pg_temp.expect((select array_agg(nickname) from public.search_profiles('ni')) = array['Nick'], '用暱稱開頭搜尋');
select pg_temp.expect((select array_agg(nickname) from public.search_profiles('安')) = array['小安'], '用暱稱中間的字搜尋');
select pg_temp.expect((select array_agg(nickname) from public.search_profiles(' nick@example.COM ')) = array['Nick'], '用完整 Email 搜尋（不分大小寫）');
select pg_temp.expect((select count(*) from public.search_profiles('nick@example')) = 0, 'Email 只比對完整地址，不能用來猜');
select pg_temp.expect((select count(*) from public.search_profiles('%')) = 1, '% 當成一般字元，只找到暱稱裡真的有 % 的');
select pg_temp.expect((select count(*) from public.search_profiles('_')) = 1, '_ 當成一般字元');
select pg_temp.expect((select count(*) from public.search_profiles('')) = 0, '空字串不回傳任何人');
select pg_temp.fails('select email from auth.users', 'App 讀不到 Email 清單');

-- ── 小安計時一趟：自己第 1、Nick 第 2、路人第 3 ──
set request.jwt.claim.sub = :an;
insert into public.races (id, ran_at, distance_m, mode) values (:race, now(), 100, 'two-phone');
select pg_temp.expect((select owner from public.races where id = :race) = :an::uuid, '比賽預設歸計時的人');
insert into public.results (id, race_id, place, time_s, official_s, runner, runner_name) values
  ('20000000-0000-4000-8000-000000000001', :race, 1, 10.953, 10.96, :an, null),
  ('20000000-0000-4000-8000-000000000002', :race, 2, 11.062, 11.07, :nick, null),
  ('20000000-0000-4000-8000-000000000003', :race, 3, 11.514, 11.52, null, '路人');
select pg_temp.expect((select count(*) from public.results) = 3, '計時的人看得到整趟');
-- 同一批資料再上傳一次（App 的 upsert）
insert into public.results (id, race_id, place, time_s, official_s, runner)
  values ('20000000-0000-4000-8000-000000000002', :race, 2, 11.063, 11.07, :nick)
  on conflict (id) do update set time_s = excluded.time_s;
select pg_temp.expect((select time_s from public.results where place = 2) = 11.063, '計時的人可以更新成績');
select pg_temp.fails($$insert into public.races (id, owner, ran_at, mode) values (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', now(), 'two-phone')$$, '不能替別人建立比賽');
select pg_temp.fails($$insert into public.races (id, ran_at, mode) values (gen_random_uuid(), now(), 'three-phone')$$, '計時模式只接受已知的值');

-- ── Nick（被標記的人）──
set request.jwt.claim.sub = :nick;
select pg_temp.expect((select count(*) from public.results) = 1, '被標記的人只看得到自己的那一筆');
select pg_temp.expect((select official_s from public.results) = 11.07, '看到的是自己的成績');
select pg_temp.expect((select count(*) from public.races) = 1, '被標記的人看得到那一趟的日期與距離');
select pg_temp.expect(pg_temp.affected('update public.results set time_s = 9.58') = 0, '被標記的人不能改成績');
select pg_temp.expect(pg_temp.affected('delete from public.results') = 0, '被標記的人不能刪成績');
select pg_temp.expect(pg_temp.affected('update public.races set distance_m = 60') = 0, '被標記的人不能改比賽');
select pg_temp.fails($$insert into public.results (id, race_id, place, time_s, official_s, runner) values (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', 1, 9.58, 9.58, auth.uid())$$, '不能把成績塞進別人的比賽');
select pg_temp.fails($$insert into public.races (id, ran_at, mode) values ('10000000-0000-4000-8000-000000000001', now(), 'two-phone') on conflict (id) do update set owner = excluded.owner$$, '不能用 upsert 搶走別人的比賽');

-- ── Mia（無關的人）──
set request.jwt.claim.sub = :mia;
select pg_temp.expect((select count(*) from public.races) = 0, '無關的人看不到比賽');
select pg_temp.expect((select count(*) from public.results) = 0, '無關的人看不到成績');
select public.untag_me('20000000-0000-4000-8000-000000000002');
reset role;
select pg_temp.expect((select runner from public.results where place = 2) = :nick::uuid, '別人不能替 Nick 取消標記');

-- ── Nick 把成績從自己的紀錄拿掉 ──
set role authenticated;
set request.jwt.claim.sub = :nick;
select public.untag_me('20000000-0000-4000-8000-000000000002');
select pg_temp.expect((select count(*) from public.results) = 0, '取消標記後不再出現在自己的紀錄');
select pg_temp.expect((select count(*) from public.races) = 0, '取消標記後也看不到那一趟');
set request.jwt.claim.sub = :an;
select pg_temp.expect((select runner is null and runner_name = 'Nick' from public.results where place = 2), '計時的人那邊保留名字');
update public.results set runner = :nick, runner_name = null where place = 2;

-- ── 刪除帳號 ──
set request.jwt.claim.sub = :nick;
select public.delete_my_account();
reset role;
select pg_temp.expect(not exists (select from auth.users where id = :nick), '帳號已刪除');
select pg_temp.expect(not exists (select from public.profiles where id = :nick), '暱稱一起刪除');
select pg_temp.expect((select runner is null from public.results where place = 2), '別人計時的成績變成未標記');
select pg_temp.expect((select count(*) from public.results) = 3, '別人的比賽不受影響');
set role authenticated;
set request.jwt.claim.sub = :an;
select public.delete_my_account();
reset role;
select pg_temp.expect((select count(*) from public.races) = 0, '自己計時的比賽隨帳號刪除');
select pg_temp.expect((select count(*) from public.results) = 0, '比賽裡的成績一起刪除');

\echo 全部通過
