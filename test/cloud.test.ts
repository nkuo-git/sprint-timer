import { describe, expect, it } from 'vitest';
import { CloudClient, CloudError, extractLoginCode, isLoginLink, isValidEmail } from '../src/cloud/client';
import { cloudConfigured } from '../src/cloud/config';
import { deleteAccount, fetchMyNickname, nicknameAvailable, nicknameProblem, registerEmail, saveNickname, searchKeys, searchPeople } from '../src/cloud/profile';
import { decodeFields, encodeFields } from '../src/cloud/values';
import { makeCloud, memoryStorage, type TestCloud } from './testCloud';

function setup(cloud: TestCloud, storage = memoryStorage()) {
  const client = new CloudClient(cloud.config, cloud.fetch, storage, () => cloud.nowS * 1000);
  return { cloud, storage, client };
}

async function login(cloud: TestCloud, email: string, nickname?: string) {
  const { client, storage } = setup(cloud);
  await client.init();
  await client.requestLink(email);
  await client.signInWithLink(await cloud.linkFor(email));
  await registerEmail(client);
  if (nickname) expect(await saveNickname(client, nickname)).toBe('ok');
  return { client, storage };
}

describe('Email 連結登入', () => {
  it('寄登入信、點信裡的連結後登入，第一次登入自動建立帳號', async () => {
    const { cloud, client, storage } = setup(await makeCloud());
    expect(await client.init()).toBeNull();
    await client.requestLink('  Nick@Example.com ');
    expect(await cloud.mailed()).toEqual(['nick@example.com']);
    expect(client.pendingEmail).toBe('nick@example.com');
    const user = await client.signInWithLink(await cloud.linkFor('nick@example.com'));
    expect(user.email).toBe('nick@example.com');
    expect(client.user?.id).toBe(user.id);
    expect(client.pendingEmail).toBeNull();
    expect(storage.box.value).toContain(user.id);
  });

  it('寄信後 App 被關掉再打開，仍記得在等哪個 Email 的連結', async () => {
    const cloud = await makeCloud();
    const { client, storage } = setup(cloud);
    await client.init();
    await client.requestLink('a@example.com');
    const reopened = new CloudClient(cloud.config, cloud.fetch, storage, () => cloud.nowS * 1000);
    await reopened.init();
    expect(reopened.pendingEmail).toBe('a@example.com');
    const user = await reopened.signInWithLink(await cloud.linkFor('a@example.com'));
    expect(user.email).toBe('a@example.com');
    await reopened.signOut();
    expect(storage.box.value).toBeNull();
  });

  it('連結用過就失效；不是連結、沒寄過信、Email 對不上都不會登入', async () => {
    const cloud = await makeCloud();
    const { client } = setup(cloud);
    await expect(client.signInWithLink('https://example.com/?oobCode=abcdefghijklmnopqrstuvwxyz')).rejects.toMatchObject({ kind: 'invalid' });
    await client.requestLink('a@example.com');
    const link = await cloud.linkFor('a@example.com');
    await expect(client.signInWithLink('https://example.com/hello')).rejects.toMatchObject({ kind: 'invalid', message: '這不是登入信裡的連結' });
    await expect(client.signInWithLink(link, 'b@example.com')).rejects.toMatchObject({ kind: 'invalid' });
    expect(client.user).toBeNull();
    await client.signInWithLink(link);
    await client.signOut();
    await expect(client.signInWithLink(link, 'a@example.com')).rejects.toMatchObject({ kind: 'invalid', code: 'INVALID_OOB_CODE' });
    expect(client.user).toBeNull();
  });

  it('從各種形式的連結取出登入碼', () => {
    const code = 'OiDoI_5Z8kH4PBK6VB2LYWQ-6CEwIdrG4t0RRgGp_zMAAAGh8qJBGw';
    const action = `https://p.firebaseapp.com/__/auth/action?apiKey=k&mode=signIn&oobCode=${code}&continueUrl=https://p.firebaseapp.com/&lang=zh-TW`;
    expect(extractLoginCode(action)).toBe(code);
    // 外面再包一層（真的專案在指定 Android 套件時寄出的格式）
    expect(extractLoginCode(`https://p.firebaseapp.com/__/auth/links?link=https://p.firebaseapp.com/__/auth/action?apiKey%3Dk%26mode%3DsignIn%26oobCode%3D${code}%26lang%3Den`)).toBe(code);
    expect(extractLoginCode(`  https://p.firebaseapp.com/__/auth/links?link=${encodeURIComponent(encodeURIComponent(action))}  `)).toBe(code);
    expect(extractLoginCode('https://p.firebaseapp.com/')).toBeNull();
    expect(extractLoginCode('100%')).toBeNull();
    expect(isLoginLink(action)).toBe(true);
    expect(isLoginLink(null)).toBe(false);
  });

  it('Email 格式不對時不送出', async () => {
    const { cloud, client } = setup(await makeCloud());
    await expect(client.requestLink('not-an-email')).rejects.toBeInstanceOf(CloudError);
    expect(cloud.requests).toHaveLength(0);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });

  it('重開 App 後仍是登入狀態（不需要網路）', async () => {
    const cloud = await makeCloud();
    const { storage, client: first } = await login(cloud, 'a@example.com');
    cloud.offline = true;
    const again = new CloudClient(cloud.config, cloud.fetch, storage, () => cloud.nowS * 1000);
    expect((await again.init())?.id).toBe(first.user!.id);
  });

  it('憑證快到期會自動換新，同時多個請求只換一次', async () => {
    const cloud = await makeCloud();
    const { client } = await login(cloud, 'a@example.com', '阿凱');
    cloud.nowS += cloud.tokenLifeS - 10;
    cloud.requests.length = 0;
    const [a, b] = await Promise.all([fetchMyNickname(client), fetchMyNickname(client)]);
    expect([a, b]).toEqual(['阿凱', '阿凱']);
    expect(cloud.requests.filter((r) => r.includes('securetoken'))).toHaveLength(1);
  });

  it('登入失效（帳號在伺服器上不見了）時變成登出並通知', async () => {
    const cloud = await makeCloud();
    const { client } = await login(cloud, 'a@example.com');
    const seen: (string | null)[] = [];
    client.onChange((s) => seen.push(s?.user.id ?? null));
    await cloud.dropAccounts();
    cloud.nowS += cloud.tokenLifeS + 1;
    await expect(fetchMyNickname(client)).rejects.toMatchObject({ kind: 'auth' });
    expect(client.user).toBeNull();
    expect(seen).toEqual([null]);
  });

  it('沒網路時換不了憑證，但不會被登出', async () => {
    const cloud = await makeCloud();
    const { client } = await login(cloud, 'a@example.com');
    cloud.nowS += cloud.tokenLifeS + 1;
    cloud.offline = true;
    await expect(fetchMyNickname(client)).rejects.toMatchObject({ kind: 'network' });
    expect(client.user).not.toBeNull();
  });

  it('沒網路也能登出', async () => {
    const cloud = await makeCloud();
    const { client, storage } = await login(cloud, 'a@example.com');
    cloud.offline = true;
    await client.signOut();
    expect(client.user).toBeNull();
    expect(storage.box.value).toBeNull();
  });

  it('還沒填雲端設定時視為未啟用', () => {
    expect(cloudConfigured({ projectId: '', apiKey: '' })).toBe(false);
    expect(cloudConfigured({ projectId: 'sprint-timer-1a2b3c', apiKey: '' })).toBe(false);
    expect(cloudConfigured({ projectId: 'sprint-timer-1a2b3c', apiKey: 'k' })).toBe(true);
  });

  it('Firestore 的資料格式來回轉換不失真', () => {
    const data = { a: null, b: true, c: 3, d: 11.07, e: '字', f: ['x', 1, null], g: { h: 'i' } };
    const encoded = encodeFields(data);
    expect(encoded.c).toEqual({ integerValue: '3' });
    expect(encoded.d).toEqual({ doubleValue: 11.07 });
    expect(decodeFields(JSON.parse(JSON.stringify(encoded)))).toEqual(data);
  });
});

describe('暱稱', () => {
  it('長度以字計算：2 到 16 個字', () => {
    expect(nicknameProblem('凱')).not.toBeNull();
    expect(nicknameProblem('阿凱')).toBeNull();
    expect(nicknameProblem('一二三四五六七八九十一二三四五六')).toBeNull();
    expect(nicknameProblem('一二三四五六七八九十一二三四五六七')).not.toBeNull();
    expect(nicknameProblem('a@b')).not.toBeNull();
    expect(nicknameProblem('a/b')).not.toBeNull();
    expect(nicknameProblem('..')).not.toBeNull();
    expect(nicknameProblem('__x__')).not.toBeNull();
    expect(searchKeys('Abc')).toEqual(['a', 'ab', 'abc', 'b', 'bc', 'c']);
    expect(searchKeys('一二三四五六七八九十一二三四五六').length).toBeLessThanOrEqual(160);
  });

  it('不能和別人重複（不分大小寫），自己的可以改', async () => {
    const cloud = await makeCloud();
    const a = await login(cloud, 'a@example.com', 'Mia');
    const b = await login(cloud, 'b@example.com');
    expect(await fetchMyNickname(b.client)).toBeNull();
    expect(await nicknameAvailable(b.client, 'mia')).toBe(false);
    expect(await saveNickname(b.client, 'MIA')).toBe('taken');
    expect(await fetchMyNickname(b.client)).toBeNull();
    expect(await nicknameAvailable(a.client, 'mia')).toBe(true);
    // 自己的暱稱只改大小寫
    expect(await saveNickname(a.client, 'MIA')).toBe('ok');
    expect(await fetchMyNickname(a.client)).toBe('MIA');
    // 改成別的，舊的就放掉，別人可以用
    expect(await saveNickname(a.client, 'Mia2')).toBe('ok');
    expect(await saveNickname(b.client, 'Mia')).toBe('ok');
    expect((await cloud.docs('nicknames')).map((d) => d.id).sort()).toEqual(['mia', 'mia2']);
  });

  it('中文、空白、表情符號的暱稱都能存', async () => {
    const cloud = await makeCloud();
    const a = await login(cloud, 'a@example.com');
    for (const name of ['阿哲', 'Élodie Ünal', 'İstanbul', 'ΑΒΓ', '跑跑 🏃', '一二三四五六七八九十一二三四五六']) {
      expect(await saveNickname(a.client, name)).toBe('ok');
      expect(await fetchMyNickname(a.client)).toBe(name);
    }
  });

  it('不能直接改別人的暱稱或佔用別人已經有的暱稱', async () => {
    const cloud = await makeCloud();
    const a = await login(cloud, 'a@example.com', 'Mia');
    const b = await login(cloud, 'b@example.com', 'Ben');
    const aid = a.client.user!.id;
    const bid = b.client.user!.id;
    const denied = { status: 403 };
    await expect(b.client.commit([{ set: `users/${aid}`, data: { nickname: 'Hacked', nicknameKey: 'hacked', search: [] } }])).rejects.toMatchObject(denied);
    await expect(b.client.commit([{ delete: `users/${aid}` }])).rejects.toMatchObject(denied);
    await expect(b.client.commit([{ delete: 'nicknames/mia' }])).rejects.toMatchObject(denied);
    await expect(b.client.commit([{ set: 'nicknames/mia', data: { uid: bid } }])).rejects.toMatchObject(denied);
    // 個人資料上的暱稱和實際佔到的不一致：不行
    await expect(b.client.commit([{ set: `users/${bid}`, data: { nickname: 'Mia', nicknameKey: 'mia', search: [] } }])).rejects.toMatchObject(denied);
    await expect(b.client.commit([{ set: `users/${bid}`, data: { nickname: 'Mia', nicknameKey: 'ben', search: [] } }])).rejects.toMatchObject(denied);
    // 多佔一個不用的暱稱：不行
    await expect(b.client.commit([{ set: 'nicknames/extra', data: { uid: bid } }])).rejects.toMatchObject(denied);
    expect(await fetchMyNickname(a.client)).toBe('Mia');
  });

  it('用暱稱或完整 Email 找人，不會找到自己', async () => {
    const cloud = await makeCloud();
    const a = await login(cloud, 'a@example.com', 'Mia');
    await login(cloud, 'b@example.com', 'Mike_400');
    await login(cloud, 'c@example.com', '阿哲');
    await login(cloud, 'd@example.com', 'Tomi');
    expect((await searchPeople(a.client, 'mi')).map((p) => p.nickname)).toEqual(['Mike_400', 'Tomi']);
    expect((await searchPeople(a.client, '哲')).map((p) => p.nickname)).toEqual(['阿哲']);
    expect((await searchPeople(a.client, 'C@example.com')).map((p) => p.nickname)).toEqual(['阿哲']);
    expect(await searchPeople(a.client, 'c@example')).toEqual([]);
    expect(await searchPeople(a.client, 'a@example.com')).toEqual([]);
    expect(await searchPeople(a.client, '  ')).toEqual([]);
  });

  it('Email 不能被列出，也不能把別人的 Email 登記成自己', async () => {
    const cloud = await makeCloud();
    const a = await login(cloud, 'a@example.com', 'Mia');
    const b = await login(cloud, 'b@example.com', 'Ben');
    await expect(b.client.query('emails', [['uid', '==', a.client.user!.id]])).rejects.toMatchObject({ status: 403 });
    await expect(b.client.commit([{ set: 'emails/a@example.com', data: { uid: b.client.user!.id } }])).rejects.toMatchObject({ status: 403 });
    await expect(b.client.commit([{ set: 'emails/x@example.com', data: { uid: b.client.user!.id } }])).rejects.toMatchObject({ status: 403 });
    await expect(b.client.commit([{ delete: 'emails/a@example.com' }])).rejects.toMatchObject({ status: 403 });
  });

  it('刪除帳號要最近登入過；刪除後登出，暱稱可以再被別人使用', async () => {
    const cloud = await makeCloud();
    const a = await login(cloud, 'a@example.com', 'Mia');
    const b = await login(cloud, 'b@example.com');
    cloud.nowS += 600;
    await expect(deleteAccount(a.client)).rejects.toMatchObject({ kind: 'auth', code: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' });
    expect(await fetchMyNickname(a.client)).toBe('Mia');
    // 重新登入後就可以刪
    await a.client.signOut();
    await a.client.requestLink('a@example.com');
    await a.client.signInWithLink(await cloud.linkFor('a@example.com'));
    await deleteAccount(a.client);
    expect(a.client.user).toBeNull();
    expect(await cloud.docs('users')).toEqual([]);
    expect(await cloud.docs('emails')).toHaveLength(1);
    expect(await saveNickname(b.client, 'Mia')).toBe('ok');
  });
});
