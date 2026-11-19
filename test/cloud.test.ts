import { describe, expect, it } from 'vitest';
import { CloudClient, CloudError, isValidEmail } from '../src/cloud/client';
import { cloudConfigured } from '../src/cloud/config';
import { deleteAccount, fetchMyNickname, nicknameAvailable, nicknameProblem, saveNickname, searchPeople } from '../src/cloud/profile';
import { FakeCloud, memoryStorage } from './fakeCloud';

const CFG = { url: 'https://fake.supabase.co', key: 'anon-key' };

function setup(cloud = new FakeCloud(), storage = memoryStorage()) {
  const client = new CloudClient(CFG, cloud.fetch, storage, () => cloud.nowS * 1000);
  return { cloud, storage, client };
}

async function login(cloud: FakeCloud, email: string, nickname?: string) {
  const { client, storage } = setup(cloud);
  await client.init();
  await client.requestCode(email);
  await client.verifyCode(email, cloud.codeFor(email));
  if (nickname) expect(await saveNickname(client, nickname)).toBe('ok');
  return { client, storage };
}

describe('Email 驗證碼登入', () => {
  it('寄認證信、輸入驗證碼後登入，第一次登入自動建立帳號', async () => {
    const { cloud, client, storage } = setup();
    expect(await client.init()).toBeNull();
    await client.requestCode('  Nick@Example.com ');
    expect(cloud.sentEmails).toHaveLength(1);
    expect(cloud.sentEmails[0].to).toBe('nick@example.com');
    const user = await client.verifyCode('Nick@Example.com', ` ${cloud.sentEmails[0].code} `);
    expect(user.email).toBe('nick@example.com');
    expect(client.user?.id).toBe(user.id);
    expect(storage.box.value).toContain(user.id);
  });

  it('驗證碼錯誤時不會登入，並回報可以顯示給使用者的原因', async () => {
    const { client } = setup();
    await client.requestCode('a@example.com');
    await expect(client.verifyCode('a@example.com', '000000')).rejects.toMatchObject({ kind: 'invalid', message: '驗證碼不對或已過期' });
    await expect(client.verifyCode('a@example.com', '12')).rejects.toMatchObject({ kind: 'invalid' });
    expect(client.user).toBeNull();
  });

  it('Email 格式不對時不送出', async () => {
    const { cloud, client } = setup();
    await expect(client.requestCode('not-an-email')).rejects.toBeInstanceOf(CloudError);
    expect(cloud.requests).toHaveLength(0);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });

  it('重開 App 後仍是登入狀態（不需要網路）', async () => {
    const cloud = new FakeCloud();
    const { storage, client: first } = await login(cloud, 'a@example.com');
    cloud.offline = true;
    const again = new CloudClient(CFG, cloud.fetch, storage, () => cloud.nowS * 1000);
    expect((await again.init())?.id).toBe(first.user!.id);
  });

  it('憑證快到期會自動換新，同時多個請求只換一次', async () => {
    const cloud = new FakeCloud();
    const { client } = await login(cloud, 'a@example.com', '阿凱');
    cloud.nowS += cloud.tokenLifeS - 10;
    cloud.requests.length = 0;
    const [a, b] = await Promise.all([fetchMyNickname(client), fetchMyNickname(client)]);
    expect([a, b]).toEqual(['阿凱', '阿凱']);
    expect(cloud.requests.filter((r) => r.includes('/auth/v1/token'))).toHaveLength(1);
  });

  it('登入失效（refresh token 被拒）時變成登出並通知', async () => {
    const cloud = new FakeCloud();
    const { client } = await login(cloud, 'a@example.com');
    const seen: (string | null)[] = [];
    client.onChange((s) => seen.push(s?.user.id ?? null));
    cloud.refreshTokens.clear();
    cloud.nowS += cloud.tokenLifeS + 1;
    await expect(fetchMyNickname(client)).rejects.toMatchObject({ kind: 'auth' });
    expect(client.user).toBeNull();
    expect(seen).toEqual([null]);
  });

  it('沒網路時換不了憑證，但不會被登出', async () => {
    const cloud = new FakeCloud();
    const { client } = await login(cloud, 'a@example.com');
    cloud.nowS += cloud.tokenLifeS + 1;
    cloud.offline = true;
    await expect(client.select('profiles', {})).rejects.toMatchObject({ kind: 'network' });
    expect(client.user).not.toBeNull();
  });

  it('沒網路也能登出', async () => {
    const cloud = new FakeCloud();
    const { client, storage } = await login(cloud, 'a@example.com');
    cloud.offline = true;
    await client.signOut();
    expect(client.user).toBeNull();
    expect(storage.box.value).toBeNull();
  });

  it('還沒填雲端設定時視為未啟用', () => {
    expect(cloudConfigured({ url: '', key: '' })).toBe(false);
    expect(cloudConfigured(CFG)).toBe(true);
  });
});

describe('暱稱', () => {
  it('長度以字計算：2 到 16 個字', () => {
    expect(nicknameProblem('凱')).not.toBeNull();
    expect(nicknameProblem('阿凱')).toBeNull();
    expect(nicknameProblem('一二三四五六七八九十一二三四五六')).toBeNull();
    expect(nicknameProblem('一二三四五六七八九十一二三四五六七')).not.toBeNull();
    expect(nicknameProblem('a@b')).not.toBeNull();
  });

  it('不能和別人重複（不分大小寫），自己的可以改', async () => {
    const cloud = new FakeCloud();
    const a = await login(cloud, 'a@example.com', 'Mia');
    const b = await login(cloud, 'b@example.com');
    expect(await fetchMyNickname(b.client)).toBeNull();
    expect(await nicknameAvailable(b.client, 'mia')).toBe(false);
    expect(await saveNickname(b.client, 'MIA')).toBe('taken');
    expect(await nicknameAvailable(a.client, 'mia')).toBe(true);
    expect(await saveNickname(a.client, 'Mia2')).toBe('ok');
    expect(await saveNickname(b.client, 'Mia')).toBe('ok');
  });

  it('用暱稱或完整 Email 找人，不會找到自己', async () => {
    const cloud = new FakeCloud();
    const a = await login(cloud, 'a@example.com', 'Mia');
    await login(cloud, 'b@example.com', 'Mike_400');
    await login(cloud, 'c@example.com', '阿哲');
    expect((await searchPeople(a.client, 'mi')).map((p) => p.nickname)).toEqual(['Mike_400']);
    expect((await searchPeople(a.client, '哲')).map((p) => p.nickname)).toEqual(['阿哲']);
    expect((await searchPeople(a.client, 'C@example.com')).map((p) => p.nickname)).toEqual(['阿哲']);
    expect(await searchPeople(a.client, 'c@example')).toEqual([]);
    expect(await searchPeople(a.client, '  ')).toEqual([]);
  });

  it('刪除帳號後登出，暱稱可以再被別人使用', async () => {
    const cloud = new FakeCloud();
    const a = await login(cloud, 'a@example.com', 'Mia');
    const b = await login(cloud, 'b@example.com');
    await deleteAccount(a.client);
    expect(a.client.user).toBeNull();
    expect(await saveNickname(b.client, 'Mia')).toBe('ok');
  });
});
