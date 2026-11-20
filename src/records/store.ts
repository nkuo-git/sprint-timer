import { emptyStore, type MyResult, type RecentPerson, type Runner, type StoreData, type StoredRace, type StoredResult, type StoredRun, type TaggedResult } from './types';

/** 把整份紀錄存成一個字串的地方（手機上是一個 JSON 檔） */
export interface Persistence {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
}

const RECENT_MAX = 12;

/** RFC 4122 v4。雲端用 uuid 當主鍵，手機離線時自己產生。 */
export function uuid(): string {
  const b = new Uint8Array(16);
  const c = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type RaceInput = Pick<StoredRace, 'id' | 'ranAt' | 'distanceM' | 'mode' | 'signal'> & { results: StoredResult[] };

export type RunInput = Pick<StoredRun, 'id' | 'ranAt' | 'distanceM' | 'durationS' | 'targetM' | 'completed' | 'splitsS' | 'track'>;

/**
 * 這支手機上的所有紀錄（純邏輯，不含 React 與網路）。
 * 成績一律先存在這裡，同步（sync.ts）再把 dirty 的比賽上傳。
 */
export class RecordStore {
  data: StoreData = emptyStore();
  private listeners = new Set<() => void>();
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly persistence: Persistence) {}

  async load(): Promise<void> {
    try {
      const raw = await this.persistence.load();
      const d = raw ? JSON.parse(raw) : null;
      if (d && d.v === 1 && Array.isArray(d.races)) {
        this.data = { ...emptyStore(), ...d };
        // 長跑功能之前的版本存的檔案沒有這一項
        if (!Array.isArray(this.data.runs)) this.data.runs = [];
      }
    } catch {
      // 檔案壞掉就從空的開始；雲端有的之後會同步回來
      this.data = emptyStore();
    }
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 修改資料後呼叫：通知畫面並存檔（存檔依序進行，不會互相覆蓋） */
  commit(): Promise<void> {
    this.emit();
    const snapshot = JSON.stringify(this.data);
    this.saving = this.saving.then(() => this.persistence.save(snapshot)).catch(() => undefined);
    return this.saving;
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  // ───────────── 比賽 ─────────────

  race(id: string): StoredRace | undefined {
    return this.data.races.find((r) => r.id === id);
  }

  /** 這支手機計時的比賽（新的在前），不含已刪除的 */
  races(): StoredRace[] {
    return this.data.races.filter((r) => !r.deleted).sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  }

  /** 新增或更新一趟比賽（成績畫面每次修改都會呼叫）。沒有任何成績的不存。 */
  saveRace(input: RaceInput, owner: string | null): Promise<void> {
    const existing = this.race(input.id);
    if (input.results.length === 0) {
      if (existing) return this.deleteRace(input.id);
      return Promise.resolve();
    }
    const results = input.results.map((r) => ({ ...r }));
    if (existing) {
      const next = { ...existing, ...input, results, deleted: undefined };
      if (sameRace(existing, next) && !existing.deleted) return Promise.resolve();
      Object.assign(existing, next, { dirty: true, rev: existing.rev + 1 });
    } else {
      this.data.races.push({ ...input, results, owner, dirty: true, rev: 1 });
    }
    for (const r of results) if (r.runner?.kind === 'user') this.touchRecent({ id: r.runner.id, nickname: r.runner.nickname, at: input.ranAt });
    return this.commit();
  }

  deleteRace(id: string): Promise<void> {
    const r = this.race(id);
    if (!r) return Promise.resolve();
    // 從沒上傳過的直接拿掉；上傳過的留下刪除記號，等同步時刪掉雲端那份
    if (r.owner === null) this.data.races = this.data.races.filter((x) => x.id !== id);
    else Object.assign(r, { deleted: true, dirty: true, rev: r.rev + 1 });
    return this.commit();
  }

  /** 等待上傳的筆數：比賽加上長跑（這個帳號的，加上未登入時存的） */
  pendingCount(uid: string | null): number {
    const mine = (r: { dirty: boolean; owner: string | null }) => r.dirty && (r.owner === null || r.owner === uid);
    return this.data.races.filter(mine).length + this.data.runs.filter(mine).length;
  }

  // ───────────── 長跑 ─────────────

  run(id: string): StoredRun | undefined {
    return this.data.runs.find((r) => r.id === id);
  }

  /** 這支手機上看得到的長跑（新的在前）：這個帳號的，加上未登入時存的 */
  runs(uid: string | null): StoredRun[] {
    return this.data.runs.filter((r) => !r.deleted && (r.owner === null || r.owner === uid)).sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  }

  /** 存一次長跑。同一個 id 已經存過就不再存（長跑存了之後不會改） */
  saveRun(input: RunInput, owner: string | null): Promise<void> {
    if (this.run(input.id)) return Promise.resolve();
    this.data.runs.push({ ...input, splitsS: [...input.splitsS], track: [...input.track], owner, dirty: true, rev: 1 });
    return this.commit();
  }

  deleteRun(id: string): Promise<void> {
    const r = this.run(id);
    if (!r) return Promise.resolve();
    // 和比賽一樣：從沒上傳過的直接拿掉，上傳過的留下刪除記號等同步
    if (r.owner === null) this.data.runs = this.data.runs.filter((x) => x.id !== id);
    else Object.assign(r, { deleted: true, dirty: true, rev: r.rev + 1 });
    return this.commit();
  }

  // ───────────── 最近一起跑的人 ─────────────

  touchRecent(p: RecentPerson) {
    const rest = this.data.recent.filter((x) => x.id !== p.id);
    const old = this.data.recent.find((x) => x.id === p.id);
    const at = old && old.at > p.at ? old.at : p.at;
    this.data.recent = [{ id: p.id, nickname: p.nickname, at }, ...rest].sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT_MAX);
  }

  // ───────────── 我的成績 ─────────────

  /** 我的成績：自己計時並標記為自己的，加上別人標記給我的。新的在前。 */
  myResults(uid: string | null): MyResult[] {
    const seen = new Set(this.data.seenTagged);
    const out: MyResult[] = [];
    for (const race of this.data.races) {
      if (race.deleted) continue;
      if (race.owner !== null && race.owner !== uid) continue;
      for (const r of race.results) {
        if (r.runner?.kind !== 'self') continue;
        out.push({
          key: r.id,
          raceId: race.id,
          resultId: r.id,
          ranAt: race.ranAt,
          distanceM: race.distanceM,
          mode: race.mode,
          place: r.place,
          runners: race.results.length,
          time: r.time,
          official: r.official,
          reaction: r.reaction,
          falseStart: r.falseStart,
          timedBy: null,
          isNew: false,
        });
      }
    }
    if (uid) {
      for (const t of this.data.tagged) {
        out.push({
          key: t.resultId,
          raceId: t.raceId,
          resultId: t.resultId,
          ranAt: t.ranAt,
          distanceM: t.distanceM,
          mode: t.mode,
          place: t.place,
          runners: null,
          time: t.time,
          official: t.official,
          reaction: t.reaction,
          falseStart: t.falseStart,
          timedBy: { id: t.timerId, nickname: t.timerNickname },
          isNew: !seen.has(t.resultId),
        });
      }
    }
    return out.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  }

  /** 把「別人標記給我」的成績都記為看過 */
  markTaggedSeen(): Promise<void> {
    const ids = this.data.tagged.map((t) => t.resultId);
    if (ids.every((id) => this.data.seenTagged.includes(id))) return Promise.resolve();
    this.data.seenTagged = ids;
    return this.commit();
  }

  /** 同步後換上最新的「別人標記給我」清單 */
  setTagged(tagged: TaggedResult[]) {
    this.data.tagged = tagged;
    const alive = new Set(tagged.map((t) => t.resultId));
    this.data.seenTagged = this.data.seenTagged.filter((id) => alive.has(id));
  }

  /**
   * 登出：雲端已經有的（這個帳號、已上傳）從手機拿掉；還沒上傳的留在手機，下次登入再上傳。
   */
  clearAccountData(uid: string): Promise<void> {
    this.data.races = this.data.races.filter((r) => !(r.owner === uid && !r.dirty));
    this.data.runs = this.data.runs.filter((r) => !(r.owner === uid && !r.dirty));
    this.data.tagged = [];
    this.data.seenTagged = [];
    this.data.recent = [];
    this.data.me = undefined;
    return this.commit();
  }
}

/** 各距離的最佳成績（搶跑不算） */
export function personalBests(results: MyResult[]): Map<number, MyResult> {
  const best = new Map<number, MyResult>();
  for (const r of results) {
    if (r.distanceM === null || r.falseStart) continue;
    const b = best.get(r.distanceM);
    if (!b || r.time < b.time) best.set(r.distanceM, r);
  }
  return best;
}

/** 各目標距離的最佳長跑成績（有跑完目標的才算）。key 是目標距離（公尺） */
export function runBests(runs: StoredRun[]): Map<number, StoredRun> {
  const best = new Map<number, StoredRun>();
  for (const r of runs) {
    if (r.targetM === null || !r.completed || r.deleted) continue;
    const b = best.get(r.targetM);
    if (!b || r.durationS < b.durationS) best.set(r.targetM, r);
  }
  return best;
}

export function runnerLabel(runner: Runner | null, place: number, selfNickname?: string | null): string {
  if (!runner) return `跑者 ${place}`;
  if (runner.kind === 'self') return selfNickname ? `${selfNickname}（我）` : '我';
  return runner.kind === 'user' ? runner.nickname : runner.name;
}

function sameRace(a: StoredRace, b: Pick<StoredRace, 'ranAt' | 'distanceM' | 'mode' | 'signal' | 'results'>): boolean {
  return (
    a.ranAt === b.ranAt &&
    a.distanceM === b.distanceM &&
    a.mode === b.mode &&
    a.signal === b.signal &&
    JSON.stringify(a.results) === JSON.stringify(b.results)
  );
}
