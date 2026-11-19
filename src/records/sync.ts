import { isOffline, type CloudClient } from '../cloud/client';
import type { RecordStore } from './store';
import type { Runner, StoredRace, StoredResult, TaggedResult } from './types';

const PAGE = 1000;

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
  private again = false;
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

  /** 同步一次。已經在同步中就排在後面再跑一次，確保剛存的修改也會上傳。不會丟出錯誤，結果看 status。 */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.once();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async once() {
    const uid = this.cloud.user?.id;
    if (!uid) return;
    this.set({ ...this.status, state: 'syncing', error: undefined });
    try {
      await this.push(uid);
      await this.pull(uid);
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
      if (race.deleted) {
        await this.cloud.remove('races', { id: `eq.${race.id}` });
        if (race.rev === rev) this.store.data.races = this.store.data.races.filter((r) => r !== race);
        continue;
      }
      await this.cloud.upsert('races', {
        id: race.id,
        owner: uid,
        ran_at: race.ranAt,
        distance_m: race.distanceM,
        mode: race.mode,
        signal: race.signal ?? null,
      });
      const rows = race.results.map((r) => toRow(r, race.id, uid));
      if (rows.length) await this.cloud.upsert('results', rows);
      // 這趟裡已經被刪掉的成績，雲端也要刪
      await this.cloud.remove('results', {
        race_id: `eq.${race.id}`,
        ...(rows.length ? { id: `not.in.(${rows.map((r) => r.id).join(',')})` } : {}),
      });
      race.owner = uid;
      if (race.rev === rev) race.dirty = false;
    }
  }

  private async pull(uid: string) {
    // 1. 我計時的比賽
    const remote = await this.cloud.select<any>('races', {
      select: 'id,owner,ran_at,distance_m,mode,signal,results(id,place,time_s,official_s,reaction_s,false_start,auto,runner,runner_name)',
      owner: `eq.${uid}`,
      order: 'ran_at.desc',
      limit: PAGE,
    });
    // 2. 別人標記給我的成績
    const taggedRows = await this.cloud.select<any>('results', {
      select: 'id,place,time_s,official_s,reaction_s,false_start,race:races!inner(id,owner,ran_at,distance_m,mode)',
      runner: `eq.${uid}`,
      limit: PAGE,
    });
    const others = taggedRows.filter((t) => t.race && t.race.owner !== uid);

    // 3. 用到的暱稱（被我標記的人、幫我計時的人）
    const ids = new Set<string>();
    for (const race of remote) for (const r of race.results ?? []) if (r.runner && r.runner !== uid) ids.add(r.runner);
    for (const t of others) ids.add(t.race.owner);
    const names = await this.nicknames([...ids]);

    // 登入的帳號在抓資料途中換了：這批資料不是現在這個人的，丟掉
    if (this.cloud.user?.id !== uid) return;

    const remoteIds = new Set<string>();
    for (const row of remote) {
      remoteIds.add(row.id);
      const local = this.store.race(row.id);
      if (local?.dirty) continue;
      const race = fromRow(row, uid, names);
      if (local) Object.assign(local, race, { rev: local.rev });
      else this.store.data.races.push(race);
      for (const r of race.results) if (r.runner?.kind === 'user') this.store.touchRecent({ id: r.runner.id, nickname: r.runner.nickname, at: race.ranAt });
    }
    // 雲端已經沒有的（在另一支手機刪掉了）本機也拿掉。抓到上限時無法判斷，就不刪。
    if (remote.length < PAGE) {
      this.store.data.races = this.store.data.races.filter((r) => r.owner !== uid || r.dirty || remoteIds.has(r.id));
    }

    const tagged: TaggedResult[] = others.map((t) => ({
      resultId: t.id,
      raceId: t.race.id,
      ranAt: new Date(t.race.ran_at).toISOString(),
      distanceM: num(t.race.distance_m),
      mode: t.race.mode,
      place: t.place,
      time: Number(t.time_s),
      official: Number(t.official_s),
      reaction: num(t.reaction_s) ?? undefined,
      falseStart: t.false_start || undefined,
      timerId: t.race.owner,
      timerNickname: names.get(t.race.owner) ?? null,
    }));
    this.store.setTagged(tagged);
  }

  private async nicknames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const rows = await this.cloud.select<{ id: string; nickname: string }>('profiles', {
        select: 'id,nickname',
        id: `in.(${ids.slice(i, i + 100).join(',')})`,
      });
      for (const r of rows) out.set(r.id, r.nickname);
    }
    return out;
  }
}

function toRow(r: StoredResult, raceId: string, uid: string) {
  const runner = r.runner;
  return {
    id: r.id,
    race_id: raceId,
    place: r.place,
    time_s: round(r.time, 3),
    official_s: round(r.official, 2),
    reaction_s: r.reaction === undefined ? null : round(r.reaction, 3),
    false_start: !!r.falseStart,
    auto: r.auto,
    runner: runner?.kind === 'self' ? uid : runner?.kind === 'user' ? runner.id : null,
    runner_name: runner?.kind === 'name' ? runner.name.slice(0, 40) : null,
  };
}

function fromRow(row: any, uid: string, names: Map<string, string>): StoredRace {
  const results: StoredResult[] = (row.results ?? [])
    .map((r: any): StoredResult => {
      let runner: Runner | null = null;
      if (r.runner === uid) runner = { kind: 'self' };
      else if (r.runner) runner = { kind: 'user', id: r.runner, nickname: names.get(r.runner) ?? '用戶' };
      else if (r.runner_name) runner = { kind: 'name', name: r.runner_name };
      const out: StoredResult = { id: r.id, place: r.place, time: Number(r.time_s), official: Number(r.official_s), auto: !!r.auto, runner };
      const reaction = num(r.reaction_s);
      if (reaction !== null) out.reaction = reaction;
      if (r.false_start) out.falseStart = true;
      return out;
    })
    .sort((a: StoredResult, b: StoredResult) => a.place - b.place);
  const race: StoredRace = {
    id: row.id,
    ranAt: new Date(row.ran_at).toISOString(),
    distanceM: num(row.distance_m),
    mode: row.mode,
    results,
    owner: uid,
    dirty: false,
    rev: 1,
  };
  if (row.signal) race.signal = row.signal;
  return race;
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

