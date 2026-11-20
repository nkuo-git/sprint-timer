/** 成績屬於誰。self = 這支手機的使用者本人（登入後就是登入的帳號） */
export type Runner =
  | { kind: 'self' }
  | { kind: 'user'; id: string; nickname: string }
  | { kind: 'name'; name: string };

export type RaceMode = 'two-phone' | 'single-phone';

export interface StoredResult {
  id: string;
  place: number;
  /** 成績（秒，千分位） */
  time: number;
  /** 正式成績（進位到百分位） */
  official: number;
  reaction?: number;
  falseStart?: boolean;
  /** 自動偵測（false = 手動新增或調整過） */
  auto: boolean;
  runner: Runner | null;
}

/** 一趟比賽，由終點那支手機儲存 */
export interface StoredRace {
  id: string;
  /** ISO 時間 */
  ranAt: string;
  distanceM: number | null;
  mode: RaceMode;
  signal?: 'sound' | 'flash';
  results: StoredResult[];
  /** 計時者的帳號 id；未登入時存的是 null，登入後上傳時歸到該帳號 */
  owner: string | null;
  /** 有還沒上傳的修改 */
  dirty: boolean;
  /** 已刪除、等待同步到雲端 */
  deleted?: boolean;
  /** 每次本機修改 +1，用來判斷上傳途中有沒有再被改過 */
  rev: number;
}

/** 別人幫我計時、標記給我的成績（唯讀，從雲端抓下來） */
export interface TaggedResult {
  resultId: string;
  raceId: string;
  ranAt: string;
  distanceM: number | null;
  mode: RaceMode;
  place: number;
  time: number;
  official: number;
  reaction?: number;
  falseStart?: boolean;
  timerId: string;
  timerNickname: string | null;
}

/** 一次長跑（GPS 測距），由跑的人自己的手機記錄。存了之後不會再改，只能刪除 */
export interface StoredRun {
  id: string;
  /** 開始時間（ISO） */
  ranAt: string;
  /** GPS 量到的距離（公尺）。跑到目標距離時就是目標距離 */
  distanceM: number;
  /** 跑步時間（秒，不含暫停） */
  durationS: number;
  /** 目標距離（公尺）；自由跑是 null */
  targetM: number | null;
  /** 有目標而且跑到了：同一個目標距離的成績可以互相比 */
  completed: boolean;
  /** 每一公里花的時間（秒）；最後不滿一公里的不算 */
  splitsS: number[];
  /** 路線：每一段一個 encoded polyline 字串（暫停會分段），見 core/gpsTrack.ts */
  track: string[];
  /** 帳號 id；未登入時存的是 null，登入後上傳時歸到該帳號 */
  owner: string | null;
  dirty: boolean;
  deleted?: boolean;
  rev: number;
}

export interface RecentPerson {
  id: string;
  nickname: string;
  /** 最近一次一起跑的時間（ISO） */
  at: string;
}

export interface StoreData {
  v: 1;
  races: StoredRace[];
  /** 長跑紀錄 */
  runs: StoredRun[];
  tagged: TaggedResult[];
  /** 已經看過的「別人標記給我」的成績 id（用來顯示「新」） */
  seenTagged: string[];
  recent: RecentPerson[];
  /** 上次登入的帳號與暱稱（沒網路時開 App 也知道自己是誰） */
  me?: { id: string; nickname: string | null };
}

export function emptyStore(): StoreData {
  return { v: 1, races: [], runs: [], tagged: [], seenTagged: [], recent: [] };
}

/** 「我的成績」列表的一列 */
export interface MyResult {
  key: string;
  raceId: string;
  resultId: string;
  ranAt: string;
  distanceM: number | null;
  mode: RaceMode;
  place: number;
  /** 那一趟總共幾位跑者；別人計時的不知道，為 null */
  runners: number | null;
  time: number;
  official: number;
  reaction?: number;
  falseStart?: boolean;
  /** 誰幫忙計時；自己計時為 null */
  timedBy: { id: string; nickname: string | null } | null;
  isNew: boolean;
}
