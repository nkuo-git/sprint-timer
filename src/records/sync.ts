import { isOffline, type CloudClient, type Doc, type Write } from '../cloud/client';
import type { Fields } from '../cloud/values';
import type { RecordStore } from './store';
import type { Runner, StoredRace, StoredResult, TaggedResult } from './types';

export type SyncMode = 'full' | 'push';
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** 上次成功同步的時間（epoch ms） */
  lastOk: number | null;
  error?: string;
}

/**
 * 把手機上的紀錄和雲端對齊：先上傳本機的修改，再抓雲端的（換手機時就是靠這個把紀錄帶回來）。
 * 本機還沒上傳的修改優先，不會被雲端的舊資料蓋掉。
 */
export class RecordSync {
  status: SyncStatus = { state: 'idle', lastOk: null };
  private running: Promise<void> | null = null;
  private again: SyncMode | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly cloud: CloudClient,
    private readonly store: RecordStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(status: SyncStatus) {
    this.status = status;
    for (const fn of this.listeners) fn();
  }

  /**
   * 同步一次。mode 'push' 只上傳本機的修改（存完成績後用，省雲端讀取量）；'full' 還會把雲端的抓回來。
   * 已經在同步中就排在後面再跑一次，確保剛存的修改也會上傳。不會丟出錯誤，結果看 status。
   */
  sync(mode: SyncMode = 'full'): Promise<void> {
    if (this.running) {
      if (this.again !== 'full') this.again = mode;
      return this.running;
    }
    this.running = (async () => {
      try {
        let next: SyncMode | null = mode;
        while (next) {
          this.again = null;
          await this.once(next);
          next = this.again;
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async once(mode: SyncMode) {
    const uid = this.cloud.user?.id;
    if (!uid) return;
    this.set({ ...this.status, state: 'syncing', error: undefined });
    try {
      await this.push(uid);
      if (mode === 'full') await this.pull(uid);
      await this.store.commit();
      this.set({ state: 'idle', lastOk: this.now() });
    } catch (e: any) {
      await this.store.commit();
      if (this.cloud.user?.id !== uid) this.set({ state: 'idle', lastOk: this.status.lastOk });
      else if (isOffline(e)) this.set({ state: 'offline', lastOk: this.status.lastOk });
      else this.set({ state: 'error', lastOk: this.status.lastOk, error: e?.message ?? String(e) });
    }
  }

  /** 上傳本機修改過的比賽（含未登入時存的，歸到現在登入的帳號） */
  private async push(uid: string) {
    const todo = this.store.data.races.filter((r) => r.dirty && (r.owner === null || r.owner === uid));
    for (const race of todo) {
      const rev = race.rev;
      // 雲端上這趟現在有哪些成績：已經被刪掉的要一起刪
      const remote = await this.cloud.query('results', [
        ['owner', '==', uid],
        ['raceId', '==', race.id],
      ]);
      if (race.deleted) {
        await this.cloud.commit(remote.map((d): Write => ({ delete: `results/${d.id}` })));
        if (race.rev === rev) this.store.data.races = this.store.data.races.filter((r) => r !== race);
        continue;
      }
      const keep = new Set(race.results.map((r) => r.id));
      // 一趟比賽的所有成績一次送出：全部成功或全部不變
      await this.cloud.commit([
        ...race.results.map((r): Write => ({ set: `results/${r.id}`, data: toFields(r, race, uid) })),
        ...remote.filter((d) => !keep.has(d.id)).map((d): Write => ({ delete: `results/${d.id}` })),
      ]);
      race.owner = uid;
      if (race.rev === rev) race.dirty = false;
    }
  }

  private async pull(uid: string) {
    // 1. 我計時的成績（每筆成績一份文件，帶著那一趟的時間、距離等資料），依比賽分組
    const owned = await this.cloud.query('results', [['owner', '==', uid]]);
    const byRace = new Map<string, Doc[]>();
    for (const d of owned) {
      const raceId = String(d.data.raceId ?? '');
      if (!raceId) continue;
      byRace.set(raceId, [...(byRace.get(raceId) ?? []), d]);
    }
    // 2. 別人標記給我的成績
    const others = (await this.cloud.query('results', [['taggedTo', '==', uid]])).filter((d) => d.data.owner !== uid && typeof d.data.owner === 'string');

    // 3. 用到的暱稱（被我標記的人、幫我計時的人）
    const ids = new Set<string>();
    for (const d of owned) if (typeof d.data.runner === 'string' && d.data.runner !== uid) ids.add(d.data.runner);
    for (const d of others) ids.add(d.data.owner as string);
    const names = new Map<string, string>();
    for (const d of await this.cloud.getDocs([...ids].map((id) => `users/${id}`))) {
      if (typeof d.data.nickname === 'string') names.set(d.id, d.data.nickname);
    }

    // 登入的帳號在抓資料途中換了：這批資料不是現在這個人的，丟掉
    if (this.cloud.user?.id !== uid) return;

    for (const [raceId, docs] of byRace) {
      const local = this.store.race(raceId);
      if (local?.dirty) continue;
      const race = toRace(raceId, docs, uid, names);
      if (local) Object.assign(local, race, { rev: local.rev });
      else this.store.data.races.push(race);
      for (const r of race.results) if (r.runner?.kind === 'user') this.store.touchRecent({ id: r.runner.id, nickname: r.runner.nickname, at: race.ranAt });
    }
    // 雲端已經沒有的（在另一支手機刪掉了）本機也拿掉
    this.store.data.races = this.store.data.races.filter((r) => r.owner !== uid || r.dirty || byRace.has(r.id));

    const tagged: TaggedResult[] = others.map((d) => {
      const x = d.data;
      const owner = x.owner as string;
      return {
        resultId: d.id,
        raceId: String(x.raceId ?? ''),
        ranAt: isoTime(x.ranAt),
        distanceM: num(x.distanceM),
        mode: x.mode === 'two-phone' ? 'two-phone' : 'single-phone',
        place: num(x.place) ?? 1,
        time: num(x.time) ?? 0,
        official: num(x.official) ?? 0,
        reaction: num(x.reaction) ?? undefined,
        falseStart: x.falseStart === true || undefined,
        timerId: owner,
        timerNickname: names.get(owner) ?? null,
      };
    });
    this.store.setTagged(tagged);
  }
}

/** 一筆成績在雲端的樣子（results 集合的一份文件）。欄位要和 firestore.rules 的檢查一致。 */
function toFields(r: StoredResult, race: StoredRace, uid: string): Fields {
  const runner = r.runner?.kind === 'self' ? uid : r.runner?.kind === 'user' ? r.runner.id : null;
  return {
    owner: uid,
    raceId: race.id,
    ranAt: race.ranAt,
    distanceM: race.distanceM,
    mode: race.mode,
    signal: race.signal ?? null,
    place: r.place,
    time: round(r.time, 3),
    official: round(r.official, 2),
    reaction: r.reaction === undefined ? null : round(r.reaction, 3),
    falseStart: !!r.falseStart,
    auto: r.auto,
    runner,
    // 標記給「別人」時才有值：對方用這個欄位查到自己被標記的成績
    taggedTo: runner !== null && runner !== uid ? runner : null,
    runnerName: r.runner?.kind === 'name' ? r.runner.name.slice(0, 40) : null,
  };
}

function toRace(raceId: string, docs: Doc[], uid: string, names: Map<string, string>): StoredRace {
  const results: StoredResult[] = docs
    .map((d): StoredResult => {
      const x = d.data;
      let runner: Runner | null = null;
      if (x.runner === uid) runner = { kind: 'self' };
      else if (typeof x.runner === 'string' && x.runner) runner = { kind: 'user', id: x.runner, nickname: names.get(x.runner) ?? '用戶' };
      else if (typeof x.runnerName === 'string' && x.runnerName) runner = { kind: 'name', name: x.runnerName };
      const out: StoredResult = { id: d.id, place: num(x.place) ?? 1, time: num(x.time) ?? 0, official: num(x.official) ?? 0, auto: x.auto === true, runner };
      const reaction = num(x.reaction);
      if (reaction !== null) out.reaction = reaction;
      if (x.falseStart === true) out.falseStart = true;
      return out;
    })
    .sort((a, b) => a.place - b.place);
  const head = docs[0].data;
  const race: StoredRace = {
    id: raceId,
    ranAt: isoTime(head.ranAt),
    distanceM: num(head.distanceM),
    mode: head.mode === 'two-phone' ? 'two-phone' : 'single-phone',
    results,
    owner: uid,
    dirty: false,
    rev: 1,
  };
  if (head.signal === 'sound' || head.signal === 'flash') race.signal = head.signal;
  return race;
}

function isoTime(v: unknown): string {
  const d = new Date(typeof v === 'string' ? v : 0);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

