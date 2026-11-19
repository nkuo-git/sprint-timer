import { CloudError, normalizeEmail, type CloudClient, type Write } from './client';

export interface Person {
  id: string;
  nickname: string;
}

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;
const WRITE_CHUNK = 400;

/** 以「字」計算長度（中文一個字算 1） */
export function nicknameLength(nickname: string): number {
  return [...nickname.trim()].length;
}

/**
 * 比對暱稱是否重複用的鍵：英文字母不分大小寫。也是 nicknames 集合的文件 id。
 * 只轉 A 到 Z，因為 Firestore 規則的 lower() 只處理英文字母，兩邊算出來要一樣才寫得進去。
 */
export function nicknameKey(nickname: string): string {
  return nickname.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** 暱稱不合規定時回傳原因，沒問題回傳 null */
export function nicknameProblem(nickname: string): string | null {
  const n = nicknameLength(nickname);
  if (n < NICKNAME_MIN) return `至少 ${NICKNAME_MIN} 個字`;
  if (n > NICKNAME_MAX) return `最多 ${NICKNAME_MAX} 個字`;
  if (nickname.includes('@')) return '暱稱不能有 @';
  if (nickname.includes('/')) return '暱稱不能有 /';
  // Firestore 的文件 id 不能是這些
  const key = nicknameKey(nickname);
  if (key === '..' || /^__.*__$/.test(key)) return '這個暱稱不能用，換一個試試';
  return null;
}

/** 暱稱裡所有的連續片段（小寫），讓「輸入暱稱的一部分」可以用 Firestore 查到 */
export function searchKeys(nickname: string): string[] {
  const chars = [...nicknameKey(nickname)];
  const out = new Set<string>();
  for (let i = 0; i < chars.length; i++) for (let j = i + 1; j <= chars.length; j++) out.add(chars.slice(i, j).join(''));
  return [...out];
}

export async function fetchMyNickname(cloud: CloudClient): Promise<string | null> {
  const uid = cloud.user?.id;
  if (!uid) return null;
  const doc = await cloud.getDoc(`users/${uid}`);
  return typeof doc?.data.nickname === 'string' ? doc.data.nickname : null;
}

/** 暱稱有沒有被別人用掉（不分大小寫）。自己現在的暱稱算可以用。 */
export async function nicknameAvailable(cloud: CloudClient, nickname: string): Promise<boolean> {
  if (nicknameProblem(nickname)) return false;
  const doc = await cloud.getDoc(`nicknames/${nicknameKey(nickname)}`);
  return !doc || doc.data.uid === cloud.user?.id;
}

/** 設定或修改暱稱。被別人用掉時回傳 'taken'。 */
export async function saveNickname(cloud: CloudClient, nickname: string): Promise<'ok' | 'taken'> {
  const uid = cloud.user?.id;
  if (!uid) throw new CloudError('auth', '尚未登入', 401);
  const problem = nicknameProblem(nickname);
  if (problem) throw new CloudError('invalid', problem);
  const name = nickname.trim();
  const key = nicknameKey(name);
  const mine = await cloud.getDoc(`users/${uid}`);
  const oldKey = typeof mine?.data.nicknameKey === 'string' ? mine.data.nicknameKey : null;
  const writes: Write[] = [];
  if (oldKey !== key) {
    // 佔下新暱稱（已經有人佔了就會失敗），同時放掉舊的
    writes.push({ set: `nicknames/${key}`, data: { uid }, exists: false });
    if (oldKey) writes.push({ delete: `nicknames/${oldKey}` });
  }
  writes.push({ set: `users/${uid}`, data: { nickname: name, nicknameKey: key, search: searchKeys(name) } });
  try {
    await cloud.commit(writes);
    return 'ok';
  } catch (e) {
    if (e instanceof CloudError && e.kind !== 'network' && oldKey !== key) {
      const holder = await cloud.getDoc(`nicknames/${key}`).catch(() => null);
      if (holder && holder.data.uid !== uid) return 'taken';
    }
    throw e;
  }
}

/** 登記「這個 Email 是我」，別人才能用完整的 Email 找到我。失敗不影響其他功能。 */
export async function registerEmail(cloud: CloudClient): Promise<void> {
  const user = cloud.user;
  if (!user || !user.email || user.email.includes('/')) return;
  await cloud.commit([{ set: `emails/${user.email}`, data: { uid: user.id } }]);
}

/** 找人來標記：輸入暱稱的一部分，或對方完整的 Email。不會回傳自己。 */
export async function searchPeople(cloud: CloudClient, query: string): Promise<Person[]> {
  const q = query.trim();
  if (!q) return [];
  const me = cloud.user?.id;
  if (q.includes('@')) {
    const email = normalizeEmail(q);
    if (email.includes('/')) return [];
    const hit = await cloud.getDoc(`emails/${email}`);
    const uid = typeof hit?.data.uid === 'string' ? hit.data.uid : null;
    if (!uid || uid === me) return [];
    const doc = await cloud.getDoc(`users/${uid}`);
    return typeof doc?.data.nickname === 'string' ? [{ id: uid, nickname: doc.data.nickname }] : [];
  }
  const key = nicknameKey(q);
  const docs = await cloud.query('users', [['search', 'array-contains', key]], 11);
  return docs
    .filter((d) => d.id !== me && typeof d.data.nickname === 'string')
    .map((d) => ({ id: d.id, nickname: d.data.nickname as string }))
    .sort((a, b) => Number(nicknameKey(b.nickname).startsWith(key)) - Number(nicknameKey(a.nickname).startsWith(key)) || a.nickname.localeCompare(b.nickname))
    .slice(0, 10);
}

/** 把別人標記給我的某筆成績從我的紀錄拿掉；計時的人那邊會改成只顯示我的暱稱（不再連到我的帳號） */
export function untagMe(cloud: CloudClient, resultId: string, nickname: string | null): Promise<void> {
  return cloud.commit([{ patch: `results/${resultId}`, data: { runner: null, taggedTo: null, runnerName: nickname ? nickname.slice(0, 40) : null }, exists: true }]);
}

/** 刪除帳號與雲端上的所有紀錄，然後登出 */
export async function deleteAccount(cloud: CloudClient): Promise<void> {
  const user = cloud.user;
  if (!user) return;
  if (!cloud.recentlySignedIn) {
    throw new CloudError('auth', '為了安全，刪除帳號前要重新登入一次：請先登出、再登入，然後在幾分鐘內回來刪除', 401, 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
  }
  const chunks = async (writes: Write[]) => {
    for (let i = 0; i < writes.length; i += WRITE_CHUNK) await cloud.commit(writes.slice(i, i + WRITE_CHUNK));
  };
  // 1. 我計時的成績全部刪掉
  const owned = await cloud.query('results', [['owner', '==', user.id]]);
  await chunks(owned.map((d) => ({ delete: `results/${d.id}` })));
  // 2. 別人標記給我的：解除連結，對方那邊留下我的暱稱
  const me = await cloud.getDoc(`users/${user.id}`);
  const nickname = typeof me?.data.nickname === 'string' ? me.data.nickname : null;
  const tagged = await cloud.query('results', [['taggedTo', '==', user.id]]);
  await chunks(tagged.map((d) => ({ patch: `results/${d.id}`, data: { runner: null, taggedTo: null, runnerName: nickname }, exists: true })));
  // 3. 個人資料、暱稱、Email 登記
  const last: Write[] = [];
  if (me) last.push({ delete: `users/${user.id}` });
  const key = typeof me?.data.nicknameKey === 'string' ? me.data.nicknameKey : null;
  if (key && (await cloud.getDoc(`nicknames/${key}`))?.data.uid === user.id) last.push({ delete: `nicknames/${key}` });
  if (user.email && !user.email.includes('/') && (await cloud.getDoc(`emails/${user.email}`))?.data.uid === user.id) last.push({ delete: `emails/${user.email}` });
  await cloud.commit(last);
  // 4. 登入帳號本身
  await cloud.deleteUser();
}
