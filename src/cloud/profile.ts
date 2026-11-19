import { CloudError, type CloudClient } from './client';

export interface Person {
  id: string;
  nickname: string;
}

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

/** 以「字」計算長度（中文一個字算 1，和資料庫的 char_length 一致） */
export function nicknameLength(nickname: string): number {
  return [...nickname.trim()].length;
}

/** 暱稱不合規定時回傳原因，沒問題回傳 null */
export function nicknameProblem(nickname: string): string | null {
  const n = nicknameLength(nickname);
  if (n < NICKNAME_MIN) return `至少 ${NICKNAME_MIN} 個字`;
  if (n > NICKNAME_MAX) return `最多 ${NICKNAME_MAX} 個字`;
  if (nickname.includes('@')) return '暱稱不能有 @';
  return null;
}

export async function fetchMyNickname(cloud: CloudClient): Promise<string | null> {
  const uid = cloud.user?.id;
  if (!uid) return null;
  const rows = await cloud.select<Person>('profiles', { select: 'id,nickname', id: `eq.${uid}`, limit: 1 });
  return rows[0]?.nickname ?? null;
}

/** 暱稱有沒有被別人用掉（不分大小寫）。自己現在的暱稱算可以用。 */
export async function nicknameAvailable(cloud: CloudClient, nickname: string): Promise<boolean> {
  const rows = await cloud.select<Person>('profiles', { select: 'id', nickname_key: `eq.${nickname.trim().toLowerCase()}`, limit: 1 });
  return rows.length === 0 || rows[0].id === cloud.user?.id;
}

/** 設定或修改暱稱。被別人用掉時回傳 'taken'。 */
export async function saveNickname(cloud: CloudClient, nickname: string): Promise<'ok' | 'taken'> {
  const uid = cloud.user?.id;
  if (!uid) throw new CloudError('auth', '尚未登入', 401);
  const problem = nicknameProblem(nickname);
  if (problem) throw new CloudError('invalid', problem);
  try {
    await cloud.upsert('profiles', { id: uid, nickname: nickname.trim() });
    return 'ok';
  } catch (e) {
    if (e instanceof CloudError && e.kind === 'conflict') return 'taken';
    throw e;
  }
}

/** 找人來標記：輸入暱稱的一部分，或對方完整的 Email。不會回傳自己。 */
export async function searchPeople(cloud: CloudClient, query: string): Promise<Person[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = (await cloud.rpc<Person[]>('search_profiles', { q })) ?? [];
  return rows.filter((p) => p.id !== cloud.user?.id);
}

/** 把別人標記給我的某筆成績從我的紀錄拿掉 */
export function untagMe(cloud: CloudClient, resultId: string): Promise<void> {
  return cloud.rpc('untag_me', { result_id: resultId });
}

/** 刪除帳號與雲端上的所有紀錄，然後登出 */
export async function deleteAccount(cloud: CloudClient): Promise<void> {
  await cloud.rpc('delete_my_account');
  await cloud.signOut();
}
