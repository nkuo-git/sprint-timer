import { describe, expect, it } from 'vitest';
import { CloudClient } from '../src/cloud/client';
import { saveNickname, untagMe } from '../src/cloud/profile';
import { decodePolyline, encodePolyline } from '../src/core/gpsTrack';
import { personalBests, RecordStore, runBests, runnerLabel, uuid, type RaceInput, type RunInput } from '../src/records/store';
import { RecordSync } from '../src/records/sync';
import type { Runner, StoredResult } from '../src/records/types';
import { makeCloud, memoryStorage, type TestCloud } from './testCloud';

/** 一支手機：自己的登入狀態、自己的紀錄檔 */
async function phone(cloud: TestCloud, email?: string, nickname?: string) {
  const client = new CloudClient(cloud.config, cloud.fetch, memoryStorage(), () => cloud.nowS * 1000);
  await client.init();
  const file = memoryStorage();
  const store = new RecordStore({ load: file.load, save: (v) => file.save(v) });
  await store.load();
  const sync = new RecordSync(client, store, () => cloud.nowS * 1000);
  const login = async (e: string, n?: string) => {
    await client.requestLink(e);
    await client.signInWithLink(await cloud.linkFor(e));
    if (n) await saveNickname(client, n);
    return client.user!.id;
  };
  const uid = email ? await login(email, nickname) : null;
  return { client, store, sync, file, uid, login };
}

/** 雲端上有幾趟比賽（成績文件依 raceId 分組） */
async function raceCount(cloud: TestCloud): Promise<number> {
  return new Set((await cloud.docs('results')).map((d) => d.data.raceId)).size;
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
    const p = await phone(await makeCloud());
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
    const p = await phone(await makeCloud());
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
    const cloud = await makeCloud();
    const p = await phone(cloud, 'nick@example.com', 'Nick');
    cloud.offline = true;
    await p.store.saveRace(race([result(1, 11.07, { kind: 'self' })]), p.uid);
    await p.sync.sync();
    expect(p.sync.status.state).toBe('offline');
    expect(p.store.pendingCount(p.uid)).toBe(1);
    expect(await raceCount(cloud)).toBe(0);

    cloud.offline = false;
    await p.sync.sync();
    expect(p.sync.status.state).toBe('idle');
    expect(p.store.pendingCount(p.uid)).toBe(0);
    expect(await raceCount(cloud)).toBe(1);
    expect((await cloud.docs('results'))[0].data).toMatchObject({ owner: p.uid, time: 11.07, official: 11.07, runner: p.uid, taggedTo: null, runnerName: null, distanceM: 100, mode: 'single-phone', signal: 'sound' });
  });

  it('換新手機：用同一個 Email 登入，紀錄全部回來', async () => {
    const cloud = await makeCloud();
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
    const cloud = await makeCloud();
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
    const cloud = await makeCloud();
    const an = await phone(cloud, 'an@example.com', '小安');
    const nick = await phone(cloud, 'nick@example.com', 'Nick');
    const r = race([result(1, 10.9, { kind: 'self' }), result(2, 11.0, { kind: 'user', id: nick.uid!, nickname: 'Nick' })]);
    await an.store.saveRace(r, an.uid);
    await an.sync.sync();
    // Nick 只查得到標記給自己的那一筆
    const visible = await nick.client.query('results', [['taggedTo', '==', nick.uid]]);
    expect(visible.map((d) => d.id)).toEqual([r.results[1].id]);
    const denied = { status: 403 };
    await expect(nick.client.query('results', [['owner', '==', an.uid]])).rejects.toMatchObject(denied);
    await expect(nick.client.query('results', [['raceId', '==', r.id]])).rejects.toMatchObject(denied);
    await expect(nick.client.getDoc(`results/${r.results[0].id}`)).rejects.toMatchObject(denied);
    // 改不了自己那一筆的成績，也刪不掉、搶不走
    const mine = visible[0].data;
    await expect(nick.client.commit([{ patch: `results/${visible[0].id}`, data: { time: 1 } }])).rejects.toMatchObject(denied);
    await expect(nick.client.commit([{ set: `results/${visible[0].id}`, data: { ...mine, owner: nick.uid, taggedTo: null } }])).rejects.toMatchObject(denied);
    await expect(nick.client.commit([{ delete: `results/${visible[0].id}` }])).rejects.toMatchObject(denied);
    await expect(nick.client.commit([{ delete: `results/${r.results[0].id}` }])).rejects.toMatchObject(denied);
    // 不能用別人的名義新增成績，也不能塞格式不對的資料
    await expect(nick.client.commit([{ set: 'results/forged', data: { ...mine, owner: an.uid } }])).rejects.toMatchObject(denied);
    await expect(nick.client.commit([{ set: 'results/bad', data: { ...mine, owner: nick.uid, runner: nick.uid, taggedTo: null, time: 'fast' } }])).rejects.toMatchObject(denied);
    await expect(nick.client.commit([{ set: 'results/bad', data: { ...mine, owner: nick.uid, runner: an.uid, taggedTo: null } }])).rejects.toMatchObject(denied);
    expect(await cloud.docs('results')).toHaveLength(2);
  });

  it('改標記、刪掉某位跑者之後，雲端和對方的紀錄跟著更新', async () => {
    const cloud = await makeCloud();
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
    expect(await cloud.docs('results')).toHaveLength(2);
    await nick.sync.sync();
    expect(nick.store.myResults(nick.uid)).toHaveLength(0);
  });

  it('被標記的人可以把成績從自己的紀錄拿掉，計時的人那邊保留名字', async () => {
    const cloud = await makeCloud();
    const an = await phone(cloud, 'an@example.com', '小安');
    const nick = await phone(cloud, 'nick@example.com', 'Nick');
    const r = race([result(1, 11.0, { kind: 'user', id: nick.uid!, nickname: 'Nick' })]);
    await an.store.saveRace(r, an.uid);
    await an.sync.sync();
    await nick.sync.sync();
    await untagMe(nick.client, nick.store.myResults(nick.uid)[0].resultId, 'Nick');
    await nick.sync.sync();
    expect(nick.store.myResults(nick.uid)).toHaveLength(0);
    await an.sync.sync();
    expect(an.store.race(r.id)!.results[0].runner).toEqual({ kind: 'name', name: 'Nick' });
  });

  it('未登入時存的成績，登入後歸到這個帳號並上傳', async () => {
    const cloud = await makeCloud();
    const p = await phone(cloud);
    await p.store.saveRace(race([result(1, 12.5, { kind: 'self' })]), null);
    expect(p.store.myResults(null)).toHaveLength(1);
    await p.sync.sync();
    expect(await raceCount(cloud)).toBe(0);

    const uid = await p.login('nick@example.com', 'Nick');
    await p.sync.sync();
    expect(await raceCount(cloud)).toBe(1);
    expect((await cloud.docs('results'))[0].data).toMatchObject({ owner: uid, runner: uid });
    expect(p.store.myResults(uid)).toHaveLength(1);
  });

  it('上傳途中又改了同一趟，不會把新的修改當成已上傳', async () => {
    const cloud = await makeCloud();
    const p = await phone(cloud, 'nick@example.com', 'Nick');
    const r = race([result(1, 11.0)]);
    await p.store.saveRace(r, p.uid);
    const realFetch = cloud.fetch;
    let edited = false;
    const slow = new CloudClient(cloud.config, async (url, init) => {
      if (!edited && url.endsWith(':commit')) {
        edited = true;
        await p.store.saveRace({ ...r, results: [{ ...r.results[0], runner: { kind: 'self' } }] }, p.uid);
      }
      return realFetch(url, init);
    }, memoryStorage(), () => cloud.nowS * 1000);
    await slow.init();
    await slow.requestLink('nick@example.com');
    await slow.signInWithLink(await cloud.linkFor('nick@example.com'));
    const sync = new RecordSync(slow, p.store);
    await sync.sync();
    expect(p.store.race(r.id)!.results[0].runner).toEqual({ kind: 'self' });
    expect(p.store.pendingCount(p.uid)).toBe(1);
    await sync.sync();
    expect(p.store.pendingCount(p.uid)).toBe(0);
    expect((await cloud.docs('results'))[0].data.runner).toBe(p.uid);
  });

  it('在一支手機刪掉的比賽，另一支手機同步後也消失', async () => {
    const cloud = await makeCloud();
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
    expect(await raceCount(cloud)).toBe(0);
    expect(await cloud.docs('results')).toHaveLength(0);
    await b.sync.sync();
    expect(b.store.races()).toHaveLength(0);
  });

  it('登出：已上傳的從手機拿掉，還沒上傳的留著，下次登入再上傳', async () => {
    const cloud = await makeCloud();
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
    expect(await raceCount(cloud)).toBe(2);
    expect(p.store.races()).toHaveLength(2);
  });

  it('別的帳號在同一支手機登入，不會把前一個人沒上傳的成績傳到自己名下', async () => {
    const cloud = await makeCloud();
    const p = await phone(cloud, 'nick@example.com', 'Nick');
    cloud.offline = true;
    await p.store.saveRace(race([result(1, 11.0, { kind: 'self' })]), p.uid);
    await p.client.signOut();
    await p.store.clearAccountData(p.uid!);
    cloud.offline = false;
    const other = await p.login('an@example.com', '小安');
    await p.sync.sync();
    expect(await raceCount(cloud)).toBe(0);
    expect(p.store.myResults(other)).toHaveLength(0);
  });

  it('未登入時同步什麼都不做', async () => {
    const cloud = await makeCloud();
    const p = await phone(cloud);
    await p.sync.sync();
    expect(cloud.requests).toHaveLength(0);
    expect(p.sync.status.state).toBe('idle');
  });
});

function longRun(over: Partial<RunInput> = {}): RunInput {
  return {
    id: uuid(),
    ranAt: '2026-11-20T06:42:00.000Z',
    distanceM: 5000,
    durationS: 1531.4,
    targetM: 5000,
    completed: true,
    splitsS: [312, 308.2, 298, 310, 303.2],
    track: [encodePolyline([[25.04776, 121.53185], [25.04881, 121.53291], [25.04990, 121.53402]]), encodePolyline([[25.05, 121.534], [25.051, 121.535]])],
    ...over,
  };
}

describe('長跑紀錄', () => {
  it('存檔後重開 App 還在，路線可以還原；舊版的紀錄檔（沒有長跑）照樣讀得進來', async () => {
    const p = await phone(await makeCloud());
    const r = longRun();
    await p.store.saveRun(r, null);
    await p.store.saveRun({ ...r, durationS: 1 }, null);
    const reopened = new RecordStore({ load: p.file.load, save: (v) => p.file.save(v) });
    await reopened.load();
    expect(reopened.runs(null)).toHaveLength(1);
    expect(reopened.runs(null)[0]).toMatchObject({ distanceM: 5000, durationS: 1531.4, splitsS: r.splitsS });
    expect(decodePolyline(reopened.runs(null)[0].track[0])).toEqual([[25.04776, 121.53185], [25.04881, 121.53291], [25.0499, 121.53402]]);

    const old = new RecordStore({ load: async () => JSON.stringify({ v: 1, races: [], tagged: [], seenTagged: [], recent: [] }), save: async () => undefined });
    await old.load();
    expect(old.runs(null)).toEqual([]);
    await old.saveRun(longRun(), null);
    expect(old.runs(null)).toHaveLength(1);
  });

  it('各目標距離的最佳成績：只算有跑完目標的', () => {
    const base = { owner: null, dirty: false, rev: 1 };
    const runs = [
      { ...longRun({ durationS: 1600 }), ...base },
      { ...longRun({ durationS: 1531.4 }), ...base },
      { ...longRun({ durationS: 900, distanceM: 3200, completed: false }), ...base },
      { ...longRun({ durationS: 700, distanceM: 2500, targetM: null, completed: false }), ...base },
      { ...longRun({ durationS: 2000, distanceM: 10000, targetM: 10000 }), ...base },
    ];
    const best = runBests(runs);
    expect([...best.keys()].sort((a, b) => a - b)).toEqual([5000, 10000]);
    expect(best.get(5000)!.durationS).toBe(1531.4);
  });

  it('沒網路時先存手機，連上後上傳；換新手機登入後路線也回來', async () => {
    const cloud = await makeCloud();
    const a = await phone(cloud, 'nick@example.com', 'Nick');
    cloud.offline = true;
    const r = longRun();
    await a.store.saveRun(r, a.uid);
    await a.sync.sync();
    expect(a.sync.status.state).toBe('offline');
    expect(a.store.pendingCount(a.uid)).toBe(1);
    cloud.offline = false;
    await a.sync.sync();
    expect(a.sync.status.state).toBe('idle');
    expect(a.store.pendingCount(a.uid)).toBe(0);
    const docs = await cloud.docs('runs');
    expect(docs).toHaveLength(1);
    expect(docs[0].data).toMatchObject({ owner: a.uid, distanceM: 5000, durationS: 1531.4, targetM: 5000, completed: true, track: r.track });

    const b = await phone(cloud);
    await b.login('nick@example.com');
    await b.sync.sync();
    const got = b.store.runs(b.client.user!.id);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: r.id, ranAt: r.ranAt, distanceM: 5000, durationS: 1531.4, targetM: 5000, completed: true, splitsS: r.splitsS, track: r.track, dirty: false });
  });

  it('自由跑（沒有目標距離）也能上傳和還原', async () => {
    const cloud = await makeCloud();
    const a = await phone(cloud, 'nick@example.com', 'Nick');
    await a.store.saveRun(longRun({ targetM: null, completed: false, distanceM: 8361.5, splitsS: [], track: [] }), a.uid);
    await a.sync.sync();
    expect(a.sync.status.state).toBe('idle');
    const b = await phone(cloud);
    await b.login('nick@example.com');
    await b.sync.sync();
    expect(b.store.runs(b.client.user!.id)[0]).toMatchObject({ targetM: null, completed: false, distanceM: 8361.5, splitsS: [], track: [] });
  });

  it('在一支手機刪掉的長跑，雲端和另一支手機都跟著消失', async () => {
    const cloud = await makeCloud();
    const a = await phone(cloud, 'nick@example.com', 'Nick');
    const r = longRun();
    await a.store.saveRun(r, a.uid);
    await a.store.saveRun(longRun({ ranAt: '2026-11-21T06:00:00.000Z' }), a.uid);
    await a.sync.sync();
    const b = await phone(cloud);
    await b.login('nick@example.com');
    await b.sync.sync();
    expect(b.store.runs(b.client.user!.id)).toHaveLength(2);
    await a.store.deleteRun(r.id);
    expect(a.store.runs(a.uid)).toHaveLength(1);
    await a.sync.sync();
    expect(await cloud.docs('runs')).toHaveLength(1);
    await b.sync.sync();
    expect(b.store.runs(b.client.user!.id).map((x) => x.id)).not.toContain(r.id);
  });

  it('未登入時存的長跑，登入後歸到這個帳號並上傳；沒上傳過的可以直接刪掉', async () => {
    const cloud = await makeCloud();
    const p = await phone(cloud);
    const keep = longRun();
    const drop = longRun();
    await p.store.saveRun(keep, null);
    await p.store.saveRun(drop, null);
    await p.store.deleteRun(drop.id);
    expect(p.store.data.runs).toHaveLength(1);
    const uid = await p.login('nick@example.com', 'Nick');
    await p.sync.sync();
    expect((await cloud.docs('runs')).map((d) => [d.id, d.data.owner])).toEqual([[keep.id, uid]]);
    expect(p.store.run(keep.id)).toMatchObject({ owner: uid, dirty: false });
  });

  it('別人讀不到、改不了、刪不掉我的長跑；格式不對的寫不進去', async () => {
    const cloud = await makeCloud();
    const nick = await phone(cloud, 'nick@example.com', 'Nick');
    const an = await phone(cloud, 'an@example.com', '小安');
    const r = longRun();
    await nick.store.saveRun(r, nick.uid);
    await nick.sync.sync();
    const mine = (await cloud.docs('runs'))[0].data;
    const denied = { status: 403 };
    await expect(an.client.getDoc(`runs/${r.id}`)).rejects.toMatchObject(denied);
    await expect(an.client.query('runs', [['owner', '==', nick.uid!]])).rejects.toMatchObject(denied);
    expect(await an.client.query('runs', [['owner', '==', an.uid!]])).toEqual([]);
    await expect(an.client.commit([{ set: `runs/${r.id}`, data: { ...mine, owner: an.uid } }])).rejects.toMatchObject(denied);
    await expect(an.client.commit([{ delete: `runs/${r.id}` }])).rejects.toMatchObject(denied);
    await expect(an.client.commit([{ set: 'runs/forged', data: { ...mine } }])).rejects.toMatchObject(denied);
    await expect(an.client.commit([{ set: 'runs/bad', data: { ...mine, owner: an.uid, durationS: 'fast' } }])).rejects.toMatchObject(denied);
    await expect(an.client.commit([{ set: 'runs/bad', data: { ...mine, owner: an.uid, extra: 1 } }])).rejects.toMatchObject(denied);
    await expect(an.client.commit([{ set: 'runs/bad', data: { ...mine, owner: an.uid, track: ['x'.repeat(300001)] } }])).rejects.toMatchObject(denied);
    await an.client.commit([{ set: 'runs/ok', data: { ...mine, owner: an.uid } }]);
    expect(await cloud.docs('runs')).toHaveLength(2);
  });

  it('登出：已上傳的長跑從手機拿掉，還沒上傳的留著', async () => {
    const cloud = await makeCloud();
    const p = await phone(cloud, 'nick@example.com', 'Nick');
    await p.store.saveRun(longRun(), p.uid);
    await p.sync.sync();
    cloud.offline = true;
    const waiting = longRun({ ranAt: '2026-11-22T06:00:00.000Z' });
    await p.store.saveRun(waiting, p.uid);
    await p.sync.sync();
    await p.store.clearAccountData(p.uid!);
    expect(p.store.data.runs.map((r) => r.id)).toEqual([waiting.id]);
  });
});
