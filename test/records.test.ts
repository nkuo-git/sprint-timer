import { describe, expect, it } from 'vitest';
import { CloudClient } from '../src/cloud/client';
import { saveNickname, untagMe } from '../src/cloud/profile';
import { personalBests, RecordStore, runnerLabel, uuid, type RaceInput } from '../src/records/store';
import { RecordSync } from '../src/records/sync';
import type { Runner, StoredResult } from '../src/records/types';
import { FakeCloud, memoryStorage } from './fakeCloud';

const CFG = { url: 'https://fake.supabase.co', key: 'anon-key' };

/** 一支手機：自己的登入狀態、自己的紀錄檔 */
async function phone(cloud: FakeCloud, email?: string, nickname?: string) {
  const client = new CloudClient(CFG, cloud.fetch, memoryStorage(), () => cloud.nowS * 1000);
  await client.init();
  const file = memoryStorage();
  const store = new RecordStore({ load: file.load, save: (v) => file.save(v) });
  await store.load();
  const sync = new RecordSync(client, store, () => cloud.nowS * 1000);
  const login = async (e: string, n?: string) => {
    await client.requestCode(e);
    await client.verifyCode(e, cloud.codeFor(e));
    if (n) await saveNickname(client, n);
    return client.user!.id;
  };
  const uid = email ? await login(email, nickname) : null;
  return { client, store, sync, file, uid, login };
}

function result(place: number, time: number, runner: Runner | null = null, id = uuid()): StoredResult {
  return { id, place, time, official: Math.ceil(time * 100 - 1e-9) / 100, auto: true, runner };
}

function race(results: StoredResult[], over: Partial<RaceInput> = {}): RaceInput {
  return { id: uuid(), ranAt: '2026-11-19T08:42:00.000Z', distanceM: 100, mode: 'single-phone', signal: 'sound', results, ...over };
}

describe('手機上的紀錄', () => {
  it('uuid 是合法的 v4 格式且不重複', () => {
    const ids = new Set(Array.from({ length: 200 }, uuid));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('存檔後重開 App 還在；內容沒變不會重複存', async () => {
    const p = await phone(new FakeCloud());
    const r = race([result(1, 11.123, { kind: 'self' })]);
    await p.store.saveRace(r, null);
    const rev = p.store.race(r.id)!.rev;
    await p.store.saveRace({ ...r, results: r.results.map((x) => ({ ...x })) }, null);
    expect(p.store.race(r.id)!.rev).toBe(rev);

    const reopened = new RecordStore({ load: p.file.load, save: (v) => p.file.save(v) });
    await reopened.load();
    expect(reopened.races()).toHaveLength(1);
    expect(reopened.myResults(null)[0]).toMatchObject({ time: 11.123, official: 11.13, distanceM: 100, timedBy: null });
  });

  it('紀錄檔壞掉時從空的開始，不會讓 App 打不開', async () => {
    const store = new RecordStore({ load: async () => '{壞掉', save: async () => undefined });
    await store.load();
    expect(store.races()).toEqual([]);
  });

  it('沒有任何成績的那一趟不存；成績全刪掉等於刪掉那一趟', async () => {
    const p = await phone(new FakeCloud());
    const r = race([]);
    await p.store.saveRace(r, null);
    expect(p.store.races()).toHaveLength(0);
    await p.store.saveRace({ ...r, results: [result(1, 12)] }, null);
    expect(p.store.races()).toHaveLength(1);
    await p.store.saveRace(r, null);
    expect(p.store.races()).toHaveLength(0);
  });

  it('個人最佳依距離分開算，搶跑不算', () => {
    const base = { raceId: 'r', resultId: 'x', ranAt: '', mode: 'single-phone' as const, place: 1, runners: 1, timedBy: null, isNew: false };
    const best = personalBests([
      { ...base, key: 'a', distanceM: 100, time: 11.2, official: 11.2 },
      { ...base, key: 'b', distanceM: 100, time: 10.9, official: 10.9 },
      { ...base, key: 'c', distanceM: 100, time: 9.5, official: 9.5, falseStart: true },
      { ...base, key: 'd', distanceM: 60, time: 7.4, official: 7.4 },
      { ...base, key: 'e', distanceM: null, time: 5, official: 5 },
    ]);
    expect(best.get(100)?.key).toBe('b');
    expect(best.get(60)?.key).toBe('d');
    expect(best.size).toBe(2);
  });

  it('跑者顯示名稱', () => {
    expect(runnerLabel(null, 3)).toBe('跑者 3');
    expect(runnerLabel({ kind: 'self' }, 1, 'Nick')).toBe('Nick（我）');
    expect(runnerLabel({ kind: 'self' }, 1)).toBe('我');
    expect(runnerLabel({ kind: 'user', id: 'u', nickname: '小安' }, 1)).toBe('小安');
    expect(runnerLabel({ kind: 'name', name: '阿凱' }, 1)).toBe('阿凱');
  });
});

describe('雲端同步', () => {
  it('沒網路時先存手機，連上後自動上傳', async () => {
    const cloud = new FakeCloud();
    const p = await phone(cloud, 'nick@example.com', 'Nick');
    cloud.offline = true;
    await p.store.saveRace(race([result(1, 11.07, { kind: 'self' })]), p.uid);
    await p.sync.sync();
    expect(p.sync.status.state).toBe('offline');
    expect(p.store.pendingCount(p.uid)).toBe(1);
    expect(cloud.races).toHaveLength(0);

    cloud.offline = false;
    await p.sync.sync();
    expect(p.sync.status.state).toBe('idle');
    expect(p.store.pendingCount(p.uid)).toBe(0);
    expect(cloud.races).toHaveLength(1);
    expect(cloud.results[0]).toMatchObject({ time_s: 11.07, official_s: 11.07, runner: p.uid, runner_name: null });
  });

  it('換新手機：用同一個 Email 登入，紀錄全部回來', async () => {
    const cloud = new FakeCloud();
    const oldPhone = await phone(cloud, 'nick@example.com', 'Nick');
    await oldPhone.store.saveRace(race([result(1, 10.837, { kind: 'self' }), result(2, 11.2, { kind: 'name', name: '阿凱' })], { mode: 'two-phone', signal: undefined }), oldPhone.uid);
    await oldPhone.store.saveRace(race([result(1, 7.21, { kind: 'self' })], { distanceM: 60, ranAt: '2026-11-12T09:00:00.000Z' }), oldPhone.uid);
    await oldPhone.sync.sync();

    const newPhone = await phone(cloud, 'nick@example.com');
    await newPhone.sync.sync();
    expect(newPhone.store.races()).toHaveLength(2);
    const mine = newPhone.store.myResults(newPhone.uid);
    expect(mine.map((m) => [m.distanceM, m.official])).toEqual([
      [100, 10.84],
      [60, 7.21],
    ]);
    expect(newPhone.store.races()[0].results[1].runner).toEqual({ kind: 'name', name: '阿凱' });
    expect(newPhone.store.pendingCount(newPhone.uid)).toBe(0);
  });

  it('標記給別人的成績，會自動出現在對方的紀錄，並顯示是誰計時', async () => {
    const cloud = new FakeCloud();
    const an = await phone(cloud, 'an@example.com', '小安');
    const nick = await phone(cloud, 'nick@example.com', 'Nick');
    await an.store.saveRace(
      race([result(1, 10.953, { kind: 'self' }), result(2, 11.062, { kind: 'user', id: nick.uid!, nickname: 'Nick' }), result(3, 11.514)], { mode: 'two-phone' }),
      an.uid,
    );
    await an.sync.sync();

    await nick.sync.sync();
    const mine = nick.store.myResults(nick.uid);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ official: 11.07, place: 2, distanceM: 100, timedBy: { id: an.uid, nickname: '小安' }, isNew: true });
    // 對方那一趟不會出現在「我計時的比賽」
    expect(nick.store.races()).toHaveLength(0);

    await nick.store.markTaggedSeen();
    await nick.sync.sync();
    expect(nick.store.myResults(nick.uid)[0].isNew).toBe(false);
    // 計時的人記得最近一起跑的人
    expect(an.store.data.recent.map((r) => r.nickname)).toEqual(['Nick']);
  });

  it('被標記的人讀不到同一趟其他人的成績，也改不了', async () => {
    const cloud = new FakeCloud();
    const an = await phone(cloud, 'an@example.com', '小安');
    const nick = await phone(cloud, 'nick@example.com', 'Nick');
    const r = race([result(1, 10.9, { kind: 'self' }), result(2, 11.0, { kind: 'user', id: nick.uid!, nickname: 'Nick' })]);
    await an.store.saveRace(r, an.uid);
    await an.sync.sync();
    const visible = await nick.client.select('results', {});
    expect(visible).toHaveLength(1);
    await expect(nick.client.upsert('results', [{ ...cloud.results[0], time_s: 1 }])).rejects.toMatchObject({ status: 403 });
    await expect(nick.client.upsert('races', { ...cloud.races[0], owner: nick.uid })).rejects.toMatchObject({ status: 403 });
  });

  it('改標記、刪掉某位跑者之後，雲端和對方的紀錄跟著更新', async () => {
    const cloud = new FakeCloud();
    const an = await phone(cloud, 'an@example.com', '小安');
    const nick = await phone(cloud, 'nick@example.com', 'Nick');
    const r = race([result(1, 10.9, { kind: 'self' }), result(2, 11.0, { kind: 'user', id: nick.uid!, nickname: 'Nick' }), result(3, 11.5)]);
    await an.store.saveRace(r, an.uid);
    await an.sync.sync();
    await nick.sync.sync();
    expect(nick.store.myResults(nick.uid)).toHaveLength(1);

    // 小安發現標錯了：第 2 位其實不是 Nick，第 3 位是誤判要刪掉
    await an.store.saveRace({ ...r, results: [r.results[0], { ...r.results[1], runner: { kind: 'name', name: '路人' } }] }, an.uid);
    await an.sync.sync();
    expect(cloud.results).toHaveLength(2);
    await nick.sync.sync();
    expect(nick.store.myResults(nick.uid)).toHaveLength(0);
  });

  it('被標記的人可以把成績從自己的紀錄拿掉，計時的人那邊保留名字', async () => {
    const cloud = new FakeCloud();
    const an = await phone(cloud, 'an@example.com', '小安');
    const nick = await phone(cloud, 'nick@example.com', 'Nick');
    const r = race([result(1, 11.0, { kind: 'user', id: nick.uid!, nickname: 'Nick' })]);
    await an.store.saveRace(r, an.uid);
    await an.sync.sync();
    await nick.sync.sync();
    await untagMe(nick.client, nick.store.myResults(nick.uid)[0].resultId);
    await nick.sync.sync();
    expect(nick.store.myResults(nick.uid)).toHaveLength(0);
    await an.sync.sync();
    expect(an.store.race(r.id)!.results[0].runner).toEqual({ kind: 'name', name: 'Nick' });
  });

  it('未登入時存的成績，登入後歸到這個帳號並上傳', async () => {
    const cloud = new FakeCloud();
    const p = await phone(cloud);
    await p.store.saveRace(race([result(1, 12.5, { kind: 'self' })]), null);
    expect(p.store.myResults(null)).toHaveLength(1);
    await p.sync.sync();
    expect(cloud.races).toHaveLength(0);

    const uid = await p.login('nick@example.com', 'Nick');
    await p.sync.sync();
    expect(cloud.races).toHaveLength(1);
    expect(cloud.races[0].owner).toBe(uid);
    expect(cloud.results[0].runner).toBe(uid);
    expect(p.store.myResults(uid)).toHaveLength(1);
  });

  it('上傳途中又改了同一趟，不會把新的修改當成已上傳', async () => {
    const cloud = new FakeCloud();
    const p = await phone(cloud, 'nick@example.com', 'Nick');
    const r = race([result(1, 11.0)]);
    await p.store.saveRace(r, p.uid);
    const realFetch = cloud.fetch;
    let edited = false;
    const slow = new CloudClient(CFG, async (url, init) => {
      if (!edited && url.includes('/rest/v1/results') && init?.method === 'POST') {
        edited = true;
        await p.store.saveRace({ ...r, results: [{ ...r.results[0], runner: { kind: 'self' } }] }, p.uid);
      }
      return realFetch(url, init);
    }, memoryStorage(), () => cloud.nowS * 1000);
    await slow.init();
    await slow.requestCode('nick@example.com');
    await slow.verifyCode('nick@example.com', cloud.codeFor('nick@example.com'));
    const sync = new RecordSync(slow, p.store);
    await sync.sync();
    expect(p.store.race(r.id)!.results[0].runner).toEqual({ kind: 'self' });
    expect(p.store.pendingCount(p.uid)).toBe(1);
    await sync.sync();
    expect(p.store.pendingCount(p.uid)).toBe(0);
    expect(cloud.results[0].runner).toBe(p.uid);
  });

  it('在一支手機刪掉的比賽，另一支手機同步後也消失', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'nick@example.com', 'Nick');
    const r = race([result(1, 11.0, { kind: 'self' })]);
    await a.store.saveRace(r, a.uid);
    await a.sync.sync();
    const b = await phone(cloud, 'nick@example.com');
    await b.sync.sync();
    expect(b.store.races()).toHaveLength(1);

    await a.store.deleteRace(r.id);
    expect(a.store.races()).toHaveLength(0);
    await a.sync.sync();
    expect(cloud.races).toHaveLength(0);
    expect(cloud.results).toHaveLength(0);
    await b.sync.sync();
    expect(b.store.races()).toHaveLength(0);
  });

  it('登出：已上傳的從手機拿掉，還沒上傳的留著，下次登入再上傳', async () => {
    const cloud = new FakeCloud();
    const p = await phone(cloud, 'nick@example.com', 'Nick');
    await p.store.saveRace(race([result(1, 11.0, { kind: 'self' })]), p.uid);
    await p.sync.sync();
    cloud.offline = true;
    await p.store.saveRace(race([result(1, 11.3, { kind: 'self' })], { ranAt: '2026-11-19T09:00:00.000Z' }), p.uid);
    await p.sync.sync();
    await p.client.signOut();
    await p.store.clearAccountData(p.uid!);
    expect(p.store.races()).toHaveLength(1);
    expect(p.store.races()[0].dirty).toBe(true);

    cloud.offline = false;
    await p.login('nick@example.com');
    await p.sync.sync();
    expect(cloud.races).toHaveLength(2);
    expect(p.store.races()).toHaveLength(2);
  });

  it('別的帳號在同一支手機登入，不會把前一個人沒上傳的成績傳到自己名下', async () => {
    const cloud = new FakeCloud();
    const p = await phone(cloud, 'nick@example.com', 'Nick');
    cloud.offline = true;
    await p.store.saveRace(race([result(1, 11.0, { kind: 'self' })]), p.uid);
    await p.client.signOut();
    await p.store.clearAccountData(p.uid!);
    cloud.offline = false;
    const other = await p.login('an@example.com', '小安');
    await p.sync.sync();
    expect(cloud.races).toHaveLength(0);
    expect(p.store.myResults(other)).toHaveLength(0);
  });

  it('未登入時同步什麼都不做', async () => {
    const cloud = new FakeCloud();
    const p = await phone(cloud);
    await p.sync.sync();
    expect(cloud.requests).toHaveLength(0);
    expect(p.sync.status.state).toBe('idle');
  });
});
