import { expect, it } from 'vitest';
import { CloudClient } from '../src/cloud/client';
import { CLOUD } from '../src/cloud/config';
import { deleteAccount, fetchMyNickname, registerEmail, saveNickname, searchPeople, untagMe } from '../src/cloud/profile';
import { RecordStore, uuid } from '../src/records/store';
import { RecordSync } from '../src/records/sync';
import { memoryStorage } from './testCloud';

/**
 * 對「真的」Firebase 專案（cloud.config.json）跑一遍主要流程，平常不會跑。
 * 用法：GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token) npx vitest run test/realProject.test.ts
 * 需要專案擁有者的憑證：用管理 API 產生登入連結（不會真的寄信），建立兩個 @example.com 測試帳號，結束時連同資料一起刪掉。
 */
const TOKEN = process.env.GOOGLE_ACCESS_TOKEN ?? '';
const RUN = Date.now().toString(36);

async function adminLink(email: string): Promise<string> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${CLOUD.projectId}/accounts:sendOobCode`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': CLOUD.projectId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, continueUrl: `https://${CLOUD.projectId}.firebaseapp.com/`, canHandleCodeInApp: true, returnOobLink: true }),
  });
  const json: any = await res.json();
  if (!json.oobLink) throw new Error(JSON.stringify(json));
  return json.oobLink;
}

async function phone(email: string, nickname: string) {
  const client = new CloudClient(CLOUD, (url, init) => fetch(url, init), memoryStorage());
  await client.init();
  await client.signInWithLink(await adminLink(email), email);
  await registerEmail(client);
  expect(await saveNickname(client, nickname)).toBe('ok');
  const file = memoryStorage();
  const store = new RecordStore({ load: file.load, save: (v) => file.save(v) });
  await store.load();
  return { client, store, sync: new RecordSync(client, store), uid: client.user!.id, email };
}

it.skipIf(!TOKEN)('真的 Firebase 專案：登入、暱稱、同步、標記、權限、刪除帳號', async () => {
  const an = await phone(`smoke-a-${RUN}@example.com`, `測試安${RUN}`);
  const nick = await phone(`smoke-b-${RUN}@example.com`, `SN${RUN}`);
  try {
    expect(await fetchMyNickname(an.client)).toBe(`測試安${RUN}`);
    expect(await saveNickname(nick.client, `測試安${RUN}`)).toBe('taken');
    expect((await searchPeople(an.client, `sn${RUN}`.slice(1, 7))).some((p) => p.id === nick.uid)).toBe(true);
    expect(await searchPeople(an.client, nick.email.toUpperCase())).toEqual([{ id: nick.uid, nickname: `SN${RUN}` }]);

    const raceId = uuid();
    const ids = [uuid(), uuid(), uuid()];
    const race = {
      id: raceId,
      ranAt: new Date().toISOString(),
      distanceM: 100,
      mode: 'two-phone' as const,
      results: [
        { id: ids[0], place: 1, time: 10.953, official: 10.96, auto: true, runner: { kind: 'self' as const } },
        { id: ids[1], place: 2, time: 11.062, official: 11.07, auto: true, runner: { kind: 'user' as const, id: nick.uid, nickname: 'x' } },
        { id: ids[2], place: 3, time: 11.5, official: 11.5, auto: false, runner: { kind: 'name' as const, name: '路人' } },
      ],
    };
    await an.store.saveRace(race, an.uid);
    await an.sync.sync();
    expect(an.sync.status).toMatchObject({ state: 'idle' });
    expect(an.store.pendingCount(an.uid)).toBe(0);

    await nick.sync.sync();
    expect(nick.sync.status).toMatchObject({ state: 'idle' });
    const mine = nick.store.myResults(nick.uid);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ official: 11.07, place: 2, distanceM: 100, timedBy: { id: an.uid, nickname: `測試安${RUN}` } });

    // 權限：Nick 讀不到、改不了別人的
    const denied = { status: 403 };
    await expect(nick.client.query('results', [['owner', '==', an.uid]])).rejects.toMatchObject(denied);
    await expect(nick.client.getDoc(`results/${ids[0]}`)).rejects.toMatchObject(denied);
    await expect(nick.client.commit([{ patch: `results/${ids[1]}`, data: { time: 1 } }])).rejects.toMatchObject(denied);
    await expect(nick.client.commit([{ delete: `results/${ids[0]}` }])).rejects.toMatchObject(denied);
    await expect(nick.client.commit([{ set: `users/${an.uid}`, data: { nickname: 'Hacked', nicknameKey: 'hacked', search: [] } }])).rejects.toMatchObject(denied);
    await expect(nick.client.query('emails', [['uid', '==', an.uid]])).rejects.toMatchObject(denied);

    // 換新手機：紀錄回來；刪掉一位跑者後雲端跟著少
    const an2 = { store: new RecordStore(memoryStorage() as any) };
    await an2.store.load();
    const sync2 = new RecordSync(an.client, an2.store);
    await sync2.sync();
    expect(an2.store.races()).toHaveLength(1);
    expect(an2.store.races()[0].results.map((r) => r.runner?.kind)).toEqual(['self', 'user', 'name']);
    await an.store.saveRace({ ...race, results: race.results.slice(0, 2) }, an.uid);
    await an.sync.sync();
    expect(await an.client.query('results', [['owner', '==', an.uid]])).toHaveLength(2);

    await untagMe(nick.client, ids[1], 'SmokeNick');
    await nick.sync.sync();
    expect(nick.store.myResults(nick.uid)).toHaveLength(0);
    await an.sync.sync();
    expect(an.store.race(raceId)!.results[1].runner).toEqual({ kind: 'name', name: 'SmokeNick' });
  } finally {
    // 清乾淨：測試帳號和資料都刪掉
    await deleteAccount(an.client);
    await deleteAccount(nick.client);
  }
  expect(an.client.user).toBeNull();
}, 120_000);
