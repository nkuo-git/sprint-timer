import { describe, expect, it } from 'vitest';
import { AccountService } from '../src/account/service';
import { RaceDraft } from '../src/records/draft';
import { makeCloud, memoryStorage, type TestCloud } from './testCloud';

/** 一支手機上的 App；傳入同一組 files 等於重開 App */
function app(cloud: TestCloud, files = { session: memoryStorage(), records: memoryStorage() }, config = cloud.config) {
  const service = new AccountService({
    config,
    fetch: cloud.fetch,
    sessionStorage: files.session,
    records: { load: files.records.load, save: (v) => files.records.save(v) },
    now: () => cloud.nowS * 1000,
  });
  const login = async (email: string, nickname?: string) => {
    await service.requestLink(email);
    expect(await service.handleLink(await cloud.linkFor(email))).toBe(true);
    expect(service.getSnapshot().linkError).toBeNull();
    if (nickname) await service.setNickname(nickname);
    await service.syncNow();
  };
  return { service, files, login };
}

const finished = (times: number[]) => times.map((time, i) => ({ id: i + 1, place: i + 1, time, auto: true }));

describe('帳號流程', () => {
  it('第一次登入要先取暱稱，取完就不再問；重開 App 沒網路也記得', async () => {
    const cloud = await makeCloud();
    const a = app(cloud);
    await a.service.start();
    expect(a.service.getSnapshot()).toMatchObject({ ready: true, cloudEnabled: true, user: null, needsNickname: false });

    await a.login('nick@example.com');
    expect(a.service.getSnapshot()).toMatchObject({ needsNickname: true, nickname: null });
    expect(await a.service.setNickname('Nick')).toBe('ok');
    expect(a.service.getSnapshot()).toMatchObject({ needsNickname: false, nickname: 'Nick' });

    cloud.offline = true;
    const again = app(cloud, a.files);
    await again.service.start();
    expect(again.service.getSnapshot()).toMatchObject({ nickname: 'Nick', needsNickname: false });
    expect(again.service.getSnapshot().user?.email).toBe('nick@example.com');
  });

  it('寄出登入信後等使用者點連結；App 被連結打開就完成登入，別人查得到這個 Email', async () => {
    const cloud = await makeCloud();
    const a = app(cloud);
    await a.service.start();
    await a.service.requestLink('Nick@Example.com');
    expect(a.service.getSnapshot()).toMatchObject({ user: null, pendingEmail: 'nick@example.com', linkError: null });

    // 寄完信 App 被系統關掉，使用者點連結時重新打開
    const reopened = app(cloud, a.files);
    await reopened.service.start();
    expect(reopened.service.getSnapshot().pendingEmail).toBe('nick@example.com');
    expect(await reopened.service.handleLink('https://example.com/other')).toBe(false);
    expect(await reopened.service.handleLink(null)).toBe(false);
    expect(await reopened.service.handleLink(await cloud.linkFor('nick@example.com'))).toBe(true);
    expect(reopened.service.getSnapshot()).toMatchObject({ pendingEmail: null, linkError: null, signingIn: false, needsNickname: true });
    expect(reopened.service.getSnapshot().user?.email).toBe('nick@example.com');
    await reopened.service.setNickname('Nick');
    // 同一個連結再點一次：已經登入了，不當成錯誤
    expect(await reopened.service.handleLink(await cloud.linkFor('nick@example.com'))).toBe(true);
    expect(reopened.service.getSnapshot().linkError).toBeNull();

    const b = app(cloud);
    await b.service.start();
    await b.login('an@example.com', '小安');
    await reopened.service.syncNow();
    expect(await b.service.searchPeople('nick@example.com')).toEqual([{ id: reopened.service.getSnapshot().user!.id, nickname: 'Nick' }]);
  });

  it('連結失效、沒寄過信就點連結：不會登入，畫面拿得到原因；改 Email 可以重來', async () => {
    const cloud = await makeCloud();
    const a = app(cloud);
    await a.service.start();
    await a.login('nick@example.com', 'Nick');
    const used = await cloud.linkFor('nick@example.com');
    await a.service.signOut();

    // 這支手機沒有寄過信
    expect(await a.service.handleLink(used)).toBe(true);
    expect(a.service.getSnapshot()).toMatchObject({ user: null, linkError: '請先輸入 Email 寄出登入信，再點信裡的連結' });
    a.service.clearLinkError();
    expect(a.service.getSnapshot().linkError).toBeNull();

    // 寄了新的信，卻點到舊信的連結
    await a.service.requestLink('nick@example.com');
    expect(await a.service.handleLink(used)).toBe(true);
    expect(a.service.getSnapshot()).toMatchObject({ user: null, pendingEmail: 'nick@example.com', linkError: '這個登入連結已經用過或失效了，請重新寄一封登入信' });
    await expect(a.service.signInWithLink('亂貼的文字')).rejects.toMatchObject({ message: '這不是登入信裡的連結' });

    await a.service.cancelLogin();
    expect(a.service.getSnapshot()).toMatchObject({ pendingEmail: null, linkError: null });
    await a.login('nick@example.com');
    expect(a.service.getSnapshot()).toMatchObject({ nickname: 'Nick', needsNickname: false });
  });

  it('在新手機登入已有暱稱的帳號，不會再問暱稱', async () => {
    const cloud = await makeCloud();
    const a = app(cloud);
    await a.service.start();
    await a.login('nick@example.com', 'Nick');
    const b = app(cloud);
    await b.service.start();
    await b.login('nick@example.com');
    expect(b.service.getSnapshot()).toMatchObject({ nickname: 'Nick', needsNickname: false });
  });

  it('暱稱被用掉時回報 taken，狀態不變', async () => {
    const cloud = await makeCloud();
    const a = app(cloud);
    await a.service.start();
    await a.login('a@example.com', 'Mia');
    const b = app(cloud);
    await b.service.start();
    await b.login('b@example.com');
    expect(await b.service.setNickname('mia')).toBe('taken');
    expect(b.service.getSnapshot().needsNickname).toBe(true);
  });

  it('沒設定雲端時，登入功能停用，但成績照樣存在手機', async () => {
    const cloud = await makeCloud();
    const a = app(cloud, undefined, { projectId: '', apiKey: '' });
    await a.service.start();
    expect(a.service.getSnapshot().cloudEnabled).toBe(false);
    const draft = new RaceDraft('single-phone', { distanceM: 100, signal: 'sound' });
    draft.tag(1, { kind: 'self' });
    await a.service.saveRace(draft.toRace(finished([11.2])));
    await a.service.syncNow();
    expect(a.service.store.myResults(null)).toHaveLength(1);
    expect(cloud.requests).toHaveLength(0);
    await expect(async () => a.service.requestLink('a@example.com')).rejects.toThrow();
  });

  it('存成績後畫面收到通知，待上傳數量正確', async () => {
    const cloud = await makeCloud();
    const a = app(cloud);
    await a.service.start();
    await a.login('nick@example.com', 'Nick');
    let calls = 0;
    a.service.subscribe(() => calls++);
    const before = a.service.getSnapshot();
    const draft = new RaceDraft('single-phone', { distanceM: 100 });
    cloud.offline = true;
    await a.service.saveRace(draft.toRace(finished([11.2])));
    await a.service.syncNow();
    expect(calls).toBeGreaterThan(0);
    expect(a.service.getSnapshot()).not.toBe(before);
    expect(a.service.getSnapshot()).toMatchObject({ pending: 1, sync: { state: 'offline' } });
    cloud.offline = false;
    await a.service.syncNow();
    expect(a.service.getSnapshot()).toMatchObject({ pending: 0, sync: { state: 'idle' } });
    expect(a.service.getSnapshot().sync.lastOk).toBe(cloud.nowS * 1000);
  });

  it('登出後手機上不留這個帳號已上傳的紀錄；再登入全部回來', async () => {
    const cloud = await makeCloud();
    const a = app(cloud);
    await a.service.start();
    await a.login('nick@example.com', 'Nick');
    const draft = new RaceDraft('single-phone', { distanceM: 100 });
    draft.tag(1, { kind: 'self' });
    await a.service.saveRace(draft.toRace(finished([11.2])));
    await a.service.signOut();
    expect(await cloud.docs('results')).toHaveLength(1);
    expect(a.service.getSnapshot()).toMatchObject({ user: null, nickname: null });
    expect(a.service.store.races()).toHaveLength(0);
    await a.login('nick@example.com');
    expect(a.service.store.myResults(a.service.getSnapshot().user!.id)).toHaveLength(1);
    expect(a.service.getSnapshot().nickname).toBe('Nick');
  });

  it('刪除帳號：雲端和手機上的紀錄都清掉', async () => {
    const cloud = await makeCloud();
    const a = app(cloud);
    await a.service.start();
    await a.login('nick@example.com', 'Nick');
    await a.service.saveRace(new RaceDraft('single-phone').toRace(finished([11.2])));
    await a.service.saveRun({ id: 'run-1', ranAt: '2026-11-20T06:42:00.000Z', distanceM: 5000, durationS: 1531.4, targetM: 5000, completed: true, splitsS: [300], track: ['_p~iF~ps|U'] });
    expect(a.service.getSnapshot().pending).toBe(2);
    await a.service.syncNow();
    expect(a.service.getSnapshot().pending).toBe(0);
    expect(await cloud.docs('runs')).toHaveLength(1);
    await a.service.deleteAccount();
    expect(await cloud.docs('results')).toHaveLength(0);
    expect(await cloud.docs('runs')).toHaveLength(0);
    expect(a.service.store.data.runs).toHaveLength(0);
    expect(await cloud.docs('users')).toHaveLength(0);
    expect(await cloud.docs('nicknames')).toHaveLength(0);
    expect(await cloud.docs('emails')).toHaveLength(0);
    expect(a.service.store.races()).toHaveLength(0);
    expect(a.service.getSnapshot().user).toBeNull();
  });

  it('把別人標記給我的成績拿掉後，立刻從我的紀錄消失', async () => {
    const cloud = await makeCloud();
    const an = app(cloud);
    await an.service.start();
    await an.login('an@example.com', '小安');
    const nick = app(cloud);
    await nick.service.start();
    await nick.login('nick@example.com', 'Nick');
    const nickId = nick.service.getSnapshot().user!.id;

    const found = await an.service.searchPeople('nic');
    expect(found).toEqual([{ id: nickId, nickname: 'Nick' }]);
    const draft = new RaceDraft('two-phone', { distanceM: 100 });
    draft.tag(1, { kind: 'user', ...found[0] });
    await an.service.saveRace(draft.toRace(finished([11.062])));
    await an.service.syncNow();

    await nick.service.refresh();
    const mine = nick.service.store.myResults(nickId);
    expect(mine).toHaveLength(1);
    await nick.service.untag(mine[0].resultId);
    expect(nick.service.store.myResults(nickId)).toHaveLength(0);
  });
});

describe('成績畫面的暫存（RaceDraft）', () => {
  it('同一位跑者重複儲存用同一個 id；名次依目前順序', () => {
    const d = new RaceDraft('two-phone', { distanceM: 100, ranAt: new Date('2026-11-19T08:00:00Z') });
    const first = d.toRace([
      { id: 7, place: 1, time: 10.8371, auto: true },
      { id: 9, place: 2, time: 11.0619, auto: true },
    ]);
    expect(first.results.map((r) => [r.time, r.official])).toEqual([
      [10.837, 10.84],
      [11.062, 11.07],
    ]);
    // 補上一位更早到的人：原本兩位名次往後，但 id 不變
    const second = d.toRace([
      { id: 100000, place: 1, time: 10.5, auto: false },
      { id: 7, place: 2, time: 10.8371, auto: true },
      { id: 9, place: 3, time: 11.0619, auto: true },
    ]);
    expect(second.id).toBe(first.id);
    expect(second.results[1].id).toBe(first.results[0].id);
    expect(second.results[2].id).toBe(first.results[1].id);
    expect(second.results.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(second.ranAt).toBe('2026-11-19T08:00:00.000Z');
  });

  it('同一個人在一趟裡只能被標記一次，名字可以重複', () => {
    const d = new RaceDraft('two-phone');
    d.tag(1, { kind: 'self' });
    d.tag(2, { kind: 'self' });
    expect(d.runner(1)).toBeNull();
    expect(d.runner(2)).toEqual({ kind: 'self' });
    d.tag(1, { kind: 'user', id: 'u1', nickname: '小安' });
    d.tag(3, { kind: 'user', id: 'u1', nickname: '小安' });
    expect(d.runner(1)).toBeNull();
    d.tag(1, { kind: 'name', name: '  路人  ' });
    d.tag(4, { kind: 'name', name: '路人' });
    expect(d.runner(1)).toEqual({ kind: 'name', name: '路人' });
    expect(d.runner(4)).toEqual({ kind: 'name', name: '路人' });
    d.tag(4, null);
    expect(d.runner(4)).toBeNull();
  });

  it('反應時間只在單一跑者時記錄（多人時不知道是誰的）', () => {
    const d = new RaceDraft('two-phone');
    expect(d.toRace(finished([10.9]), { reaction: 0.1484, falseStart: false }).results[0]).toMatchObject({ reaction: 0.148 });
    expect(d.toRace(finished([10.9]), { reaction: 0.08, falseStart: true }).results[0]).toMatchObject({ reaction: 0.08, falseStart: true });
    const multi = new RaceDraft('two-phone').toRace(finished([10.9, 11.2]), { reaction: 0.15 });
    expect(multi.results[0].reaction).toBeUndefined();
  });
});
